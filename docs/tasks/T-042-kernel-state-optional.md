---
id: T-042
title: Kernel の写しの読み取りを、予算・実行・受け入れの新しい項目（任意）にも対応させる（新旧の両方の写しを読める）
status: review
requirements: [A0, A1, A2, A3, A4]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-66, D-67]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐が起草（オーナーの承認前）。全範囲の設計（docs/drafts/vgdd-full-scope-design.md）§8 の「読む側を先に両対応にする」
estimate_h: 1
time_limit_min: 90
security_review: true          # 写しの検証（公開の項目）を変える
unattended: false
branch: worktree-agent-ae281dd538eefffc0
worker: W43
files_allowed:
  - src/lib/kernel-state-schema.ts                    # 任意の3項目の検証と型を足すだけ
  - src/lib/kernel-state.test.ts                      # 試験を足す
files_forbidden:
  - src/lib/kernel-state.ts                           # 読み込みは変えない
  - src/lib/kernel-invariants*.ts
  - src/lib/theater-*.ts
  - src/components/**
  - src/app/**
  - src/lib/db/**
  - docs/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-022, T-030]
---

## 1. 目的

全範囲の設計（D-66・D-67）では、Kernel の写し（`kernel-state.json`）に、予算・実行の記録・受け入れの集計を足す。写しの検証は厳しく（余分な項目があると写し全体を拒む）、書く側（Kernel、法律の改正 L1・L3）を先に変えると、今の画面が写しを読めなくなる。そこで先に読む側を、新しい3項目が**あってもなくても**読めるようにする。項目の形はここで決め、L1・L3 はこの形で書く。数と ID だけで、理由の本文・パス・ハッシュは持たない。審査：深さ20。

## 2. 受け入れ条件

- A0. 差分を許すパスは次の2つだけ：`src/lib/kernel-state-schema.ts`、`src/lib/kernel-state.test.ts`。それ以外は変更しない。今の項目と今の入力に対する検証・整形・`verdicts.by_task` の扱い（`pickKernelState`・`toWire`・`formatJst`）は変えない。A1 の新しい3項目を受け取り、`pickKernelState` と `toWire` の結果に保つ変更は許す。3項目はそれぞれ独立に省いてよく、省いた項目を作り足さない
- A1. **任意の3項目**（`kernelStateSchema` の strict のまま、次の3つを `.optional()` で足す。書かれていなければ検証を通り、値は `undefined`）：
  - ここでの「数」は 0 以上 `Number.MAX_SAFE_INTEGER` 以下の整数で、新しい3項目だけの検証を使う（今の `Count`（上限 100 万）と `Iso` は流用もしないし変えもしない）。票の ID は今の `TaskId` と同じ（`T-` と ASCII の数字3〜4桁）
  - `budget`：`{ period_id: 文字列（1〜40字）, until: 次の形の日時の文字列か null（`YYYY-MM-DDTHH:MM:SS`、続けて任意で `.` と1〜9桁の小数秒、最後に `Z` か `+HH:MM`・`-HH:MM`。全体で 40 字まで。この形で、暦の上で存在する日時であること（2月30日・24時・60秒などは拒む）。秒の省略や10桁以上の小数秒は受け付けない）, tokens: { settled: 数, reserved: 数, unknown_runs: 数, limit: 数か null }, judge_calls: { used: 数, limit: 数か null }, attempts: { used: 数, limit: 数か null }, workers: { active: 数, limit: 数か null } }`（すべての階層で strict）。集計の対象は `period_id` の期間
  - `runs`：`{ requested: 数, reserved: 数, started: 数, exited: 数, settled: 数, cancelled: 数, liveness_unknown: 数, usage_unknown: 数 }`（strict）。`requested`〜`cancelled` は今の状態ごとの件数、`liveness_unknown`・`usage_unknown` はそれぞれの不明の件数で、ほかの件数との重なりを許す。集計の対象は `period_id` の期間
  - `acceptance`：`{ accepted_count: 数, pending_count: 数, accepted: 票の ID の配列（最大 500）, pending: 票の ID の配列（最大 500） }`（strict）。件数は配列の長さ以上
  - 型 `KernelState` に、この3つを任意の項目として含める（`KernelStateWire` も同じ）
- A2. **公開してよい項目だけ**：3項目に、文字列は `period_id`・`until`・票の ID しか入らない。それ以外の項目（理由の本文・パス・ハッシュなど）が中にあれば strict で拒む
- A3. 試験（`kernel-state.test.ts` に足す。今の試験はそのまま）：3項目のない今の写し（リポジトリの `docs/governance/snapshots/submission/kernel-state.json` を含む）が今までどおり通ること。3項目の正しい合成の値が通り、`toWire` で同じ値が返ること。足したすべての階層の余分な鍵、数の欄の負の数・小数・安全な整数の範囲外、配列の票の ID でない文字列と 501 件、長すぎる `period_id`、不正な `until`（秒の省略・10桁の小数秒・タイムゾーンなし・存在しない日時を含む）、件数が配列の長さより小さい `acceptance` で、写し全体が `null` になること。30,000,000 が通ること。3項目のうち1つだけを足した写しが通ること
- A4. `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る

## 3. 開発用テスト

held の後、立法補佐が候補で `/governance` を開き、提出記録・稼働中の観測の両方が今までどおり出ることを確かめる（3項目のない写し）。

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. A1 → A3
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ Codex security。法律の改正 L3（書く側）より前に統合する。

## 6. 記録

- 23:52 行政の長が W39 を起動（worktree `agent-a2268f64d923de204`、main f4c3403 から、モデルは Opus。T-040 の W38・T-043 の W40 と並行。D-67 の同時3体の枠の中）。仕様はオーナーが 23:49:57 に approve-spec で承認済み（23:51:40 の Kernel の写しの `approvals[].current` で確かめた）。依存の T-022・T-030 は統合済み。作業員の起動は Kernel の窓口の外（法律の改正 L2 の配置の前のため、予算の管理の外）
- W39 の報告：HEAD `d37a2a7fdf819af0a0257194bac869bd71216e8c`、f4c3403 の上に1コミット。test 967 件（49 ファイル。`kernel-state.test.ts` は 54 件で、今の 41 件は1行も変えていない）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:875` の `stopsDir` で差分の外）。§2 から外れる解釈はない
- 行政の長の確認（試験は再実行していない）：差分は A0 の2つだけ（+325 / -2）。`kernel-state-schema.ts` で変わったのは、新しい3項目の検証（`SafeCount`＝0 以上 `MAX_SAFE_INTEGER` 以下の整数、`OffsetDateTime`、`budget`・`runs`・`acceptance` の strict のスキーマ）を足したこと、`kernelStateSchema` に3つを `.optional()` で足したこと、3つの型の export、コメントの1行だけ。今の `Count`・`Iso`・`TaskId`・今の項目・`pickKernelState`・`toWire`・`formatJst` は変わっていない（`TaskId` は流用）。省いた項目は鍵ごと出ないことを試験で確かめている
- 読み方が割れる所（W39 の選んだ読み方）：(1) 「タイムゾーン付きの有効な日時」は、秒まで必須・小数秒は 1〜9 桁まで任意・タイムゾーンは `Z` か `±HH:MM`（`+0900` と分なしは拒む）・うるう秒（`:60`）は拒む・暦の上で有効な日時、とした。書く側（L1・L3）がこの形で出すかの確認が要る (2) 「件数は配列の長さ以上」は、`accepted_count >= accepted.length` と `pending_count >= pending.length` のそれぞれの組とした
- 補った解釈（文面の範囲内）：(1) `until` の長さの上限を 40 字にした（文面に上限はない） (2) `period_id` の文字の種類は制限しない（文面は「文字列（1〜40字）」だけ。40 字以内なら任意の文が入る） (3) 3つの型 `KernelBudget`・`KernelRuns`・`KernelAcceptance` を export した (4) 試験を文面より広げた（数の欄の `"1"`・NaN・Infinity・null、3項目の鍵の欠け、3項目の値が null・配列・文字列・数）
- **確かめていない**：画面（`/governance`）で提出記録と稼働中の観測の両方が今までどおり出ること（今の写しと提出記録が `pickKernelState` を通ることは試験で確かめた）、`npm run build`。§3 で立法補佐が held の候補で確かめる

## オーナーに聞くこと

1. 3項目の形（A1）を、法律の改正 L1・L3 で書く形として固定する

- 2026-11-08T00:01:24+0900 gate-runner: status → in_progress（セキュリティ審査が差し戻し）
- 01:3x 差し戻しの原因は、§2 の A1 の `until` の形が曖昧だったこと（オーナーが Z3 の指摘を共有）。立法補佐が §2 に形を書いた（77e3e37）。行政の長が「`Date.parse` が数を返すこと」の読み方が割れることを知らせ（Node の `Date.parse` は 2月30日・24時に数を返すが、実装は拒む）、オーナーが「存在しない日時も拒む」に決めた。立法補佐が §2 に書き（a0e8f40）、オーナーが 01:56:51 に approve-spec で承認し直した（02:02:24 の Kernel の写しの `approvals[].current` で確かめた）
- 01:58 行政の長が W42 を起動（worktree `agent-ae7854a6b38ec3d46`、main a0e8f40 から、モデルは Opus）。W39 の `d37a2a7` を cherry-pick させ、コードは変えずに試験を足させた。作業員の起動は台帳の外（法律 p0.4.9 は司法の呼び出しだけを台帳に通す。昼の作業員は次の改正 L2 で窓口に寄せる）
- W42 の報告（1回目）：HEAD `af6dc79`。`kernel-state-schema.ts` は `d37a2a7` と同じ。足した試験は次のとおり。不正な `until` の一覧に、秒の省略2件・10桁の小数秒・桁のない小数点・4月31日・小数秒つきの24時。新しい試験で、境目の値（9桁の小数秒・2028-02-29・23:59:59・月末など8件）が通ること。**W42 は件数を数えるために `npx --no-install vitest run src/lib/kernel-state.test.ts` を1回使った**（作業員の決まりでは使わない。読み取りだけで、ファイルは変わっていない）
- 読み方が割れる所（オーナーが決めた）：月の日数を `Date.UTC(year, month, 0)` で求めると、0〜99 年が 1900 年代として扱われ、`0000-02-29` を拒んでいた（ISO 8601 の暦では 0 年はうるう年で、`Date.parse` は数を返す）。グレゴリオ暦に0年はないと読めば拒んでよく、ISO 8601 の暦と読めば通すべきなので、オーナーに知らせた。オーナーは (b)「ISO 8601 の暦のとおり通す」に決めた。§2 は変わらないので、承認し直しは要らない
- W42 の報告（2回目）：HEAD `d39d51f50bce57e773895ea6bc8ea6a73fb2c238`、a0e8f40 の上に1コミット（2ファイル、+352 / -2）。`isValidOffsetDateTime` の月の日数を `setUTCFullYear` で求める形に直した（`d37a2a7` との差はこの1行だけ）。`0000-02-29` が通る試験と、`0001-02-29` を拒む試験を足した。test は 992 件（49 ファイル）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:880` の `stopsDir` で差分の外）。npx は使っていない
- 行政の長の確認（試験は再実行していない）：差分は A0 の2つだけ。`af6dc79` からの差は、直した1行と試験の値の2件だけ。今の試験（T-042 より前からあるもの）の中身は変わっていない（`kernel-state.test.ts` の import の1行に `expectTypeOf` を足しただけ）。Node で `setUTCFullYear` が 0 年の2月を29日、1 年の2月を28日にすることを確かめた
- 補った解釈（文面の範囲内）：(1) `until` の長さの上限を 40 字にした。§2 の形で一番長いのは 35 字なので、40 字の境目は形に合わない文字列にしか当たらない (2) `period_id` の文字の種類は制限しない (3) 3つの型 `KernelBudget`・`KernelRuns`・`KernelAcceptance` を export した
- **確かめていない**：画面（`/governance`）で、提出記録と稼働中の観測の両方が今までどおり出ること、`npm run build`、0〜99 年のほかの値（0004・0100 など）、書く側（L1・L3）がこの形で `until` を出すか。§3 で立法補佐が held の候補で確かめる

- 2026-11-08T02:25:37+0900 gate-runner: status → blocked（司法（codex）が同じ申請で通算 3 回使えなかった。差し戻しではない。オーナーが司法の環境を確かめてから再申請する）
- 03:1x 止まった原因は、法律 p0.4.9 の予算の窓口の不具合（端末の上で Codex が一時停止させられていた）。p0.4.9a で直り、配置された（オーナーが知らせた）。実装の差し戻しではないので、コードは変えずに今の main の上に積み直して申請し直す。承認は 01:56:51 のまま（03:14:20 の Kernel の写しの `approvals[].current` で確かめた）
- 03:15 行政の長が W43 を起動（worktree `agent-ae281dd538eefffc0`、main 7e255de から、モデルは Opus。T-044 の W44・T-043 の W45 と並行）。`d39d51f` を cherry-pick させた。作業員の起動は台帳の外（昼の作業員は次の改正 L2 で窓口に寄せる）
- W43 の報告：HEAD `7570579e21c2c7a200d333e85ed3aaa8646c805f`、7e255de の上に1コミット。衝突はない。test は 992 件（49 ファイル）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:880` の `stopsDir` で差分の外）
- 行政の長の確認（試験は再実行していない）：`git diff d39d51f 7570579 -- src/lib` は空。差分は A0 の2つだけ（+352 / -2）
- **確かめていない**：前の記録と同じ（画面、`npm run build`、0〜99 年のほかの値、書く側の形）。§3 で立法補佐が held の候補で確かめる
