// 統治シアターの開始の状態を URL の値から決める純粋関数（T-039 A1）。
// 値は決まった値の中から選ぶだけで、合わない値は今の既定に戻す。React と node:fs は使わない。

import type { TheaterSource } from "./theater-data";

/** URL の source の値。"live" と "submission" だけを受け、ほか（null を含む）は "submission" */
export function parseStartSource(value: string | null): TheaterSource {
  return value === "live" ? "live" : "submission";
}

// 文字列の全体が T- と ASCII の数字3〜4桁だけ。
// JavaScript では m フラグを付けなければ $ は文字列の末尾だけに合う（末尾の改行の前には合わない）ので、"T-014\n" も拒む
const TICKET_ID = /^T-[0-9]{3,4}$/;

/** URL の ticket の値。票の ID の形のときだけその文字列、ほかは null。前後の空白・改行は取り除かずに拒む */
export function parseStartTicket(value: string | null): string | null {
  if (value === null) return null;
  return TICKET_ID.test(value) ? value : null;
}
