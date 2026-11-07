// 統治シアターのデータ（公開用のイベント・Kernel の写し・不変条件の写し）を1か所で取る。T-030。
// node:fs は使わない（クライアントで使う）。fetch は引数で受ける。
// どの項目が失敗しても、別の source の URL は呼ばない（黙って切り替えない）。どちらを見ているかは返り値の source が示す。

import { pickReplay, type Replay } from "@/lib/governance-replay-schema";
import { pickKernelInvariants, type KernelInvariants } from "@/lib/kernel-invariants-schema";
import { pickKernelState, type KernelState } from "@/lib/kernel-state-schema";

export type TheaterSource = "live" | "submission";

/** 項目ごとの結果。missing は応答が 200 で写しが null（書き出しがない）、failed はそれ以外の失敗 */
export type TheaterSection<T> = { kind: "ok"; value: T } | { kind: "missing" } | { kind: "failed" };

export type TheaterData = {
  source: TheaterSource;
  // 票は git で追跡しているので、replay に missing はない
  replay: Exclude<TheaterSection<Replay>, { kind: "missing" }>;
  state: TheaterSection<KernelState>;
  invariants: TheaterSection<KernelInvariants>;
  /** state が ok のときその写しの書き出しの時刻、それ以外は null */
  generated_at: string | null;
};

/** window.fetch をそのまま渡せる形。中止などは呼ぶ側が包んで足す */
export type TheaterFetch = (url: string, init?: RequestInit) => Promise<Response>;

const FAILED = { kind: "failed" } as const;

/** 応答を JSON で読む。通信の失敗・200 以外・JSON として読めないときは null（呼ぶ側で failed にする） */
async function fetchJson(url: string, fetchFn: TheaterFetch): Promise<{ json: unknown } | null> {
  try {
    const r = await fetchFn(url, { cache: "no-store" });
    if (r.status !== 200) return null;
    return { json: (await r.json()) as unknown };
  } catch {
    return null;
  }
}

async function loadReplay(fetchFn: TheaterFetch): Promise<TheaterData["replay"]> {
  const res = await fetchJson("/api/governance/replay", fetchFn);
  if (res === null) return FAILED;
  const value = pickReplay(res.json);
  return value === null ? FAILED : { kind: "ok", value };
}

/** Kernel の写し・不変条件の写しの応答を取り、key の値を検証する。submission の応答は source も確かめる */
async function loadSnapshot<T>(
  source: TheaterSource,
  url: string,
  key: "state" | "invariants",
  pick: (json: unknown) => T | null,
  fetchFn: TheaterFetch,
): Promise<TheaterSection<T>> {
  const res = await fetchJson(url, fetchFn);
  if (res === null) return FAILED;
  const body = res.json;
  if (typeof body !== "object" || body === null || Array.isArray(body)) return FAILED;
  const fields = body as Record<string, unknown>;
  if (source === "submission" && fields.source !== "submission") return FAILED;
  const raw = fields[key];
  if (raw === null) return { kind: "missing" };
  const value = pick(raw);
  return value === null ? FAILED : { kind: "ok", value };
}

/** 3つの項目を取って1つにまとめる。1つの項目が失敗しても、ほかの項目の結果は失わない */
export async function loadTheaterData(source: TheaterSource, fetchFn: TheaterFetch): Promise<TheaterData> {
  const submission = source === "submission";
  const [replay, state, invariants] = await Promise.all([
    loadReplay(fetchFn),
    loadSnapshot(
      source,
      submission ? "/api/governance/kernel/submission" : "/api/governance/kernel",
      "state",
      pickKernelState,
      fetchFn,
    ),
    loadSnapshot(
      source,
      submission ? "/api/governance/kernel/invariants/submission" : "/api/governance/kernel/invariants",
      "invariants",
      pickKernelInvariants,
      fetchFn,
    ),
  ]);
  return {
    source,
    replay,
    state,
    invariants,
    generated_at: state.kind === "ok" ? state.value.generated_at : null,
  };
}
