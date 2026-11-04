---
id: T-009
title: docs/ideas.md に「その後」の列を足し、M10 で見送った案を追記する（V8 夜間ハーネスの試験運転用の小さな票）
status: ready
requirements: [A1, A2, A3, A4]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-55, D-37]   # 関連する決定（記録用。司法には渡さない）。約束11（見送った案は docs/ideas.md に残す）
proposal_from: V8 の試験運転（docs/harness.md §9。オーナーの指示 2026-11-05 00:1x）。中身は約束11 の記録の整備
estimate_h: 0.2
time_limit_min: 20
unattended: true               # 夜間ハーネスで無人で回してよい（文書だけ。依存・push・削除・要件の変更なし。オーナーの判断が要らない）
branch: null
worker: null
files_allowed:
  - docs/ideas.md
files_forbidden:
  - src/**
  - docs/requirements.md
  - docs/tasks/**
  - docs/governance.md
  - docs/harness.md
  - merge-requests/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - package.json
  - package-lock.json
depends_on: []
---

## 1. 目的

夜間ハーネス（D-55③）の最初の試験運転（V8。`docs/harness.md` §9）に使う、**小さくて判定が機械的に確かめられる票**。中身は約束11 の記録の整備：見送った案の表に「その後」の列を足し、採用・実装されたものが分かるようにする。あわせて、M10（T-004〜T-008）の作業員の報告で出た改善候補のうち、見送ったものを追記する。コードは触らない。

## 2. 受け入れ条件

- A1. `docs/ideas.md` の表の見出し行を `| 日付 | 案 | 見送りの理由 | 代わりに採用したもの | その後 |`（区切り行は `|---|---|---|---|---|`）にし、既存の8行に「その後」の値を**この順**で入れる：①P-1 30分チェックイン → `M10-1「いまの理解を整理」として実装（2026-11-04、T-004・T-005）` ②M1-4 の部分一致 → `見送りのまま` ③datalist → `見送りのまま` ④S-1 右側の履歴 → `M3 で実装（2026-11-03）` ⑤「要確認」バッジの強調 → `M6-3 で予定` ⑥複数行の入力欄 → `見送りのまま` ⑦履歴の行を開いてメモ一覧 → `M4 の S-2 で実装（2026-11-03）` ⑧他の人との比較 → `採用しない（M9-4）`。既存の4列の文は変えない
- A2. 表の末尾に、日付 `2026-11-04` の行を**3行**足す（案／見送りの理由／代わりに採用したもの／その後）：①案 `UnderstandingPanel に key={session.id} を付けて、ユーザー切替で前の結果が残らないようにする`／理由 `selectUser が active を null にして部品が外れるため実害なし（T-005 の W2 の指摘を行政の長が判断）`／代わり `—`／その後 `見送りのまま` ②案 `QuestionDraft が Fragment を返すため、縦並び（S-1）でボタンが横幅いっぱいに見える。包む要素で整える`／理由 `見た目の調整は UI の刷新（P5、11/7）でまとめて行う（T-007 の W1 の指摘）`／代わり `—`／その後 `P5 で予定` ③案 `UnderstandingPanel の応答の型を T-004 の understanding.ts の型へ寄せる（部品内の重複した型を消す）`／理由 `T-004 と T-005 を並行にするため部品内に書いた。動きに影響しない`／代わり `—`／その後 `未着手（小さな票で後日）`
- A3. 差分は `docs/ideas.md` の1ファイルだけ。表の列数は全行で5列、行の順は既存8行 → 追加3行。実在の会社名・人名・実案件の語を書かない
- A4. `npm run -s test`（135 件。コードは触らないので件数は変わらない）・`npm run -s typecheck`・`npm run -s lint` がすべて通る

## 3. 開発用テスト

- テストは書かない（文書の変更）。司法は差分で A1〜A3 を確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回（監査のため。文書だけの票でも実行する）
2. `docs/ideas.md` を Edit で直す（見出し行・区切り行・既存8行の末尾に列を足す・3行追加）
3. コミットは1つ。メッセージの先頭は `T-009: `

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。要件は `requirements_source: ticket` により **main にコミット済みのこの票の §2（A1〜A4）**。夜間は gate-runner `--hold` で判定まで（p0.3.1）。統合は朝にオーナーが `release.sh` で行う。

## 6. 記録

（統合後に行政の長が追記）
- 00:24 立法補佐（Pro）が §2 を確認（1ファイルだけ、表の列と行を値まで指定、差分で判定できる。unattended: true は文書だけの票として妥当）。main に固定（D-49②）
