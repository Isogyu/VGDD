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

- A1. **フォームのラベル**：`ShareReview.tsx` の本文の textarea（L509-515 付近）と stale の分岐の textarea（L476-481 付近）に `aria-labelledby="share-body-heading"` を付け、**両方の分岐の `<h2>共有される本文</h2>`（L474・L507 付近。同時には描画されない）に同じ `id="share-body-heading"`** を付ける。却下の理由の `<input>`（L607-613 付近）に `aria-label="却下の理由"`。`WorkScreen.tsx` L326 付近の `aria-label="入力"` を「つぶやきまたは作業名」に。`ShareRecords.tsx` L124 付近の空の `<th>` に `<span className="sr-only">操作</span>`
- A2. **見出しの階層**：`TeamKnowledge.tsx` の `<h4>`（L94・L104 付近）を `<h3>` に。`ShareReview.tsx` の「AI でも確かめる」の `<section aria-label="AI でも確かめる">`（L568 付近）は **`aria-label` を外し**、先頭に `<h2 className="text-base font-medium">AI でも確かめる</h2>` を置く（見出しの**追加**はこの1箇所だけ。ボタンの文字「AI でも確かめる」と同じ文が見出しにも出る）。中の `<h3>`（L200 付近）はそのまま
- A3. **長い文字列の折り返し**（要素ごとに）：`WorkScreen.tsx` のメモ本文の `<span>{n.body}</span>`（L460 付近）に `min-w-0 break-words whitespace-pre-wrap`／`SessionView.tsx` のメモ本文（L229 付近。既に `whitespace-pre-wrap` あり）に `min-w-0 break-words` を足す／`WorkScreen.tsx` の作業名 `<p>`（L505 付近）、`SessionView.tsx` の作業名 `<h1>`（L152 付近）、ヒントの `<li>`（`WorkScreen.tsx` L431・L437 付近。文は `<li>` 直下の素のテキストなので `<li>` に付ける）、`UnderstandingPanel.tsx` の項目の `<li>`（L90 付近。同じく `<li>` に付ける。新しい要素で包まない）に `break-words`
- A4. **キーボードとコントラスト**：`SessionView.tsx` の根拠ボタン（L281-282 付近）の `onMouseEnter`/`onMouseLeave` と同じ処理を `onFocus`/`onBlur` にも付ける。`WorkScreen.tsx` L482 付近の「✕」（`text-zinc-400 hover:text-red-700`。hover は残す）と `GovernanceView.tsx` L177 付近の件数の `text-zinc-400` を `text-zinc-500` に（`dark:` は `dark:text-zinc-400`）
- A5. **alert の範囲**：`ShareReview.tsx` の `flagged_body` の確認（L626-639 付近。amber）で、`role="alert"` を文の `<p>` だけに付け、ボタンを含む枠は `role="group"` と `aria-label="機密らしい文字列の確認"` に。文・ボタン・色は変えない（`SessionView` の red の枠は T-draft-ui-error-handling で扱う）
- A6. **`maxLength`**（値は点検で確かめた API の上限。作業員は出どころの行を読んで報告に書き、違っていれば止まる）：

  | 要素 | `maxLength` | 出どころ |
  |---|---|---|
  | `WorkScreen.tsx` L321 付近の入力欄（つぶやき。作業名・開始の命令にも使う） | **2000** | `api/sessions/[id]/notes/route.ts` の `body: max(2000)`。作業名 200 字超は API の 400 のまま（この票では扱わない） |
  | `WorkScreen.tsx` L368 付近の textarea `known-field` | 2000 | `api/sessions/route.ts` の `known: max(2000)` |
  | `WorkScreen.tsx` L381 付近の textarea `unknown-field` | 2000 | `api/sessions/route.ts` の `unknown: max(2000)` |
  | `WorkScreen.tsx` L520 付近の**終了時の textarea `end-unknown`**（作業名ではない） | 2000 | `api/sessions/[id]/end/route.ts` の `unknown: max(2000)` |
  | `SessionView.tsx` L306 付近の答えの textarea | 1000 | `api/sessions/[id]/answers/route.ts` の `text: max(1000)` |
  | `UnderstandingPanel.tsx` L211 付近の答えの textarea | 1000 | `api/sessions/[id]/checkin/route.ts` の `text: max(1000)` |

  `src/lib/**`・`src/app/api/**` は変えない（値を部品に数で書く）。`ShareReview.tsx` は既に文字数の表示と事前確認があるので変えない。HTML の `maxLength` と zod の `.max` はともに UTF-16 の長さで数える
- A7. **暗色**：`src/app/globals.css` の既存の `:root { … }` に `color-scheme: light dark;` の1行を足す（select・checkbox・スクロールバーが暗色で白のまま、の対処）。`QuestionDraft.tsx` の textarea（L49 付近）に `dark:border-zinc-600 dark:bg-zinc-900`。`npm run -s test`（既存の試験のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは `files_allowed` の最大9つで、**変更は属性・クラス・見出しのタグ・`maxLength`・CSS の1行、A2 の `<h2>` の1箇所の追加、A1 の `aria-label` の文の変更（「入力」→「つぶやきまたは作業名」）に限る**（ほかの文・条件・振る舞いの変更は差分に含めない）

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

**Claude の点検済み、Codex は未点検**（4:00 から立法補佐が行う）。点検役：Claude のサブエージェント（読み取り専用）。03:2x、この票 6 件（重い 1・中 3・軽 2）。対応：#1 L321 は 2000（notes）、L520 は終了時の textarea で `end` の API → A6 を表に／#2 素のテキストの折り返しは `<li>` に付ける、要素を足さない（A3）／#3 `aria-label` を外す対象は `<section>`、`<h2>` の追加は例外として A7 に（A2）／#4 両方の `<h2>` に同じ `id`（A1）／#5 `GovernanceView` は L177、「✕」の hover は残す（A4）／#6 既存の `:root` に1行（A7）

## 8. オーナーに聞くこと

1. UI の刷新（P5）に含めるか、先に通すか。3票（失敗の扱い → 見た目の1本化 → この票）の順で小さく通す案
2. Lighthouse の実行を README の材料にするか
