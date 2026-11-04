---
id: T-007
title: S-1 の途中整理の結果にも「先輩への質問文を下書き」を置く（M10-2 の S-1 側）
status: review
requirements: [A1, A2, A3]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M10-2, M10-3, M10-1]   # 関連する docs/requirements.md の ID（記録用。司法には渡さない）
proposal_from: M10（要件 §5。T-005・T-006 を並行にするために分けた後始末の票）
estimate_h: 0.2
time_limit_min: 20
branch: worktree-agent-ad7e0ef6b8219ca60   # 作業員の元のブランチ（3a5a650）。申請は main 追従のため cherry-pick したブランチ（§6）
worker: W1
files_allowed:
  - src/components/UnderstandingPanel.tsx      # T-005 の部品に、T-006 の部品を1つ置く
files_forbidden:
  - src/components/QuestionDraft.tsx           # T-006 の部品。そのまま使う
  - src/components/WorkScreen.tsx
  - src/components/SessionView.tsx
  - src/components/SummaryActions.tsx
  - src/lib/**
  - src/app/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/requirements.md
  - docs/tasks/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-004, T-005, T-006]
---

## 1. 目的

M10-2 は「M4 **または M10-1** の『人に確認すべきこと』から」下書きを作る。S-2 側は T-006 で置くので、S-1 の途中整理の結果（T-005 の `UnderstandingPanel`）にも同じ部品を置く。T-005 と T-006 を並行にするために分けた、小さな後始末の票。

## 2. 受け入れ条件

- A1. `UnderstandingPanel` は、途中整理の結果（4区分）の下・「原案です…」の注意の上に `<QuestionDraft summary={result.summary} notes={notes} session={session} />` を描く。`QuestionDraft` の props は T-006 の形（`summary`・`notes`・`session`）のまま。結果がないとき・整理中は描かない
- A2. T-004 の応答に含まれる `summary`（`Summary` 型）を部品の state に持つ（T-005 の応答の型に `summary: Summary` を足す。`Summary` 型は `@/lib/summary-schema` から **型だけ** import する）。ほかの動き（ボタン・4区分・質問・確認）は変えない
- A3. `npm run -s test`（既存のテストを変えない）・`npm run -s typecheck`・`npm run -s lint` がすべて通る。差分は `files_allowed` の1ファイルだけ

## 3. 開発用テスト

- テストは書かない（画面の描画）。ユーザー役が統合後に、S-1 の途中整理 → 下書き → 警告（顧客名を含むメモ）を確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回
2. `import QuestionDraft from "@/components/QuestionDraft"`、`import type { Summary } from "@/lib/summary-schema"`。応答の型に `summary: Summary` を足し、結果の描画の末尾に部品を置く
3. コミットは1つ。メッセージの先頭は `T-007: `

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。要件は `requirements_source: ticket` により **main にコミット済みのこの票の §2（A1〜A3）**。**T-004・T-005・T-006 の統合後**に着手する（`depends_on`）。

## 6. 記録

（統合後に行政の長が追記）
- 21:52 立法補佐（Pro）が §2 の受け入れ条件を確認（関数名・応答の形・判定の順・テスト件数まで具体的で検証できる。T-004〜T-006 の files_allowed は重ならない。T-007 は T-004〜T-006 の後）。main に固定（D-49②）
- 22:55 W1 起動（worktree `agent-ad7e0ef6b8219ca60`、main ec9c139 から）。22:56 コミット 3a5a650（1ファイル、+6/−1）。報告：test 123（変更なし）・typecheck・lint 合格。整理中（busy）は下書きを描かない。気づき：`QuestionDraft` は Fragment を返すので `flex-col` の中でボタンが横幅いっぱいに見える可能性（見た目の調整は別の票）。Co-Authored-By は作業員が自分のモデル名（Opus 5.5）にした。拒否なし
- 23:08 行政の長が差分を確認（`UnderstandingPanel.tsx` のみ、A1〜A3）。`status: review` で main にコミット。新しい worktree で 3a5a650 を main の上に cherry-pick して申請（T-008 とは別のブランチ。鎖にしない。オーナーの指示。T-008 の統合後は「main を含まない」になるため、統合キュー p0.3.1 の施行か積み直しが要る）
