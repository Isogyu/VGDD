---
id: T-027
title: ブラウザーのタイトルと /governance の見出しを、VGDD が主役と伝わる形にする
status: ready
requirements: [A0, A1, A2, A3, A4]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-64]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐の指示で行政の長が起草（docs/tasks/drafts/T-draft-vgdd-titles.md）。文字列はオーナーが 01:0x に決めた。立法補佐が Codex の点検を反映して T-027 として起こした（オーナーの承認前）
estimate_h: 0.2
time_limit_min: 20
security_review: false
unattended: false
branch: null
worker: null
files_allowed:
  - src/app/layout.tsx                  # ルートの metadata の2項目だけ
  - src/app/page.tsx                    # / のタブの題（metadata）を足すだけ
  - src/components/GovernanceView.tsx   # 見出しと説明の文だけ
files_forbidden:
  - src/components/WorkScreen.tsx       # / の題材のアプリの中身は変えない
  - src/lib/db/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: []
---

## 1. 目的

作品の主役は VGDD とその可視化（D-64）。今はブラウザーのタブが「つぶやき業務ログ」、`/governance` の見出しが「統治のライブ画面」で、審査員が最初に見る文字から主役が分からない。文字だけを変えて、VGDD が主役で、つぶやき業務ログは題材だと伝える。機能は足さない。審査：デモ25。

## 2. 受け入れ条件

- A0. 差分のファイルは次の3つだけ：`src/app/layout.tsx`、`src/app/page.tsx`、`src/components/GovernanceView.tsx`。それぞれ A1〜A3 の文字列の行（と A2 の `Metadata` の型の import）だけを変える。ほかの処理・見た目のクラスは変えない
- A1. `src/app/layout.tsx` の `metadata` を次の文字列にする。
  - `title`：`VGDD Governance Kernel — AI 開発の統治の可視化`
  - `description`：`AI のチームに開発を任せても、仕様の承認・裁定・停止は人が持つ。役割ごとの権限と承認の条件を実行環境で制御する VGDD Governance Kernel と、その実運用の集計・票の記録・検証結果の可視化。題材はつぶやき業務ログ。`
- A2. `src/app/page.tsx` に `export const metadata: Metadata = { title: "つぶやき業務ログ（VGDD の題材）" }` を足す（`import type { Metadata } from "next"` を1行足す）。`Home` の中身は変えない
- A3. `src/components/GovernanceView.tsx` の見出しの部分を次の文字列にする。
  - `h1`：`VGDD Governance Kernel：統治のライブ画面`
  - `h1` の直下の `p`：`題材のアプリ（つぶやき業務ログ）を AI のチームが開発したときの、実運用の集計・票の記録・検証結果。Kernel の写しは自動で取り直し、ほかの区画は画面を開いた時点のもの（件数とリポジトリの記録だけ。生のログは公開していない）`
- A4. `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る（裁判所の決定論的な監査の結果で確かめる）。新しい試験は足さない（文字列だけの変更で、司法が差分で確かめる）

## 3. 開発用テスト

統合の後に、ユーザー役が次を確かめる。

- `/governance` のタブの題と見出しが A1・A2 のとおり
- `/` の画面の中身が変わっていない。`/` のタブの題は A2 の題、`/governance` のタブの題は A1 の題

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. 文字列を変える
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。`GovernanceView.tsx` は T-025・T-026 も差し込みで触るが、この票が変える行とは離れているので、衝突は想定していない。衝突すれば裁判所が `needs_rebase` で返す。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

Codex の点検（2026-11-07、立法補佐が実行）：「ライブ」は一度だけ取得する区画も含めて言い過ぎ → 見出しはオーナーの決めた文字列のまま、説明の文に「Kernel の写しは自動で取り直し、ほかの区画は画面を開いた時点のもの」を足した。「役割の境界を実行環境で強制」は一部の強制と約束を省く → 「役割ごとの権限と承認の条件を実行環境で制御」に。「本物の運用の記録」→「実運用の集計・票の記録・検証結果」に。

## オーナーに聞くこと

1. A1・A2 の文字列はこれでよいか。文字列は §2 なので、承認の前に決める
2. `/` のタブの題も VGDD の題になる（ルートの metadata は全画面に効く）。`/` だけ「つぶやき業務ログ」に残すなら、`src/app/page.tsx` の形を確かめて票を広げる
3. 作業画面の導線の文字「統治のライブ画面」は、`/` の中身なので変えない。見出しにこの語を残したのは、導線と対応させるため。ただし「ライブ」は、clone で空になる区画や、動画の【記録】の場面と少し合わない。別の語にするなら導線と分かれる

## 点検の記録

**Claude の点検済み、Codex は未点検**（2026-11-07 00:3x）。files_allowed の2つで足り、A1・A2 の行が既存の `layout.tsx:8-9`、`GovernanceView.tsx:144・146` に対応することを確かめた。既存の試験に旧い文字列を見ているものはない（`src` の試験を検索）。
