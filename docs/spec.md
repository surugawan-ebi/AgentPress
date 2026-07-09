---
title: AgentPress MVP Spec
updated: 2026-07-10
summary: AIエージェント向け社内ナレッジを、承認、履歴、引用、信頼度つきで管理するOSSワークフローのMVP仕様
---

# AgentPress MVP Spec

この文書はMVPの仕様メモ。  
実装全体の構成、コンポーネント、DB、主要workflowは[overall-design.md](./overall-design.md)に分ける。

## Product Position

一行:

```text
A Git-style review queue for the knowledge your AI agents are allowed to cite.
```

仮称:

- `AgentPress`
- `Verified Context Layer for AI Agents`
- `Approval-first Knowledge Workflow for AI Agents`
- `Agent Knowledge Registry`

位置づけ:

```text
Notion and Confluence are for humans to read.
AgentPress is for AI agents to consume verified context safely.
```

単なるHeadless CMSではない。  
目的は「APIで記事を管理できるCMS」ではなく、AIエージェントが使ってよい社内ナレッジを、提案、レビュー、承認、配布できる実務ワークフローにすること。actor/role/scopeの履歴は、将来のRBACや監査への接続を見据えて残す。

初期構想の `WordPress for AI Agents` は、一言で説明するための入口の比喩にすぎない。現在の中心はCMSではなく、AIが実行時に参照するverified contextの統制である。

## Non Goals for MVP

MVPでは以下をやらない。

- SaaS化
- ログイン
- 課金
- Web UI
- 本格的なチーム管理
- 高度な権限管理
- 監査ログUI
- ベクトル検索
- HTMLレンダリング
- Google Docs / Slack / Notionとの同期

MVPの中心は、OSSとしてローカルで動くMCPサーバとCLI。  
チーム利用を想定したroles/review workflowは持つが、MVPでは認証基盤やWeb管理画面は作らない。

## MVP Decisions

実装前の判断:

- 正本はSQLiteにする。Markdownはimport/exportと人間が読むためのsnapshotであり、同時編集されるdual masterにはしない
- agent-facingなMCP toolは、レジストリ概要取得、検索、取得、draft作成/編集、更新提案、レビュー状況確認までにする（8 tools）。archive推薦（`recommend_archive`）と履歴取得（`get_note_history`）のMCP公開はPhase 2で検討する
- `approve_note`はMVPではMCP toolとして公開せず、CLI限定にする
- `archive_note`もMVPではCLI限定にする。AIが古い知識を見つけた場合は、MVPでは`propose_note_update`で本文修正を提案する。archive自体の実行は人間がCLIで行う
- 最初のユーザーは小規模チームや開発者、AI推進担当が、自分たちのローカル環境から使い始めるケース。部門ごとのreviewerによる本格的なチーム承認ワークフローはPhase 2以降で広げる
- citationはMVPではnote単位で十分。将来のsection citationに備えてMarkdown見出しは保持する。`version`、`review_due_at`、`stale`は必ず含め、`note_id + version + updated_at`で根拠を後から追跡できるようにする
- OSS coreとして別repoに切る。このrepoは企画、仕様、実装プロンプトの正本にする
- ContextNestは先行仕様として参考にする。ただしAgentPressは検証可能なcontext vault仕様ではなく、日々の提案、レビュー、承認、配布を回す実務ワークフローに寄せる

## Core Objects

### Knowledge Note

AIが扱う知識単位。人間向け記事ではなく、検索、引用、更新管理しやすいノート。

frontmatter例:

```yaml
id: "note_xxxxx"
title: "GA4にユーザーセグメントを連携する方法"
slug: "ga4-user-segment-import"
type: "knowledge_note"
status: "draft"
confidence: "medium"
scope: "analytics"
owner: "data-platform"
created_by: "agent:codex"
reviewed_by: null
review_due_at: "2026-10-08T00:00:00Z"
tags:
  - GA4
  - BigQuery
  - GCS
source:
  - type: "manual"
    title: "initial input"
    url: null
created_at: "2026-07-08T00:00:00Z"
updated_at: "2026-07-08T00:00:00Z"
verified_at: null
archived_at: null
relations:
  - "note_yyyyy"
summary: "AIが短く把握するための要約"
```

本文例:

```markdown
# 概要

...

# 正本回答

...

# 具体例

...

# 注意点

...

# アンチパターン

...
```

### Note Granularity

推奨は「1 note = 1つの質問に答えられる粒度」。`body`は目安2,000〜8,000字とし、見出し構造を必須にする。

