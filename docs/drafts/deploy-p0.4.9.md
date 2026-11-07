# 法律 p0.4.9（予算の台帳）の配置の手順（下書き）

> **下書き**（2026-11-08 01:0x、立法補佐）。配置はオーナーの操作。`kernel-stop.sh` は実行中の作業員・司法を強制終了しないので、呼び出し元を止めて、旧い実装で動いている処理がすべて終わったことを確かめてから写す。

1. **配置元を確かめる**：法律の改正を main に反映した後、`cd ~/tsubuyaki-worklog/app && git log -1 --format=%h` が、承認した反映のコミットであること。`ls vgdd/scripts/{ledger.mjs,metered.sh,budget-set.sh}` で3つがあること
2. **止める**：`~/tsubuyaki-z3/bin/kernel-stop.sh "p0.4.9 の配置"`。裁判所（gate-runner）と夜間の代行を Ctrl-C で止める
3. **旧い処理が終わったことを確かめる**：次のコマンドで何も出ないこと（出たら、終わるまで待つ）
   ```bash
   pgrep -fl 'gate-runner.sh|night-runner.sh|judge.sh|judge-codex.sh|review-constitution.sh|metered.sh|claude -p --agent|codex exec'
   ```
4. **旧い消費の扱い**：p0.4.8 までの記録は台帳に入れない（台帳は空から始め、配置の後の呼び出しだけを数える）
5. **予算の上限を先に置く**（これがないと、写した後の司法・憲法審査がすべて止まる）：
   ```bash
   ~/tsubuyaki-worklog/app/vgdd/scripts/budget-set.sh --period freeze-20261108 --until 2026-11-08T14:00:00+09:00 --tokens-total 30000000 --tokens-ticket 8000000 --tokens-run 2000000 --judge 60 --workers 3 --attempts 4
   ```
6. **写す**（関係するファイルを一度に。実行の権限も）：
   ```bash
   cd ~/tsubuyaki-worklog/app && cp -p vgdd/scripts/{gate-runner.sh,judge.sh,judge-codex.sh,release.sh,night-runner.sh,sandboxed-run.sh,kernel-state.mjs,spec-digest.mjs,approve-spec.sh,review-constitution.sh,kernel-stop.sh,kernel-resume.sh,ledger.mjs,metered.sh,budget-set.sh} ~/tsubuyaki-z3/bin/ && chmod +x ~/tsubuyaki-z3/bin/{ledger.mjs,metered.sh,budget-set.sh} && cp -p vgdd/hooks/policy.mjs ~/tsubuyaki-z3/hooks/
   ```
7. **配置済みの版を確かめる**（終了状態も見る）：
   ```bash
   cd ~/tsubuyaki-worklog/app && set -o pipefail; node vgdd/conformance/run.mjs --impl z3 --record | tail -1; echo "exit=$?"; node ~/tsubuyaki-z3/bin/ledger.mjs status
   ```
   すべて合格（`exit=0`）で、期間と上限が出ること
8. **再開**：`~/tsubuyaki-z3/bin/kernel-resume.sh "p0.4.9 を配置した"`。gate-runner を `--hold` で起動し直す
9. **法律の系統**：p0.4.9 は p0.4 の系統の中の版の上がりなので、承認済みの仕様は承認し直さなくてよい（SPEC §4-6）
