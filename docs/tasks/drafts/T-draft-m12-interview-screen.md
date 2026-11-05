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

- A1. `/interviews`（`src/app/interviews/page.tsx`。`Suspense` で包み、中身は `InterviewPanel`）。ユーザーは既存の画面と同じく `window.localStorage` の `"tsubuyaki.userId"`（なければ `"newcomer_a"`）を `useEffect` の中で読む。開くと `GET /api/users`（応答 `{ users: [{ id, display_name, role }] }`。**作業員は最初に `role` が応答に入っていることを `src/lib/db.ts` の `listUsers` で確かめ、入っていなければ止まって報告する**）でユーザーの `role` を取り、`senior` でなければ「先輩インタビューは先輩のユーザーで開きます（画面上部のセレクタで先輩C を選んでください）」の1行だけを出して、下の操作を出さない。取得に失敗したら「ユーザーの情報を読めませんでした」の1行だけ。`senior` なら `GET /api/interviews?userId=…` で一覧を取る。画面の先輩の判定は**表示の都合だけ**で、実効の認可（役割・所有）は API 側（T-draft-m12-interview-api の A3）が DB で確かめる
- A2. 開始：作業名の入力欄（1〜80 文字、空なら押せない）と「質問を始める」。押すと `POST /api/interviews` を `{ userId, taskName }` で送り、成功したら A3 の問いの画面へ。失敗：403 `not_senior`「先輩のユーザーだけが始められます」、409 `interview_active`「終わっていないインタビューがあります。先に終えるか、下の一覧から続けてください」、400 は「作業名を確かめてください（1〜80文字）」、ほかと通信の失敗は「開始できませんでした」。送信中はボタンを押せない
- A3. 問い：`active` のインタビューを開くと、答えのない turn があればその問いを出し、なければ `POST /api/interviews/<id>/question` を `{ userId }` で呼んで問いを取る（開いたとき・答えを送った後。`done: true` が返れば A4 へ）。問いの下に答えの入力欄（textarea、`n / 280 文字` を表示、0 か 280 超は送れない）と「答える」。押すと `POST /api/interviews/<id>/answer` を `{ userId, turnId, answer }` で送り、成功したら答えた問いと答えを上に並べて次の問いを取る。注意書きを常に2つ（この文のとおり。S-3 と共通化せずこの部品に書く）：「答えはあなたが承認したものだけがチームに共有されます（人事評価には使いません）」（M9-4）、「個人名・顧客名・金額は書かないでください。機密の検査はパターンによるもので、取りこぼすことがあります」（M6-4）。「ここで終える」ボタン（答えが1件以上あるときに押せる）で A4 へ。**答えが 0 件で `ai_done`・`max_turns` になったときは「終える（候補は作りません）」を押せる**（API は `candidate: null` を返す。画面は「答えが1件もないので候補は作りませんでした」と出して A5 へ戻る）。失敗（HTTP と `error` の組は T-draft-m12-interview-api の A6 の対応表のとおりで、組が合うときだけ固有の文）：503 `provider_unavailable`・422 `schema_violation` は応答の `message`、409 `max_turns`・`ai_done` は「質問は終わりです。下の『ここで終える』で候補を作ってください」と出して「ここで終える」だけを押せるようにする、409 `unanswered_turn` は `GET /api/interviews` を読み直して未回答の問いを出し直す、409 `interview_ended` は A5 の一覧へ戻る、403 `not_your_interview`・404 `interview_not_found` は「このインタビューは開けません」、ほかの応答と通信の失敗は「質問を取れませんでした」。送信中は入力とボタンを触れなくする。**AI による答えの書き直し・要約は呼ばない**（API にもそのような経路はない）
- A4. 終了と候補：`POST /api/interviews/<id>/finish` を `{ userId }` で送り、応答の `candidate`（`ShareCandidate`。`null` なら A3 の文）を表示する。**A4 の表示は `ShareCandidate` を入力にする**（finish の応答からも、A5 の一覧からも開けるように）。表示は S-3（`docs/tasks/T-014-share-review-screen.md` の §2 A3 の 1・2・5・6・6b・7）と同じ規則で、**`@/components/ShareReview` が export 済みの関数（`decideFailureMessage`・`errorName`・`SEND_FAILURE`・`formatDateTime`・`decisionName` 等。`ShareRecords.tsx` が同じものを import している）は import してよい（`ShareReview.tsx` は編集しない）**：注意書き2つ（**本票 A3 の文。T-014 の文には合わせない**）、`draft_body` の textarea（初期値は `candidate.draft_body`）と「原文のメモは共有されません」、「このまま承認」（textarea が `draft_body` と同じときだけ。`action: "approve"`）「編集して承認」（違うときだけ。`action: "edit_approve"`、`body`）「却下」（理由は任意。`action: "reject"`、`reason`）、どれも `POST /api/shares/<candidate.id>` に `userId` を付けて送る、409 `flagged_body` は `describeFlags(flags)` を出して「このまま承認する」で同じ `candidate.id`・`action`・`body` に `confirmFlagged: true` を付けて送り直す、本文が変わったら確認待ちを消す、送る前に本文 0 か 2000 超・理由 500 超は押せない、409 `already_decided`・400 `empty_body`・`body_too_long`・`reason_too_long`・403 `not_your_share` は T-014 A3-6 と同じ文、ほかは「送信できませんでした。もう一度試してください」、成功したら決定の名前（このまま承認／編集して承認／却下）と日時と「共有の記録を見る」（`/shares`）。**抽象化の案（S-3 の A3 の 4）はこの票では出さず**、検出があれば `describeFlags(detectSensitive(body))` の文だけを出す（案の選択は次の票）。`candidate.stale` は常に false なので stale の分岐は作らない
- A5. 一覧：`GET /api/interviews` の `interviews`（API の形 `{ id, user_id, task_name, status, ai_done, started_at, ended_at, candidate_id }`）を `id` の降順に、作業名（`task_name`）・開始日時（`started_at` を既存の画面と同じ `formatMdHm`（`@/lib/time`）で）・状態（`status` が `active`＝途中、`ended`＝終了）・問いと答えの件数（`turns` の件数と、そのうち `answer` が `null` でない件数を「2 問・2 答」の形）を表に出す。応答の `turns` は **`Object.entries` を `Number(key)` と `Array.isArray(value)` で検査して `Map<number, InterviewTurn[]>` に写し、元のオブジェクトを索引・マージしない**。`active` の行の「続ける」で A3 へ。`ended` の行で `candidate_id` があれば「候補を見る」：`GET /api/shares?userId=…` の `records` から `id === candidate_id` の候補を取り、**`pending` なら A4 をその候補で開く**（未決定のインタビューの候補を決定できる唯一の画面。`/shares` には未決定の操作がない）、決定済みなら決定の名前と「共有の記録を見る」（`/shares`）。0 件なら「まだインタビューはありません」。取得に失敗したら「インタビューの一覧を読めませんでした」
- A6. `src/components/WorkScreen.tsx` の見出しの `<nav aria-label="ほかの画面">`（T-021）の末尾に、既存の3つと同じ書き方（`underline-offset-2 hover:underline`）で `next/link` の「先輩インタビュー」→ `/interviews` を1つ足す。`nav` の `aria-label`・既存の3つのリンクの順と文・それ以外は変えない。`InterviewPanel` は `@/lib/sharing`・`@/lib/interview` を `import type` だけで使い、実行時に import してよい `@/lib` は `sensitive`（`detectSensitive`・`describeFlags`）と `time`（`formatMdHm`）だけ。`@/components/ShareReview` の export 済みの関数は import してよい（A4）。文字列をキーにする辞書は `Map`。`dangerouslySetInnerHTML`・`console`・`localStorage` の書き込み（`tsubuyaki.userId` の読み取りを除く）を使わない
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

