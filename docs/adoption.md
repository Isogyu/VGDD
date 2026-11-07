# 試す・構築する・ほかの案件に入れる

**この文書の範囲：macOS・Claude Code・Git・Node.js の案件・オーナー1人。** ほかの OS、ほかの開発エージェント、複数人の権限分離は扱いません。

## 3つの場面

| 場面 | 誰が | 何をするか | 確かめた範囲 |
|---|---|---|---|
| **A. clone で試す** | 誰でも | 適合性テストを動かし、画面と記録を読む。Kernel は実稼働しない | **確かめた**：作者の macOS の一時的な clone（main `f786d2f`、2026-11-07 01:5x、Node 25。[`validation.md` §4](validation.md)）。今の版の clone と、ほかの人の手元は未確認 |
| **B. 作者が別の場所に構築する** | 作者 | 別のフォルダと別の保護領域に、Kernel を実稼働させる | **未確認**。通した記録はない |
| **C. ほかの人が既存の案件に入れる** | ほかの人 | 自分の案件に Kernel を入れ、参照実装を必要に応じて直す | **未確認**。試した人はいない |

**確かめたのは A だけです。** Kernel を実稼働させたのは、この案件の、この開発の配置（オーナー1人・macOS の機械1台）だけです。B と C の内容は実装と運用の記録から整理したもので、手順どおりに動くことはまだ確かめていません。

数字は法律 p0.4.8・適合性テスト 414 件の時点のものです。

## 1. A：clone で試す

手順は [README の「再現」](../README.md)にあります。

| できること | 確かめられる範囲 |
|---|---|
| 適合性テスト（`node vgdd/conformance/run.mjs`。`jq`・`shasum`・UTF-8 のロケールが要る） | 使い捨ての試験用リポジトリと偽の Z3 の上で、止めるべき操作が止まり、通すべき操作が通ること。LLM は呼ばないので、判定の中身ではなく判定の扱いを試す |
| 前の版との比較 | 法律の版の差は [`vgdd/kernel/history.json`](../vgdd/kernel/history.json) と Git の履歴で追える |
| `/governance` | 統治の数字・票の盤・票1枚の運命・法律の歴史。全体図は一部の数が「—」で、Kernel と不変条件の区画は、状態の表示用ファイルがないので空（一時的な clone で確かめた。[`validation.md` §4](validation.md)） |
| 記録を読む | 票の §2 と §6（[`tasks/`](tasks/)）、主張と証拠（[`validation.md`](validation.md)） |

適合性テストは、実際の sandbox と起動設定を試しません（[`kernel.md` §6](kernel.md)）。A が通っても、B や C が動くことの証拠にはなりません。

## 2. B：作者が別の場所に構築する（未検証）

### 要るもの

| 要るもの | 用途 | 正本 |
|---|---|---|
| Claude Code | 行政の実行、PreToolUse フック、権限ルール、sandbox、worktree | [`../vgdd/settings.v2.json`](../vgdd/settings.v2.json)（原本）を `.claude/settings.json` へ |
| 保護領域 Z3（作業フォルダの外） | フックと裁判所の実行用のファイル、承認・判定・証拠の記録 | [`SPEC.md` §4・§10](../vgdd/kernel/SPEC.md) |
| 裁判所の常駐（sandbox の外、オーナーの権限） | 統合キュー、監査、司法の呼び出し | [`../vgdd/scripts/gate-runner.sh`](../vgdd/scripts/gate-runner.sh) |
| 裁判所の道具 | `jq`・`node`・`git`・`npm`・`python3`・`sandbox-exec`。Git の設定の基準値（[`git-baseline.sh`](../vgdd/scripts/git-baseline.sh)）。裁判所は起動時に確かめ、欠ければ起動しない | `gate-runner.sh` の `preflight` |
| 司法の CLI | `claude` と `codex` | [`SPEC.md` §6](../vgdd/kernel/SPEC.md) |
| エージェントの定義 | 作業員・テスト担当・judge・憲法審査 | [`../vgdd/agents/`](../vgdd/agents/) を `.claude/agents/` へ |
| 票の運用 | 形式どおりの票、オーナーの `approve-spec.sh` | [`tasks/README.md`](tasks/README.md) |

`--no-codex` で起動すれば司法は judge だけになりますが、別系統の確認がなくなります。

### 構築の順序（未検証のチェックリスト）

この順で通した記録はありません。`<repo>` は対象のリポジトリ、`<z3>` は作業フォルダの外の保護領域です。

