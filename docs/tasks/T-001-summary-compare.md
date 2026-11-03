---
id: T-001
title: 整理結果の「前回との比較」
status: ready
requirements: [A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M4-2, M1-4, M9-4, D-40]   # 関連する docs/requirements.md の ID（記録用。司法には渡さない）
proposal_from: M4 の提案（2026-11-03、M4 のコミット 57a48a9 の直後にオーナー採用）
estimate_h: 0.5
time_limit_min: 45
branch: null           # Claude Code が worktree に付ける worktree-agent-<id>。起動後に行政の長が記入
worker: null
files_allowed:
  - src/components/PreviousSummary.tsx           # T-000 が作った差し込み口の中身（props は sessionId・userId・taskName。変えない）
  - src/lib/sessions.ts
  - src/lib/sessions.test.ts
  - src/app/api/sessions/[id]/previous/route.ts  # 新設。既存の GET /api/sessions/[id] は触らない
files_forbidden:
  - src/components/SessionView.tsx       # 差し込み口は T-000 で作成済み。触らない
  - src/app/api/sessions/[id]/route.ts   # 既存の応答の形を変えない（他の票と重ねない）
  - src/lib/summary-schema.ts
  - src/lib/summarize.ts
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/requirements.md
  - docs/tasks/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-000]
---

## 1. 目的

S-2（整理結果の画面）で、本人の同じ作業名の**前回**の整理結果（つまずき・学び）を小さく並べて見せる。「前回と同じところでつまずいた」「前回の学びが活きた」が見え、D-40 の「改善の追跡」の最小形になる。他人の記録は使わない（M9-4）。審査：インパクト30、デモ25。

## 2. 受け入れ条件

- A1. `src/lib/sessions.ts` に `getPreviousSummary(sessionId: number, db?: DatabaseSync): PreviousSummary | null` を追加する。返す値は、**同じ `user_id`・同じ `task_name`・`status = 'ended'`・`ended_at` がこの作業の `started_at` より前**の作業のうち最新のもの（`listHistory` の「前回」と同じ基準）について、`{ session_id, task_name, ended_at, struggle: { text, status }, learning: { text, status } }`。`status` は `itemStatus()` の値（evidenced／inferred／none）。該当する作業がない、またはその作業に整理結果（`session_summaries`）がなければ `null`
- A2. `GET /api/sessions/[id]/previous?userId=<id>` を新設する。応答は 200 `{ "previous": <A1 の値> | null }`。`userId` が未登録なら 404 `{ error: "user_not_found" }`、作業が存在しなければ 404 `{ error: "session_not_found" }`、作業が別のユーザーのものなら 403 `{ error: "not_your_session" }`（既存の `GET /api/sessions/[id]` と同じ判定の順）
- A3. `PreviousSummary`（props は `sessionId`・`userId`・`taskName`。T-000 の形を変えない）は A2 を1回取得し、`previous` があるときだけ、青枠の文体（既存の `border-sky-300 bg-sky-50` 系）で **「前回（M/D）のつまずき：…」「学び：…」の2行**と、前回の作業へのリンク `<a href="/sessions/<previous.session_id>">前回の記録を見る</a>` を描く。`status` が `none` の項目は本文の代わりに「記録なし」と出す。`previous` が `null`・取得中・取得失敗のときは**何も描かない**（`null` を返す）
- A4. 他人の記録は使わない：別のユーザーが同じ作業名で終了・整理済みでも、A1 は `null` を返す（テストで確かめる）
- A5. `src/lib/sessions.test.ts` に A1・A4 のテストを **3件以上**追加する：①前回なし → `null` ②他人の同じ作業名だけ → `null` ③自分の同じ作業名の終了済み2件（整理結果あり）→ 直前の1件が返り、`struggle.text` が一致。既存のテストは変えない
- A6. `npm run -s test`（既存 91 件＋追加分）・`npm run -s typecheck`・`npm run -s lint` がすべて通る。差分は `files_allowed` の4ファイルだけ

## 3. 開発用テスト

- `sessions.test.ts`：A5 の3ケース。テスト用 DB は既存のテストと同じ方法（`openDb(":memory:")` 等）で作り、`session_summaries` には `parseStoredSummary` が読める JSON を入れる（`summary-schema.test.ts` の見本を参考に）
- 画面（A3）の描画はテストしない。ユーザー役（Pro）が統合後に確認する

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回（worktree に node_modules を作る。`npm install` は使わない）
2. `sessions.ts`：`listHistory` の「前回」の相関サブクエリと同じ条件で前回の `id` を引き、`session_summaries` の最新行を `parseStoredSummary` で読み、`struggle`・`learning` と `itemStatus` を返す。`PreviousSummary` 型も `sessions.ts` に export する
3. `src/app/api/sessions/[id]/previous/route.ts`：既存の `src/app/api/sessions/[id]/route.ts` を見本にして、ユーザー・作業・所有の判定の後に `getPreviousSummary` を返す
4. `PreviousSummary.tsx`：`useEffect` で1回 fetch（`cancelled` フラグで後片付け）。`useState<PreviousSummary | null>`。React Compiler の lint に注意（effect 内の同期的な setState は禁止。fetch の後の setState はよい）。日付は `formatMdHm` か `formatHm` を `@/lib/time` から使う
5. コミットは1つ。メッセージの先頭は `T-001: `

## 5. 統合審査

決定論的な監査（`npm test`・`typecheck`・`lint`）＋ judge ＋ Codex judge。要件は `requirements_source: ticket` により **main にコミット済みのこの票の §2（A1〜A6）**（`--ticket`）。T-002・T-003 と**並行可**（触るファイルが重ならない）。

## 6. 記録

（統合後に行政の長が追記）
- 20:04 立法補佐（Pro）が §2 の受け入れ条件を確認（具体的で検証できる。3票の files_allowed は重ならない）。main に固定（D-49②）
