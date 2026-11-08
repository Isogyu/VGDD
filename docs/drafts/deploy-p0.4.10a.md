# 法律 p0.4.10 と p0.4.10a をまとめて配置する手順（下書き）

> **下書き**（2026-11-08 08:4x、立法補佐）。配置はオーナーの操作。`deploy-p0.4.10.md` の手順に、p0.4.10a の窓口（`metered.sh`）を足したもの。停止は1回で済む。
> p0.4.10a：Codex が応答の後に通知の処理を同じプロセス群に残すため、p0.4.9 以降の窓口が Codex の司法を毎回「中断」（精算 143・終了 75）として扱っていた（OBS-062）。

1. **配置元を確かめる**：`cd ~/tsubuyaki-worklog/app && git log -1 --format=%h` が p0.4.10a の反映のコミット。`grep -c descendants_reaped vgdd/scripts/metered.sh` が 1、`grep -c -- "-s read-only" vgdd/scripts/judge-codex.sh` が 2
2. **止める**：`~/tsubuyaki-z3/bin/kernel-stop.sh "p0.4.10・p0.4.10a の配置"`。gate-runner を Ctrl-C で止める。行政の長が作業員を動かしていれば、終わるのを待つ
3. **古い処理が残っていないことを確かめる**（何も出なければ次へ）：
   ```bash
   pgrep -fl 'gate-runner.sh|night-runner.sh|launcher.sh|judge.sh|judge-codex.sh|review-constitution.sh|metered.sh|claude -p --agent|codex exec'
   ```
4. **写す**（p0.4.10a で `metered.sh`・`judge-codex.sh` が変わった）：
   ```bash
   cd ~/tsubuyaki-worklog/app && cp -p vgdd/scripts/{night-runner.sh,kernel-state.mjs,launcher.sh,launch-intake.mjs,prior-record.mjs,metered.sh,judge-codex.sh} ~/tsubuyaki-z3/bin/ && chmod +x ~/tsubuyaki-z3/bin/{launcher.sh,launch-intake.mjs,prior-record.mjs} && cp -p vgdd/hooks/policy.mjs ~/tsubuyaki-z3/hooks/
   ```
5. **配置済みの版を確かめる**（`exit=0` でなければ再開しない）：
   ```bash
   cd ~/tsubuyaki-worklog/app && set -o pipefail; node vgdd/conformance/run.mjs --impl z3 --record | tail -1; echo "exit=$?"
   ```
6. **再開**：`~/tsubuyaki-z3/bin/kernel-resume.sh "p0.4.10・p0.4.10a を配置した" --accept-main`。gate-runner を `--hold` で起動し直す：
   ```bash
   PATH="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin:$PATH" ~/tsubuyaki-z3/bin/gate-runner.sh --hold
   ```
   （`CODEX_EXTRA_ARGS` を付けて起動しているなら、モデルの指定 `--model 名前` だけにする。ほかの引数があると Codex の司法は「使えない」になる）
   **同じ Mac のターミナルの別のタブで、起動の窓口を起動する**（gate-runner と同じく常駐して端末を占める）：
   ```bash
   PATH="/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin:$PATH" ~/tsubuyaki-z3/bin/launcher.sh
   ```
7. **blocked の票**：T-042・T-043・T-044 は、Codex の司法が使えなかったことによる blocked（判定ではない）。行政の長に申請し直しを頼む（窓口の後は `merge-requests/launch/` ではなく、統合の申請のし直し）
8. **行政の長への案内**：作業員の起動は `merge-requests/launch/T-NNN.json` に `{"task":"T-NNN"}` を Write ツールで置く。結果は票の §6 と Z3 の `launch/`
9. **法律の系統**：p0.4 の系統の中なので、承認済みの仕様は承認し直さなくてよい
