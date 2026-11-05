---
id: T-draft-m12-interview-screen
title: M12 先輩インタビューの画面（S-5。質問に1問ずつ答え、終わったら共有候補を確かめて承認・編集して承認・却下）
status: draft
requirements: [A1, A2, A3, A4, A5, A6, A7]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M12（D-44②）, M9-1, M9-2, M9-4, M6-4]   # 記録用。司法には渡さない
proposal_from: 2026-11-06 02:3x 行政の長の下書き（28_night_plan_max.md §1 C-1）。裏側は T-draft-m12-interview-api
estimate_h: 1.0
time_limit_min: 60
security_review: false         # API・DB に触れない。画面だけ
unattended:
branch: null
worker: null
files_allowed:
  - src/components/InterviewPanel.tsx     # 新設：S-5 の本体
  - src/app/interviews/page.tsx           # 新設
  - src/components/WorkScreen.tsx         # 見出しの nav にリンクを1つ足すだけ
files_forbidden:
  - src/lib/**
  - src/app/api/**
  - src/components/ShareReview.tsx
  - src/components/ShareRecords.tsx
  - src/components/TeamKnowledge.tsx
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-draft-m12-interview-api, T-021]
---

## 1. 目的

先輩が作業名を入れて「質問を始める」と、Claude の問いが1つずつ出て、答えを書くと次の問いが出る。5問か AI の「十分です」で終わり、問いと答えから作った共有候補を本人が確かめて、承認・編集して承認・却下する（M9）。承認したものだけがチームの知恵（S-4）に入る。審査：Claude の活用25、デモ25（先輩C の場面）。

## 2. 受け入れ条件

- A1. `/interviews`（`src/app/interviews/page.tsx`。`Suspense` で包み、中身は `InterviewPanel`）。ユーザーは既存の画面と同じく `window.localStorage` の `"tsubuyaki.userId"`（なければ `"newcomer_a"`）を `useEffect` の中で読む。開くと `GET /api/users` でユーザーの `role` を取り、`senior` でなければ「先輩インタビューは先輩のユーザーで開きます（画面上部のセレクタで先輩C を選んでください）」の1行だけを出して、下の操作を出さない。`senior` なら `GET /api/interviews?userId=…` で一覧を取る
- A2. 開始：作業名の入力欄（1〜80 文字、空なら押せない）と「質問を始める」。押すと `POST /api/interviews` を `{ userId, taskName }` で送り、成功したら A3 の問いの画面へ。失敗：403 `not_senior`「先輩のユーザーだけが始められます」、409 `interview_active`「終わっていないインタビューがあります。先に終えるか、下の一覧から続けてください」、400 は「作業名を確かめてください（1〜80文字）」、ほかと通信の失敗は「開始できませんでした」。送信中はボタンを押せない
- A3. 問い：`active` のインタビューを開くと、答えのない turn があればその問いを出し、なければ `POST /api/interviews/<id>/question` を `{ userId }` で呼んで問いを取る（開いたとき・答えを送った後。`done: true` が返れば A4 へ）。問いの下に答えの入力欄（textarea、`n / 280 文字` を表示、0 か 280 超は送れない）と「答える」。押すと `POST /api/interviews/<id>/answer` を `{ userId, turnId, answer }` で送り、成功したら答えた問いと答えを上に並べて次の問いを取る。注意書きを常に2つ：「答えはあなたが承認したものだけがチームに共有されます（人事評価には使いません）」（M9-4）、「個人名・顧客名・金額は書かないでください。機密の検査はパターンによるもので、取りこぼすことがあります」（M6-4）。「ここで終える」ボタン（答えが1件以上あるときだけ押せる）で A4 へ。失敗：503 `provider_unavailable`・422 `schema_violation` は応答の `message`、409 `max_turns` は A4 へ、409 `unanswered_turn` は未回答の問いを出し直す、ほかは「質問を取れませんでした」。送信中は入力とボタンを触れなくする
- A4. 終了と候補：`POST /api/interviews/<id>/finish` を `{ userId }` で送り、応答の `candidate` を表示する。表示は S-3（`ShareReview`）の A3 の 1・2・5・6・6b・7 と同じ規則（注意書き2つ、`draft_body` の textarea、「このまま承認」「編集して承認」「却下（理由は任意）」、`POST /api/shares/<candidate.id>` に `userId` を付けて送る、409 `flagged_body` は `describeFlags(flags)` を出して「このまま承認する」で `confirmFlagged: true` の送り直し、本文が変わったら確認待ちを消す、2000・500 の事前確認、成功したら決定の名前と日時と「共有の記録を見る」（`/shares`））。**抽象化の案（S-3 の A3 の 4）はこの票では出さず**、検出があれば `describeFlags(detectSensitive(body))` の文だけを出す（案の選択は次の票）。`candidate.stale` は常に false なので stale の分岐は作らない。409 `no_answers` は「答えが1件もありません」
- A5. 一覧：`GET /api/interviews` の `interviews` を `id` の降順に、作業名・開始日時（`MM/DD HH:MM`）・状態（`active`＝途中、`ended`＝終了）・問いと答えの件数を表に出す。`active` の行の「続ける」で A3 へ。`ended` の行は `candidate_id` があれば「候補を見る」（`/shares`。S-3 の記録の一覧で決定できる）。0 件なら「まだインタビューはありません」。取得に失敗したら「インタビューの一覧を読めませんでした」
- A6. `src/components/WorkScreen.tsx` の見出しの `<nav aria-label="ほかの画面">`（T-021）の末尾に `next/link` の「先輩インタビュー」→ `/interviews` を1つ足す。それ以外は変えない。`InterviewPanel` は `@/lib/sharing`・`@/lib/interview` を `import type` だけで使い、実行時に import してよい `@/lib` は `sensitive`（`detectSensitive`・`describeFlags`）と `time` だけ。文字列をキーにする辞書は `Map`。`dangerouslySetInnerHTML`・`console`・`localStorage` の書き込み（`tsubuyaki.userId` の読み取りを除く）を使わない
- A7. `npm run -s test`（既存の試験のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは `src/components/InterviewPanel.tsx`（新設）・`src/app/interviews/page.tsx`（新設）・`src/components/WorkScreen.tsx` の3つだけ

## 3. 開発用テスト

- 画面の部品の単体試験は書かない（既存の画面と同じ）。統合の後に、ユーザー役が先輩C で W1 の作業名を入れ、デモモードの問い（fixture）に2問答えて終え、承認し、S-4 で原案の材料が3件になることを確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. 見た目は `ShareReview`・`TeamKnowledge` に合わせる（zinc 系、注意は amber、成功は emerald、問いは sky の枠）
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。T-draft-m12-interview-api の統合の後に着手する。T-021 と `WorkScreen.tsx` が重なるので T-021 の統合の後（済み）。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（Codex は sandbox の中から呼べない。4:00 から立法補佐が行う）。（点検の後に追記）

## 8. オーナーに聞くこと

1. 抽象化の案（M6-3）を S-5 にも出すか（下書きは次の票に分けた。S-3 の `ShareReview` の部品を再利用するなら `ShareReview` を候補 ID で開ける形に変える票が先）
2. デモの筋書きに先輩C のインタビューの場面を入れるか（2:00〜2:40 の S-4 の前に 15 秒）
