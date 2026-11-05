---
id: T-draft-m14-checkin-prompt
title: M14 30分チェックイン（作業開始から30分で「いまの理解を整理」を促す表示。タイマーで自動実行はしない）
status: draft
requirements: [A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M14（D-44④）, M10-1, M1-3]   # 記録用。司法には渡さない
proposal_from: 2026-11-06 02:4x 行政の長の下書き（28_night_plan_max.md §1 C-3）。原体験「30分なら聞けた」。docs/ideas.md の P-1（タイマーで自動実行）は見送りのままで、本人が押す形（M10-1）を促す表示だけ
estimate_h: 0.6
time_limit_min: 45
security_review: false         # 画面だけ
unattended:
branch: null
worker: null
files_allowed:
  - src/lib/checkin-prompt.ts               # 新設：促すかどうかの純粋関数
  - src/lib/checkin-prompt.test.ts          # 新設
  - src/components/WorkScreen.tsx           # 促しの表示を1つ足す
  - src/components/UnderstandingPanel.tsx   # 整理が終わったことを親に知らせる任意の props と、要素の id を足すだけ
files_forbidden:
  - src/lib/sessions.ts
  - src/app/**
  - src/components/SessionView.tsx
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

作業開始から **30 分**たったら、S-1 に「いまの理解を整理しませんか」の促しを出す。整理そのものは本人がボタンを押して始める（M10-1「タイマーによる自動実行はしない」のまま）。整理を行うか「あとで」を押せば促しは消え、さらに 30 分たてばもう一度出る。審査：インパクト30（原体験の数字「半日 → 30分」を画面の振る舞いで示す）、デモ25。

## 2. 受け入れ条件

- A1. `src/lib/checkin-prompt.ts` に純粋関数 `shouldPromptCheckin(input: { elapsedMin: number; lastCheckinMin: number | null; dismissedMin: number | null }): boolean` を export する。規則：`elapsedMin` が **30 未満**なら false。30 以上のとき、`lastCheckinMin`（最後に整理を実行した時点の経過分）と `dismissedMin`（最後に「あとで」を押した時点の経過分）の**両方**について、`null` か `elapsedMin - その値 >= 30` なら true、どちらかが 30 未満なら false。`elapsedMin` が負・`NaN`・整数でないなら false。あわせて `checkinPromptText(elapsedMin: number): string` を export し、「作業開始から <elapsedMin> 分です。いまの理解を整理しませんか」を返す
- A2. `src/components/WorkScreen.tsx`：進行中の作業（`session`）があるとき、`shouldPromptCheckin({ elapsedMin, lastCheckinMin, dismissedMin })` が true なら、入力欄の**上**に促しの帯（`role="status"`、amber の枠）を出す：`checkinPromptText(elapsedMin)` の文、ボタン「いまの理解を整理する」（押すと `document.getElementById("understanding-panel")` へ `scrollIntoView({ block: "start" })`。整理は**自動では実行しない**）、ボタン「あとで」（押すと `dismissedMin` を今の `elapsedMin` にする。**「あとで」から 30 分は出ない**）。`lastCheckinMin`・`dismissedMin` は WorkScreen の state で、**どの作業の値かを `session.id` と一緒に持つ**（例：`{ sessionId, lastCheckinMin, dismissedMin }`）。描画のとき state の `sessionId` が今の `session.id` と違えば両方を `null` とみなす（**effect の中で setState して戻さない**。React Compiler の lint に当たるため。切り替えの後に最初に値を書くときに `sessionId` も書き換える）。既存の表示（入力欄・履歴・経過時間・`UnderstandingPanel`）は変えない。`elapsedMin` は既存の `active.elapsedMin`（サーバーが返し 1 分ごとに取り直す）を使い、クライアントの時計を読まない（取り直しの前後で最大 1 分のずれが出ることは許容する）
- A3. `src/components/UnderstandingPanel.tsx` の変更は次の2点だけ：(1) `Props` に任意の `onCheckin?: () => void` を足し、**整理の API（`POST /api/sessions/[id]/checkin`）が 2xx を返して `result` を新しい値に更新した直後にだけ**呼ぶ（追加の質問に答えて更新したときも 2xx なら呼ぶ。失敗で `result` が変わらないときは呼ばない。メモの保存など整理以外では呼ばない）(2) 部品の最も外側の要素に `id="understanding-panel"` を付ける。それ以外（fetch・表示・既存の props）は変えない。`WorkScreen` は `onCheckin` に「`lastCheckinMin` を今の `elapsedMin` にする」関数を渡す
- A4. 促しの帯は、`session` がないとき（作業を始めていない）には出さない。表示の判定は描画のたびに A1 の関数で行い、`setInterval`・`setTimeout` を**新しく足さない**（既存の 1 分ごとの取り直しだけ）。`dangerouslySetInnerHTML`・`console`・`localStorage` を使わない
- A5. `src/lib/checkin-prompt.test.ts` に、下の①〜⑦を**それぞれ1件以上の `it(`**で試す（純粋関数だけ。時計やタイマーに依存しない）：①29 分は false、30 分は true（両方 `null`）②`lastCheckinMin` が 5 で 30 分は false、60 分は true ③`dismissedMin` が 31 で 59 分は false、61 分は true ④`lastCheckinMin` 5・`dismissedMin` 40 で 69 分は false、70 分は true ⑤「あとで」の直後（`dismissedMin` が `elapsedMin` と同じ 30）は false、30 分後（60）は true ⑥`elapsedMin` が -1・`NaN`・30.5 は false ⑦`checkinPromptText(30)` が「作業開始から 30 分です。いまの理解を整理しませんか」
- A6. `npm run -s test`（既存の試験のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは次の4つだけ：`src/lib/checkin-prompt.ts`（新設）、`src/lib/checkin-prompt.test.ts`（新設）、`src/components/WorkScreen.tsx`、`src/components/UnderstandingPanel.tsx`

## 3. 開発用テスト

- `checkin-prompt.test.ts`：A5 の観点。画面はユーザー役が統合の後に確かめる。30 分待てないときの確認の手段（デモ時計）は §8 の 1

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. 帯の見た目は既存の注意（amber）に合わせる。React Compiler の lint（`set-state-in-effect`）に当たらないよう、判定は描画の中で関数を呼ぶだけにし、effect で state を更新しない
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。**T-draft-m11-knowing-map と `UnderstandingPanel.tsx` が重なる**ので並行しない。順は **この票（M14）→ M11**（M14 の変更は props と id の2点で小さく、M11 はその後の `UnderstandingPanel` に図を差し込む）。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（Codex は sandbox の中から呼べない。4:00 から立法補佐が行う）。点検役：Claude のサブエージェント（ツールなし）。02:5x、3票あわせて指摘 12 件。この票への対応：#2 `onCheckin` は 2xx で `result` を更新したときだけ、失敗とメモの保存では呼ばない（A3）／#3 作業の切り替えのリセットは `sessionId` を一緒に持つ state で描画時に判定し、effect 内の setState を禁じる。1 分のずれは許容と明記（A2）／#4 「あとで」から 30 分は出ないと明記、試験⑤／#5 デモ時計は (b) で、seed の時刻は相対（開始が 28 分前）、試験は純粋関数だけと明記（§8・A5）／#12 M14 → M11 の順を §5 に

## 8. オーナーに聞くこと

1. **デモ時計**（D-44④「30分チェックイン＋デモ時計」）：デモの録画で 30 分待たずに促しを出す手段を作るか。案：(a) 開発サーバーだけで効く `?demoClockMin=30` のような query を `elapsedMin` に足す（`NODE_ENV` が development のときだけ。本番の経路には入れない）(b) seed に「**今から 28 分前に開始した**進行中の作業」（時刻は seed の実行時刻からの相対。合成データ）を入れる（データだけで済む。T-018 と同じ形）。下書きは (b) を推奨（コードの経路を増やさない）。別の票にする
2. 促しの閾値 30 分と、再表示の間隔 30 分でよいか
