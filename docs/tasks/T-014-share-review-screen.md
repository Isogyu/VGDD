---
id: T-014
title: S-3 共有候補の確認の画面（承認・編集して承認・却下、抽象化の案、記録と取り下げ。M9・M6-3 の画面）
status: ready
requirements: [A1, A2, A3, A4, A5, A6, A7]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M9-1, M9-2, M9-4, M9-5, M6-3, M6-4, D-56]   # 記録用。司法には渡さない
proposal_from: 2026-11-05 昼の進め方。T-010（M9 の裏側）・T-011（M6-3 の裏側）の画面
estimate_h: 1.2
time_limit_min: 75
security_review: false         # API・DB に触れない。画面だけ
unattended: false
branch: null
worker: null
files_allowed:
  - src/components/SummaryActions.tsx      # 「チームに共有する」への導線を1つ足すだけ
  - src/components/ShareReview.tsx         # 新設：S-3 の本体
  - src/components/ShareRecords.tsx        # 新設：本人の共有の記録と取り下げ
  - src/app/sessions/[id]/share/page.tsx   # 新設
  - src/app/shares/page.tsx                # 新設
files_forbidden:
  - src/lib/**
  - src/app/api/**
  - src/components/SessionView.tsx
  - src/components/WorkScreen.tsx
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-010, T-011]
---

## 1. 目的

作業の整理結果（S-2）から、本人が「チームに共有する要約」を確かめ、機密の検出箇所は抽象化の案を選んで置き換え、**そのまま承認／編集して承認／却下**を選べる画面（S-3）と、本人の共有の記録を見て取り下げられる画面を作る。裏側は T-010 の API と T-011 の関数を使い、この票では API・DB を変えない。審査：インパクト30（プライバシーを守って知恵にする）、デモ25（罠の5件目で案が出て、選んで承認する場面）。

## 2. 受け入れ条件

- A1. `src/components/SummaryActions.tsx` の既存の2つの操作の後ろに、`/sessions/<session.id>/share` へのリンク「チームに共有する」を1つ足す（`next/link`）。既存の `CopyButton`・`QuestionDraft` の行と props の型は変えない
- A2. `/sessions/[id]/share`（`src/app/sessions/[id]/share/page.tsx`。`src/app/sessions/[id]/page.tsx` と同じく `Suspense` で包み、中身は `ShareReview` のクライアント部品）。ユーザーは既存の画面と同じく、`window.localStorage` のキー `"tsubuyaki.userId"` の値（なければ `"newcomer_a"`）を、描画の後（`useEffect` の中）で読む。新しい保存先を作らない（A5 の `ShareRecords` も同じ読み方）。開くと、まず `GET /api/shares?userId=<encodeURIComponent(userId)>` を呼び、`session_id` がこの作業の記録のうち `status` が `approved` のものが1件以上あれば、`id` の最も大きいその記録を A4 のとおり表示して POST は呼ばない（同じ作業を二重に承認しない）。そうでなければ `POST /api/sessions/<id>/share` を `{ userId }` で呼び、応答の `candidate` を表示する（却下・取り下げの後に開き直すと、確かめ直すための新しい候補になる）。失敗の `error` ごとに日本語の1行を出す：`session_active`「作業が終わってから共有できます」、`no_summary`「先に整理を実行してください」、`nothing_to_share`「共有できる項目がありません（つまずき・解決・判断の理由・学びがすべて『なし』）」、`not_your_session`「本人の作業だけを共有できます」、ほかは「共有候補を作れませんでした（<error>）」
- A3. 候補の表示（`candidate.status` が `pending` のとき）：
  1. 注意書きを常に2つ表示する：「共有した内容は人事評価に使いません。チームの次の人のための知恵として使います。」（M9-4）と「機密の検査はパターンによるもので、取りこぼすことがあります。完全な匿名化はできません。」（M6-4）
  2. 「共有される本文」の欄に、編集できる textarea（初期値は `candidate.draft_body`）。「原文のメモは共有されません」と1行
  3. `candidate.stale` が true なら、操作のボタンを出さずに「整理をやり直したため、この候補は古くなりました。画面を開き直してください」
  4. textarea の今の本文に `detectSensitive`（`@/lib/sensitive`）をかけ、検出があれば `proposeAbstractions`（`@/lib/abstraction`）の案を一覧にする。各案に「元の文字列 → 置き換え案」と、選ぶチェックボックス（初期は選ばない）。「選んだ案で置き換える」を押すと `applyAbstractions` の結果で textarea を置き換える（自動では置き換えない）。置き換えの前に `previewAbstraction` の `before` と `after` を並べて見せる。プレビューと置き換えには、**同じ本文・同じ案の一覧・同じ選択**を使う。textarea の本文が変わったとき（手で編集したとき、置き換えたとき）は、案を作り直し、**選択をすべて外す**（`id` は作り直すたびに `p1` から振られるので、前の選択を引き継がない）
  5. ボタン3つ：「このまま承認」（textarea が `draft_body` と同じときだけ押せる。`action: "approve"`）、「編集して承認」（textarea が `draft_body` と違うときだけ押せる。`action: "edit_approve"`、`body` に textarea の本文）、「却下」（理由の入力欄は任意。`action: "reject"`、`reason`）。どれも `POST /api/shares/<candidate.id>` に `userId` を付けて送る
  6. 応答が 409 `flagged_body` なら、自動では送り直さずに「機密情報らしい文字列が残っています：<describeFlags(flags)>」と表示し、「このまま承認する」ボタンを出す。このボタンは、`flagged_body` を受けた送信の `candidate.id`・`action`・`body` の組に結び付け、その組をそのまま `confirmFlagged: true` で送り直す。**textarea の本文が変わったら、このボタンと確認待ちを消す**（変わった本文は通常の送信からやり直す）。409 `stale_candidate` は 3 と同じ文、`already_decided` は「この候補はすでに決定済みです」、400 の `empty_body`・`body_too_long`・`reason_too_long` はそれぞれ「本文が空です」「本文が長すぎます（2000文字まで）」「理由が長すぎます（500文字まで）」、403 `not_your_share` は「本人の候補だけを決定できます」。**それ以外の 2xx でない応答と、通信の失敗**は「送信できませんでした。もう一度試してください」。どの失敗でも成功の表示はせず、送信中の状態（ボタンを押せない状態）を解く
  6b. 送る前に画面で長さを確かめる：本文の `.length` が 0 なら「編集して承認」「このまま承認」を押せない、2000 を超えれば押せずに「本文が長すぎます（2000文字まで）」、却下の理由の `.length` が 500 を超えれば「却下」を押せない
  7. 成功したら、決定（承認／編集して承認／却下）と日時、承認なら「チームの知恵に入りました」、却下なら「チームの知恵には入りません」を表示し、`/shares` へのリンク「共有の記録を見る」を出す
- A4. 決定済みの表示（A3 の 7 と、`pending` でない候補を表示するとき）は、操作を出さずに次の表のとおり：

  | `status` | 決定の名前 | 日時 | 本文 | 1行 |
  |---|---|---|---|---|
  | `approved` | `action` が `approve` なら「このまま承認」、`edit_approve` なら「編集して承認」 | `decided_at` | `final_body` | 「チームの知恵に入りました」 |
  | `rejected` | 「却下」（理由があれば `reject_reason`） | `decided_at` | `draft_body` | 「チームの知恵には入りません」 |
  | `withdrawn` | 「取り下げ済み」（元の決定の名前を括弧で） | `withdrawn_at` | `final_body` | 「チームの知恵から外しました」 |
- A5. `/shares`（`src/app/shares/page.tsx`、中身は `ShareRecords`）：`GET /api/shares?userId=…` の `records` を新しい順に表に出す。列は 作業名・作成日時・状態（`pending`＝未決定、`approved`＝A4 の表の決定の名前、`rejected`＝却下、`withdrawn`＝取り下げ）・日時（A4 の表の「日時」の列。`pending` は空）・本文（`approved`・`withdrawn` は `final_body`、それ以外は `draft_body`）・却下の理由。`approved` の行に「取り下げる」ボタン（押すと `window.confirm` の後に `POST /api/shares/<id>` を `{ userId, action: "withdraw" }` で送り、成功したら表を読み直す。失敗は A3 の 6 と同じ扱いで、`not_approved` は「この共有はすでに取り下げ済みか、承認されていません」）。記録の取得に失敗したら「共有の記録を読めませんでした」。記録が0件なら「まだ共有の記録はありません」
- A6. 画面の部品は `src/lib/` の関数を import してよいが、`src/lib/` と `src/app/api/` のファイルは変えない。API の呼び出しはすべて既存の画面と同じく `fetch` で、応答の型は T-010 の `ShareCandidate`（`@/lib/sharing` の型）を `import type` で使う（`@/lib/sharing` は DB を読むので**実行時の import はしない**。実行時に import してよいのは `@/lib/sensitive` と `@/lib/abstraction` だけ）。本文・検出語・理由は React の文字列としてだけ描画し（`dangerouslySetInnerHTML` を使わない）、`console`・`localStorage`（`tsubuyaki.userId` の読み取りを除く）・ほかの保存先に書かない
- A7. `npm run -s test`（既存の試験のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは次の5つだけ：`src/components/SummaryActions.tsx`、`src/components/ShareReview.tsx`（新設）、`src/components/ShareRecords.tsx`（新設）、`src/app/sessions/[id]/share/page.tsx`（新設）、`src/app/shares/page.tsx`（新設）

## 3. 開発用テスト

- 画面の部品の単体試験は書かない（既存の画面と同じ）。統合の後に、ユーザー役が W1 の合成データで「S-2 → 共有する → 罠の語を置き換え → 編集して承認 → 新人B の開始で M1-4② に出る → 取り下げで消える」を確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回（`npm install` は使わない）
2. 見た目は既存の画面（Tailwind、zinc 系、注意は amber、成功は emerald）に合わせる
3. コミットは1つ。メッセージの先頭は `T-014: `

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。要件は main にコミット済みのこの票の §2（A1〜A7）。T-010・T-011 の統合の後に着手する。T-015 と触るファイルが重ならない。

## 6. 記録

（統合後に追記）
