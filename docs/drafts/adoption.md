# 試す・動かす・ほかの案件に入れる

> **下書き**（2026-11-07 01:4x、行政の長）。提出の前に `docs/adoption.md` に移す。リンクは移した後の置き場所を基準に書いた。この引用の枠は、移すときに外す。

**実績の範囲：** Kernel を実稼働させたのは、この案件の、オーナー1人・macOS の機械1台だけです。ほかの環境での構築は試していません。下の準備と条件は、実装と運用の記録から整理したもので、手順どおりに動くことはまだ確かめていません。

## 1. 公開の clone でできること

手順は [README の「再現」](../README.md)にあります。

| できること | 確かめられる範囲 |
|---|---|
| 適合性テスト（`node vgdd/conformance/run.mjs`。`jq`・`shasum`・UTF-8 のロケールが要る） | 使い捨ての試験用リポジトリと偽の Z3 の上で、止めるべき操作が止まり、通すべき操作が通ること。LLM は呼ばないので、判定の中身ではなく判定の扱いを試す |
| 前の版との比較 | 法律の版の差は [`vgdd/kernel/history.json`](../vgdd/kernel/history.json) と Git の履歴で追える |
| `/governance` | 統治の数字・票の盤・票1枚の運命・法律の歴史。全体図は一部の数が「—」で、Kernel と不変条件の区画は、状態の表示用ファイルがないので空（コードから読んだ動作で、clone では未確認） |
| 記録を読む | 票の §2 と §6（[`tasks/`](tasks/)）、主張と証拠（[`validation.md`](validation.md)） |

適合性テストは、実際の sandbox と起動設定を試しません（[`kernel.md` §6](kernel.md)）。

## 2. 実稼働に要る準備

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
- [ ] **設定**：`vgdd/settings.v2.json` を `<repo>/.claude/settings.json` に置き、パスを直す。**原本には `docs/governance` の書き込みの保護が抜けているので、sandbox の `denyWrite` に足す。** `vgdd/agents/` を `<repo>/.claude/agents/` に置く
- [ ] **基準値の作成**：`.git/config` を確かめてから `git-baseline.sh` を実行する
- [ ] **起動**：sandbox の外で `VGDD_REPO=<repo> VGDD_Z3_DIR=<z3> <z3>/bin/gate-runner.sh --repo <repo>` を動かす。道具が欠ければ起動しない
- [ ] **確認**：適合性テストを稼働中の実装に対して動かす（`run.mjs --impl z3` は既定の Z3 の場所に固定で、`VGDD_Z3_DIR` を見ない）。小さな票を1枚、承認・申請・判定・統合まで通す。停止と再開を1回試す。迂回の検証を、その環境でやり直す

### 変える設定の場所

| 変えるもの | 場所 |
|---|---|
| リポジトリ：`gate-runner.sh`・`night-runner.sh` | 引数 `--repo <repo>` |
| リポジトリ：`approve-spec.sh`・`release.sh`・`kernel-stop.sh`・`kernel-resume.sh`・`git-baseline.sh` | 環境変数 `VGDD_REPO` |
| リポジトリ：`sandboxed-run.sh`（裁判所の監査から呼ばれ、対象の `.env.local` の読み取りを禁じる） | 環境変数 `VGDD_REPO`。**`gate-runner.sh` の `--repo` だけでは渡らないので、起動のときに両方を指定する** |
| Z3：スクリプトとフック | 環境変数 `VGDD_Z3_DIR` |
| フックの起動のパス、保護パス、`additionalDirectories` | `<repo>/.claude/settings.json`（原本は開発時の配置を前提に書いてある） |

未指定のときの既定値は、この開発の配置です。各スクリプトの先頭で確かめてください。

## 3. ほかの案件に入れる条件

今の実装が前提にしていることです。外れるなら、参照実装を直す必要があります。

- **道具**：開発エージェントが Claude Code。フックの入力の形に依っている
- **OS**：sandbox は macOS の Seatbelt で確かめた。ほかの OS は未確認
- **リポジトリ**：Git で、統合先が `main`。票は `docs/tasks/`
- **置き場所**：既定のパスは開発時の配置。スクリプトごとの指定のしかたは §2 の「変える設定の場所」
- **監査**：`npm ci`・`npm run test`・`npm run typecheck`・`npm run lint` が動く Node.js の案件（`gate-runner.sh` の決定論的な監査）
- **人**：仕様の承認・裁定・停止を担う人が1人いて、その人の権限で裁判所を動かす。複数人の権限分離、企業の認証基盤との接続、クラウドでの監査はない（[`kernel.md` §5](kernel.md)）
- **信頼**：同じ機械の管理者を信頼する。記録の外部への固定はしていない（[`SPEC.md` §10・§12](../vgdd/kernel/SPEC.md)）
- **費用**：司法を票ごとに呼ぶので、その費用を見込む。昼の司法の費用の上限は未実装（[`kernel.md` §2](kernel.md)）

入れるときは、まず適合性テストを動かし、次に迂回の検証（[`vgdd-status.md`](vgdd-status.md) の V6・V7。2026-11-03、フック p0.1.2〜p0.2.0 の記録）をその環境でやり直してください。合格の主張は、その構成と日時に限ります（[`SPEC.md` §11](../vgdd/kernel/SPEC.md)）。

---

**点検**：Claude の点検済み（2 回。最後は 2026-11-07 01:4x）。今の版は Codex 未点検（この行は移すときに消す）
