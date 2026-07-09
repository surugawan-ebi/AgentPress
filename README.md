# AgentPress

> A Git-style review queue for the knowledge your AI agents are allowed to cite.

Notion や Confluence は人間が読むためのツールです。AgentPress は、AIエージェントが実行時に安全に参照できる `verified` context を、提案・レビュー・承認・配布するためのローカルOSSワークフローです。

```text
Notion and Confluence are for humans to read.
AgentPress is for AI agents to consume verified context safely.
```

## AgentPress とは何か（Verified Context Layer）

AgentPress は「APIで記事を管理できるCMS」ではありません。中心にあるのは、AIエージェントが回答の根拠として使ってよい社内ナレッジを、

1. AIまたは人間が **draft**（下書き）として提案し、
2. 人間の reviewer が **approve / reject** し、
3. 承認済みの **verified** ナレッジだけを AI が MCP tool 経由で参照する

という一連のワークフローに載せることです。draft・rejected・review 中の proposal は、AIが回答の正式根拠として使ってはいけません。この境界（verified のみを正式根拠にする）を、強い認証ではなく操作境界とhistoryで担保するのが AgentPress の設計方針です。

正本（source of truth）は SQLite で、Markdown は import/export 用の可搬な表現・人間が読むためのスナップショットです。

## 他のツールとの違い

| | 何をするツールか | AgentPress との違い |
|---|---|---|
| **WordPress / Headless CMS** | 人間向け記事をAPIで配信する | AgentPressはCMSではなく、AIが引用してよい知識をレビュー・承認するガバナンス層。記事配信そのものが目的ではない |
| **RAG（素朴な実装）** | 手元のドキュメントを検索してLLMに渡す | RAGは「検索できること」が目的になりがちで、検索対象の正しさ・承認状態を区別しない。AgentPressは検索前に「承認済みかどうか」で対象を絞る |
| **ContextNest** | 検証可能なcontext vaultの仕様（provenance/version/整合性） | ContextNestは暗号学的な検証可能性を追求する先行仕様。AgentPressは同じ問題意識を持ちつつ、MVPでは実務で回るレビューワークフローとOSSとして触りやすいローカル実装を優先する |
| **OpenWiki** | codebaseからagent-readable docsを生成・更新するCLI | OpenWikiは生成が主目的。AgentPressはOpenWikiの生成物も含め、人間レビュアーが承認し配布する側を担当する |

## MVPでできること

- ローカルで動く MCP サーバと CLI（SaaS化・ログイン・課金・Web UIはなし）
- draft 作成 → レビュー → 承認 → verified 化 → 検索・引用、という一連のワークフロー
- 既存verified noteへの更新提案（update proposal）と optimistic lock（`version` 不一致時は `needs_rebase`）
- Markdown import/export（`data/notes/`）
- scope・owner・reviewer・actor の最小モデルと変更履歴（history）
- verified-onlyのデフォルト検索、`stale`（レビュー期限切れ）の可視化

## インストール

```bash
git clone <このリポジトリ>
cd agentpress
npm install
npm run build
```

`npm link` するか、`node dist/cli/index.js <command>` の形で直接実行できます。以下の説明では `agentpress` コマンドとして表記します（`npm link` 後、または `bin` を通した場合のコマンド名）。

## クイックスタート（example vault を使ったデモ）

`examples/support-vault/` に、CSチームを想定した日本語ナレッジのサンプルが同梱されています（詳細は [`examples/README.md`](./examples/README.md)）。

```bash
# 1. 初期化（.agentpress/agentpress.sqlite・config・data/notes/ を作成）
agentpress init

# 2. サンプルノートを import（draftとして取り込まれる）
agentpress import examples/support-vault

# 3. レビュー待ち一覧を確認（policy warningsは⚠、重複候補は≈で表示される）
agentpress list --pending

# 4. 中身を確認
agentpress show <note_id>

# 5. 承認（人間のレビュアーとして）
agentpress approve <note_id> --actor human:reviewer --reason "内容を確認、正式ナレッジとして承認"

# 6. verifiedになったノートを検索
agentpress search "返金"
```

## 起動方法

```bash
# 初期化（.agentpress/agentpress.sqlite, agentpress.config.yaml, data/notes/ を作成）
agentpress init [--data-dir <dir>]

# MCP stdioサーバを起動（AIクライアントから接続する）
agentpress mcp [--actor <actor>] [--data-dir <dir>]
```

データディレクトリの解決順は `--data-dir` > 環境変数 `AGENTPRESS_HOME` > カレントの `./.agentpress/` です。actorの解決順は `--actor` > 環境変数 `AGENTPRESS_ACTOR` > config の `default_actor` > OSユーザー名です。

## MCPクライアントからの接続方法

