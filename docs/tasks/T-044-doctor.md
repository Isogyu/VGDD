---
id: T-044
title: 読み取りだけの導入診断（scripts/doctor.mjs）を足す。必要なコマンド・版・設定・保護・写しの一致を、秘密を出さずに確かめる
status: review
requirements: [A0, A1, A2, A3, A4, A5]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-66, D-67]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐が起草（オーナーの承認前）。全範囲の設計 §11 の③導入
estimate_h: 1.5
time_limit_min: 120
security_review: true          # 環境を読むスクリプト。秘密を出さないことを確かめる
unattended: false
branch: worktree-agent-adc14f6c46adfd541
worker: W44
files_allowed:
  - scripts/doctor.mjs                                # 新設：読み取りだけの診断
  - scripts/doctor.test.mjs                           # 新設：純粋関数の試験（node:test）
files_forbidden:
  - src/**
  - scripts/seed.mjs
  - scripts/demo-capture.mjs
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

VGDD を別の環境に置く人（IT の担当者）が、置く前と後に「何が足りないか」を確かめられるようにする。今は `docs/adoption.md` の確認表を人が読むだけ。読み取りだけの診断を足し、必要なコマンド・版・設定・保護・写しの一致を、秘密を出さずに一覧にする。直すことはしない（書き込まない）。WSL2 の検証（`docs/drafts/windows-wsl2-check.md`）の①②でも使う。審査：深さ20（安心して使える形）。

## 2. 受け入れ条件

- A0. 差分を許すパスは次の2つだけ：`scripts/doctor.mjs`、`scripts/doctor.test.mjs`。それ以外は変更しない。依存を足さない（Node の組み込みだけ）。**子プロセスと shell を一切起動しない**（外部のコマンドは実行しない）
- A1. **診断の項目**（`node scripts/doctor.mjs [--repo <パス>] [--z3 <パス>] [--json]`。既定の `--repo` は今のフォルダ、`--z3` は環境変数 `VGDD_Z3_DIR`、なければ `~/tsubuyaki-z3`）。項目ごとに `ok`・`warn`・`fail`・`skip` と、決まった短い文を出す：
  1. Node.js の版（`process.versions.node`）：24 以上は `ok`、22〜23 は `warn`「適合性テストだけ動く」、22 未満は `fail`
  2. `git`・`jq`・`shasum`・`npm`・`python3` が `PATH` の上に実行できる通常のファイルとしてあるか（存在を調べるだけで、実行しない。`sha256sum` は `shasum` の代わりとして合格にしない）。1つでもなければ `fail`
  3. OS（`process.platform`）と `sandbox-exec`：macOS で `/usr/bin/sandbox-exec` があれば `ok`、macOS で `/usr/bin/sandbox-exec` がなければ `fail`。macOS 以外の OS は `warn`「裁判所の監査の sandbox は macOS 専用。この OS では実稼働の安全制御は未検証」（`fail` にしない）
  4. `--repo` の `.claude/settings.json`：ない・JSON として読めない・`sandbox.enabled` が true でない、はどれも `fail`（値の中身は出さない）
  5. `--repo` の `vgdd/settings.v2.json`（設定の原本）：なければ `fail`
  6. `--z3` のフォルダ：なければ `warn`「Kernel の保護領域がない。clone で試すだけなら不要」で、7 は `skip`。あれば `bin/`・`hooks/`・`evidence/` の有無を見て、足りなければ `warn`
  7. `--z3` があるとき、許可リストのファイル（`vgdd/scripts/` の `gate-runner.sh`・`judge.sh`・`judge-codex.sh`・`release.sh`・`night-runner.sh`・`sandboxed-run.sh`・`kernel-state.mjs`・`spec-digest.mjs`・`approve-spec.sh` と `vgdd/hooks/policy.mjs`）について、`--z3` の `bin/`・`hooks/` の同じ名前のファイルと中身（`node:crypto` の SHA-256。値は出さない）が同じか。違う・ないは `warn`「配置済みの写しが原本と違う：<許可リストのファイル名>」
  8. `--repo` の `.env.local` は `lstat` で有無だけを見る（開かない・読まない・ハッシュしない）。有れば `ok`「API キーの設定ファイルがある（中身は読んでいない）」、なければ `ok`「API キーの設定ファイルはない（API なしで動く）」
  - 読めない対象のファイルは `fail`。内容を読むのはサイズの上限つきの通常のファイルだけ（設定の JSON は 1MiB、比べるファイルは 10MiB）。記号リンク・特殊なファイルはたどらず、固定の結果にする
  - 通常の形式では、出力の最後に固定の1行「この診断は導入の完了や実稼働の安全を保証しない」を出す。`--json` では、この文を A3 の形の `note` に入れる
- A2. **読み取りだけ**（診断の本体）：ファイルを書かない・消さない・動かさない。ネットワークに出ない。終了コードは、`fail` が1つでもあれば 1、それ以外は 0
- A3. **秘密を出さない**：標準出力と標準エラーに出してよいのは、固定の項目の ID・状態・固定の文と、A1-7 の許可リストのファイル名だけ。環境変数の値、ファイルの中身、パス（`HOME` を含む）、CLI の引数、例外の message と stack を出さない。`--json` は `{ "items": [{ "id", "status", "message" }], "note": "この診断は導入の完了や実稼働の安全を保証しない" }` だけ
- A4. 試験：`node --test scripts/doctor.test.mjs` が終了コード 0 で通ること（vitest の対象外なので、`npm run -s test` とは別に動かす）。`doctor.mjs` を import しただけでは診断・出力・`process.exit` が起きないこと。判定の純粋関数（版の比較、各項目の状態、終了コード）を合成の入力で試す。試験が自分で作った一時フォルダの中だけで、合成の `--repo`・`--z3` を作り、写しが同じ・違う・ない場合、設定が不正な JSON・読めない場合、合成の秘密の文字列を入れた `.env.local` と改行を含むファイル名がある場合に、通常の形式と `--json` の両方の出力に、秘密の文字列・一時フォルダの絶対パス・`HOME` が出ないこと。本物の Z3 と本物の `.env.local` は使わない
- A5. `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る（今の試験に影響しない）

## 3. 開発用テスト

held の後、立法補佐が候補で `node scripts/doctor.mjs` と `--json` を動かし、オーナーの環境で項目がすべて出て、出力に秘密・絶対パスがないことを確かめる。

## 4. 手順の案

1. A1 の純粋関数と試験 → 本体
2. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ Codex security。ほかの票とファイルが重ならないので、並行でよい。

## 6. 記録

- 11/7 23:5x 行政の長が最初の作業員を起動し、実装を受け取った（コミット `7ba4f3d`）。§2 の2か所（A1-3 の macOS の判定、最後の固定の1行と `--json` の形）が食い違っていたため、申請せずに立法補佐に知らせた。立法補佐が §2 を直し（9998550）、オーナーが 01:33:53 に approve-spec で承認し直した（01:38 の Kernel の写しの `approvals[].current` で確かめた）
- 01:4x 行政の長が W41 を起動（worktree `agent-a28dbed9640c20221`、main b14071e から、モデルは Opus）。`7ba4f3d` を cherry-pick させ、直した §2 に合わせさせた。作業員の起動は Kernel の窓口の外（法律の改正 L2 の配置の前のため、予算の管理の外）
- W41 の報告：HEAD `085b53440bde2a4abcf8a02eac4f5d4cced96493`、b14071e の上に1コミット（2ファイル、+956）。`node --test scripts/doctor.test.mjs` は 21 件合格、test は 977 件（49 ファイル）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:880` の `stopsDir` で差分の外）。A1-3 は前の実装が直した §2 のとおりだったので本体は変えず、試験を足した（macOS で sandbox-exec がなければ fail・終了コード 1、linux と win32 は warn・終了コード 0）。`--json` は `{ items, note }` に変え、items の中の `notice` の項目を外した。合成の z3 で、通常の形式と `--json` の両方を実際に動かした
- 行政の長の確認（試験は再実行していない）：差分は A0 の2つだけ。`doctor.mjs` に `child_process`・spawn・exec の呼び出しはない。`sandboxItem` は darwin 以外を warn にする。`formatJson` は `{ items, note: DISCLAIMER }` だけを返し、通常の形式は最後に `DISCLAIMER` を出す
- 補った解釈（文面の範囲内）：(1) 引数が誤っているときも同じ形で出す（`--json` は `{ items: [{ id: "args", … }], note }`、通常の形式は最後に固定の文） (2) `--z3` が記号リンクなどでフォルダでないときは warn にし、7 は skip にする (3) 保護領域・写し・原本が読めないときは fail にする（「読めない対象は fail」）。写しが記号リンクのとき、大きすぎるとき、ないときは warn「違う」にする (4) 固定の項目の ID に `args`・`doctor` を足した
- **確かめていない**：macOS 以外の OS（Linux・WSL2・Windows）での実行（試験は platform を偽っただけ）、本物の Z3 と本物の `.env.local` での実行、`/usr/bin/sandbox-exec` が実際にない macOS、Node 22・23 での実行（実機は v25.6.0 だけ）。§3 で立法補佐が held の候補で確かめる

## オーナーに聞くこと

1. 診断は `vgdd/` の外（`scripts/`）に置く（Kernel の一部ではなく、導入の補助。法律の改正にしない）

- 2026-11-08T02:05:06+0900 gate-runner: status → blocked（司法（codex）が同じ申請で通算 3 回使えなかった。差し戻しではない。オーナーが司法の環境を確かめてから再申請する）
- 03:1x 止まった原因は、法律 p0.4.9 の予算の窓口の不具合（端末の上で Codex が一時停止させられていた）。p0.4.9a で直り、配置された（オーナーが知らせた）。実装の差し戻しではないので、コードは変えずに今の main の上に積み直して申請し直す。承認は 01:33:53 のまま（03:14:20 の Kernel の写しの `approvals[].current` で確かめた）
- 03:15 行政の長が W44 を起動（worktree `agent-adc14f6c46adfd541`、main 7e255de から、モデルは Opus。T-042 の W43・T-043 の W45 と並行）。`085b534` を cherry-pick させた。作業員の起動は台帳の外（昼の作業員は次の改正 L2 で窓口に寄せる）
- W44 の報告：HEAD `a61c0c087bee953295b62f9b2b2177cda64724c7`、7e255de の上に1コミット。衝突はない。`node --test scripts/doctor.test.mjs` は 21 件合格、test は 977 件（49 ファイル）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:880` の `stopsDir` で差分の外）
- 行政の長の確認（試験は再実行していない）：`git diff 085b534 a61c0c0 -- scripts` は空。差分は A0 の2つだけ（+956）
- **確かめていない**：前の記録と同じ（macOS 以外の OS、本物の Z3 と `.env.local`、Node 22・23）。§3 で立法補佐が held の候補で確かめる

- 2026-11-08T03:34:42+0900 gate-runner: status → blocked（司法（codex）が同じ申請で通算 3 回使えなかった。差し戻しではない。オーナーが司法の環境を確かめてから再申請する）
- 09:2x blocked の原因は、Codex の司法が書き終えた判定を予算の窓口が中断と取り違えた不具合（OBS-062。p0.4.10a で直り、09:12 に配置）で、判定ではない。ただし、そのときの判定の中身（立法補佐が Z3 で読んだ。採用はされていない）は judge APPROVED・Codex CHANGES_REQUIRED（major 1・minor 1）で、このまま申請すると major の不一致で止まる。§2 は変えずに直してから申請する。承認は 01:33:53 のまま（09:19:39 の Kernel の写しの `approvals[].current` で確かめた）。status を in_progress に戻し、起動の窓口（`merge-requests/launch/T-044.json`）で作業員を起動する
- **次の作業員への引き継ぎ（行政の長）**：
  - **出発点**：前の実装はコミット `a61c0c087bee953295b62f9b2b2177cda64724c7`（2ファイル、+956。test・typecheck・lint・`node --test scripts/doctor.test.mjs` 21 件は合格していた）。`git show a61c0c0:scripts/doctor.mjs` と `git show a61c0c0:scripts/doctor.test.mjs` で読み、Write で同じ内容を置いてから、下の2点を直してよい。ほかの判断（§6 の上の「補った解釈」(1)〜(4)）は変えない
  - **直すこと1（major、A1）**：`readLimited` の lstat と `O_NOFOLLOW` は、末尾のファイルしか守らない。親の要素（たとえば `--repo` の下の `.claude`・`vgdd`・`vgdd/scripts`・`vgdd/hooks`、`--z3` の下の `bin`・`hooks`・`evidence`）が記号リンクだと、その先の中身を通常のファイルとして読んでしまう。直し方は次のとおり。
    - 読む・比べる・有無を見るファイルごとに、`--repo` か `--z3` から末尾のファイルまでの間の各要素を lstat で確かめる。
    - 要素が記号リンクか、フォルダでなければ、中身を読まずに固定の結果にする。項目の結果は、末尾のファイルが記号リンクのときと同じにする。
    - `--repo`・`--z3` そのものの扱い（`--z3` がフォルダでなければ warn で、7 は skip）は今のまま。その上の要素（`/var` → `/private/var` など、OS の記号リンク）は確かめない。
    - 試験も足す。合成の `--repo` で `.claude` と `vgdd/scripts` を記号リンクにした場合、合成の `--z3` で `bin`・`hooks` を記号リンクにした場合に、リンクの先の中身を読まないこと（リンクの先に置いた合成の秘密の文字列と、正しい中身のどちらでも、結果が「一致」や ok にならないこと）を確かめる。
  - **直すこと2（minor、A1-2）**：`findOnPath` は、PATH の空の要素と相対のディレクトリを無条件に外している。§2 に「PATH は絶対パスに限る」という決まりはないので、shell と同じ探し方に合わせる。空の要素は今のフォルダとして扱い、相対のディレクトリは今のフォルダ（`process.cwd()`。試験では引数で渡す）から解く。存在を調べるだけで、実行しない・パスを出さないのは今のまま。試験も足す（空の要素と相対のディレクトリで見つかること）。
  - **試験**：`node --test scripts/doctor.test.mjs` が通ることも、`npm run -s test`・`typecheck`・`lint` とあわせて確かめて、報告に書く（司法の入力には差分と決定論的監査しか渡らない）

- 2026-11-08T10:05:06+0900 night-runner: 作業員の実装を前検査で確認（HEAD c7b7379）。status → review で再申請（試行 1）