目安を超える場合や見出しが不足する場合はブロックせず、作成、import、承認のタイミングで`policy_warnings`として通知する。

- `body_too_long`: bodyが目安を超えている
- `missing_headings`: 見出し構造がない、または不十分
- `summary_too_short`: summaryが短すぎる
- `tags_too_sparse`: tagsが少なすぎる

専用のlintコマンドは作らず、`create_note_draft` / `update_draft` / `agentpress import` / `agentpress approve`でのpolicy_warnings表示で代替する。

### Status

```text
draft | verified | archived | rejected
```

- `draft`: AIまたは人間が作成した未承認知識
- `verified`: 人間が承認した正式知識
- `archived`: かつて`verified`だった、非推奨または参照非推奨の知識
- `rejected`: 却下された`draft`。`update_draft`で修正すると`draft`に戻り再提出できる

`archived`は「過去に正式だった知識の非推奨化」、`rejected`は「一度も正式になっていないdraftの却下」であり、意味が異なる。

通常のAI向け検索では`verified`だけを返す。`archived`はデフォルト除外で、`include_archived`を指定したときだけ含める。  
`draft`と`rejected`は通常検索や`get_note`の対象外。承認待ちや却下状況の確認は`list_review_items`/`get_review_item`でのみ扱う。

### Confidence

```text
low | medium | high
```

信頼度はAIが回答時にcontextとして扱えるようにする。  
MVPでは自動推定しない。作成時または承認時に設定する。

### Governance Roles

MVPでは本格的な認証は作らないが、履歴とレビュー責任を残すためにrole概念だけは持つ。

```text
contributor | reviewer | maintainer
```

- `contributor`: draft noteとupdate proposalを作れる。AI agentはここに属する
- `reviewer`: 担当scopeのdraft/proposalを承認または却下できる
- `maintainer`: schema、import/export、policy、scope設定を管理する

初期実装ではactorをCLI設定、環境変数、または`--actor`で渡す。  
将来SSOやRBACを入れる場合も、history eventには同じactor/role情報を残す。

### Review Policy

AgentPressの中心は「AIが読んでよいcontext」を明確に分離すること。

- AI agentが通常参照できるのは`verified`かつpolicyを満たすnoteのみ
- `source`、`confidence`、`owner`、`review_due_at`はpolicyで必須化できる
- `review_due_at`を過ぎたnoteはverifiedのまま`stale: true`を付けて返す。正式根拠として使ってよいが、AIは回答時に「要再確認」であることを明示し、citationにも`stale: true`を含める。`strict_stale_filter: true`のときは検索結果から除外する
- `confidence: "high"`なのにsourceが`manual`のみの場合は`weak_source_for_high_confidence`のpolicy_warningを作成時とapprove時に出す。source種別ごとの厳格な承認条件はPhase 2で検討する
- `reviewer`は`created_by`と同一actorにしない。MVPでは警告、将来は強制する
- imported noteは新規なら`draft`、既存verifiedとの差分ならproposalにする
- 承認、却下、archiveはhistory eventとしてactor、reason、timestampを残す

### Update Proposal

既存ノートへの変更案。  
AIは既存ノートを直接上書きせず、必ずproposalを作る。同一noteへの並行proposalは許可する。

主な属性:

- `proposal_id`
- `note_id`
- `proposal_type: update | archive_recommendation`
- `status: pending_review | approved | rejected | needs_rebase`
- `base_note_version`: proposal作成時点のnoteの`version`
- `proposed_title`
- `proposed_summary`
- `proposed_body`
- `proposed_tags`
- `proposed_scope`
- `proposed_confidence`
- `proposed_by`
- `reason`
- `source`
- `diff`
- `changed_fields`
- `created_at`
- `reviewed_by`
- `reviewed_at`
- `rejection_reason`

`needs_rebase`は、対象noteのversionがproposal作成後に変わり、そのままでは適用できなくなった状態。

`proposal_type: archive_recommendation`はPhase 2で`recommend_archive`ツールを導入する際に使う値で、MVPでは`update`のみを生成する。カラム自体はMVPのスキーマに残す。

### History Event

すべての変更履歴。

イベント例:

- `note_created`
- `note_verified`
- `note_rejected`
- `note_resubmitted`
- `note_archived`
- `proposal_created`
- `proposal_approved`
- `proposal_rejected`
- `proposal_needs_rebase`
- `note_exported`
- `note_imported`

各eventには最低限`actor`、`role`、`reason`、`created_at`を残す。  
監査ログUIはMVPでは作らないが、後から監査レポートを生成できる形にしておく。