stdio transportで起動するため、Claude Desktop や `.mcp.json` 形式で設定できるMCPクライアントから直接呼び出せます。

**Claude Desktop（`claude_desktop_config.json`）:**

```json
{
  "mcpServers": {
    "agentpress": {
      "command": "node",
      "args": ["/absolute/path/to/agentpress/dist/cli/index.js", "mcp"],
      "env": {
        "AGENTPRESS_ACTOR": "agent:claude-desktop",
        "AGENTPRESS_HOME": "/absolute/path/to/agentpress/.agentpress"
      }
    }
  }
}
```

**プロジェクトルートの `.mcp.json`:**

```json
{
  "mcpServers": {
    "agentpress": {
      "command": "node",
      "args": ["dist/cli/index.js", "mcp"],
      "env": {
        "AGENTPRESS_ACTOR": "agent:codex"
      }
    }
  }
}
```

actor は MCP tool の入力からは受け取りません。stdio transport は MCP client ごとに別プロセスが起動するため、プロセス単位の `env`（`AGENTPRESS_ACTOR`）や `--actor` でエージェントを識別します。

## AIクライアント向け利用プロトコル

1. **接続直後にまず `get_registry_overview` を呼ぶ。** scope構成・note件数・`usage_policy`・`recommended_first_steps` が一度に把握でき、何も知らない状態で `search_notes` を手探りするのを防ぐ。
2. **正式根拠として使ってよいのは `verified` のみ。** `draft` / `rejected` / review中の `proposal` は `list_review_items` / `get_review_item` でしか見えず、これらの内容を回答の根拠にしてはいけない（`get_review_item` のレスポンスは常に `usable_as_context: false`）。
3. **`search_notes` が0件のとき**、レスポンスは `{results: [], no_results: true, query, searched_statuses, guidance, suggested_next_tools}` の形になる。外部知識や一般知識を組織の正式ナレッジであるかのように提示せず、確度の高い知識があれば `create_note_draft` で提案する。
4. **`stale: true` の扱い。** `review_due_at` を過ぎた verified note は `stale: true` を付けて返る。正式根拠として使ってよいが、回答時に「要再確認」であることを明示すること。`strict_stale_filter: true` の設定時は検索結果からstale noteが除外される。
5. **既存ノートは直接上書きしない。** 更新したい場合は `propose_note_update` で提案する。承認・却下・archiveはCLI限定（人間専用）。

## MCP tools 一覧（8 tools）

| tool | plane | 説明 |
|---|---|---|
| `get_registry_overview` | verified | 接続直後に呼ぶ入口ツール。scope構成・件数・usage_policyを返す |
| `search_notes` | verified | verified note を検索する（NFKC正規化+LIKE、`include_archived`可） |
| `get_note` | verified | note_idからverified/archivedノートの詳細を取得する。draft/rejectedはエラー |
| `create_note_draft` | contribution | 新しい知識案(draft)を作成する。承認されるまで正式根拠にならない |
| `update_draft` | contribution | 自分が作成したdraft/rejectedを編集する。rejectedを編集すると再提出(draft)になる |
| `propose_note_update` | contribution | verified noteへの更新案(proposal)を作成する。`base_note_version`の不一致は`version_conflict` |
| `list_review_items` | review | draft/proposal横断のレビュー一覧（正式根拠としては使わない） |
| `get_review_item` | review | note_/proposal_のIDから全文とレビュー状態を返す（`usable_as_context: false`固定） |

`approve_note` / `reject_review` / `archive_note` は MCP toolとして公開せず、CLI限定です（AIによる正式知識への直接書き込みを防ぐための設計上の境界）。

mutating tool（`create_note_draft` / `update_draft` / `propose_note_update`）は任意の `idempotency_key` を受け付け、同一keyでの再実行は新しい副作用を起こさず元の結果を返します。

## CLIの使い方

```text
agentpress init [--data-dir <dir>]
agentpress mcp [--actor <actor>] [--data-dir <dir>]
agentpress list [--pending] [--scope <s>] [--status <st>]
agentpress search <query> [--include-archived] [--scope <s>] [--limit <n>]
agentpress show <note_id|proposal_id>
agentpress approve <id> [--actor <a>] [--reason <r>] [--role <role>]
agentpress reject <id> --reason <r> [--actor <a>]
agentpress archive <note_id> --reason <r> [--actor <a>]
agentpress history <id>
agentpress export [--out <dir>]
agentpress import <path> [--verified] [--source <type>] [--commit <sha>]
```

- `list --pending` はレビュー負債を可視化するコマンドです。scope/kind別の件数サマリ、作成日時の古い順一覧、各行の `⚠`（policy warning あり）/ `≈`（重複候補あり）フラグを表示します。
- `approve` / `reject` / `archive` の既定 role は `reviewer` です。
- `import` は完了時に「新規draft n件 / update n件 / proposal n件 / skip n件」のサマリと、scopeごとの内訳・レビュー案内を表示します。`--verified` は人間専用オプションで、`required_fields_for_verify` を満たすnoteのみ直接verifiedにします（満たさない場合はdraftのまま警告が付きます）。

