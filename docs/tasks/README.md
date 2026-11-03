# タスク票（docs/tasks/）

VGDD 本稼働（D-45・D-46）で、行政の長（Max 本体）が受け入れ基準をタスク票に分け、作業員（サブエージェント）が別々の git worktree で並行に実装するための票。1票＝1ブランチ＝1回の統合審査。

## 形式

ファイル名：`T-NNN-<短い英語の slug>.md`。先頭に YAML の front matter、本文に受け入れ条件と手順を書く。

```yaml
---
id: T-001
title: 整理結果の「前回との比較」
status: ready          # ready | in_progress | review | merged | rejected | blocked
requirements: [M4-2, D-40]   # 対応する受け入れ基準 ID（judge.sh の --req に渡す）
proposal_from: M4 の提案（2026-11-03 オーナー採用）
estimate_h: 0.5
branch: task/T-001-summary-compare
worker: null           # 割り当てた作業員（W1〜W4）。並行中の衝突を見るため
files_allowed:         # この票で触ってよいファイル。他の票と重ならないように行政の長が分ける
  - src/components/SessionView.tsx
  - src/lib/sessions.ts
  - src/app/api/sessions/[id]/route.ts
files_forbidden:       # 常に禁止（法律）。票ごとに追加してよい
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/requirements.md
depends_on: []
---
```

## 本文の節（順番は固定）

1. **目的**：何のために、誰のために（審査のどの項目に効くか）
2. **受け入れ条件**：目に見える形で書く（「〜が画面に出る」「API が〜を返す」）。/goal の完了判定にも、judge の入力にも使う
3. **開発用テスト**：作業員が書くテストの観点（評価用テストは別。オーナーが書く）
4. **手順の案**：行政の長が書く最小の設計。作業員はこれから逸脱してよいが、逸脱は `docs/implementation-notes.md` に記録する
5. **統合審査**：merge-gate が見る条件（決定論的な監査＋judge＋Codex judge）。票ごとの追加条件があれば書く
6. **記録**：作業員の報告、judge の判定 ID、統合の日時（統合後に行政の長が追記）

## 法律（票に書かなくても常に効く）

- 作業員は `files_allowed` の外を変えない。変えた差分は merge-gate が拒否する
- `.claude/**`・`CLAUDE.md`・`.github/**`・`vgdd/**` は worktree の中でも変えられない（フック p0.2.0 で拒否）
- main への統合は `vgdd/scripts/merge-gate.sh` だけが行う。条件：決定論的な監査の合格、judge の APPROVED、Codex judge の APPROVED（不一致はオーナー）
- 依存パッケージの追加・削除・push は作業員にはできない（ask。行政の長がオーナーに申請する）
- 票の `status` は行政の長だけが変える
