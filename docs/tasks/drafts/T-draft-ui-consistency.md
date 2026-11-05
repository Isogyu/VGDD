---
id: T-draft-ui-consistency
title: 画面の見た目の1本化（日時の書式を lib/time に1本、二次ボタンの共通クラス、色の条件・モデル名・句点の統一）
status: draft
requirements: [A1, A2, A3, A4, A5]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [P5（UI の刷新）, M3-2, M4-3]   # 記録用。司法には渡さない
proposal_from: 2026-11-06 02:5x アプリの画面の点検（docs/drafts/review-ui.md の #4・#6・#11）
estimate_h: 0.7
time_limit_min: 45
security_review: false
unattended: false
branch: null
worker: null
files_allowed:
  - src/lib/time.ts
  - src/lib/time.test.ts                 # なければ新設
  - src/components/ShareReview.tsx       # formatDateTime を消して lib/time に
  - src/components/TeamKnowledge.tsx     # formatMmDdHm を消して lib/time に
  - src/components/GovernanceView.tsx    # formatTs を消して lib/time に
  - src/components/SessionView.tsx       # 色の条件・モデル名・句点
  - src/components/WorkScreen.tsx        # 主ボタンの色・句点
  - src/components/CopyButton.tsx        # 二次ボタンのクラス、aria-live の位置
  - src/components/QuestionDraft.tsx     # 二次ボタンのクラス
files_forbidden:
  - src/lib/sessions.ts
  - src/lib/sharing.ts
  - src/app/**
  - src/components/UnderstandingPanel.tsx
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-draft-ui-error-handling]
---

## 1. 目的

日時の書式が3系統（`11/3 13:05`・`11/03 13:05`・`11/03`）で同じ画面でも不一致、二次ボタンの見た目がリンクとそろわない、前回との差の色の条件が画面で違う、モデル名が固定文、句点の有無が混在。見た目を1本にして、審査員が触ったときの違和感を減らす。審査：デモ25、深さと実行20。

## 2. 受け入れ条件

- A1. `src/lib/time.ts` の `formatMdHm(iso)` の書式を **`MM/DD HH:MM`（月・日・時・分をゼロ埋め2桁。例 `11/03 13:05`）** に変える（今は `11/3 13:05`）。JST の ISO 文字列（`+09:00`）を受け取り、`Date` にできない文字列は「—」を返す。あわせて `formatMd(iso)`（`MM/DD`）を export する。`src/lib/time.test.ts` に：①`"2026-11-03T13:05:00+09:00"` → `"11/03 13:05"` ②1桁の月日時分がゼロ埋め ③不正な文字列 → `"—"` ④`formatMd` → `"11/03"`。既存の `time.test.ts` の `it(` があれば期待値だけを新しい書式に変える
- A2. 部品の中の日時の整形の**複製を消し**、`@/lib/time` の `formatMdHm`・`formatMd` を使う：`ShareReview.tsx` の `formatDateTime`（L35-38 付近）、`TeamKnowledge.tsx` の `formatMmDdHm`（L21-23 付近）、`GovernanceView.tsx` の `formatTs`（L34-37 付近。`MM/DD` の表示は `formatMd`）。`ShareReview` の `formatDateTime` は `ShareRecords.tsx` から import されているので、`ShareReview.tsx` から **同じ名前で `formatMdHm` を re-export**（`export { formatMdHm as formatDateTime } from "@/lib/time"`）して `ShareRecords.tsx` は変えない。`@/lib/time` は DB を読まないので実行時に import してよい
- A3. 二次ボタンの共通クラス：`CopyButton.tsx`（L45 付近）と `QuestionDraft.tsx`（L31 付近）の `<button>` に、`SummaryActions.tsx` の「チームに共有する」Link と同じクラス `rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800` を付ける。`CopyButton` の `aria-live` は `<button>` から外し、通知の文を隣の `<span role="status">` に出す（文は変えない）
- A4. 一貫性：(a) `SessionView.tsx` の前回との差の色（L156 付近）を `WorkScreen.tsx`（L576-578 付近）と同じ条件（差が負のときだけ emerald、正は zinc）に (b) `SessionView.tsx` L161 付近の固定文「AI：Claude（Sonnet 5.5）」を、`data.summary.model` から組む（`demo` なら「保存済みの AI 出力（デモ）」、それ以外は「AI：<model>」。L241 付近の既存の表示と同じ規則）(c) 主ボタンの色を `bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300` に統一（`WorkScreen` の `bg-zinc-800/dark:bg-zinc-200` をこれに）(d) 画面の文の句点：**1文の通知・注意・失敗の文は句点なし**に統一（`WorkScreen` L146・L427・L554、`SessionView` L178・L186・L304、`ShareReview` L225・L228 付近の末尾の「。」を消す。2文以上の文の中の「。」は残す）
- A5. `npm run -s test`（既存の試験のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは `files_allowed` の最大9つ。`ShareRecords.tsx`・`UnderstandingPanel.tsx` は変えない

## 3. 開発用テスト

- `time.test.ts`：A1 の観点。画面はユーザー役が統合の後に、S-2・S-3・S-4・`/governance` の日時が同じ書式になっていることを確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. 書式の変更（A1）は履歴・S-2・統治の画面の日時の見え方を変える（`11/3` → `11/03`）。要件の `MM/DD HH:MM` に合わせる
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。`WorkScreen.tsx`・`SessionView.tsx`・`ShareReview.tsx` を触る票と重なるので、T-draft-ui-error-handling の統合の後に着手し、M13・M14・M12 の画面の票とは順に統合する。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（4:00 から立法補佐が行う）。（この票は点検前。行番号は review-ui.md のもの、02:4x の main）

## 8. オーナーに聞くこと

1. UI の刷新（P5、11/7）に含めるか、先に通すか
2. 日時の書式を `11/03 13:05`（ゼロ埋め）に統一してよいか（履歴の表示が変わる）