## Agent-facing MCP Tools

MVPでAIクライアントに公開するMCP toolは、AIが安全に実行できる操作に限定する。  
AIは正式知識を直接承認、archive、上書きしない。

toolは役割ごとに3つのplaneへ分ける。

- **verified plane**（正式根拠として使ってよい）: `search_notes` / `get_note` / `get_registry_overview`
- **contribution plane**（提案系。draftやproposalを作る）: `create_note_draft` / `update_draft` / `propose_note_update`
- **review plane**（レビュー状況の把握。正式根拠としては使わない）: `list_review_items` / `get_review_item`

合計8 tools。`get_note_history`（監査用）と`recommend_archive`（archive推薦）はPhase 2でのMCP公開を検討し、MVPのagent-facing toolには含めない。ノートの変更履歴はCLIの`agentpress history <id>`で人間が確認する。AIが古い知識に気づいた場合は、MVPでは`propose_note_update`で本文修正を提案する。

### 共通仕様

- mutating tool（`create_note_draft` / `update_draft` / `propose_note_update`）はoptionalの`idempotency_key`を受け付ける。同一keyの再実行は新しい副作用を起こさず既存結果を返し、AIのリトライや二重実行を安全にする
- エラーレスポンスは`{code, message, details, retryable, suggested_action}`で統一する
- create/update/proposeのレスポンスには`policy_warnings[]`を含める。形式は`{code, message, suggested_action}`。例: `{code: "missing_source", message: "source is missing", suggested_action: "add at least one source before review"}`。承認時に弾かれそうな不備を作成時点でAIに伝えるためのもので、専用のvalidate/dry-run toolはMVPでは作らない（Phase 2で検討）
- 空diffなど回復不能な入力はwarningではなくerrorにする
- actorはMCP toolの入力では受け取らない。サーバ起動時の設定（env、config、起動引数）で固定する。stdio transportではMCP clientごとにサーバprocessが起動するため、process単位のactor設定で複数agentを識別できる

### get_registry_overview [verified plane]

接続直後のAIクライアントが最初に呼ぶ入口ツール。scope構成、note件数、利用ルールを一度に把握できるようにし、何も知らない状態で`search_notes`を手探りで叩くことを防ぐ。

入力:

```json
{
  "scope": null
}
```

`scope`は省略可。指定した場合はそのscopeだけを返す。

出力:

```json
{
  "schema_version": "1",
  "server_version": "0.1.0",
  "strict_stale_filter": false,
  "scopes": [
    {
      "scope": "analytics",
      "description": "GA4 / BigQuery関連の分析ナレッジ",
      "owner": "data-platform",
      "verified_count": 12,
      "stale_count": 2,
      "top_tags": ["GA4", "BigQuery"],
      "reviewers": ["data-platform"]
    }
  ],
  "usage_policy": "verified のみ正式根拠として使う。stale: true のnoteは要再確認として扱い、回答時にその旨を明示する。関連するverified noteが見つからない場合はcreate_note_draftで新規知識案を提案する。",
  "recommended_first_steps": [
    "get_registry_overview でscope構成とusage_policyを把握する",
    "search_notes で関連知識を検索する",
    "見つからなければcreate_note_draftで提案する"
  ]
}
```

### search_notes [verified plane]

知識ノートを検索する。

入力:

```json
{
  "query": "GA4 セグメント BigQuery",
  "tags": ["GA4"],
  "include_archived": false,
  "limit": 10
}
```

出力:

```json
{
  "results": [
    {
      "id": "note_xxxxx",
      "title": "GA4にユーザーセグメントを連携する方法",
      "summary": "...",
      "status": "verified",
      "confidence": "high",
      "scope": "analytics",
      "owner": "data-platform",
      "updated_at": "...",
      "review_due_at": "...",
      "stale": false,
      "tags": ["GA4", "BigQuery"],
      "matched_fields": ["title", "body"],
      "snippet": "...BigQueryへのセグメント連携は...",
      "citation": {
        "label": "GA4にユーザーセグメントを連携する方法",
        "note_id": "note_xxxxx",
        "version": 3,
        "updated_at": "...",
        "review_due_at": "...",
        "stale": false,
        "confidence": "high",
        "status": "verified"
      }
    }
  ]
}
```

初期実装はSQLiteのLIKE検索でよい。日本語対応を優先し、FTS5(unicode61 tokenizer)は日本語を分かち書きできないためMVPでは採用しない。クエリと対象テキストにはNFKC正規化を適用し、表記ゆれによる検索漏れを減らす。  
`SearchEngine` interfaceを切り、将来FTS5(trigram)やベクトル検索へ差し替える。

