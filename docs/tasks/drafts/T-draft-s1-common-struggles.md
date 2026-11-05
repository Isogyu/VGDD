---
id: T-draft-s1-common-struggles
title: S1 共通つまずきの簡易集計（同じ作業名の承認済みの共有から「つまずき」を並べ、「n 人がつまずいた箇所」を S-4 に出す）
status: draft
requirements: [A1, A2, A3, A4, A5]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [S1, C2, M9-3, M4-1]   # 記録用。司法には渡さない
proposal_from: 要件 §6 の条件付き S1（承認済み）。2026-11-06 03:0x 行政の長の下書き（28_night_plan_max.md §1 F-5）。C2（チームへの公開ビュー）は T-015 で実装済み
estimate_h: 0.6
time_limit_min: 45
security_review: false         # 読むのは承認済みの共有だけ
unattended:
branch: null
worker: null
files_allowed:
  - src/lib/common-struggles.ts            # 新設：純粋関数＋読み込み
  - src/lib/common-struggles.test.ts       # 新設
  - src/app/api/knowledge/team/route.ts    # 応答に struggles を足す
  - src/components/TeamKnowledge.tsx       # 作業名ごとに「つまずき」の区画を足す
files_forbidden:
  - src/lib/team-knowledge.ts
  - src/lib/sharing.ts
  - src/lib/summarize.ts
  - src/lib/db/schema.sql
  - src/components/WorkScreen.tsx
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-015, T-018]
---

## 1. 目的

要件 S1「同じ作業名で複数人の記録があるとき、M4 の『つまずき』を並べて『2人がつまずいた箇所』と表示する。意味的な突き合わせはせず、同じ作業名の中で並べるだけ」。**材料は本人が承認した共有（`shared_knowledge`）だけ**にする（M9-3「承認していない内容・取り下げた内容は出さない」。本人の整理結果 `session_summaries` は承認を通っていないので読まない）。共有の本文は `buildShareDraft` が `【つまずき】…` の行で始まる形で作るので、その行を拾う。デモの筋書き 2:05〜2:25（新人B が同じ箇所でつまずいていたことが見える）。審査：インパクト30（新人の失敗が次の新人を助ける）。

## 2. 受け入れ条件

- A1. `src/lib/common-struggles.ts` に純粋関数 `extractStruggles(body: string): string[]` を export する：本文を改行で分け、`@/lib/summary-schema` の `SUMMARY_LABELS.struggle` を `【` `】` で囲んだ見出し（例 `【つまずき】`）で**始まる行**だけを取り、見出しを除いた残りを `trim()` して返す（末尾の `（AI の推測）` はそのまま残す。空になった行は捨てる）。見出しが途中にある行、ほかの見出しの行は取らない
- A2. `listCommonStruggles(taskName: string, db = getDb()): CommonStruggles` を export する。`CommonStruggles = { task_name: string; people: number; items: { user_id: string; display_name: string; role: "newcomer" | "senior"; approved_at: string; text: string }[] }`。`shared_knowledge` を `users` と JOIN し、同じ `task_name` で `withdrawn_at IS NULL` の行を `approved_at` の昇順・`id` の昇順で読み、各 `body` に `extractStruggles` をかけて1行を1件に。`people` は `items` の `user_id` の**異なる数**。**読む表は `shared_knowledge`・`users` だけ**（`notes`・`session_summaries`・`share_candidates` は読まない）
- A3. `GET /api/knowledge/team` の応答に `struggles: Record<string, CommonStruggles>` を足す（鍵は `task_name`。`groups` の各 `task_name` について `listCommonStruggles` を呼ぶ。`Map` から `Object.fromEntries`）。既存の `{ groups }` と 500 `knowledge_unavailable` は変えない
- A4. `src/components/TeamKnowledge.tsx`：作業名ごとの区画の、共有の一覧の**上**に、`struggles[task_name].people` が **2 以上**のときだけ `<section aria-label="つまずき">` を足す：見出し「<people> 人がつまずいた箇所」（`<h3>`）、`items` を `display_name`（先輩は「先輩」のバッジ）・`text` の1行ずつ。`people` が 1 以下なら区画を出さない。1行「同じ作業名の承認済みの共有から並べています（内容の突き合わせはしていません）」を区画の最後に。`struggles` は `Map` に写して読む（`Object.prototype` の鍵を拾わない）。既存の表示（共有の一覧・原案・読み直し）は変えない。`@/lib/common-struggles` は `import type` だけ
- A5. `src/lib/common-struggles.test.ts` に、下の①〜⑥を**それぞれ1件以上の `it(`**で試す（`openDb(":memory:")` に `seedDemo`。seed の W1 には新人A と先輩C の共有があり、新人A の共有の本文は `【つまずき】` の行を持つ）：①`extractStruggles` が `【つまずき】` で始まる行だけを返し、`【原因】` の行や途中に見出しがある行は返さない ②`（AI の推測）` が残る、空の行は捨てる ③seed の W1 で `people` が 1 以上、`items` に新人A の `display_name` ④先輩C の共有の本文に `【つまずき】` の行がないなら `items` に先輩C がなく、試験の中で先輩C の共有を `【つまずき】…` を含む本文で INSERT すると `people` が 2 ⑤取り下げ済み（`withdrawn_at` あり）の共有は数えない ⑥共有のない作業名は `people: 0`・`items: []`。あわせて `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る。差分のファイルは `files_allowed` の4つだけ

## 3. 開発用テスト

- A5 の観点。画面はユーザー役が、新人B として W1 で共有を承認した後に S-4 で「2 人がつまずいた箇所」が出ることを確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. `team-knowledge.ts` は変えない（同じ JOIN を `common-struggles.ts` に書く）
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。T-015・T-018 の統合の後（済み）。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（4:00 から立法補佐が行う）。（この票は点検前）

## 8. オーナーに聞くこと

1. 材料を**承認済みの共有だけ**にする解釈（要件 S1 の文は「M4 の『つまずき』」で、本人の整理結果を指す読み方もできる。M9-3 を優先した）でよいか
2. 「2 人がつまずいた箇所」の人数の数え方（異なる `user_id` の数）でよいか。同じ人の2回の共有は 1 人
