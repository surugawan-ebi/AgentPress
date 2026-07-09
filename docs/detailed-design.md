---
title: AgentPress 詳細設計
updated: 2026-07-10
summary: MVP実装のための技術選定、DBスキーマ、サービスAPI、MCP/CLI設計、テスト計画、実装タスク分割
---

# AgentPress 詳細設計

[spec.md](./spec.md) と [overall-design.md](./overall-design.md) で確定した仕様を、実装可能な粒度に落とす。仕様との矛盾が見つかった場合は spec.md / overall-design.md が正であり、この文書を直す。

## 技術選定

| 項目 | 選定 | 理由 |
|---|---|---|
| 言語/ランタイム | TypeScript 5.x / Node.js >= 20 / ESM | MCP SDK が ESM 前提。`module: NodeNext` |
| SQLite | better-sqlite3 | 同期 API で service 層が単純になる。WAL・transaction・prebuilt binary が安定 |
| MCP | @modelcontextprotocol/sdk **v1 系に pin**（`^1`） | v2 は beta/split package のため使わない。import は `@modelcontextprotocol/sdk/server/mcp.js` / `@modelcontextprotocol/sdk/server/stdio.js` に固定 |
| CLI | commander | 標準的。subcommand 構成が素直 |
| validation | zod | tool input/output と config の検証を共通化 |
| frontmatter | gray-matter | Markdown + YAML frontmatter の parse/serialize |
| YAML | yaml | config の parse |
| diff | diff (jsdiff) | unified diff 文字列生成 |
| ID | ulid | prefixed ULID (`note_01…`) |
| test | vitest | 仕様どおり |

ビルドは `tsc` のみ（bundler なし）。`bin.agentpress` は `dist/cli/index.js` を指す。

## リポジトリ構成

```text
agentpress/（このrepo直下）
  package.json  tsconfig.json  vitest.config.ts  LICENSE(Apache-2.0)  README.md
  src/
    index.ts                  # ライブラリexport（core再export）
    cli/
      index.ts                # commander エントリ
      commands/{init,mcp,list,search,show,approve,reject,archive,history,export,import}.ts
      render.ts               # テーブル/diff等の表示ヘルパ
    mcp/
      server.ts               # McpServer 組み立て + stdio 起動
      tools/{getRegistryOverview,searchNotes,getNote,createNoteDraft,updateDraft,proposeNoteUpdate,listReviewItems,getReviewItem}.ts
      idempotency.ts          # mutating tool 共通ラッパ
    core/
      context.ts              # AppContext（db, config, actor, role）生成
      notes.ts reviews.ts search.ts policy.ts history.ts registry.ts
      markdown.ts diff.ts duplicates.ts
      errors.ts               # AgentPressError + エラーコード
      ids.ts                  # newId('note'|'proposal'|'hist'|'src'|'batch')
    db/
      client.ts               # openDb: WAL, busy_timeout=5000, foreign_keys=ON
      migrations.ts           # migration runner + 001_init
      schema.sql              # 参照用DDL（正はmigrations）
    config/
      config.ts               # loadConfig + zod schema + defaults
    types/
      note.ts proposal.ts history.ts policy.ts common.ts
  examples/support-vault/     # example vault（Markdown数点 + README）
  tests/                      # vitest（unit + integration）
```

## データベース設計（DDL）

migration 001 で以下を作成。日時は ISO 8601 文字列（UTC）。JSON カラムは `*_json`。

