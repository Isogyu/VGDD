// 統治シアターの見出しの「停止の帯」と「判断待ちの件数」の文を組み立てる。T-038 A1。
// 純粋関数だけを置く（node:fs は読まない。React は import しない）。
// 入力は、判断待ちの欄（DecisionPanel）に渡すものと同じ、今表示している写し。

import type { KernelInvariants } from "@/lib/kernel-invariants-schema";
import type { KernelState } from "@/lib/kernel-state-schema";
import { formatJst } from "@/lib/kernel-state-schema";
import type { TheaterSection } from "@/lib/theater-data";
import { pendingDecisions } from "@/lib/theater-evidence";

/** 写しが取得済みで停止中のときだけ帯の文を返す。それ以外は null */
export function stopBannerText(state: TheaterSection<KernelState> | null): string | null {
  if (state === null || state.kind !== "ok") return null;
  const { active, since } = state.value.stopped;
  if (!active) return null;
  return since !== null ? `Kernel は停止中（${formatJst(since)} から）。統合しません` : "Kernel は停止中。統合しません";
}

/** 写しが取得済みのときだけ、判断待ちの欄と同じ数え方の件数の文を返す。それ以外は null */
export function pendingSummaryText(
  state: TheaterSection<KernelState> | null,
  invariants: TheaterSection<KernelInvariants> | null,
): string | null {
  if (state === null || state.kind !== "ok") return null;
  const n = pendingDecisions(state.value, invariants !== null && invariants.kind === "ok" ? invariants.value : null).length;
  return n >= 1 ? `判断待ち ${n} 件` : "判断待ちはありません";
}
