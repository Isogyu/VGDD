---
id: T-047
title: 公開の /governance の「証拠」の7つの区画を、最初からすべて開いておく（T-041 で閉じた6つが「なくなった」と見えるため）
status: ready
requirements: [A0, A1, A2, A3]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [T-041]   # 記録用。司法には渡さない
proposal_from: 2026-11-08 18:1x 行政の長が起草（オーナーの承認前）。オーナーの言葉「最初にあった UI の機能がなくなっているように見受けられる」の調べ（docs/drafts/run-public-app.md と同じ日の報告）
estimate_h: 0.3
time_limit_min: 30
security_review: false         # 区画の開閉の初期値と案内の1文だけ。表示する中身は変えない
unattended: false
branch:
worker:
files_allowed:
  - src/lib/evidence-sections.ts                      # defaultOpen の値だけ
  - src/lib/evidence-sections.test.ts                 # 試験を今の値に合わせる
  - src/components/GovernanceView.tsx                 # 案内の1文だけ（A2）
files_forbidden:
  - src/components/theater/**
  - src/components/Kernel*.tsx
  - src/lib/kernel-*.ts
  - src/app/**
  - docs/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: []
---

## 1. 目的

T-041（7a506e3）で、公開の /governance の「証拠」の7つの区画を `<details>` で包み、「統治の数字」のほかの6つ（統治の全体図・Kernel の状態・不変条件と承認待ち・法律が判例で育った歴史・票の盤・票1枚の運命）を最初は閉じた。そのため、Kernel の状態の区画とその中の予算と実行の表（T-045・T-046）が、見出しを押すまで見えず、オーナーには「最初にあった機能がなくなった」と見えた。コードの削除はない（`git log --diff-filter=D -- src` は空）。開閉はそのまま残し、最初はすべて開いておく。審査：深さ（統治の状態が一目でわかる）・正直さ（見える場所に出す）。

## 2. 受け入れ条件

- A0. 差分を許すパスは次の3つだけ：`src/lib/evidence-sections.ts`、`src/lib/evidence-sections.test.ts`、`src/components/GovernanceView.tsx`。それ以外は変更しない。依存を足さない
- A1. `src/lib/evidence-sections.ts` の `EVIDENCE_SECTIONS` の7行で、`defaultOpen` をすべて `true` にする。`key`・`title`・並びの順・型は変えない。先頭の説明のコメントの「最初に開いておくのは「統治の数字」だけ」は、「最初はすべて開いておく（T-047）」に直す
- A2. `src/components/GovernanceView.tsx` の案内の文「見出しを押すと開きます」（今の 166 行目の `<p>` の中身）を「見出しを押すと閉じます」に変える。`GovernanceView.tsx` のほかの行（`<details>` の使い方・`open` の初期値を `defaultOpen` から取ること・区画の中身・取得）は変えない
- A3. 試験：`src/lib/evidence-sections.test.ts` を今の値に合わせる（7行の `key`・`title`・`defaultOpen` の表が A1 のとおりで、`defaultOpen` が `true` の行の key が7つとも並ぶこと）。そのうえで `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る

## 3. 開発用テスト

held の後、立法補佐かオーナーが候補で `/governance` を開き（`bash docs/drafts/run-public-app.sh` を候補の作業ツリーで、または統合の後に）、証拠の7つの区画が最初から開いていて、見出しを押すと閉じること、Kernel の状態の区画の中に「予算と実行（台帳の集計）」が見えることを確かめる。

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. A1 と A3 → A2
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。ほかの票とファイルが重ならない。

## 6. 記録

- 18:1x 行政の長が起草（オーナーの承認前）。調べの根拠：`src/lib/evidence-sections.ts:15-23`（6つが `defaultOpen: false`）、7a506e3（T-041）。凍結（14:00）の後の起草なので、入れるかはオーナーの判断。締切の前に入らなければ、録画では各区画の見出しを押して開く
