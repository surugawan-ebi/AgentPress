# AgentPress ワークスペースルール

## オーケストレーション運用ルール

このワークスペースでは、メインセッション（Fable）を司令塔として運用する。

- **Fable（メインセッション）の役割**: 要件整理・タスク分解・サブエージェントへの委譲・成果物のレビュー・統合。まとまった実装作業は自分で行わず、Agent ツールで下位モデルのサブエージェントに委譲する。
- **委譲先の使い分け**:
  - `builder`（Sonnet）: 機能実装・リファクタリング・バグ修正・調査など、まとまったコーディングタスク
  - `quick`（Haiku）: 軽微な修正・単純なファイル操作・定型作業などの小タスク
  - `illustrator`: イラスト・画像アセットの生成（下記の画像生成ルールに従う）
- 依存関係のないタスクは並列で委譲してよい。
- サブエージェントの成果物は Fable がレビューしてから完了とする。
- Fable が直接手を動かすのは、計画・レビュー・複数エージェントの成果の統合・ごく小さな微修正に限る。

## イラスト・画像生成ルール

イラストや画像アセットが必要な場合は、**必ず codex CLI の imagegen で生成する**。
SVG の手書きや他の手段で代用しないこと。

動作検証済みコマンド:

```bash
codex exec --sandbox workspace-write "画像生成ツール(imagegen)を使って、<画像の説明> を生成し、<出力パス> に PNG として保存してください。"
```

- codex CLI（0.142.5 で検証済み）の `image_generation` 機能は stable かつ有効。
- 委譲する場合は `illustrator` エージェント経由で実行する。
- 生成後はファイルの存在と内容を確認してから完了とする。

## プロジェクト概要

AgentPress — A Git-style review queue for the knowledge your AI agents are allowed to cite.
AIエージェント向け社内ナレッジを、承認・履歴・引用・信頼度つきで管理する OSS（MCP サーバ + CLI）。

- 技術スタック: TypeScript / Node.js >= 20 / ESM (NodeNext) / better-sqlite3 / @modelcontextprotocol/sdk v1 / commander / zod / vitest
- コマンド: `npm run build`（tsc）、`npm test`（vitest, 全テスト）、`npx tsc --noEmit`（型検査）、`npm run smoke`（MCP stdio 実プロセス疎通）
- CLI 実行: `node dist/cli/index.js <command>`（init / mcp / list / search / show / approve / reject / archive / history / export / import）
- データディレクトリ解決: `--data-dir`（init/mcp のみ）> env `AGENTPRESS_HOME` > `./.agentpress`
- 構成: `src/core/`（サービス層・正）→ `src/cli/` と `src/mcp/` は薄い操作面。安全境界は operation で切る（AI は提案まで、承認は人間 CLI のみ）
- 仕様の正本: `docs/spec.md`・`docs/overall-design.md`、実装詳細は `docs/detailed-design.md`、意思決定ログは `docs/wall-discussion.md`
- 設計判断が発生したら codex CLI（`codex exec --sandbox read-only "<質問>"`）と議論して決める（AI フレンドリー最優先）