入力から`status`は削除し、対象は常に`verified`にする。`archived`はデフォルト除外で、`include_archived: true`のときだけ結果に含める。  
出力の`score`は廃止し、代わりに`matched_fields`（マッチしたフィールド名の配列）と`snippet`を返す。`score`はFTS/vector検索を入れてから復活させる。

citationには`note_id`に加え`version`、`review_due_at`、`stale`を必ず含める。`get_note_history`をMCPから外す代わりに、citationの`note_id + version + updated_at`だけで根拠のバージョンを後から追跡できるようにする。

`review_due_at`を過ぎたnoteは`stale: true`を付けて返す。staleでも正式根拠として使ってよいが、AIは回答時に「要再確認」であることを明示する。`strict_stale_filter: true`の場合は検索結果からstale noteを除外する。

#### 0件時のレスポンス

```json
{
  "results": [],
  "no_results": true,
  "query": "GA4 セグメント BigQuery",
  "scope": "analytics",
  "searched_statuses": ["verified"],
  "guidance": "No verified knowledge found for this query. Do not present external or general knowledge as organizational policy. If you have reliable knowledge to contribute, use create_note_draft.",
  "suggested_next_tools": ["create_note_draft"]
}
```

toolのdescriptionにも、0件時は一般知識を組織のverified contextとして提示せず、確度の高い知識があれば`create_note_draft`で提案する旨を明記する。

### get_note [verified plane]

知識ノートの詳細を取得する。

入力:

```json
{
  "id": "note_xxxxx"
}
```

出力（`verified`）:

```json
{
  "id": "note_xxxxx",
  "title": "...",
  "status": "verified",
  "confidence": "high",
  "summary": "...",
  "body": "...",
  "tags": [],
  "source": [],
  "relations": [],
  "created_at": "...",
  "updated_at": "...",
  "review_due_at": "...",
  "stale": false,
  "citation": {
    "label": "GA4にユーザーセグメントを連携する方法",
    "note_id": "note_xxxxx",
    "version": 3,
    "updated_at": "...",
    "review_due_at": "...",
    "stale": false,
    "confidence": "high",
    "status": "verified"
  }
}
```

`verified`と`archived`のnoteのみ返す。`archived`は本文を返すが、`status: "archived"`と`usage_warning`を必須で付ける。

```json
{
  "id": "note_yyyyy",
  "status": "archived",
  "usage_warning": "This note is archived and no longer recommended as current guidance."
}
```

`draft`または`rejected`のIDを渡した場合はエラーにする。

```json
{
  "code": "not_verified",
  "message": "note_zzzzz is draft, not verified.",
  "details": { "status": "draft" },
  "retryable": false,
  "suggested_action": "use get_review_item"
}
```

### create_note_draft [contribution plane]

AIが新しい知識案を作成する。

入力:

```json
{
  "title": "...",
  "summary": "...",
  "body": "...",
  "tags": [],
  "source": [],
  "reason": null,
  "confidence": "medium",
  "scope": "analytics",
  "idempotency_key": "..."
}
```

必須項目は`title`、`summary`、`body`、および`source[]`か`reason`のどちらか一方以上。

出力:

```json
{
  "id": "note_xxxxx",
  "status": "draft",
  "final_slug": "ga4-user-segment-import",
  "slug_adjusted": false,
  "possible_duplicates": [],
  "policy_warnings": [],
  "message": "Draft note created. Human approval is required before it becomes verified."
}
```

AIが作ったものはいきなり`verified`にしない。slugが既存と衝突する場合はエラーにせず自動で`-2`、`-3`のようなsuffixを付け、`final_slug`と`slug_adjusted: true`を返す。

`possible_duplicates[]`には、title/summaryのLIKE一致上位を`verified`と既存draft横断で返す。各要素は`{id, title, status, matched_fields, suggested_action, suggested_tool}`。作成はブロックせず警告のみとし、重複候補は作成時点で計算してdraftの`metadata_json`に保存する（一覧取得時に再計算しない。承認などで対象noteの状態が変わると古くなりうるため、reviewerは必要に応じて再検索する）。

body/summary/tagsが目安から外れる場合は`policy_warnings`に`body_too_long` / `missing_headings` / `summary_too_short` / `tags_too_sparse`を含める（目安はNote Granularityを参照）。`confidence: "high"`かつsourceが`manual`のみの場合は`weak_source_for_high_confidence`を含める。

### update_draft [contribution plane]