```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','verified','archived','rejected')),
  confidence TEXT NOT NULL DEFAULT 'medium'
    CHECK (confidence IN ('low','medium','high')),
  scope TEXT,
  owner TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  verified_at TEXT,
  archived_at TEXT,
  review_due_at TEXT,
  rejection_reason TEXT,
  draft_reason TEXT,                          -- create_note_draft の reason を永続化（reviewer が後で見る）
  search_text TEXT NOT NULL DEFAULT '',       -- NFKC+lowercase 済みの title+summary+body+tags 連結（LIKE 用 shadow column、書き込み時に更新）
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json))   -- possible_duplicates 等
);
CREATE INDEX idx_notes_status ON notes(status);
CREATE INDEX idx_notes_scope ON notes(scope);

CREATE TABLE note_sources (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id),
  type TEXT NOT NULL CHECK (type IN ('manual','url','file','openwiki','github','other')),
  title TEXT, url TEXT, path TEXT, commit_sha TEXT, retrieved_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_note_sources_note ON note_sources(note_id);

CREATE TABLE note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (note_id, tag)
);

CREATE TABLE note_relations (
  note_id TEXT NOT NULL REFERENCES notes(id),
  related_note_id TEXT NOT NULL REFERENCES notes(id),
  relation_type TEXT NOT NULL DEFAULT 'related'
    CHECK (relation_type IN ('related','supersedes','conflicts_with','references')),
  PRIMARY KEY (note_id, related_note_id, relation_type)
);

CREATE TABLE update_proposals (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id),
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','approved','rejected','needs_rebase')),
  proposal_type TEXT NOT NULL DEFAULT 'update'
    CHECK (proposal_type IN ('update','archive_recommendation')),  -- 後者はPhase 2
  base_note_version INTEGER NOT NULL,
  proposed_title TEXT, proposed_summary TEXT, proposed_body TEXT,
  proposed_tags_json TEXT, proposed_scope TEXT,
  proposed_confidence TEXT CHECK (proposed_confidence IS NULL OR proposed_confidence IN ('low','medium','high')),
  diff TEXT NOT NULL,
  changed_fields_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_json TEXT NOT NULL DEFAULT '[]',
  proposed_by TEXT NOT NULL,
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  rejection_reason TEXT
);
CREATE INDEX idx_proposals_note ON update_proposals(note_id);
CREATE INDEX idx_proposals_status ON update_proposals(status);

CREATE TABLE history_events (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('note','proposal','import','export')),
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  role TEXT NOT NULL,
  scope TEXT,
  reason TEXT,
  before_snapshot_json TEXT,
  after_snapshot_json TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',   -- 将来 policy version/hash 等
  created_at TEXT NOT NULL
);
CREATE INDEX idx_history_entity ON history_events(entity_type, entity_id);

CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('import','export')),
  path TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE idempotency_keys (
  key TEXT NOT NULL,
  tool TEXT NOT NULL,
  actor TEXT NOT NULL,                        -- 同一keyでも actor が違えば別予約として扱う（MCPサーバはactorごとに別プロセス）
  request_hash TEXT NOT NULL,                 -- 入力JSONのSHA-256。同一key+actorで入力が違えば invalid_input
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  result_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (key, tool, actor)
);

CREATE TABLE schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

方針:

- `notes.version` は正式知識に影響する変更（title/summary/body/tags/scope/confidence の適用）ごとに +1。draft 段階の `update_draft` でも +1 してよい（単調増加が保てればよい。proposal の optimistic lock は verified note にしか使われない）
- event_type 一覧: `note_created` `note_updated` `note_verified` `note_rejected` `note_resubmitted` `note_archived` `proposal_created` `proposal_approved` `proposal_rejected` `proposal_needs_rebase` `note_imported` `note_exported`
- history の snapshot は note/proposal の行 + tags/sources を JSON 化して冗長に保存する

## 設定・コンテキスト

`.agentpress/agentpress.config.yaml`（`agentpress init` が生成）:

```yaml
default_search_status: verified
strict_stale_filter: false
default_review_interval_days: 90
required_fields_for_verify: [source, confidence, owner]
reviewer_separation: warn        # warn | enforce（MVPはwarnのみ実装）
note_body_max_chars: 8000        # 超過で body_too_long 警告
scopes:
  support:
    description: ""
    owners: []
    reviewers: []
