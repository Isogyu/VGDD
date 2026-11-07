# 法律 p0.4.10（作業員の起動の窓口）の配置の手順（下書き）

> **下書き**（2026-11-08 03:3x、立法補佐）。配置はオーナーの操作。配置の後、行政の長は Agent ツールで作業員を起動できなくなり、申請のファイルを置く形に変わる。

1. **配置元を確かめる**：反映の後、`cd ~/tsubuyaki-worklog/app && git log -1 --format=%h` が承認した反映のコミット。`ls vgdd/scripts/{launcher.sh,launch-intake.mjs,prior-record.mjs}` で3つがあること
2. **止める**：`~/tsubuyaki-z3/bin/kernel-stop.sh "p0.4.10 の配置"`。gate-runner・夜間の代行を Ctrl-C で止める。行政の長が作業員を動かしていれば、終わるのを待つ
3. **旧い処理が残っていないことを確かめる**（何も出なければ次へ）：
   ```bash
   pgrep -fl 'gate-runner.sh|night-runner.sh|launcher.sh|judge.sh|judge-codex.sh|review-constitution.sh|metered.sh|claude -p --agent|codex exec'
   ```
4. **写す**：
   ```bash
   cd ~/tsubuyaki-worklog/app && cp -p vgdd/scripts/{night-runner.sh,kernel-state.mjs,launcher.sh,launch-intake.mjs,prior-record.mjs,metered.sh} ~/tsubuyaki-z3/bin/ && chmod +x ~/tsubuyaki-z3/bin/{launcher.sh,launch-intake.mjs,prior-record.mjs} && cp -p vgdd/hooks/policy.mjs ~/tsubuyaki-z3/hooks/
   ```
5. **配置済みの版を確かめる**（`exit=0` でなければ再開しない）：
   ```bash
   cd ~/tsubuyaki-worklog/app && set -o pipefail; node vgdd/conformance/run.mjs --impl z3 --record | tail -1; echo "exit=$?"
   ```
6. **再開**：`~/tsubuyaki-z3/bin/kernel-resume.sh "p0.4.10 を配置した" --accept-main`。gate-runner を `--hold` で起動し直し、**別の端末で起動の窓口を起動する**：
   ```bash
   PATH="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin:$PATH" ~/tsubuyaki-z3/bin/launcher.sh
   ```
7. **行政の長への案内**：作業員の起動は `merge-requests/launch/T-NNN.json` に `{"task":"T-NNN"}` を Write ツールで置く。窓口が承認・依存・予算を確かめて起動し、前検査・申請・自動修正（初回＋3回）まで行う。結果は票の §6 と、オーナーが読める Z3 の `launch/` に残る
8. **法律の系統**：p0.4.10 は p0.4 の系統の中なので、承認済みの仕様は承認し直さなくてよい