draftまたはrejectedのnoteを編集する。

入力:

```json
{
  "id": "note_xxxxx",
  "title": "...",
  "summary": "...",
  "body": "...",
  "tags": [],
  "source": [],
  "reason": null,
  "confidence": "medium",
  "scope": "analytics",
  "idempotency_key": "..."
}
```

出力:

```json
{
  "id": "note_xxxxx",
  "status": "draft",
  "policy_warnings": [],
  "message": "Draft updated."
}
```

自分（同一actor）が`created_by`のdraftまたはrejectedのnoteのみ編集できる。他人のdraftは編集できない。  
対象が`rejected`の場合は`draft`に戻す（再提出）。historyに`note_resubmitted`イベントを残す。

### propose_note_update [contribution plane]

verified noteへの更新案を作成する。

入力:

```json
{
  "id": "note_xxxxx",
  "base_note_version": 3,
  "proposed_title": null,
  "proposed_summary": null,
  "proposed_body": "...",
  "proposed_tags": null,
  "proposed_scope": null,
  "proposed_confidence": null,
  "reason": "古い記述を更新するため",
  "source": [],
  "idempotency_key": "..."
}
```

対象は`verified`のnote限定。`draft`へのproposalは作れず、対象が`archived`ならエラーになる。  
すべてのfieldはoptionalで、指定したfieldだけをdesired valueとして受け取り、サーバ側で現行noteとの差分を生成する。全field無変更（空diff）はerror。

出力:

```json
{
  "proposal_id": "proposal_xxxxx",
  "note_id": "note_xxxxx",
  "proposal_type": "update",
  "status": "pending_review",
  "base_note_version": 3,
  "diff": "...",
  "changed_fields": ["body"],
  "policy_warnings": [],
  "message": "Update proposal created. Human approval is required before the verified note changes."
}
```

既存ノートは直接上書きしない。同一noteへの並行proposalは許可する。approve時にnoteのversionと`base_note_version`が一致しない場合は`needs_rebase`になる（後述）。  
`create_note_draft`と異なり、`possible_duplicates`は付けない。古い知識を非推奨にしたい場合も、MVPではこのtoolで本文修正を提案する（archive推薦専用のtoolはPhase 2で検討する）。

### list_review_items [review plane]

draft/proposal横断のレビュー一覧を返す。`list_pending_reviews`を置き換える。正式根拠としては使わない。

入力:

```json
{
  "kind": "draft",
  "scope": "analytics",
  "created_by": "self",
  "status": "pending_review",
  "limit": 20,
  "cursor": null,
  "sort": "created_at"
}
```

`kind`は`draft`または`proposal`。`created_by`に`self`を指定すると自分が作ったものだけに絞れる。  
`status`はレビュー系語彙に正規化されている。draft noteは`status: "pending_review"`として返り、元のnote自体のstatus（例: `"draft"`）は`kind: "draft"`の項目にのみ付く`note_status`で確認できる。`status`フィルタの`"pending_review"`はdraft note（`notes.status='draft'`）とpending_reviewなproposalの両方にマッチし、`"rejected"`は却下されたnoteとproposalの両方にマッチする。`"needs_rebase"`はproposalにしか存在しないstatusなので、noteはマッチしない。  
`limit`省略時は20件。結果がちょうど`limit`件返った場合は`next_cursor`に最後の項目のidが入るので、次回呼び出しの`cursor`に渡すと続きを取得できる（`null`なら以降なし。既存の簡易cursor実装のまま、正確な「まだ次があるか」の判定はしない）。

### get_review_item [review plane]

`note_`または`proposal_`のIDから、全文とレビュー状態を返す。正式根拠としては使わない。

入力:

```json
{
  "id": "proposal_xxxxx"
}
```

出力:

```json
{
  "id": "proposal_xxxxx",
  "kind": "proposal",
  "status": "needs_rebase",
  "usable_as_context": false,
  "rejection_reason": null,
  "target_note_id": "note_xxxxx",
  "base_note_version": 3,
  "current_note_version": 4,
  "suggested_action": "fetch current note and resubmit",
  "body": "...",
  "diff": "..."
}
```

レスポンスには必ず`usable_as_context: false`を含め、正式根拠として使わないことを明示する。  
`needs_rebase`のproposalには`base_note_version` / `current_note_version` / `target_note_id` / `suggested_action`を含め、AIが現行verifiedを基準に再提案できるようにする。  
`status`は`list_review_items`と同じ正規化を受ける。`kind: "note"`のときのみ、元のnote自体のstatus（`"draft"`など）を`note_status`で確認できる。`kind: "proposal"`のときは`reason` / `source` / `proposed_by` / `changed_fields`も含み、何がなぜ提案されたかを把握できる。

