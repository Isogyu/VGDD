# 法律 p0.4.11（状態の写しに予算の台帳の集計）の配置の手順（下書き）

> **下書き**（2026-11-08 10:0x、立法補佐）。配置はオーナーの操作。
> **T-042 の統合の後に配置する**。T-042 より前の画面は、写しに `budget`・`runs` があると写し全体を拒み、Kernel の区画が「読めませんでした」になる。

1. **順番を確かめる**：`cd ~/tsubuyaki-worklog/app && git log --oneline main | grep -m1 'T-042'` に T-042 の統合（gate-runner または release）があること。`grep -c 'budget: budgetSchema.optional()' src/lib/kernel-state-schema.ts` が 1
2. **止める**：`~/tsubuyaki-z3/bin/kernel-stop.sh "p0.4.11 の配置"`。gate-runner を Ctrl-C で止める。ledger.mjs も写すので、作業員が動いていないこと（`pgrep -fl "metered.sh|night-runner.sh"` が空）を確かめる。launcher は止めなくてよい
3. **写す**（kernel-state.mjs は gate-runner が周回ごとに起動する node のファイル）：
   ```bash
   cd ~/tsubuyaki-worklog/app && cp -p vgdd/scripts/{kernel-state.mjs,ledger.mjs} ~/tsubuyaki-z3/bin/
   ```
4. **配置済みの版を確かめる**（`exit=0` でなければ再開しない）：
   ```bash
   cd ~/tsubuyaki-worklog/app && set -o pipefail; node vgdd/conformance/run.mjs --impl z3 --record | tail -1; echo "exit=$?"
   ```
5. **再開**：`~/tsubuyaki-z3/bin/kernel-resume.sh "p0.4.11 を配置した" --accept-main`。gate-runner を `--hold` で起動し直す：
   ```bash
   PATH="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin:$PATH" ~/tsubuyaki-z3/bin/gate-runner.sh --hold
   ```
6. **確かめる**：次の周回の後、`docs/governance/kernel-state.json` に `budget`・`runs` があり、`/governance` の Kernel の区画が今までどおり出る（T-045 の統合の後は、予算と実行の表も出る）
