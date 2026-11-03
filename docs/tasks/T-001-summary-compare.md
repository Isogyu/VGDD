---
id: T-001
title: 整理結果の「前回との比較」
status: ready
requirements: [M4-2, M1-4, D-40]
proposal_from: M4 の提案（2026-11-03、M4 のコミット 57a48a9 の直後にオーナー採用）
estimate_h: 0.5
branch: task/T-001-summary-compare
worker: null
files_allowed:
  - src/components/PreviousSummary.tsx   # T-000 が作った差し込み口の中身
  - src/lib/sessions.ts
  - src/lib/sessions.test.ts
  - src/app/api/sessions/[id]/route.ts
files_forbidden:
  - src/components/SessionView.tsx       # 差し込み口は T-000 で作成済み。触らない
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/requirements.md
  - src/lib/summary-schema.ts
depends_on: []
---

## 1. 目的

S-2（整理結果の画面）で、本人の同じ作業名の**前回**の整理結果（つまずき・学び）を小さく並べて見せる。「前回と同じところでつまずいた」「前回の学びが活きた」が見え、D-40 の「改善の追跡」の最小形になる。審査：インパクト30、デモ25。

## 2. 受け入れ条件

- A1. `GET /api/sessions/[id]` の応答に `previous`（本人・同じ作業名・直前に終了した作業の、最新の整理結果の `struggle` と `learning` の text と session_id）が入る。前回がなければ `null`
- A2. S-2 の整理結果の上に「前回（M/D）のつまずき：…／学び：…」が1〜2行で出る。前回がなければ何も出ない
- A3. 他の人の記録は使わない（本人の前回だけ。M9-4）
- A4. 前回の作業へのリンク（`/sessions/<前回の id>`）が付く

## 3. 開発用テスト

- `sessions.test.ts`：前回の整理結果の取得が「本人・同じ作業名・直前」だけを返すこと。前回なし／他人の記録あり／自分の別の作業名あり、の3ケース
- 既存の `listHistory` の前回の求め方（相関サブクエリ）と同じ基準を使う

## 4. 手順の案

- `src/lib/sessions.ts` に `getPreviousSummaryHints(sessionId, db)` を足す。`listHistory` の「前回」の求め方を共通化してよい
- `GET /api/sessions/[id]` の応答に `previous` を足す
- `PreviousSummary.tsx`（T-000 が null を返す形で用意済み。props は `sessionId`・`userId`・`taskName`）の中身を書く。表示は既存の青枠の文体に合わせる。`SessionView.tsx` は触らない

## 5. 統合審査

決定論的な監査（`npm test`・`typecheck`・`lint`）＋ judge（`--req M4-2,M1-4`）＋ Codex judge。

## 6. 記録

（統合後に行政の長が追記）