## Human-only Operations

承認、却下、archive、import/exportはMVPではCLI限定にする。  
MCP client側のpermission approvalには依存しない。MCP toolとして公開する場合は、将来の権限管理または明示的なhuman approval tokenを設計してからにする。

### approve_note

draft noteまたはupdate proposalを承認するCLI操作。

入力:

```json
{
  "target_id": "note_xxxxx or proposal_xxxxx"
}
```

動作:

- draft noteなら`verified`にする
- update proposalなら、noteの現在`version`と`base_note_version`が一致することを検証したうえで対象ノートへ反映する。不一致なら適用を拒否する
- 反映成功時、noteの`version`を+1し、同一noteに対する他のpending proposalがあれば`needs_rebase`に遷移させる
- どちらも履歴を残す

### reject_review

draft noteまたはupdate proposalを却下するCLI操作。

動作:

- draft noteなら`rejected`にし、`note_rejected`履歴を残して承認待ちから外す
- rejected noteは`update_draft`で修正すると`draft`に戻る（再提出）。再提出時は`note_resubmitted`履歴を残す
- update proposalなら`rejected`にする
- 却下理由をhistoryに残す

### archive_note

ノートを`archived`にするCLI操作。

## Required CLI

```bash
agentpress init
agentpress mcp
agentpress list
agentpress list --pending
agentpress search "keyword"
agentpress show <id>
agentpress approve <id>
agentpress reject <id>
agentpress archive <id>
agentpress history <id>
agentpress export
agentpress import
```

CLIは人間が確認、承認、archive、export/importするための薄い操作面にする。  
MVPではWeb UIを作らない。

`agentpress list --pending`はレビュー負債を可視化する主要コマンドと位置づける。scope/kind別の件数サマリ、作成日時の古い順ソート、各行への`policy_warnings`有無・`possible_duplicates`有無のフラグ表示を持たせる。  
`agentpress import`実行時は「新規draft n件 / proposal n件 / スキップ n件」のサマリを表示し、scopeごとに小分けしてレビューするよう案内する。専用のtriageコマンドは作らず、この2コマンドの表示強化で代替する。

## Suggested Project Structure

```text
agentpress/
  README.md
  package.json
  tsconfig.json
  src/
    index.ts
    mcp/
      server.ts
      tools/
        searchNotes.ts
        getNote.ts
        getRegistryOverview.ts
        createNoteDraft.ts
        updateDraft.ts
        proposeNoteUpdate.ts
        listReviewItems.ts
        getReviewItem.ts
    core/
      notes.ts
      reviews.ts
      search.ts
      history.ts
      exportMarkdown.ts
      importMarkdown.ts
    db/
      schema.ts
      client.ts
      migrations.ts
    cli/
      index.ts
    types/
      note.ts
      proposal.ts
  .agentpress/
    agentpress.sqlite
  data/
    notes/
  tests/
```

## Storage Direction

MVPではSQLiteを内部正本にする。Markdownはimport/export可能な永続表現、初期投入形式、人間が読むsnapshotとして扱う。

理由:

- MCP toolからの検索と履歴管理がしやすい
- proposalやhistoryをSQLiteで扱いやすい
- Markdown exportで人間も読める
- 将来managed layerやenterprise deploymentへ伸ばすときにDB中心へ移行しやすい

運用ルール:

- サーバ稼働中の正本は`.agentpress/agentpress.sqlite`。`--data-dir`または`AGENTPRESS_HOME`で変更できる
- SQLiteはWALモードを前提にする。`busy_timeout`を設定し、`foreign_keys=ON`にする
- 書き込みは必ずトランザクションにする。proposal承認はnoteの`version`を検証するoptimistic lockで保護する
- `data/notes/*.md`はexport結果として上書きされうる。ファイル名は`<slug>--<note_id>.md`とする。生成物のため`.gitignore`推奨。追跡する場合はexport結果がAgentPress側でレビュー済みである前提を明記する
- Markdownを直接編集したい場合は、編集後に`agentpress import`で取り込む
- import時に既存verified noteを直接上書きせず、差分がある場合はupdate proposalにする
- import対象が`rejected`の場合はエラーにする。再提出経路は`update_draft`のみに一本化する
- 新規Markdown importはdraftとして取り込むか、`--verified`のような明示オプションを人間CLIにだけ許す
- 「PRレビュー = コード、AgentPressレビュー = ナレッジ」という責務分離を運用の前提にする。コード変更はGit/PRで、ナレッジ変更はAgentPressのdraft/proposalレビューでレビューする