## データモデル概要

| エンティティ | 説明 |
|---|---|
| **Note** | 知識単位。`status: draft \| verified \| archived \| rejected`、`confidence: low \| medium \| high`、`scope`、`owner`、`version`、`review_due_at` などを持つ |
| **Update Proposal** | 既存verified noteへの変更案。`status: pending_review \| approved \| rejected \| needs_rebase`、`base_note_version`、`diff`、`changed_fields` を持つ |
| **History Event** | 全ての変更履歴（`note_created` / `note_verified` / `proposal_approved` など）。actor・role・reason・timestampを記録し、監査の土台にする |
| **Source / Tag / Relation** | note に紐づく出典・タグ・関連ノート |

正本は `.agentpress/agentpress.sqlite`。Markdownは `data/notes/<slug>--<note_id>.md` にexportされる可搬表現です。

## 承認フローと role / scope

```text
contributor  draft note と update proposal を作れる（AI agentはここに属する）
reviewer     担当scopeのdraft/proposalを承認・却下できる
maintainer   schema・import/export・policy・scope設定を管理する
```

- AIが作った draft はいきなり `verified` にはなりません。人間が `agentpress approve` するまでは review 待ちです。
- `propose_note_update` で作られた proposal は、承認時に `base_note_version` と現在の `note.version` が一致するかを検証します（optimistic lock）。不一致なら proposal は `needs_rebase` になり、AIは現行のverified noteを取得し直して再提案します。
- 1つの proposal が承認されると、同じnoteに対する他の pending proposal は自動的に `needs_rebase` にカスケードします。
- `reviewer` は `created_by`（作成者）と同一actorにしないことが推奨されます。MVPでは警告（`reviewer_separation`）にとどめ、強制はしません。
- 承認・却下・archiveは必ずhistoryに記録されます（`agentpress history <id>` で確認可能）。

## Markdown export/import と Git 運用

- `agentpress export` で全status（rejected以外）のnoteを `data/notes/<slug>--<note_id>.md` に書き出します。実行のたびにディレクトリ内容が上書きされるため、`data/notes/` は生成物として `.gitignore` されています。
- Markdownを直接編集した場合は `agentpress import <path>` で取り込みます。frontmatterに `id` が無い/未知のIDなら新規draft、既存draftならバージョンを上げて更新、既存verifiedとの差分があればupdate proposalになります。archived/rejectedのnoteをimport対象に含めると、そのファイルはスキップされ警告になります（バッチ全体は止まりません）。
- 「PRレビュー = コード、AgentPressレビュー = ナレッジ」という責務分離が運用の前提です。コード変更はGit/PRで、ナレッジ変更はAgentPressのdraft/proposalレビューでレビューします。`data/notes/` をリポジトリに含める場合は、それがAgentPress側でレビュー済みのexport結果であることを明記してください。

## ライセンスとコントリビューション

Apache License 2.0 で公開しています（[LICENSE](./LICENSE)）。Issue・Pull Requestを歓迎します。コア設計の背景は [`docs/spec.md`](./docs/spec.md) と [`docs/overall-design.md`](./docs/overall-design.md)、実装仕様は [`docs/detailed-design.md`](./docs/detailed-design.md) にまとまっています。実装に関わる変更は、まずこれらのドキュメントとの整合性を確認してください。

## ロードマップ

**Phase 1: OSS Local Governed MVP（本リポジトリの現状）**
ローカルMCPサーバ、SQLite、Markdown import/export、8 MCP tools、CLIによるapprove/reject/archive/import/export、履歴管理、example vault。

**Phase 2: Team Workflow Pack**
scope別reviewerなどのpolicy設定強化、due date/stale検出の高度化、context pack、CLIでのreview queue改善、`recommend_archive` のMCP公開、`get_note_history` のMCP公開、FTS5(trigram)によるSearchEngine差し替え、source種別ごとの厳格な承認条件。

**Phase 3: Connectors and Governance**
ベクトル検索、類似ノート検出、矛盾検出、古い知識の検出、citation強化、AI回答用のcontext packaging、Notion/Confluence/Google Docs/Slack/GitHub connector、OpenWiki生成docsのimport、MCP tool単位のpolicy、複数AIクライアント対応。

**Phase 4: Enterprise or Managed Layer**
SSO/RBAC、hosted MCP gateway、private deployment、audit/complianceレポート、connector管理、usage analytics、利用知識の分析、知識の鮮度スコア。

詳細は [`docs/spec.md`](./docs/spec.md) の Roadmap セクションを参照してください。
