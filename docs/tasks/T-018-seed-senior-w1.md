---
id: T-018
title: デモの合成データに先輩C の W1 の記録と承認済みの共有を足す（M5 のデモ用）
status: ready
requirements: [A1, A2, A3, A4]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M7-1, M5-1, M5-2, D-62]   # 記録用。司法には渡さない
proposal_from: 開発スケジュール 段階1（デモの筋書き W1：承認 → チームの知恵 → 手順書の原案）。2026-11-06 立法補佐が起草（オーナー不在の間。着手はオーナーの approve-spec の後）
estimate_h: 0.3
time_limit_min: 30
security_review: false
unattended: true
branch: null
worker: null
files_allowed:
  - src/lib/seed.ts
  - src/lib/seed.test.ts
  - src/lib/ai/demo.test.ts   # W1 の作業を作業名だけで取っている2か所に user_id の条件を足すだけ（A3）
files_forbidden:
  - src/lib/db/schema.sql
  - src/lib/sessions.ts
  - src/lib/sharing.ts
  - src/lib/procedure.ts
  - src/components/**
  - src/app/**
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

手順書の原案（M5、T-012）は、同じ作業名の**承認済みの共有が2件以上**ないと作れない（D-62）。今の合成データには W1 の共有が新人A の1件しかなく、デモで原案を見せられない。要件 §3 の「W1 に先輩C の記録1回（M5 の判断のポイント用）」を合成データに足し、先輩C が承認した共有を1件入れる。すべて架空。審査：デモ25、インパクト30（先輩の判断の理由が手順書に入る場面）。

## 2. 受け入れ条件

- A1. `src/lib/seed.ts` の W1 を初めて入れるとき（今の `insertW1Extras` の中、または同じ時に呼ぶ関数）に、**先輩C（`senior_c`）の W1 の終了済みの作業を1件**入れる：`task_name` は `DEMO_TASK_W1`、開始 `2026-10-20T09:00:00+09:00`、終了 `2026-10-20T10:00:00+09:00`、メモはこの順・この時刻・この本文の3件（`kind` は既定の `memo`）：
  1. `2026-10-20T09:05:00+09:00`「出力形式の変更を頼まれたら、まず今の CSV の見本と、それを読む人と仕組みを依頼者に聞く」
  2. `2026-10-20T09:30:00+09:00`「経理の集計の表計算が列の番号で読んでいるので、列の順を変えるだけで壊れる。変える前に読む側の担当に知らせる」
  3. `2026-10-20T09:50:00+09:00`「既存のスクリプトは共有ドライブの tools フォルダにある。探す前に場所を聞くほうが早い」
  作業の開始・メモ・終了は既存の `startSession`・`addNote`・`endSession` で入れる（新人A の作業と同じ書き方。`startSession` が失敗したら、既存の新人A の場合と同じく分かる文で例外を投げる）
- A2. 同じ時に、先輩C が承認した共有を `shared_knowledge` に1件入れる：`task_name` は `DEMO_TASK_W1`、`user_id` は `senior_c`、`session_id` は A1 の作業、`approved_at` は `2026-10-20T10:10:00+09:00`、`body` は「出力形式の変更を頼まれたら、まず今の CSV の見本と、それを読む人・仕組みを確認する。列の番号で読む表計算があると列の順を変えるだけで壊れるので、変える前に読む側に知らせる。既存のスクリプトは共有ドライブの tools フォルダにある。」。`session_summaries` には先輩C の分を入れない
- A3. 既存の試験 `src/lib/seed.test.ts` は、**データを足す仕様の変更による期待値だけ**を次のとおり変え、それ以外の既存の `it(` と期待値は変えない（D-58④。1行ずつ）：
  - 初回の投入の試験：`work_sessions` の件数 3 → 4、`notes` 12 → 15、`shared_knowledge` 1 → 2（`session_summaries` は 1 のまま、`insertedTasks` は `["W1", "W2", "W3"]` のまま）
  - M1-4 のヒントの試験：新人A の `teamKnowledge` の件数 1 → 2、新人B の `teamKnowledge` の件数 1 → 2（`teamKnowledge[0].display_name` が「新人A」であることは変えない。承認日時の新しい順なので新人A が先）
  - reset の試験：開始直後の `work_sessions` の件数 4 → 5、`r.reset` の期待値を `{ share_candidates: 0, shared_knowledge: 2, session_summaries: 1, notes: 15, work_sessions: 5 }` に、reset の後の `work_sessions` の件数 3 → 4、`teamKnowledge` の件数 1 → 2
  - `src/lib/ai/demo.test.ts` の既存の試験で、`SELECT id FROM work_sessions WHERE task_name = ?` で W1（と W2・W3）の作業を取っている2か所（26行目・42行目付近）を、`SELECT id FROM work_sessions WHERE task_name = ? AND user_id = 'newcomer_a'` に変える（先輩C の W1 の作業が先に取れてしまうため。データを足す仕様の変更による。それ以外は変えない）
  - 新しい試験を2件以上足す：①seed の後、`listProcedureSources(DEMO_TASK_W1, db)`（`@/lib/procedure`）が2件で、1件目が先輩C（承認日時の古い順）②先輩C の W1 の作業が終了済みで、メモが3件、2回目の seed で増えない
- A4. `npm run -s test`（既存の試験と追加分のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは `src/lib/seed.ts`・`src/lib/seed.test.ts`・`src/lib/ai/demo.test.ts` の3つだけ。足すメモと共有の本文は A1・A2 の文と1文字も違わない（本文が架空であることは起草の時に立法補佐とオーナーが確かめる。司法が確かめるのは一致だけ）

## 3. 開発用テスト

- `seed.test.ts`：A3 の観点

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回（`npm install` は使わない）
2. 先輩C の作業は新人A の進行中の判定に影響しない（ユーザーが別）。`seedDemo` の冪等性（2回目は増えない）は、W1 を初めて入れるときにだけ入れることで保つ
3. コミットは1つ。メッセージの先頭は `T-018: `

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。要件は main にコミット済みのこの票の §2（A1〜A4）。ほかの票と触るファイルが重ならない（T-010 で `seed.ts` の `resetDemoData` を変えたのは統合済み）。

## 6. 記録

（統合後に追記）
