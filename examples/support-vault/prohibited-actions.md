---
title: "対応禁止事項"
summary: "サポート担当およびAIエージェントが問い合わせ対応時に行ってはならない行為を列挙する。"
tags:
  - 禁止事項
  - support
  - compliance
scope: support
owner: cs-team
confidence: high
source:
  - type: manual
    title: "CSチームコンプライアンス方針"
  - type: url
    title: "情報セキュリティ基本方針"
    url: "https://wiki.example.com/security/basic-policy"
---
# 概要

サポート担当・AIエージェントが問い合わせ対応時に行ってはならない行為をまとめる。

# 正本回答

- 承認されていない返金額・値引き・特例を独断で約束しない
- 他の顧客の個人情報や注文内容を伝えない
- verified化されていないdraftやproposalの内容を正式回答として顧客に伝えない
- 社内システムのエラーメッセージやログをそのまま顧客に転送しない
- 「わからない」場合に推測で回答せず、エスカレーション基準に従って引き継ぐ

# 注意点

AIエージェントは本ノートのようなverified noteの禁止事項を必ず順守し、
根拠が無い場合はcreate_note_draftで提案するに留め、顧客への回答には使わない。
