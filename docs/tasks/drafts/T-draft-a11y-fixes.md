---
id: T-draft-a11y-fixes
title: アクセシビリティの小修正（フォームのラベル、見出しの階層、長い文字列の折り返し、キーボードの強調、alert の範囲、maxLength、暗色の対応）
status: draft
requirements: [A1, A2, A3, A4, A5, A6, A7]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [P5（UI の刷新）, M8-1]   # 記録用。司法には渡さない
proposal_from: 2026-11-06 02:5x アプリの画面の点検（docs/drafts/review-ui.md の #7・#8・#9（color-scheme）・#10・#12・#13・#14）
estimate_h: 0.8
time_limit_min: 50
security_review: false
unattended: false
branch: null
worker: null
files_allowed:
  - src/app/globals.css                  # color-scheme
  - src/components/WorkScreen.tsx
  - src/components/SessionView.tsx
  - src/components/ShareReview.tsx
  - src/components/ShareRecords.tsx
  - src/components/TeamKnowledge.tsx
  - src/components/UnderstandingPanel.tsx
  - src/components/QuestionDraft.tsx
  - src/components/GovernanceView.tsx
files_forbidden:
  - src/lib/**
  - src/app/api/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-draft-ui-error-handling, T-draft-ui-consistency]
---

## 1. 目的

審査員がキーボードやスクリーンリーダーで触っても分かるように、1〜数行の修正を集める。見た目・文・振る舞いは変えない（属性・クラス・見出しのレベル・`maxLength` の追加だけ）。審査：深さと実行20。

## 2. 受け入れ条件

行番号は `docs/drafts/review-ui.md`（2026-11-06 02:4x の main）のもの。作業員は実際の行を確かめて同じ要素に当てる。

- A1. **フォームのラベル**：`ShareReview.tsx` の本文の textarea（L509-515 付近）と stale の分岐の textarea（L476-481 付近）に `aria-labelledby` で見出し（`<h2>` に `id` を付ける）を結ぶ。却下の理由の `<input>`（L607-613 付近）に `aria-label="却下の理由"`。`WorkScreen.tsx` L326 付近の `aria-label="入力"` を「つぶやきまたは作業名」に。`ShareRecords.tsx` L124 付近の空の `<th>` に `<span className="sr-only">操作</span>`
- A2. **見出しの階層**：`TeamKnowledge.tsx` の `<h4>`（L94・L104 付近）を `<h3>` に。`ShareReview.tsx` の「AI でも確かめる」の `<section>`（L568 付近）に `<h2>` の見出し「AI でも確かめる」を置き、中の `<h3>`（L200 付近）はそのまま（`aria-label` は見出しと重複するので外す）
- A3. **長い文字列の折り返し**：`WorkScreen.tsx` のメモ本文 `<span>{n.body}</span>`（L460 付近）、作業名（L505 付近）、ヒント（L433・L439 付近）、`SessionView.tsx` のメモ本文（L229 付近）と作業名（L152 付近）、`UnderstandingPanel.tsx` の項目の文（L94 付近）に `min-w-0 break-words whitespace-pre-wrap` を付ける（`whitespace-pre-wrap` は本文の要素だけ。作業名・ヒントは `break-words` だけ）
- A4. **キーボードとコントラスト**：`SessionView.tsx` の根拠ボタン（L281-282 付近）の `onMouseEnter`/`onMouseLeave` と同じ処理を `onFocus`/`onBlur` にも付ける。`WorkScreen.tsx` L482 付近の「✕」と `GovernanceView.tsx` L616 付近の件数の `text-zinc-400` を `text-zinc-500` に（`dark:` は `dark:text-zinc-400`）
- A5. **alert の範囲**：`ShareReview.tsx` の `flagged_body` の確認（L626-639 付近。amber）で、`role="alert"` を文の `<p>` だけに付け、ボタンを含む枠は `role="group"` と `aria-label="機密らしい文字列の確認"` に。文・ボタン・色は変えない（`SessionView` の red の枠は T-draft-ui-error-handling で扱う）
- A6. **`maxLength`**：`WorkScreen.tsx` の入力欄（L321 付近）と開始時の textarea 2つ（L368・L381 付近）と作業名（L520 付近）、`SessionView.tsx` の答えの入力（L306 付近）、`UnderstandingPanel.tsx` の答えの入力（L211 付近）に、**API の上限と同じ `maxLength`** を付ける。上限の値は作業員が各 API の zod（`src/app/api/sessions/route.ts`・`[id]/notes/route.ts`・`[id]/answers/route.ts`・`[id]/checkin/route.ts`）を読んで確かめ、報告に「要素 → 値 → 出どころの行」の表を書く（`src/lib/**`・`src/app/api/**` は変えない。値を部品の定数に写す）。`ShareReview.tsx` は既に文字数の表示と事前確認があるので変えない
- A7. **暗色**：`src/app/globals.css` に `:root { color-scheme: light dark; }` を足す（select・checkbox・スクロールバーが暗色で白のまま、の対処）。`QuestionDraft.tsx` の textarea（L49 付近）に `dark:border-zinc-600 dark:bg-zinc-900`。`npm run -s test`（既存の試験のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは `files_allowed` の最大9つで、**変更は属性・クラス・見出しのタグ・`maxLength`・CSS の1行に限る**（文・条件・振る舞いの変更は差分に含めない）

## 3. 開発用テスト

- なし（属性とクラス）。統合の後に、オーナーが Chrome の Lighthouse（アクセシビリティ）を1回走らせ、スコアと指摘の件数を README の材料に

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. 行番号は点検の時点のもの。先に統合される票（失敗の扱い・見た目の1本化）で動くので、要素で探す
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。T-draft-ui-error-handling・T-draft-ui-consistency の統合の後に着手（同じ部品を触るため）。M11・M14（`UnderstandingPanel.tsx`）・M13（`WorkScreen.tsx`）とも順に統合する。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（4:00 から立法補佐が行う）。（この票は点検前）

## 8. オーナーに聞くこと

1. UI の刷新（P5）に含めるか、先に通すか。3票（失敗の扱い → 見た目の1本化 → この票）の順で小さく通す案
2. Lighthouse の実行を README の材料にするか
