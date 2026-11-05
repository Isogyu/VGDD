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
  - src/lib/time.test.ts                 # 新設
  - src/lib/db.test.ts                   # formatMdHm の期待値 1 行だけ（L43）
  - src/lib/summary-markdown.test.ts     # 日時の期待値 2 行だけ（L62・L65）
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

- A1. `src/lib/time.ts` の `formatMdHm(iso: string)` の書式を **`MM/DD HH:MM`（月・日・時・分をゼロ埋め2桁。例 `11/03 13:05`）** に変える（今は `11/3 13:05`）。判定は**形の検査**：先頭が `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}` に合わなければ「—」を返す（`Date` は使わない。今の「文字列を切る」の方針のまま。`+09:00` も `+0900`（統治の記録の `ts` の形）も同じ先頭なので通る）。引数の型は `string` のまま。`src/lib/time.test.ts`（新設）に：①`"2026-11-03T13:05:00+09:00"` → `"11/03 13:05"` ②1桁の月日時分がゼロ埋め（`"2026-01-05T09:07:00+09:00"` → `"01/05 09:07"`）③`"abc"`・`""` → `"—"` ④`"2026-11-03T20:28:02+0900"` → `"11/03 20:28"`。**既存の期待値を新しい書式に変える 3 行**：`src/lib/db.test.ts` L43 付近（`"11/3 09:07"` → `"11/03 09:07"`）、`src/lib/summary-markdown.test.ts` L62・L65 付近（`"11/3 13:05"` → `"11/03 13:05"`）。それ以外の `it(` と期待値は変えない。注：`summaryToMarkdown`（Markdown のコピー）の開始の行も `11/03` になる（画面だけでなく出力も変わる）
- A2. 部品の中の日時の整形の**複製を消し**、`@/lib/time` の `formatMdHm` を使う：`TeamKnowledge.tsx` の `formatMmDdHm`（L21-23 付近）と `GovernanceView.tsx` の `formatTs`（L34-40 付近。`tsToMs` も含む）を消して `formatMdHm` に（`GovernanceView` は既に `formatMdHm` を import 済み）。`ShareReview.tsx` の `formatDateTime(iso: string | null)`（L35-38 付近）は **`ShareRecords.tsx` が import し、`decisionTime(c)` の `string | null` を渡す**ので、名前と引数の型を残して中身を1行の包みにする：`export function formatDateTime(iso: string | null): string { return iso ? formatMdHm(iso) : ""; }`（`null` は今までどおり `""`。`ShareRecords.tsx` は変えない）。`@/lib/time` は DB を読まないので実行時に import してよい
- A3. 二次ボタンの共通クラス：`CopyButton.tsx`（L45 付近）と `QuestionDraft.tsx`（L31 付近）の `<button>` に、`SummaryActions.tsx` の「チームに共有する」Link と同じクラス `rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800` を付ける（`self-start` は付けない）。`CopyButton` は**ボタンの文字を常に `label`** にし、`aria-live` を `<button>` から外して、**常に描画する**隣の `<span role="status" className="text-xs text-zinc-500">` に `message` を出す（live region は更新の前から DOM に要る。2つの文字列は変えない）
- A4. 一貫性：(a) `SessionView.tsx` の前回との差の色（L156 付近）を `WorkScreen.tsx`（L575-578 付近）と同じ条件（`delta_min < 0` のときだけ emerald、それ以外は zinc）に (b) `SessionView.tsx` L161 付近の AI の表示を3分岐に：`data.provider === "demo"` なら今の文「デモモード：保存した AI 出力を表示しています（API キーなし）」のまま、それ以外で `data.summary?.model` があれば「AI：<model>」、なければ「AI：Claude」（固定の「Claude（Sonnet 5.5）」を消す）(c) 主ボタンのクラスを `bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300` に統一する対象：`WorkScreen.tsx` L330・L410・L531 付近、`SessionView.tsx` L188・L251・L329 付近（`disabled:opacity-50`・`self-start`・`py-2` などほかのクラスは残す）。`ShareReview.tsx` L601 付近は hover の2つだけ足す。`UnderstandingPanel.tsx` は別の票（M14・M11 の後）(d) 句点：次の **8 箇所の文末の「。」だけ**を消す（文中の「。」は残す。変更前後の文を作業員が報告に列挙する）：`WorkScreen.tsx` L146・L427・L554、`SessionView.tsx` L178・L186・L304、`ShareReview.tsx` L225・L228 付近。L146 は依存の票（T-draft-ui-error-handling）で `{ kind, text }` の形に変わっているので `text` の文末を消す
- A5. `npm run -s test`（既存の試験のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは `files_allowed` の最大 11 で、`db.test.ts`・`summary-markdown.test.ts` の差分は期待値の 3 行だけ。`ShareRecords.tsx`・`UnderstandingPanel.tsx`・`PreviousSummary.tsx` は変えない

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

**Claude の点検済み、Codex は未点検**（4:00 から立法補佐が行う）。点検役：Claude のサブエージェント（読み取り専用）。03:2x、この票 8 件（重い 2・中 5・軽 1）。対応：#1 `formatMdHm` の既存の期待値は `db.test.ts`・`summary-markdown.test.ts` にある → `files_allowed` に足し、変える 3 行を明記、Markdown の出力も変わると注記（A1・A5）／#2 `formatDateTime` は `string | null` を受けて `""` を返す → re-export でなく1行の包み（A2）／#3 「`Date` にできない」の判定 → 形の検査、`+0900` の試験④（A1）／#4 `formatMd` の使い手がない → 外した（A1・A2）／#5 句点の規則と列挙の不一致 → 8 箇所の文末だけ（A4(d)）／#6 主ボタンの対象を列挙（A4(c)）／#7 AI の表示は `provider === "demo"` の3分岐（A4(b)）／#8 CopyButton の文字は常に `label`、span は常に描画（A3）

## 8. オーナーに聞くこと

1. UI の刷新（P5、11/7）に含めるか、先に通すか
2. 日時の書式を `11/03 13:05`（ゼロ埋め）に統一してよいか（履歴の表示が変わる）
