# 法律 p0.4.13 の配置の手順（下書き）

> **下書き**（2026-11-08 14:2x、立法補佐）。配置はオーナーの操作。

1. **止める**：`~/tsubuyaki-z3/bin/kernel-stop.sh "p0.4.13 の配置"`。gate-runner を Ctrl-C で止める。窓口（owner-console）も Ctrl-C で止める
2. **古い裁判所が残っていないことを確かめる**（何も出なければ次へ。出たら `kill <pid>`）：
   ```bash
   pgrep -fl 'gate-runner.sh|metered.sh|night-runner.sh'
   ```
3. **写す**：
   ```bash
   cd ~/tsubuyaki-worklog/app && cp -p vgdd/scripts/{gate-runner.sh,owner-console.mjs} ~/tsubuyaki-z3/bin/
   ```
4. **配置済みの版を確かめる**（裁判所が止まっている間に。`exit=0` でなければ再開しない）：
   ```bash
   cd ~/tsubuyaki-worklog/app && set -o pipefail; node vgdd/conformance/run.mjs --impl z3 --record | tail -1; echo "exit=$?"
   ```
5. **再開**：`~/tsubuyaki-z3/bin/kernel-resume.sh "p0.4.13 を配置した" --accept-main`。gate-runner を `--hold` で起動し直す（二つ目を起動すると「二重に起動しない」と出て終わる）
6. **窓口を起動し直す**：`node ~/tsubuyaki-z3/bin/owner-console.mjs --repo ~/tsubuyaki-worklog/app` → 新しい URL を開く