**Claude の点検済み、Codex は未点検**（Codex は sandbox の中から呼べない。4:00 から立法補佐が行う）。点検役：Claude のサブエージェント（ツールなし）。02:3x、2票あわせて指摘 12 件。この票への対応：#10 `/api/users` の `role` を作業員が確かめる条件と失敗の文、画面の判定は表示だけで実効は API と明記（A1）／#11 注意書きの文を票に書く、AI の書き直しを呼ばないと明記、S-3 の規則を票のパスと一緒に写す（A3・A4）／#12 エラーの対応表は API の票を参照し、画面で要る `max_turns`・`ai_done`・`unanswered_turn`・`interview_ended`・`not_your_interview` の文を足す、一覧の列の出どころ（`started_at`・`turns[id]`）を明記、nav の `aria-label` と既存のリンクを変えない（A5・A6）

**2回目の点検**（Claude のサブエージェント、読み取り専用）。03:2x、この票 6 件（major 2・minor 4）。対応：#1 未決定のインタビュー候補を決定できる画面がない → A5 の「候補を見る」で `GET /api/shares` から候補を取り `pending` なら A4 を開く、A4 の入力を `ShareCandidate` に／#2 答え 0 件の出口 → 「終える（候補は作りません）」と `candidate: null` の文（A3）／#3 `turns` の受け取りを Map に（A5）／#4 日時は `formatMdHm`（A5）／#5 注意書きは本票の文と明記（A4）／#6 `ShareReview` の export 済みの関数は import してよい（A4・A6）

## 8. オーナーに聞くこと

1. 抽象化の案（M6-3）を S-5 にも出すか（下書きは次の票に分けた。S-3 の `ShareReview` の部品を再利用するなら `ShareReview` を候補 ID で開ける形に変える票が先）
2. デモの筋書きに先輩C のインタビューの場面を入れるか（2:00〜2:40 の S-4 の前に 15 秒）
