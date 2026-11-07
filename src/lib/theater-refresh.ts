// 統治シアターの「稼働中の観測」の取り直し（T-035）。取り直した結果を今の表示に合わせる純粋関数。
// React は import しない。node:fs は読まない。

import type { TheaterData } from "@/lib/theater-data";

/**
 * 画面の側の取得の間隔（ミリ秒）。
 * 裁判所が写しを書き出す周期や、停止が画面に出るまでの時間を保証するものではない。
 */
export const LIVE_REFRESH_MS = 15000;

/** 取得の結果のうち、state と invariants のどちらかが failed か */
export function hasFailedSection(data: Pick<TheaterData, "state" | "invariants">): boolean {
  return data.state.kind === "failed" || data.invariants.kind === "failed";
}

/**
 * 最後の取得の時刻を記録するか。state と invariants のどちらも failed でないときだけ記録する
 * （片方でも failed なら記録しない。missing は成功に含める）。
 */
export function shouldRecordFetch(data: Pick<TheaterData, "state" | "invariants">): boolean {
  return !hasFailedSection(data);
}

/** 取り直した next を、今表示している current に合わせる。replay は差し替えない */
export function mergeRefresh(current: TheaterData, next: TheaterData): { data: TheaterData; failed: boolean } {
  // 別の source の結果は捨てる
  if (current.source !== next.source) return { data: current, failed: false };

  const stateFailed = next.state.kind === "failed";
  const invariantsFailed = next.invariants.kind === "failed";
  return {
    data: {
      source: current.source,
      // 同じ参照のまま（再生の記録を差し替えない）
      replay: current.replay,
      state: stateFailed ? current.state : next.state,
      generated_at: stateFailed ? current.generated_at : next.generated_at,
      invariants: invariantsFailed ? current.invariants : next.invariants,
    },
    failed: stateFailed || invariantsFailed,
  };
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 画面の側の時刻（エポックからのミリ秒）を、日本時間の HH:MM:SS にする */
export function formatFetchTime(epochMs: number): string {
  const d = new Date(epochMs + JST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