- [ ] **Z3 の配置**：`<z3>/hooks/` にフック、`<z3>/bin/` に裁判所と関連のスクリプト、`<z3>/evidence/` に記録の置き場所を作る。開発エージェントから読めず書けないようにする
- [ ] **設定**：`vgdd/settings.v2.json` を `<repo>/.claude/settings.json` に置き、パスを直す。`vgdd/agents/` を `<repo>/.claude/agents/` に置く
- [ ] **基準値の作成**：`.git/config` を確かめてから `git-baseline.sh` を実行する
- [ ] **起動**：sandbox の外で `VGDD_Z3_DIR=<z3> <z3>/bin/gate-runner.sh --repo <repo>` を動かす。道具が欠ければ起動しない
- [ ] **確認**：§4 の表を上から確かめる

### 変える設定の場所

| 変えるもの | 場所 |
|---|---|
| リポジトリ：`gate-runner.sh`・`night-runner.sh` | 引数 `--repo <repo>` |
| リポジトリ：`approve-spec.sh`・`release.sh`・`kernel-stop.sh`・`kernel-resume.sh`・`git-baseline.sh` | 環境変数 `VGDD_REPO` |
| リポジトリ：`sandboxed-run.sh`（裁判所の監査から呼ばれ、対象の `.env.local` の読み取りを禁じる） | 環境変数 `VGDD_REPO`。`gate-runner.sh` が `--repo` の値を渡す（法律 p0.4.6、判例 ST14） |
| Z3：スクリプトとフック | 環境変数 `VGDD_Z3_DIR` |
| フックの起動のパス、保護パス、`additionalDirectories` | `<repo>/.claude/settings.json`（原本は開発時の配置を前提に書いてある） |

未指定のときの既定値は、この開発の配置です。各スクリプトの先頭で確かめてください。

## 3. C：ほかの人が既存の案件に入れる（未検証）

B の準備に加えて、今の実装が次のことを前提にしています。外れるなら、参照実装を直す必要があります。

- **道具**：開発エージェントが Claude Code。フックの入力の形に依っている
- **OS**：sandbox は macOS の Seatbelt で確かめた
- **リポジトリ**：Git で、統合先が `main`。票は `docs/tasks/`
- **置き場所**：既定のパスは開発時の配置。スクリプトごとの指定のしかたは §2 の「変える設定の場所」
- **監査**：`npm ci`・`npm run test`・`npm run typecheck`・`npm run lint` が動く Node.js の案件（`gate-runner.sh` の決定論的な監査）
- **人**：仕様の承認・裁定・停止を担う人が1人いて、その人の権限で裁判所を動かす。複数人の権限分離、企業の認証基盤との接続、クラウドでの監査はない（[`kernel.md` §5](kernel.md)）
- **信頼**：同じ機械の管理者を信頼する。記録の外部への固定はしていない（[`SPEC.md` §10・§12](../vgdd/kernel/SPEC.md)）
- **費用**：司法を票ごとに呼ぶので、その費用を見込む。昼の司法の費用の上限は未実装（[`kernel.md` §2](kernel.md)）

入れるときは、まず適合性テストを動かし、次に迂回の検証（[`vgdd-status.md`](vgdd-status.md) の V6・V7。2026-11-03、フック p0.1.2〜p0.2.0 の記録）をその環境でやり直してください。合格の主張は、その構成と日時に限ります（[`SPEC.md` §11](../vgdd/kernel/SPEC.md)）。

## 4. 導入の確認の表

B・C で、上から順に人が確かめます。診断の道具はありません。この表が合格しても、Kernel が正しく動く証明にはなりません。

**実行する場所**：Z3 を読むコマンドは、開発エージェントからは読めないので、オーナーが sandbox の外で実行します。コマンドの `.claude/settings.json` などの相対パスは、`<repo>` で実行する前提です。

### 対応 OS と必須のコマンド

| 確かめること | 方法 | 合格の目安 |
|---|---|---|
| OS | `uname -s` | `Darwin` |
| sandbox の道具 | `command -v sandbox-exec python3` | 2つとも出る |
| 裁判所の道具 | `command -v jq git npm shasum` | すべて出る |
| Node.js | `node -v` | 24 以上（`package.json` の `engines`。適合性テストだけなら 22 以上） |
| 司法の CLI | 裁判所を動かす環境で `claude --version`、`codex --version`（開発エージェントの環境とは PATH が違うことがある） | どちらも版が出る。`codex` がなければ裁判所は起動しない。`--no-codex` で起動すると、別系統の確認がなくなる |
| 裁判所の点検（Z3 の配置の後） | `<z3>/bin/sandboxed-run.sh --preflight`、`<z3>/bin/judge.sh --preflight`、`<z3>/bin/judge-codex.sh --preflight` | どれも終了コード 0 |