## Initial User and Seed Knowledge

最初のユーザーは、小規模チームや開発者、AI推進担当が、自分たちのローカル環境で運用を始めるケース。  
既存のNotion、Confluence、Google Docs、Slack、GitHub Wikiを置き換えるのではなく、そこから「AIが使ってよいverified context」を選び、承認し、配布する層として始める。

具体像:

- AI推進担当が、社内AI agentに渡す公式前提を整える
- CSチームのレビュアーが、サポート回答agentに使わせるFAQやSOPを承認する
- 開発チームのtech leadが、coding agentに使わせる設計判断、規約、禁止事項を整える
- 情シスやセキュリティ担当が、AIに参照させてよい社内ルールをレビューする

部門ごとのreviewerによる本格的なチーム承認ワークフローは、Phase 2以降の拡張ストーリーとして扱う。role/scopeをデータモデルに持つ方針はMVPから維持し、後から部門単位の運用へ広げられるようにする。

最初に食わせる知識:

- 顧客対応のSOP、FAQ、エスカレーション基準
- 開発チームの設計判断、コーディング規約、レビュー観点
- セキュリティ、情シス、法務、経理の社内ルール
- 障害対応runbook、オンコール手順、リリース手順
- 製品仕様、料金、提供範囲、例外対応の公式説明
- AI agentに守らせたい禁止事項、判断基準、出典つきの回答ルール
- 既存ドキュメントからAI向けに要約、分割、引用可能化した知識

向かない初期投入:

- sourceが曖昧な雑多メモ
- reviewerが決まっていない未整理ドキュメント群
- 頻繁に変わる外部ニュースやWebスクレイピング結果
- 「AIが検索できるだけ」でよく、承認や履歴が不要な大量資料

## ContextNest Research Takeaways

ContextNestは、AI agentが消費するcontextに対して、provenance、version identity、integrity、traceability、point-in-time reconstructionを与える先行仕様として参考になる。  
AgentPressは同じ問題意識を持つが、MVPでは暗号学的に検証可能なvault仕様より、実務で回るreview workflowとOSSとして触りやすいローカル実装を優先する。

取り込む考え方:

- retrieval qualityだけではgovernanceにならない
- AIが読めるのは承認済みのcontext subsetに限定する
- typed Markdown/metadataで、人間にもAIにも扱える知識単位にする
- steward/reviewerという役割を置き、作成者と承認者を分ける
- agentが消費したcontextをあとから追えるようにcitationとhistoryを残す
- context packのように、用途別にverified notesの集合を配布する余地を残す

MVPではやらないこと:

- SHA-256 hash chainやgraph-level checkpoint
- `contextnest://`のような独自URI scheme
- set algebra selector grammar
- MCP toolからのpublish/update/assign steward
- 外部source nodeのlive hydrationとstaging lifecycle
- specification-firstな互換実装エコシステム

棲み分け:

- ContextNest: verifiable context vaultの仕様と参照実装
- AgentPress: 既存社内ナレッジをAI向けverified contextへ変換し、proposal/review/approveで運用するOSSワークフロー

詳細メモは[contextnest-research.md](./contextnest-research.md)に分ける。

## OpenWiki Research Takeaways

OpenWikiは、codebase向けのagent-readable documentationを生成、更新するCLIとして参考になる。  
AgentPressは同じくAI agent向けknowledgeを扱うが、MVPでcodebase documentation generatorを作らない。

取り込む考え方:

- agentが読むためのdocsを人間向けdocsとは別に整備する価値がある
- generated docsはCIで更新し、PR/MRとしてレビューできる
- `AGENTS.md`や`CLAUDE.md`のようなagent instructionから、どのknowledge sourceを見るべきか明示できる
- codebase docsはAgentPressにimportするsourceとして扱える

棲み分け:

- OpenWiki: codebaseからagent-readable docsを生成、更新する
- AgentPress: OpenWiki生成物や既存社内docsをreviewerが承認し、AIが使ってよいverified contextとして配布する

MVPでは、OpenWiki風のcode analysisやdocs generationは範囲外にする。  
将来は`agentpress import openwiki/`のように、OpenWiki生成docsをdraft/proposalとして取り込む導線を検討する。

詳細メモは[openwiki-research.md](./openwiki-research.md)に分ける。

## OSS Strategy

OSS coreで最初に出すもの:

