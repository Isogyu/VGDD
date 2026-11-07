---
id: T-041
title: 統治シアターの下の「証拠」の7つの区画を、見出しで開閉できるようにする（最初は「統治の数字」だけ開く）
status: merged
requirements: [A0, A1, A2, A3, A4, A5]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-64]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐が起草（オーナーの承認前）。オーナーが 22:2x に案 I（証拠の区画を畳む）を採用
estimate_h: 1
time_limit_min: 90
security_review: false         # 表示の開閉だけ。データの取得と API は変えない
unattended: false
branch: worktree-agent-af8ae62ff84684ace
worker: W36
files_allowed:
  - src/lib/evidence-sections.ts                      # 新設：区画の見出しと、最初に開くかの表
  - src/lib/evidence-sections.test.ts                 # 新設
  - src/components/GovernanceView.tsx                 # 7つの区画を details で包むだけ
files_forbidden:
  - src/components/GovernanceMap.tsx
  - src/components/KernelPanel.tsx
  - src/components/KernelInvariants.tsx
  - src/components/LawHistory.tsx
  - src/components/theater/**                         # シアターの部品は T-038〜T-040 が触る
  - src/lib/governance*.ts
  - src/lib/theater-*.ts
  - src/app/**
  - docs/**
  - src/lib/db/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-034]
---

## 1. 目的

統治シアター（T-028〜T-037）の下に、11/6 までに作った「証拠」の7つの区画が続き、ページは 8,000px を超える。審査員がシアターと新しい欄を見た後に迷わないよう、7つの区画を見出しだけ並べて開閉できるようにする。最初は「統治の数字」だけ開いておく。中身は変えず、包むだけにする。シアターの部品とはファイルが重ならないので、T-038〜T-040 と並行で進められる。審査：デモ25。

## 2. 受け入れ条件

- A0. 差分を許すパスは次の3つだけ：`src/lib/evidence-sections.ts`、`src/lib/evidence-sections.test.ts`、`src/components/GovernanceView.tsx`。それ以外は変更しない。`GovernanceMap`・`KernelPanel`・`KernelInvariants`・`LawHistory` の中身は変えない
- A1. **区画の表**（`src/lib/evidence-sections.ts`。React を import しない）：`EVIDENCE_SECTIONS` を export する。各行は `{ key, title, defaultOpen }`。次の7行をこの順で（文は一字一句このまま）

  | key | title | defaultOpen |
  |---|---|---|
  | `map` | 統治の全体図 | false |
  | `kernel` | Kernel の状態 | false |
  | `invariants` | 不変条件と承認待ち | false |
  | `history` | 法律が判例で育った歴史 | false |
  | `numbers` | 統治の数字 | true |
  | `board` | 票の盤 | false |
  | `fate` | 票1枚の運命 | false |

- A2. **包み方**（`GovernanceView.tsx`）：
  - データを取った後の表示で、今の7つの区画（`GovernanceMap`、`KernelPanel`、`KernelInvariants`、`LawHistory`、「統治の数字」の `section`、「票の盤」の `section`、「票1枚の運命」の `section`）を、`EVIDENCE_SECTIONS` の同じ `key` の行を使って、1つずつ HTML の `details` 要素で包む。`details` の `open` の初期値は `defaultOpen`、`summary` の文は `title`
  - `summary` は押しやすい大きさにし（例：`cursor-pointer py-2 font-medium`）、キーボード（Tab と Enter・Space）で開閉できる（`details` と `summary` の標準の振る舞いを使い、独自の開閉の処理を足さない）
  - 包まれた区画の中身・順番は変えない。閉じている区画も、いつも `details` の中にマウントしたままにする（開閉で条件付きの描画や作り直しをしない）。`GovernanceMap` と `KernelPanel` の 60 秒ごとの取得と、`KernelInvariants` と `LawHistory` のマウントのときの取得は、今のまま
  - A1 の `title` は、新しく作る外側の `summary` だけに使う。区画の中の今の見出しと `aria-label` は、文の違いや重複があっても、消さず・変えず・隠さない
  - 見出しの区画（「証拠：実運用の集計・票の記録・検証結果」の `h2`、説明の文、「← 作業画面へ」）は残し、説明の文の後に1文「見出しを押すと開きます」を足す
  - `GovernanceView` 自身の取得中・失敗のときの今の表示（早めの return）は変えず、その間は7つの `details` を出さない。取得に成功した後は、子の取得の状態によらず7つの `details` を出す。子の取得中・失敗・停止などの表示は中身を変えず、閉じた区画ではほかの中身と一緒に隠れてよい
- A3. **公開してよい項目だけ**：足すのは A1 の見出しと A2 の1文だけ。通信・保存・console への出力を足さない
- A4. 試験：
  - `evidence-sections.test.ts`：`EVIDENCE_SECTIONS` の7行の `key`・`title`・`defaultOpen` が A1 の表どおりで、`defaultOpen` が true なのは `numbers` だけ
  - `GovernanceView.tsx` の開閉と収まりは SSR の試験では確かめにくいので、§3 で立法補佐が held の候補で確かめる
- A5. `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る

## 3. 開発用テスト

held の後、release の前に、立法補佐が held の候補を一時的な作業ツリーで動かして確かめる。

- シアターの下の「証拠」で、7つの見出しが並び、「統治の数字」だけ開いている。ページの長さが今より短くなる
- 見出しを押す・Tab と Enter で、各区画が開閉し、中身が今と同じ
- 統治シアター（最初の画面）と、判例の比較・判断待ち・Claude Code の使い分けの欄は変わらない
- 375px で横スクロールしない

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. A1（表と試験）→ A2
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。シアターの部品（T-038〜T-040）とファイルが重ならないので、並行で作業員を起動してよい。統合の順は、held になった順でよい。

## 6. 記録

- 22:36 行政の長が W36 を起動（worktree `agent-af8ae62ff84684ace`、T-038 を統合した後の main 0a6de21 から、モデルは Opus。T-039 の W35 と並行）。仕様はオーナーが 22:31:30 に approve-spec で承認済み（22:34:42 の Kernel の写しの `approvals[].current` で確かめた）。依存の T-034 は統合済み
- W36 の報告：HEAD `7a506e35a86c6c8c705d853ad611c99e3eb1dbf1`、0a6de21 の上に1コミット。test 907 件（48 ファイル）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:875` の `stopsDir` で差分の外）。§2 から外れる解釈はない
- 行政の長の確認（試験は再実行していない）：差分は A0 の3つだけ（+170 / -84。`GovernanceView.tsx` の増減の多くは包んだ区画の字下げで、空白の違いを除くと 35 行）。`EVIDENCE_SECTIONS` の7行は A1 の表と一字一句同じで、`defaultOpen` が true なのは `numbers` だけ。7つの区画は今の順のまま、それぞれ `details` で包まれ、中身は空白の違いを除いて変わっていない。開閉は `details` と `summary` の標準の振る舞いだけで、state・onClick・onToggle・条件付きの描画・`key` の変更はない。区画の中の見出しと `aria-label`、早めの return、見出しの区画は残っている。`GovernanceMap`・`KernelPanel`・`KernelInvariants`・`LawHistory` とシアターの部品は変わっていない
- `open` の渡し方：React には `details` の `defaultOpen` がないので、行ごとに決まった定数（`defaultOpen`）を `open` に渡す。値が変わらないので、再描画で React が DOM の `open` を書き直すことはなく、押して開閉した状態が残る（W36 の説明。動かしては確かめていない）。包む部品 `EvidenceDetails` はモジュールの最上位に置き、再描画で作り直されないようにした
- 読み方が割れる所（W36 の選んだ読み方）：(1) 「説明の文の後に1文を足す」は、説明の `p` の直後に新しい `p`（同じ文字の色）を置いた。元の説明の文が句点で終わっていないので、足した1文にも句点を付けない (2) `details` には class を付けない（区画の間隔は今の親の `gap-6`）
- 補った解釈（文面の範囲内）：(1) 包む役目を `EvidenceDetails` の1つにまとめた (2) 表に行が見つからないときの予備（`?? false`・`?? sectionKey`）を置いた（key は型で7つに限るので、実際には使われない） (3) 試験に「各行は3つの項目だけ」「key が重ならない」を足した
- **確かめていない**：実際の開閉（クリック、Tab と Enter・Space）と、押した状態が再描画で戻らないこと、閉じた区画で `GovernanceMap`・`KernelPanel` の 60 秒ごとの取得が続くこと（子はアンマウントしないので止まらないはず、という推論）、ページの長さが短くなること、375px で横スクロールしないこと、`npm run build`。§3 で立法補佐が held の候補で確かめる

## オーナーに聞くこと

1. 最初に開いておくのは「統治の数字」だけにする（実運用の集計がひと目で分かるため）

- 2026-11-07T22:42:10+0900 gate-runner: status → review（判定に合格（judge=APPROVED codex=APPROVED）。夜間のため統合せず、朝のオーナーの承認を待つ）

- 2026-11-07T22:50:51+0900 release: status → merged（main=8e1333e71fdc。夜間の判定に合格した候補 14237515803d を、オーナーが朝に承認して統合）
