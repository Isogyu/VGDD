---
id: T-016
title: lint の対象から作業員の worktree（.claude/worktrees/）を外す
status: in_progress
requirements: [A1, A2, A3]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: []
proposal_from: 2026-11-05 23:2x 立法補佐の確認。統合の後に main で npm run lint が、作業員の worktree の .next/ を読んでエラーになった（main のコード自体はエラー 0）
estimate_h: 0.1
time_limit_min: 20
security_review: false
unattended: true
branch: worktree-agent-a956de1c175478ed1   # 作業員のブランチ（main 11c86a8 から）
worker: W7
files_allowed:
  - eslint.config.mjs
files_forbidden:
  - src/**
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

作業員が `.claude/worktrees/<name>/` に作るビルド成果物（`.next/`）や写し（`vgdd/conformance/run.mjs` など）を、main の checkout の `npm run lint` が読んでエラーにする。作業員の worktree は別のブランチの作業場所で、main の lint の対象ではない。審査：深さと実行20（審査員の環境で `npm run lint` が通る）。

## 2. 受け入れ条件

- A1. `eslint.config.mjs` の `globalIgnores([...])` の配列に `".claude/**"` を1行足す（既存の4つの項目とコメントは変えない。ほかの設定も変えない）
- A2. `npm run -s test`（既存の試験のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）
- A3. 差分のファイルは `eslint.config.mjs` の1つだけ

## 3. 開発用テスト

- なし（設定の1行）

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回
2. コミットは1つ。メッセージの先頭は `T-016: `

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。要件は main にコミット済みのこの票の §2（A1〜A3）。

## 6. 記録

（統合後に追記）
- 23:41 行政の長が W7 を起動（worktree `agent-a956de1c175478ed1`、main 11c86a8 から）。夜間キューの案（`docs/tasks/night-queue.proposed.json`）はないため昼の作業員で実施