```

- 解決順: CLI は `--actor` > env `AGENTPRESS_ACTOR` > config `default_actor` > OS user。role は `--role` > env `AGENTPRESS_ROLE` > `contributor`（approve/reject/archive コマンドは既定 `reviewer`）
- MCP server は起動時に `--actor` / env を読み、**tool 入力からは一切受けない**
- `AppContext = { db, config, dataDir, actor, role }` を core/context.ts で生成し、CLI/MCP 両方が同じ関数を通る
- データディレクトリ解決: `--data-dir` > env `AGENTPRESS_HOME` > カレントの `.agentpress/`

## エラーと警告

`AgentPressError extends Error`: `{ code, message, details?, retryable, suggested_action? }`。MCP tool ではこれを JSON で返し（`isError: true`）、CLI では人間向けに整形する。

エラーコード: `not_found` `not_verified` `invalid_input` `empty_change` `version_conflict` `archived_target` `rejected_target` `not_draft_owner` `slug_conflict`(import時のみ) `io_error`

policy_warnings コード（`{code, message, suggested_action}`）: `missing_source` `weak_source_for_high_confidence` `body_too_long` `missing_headings` `summary_too_short`(< 20文字) `tags_too_sparse`(0個) `reviewer_separation` `stale_note`

## コアサービス API

全て AppContext を受けるクラスまたは関数群。書き込みは better-sqlite3 の transaction で包む。

```ts
// notes.ts
createDraft(input: CreateDraftInput): { note: Note; policyWarnings: PolicyWarning[]; possibleDuplicates: DuplicateCandidate[]; slugAdjusted: boolean }
updateDraft(input: UpdateDraftInput): { note: Note; resubmitted: boolean; policyWarnings: PolicyWarning[] }   // 対象: 自actorのdraft/rejected
getVerifiedNote(id: string): NoteWithDetail    // verified+archivedのみ。draft/rejectedはnot_verifiedエラー（MCP get_note用）
getNoteForReview(id: string): NoteWithDetail   // status問わず取得（review plane / CLI / 内部用）
archiveNote(id, reason): Note                  // CLI専用
listNotes(filter): NoteSummary[]

// reviews.ts
createProposal(input: ProposeUpdateInput): { proposal: Proposal; policyWarnings: PolicyWarning[] }
//   verified限定, 空変更はempty_change。input.base_note_version は必須:
//   現在のnote.versionと不一致なら version_conflict エラーを返し、proposalを作らない
//   （AIが古いget_note結果を基に提案するのを作成時点で検出する。approve時のlockは別途維持）
approve(targetId, reason?): ApproveResult      // note_→draft承認 / proposal_→反映。version検証→needs_rebaseカスケード
reject(targetId, reason): RejectResult         // note_→rejected / proposal_→rejected
listReviewItems(filter): { items: ReviewItem[]; nextCursor: string | null }
//   kind/scope/created_by("self")/status/limit(省略時20)/cursor/sort。
//   status はレビュー系語彙に正規化: draft noteは"pending_review"として返し、元のnotes.statusは
//   kind:"draft"の項目のみnoteStatusで保持。filterのstatus:"pending_review"はdraft note+
//   pending_reviewなproposalの両方に、"rejected"は両方のrejectedにマッチ、"needs_rebase"はproposal限定。
//   結果がちょうどlimit件のときnextCursorに最後のidを返す（簡易cursor、正確な残件判定はしない）
getReviewItem(id): ReviewItemDetail            // usable_as_context:false, needs_rebase時は復旧情報。statusはlistReviewItemsと同じ正規化+noteStatus

// search.ts
interface SearchEngine { search(input: SearchInput): SearchResult }
LikeSearchEngine
//   notes.search_text（NFKC+lowercase済みshadow column）に対するSQL LIKEで候補を絞り、
//   ヒット行のみJSでフィールド別に再マッチして matched_fields / snippet(マッチ前後~60字) を計算する。
//   verified固定, include_archived, stale付与。search_textはnotes書き込み時に必ず再計算する

// policy.ts
checkDraft(note): PolicyWarning[]              // 粒度/summary/tags/source品質
checkApprove(target): PolicyWarning[]          // required_fields + reviewer_separation + weak_source
computeReviewDueAt(verifiedAt): string

// registry.ts
getRegistryOverview(scope?): RegistryOverview  // schema_version, server_version, strict_stale_filter, scopes[](verified_count/stale_count/top_tags/reviewers), usage_policy, recommended_first_steps

// history.ts
record(event): void
listByEntity(entityId): HistoryEvent[]

// markdown.ts
exportAll(outDir): ExportSummary               // <slug>--<id>.md, frontmatterにDB metadata
importPath(path, opts): ImportSummary          // id無/未知id→新規draft, draft→更新, verified→proposal化, archived/rejected→エラー(skip扱いで継続)

// duplicates.ts
findPossibleDuplicates(title, summary): DuplicateCandidate[]  // verified+draft横断LIKE上位5件、作成時に計算しnotes.metadata_jsonへ保存