- TypeScript/Node.jsのCLI
- local MCP server
- SQLite storage
- Markdown import/export
- proposal/review/approve workflow
- scope、owner、reviewer、policyの最小設定
- README、example vault、MCP client接続例

最初からSaaSや課金に寄せない。  
この企画の価値は「AIが読む社内ナレッジにmerge権限と履歴を持たせる」というworkflowにあるため、OSSで使える形にして思想と実装を先に広める。

将来の収益余地:

- SSO/RBAC、監査レポート、承認ワークフロー強化
- Notion、Confluence、Google Docs、Slack、GitHubとのconnector
- managed MCP gateway
- context pack配布、利用ログ、stale knowledge検出
- enterprise support、private deployment、compliance向け機能

## Security and Safety

必須の設計方針:

- AIによる直接上書きを禁止する
- 更新はproposalにする
- 承認操作を分離する
- agent-facing MCP toolには承認、archive、importを出さない
- source/citationを保存する
- 人間がCLIで古い知識をarchiveできる
- 履歴を消さない
- prompt injection対策として、ノート本文とツール指示を混同しない
- actor、role、scopeをhistoryに残し、将来のRBAC/監査へ接続できるようにする

MVPでは完全な権限管理は不要。  
ただし、設計上の逃げ道として「AIが勝手にverifiedへ変更できる」経路は作らない。MVPの安全性は、強い認証ではなく、操作境界と履歴で担保する。

## README Requirements

READMEに含める内容:

1. プロダクト説明
2. Verified Context Layerとしての位置づけ
3. WordPress / Headless CMS / RAG / ContextNest / OpenWikiとの違い
4. MVPでできること
5. インストール方法
6. 起動方法
7. MCPクライアントからの接続方法
8. AIクライアント向け利用プロトコル（接続後まず`get_registry_overview`を呼ぶこと、no_results時の挙動、staleの扱い）
9. CLIの使い方
10. データモデル
11. MCP tools一覧
12. 承認フローとrole/scopeの考え方
13. Markdown export/importとGit運用（`data/notes/`は生成物、PRレビューとAgentPressレビューの責務分離）
14. OSSライセンスとコントリビューション方針
15. ロードマップ

## Roadmap

### Phase 1: OSS Local Governed MVP

- ローカルMCPサーバ
- SQLite
- Markdown import/export
- MCP: registry overview/search/read/create draft/update draft/propose update/review status確認（8 tools）
- CLI: approve/reject/archive/import/export
- scope、owner、reviewer、actorの最小モデル
- verified-only searchのデフォルト
- 履歴管理
- example vault同梱
- READMEとexample

### Phase 2: Team Workflow Pack

- policy設定
- scope別reviewer
- due date/stale検出
- context pack
- CLIでのreview queue改善
- import時のproposal生成改善
- lightweight audit export
- `recommend_archive`のMCP公開。`proposal_type: "archive_recommendation"`のproposalをapproveするとarchiveが実行される、という完了semanticsにする
- `get_note_history`のMCP公開
- FTS5(trigram)によるSearchEngine差し替え
- source種別ごとの厳格な承認条件
- policy変更履歴の本格対応

### Phase 3: Connectors and Governance

- ベクトル検索
- 類似ノート検出
- 矛盾検出
- 古い知識の検出
- citation強化
- AI回答用のcontext packaging
- Notion / Confluence / Google Docs / Slack / GitHub connector
- OpenWiki generated docs import
- MCP tool単位のpolicy
- 複数AIクライアント対応

### Phase 4: Enterprise or Managed Layer

- SSO/RBAC
- hosted MCP gateway
- private deployment
- audit/compliance report
- connector management
- usage analytics
- support contract
- AIが使った知識の利用分析
- 知識の鮮度スコア
- ナレッジ運用の半自動化

## Completion Criteria for Implementation MVP

実装に進む場合の完了条件:

- `npm install` できる
- `npm run build` が通る
- `npm test` が通る
- `agentpress init` で初期化できる
- `agentpress mcp` でMCPサーバを起動できる
- MCP toolとして `get_registry_overview` / `search_notes` / `get_note` / `create_note_draft` / `update_draft` / `propose_note_update` / `list_review_items` / `get_review_item` が使える（8 tools）
- CLIからノートの検索、表示、承認、却下、archiveができる
- Markdown export/importができる
- example vaultが同梱され、検索が当たるデモができる
- 全体設計に沿ったservice境界とoperation境界で実装されている
- READMEにOSSとしての思想、使い方、承認フロー、ContextNest/OpenWikiとの違い、ロードマップが書かれている
