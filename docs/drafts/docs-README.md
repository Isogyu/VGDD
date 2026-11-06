# docs/ の地図

> **下書き**（2026-11-07 00:3x、行政の長）。提出の前に `docs/README.md` に移す。リンクは移した後の置き場所を基準に書いた。この引用の枠は、移すときに外す。

文書は4種類あります。**食い違ったら、規範が正です。** 説明と記録は規範を写さず、リンクします。

## 規範（守るもの）

| 文書 | 中身 |
|---|---|
| [`../CLAUDE.md`](../CLAUDE.md) | 憲法。この開発の約束 |
| [`../vgdd/kernel/SPEC.md`](../vgdd/kernel/SPEC.md) | Kernel の規範仕様。§12 は保証できないこと |
| [`../vgdd/kernel/capabilities.json`](../vgdd/kernel/capabilities.json) | 役割と権限の表、不変条件。機械が読む正本 |
| [`../vgdd/schemas/`](../vgdd/schemas/) | 判定と記録の形 |
| [`requirements.md`](requirements.md) | 題材のアプリの要件 |
| [`tasks/README.md`](tasks/README.md) | 票の形式 |

## 説明（理解するためのもの）

| 文書 | 中身 | 読み方 |
|---|---|---|
| [`validation.md`](validation.md) | 主張と証拠の対応、代表例3件 | **最初に読む** |
| [`architecture.md`](architecture.md) | 責務・権限・信頼の境界 | 全体の形を知る |
| [`adoption.md`](adoption.md) | clone でできること、実稼働の準備、ほかの案件に入れる条件 | 自分で試す |
| [`kernel.md`](kernel.md) | 設計方針（ADR）と実装の対応、不変条件の状態 | §3 の合計の行と §4b が現在の状態。ほかの部分に古い数字が残っている |
| [`governance.md`](governance.md) | 統治の設計の詳細 | 11/3 の設計が土台で、冒頭の「設計案」は当時の状態。今の規範は SPEC |
| [`harness.md`](harness.md) | 夜間の運転の設計 | 最初の版は設計案。今の規範は SPEC |
| [`environment.md`](environment.md) | 開発環境と依存の記録 | |

## 運用の記録（起きたこと）

| 記録 | 中身 | 書く主体 |
|---|---|---|
| [`tasks/T-*.md`](tasks/) | 票。§2 が受け入れ条件、§6 が作業・判定・統合の経過 | 立法補佐・行政の長・夜間の代行・裁判所・release |
| [`tasks/_board.json`](tasks/_board.json) | 票の盤 | 裁判所だけ |
| [`governance/summary.json`](governance/summary.json) | 操作の集計（件数だけ） | オーナー |
| `governance/kernel-state.json`・`kernel-invariants.json` | Kernel の状態の表示用ファイル。Git で追跡しないので clone にはない | 裁判所だけ |
| [`../vgdd/kernel/history.json`](../vgdd/kernel/history.json) | 法律の版ごとの公開の要約 | 立法補佐が書き、オーナーの承認で入る |
| [`vgdd-status.md`](vgdd-status.md) | 迂回の検証（V6・V7）の結果。§1 の表には過ぎた予定と古い版の数字が残っている | 行政の長 |
| [`implementation-notes.md`](implementation-notes.md) | 計画からの逸脱と判断 | 行政の長 |
| [`ideas.md`](ideas.md) | 見送った案 | 行政の長 |
| [`vgdd-operations.md`](vgdd-operations.md) | 旧・設計案の初版（履歴。内容は governance.md へ） | — |

証拠ストアと判定の本文は作業フォルダの外にあり、公開していません。

## 下書き（効力なし）

| 場所 | 中身 |
|---|---|
| [`drafts/`](drafts/) | 改正案・点検の結果・夜の作業の記録など |
| [`tasks/drafts/`](tasks/drafts/) | 票の下書き。オーナーが承認するまで作業に使わない |

下書きの主張は、実装の根拠になりません。

---

**点検**：Claude の点検済み、Codex は未点検（2026-11-07 00:3x。この行は移すときに消す）