### 対象のリポジトリ

| 確かめること | 方法 | 合格の目安 |
|---|---|---|
| 操作する先 | `git rev-parse --show-toplevel` | `<repo>` を指す。親のフォルダの別のリポジトリではない |
| 統合先 | `git rev-parse --verify main` | SHA が出る |
| 監査が動く | `npm ci`、`npm run test`、`npm run typecheck`、`npm run lint` | すべて通る |
| 票の置き場所 | `ls docs/tasks/README.md` | ある。形式は [`tasks/README.md`](tasks/README.md) |
| 追跡しないファイル | `git check-ignore .env.local docs/governance/kernel-state.json docs/governance/kernel-invariants.json` | 3つとも出る |

### フック・sandbox・保護の設定

| 確かめること | 方法 | 合格の目安 |
|---|---|---|
| フックの登録 | `jq -c '.hooks \| keys' .claude/settings.json` | `PermissionDenied`・`PostToolUse`・`PostToolUseFailure`・`PreToolUse` |
| フックが失敗したら止まる | `jq -c '[.hooks[][].hooks[].onFailure]' .claude/settings.json` | すべて `block` |
| フックの場所 | `jq -r '.hooks.PreToolUse[].hooks[].command' .claude/settings.json` | 自分の `<z3>/hooks/policy.mjs` を指す |
| sandbox | `jq -c '[.sandbox.enabled, .sandbox.failIfUnavailable, .sandbox.allowUnsandboxedCommands]' .claude/settings.json` | `[true,true,false]` |
| 書き込みの保護 | `jq '.sandbox.filesystem.denyWrite' .claude/settings.json` | 自分の Z3、`vgdd`、`CLAUDE.md`、`.claude/settings.json`、`docs/governance`、`docs/tasks/_board.json` が入っている |
| 読み取りの保護 | `jq '.sandbox.filesystem.denyRead' .claude/settings.json` | 自分の Z3 と `.env.local` が入っている |
| 開発時のパスの残り | `grep -n 'tsubuyaki' .claude/settings.json` | 自分の配置に直した後は何も出ない |

### 原本と配置済みの設定の一致

原本を直しても、配置済みの設定は自動では変わりません。法律を改めるたびに確かめます。

| 確かめること | 方法 | 合格の目安 |
|---|---|---|
| 設定 | `diff vgdd/settings.v2.json .claude/settings.json` | 違いはパスの置き換えだけ |
| エージェントの定義 | `diff -r vgdd/agents .claude/agents` | 違いがない |
| フック | `diff vgdd/hooks/policy.mjs <z3>/hooks/policy.mjs`（オーナー） | 違いがない |
| 裁判所のスクリプト | `vgdd/scripts/` の各ファイルと `<z3>/bin/` の同じ名前のファイルを `diff`（オーナー） | 違いがない |

**この開発の配置での実例（2026-11-07 12:3x）**：設定の `diff` に、原本にだけある4行が出ました（`Edit`・`Write` の `docs/governance` の deny）。原本は p0.4.6 で直しましたが、配置済みの `.claude/settings.json` に反映していません。この場所の保護は、sandbox の `denyWrite` とフックには入っています。

フックの版（`policy_version`）と法律の版（`kernel_version`）は別の数字です。法律を改めてもフックを変えなければ、前の版のままです（この時点でフックは p0.4.5、法律は p0.4.7）。

### 次に人が確かめること

表だけでは確かめられません。

| 確かめること | 方法 |
|---|---|
| 適合性テストが、配置した実装で通る | `run.mjs --impl z3`。既定の Z3 の場所に固定で `VGDD_Z3_DIR` を見ないので、別の場所の配置はこの方法では試せない |
| 票が最後まで通る | 小さな票を1枚、承認・申請・判定・統合まで通す |
| 未承認の票が止まる | 承認していない票を申請し、裁判所が blocked にすることを見る |
| 止められる | 停止と再開を1回試す（[`SPEC.md` §8](../vgdd/kernel/SPEC.md)）。停止中に開発エージェントの操作が拒否されることを見る |
| 迂回できない | 迂回の検証（[`vgdd-status.md`](vgdd-status.md) の V6・V7）を、その環境でやり直す |
| 記録が残る | 拒否された操作が証拠ストアに残り、ハッシュチェーンの検証が通ることを見る |
