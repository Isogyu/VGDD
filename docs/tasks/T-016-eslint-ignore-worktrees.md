---
id: T-016
title: lint の対象から作業員の worktree（.claude/worktrees/）を外す
status: merged
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
- 23:43 W7 の報告：コミット 8edbe97（1ファイル、+1）。test 198・typecheck・lint 合格（警告1件は既存の `vgdd/conformance/run.mjs`）。逸脱・拒否なし
- 23:43 行政の長が差分を確認（`eslint.config.mjs` の `globalIgnores` に `".claude/**"` の1行だけ。A1・A3 どおり）。`status: review` で main にコミットし申請（gate-runner `--hold` なら合格は held、統合は release.sh）

- 2026-11-05T23:44:00+0900 gate-runner: status → blocked（仕様（main の票の統治の項目と受け入れ条件）がオーナーに承認されていない、または承認の後に変わった。approve-spec.sh で承認する）
- 23:46 行政の長：blocked は仕様の承認待ち（票は 23:36 に立法補佐が起草し、オーナーの approve-spec.sh が未実施。差分 8edbe97 は問題なし）。朝にオーナーが `approve-spec.sh T-016` を実行した後、行政の長が `status: review` に戻して申請を置き直す
- 00:38 立法補佐からの伝達：オーナーが 00:25 に approve-spec で承認済み（指紋は main 9272008 の票と一致）。行政の長が `status: review` に戻して同じ 8edbe97 を再申請（コードの変更なし）

- 2026-11-06T00:47:37+0900 gate-runner: status → review（判定に合格（judge=APPROVED codex=APPROVED）。夜間のため統合せず、朝のオーナーの承認を待つ）

- 2026-11-06T00:50:55+0900 release: status → merged（main=f7f857719b6b。夜間の判定に合格した候補 51d8d22372f5 を、オーナーが朝に承認して統合）