// diff.ts
buildUnifiedDiff(before, after, label): string
changedFields(input, note): string[]
```

`approve` の処理順: 対象判定 → policy 検証（警告収集）→ reviewer separation 警告 → proposal なら `base_note_version === note.version` の事前チェック（安価な早期リターン用で、複数プロセス間の TOCTOU に対しては脆弱なため正しさの保証には使わない）。**不一致の場合は「当該 proposal を `needs_rebase` に更新 + history 記録」だけを独立トランザクションで commit してから `version_conflict` エラーを返す**（better-sqlite3 の transaction は throw で rollback されるため、状態更新とエラー送出を同一 tx に入れない）。事前チェックが一致した場合は 1 トランザクションで: `UPDATE notes ... WHERE id=@id AND version=@base_note_version AND status='verified'` を実行して `changes === 1` を検証する（これが実際の楽観ロック本体。0 件なら別プロセスがその間に version を進めたということなので、専用の例外を投げてこのトランザクションをロールバックし、事前チェック不一致時と同じ「needs_rebase 更新 + history を独立トランザクションで commit → `version_conflict`」経路にフォールバックする。フォールバック時は `note.version` を再取得してエラーメッセージに使う）。`changes === 1` なら同一トランザクション内で: note へ反映（`version+1` / `verified_at` / `review_due_at` 更新）→ `proposal.source` の各エントリを `note_sources` へ追記マージ（`type`+`url`+`path` が完全一致する既存行はスキップして重複を防ぐ。置き換えではなく追加）→ proposal を `approved` に → 同一 note の他 pending proposal を `needs_rebase` に + `proposal_needs_rebase` イベント → history 記録。draft note の承認も同様に `version+1` する（内容は変わらないが、spec.md の承認手順どおり単調増加を保つ）。note 系 history event の `before_snapshot_json`/`after_snapshot_json` は `noteRows.ts` の `buildNoteSnapshot(db, noteRow)`（`{note, tags, sources}`）に統一し、`note` 行だけでなく tags/sources も必ず含める。

## MCP server 設計

- `McpServer` に 8 tool を登録。tool ごとに zod の input schema **と outputSchema** を定義し、description には「draft/review item を正式根拠に使わない」「0件時の挙動」「stale の扱い」を明記する
- レスポンスは `structuredContent`（構造化 JSON）を正とし、`content: [{type:"text", text: JSON.stringify(result)}]` を fallback として併記。エラーは `isError: true` + エラー JSON
- mutating tool（create_note_draft / update_draft / propose_note_update）は `idempotency.ts` のラッパを通す。予約は `(key, tool, actor)` 単位（同一keyでもactorが違えば別予約。MCPサーバはactorごとに別プロセスで起動するため）。フロー: (1) 短い独立トランザクションで予約行を INSERT して即 commit し、他プロセスからも `in_progress` が見えるようにする（既存行あり: `completed` なら保存済み結果を返す。`in_progress` かつ10分以内なら `in_progress` retryable エラー。10分より古い`in_progress`は放棄されたとみなし上書きして予約を取得する。`request_hash` 不一致なら `invalid_input`）→ (2) 予約 tx の外で mutation を実行（失敗時は `finally` で予約行を削除しリトライ可能にする）→ (3) 成功時に `result_json` を保存し `completed` に更新
- `propose_note_update` の入力に `base_note_version`（必須）を追加。get_note の citation.version をそのまま渡す想定
- search_notes の 0 件時は仕様どおり `no_results: true` / `guidance` / `suggested_next_tools` / `searched_statuses`
- citation は `{label, note_id, version, updated_at, review_due_at, stale, confidence, status, scope}` を共通ヘルパで生成
- `agentpress mcp` コマンドが `StdioServerTransport` で起動。stdout は MCP protocol 専用、ログは stderr

## CLI 設計

```text
agentpress init [--data-dir <dir>]
agentpress mcp [--actor <actor>] [--data-dir <dir>]
agentpress list [--pending] [--scope <s>] [--status <st>]
agentpress search <query> [--include-archived]
agentpress show <note_id|proposal_id>
agentpress approve <id> [--actor a] [--reason r] [--role reviewer]
agentpress reject <id> --reason r [--actor a]
agentpress archive <note_id> --reason r [--actor a]
agentpress history <id>
agentpress export [--out data/notes]
agentpress import <path> [--verified] [--source <type>] [--commit <sha>]
```

- `list --pending`: 冒頭に scope/kind 別件数サマリ → 古い順の一覧。各行に `⚠ warnings` / `≈ dup` フラグ
- `show <proposal_id>`: 対象 note、reason、source、proposed_by、unified diff、changed_fields、needs_rebase なら復旧情報を表示
- `import`: 完了時に「新規 draft n / proposal n / skip n」サマリ + scope ごとの小分けレビュー案内。`--verified` は import 直 verify（人間専用オプション、required_fields を検証）
- 出力は plain text（依存を増やさない。色は picocolors 程度なら可）

## Markdown import/export 詳細

frontmatter は spec.md の Knowledge Note 例に従う（id, slug, title, type, status, confidence, scope, owner, created_by, reviewed_by, review_due_at, tags, source, created_at, updated_at, verified_at, archived_at, relations, summary, version）。

- export: `data/notes/<slug>--<note_id>.md` に全 status の note を書き出し（rejected は除く）。`data/notes/` 直下を毎回上書き。export summary を import_batches(type=export) と history に記録
- import 判定: frontmatter `id` 無し or DB に無し → 新規 draft（`--verified` 時は verify 検証つきで verified）/ id あり & draft → draft 更新（version+1, history）/ id あり & verified → 差分あれば proposal 生成（actor=import 実行者）/ archived・rejected → skip + 警告（エラーで全体を止めない）
- 新規 import 時の slug 衝突は自動 suffix。id 指定付き新規（DB に無い id）はその id を尊重する

## example vault

`examples/support-vault/`: CS チーム想定の Markdown 5〜6 枚（返金ポリシー、エスカレーション基準、対応SOP、禁止事項、料金FAQ）。うち 1 枚は source 無しで「レビューで警告が出る」デモ用。README に `agentpress init && agentpress import examples/support-vault --verified` からの一連のデモ手順を書く。日本語ノートを含め、LIKE 検索が日本語で当たることを見せる。

## テスト計画

- unit: ids / diff / policy(各警告コード) / duplicates / search(NFKC・日本語部分一致・stale 付与・include_archived) / markdown(roundtrip・衝突・status分岐)
- service: notes(draft作成→update_draft→再提出) / reviews(draft approve, proposal approve, version_conflict, needs_rebase カスケード, reject, empty_change, 他人draft拒否)
- mcp: tool handler を直接呼ぶ（server 起動なし）。idempotency の重複実行、get_note の not_verified、search 0件、citation フィールド
- cli: commander を programmatic に実行。テストごとに fresh な `Command` を factory（`buildProgram()`）で生成し、`exitOverride()` + `configureOutput()` で exit と出力を capture する。tmp dir で init→import→approve→search→export の統合フロー
- DB は各テストで tmp ファイル or `:memory:`（migration は共通）
- ESM/NodeNext のため、相対 import には必ず `.js` 拡張子を付ける（`import { x } from "./notes.js"`）

## 実装タスク分割（委譲単位）

1. **Phase 1**: scaffold（package.json/tsconfig/vitest/LICENSE）+ db/ + config/ + types/ + errors/ids + NoteService + HistoryService + policy の骨格 + unit tests
2. **Phase 2**: PolicyService 完成 + SearchService + diff + duplicates + ReviewService + markdown + registry + tests
3. **Phase 3a**: CLI 全コマンド + render + 統合テスト（3b と並行可。src/cli/ と tests/cli* のみ触る）
4. **Phase 3b**: MCP server + 8 tools + idempotency + tests（3a と並行可。src/mcp/ と tests/mcp* のみ触る）
5. **Phase 4**: examples/support-vault + README + E2E 検証（実 CLI 実行 + MCP stdio 疎通）+ 完了条件チェック

Phase 1 で全依存を package.json に入れる（後続 phase は package.json を触らない）。

## 完了条件

spec.md の Completion Criteria に従う: `npm install` / `npm run build` / `npm test` が通る、`agentpress init` で初期化できる、`agentpress mcp` で MCP サーバが起動する、8 tools が使える、CLI で検索・表示・承認・却下・archive ができる、Markdown export/import ができる、README が書かれている、example vault が同梱されている。
