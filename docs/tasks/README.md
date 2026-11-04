# タスク票（docs/tasks/）

VGDD 本稼働（D-45・D-46）で、行政の長（Max 本体）が受け入れ基準をタスク票に分け、作業員（サブエージェント）が別々の git worktree で並行に実装するための票。1票＝1ブランチ＝1回の統合審査。

## 形式

ファイル名：`T-NNN-<短い英語の slug>.md`。先頭に YAML の front matter、本文に受け入れ条件と手順を書く。

```yaml
---
id: T-001
title: 整理結果の「前回との比較」
status: ready          # ready | in_progress | review | merged | rejected | blocked
requirements: [A1, A2, A3]   # 司法が判定する条件の ID。requirements_source: ticket なら本文 §2 の「- A1.」…（p0.2.1 以降の標準）
requirements_source: ticket  # ticket：§2 を要件として judge に渡す（main にコミット済みの票から読む）。省略時は docs/requirements.md の ID
related_requirements: [M4-2, D-40]   # 関連する docs/requirements.md の ID（記録用。司法には渡さない）
proposal_from: M4 の提案（2026-11-03 オーナー採用）
estimate_h: 0.5
branch: task/T-001-summary-compare
worker: null           # 割り当てた作業員（W1〜W4）。並行中の衝突を見るため
unattended: false      # true なら夜間ハーネスが無人で回してよい票（オーナーの判断が要らない。依存の追加・push・削除・要件の変更を伴わない）。既定 false。オーナーが票ごとに決める（D-55③）
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
2. **受け入れ条件**：`- A1.` `- A2.` … の形で、目に見える・検証できる形で書く（「〜が画面に出る」「API が〜を返す」「テスト〜が通る」）。`requirements_source: ticket` の票では、司法はこの節だけを要件として判定する（docs/requirements.md の ID は持ち出さない）。**票は作業を始める前に main にコミットする**（判定は main の票から読む。立法補佐が条件を確認して固定する。D-49②）
3. **開発用テスト**：作業員が書くテストの観点（評価用テストは別。オーナーが書く）
4. **手順の案**：行政の長が書く最小の設計。作業員はこれから逸脱してよいが、逸脱は `docs/implementation-notes.md` に記録する
5. **統合審査**：merge-gate が見る条件（決定論的な監査＋judge＋Codex judge）。票ごとの追加条件があれば書く
6. **記録**：作業員の報告、judge の判定 ID、統合の日時（統合後に行政の長が追記）

## 受け入れ条件の書き方（T-004〜T-008 の差し戻しと不一致から。2026-11-05）

司法（judge・Codex judge）は**差分・票の §2・決定論的な監査の結果**だけで判定する。11/4 の夜に起きた不一致・差し戻しは、どれも条件の書き方で防げた：

- **文字や値の集合は列挙する。**「句読点」「記号」のような語は範囲が閉じていない。`。．、，：:！？!?` と空白、のように字を並べる（T-008 A2 ③。OBS-031。Codex が絵文字、次にコロンで境界を突いた）
- **例と反例を並べる。**「〜を含めば none」の横に「ただし『〜が、…可能性がある』は inferred」のような反例を置き、テストにも同じ文で入れる（T-008 A5 ③の2。OBS-029）。「ある」「あれば」のような語は、空の配列や空文字をどう扱うかを書く（T-004 A3「answers がある」。OBS-024）
- **司法が差分で確かめられる形だけを条件にする。**コミットの本文・会話・報告に書くことを条件にしない（司法にはコミットの本文を渡していない。T-008 A5の2。OBS-032）。「〜しない」の条件は、差分で見える形（「既存のテストを変えない」なら、どのファイルの既存の `it(` が残っていること）にする
- **既存のテストが不具合そのものを期待しているときは、票にそう書く。**「既存のテストは変えない」と「不具合を直す」が同時に満たせない組み合わせがある（T-008 A4② と A5）。直す前に既存のテストを読み、変える必要がある行を票に列挙する
- **条件は閉じた文にする。**判定に必要な情報が票の中で揃うように（関数名・引数・返り値・判定の順・件数）。関連する要件 ID は `related_requirements` に残し、§2 からは参照しない
- 票は作業の前に立法補佐が確認して main に固定する（D-49②）。固定後に矛盾が見つかったら、作業員は**止まって報告する**（T-008 の W2 が正しい例）。明確化はオーナーの解釈で立法補佐が行い、行政は §2 を変えない

## 法律（票に書かなくても常に効く）

- 作業員は `files_allowed` の外を変えない。変えた差分は merge-gate が拒否する
- `.claude/**`・`CLAUDE.md`・`.github/**`・`vgdd/**` は worktree の中でも変えられない（フック p0.2.1 で拒否。sandbox も書き込みを拒む）
- main への統合は gate-runner（`vgdd/scripts/gate-runner.sh`。sandbox の外でオーナーが起動）だけが行う。条件：決定論的な監査の合格、judge の APPROVED、Codex judge の APPROVED（重大な指摘で分かれたらオーナー）
- **main が進んで作業ブランチが main を含まなくなっても、積み直しは不要**（p0.3.1 の統合キュー、`docs/harness.md` §4b）。gate-runner が申請ごとに「最新の main ＋ 申請の SHA」の候補を作って検査・統合する。各票は main から分岐したまま申請してよく、鎖で積まない。衝突（`needs_rebase`）になったときだけ直す。worktree で `git rebase main` はしない（main の変更に `vgdd/**`・`.claude/**` が含まれると sandbox に止まる。T-000 で確認）。直すときは新しい worker を `isolation: worktree` で起こし、元のコミットを `git cherry-pick` させる
- 依存パッケージの追加・削除・push は作業員にはできない（ask。行政の長がオーナーに申請する）
- 票の `status` は行政の長だけが変える（夜間は `night-runner` が代行する。`status` と §6 の行だけ。D-55③、`docs/harness.md`）
- 夜間ハーネスが取る票は `unattended: true` かつ `requirements_source: ticket` かつ `depends_on` がすべて `merged` のものだけ。キュー（順番）はオーナーが Z3 に置いて承認する
