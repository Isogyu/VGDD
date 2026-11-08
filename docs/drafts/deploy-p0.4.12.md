# 法律 p0.4.12（オーナーの操作の窓口）の配置の手順（下書き）

> **下書き**（2026-11-08 12:2x、立法補佐）。配置はオーナーの操作。配置の後は、承認・開始・統合・停止・点検して再開・受け入れを、窓口の画面から行える（端末のコマンドも今までどおり使える）。

1. **配置元を確かめる**：`cd ~/tsubuyaki-worklog/app && git log -1 --format=%h` が p0.4.12 の反映のコミット。`ls vgdd/scripts/owner-console.mjs`
2. **止める**：`~/tsubuyaki-z3/bin/kernel-stop.sh "p0.4.12 の配置"`。gate-runner を Ctrl-C で止める。作業員が動いていないこと（`pgrep -fl "metered.sh|night-runner.sh"` が空）
3. **写す**：
   ```bash
   cd ~/tsubuyaki-worklog/app && cp -p vgdd/scripts/{owner-console.mjs,approve-spec.sh,release.sh,kernel-state.mjs} ~/tsubuyaki-z3/bin/ && chmod +x ~/tsubuyaki-z3/bin/owner-console.mjs
   ```
4. **配置済みの版を確かめる**（`exit=0` でなければ再開しない）：
   ```bash
   cd ~/tsubuyaki-worklog/app && set -o pipefail; node vgdd/conformance/run.mjs --impl z3 --record | tail -1; echo "exit=$?"
   ```
5. **再開**：`~/tsubuyaki-z3/bin/kernel-resume.sh "p0.4.12 を配置した" --accept-main`。gate-runner を `--hold` で起動し直す（launcher は止めていなければそのまま）
6. **窓口を起動する**（同じ Mac の別のタブ。常駐する）：
   ```bash
   node ~/tsubuyaki-z3/bin/owner-console.mjs --repo ~/tsubuyaki-worklog/app
   ```
   端末に出た `http://127.0.0.1:<ポート>/login?t=…` をブラウザで1回開く（URL は1回だけ使える。ほかの人に見せない）。窓口を起動し直したら、新しい URL から開く
