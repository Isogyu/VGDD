---
id: T-046
title: 予算の表の割合にも3桁ごとの区切りを付け、表の見出しと列名の文字を表と同じ大きさにする（T-045 の Codex の minor 2件）
status: review
requirements: [A0, A1, A2, A3]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-68]   # 記録用。司法には渡さない
proposal_from: 2026-11-08 12:3x 立法補佐が起草（オーナーの承認前）。T-045 の held の Codex の minor 2件。オーナーの操作の窓口（p0.4.12）を通した最初の一連の検証に使う小さな票
estimate_h: 0.5
time_limit_min: 45
security_review: false         # 表示の文字と大きさだけ
unattended: false
branch:
worker:
files_allowed:
  - src/lib/kernel-budget.ts                          # usageRow の割合の書き方だけ
  - src/lib/kernel-budget.test.ts                     # 試験を足す
  - src/components/KernelBudget.tsx                   # 2つの表の caption と thead の文字の大きさだけ
  - src/components/KernelBudget.test.tsx              # 試験を足す
files_forbidden:
  - src/lib/kernel-state-schema.ts
  - src/components/KernelPanel.tsx
  - src/app/**
  - docs/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-045]
---

## 1. 目的

T-045（統合済み）の Codex の判定に minor が2件あった。①`usageRow` の割合が3桁ごとに区切られない（例：`usageRow(10, 1)` が「1000%」）②予算の表と実行の表の `caption` と `thead` が `text-xs` で、表の文字 `text-sm` を上書きしている。この2つだけを直す。審査：正確さ・読みやすさ。

## 2. 受け入れ条件

- A0. 差分を許すパスは次の4つだけ：`src/lib/kernel-budget.ts`、`src/lib/kernel-budget.test.ts`、`src/components/KernelBudget.tsx`、`src/components/KernelBudget.test.tsx`。それ以外は変更しない。依存を足さない。`usageRow` の戻り値の形（`used`・`limit`・`percent`・`text`）と `percent` の値（`Math.floor(used * 100 / limit)`、上限が null と 0 では null）は変えない
- A1. `usageRow` の `text` の割合の部分を、数と同じ `fmt`（`Intl.NumberFormat("ja-JP")`）で書く。例：`usageRow(10, 1).text` は「10 ／ 1（1,000%）」、`usageRow(30000000, 30000000).text` は「30,000,000 ／ 30,000,000（100%）」。上限が null と 0 の文は変えない
- A2. `KernelBudget.tsx` の予算の表と実行の表の、`<caption>` と `<thead>` の `className` から `text-xs` を外し、表と同じ `text-sm` で表示する（`caption` と `thead` の色・余白・位置の指定は残してよい）。見出し（`h3`）・注記（`text-xs` の段落）・受け入れの一覧は変えない
- A3. 試験：`kernel-budget.test.ts` に A1 の2つの例。`KernelBudget.test.tsx` に、2つの表の `caption` と `thead` の要素の `className` に `text-xs` が含まれないことの試験。そのうえで `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る

## 3. 開発用テスト

held の後、オーナーの操作の窓口の画面から統合し、受け入れまで行う（p0.4.12 の一連の検証）。

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. A1 → A2 → A3。コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。

## 6. 記録

- 12:3x 立法補佐が起草

- 2026-11-08T13:08:30+0900 night-runner: 作業員の実装を前検査で確認（HEAD ec4c30e）。status → review で再申請（試行 1）

- 2026-11-08T13:11:03+0900 gate-runner: status → review（判定に合格（judge=APPROVED codex=APPROVED）。夜間のため統合せず、朝のオーナーの承認を待つ）

- 2026-11-08T13:11:03+0900 gate-runner: status → review（判定に合格（judge=APPROVED codex=APPROVED）。夜間のため統合せず、朝のオーナーの承認を待つ）
