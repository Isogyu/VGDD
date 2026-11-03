---
id: T-001
title: 整理結果の「前回との比較」
status: merged
requirements: [A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M4-2, M1-4, M9-4, D-40]   # 関連する docs/requirements.md の ID（記録用。司法には渡さない）
proposal_from: M4 の提案（2026-11-03、M4 のコミット 57a48a9 の直後にオーナー採用）
estimate_h: 0.5
time_limit_min: 45
branch: worktree-agent-a0c64b050da78ca75   # 作業員の元のブランチ（0498889）。申請は main 追従のため cherry-pick した新ブランチ（§6）
worker: W1
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
- 20:07 W1 起動（worktree `agent-a0c64b050da78ca75`、main 99f549a から）。20:10 コミット 0498889（4ファイル、+204/−7）。報告：test 95（既存 91＋4）・typecheck・lint 合格。逸脱：前回の条件は `listHistory`（`ended_at < 前回の ended_at`）ではなく A1 の明記どおり `ended_at < この作業の started_at`。`PreviousSummary` は取得結果の `task_name` が props と一致するときだけ描く（作業の切り替え直後に前の結果が残らないため）。古い整理結果で項目が欠けていれば「記録なし」扱い。API は既存と同じ順で `invalid_id` 400 も返す。拒否1件：ヒアドキュメントでテストを追記して続けて実行する複合コマンドが worktree 隔離の検査で拒否（ファイルは変わらず、Edit で追記）
- 20:13 行政の長が差分を確認（`files_allowed` の4ファイルのみ、禁止語なし、A1〜A6 を確認）。`status: review` で main にコミット。票のコミットで main が進むため、新しい worktree で 0498889 を cherry-pick したブランチで申請する（README の標準手順）

- 2026-11-03T20:28:02+0900 gate-runner: status → in_progress（files_allowed の外を変更している: src/app/api/sessions/[id]/previous/route.ts）
- 20:30 立法補佐：上の差し戻しは法律の不具合（OBS-017、p0.2.2 で修正）によるもの。差し戻しの回数には数えない
- 20:33 行政の長：p0.2.2 施行（66e3a5b）後の再申請。`status: review` に戻して main にコミット（§2 は変えない）。main 6d618b5 の上に T-001 → T-002 → T-003 の鎖を新しい worktree で積み直す（元のパッチ 0498889 と同一。1段目のブランチ `req2-T-001`）。前回の鎖（`req-T-001`・`req-T-002`・W4 の worktree）は不要

- 2026-11-03T20:56:42+0900 gate-runner: status → blocked（judge と Codex の判定が重大な指摘で分かれた（judge=APPROVED/0 件, codex=CHANGES_REQUIRED/1 件）。オーナーの裁定へ）
- 20:58 オーナーの裁定：judge（APPROVED）と Codex（CHANGES_REQUIRED）の不一致について、Codex の指摘（PreviousSummary が取得結果を sessionId・userId と結び付けず、props の変更時に前の結果＝前のユーザーの記録を含む を再取得中に描きうる。A3 に反する）を採り、差し戻し。立法補佐がコードで指摘の正しさを確認済み（OBS-018）
- 21:02 行政の長：W1（新しい worktree、main の上）に修正を指示。直し方：取得結果を `{ sessionId, userId, previous }` で持ち、現在の props と一致するときだけ描く。props が変わったら取得が終わるまで `null`。判定は純粋関数として export し、`sessions.test.ts` に「userId を変えた直後に前の結果を描かない」のテストを足す（files_allowed の中）。直した HEAD を1段目にして T-002・T-003 を積み直し（`req3-T-00x`）、`status: review` で再申請（差し戻し1回目。OBS-017・連鎖の分は数えない）

- 2026-11-03T21:07:40+0900 gate-runner: status → merged（main=7ae937d2b2ce judge=APPROVED codex=APPROVED）
