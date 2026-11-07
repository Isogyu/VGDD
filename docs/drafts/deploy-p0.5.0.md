# 法律 p0.5.0（予算の台帳）の配置の手順（下書き）

> **下書き**（2026-11-08 00:4x、立法補佐）。配置はオーナーの操作。配置の途中は、司法・夜間の代行・憲法審査が新しい台帳を通らずに動かないよう、Kernel を止めてから行う。

1. **止める**：`~/tsubuyaki-z3/bin/kernel-stop.sh "p0.5.0 の配置"`。裁判所（gate-runner）が判定の途中でないことを、裁判所の出力か `pgrep -fl judge` で確かめる（動いていれば終わるまで待つ）
2. **旧い消費の扱い**：p0.4.8 までの夜間の運転の記録は台帳に入れない（台帳は空から始める）。期間の消費は、配置の後の呼び出しだけを数える
3. **予算の上限を先に置く**（これがないと、配置した司法・憲法審査がすべて止まる）：
   ```bash
   ~/tsubuyaki-worklog/app/vgdd/scripts/budget-set.sh --period freeze-20261108 --until 2026-11-08T14:00:00+09:00 --tokens-total 30000000 --tokens-ticket 8000000 --tokens-run 2000000 --judge 60 --workers 3 --attempts 4
   ```
4. **写す**（法律の原本から Z3 へ、関係するファイルを一度に。実行の権限も）：
   ```bash
   cd ~/tsubuyaki-worklog/app && cp -p vgdd/scripts/{gate-runner.sh,judge.sh,judge-codex.sh,release.sh,night-runner.sh,sandboxed-run.sh,kernel-state.mjs,spec-digest.mjs,approve-spec.sh,review-constitution.sh,ledger.mjs,metered.sh,budget-set.sh} ~/tsubuyaki-z3/bin/ && chmod +x ~/tsubuyaki-z3/bin/{ledger.mjs,metered.sh,budget-set.sh} && cp -p vgdd/hooks/policy.mjs ~/tsubuyaki-z3/hooks/
   ```
5. **配置済みの版を確かめる**：`node vgdd/conformance/run.mjs --impl z3 --record | tail -1`（合計がすべて合格であること）。`node ~/tsubuyaki-z3/bin/ledger.mjs status` で期間と上限が出ること
6. **再開**：`~/tsubuyaki-z3/bin/kernel-resume.sh "p0.5.0 を配置した"`。gate-runner を `--hold` で起動し直す
7. **法律の系統**：p0.4 → p0.5 で法律の系統が変わるので、承認済みの仕様の承認し直しが要る（SPEC §4-6、INV-06）。進行中の票（T-040・T-042・T-043・T-044）は、配置の後にオーナーが `approve-spec.sh` で承認し直す
