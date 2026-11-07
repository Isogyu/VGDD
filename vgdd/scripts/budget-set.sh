#!/bin/bash
# VGDD Governance Kernel — 予算の上限を決める（オーナーの操作。法律 p0.4.9、SPEC §9）
#
# 使い方: budget-set.sh --period <ID> --until <ISO8601 タイムゾーン付き> --tokens-total <数> --tokens-ticket <数> \
#                       --tokens-run <数> --judge <数> --workers <数> --attempts <数>
#   Z3/budget/limits.json を書き直す。台帳（ledger.jsonl）は消さない・初期化しない。
#   期間の ID を変えると、新しい期間として数え直す（前の期間の記録は台帳に残る）。開発エージェントは Z3 に書けないので、AI は増額できない。
set -euo pipefail
Z3="${VGDD_Z3_DIR:-${HOME}/tsubuyaki-z3}"
P=""; U=""; TT=""; TK=""; TR=""; J=""; W=""; A=""   # macOS の bash 3.2 でも動くよう、連想配列は使わない
while [ $# -gt 0 ]; do
  case "$1" in
    --period) P="$2";; --until) U="$2";; --tokens-total) TT="$2";; --tokens-ticket) TK="$2";;
    --tokens-run) TR="$2";; --judge) J="$2";; --workers) W="$2";; --attempts) A="$2";;
    *) echo "不明な引数: $1" >&2; exit 64;;
  esac
  shift 2
done
for v in "$P" "$U" "$TT" "$TK" "$TR" "$J" "$W" "$A"; do [ -n "$v" ] || { echo "引数が足りない" >&2; exit 64; }; done
for v in "$TT" "$TK" "$TR" "$J" "$W" "$A"; do [[ "$v" =~ ^[0-9]{1,15}$ ]] || { echo "数は 0 以上の整数（15桁まで）" >&2; exit 64; }; done
[[ "$P" =~ ^[A-Za-z0-9._:-]{1,120}$ ]] || { echo "--period の形が違う" >&2; exit 64; }
node -e 'const s=process.argv[1]; if (Number.isNaN(Date.parse(s)) || !/([+-]\d{2}:\d{2}|Z)$/.test(s)) process.exit(1)' "$U" || { echo "--until はタイムゾーン付きの日時" >&2; exit 64; }
mkdir -p "$Z3/budget"
TMP="$(mktemp "$Z3/budget/.limits.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
node -e '
const [p,u,tt,tk,tr,j,w,a]=process.argv.slice(1);
const at=new Date(Date.now()+9*3600e3).toISOString().replace(/\.\d+Z$/,"+09:00");
process.stdout.write(JSON.stringify({schema:"vgdd.budget-limits.v1",period_id:p,until:u,tokens_total:+tt,tokens_per_ticket:+tk,tokens_per_run:+tr,judge_calls:+j,workers:+w,attempts_per_ticket:+a,set_at:at},null,2)+"\n");
' "$P" "$U" "$TT" "$TK" "$TR" "$J" "$W" "$A" > "$TMP"
mv "$TMP" "$Z3/budget/limits.json"
echo "予算の上限を書いた: $Z3/budget/limits.json"
cat "$Z3/budget/limits.json"
