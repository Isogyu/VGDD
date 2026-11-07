---
id: T-040
title: 票の再生で、代表の3枚だけでなく記録のある全票を選べるようにし、記録の分類の印と絞り込みを付ける
status: ready
requirements: [A0, A1, A2, A3, A4, A5]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-64]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐が起草（オーナーの承認前）。オーナーが 22:1x に案 G（全票の索引から再生）を採用
estimate_h: 2
time_limit_min: 150
security_review: false         # 公開用の出来事の API（T-028）の値を並べ替えて数えるだけ。API は変えない
unattended: false
branch: null
worker: null
files_allowed:
  - src/lib/theater-replay.ts                         # 並びと印を組み立てる純粋関数を足す（今の関数は変えない）
  - src/lib/theater-replay.test.ts                    # 上に合わせて足すだけ
  - src/components/theater/TicketReplay.tsx           # 票の並びを全票にし、絞り込みと印を足す
  - src/components/theater/TicketReplay.test.tsx      # 足す。全票にしたことで期待が変わる試験は直す（A4）
files_forbidden:
  - src/lib/governance*.ts
  - src/lib/theater-data.ts
  - src/lib/theater-refresh.ts
  - src/lib/theater-stage.ts
  - src/lib/theater-guide.ts
  - src/lib/theater-banner.ts
  - src/lib/theater-start.ts
  - src/lib/theater-evidence.ts
  - src/lib/claude-roles.ts
  - src/components/theater/GovernanceTheater.tsx
  - src/components/theater/GovernanceStage.tsx
  - src/components/theater/TheaterShell.tsx
  - src/components/theater/LawComparison.tsx
  - src/components/theater/DecisionPanel.tsx
  - src/components/theater/ClaudeRoles.tsx
  - src/components/theater/TheaterGuide.tsx
  - src/components/theater/tokens.ts
  - src/components/GovernanceView.tsx
  - src/app/**
  - docs/**
  - src/lib/db/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-028, T-032, T-039]
---

## 1. 目的

今の票の再生で選べるのは、代表の3枚（T-014・T-026・T-013）だけ。審査員が、記録のある全票を自分で辿れるようにする。代表の3枚は今のまま先頭に置き、その後に残りの票を ID の順に並べる。票ごとに、記録の分類から数えた印（差し戻し・判定の不一致・人の裁定）を付け、「不一致があった票」などで絞り込めるようにする。代表例だけを選んで見せているのではなく、記録をそのまま開いていることを示す。データは公開用の出来事の API（T-028）のまま。審査：深さ20、デモ25。

## 2. 受け入れ条件

- A0. 差分を許すパスは次の4つだけ：`src/lib/theater-replay.ts`、`src/lib/theater-replay.test.ts`、`src/components/theater/TicketReplay.tsx`、`src/components/theater/TicketReplay.test.tsx`。それ以外は変更しない。実装と差分の審査の基準は、T-039 を統合した後の main とする。`theater-replay.ts` の今の export（`FEATURED_TICKETS`・`pickFeatured`・`labelFor`・`toneFor`・`formatJst` など）の振る舞いは変えない
- A1. **純粋関数**（`src/lib/theater-replay.ts` に足す。React を import しない）：
  - `ticketMarks(ticket)`：`ticket` は再生の票（`{ id, title, events }`）。`{ returned, disagreement, ruling }` を返す。`returned` は `kind` が `"returned"` の出来事の数、`disagreement` は `kind` が `"minor_disagreement"` の出来事と、`kind` が `"blocked"` で `reason` が `"disagreement"` の出来事の数の合計、`ruling` は `kind` が `"ruling"` の出来事の数
  - `REPLAY_FILTERS` を export する：`[{ value: "all", label: "すべて" }, { value: "disagreement", label: "不一致あり" }, { value: "ruling", label: "裁定あり" }, { value: "returned", label: "差し戻しあり" }]`
  - `replayOptions(tickets, filter)`：出来事が1件以上ある票だけを、`pickFeatured(tickets)` の順の代表の票を先頭に、残りを `id` の文字列の昇順で並べて返す（同じ票を2回入れない）。`filter` が `"all"` 以外なら、その印（`"disagreement"`→`disagreement`、`"ruling"`→`ruling`、`"returned"`→`returned`）が 1 以上の票だけを、同じ順で残す
  - `marksLabel(marks)`：0 でない印だけを「差し戻し {n}」「不一致 {n}」「裁定 {n}」の順に「・」でつないだ文を返す。すべて 0 なら空の文字列
  - 印は、公開用の出来事の分類（T-028）の出てきた数を表す。生の §6・判定の結論・今の状態から推し量らない。後の訂正や取り消しで引かない。公開用の分類に出てこない人の裁定は数えず、`released` も裁定に入れない
- A2. **再生の部品**（`TicketReplay.tsx`）：
  - 票の並びを、`pickFeatured(tickets)` から `replayOptions(tickets, filter)` に替える。`filter` は部品の状態で、最初は `"all"`
  - 「票を選ぶ」の `select` の前に、`REPLAY_FILTERS` のボタンの組（`role="group"`、`aria-label="票の絞り込み"`、各ボタンに `aria-pressed`）を置く
  - `select` の各 `option` の文は「{id} {title}」の後に、`marksLabel` が空でなければ「（{marksLabel}）」を足す。代表の票の `option` には、さらに先頭に「★」を付ける
  - `select` の下（今の再生の説明の行の上）に1行「記録のある票は全 {n} 票です。★の代表の票を先頭に、残りを ID の順に並べます」を出す（{n} は絞り込みの前の、出来事が1件以上ある票の数で、代表の票を含む。折り返してよい）
  - 絞り込みで選んでいた票が並びから外れたら、今の「選んだ票がなくなったら並びの先頭に移る」振る舞いのまま並びの先頭に移る。選んだ票が変わらなければ、再生の位置を保つ
  - 絞り込みのボタンの組は、並びが空でも出して押せる。並びが空なら「この条件に合う票はありません」を出し、票の `select`・再生の操作・速さ・出来事の表示を出さない。「すべて」などで票が戻れば、その並びの先頭を選ぶ
  - 通知：最初の描画では、並びが空でも `onEventChange` を呼ばない（今のまま）。絞り込みで表示する票がなくなったときは、確定の後に `onEventChange(null)` を1回知らせ、同じ空の状態で描き直しても知らせ直さない。描画の中では呼ばない
  - T-039 の `initialTicketId` は、最初の並び（`"all"`）の中にあればその票を選ぶ（代表の3枚に限らない）。ほかの振る舞い（再生・タイマー・通知・最初に戻す条件）は変えない
  - 1440×900 で、再生の区画（高さ 16rem）の中に収まる。収まらない分は、今の出来事の一覧と同じく区画の中でスクロールする
- A3. **公開してよい項目だけ**：足すのは、票の ID と題、記録の分類から数えた件数、決まった文だけ。通信・保存・console への出力を足さない
- A4. 試験：
  - `theater-replay.test.ts`：今の試験はそのまま。合成の票で `ticketMarks`（`blocked` で `reason` が `"disagreement"` 以外は数えない）、`replayOptions`（出来事のない票を除く・代表の票が先頭で重ならない・残りは ID の昇順・各絞り込み）、`marksLabel`（0 を出さない・すべて 0 なら空）
  - `TicketReplay.test.tsx`：今の試験のうち、全票にしたこと・★と印・絞り込みのボタンを足したこと・出来事のない票を除くこと・空の表示・区画の中のスクロールで期待が変わるものは直してよい。それ以外の今の確かめ（再生の操作・通知・最初に戻す条件など）は保つ。`theater-replay.test.ts` の今の試験は変えない。`renderToStaticMarkup` で、絞り込みのボタンの組と「すべて」の `aria-pressed="true"`、代表の票の `option` の「★」、印の付いた `option` の文、説明の1行の件数。`initialTicketId` が代表でない票のときにその票が選ばれること
  - クリックによる絞り込みと選び直しは SSR の試験では確かめられないので、§3 で立法補佐が held の候補で確かめる
- A5. `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る

## 3. 開発用テスト

held の後、release の前に、立法補佐が held の候補を一時的な作業ツリーで動かして確かめる。

- 「票を選ぶ」に、★の3枚の後に記録のある全票（今は 37 票）が並ぶ。印が公開用の出来事の分類と合う（T-017・T-019・T-026・T-029 に裁定 1、T-014 に不一致 2、T-002・T-003 に差し戻し 3）
- 絞り込みで空になる条件はないが、空のときに「すべて」に戻せることは試験で確かめる
- 「不一致あり」「裁定あり」で並びが絞られ、選んだ票を再生できる
- `/governance?ticket=T-017` で T-017 が選ばれる（T-039 の URL）
- 1440×900 で最初の画面に収まり、375px で横スクロールしない

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. A1（純粋関数と試験）→ A2 と試験
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。T-039 の統合の後に作業員を起動する（同じ `TicketReplay.tsx` を触る）。

## 6. 記録

## オーナーに聞くこと

1. 印は記録の当時の分類で数える。取り消した差し戻しも数に入る（再生の区画の注記「後の訂正や取り消しは含みません」と同じ扱い）
