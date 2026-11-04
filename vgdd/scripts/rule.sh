#!/usr/bin/env bash
# VGDD — オーナーの裁定を記録する（オーナーが sandbox の外で実行。p0.3.1、D-59①）。
# judge と Codex の判定が重大な指摘で分かれた申請について、オーナーが「統合」と裁定するときに使う。
# 裁定は票と申請の SHA に結び付く。監査の不合格・セキュリティ審査の不合格・保護パスには効かない。
# 使い方: vgdd/scripts/rule.sh T-008 <申請の完全な SHA> merge "理由（実害の小さい端の例、など）"
set -euo pipefail
[ $# -eq 4 ] || { echo "使い方: rule.sh <票> <申請の SHA（40桁）> merge <理由>" >&2; exit 64; }
[ "$3" = "merge" ] || { echo "決定は merge だけ" >&2; exit 64; }
[[ "$2" =~ ^[0-9a-f]{40}$ ]] || { echo "SHA は 40桁" >&2; exit 64; }
Z3="${VGDD_Z3_DIR:-$HOME/tsubuyaki-z3}"
jq -nc --arg t "$1" --arg s "$2" --arg r "$4" --arg ts "$(date +%Y-%m-%dT%H:%M:%S%z)" '{ts:$ts,task:$t,sha:$s,decision:"merge",reason:$r,by:"owner"}' >> "$Z3/evidence/rulings.jsonl"
echo "裁定を記録した: $1 ${2:0:12} merge"
