#!/usr/bin/env bash
# VGDD Governance Kernel — 停止からの再開（安全性を確かめてから。オーナーが sandbox の外で実行。p0.4.0、ADR-010・ADR-027）
#
# 再開の前に、次をすべて確かめる。1つでも合わない、または確かめられなければ再開しない（fail-closed）：
#   1 証拠ストアのハッシュチェーンとチェックポイント（verify-chain.mjs）
#   2 共有の .git/config が基準値と同じ（OBS-033）
#   3 main の checkout が main ブランチにあり、未コミットの変更も未追跡のファイルもない
#   4 停止の時点の main（STOP に書いた完全な SHA）が今の main の祖先である（巻き戻し・分岐がない）
#   5 停止の時点から後に main に入ったコミットがない。あれば作者名にかかわらず一覧を出して止める（作者名は偽れる）。
#     停止中は gate-runner も統合しないので、ここに出るコミットはすべて Kernel の外からのもの。オーナーが確かめて --accept-main で再開する
# 再開の記録（確かめた結果と stop_id）を先に書き、そのあとで STOP を evidence/stops/ に移す（消さない）。
# 記録に失敗すれば再開しない。移すのに失敗すれば停止のまま（安全側）。
#
# 使い方: vgdd/scripts/kernel-resume.sh "再開の理由" [--accept-main]
set -euo pipefail
REPO="${VGDD_REPO:-$HOME/tsubuyaki-worklog/app}"; Z3="${VGDD_Z3_DIR:-$HOME/tsubuyaki-z3}"
GIT_BIN="$(type -P git)"
git() { "$GIT_BIN" -c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.sshCommand=ssh "$@"; }
reason="${1:-}"; [ -n "$reason" ] || { echo "使い方: kernel-resume.sh \"理由\" [--accept-main]" >&2; exit 64; }
ACCEPT_MAIN=0; [ "${2:-}" = "--accept-main" ] && ACCEPT_MAIN=1
LOCK="$Z3/.kernel.lock"
mkdir "$LOCK" 2>/dev/null || { echo "別の停止・再開が動いている（${LOCK}）。終わってからやり直す" >&2; exit 75; }
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
[ -f "$Z3/STOP" ] || { echo "停止していない"; exit 0; }
refuse() { echo "✗ $1。再開しない" >&2; exit 70; }

stop_id="$(sed -n 's/^stop_id=//p' "$Z3/STOP" | head -n 1)"
stop_main="$(sed -n 's/^main=//p' "$Z3/STOP" | head -n 1)"
node "$Z3/hooks/verify-chain.mjs" "$Z3/evidence/tool_calls.jsonl" --summary-json >/dev/null || refuse "証拠ストアの検証に失敗（改ざん・欠落・切り詰めの疑い）"
[ "$(shasum -a 256 "$REPO/.git/config" | cut -c1-64)" = "$(cat "$Z3/evidence/git-config.baseline" 2>/dev/null)" ] || refuse ".git/config が基準値と違う"
[ "$(git -C "$REPO" branch --show-current)" = "main" ] || refuse "main の checkout が main ブランチにない"
st="$(git -C "$REPO" status --porcelain)" || refuse "git status を確かめられない"
[ -z "$st" ] || refuse "main の checkout に未コミットの変更か未追跡のファイルがある：$(printf '%s' "$st" | head -n 5 | tr '\n' ' ')"
[[ "$stop_main" =~ ^[0-9a-f]{40}$ ]] || refuse "停止の時点の main が STOP に書かれていない（${stop_main:-なし}）。確かめられない"
git -C "$REPO" cat-file -e "${stop_main}^{commit}" 2>/dev/null || refuse "停止の時点の main（${stop_main:0:12}）がリポジトリにない"
git -C "$REPO" merge-base --is-ancestor "$stop_main" main || refuse "停止の時点の main（${stop_main:0:12}）が今の main の祖先ではない（巻き戻し・分岐の疑い）"
foreign="$(git -C "$REPO" log "${stop_main}..main" --format='%H %an %s')" || refuse "停止の後のコミットを確かめられない"
if [ -n "$foreign" ] && [ "$ACCEPT_MAIN" -ne 1 ]; then
  echo "✗ 停止の後に main が進んでいる（作者名にかかわらず、すべて Kernel の外からのコミット）。確かめてから --accept-main で再開する：" >&2
  printf '%s\n' "$foreign" >&2; exit 70
fi

ts="$(date +%Y-%m-%dT%H:%M:%S%z)"
jq -nc --arg ts "$ts" --arg r "$reason" --arg id "$stop_id" --arg sm "$stop_main" --arg m "$(git -C "$REPO" rev-parse main)" --argjson am "$ACCEPT_MAIN" --arg f "$foreign" \
  '{ts:$ts,type:"kernel_resume",task:"-",stop_id:$id,reason:$r,by:"owner",
    checks:{chain:"ok",git_config:"ok",clean_main:"ok",stop_main_is_ancestor:"ok",stop_main:$sm,main:$m,
            foreign_commits:($f|split("\n")|map(select(.!=""))),accepted_main:($am==1)}}' >> "$Z3/evidence/gate_events.jsonl" \
  || refuse "再開の記録を書けない"
mkdir -p "$Z3/evidence/stops"
mv "$Z3/STOP" "$Z3/evidence/stops/STOP-${stop_id:-$(date +%Y%m%d-%H%M%S)}" || { echo "✗ STOP を移せない。停止のまま" >&2; exit 70; }
echo "Kernel を再開した：${reason}（${stop_id}）"
