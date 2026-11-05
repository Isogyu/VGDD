---
id: T-021
title: 作業画面の見出しに、チームの知恵・共有の記録・統治のライブ画面への導線を置く
status: review
requirements: [A1, A2, A3]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M7-2, M8-2]   # 記録用。司法には渡さない
proposal_from: 開発スケジュール 段階1。/knowledge（T-015）・/shares（T-014）・/governance（T-013）は URL を直接入れないと開けない。2026-11-06 立法補佐が起草（オーナーの承認前）
estimate_h: 0.2
time_limit_min: 25
security_review: false
unattended: true
branch: worktree-agent-a78465bf2bc659142   # 作業員のブランチ（main 1b09519 付近から）。統合キュー（p0.3.1）により main から分岐したまま申請
worker: W15
files_allowed:
  - src/components/WorkScreen.tsx
files_forbidden:
  - src/lib/**
  - src/app/**
  - src/components/ShareReview.tsx
  - src/components/ShareRecords.tsx
  - src/components/TeamKnowledge.tsx
  - src/components/GovernanceView.tsx
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

審査員とデモの視聴者が、作業画面（S-1）から、チームの知恵（S-4）・本人の共有の記録・統治のライブ画面に1クリックで行けるようにする。審査：デモ25（3分で画面を行き来する）、深さと実行20（審査員が触れる）。

## 2. 受け入れ条件

- A1. `src/components/WorkScreen.tsx` の見出し（`<header>` の中、`<h1>` と ユーザーのセレクタの間）に、`next/link` のリンクを3つ、この順・この文で足す：「チームの知恵」→ `/knowledge`、「共有の記録」→ `/shares`、「統治のライブ画面」→ `/governance`。リンクは `<nav aria-label="ほかの画面">` で包む。狭い画面では折り返す（`flex flex-wrap`）。見た目は既存の `text-sm` とリンクの書き方（`underline-offset-2 hover:underline`）に合わせる
- A2. `WorkScreen.tsx` のそれ以外（状態・API の呼び出し・既存の要素と文）は変えない。リンクを足すための `import Link from "next/link"` が既にあればそれを使う
- A3. `npm run -s test`（既存の試験のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは `src/components/WorkScreen.tsx` の1つだけ

## 3. 開発用テスト

- なし（画面の部品）。統合の後に、ユーザー役が S-1 から3つの画面に行けることを確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回
2. コミットは1つ。メッセージの先頭は `T-021: `

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。要件は main にコミット済みのこの票の §2（A1〜A3）。T-019・T-020 と触るファイルが重ならない。

## 6. 記録

（統合後に追記）
- 01:17 行政の長が W15 を起動（worktree `agent-a78465bf2bc659142`）。仕様はオーナーが 01:12 に approve-spec で承認済み（立法補佐の伝達）。T-020 と並行（触るファイルは重ならない）
- 01:19 W15 の報告：コミット 5881597（1ファイル、+12）。`<h1>` とセレクタの間に `<nav aria-label="ほかの画面">`（`flex flex-wrap items-center gap-3 text-sm`）とリンク3つ（既存の `Link` の import を使用）。test 245・typecheck・lint 合格。逸脱・拒否なし（`npm ci` で `.github` の TAR_ENTRY_ERROR の警告が出たがインストールは完了）。画面は未確認
- 01:19 行政の長が差分を確認（`WorkScreen.tsx` のみ、追加 12 行、削除なし。順と文と href が A1 のとおり）。`status: review` で main にコミットし申請
