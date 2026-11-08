# 法律 p0.4.13 と p0.4.14 をまとめて配置する手順（下書き）

> **下書き**（2026-11-08 15:1x、立法補佐）。配置はオーナーの操作。

1. **止める**：`~/tsubuyaki-z3/bin/kernel-stop.sh "p0.4.13・p0.4.14 の配置"`。gate-runner と窓口（owner-console）を Ctrl-C で止める
2. **古い処理が残っていないことを確かめる**（何も出なければ次へ。出たら `kill <pid>`）：
   ```bash
   pgrep -fl 'gate-runner.sh|owner-console.mjs|metered.sh|night-runner.sh'
   ```
3. **写す**：
   ```bash
   cd ~/tsubuyaki-worklog/app && cp -p vgdd/scripts/{gate-runner.sh,owner-console.mjs} ~/tsubuyaki-z3/bin/
   ```
4. **配置済みの版を確かめる**（`exit=0` でなければ再開しない）：
   ```bash
   cd ~/tsubuyaki-worklog/app && set -o pipefail; node vgdd/conformance/run.mjs --impl z3 --record | tail -1; echo "exit=$?"
   ```
5. **再開**：`~/tsubuyaki-z3/bin/kernel-resume.sh "p0.4.13・p0.4.14 を配置した" --accept-main`。gate-runner を `--hold` で起動し直す
6. **窓口を起動する**（公開のアプリを `npm run dev` などで動かしているなら、その URL を `--app-url` に）：
   ```bash
   node ~/tsubuyaki-z3/bin/owner-console.mjs --repo ~/tsubuyaki-worklog/app --project "つぶやき業務ログ（VGDD の題材）" --app-url http://localhost:3000
   ```
