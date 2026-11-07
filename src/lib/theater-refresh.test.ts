import { describe, expect, it } from "vitest";
import type { TheaterData } from "@/lib/theater-data";
import {
  formatFetchTime,
  hasFailedSection,
  LIVE_REFRESH_MS,
  mergeRefresh,
  shouldRecordFetch,
} from "@/lib/theater-refresh";

// 合成の写し。中身は mergeRefresh が見ないので、見分けられる最小の形だけ持たせる
type Section<K extends "state" | "invariants"> = TheaterData[K];
const okState = (tag: string): Section<"state"> =>
  ({ kind: "ok", value: { tag } }) as unknown as Section<"state">;
const okInvariants = (tag: string): Section<"invariants"> =>
  ({ kind: "ok", value: { tag } }) as unknown as Section<"invariants">;
const replay = (tag: string): TheaterData["replay"] =>
  ({ kind: "ok", value: { tag, tickets: [] } }) as unknown as TheaterData["replay"];

function data(overrides: Partial<TheaterData>): TheaterData {
  return {
    source: "live",
    replay: replay("r"),
    state: okState("s"),
    invariants: okInvariants("i"),
    generated_at: "2026-11-07T21:00:00+09:00",
    ...overrides,
  };
}

describe("LIVE_REFRESH_MS", () => {
  it("15 秒", () => {
    expect(LIVE_REFRESH_MS).toBe(15000);
  });
});

describe("mergeRefresh", () => {
  const current = data({ replay: replay("current") });

  it("ok → ok：next の値になり、replay は current と同じ参照", () => {
    const next = data({
      replay: replay("next"),
      state: okState("s2"),
      invariants: okInvariants("i2"),
      generated_at: "2026-11-07T21:00:30+09:00",
    });
    const r = mergeRefresh(current, next);
    expect(r.failed).toBe(false);
    expect(r.data.source).toBe("live");
    expect(r.data.replay).toBe(current.replay);
    expect(r.data.state).toBe(next.state);
    expect(r.data.invariants).toBe(next.invariants);
    expect(r.data.generated_at).toBe("2026-11-07T21:00:30+09:00");
  });

  it("ok → failed（両方）：current を保ち failed: true", () => {
    const next = data({ state: { kind: "failed" }, invariants: { kind: "failed" }, generated_at: null });
    const r = mergeRefresh(current, next);
    expect(r.failed).toBe(true);
    expect(r.data.state).toBe(current.state);
    expect(r.data.invariants).toBe(current.invariants);
    expect(r.data.generated_at).toBe(current.generated_at);
    expect(r.data.replay).toBe(current.replay);
  });

  it("ok → missing：missing になり、書き出しの時刻は next の値（null）", () => {
    const next = data({ state: { kind: "missing" }, invariants: { kind: "missing" }, generated_at: null });
    const r = mergeRefresh(current, next);
    expect(r.failed).toBe(false);
    expect(r.data.state).toEqual({ kind: "missing" });
    expect(r.data.invariants).toEqual({ kind: "missing" });
    expect(r.data.generated_at).toBeNull();
  });

  it("state だけ failed：state と書き出しの時刻は current、invariants は next、failed: true", () => {
    const next = data({ state: { kind: "failed" }, invariants: okInvariants("i2"), generated_at: null });
    const r = mergeRefresh(current, next);
    expect(r.failed).toBe(true);
    expect(r.data.state).toBe(current.state);
    expect(r.data.generated_at).toBe(current.generated_at);
    expect(r.data.invariants).toBe(next.invariants);
  });

  it("invariants だけ failed：state と書き出しの時刻は next、invariants は current、failed: true", () => {
    const next = data({ state: okState("s2"), invariants: { kind: "failed" }, generated_at: "2026-11-07T21:01:00+09:00" });
    const r = mergeRefresh(current, next);
    expect(r.failed).toBe(true);
    expect(r.data.state).toBe(next.state);
    expect(r.data.generated_at).toBe("2026-11-07T21:01:00+09:00");
    expect(r.data.invariants).toBe(current.invariants);
  });

  it("source が違うときは next を捨てる", () => {
    const next = data({ source: "submission", state: { kind: "failed" }, invariants: okInvariants("i2") });
    const r = mergeRefresh(current, next);
    expect(r.failed).toBe(false);
    expect(r.data).toBe(current);
  });
});

describe("hasFailedSection と shouldRecordFetch", () => {
  const f = { kind: "failed" } as const;
  const m = { kind: "missing" } as const;

  it("ok と missing の組み合わせ：失敗でなく、時刻を記録する", () => {
    expect(hasFailedSection({ state: okState("s"), invariants: m })).toBe(false);
    expect(shouldRecordFetch({ state: okState("s"), invariants: okInvariants("i") })).toBe(true);
    expect(shouldRecordFetch({ state: okState("s"), invariants: m })).toBe(true);
    expect(shouldRecordFetch({ state: m, invariants: okInvariants("i") })).toBe(true);
    expect(shouldRecordFetch({ state: m, invariants: m })).toBe(true);
  });

  it("片方だけ failed：失敗で、時刻を記録しない", () => {
    expect(hasFailedSection({ state: f, invariants: okInvariants("i") })).toBe(true);
    expect(shouldRecordFetch({ state: f, invariants: okInvariants("i") })).toBe(false);
    expect(hasFailedSection({ state: okState("s"), invariants: f })).toBe(true);
    expect(shouldRecordFetch({ state: okState("s"), invariants: f })).toBe(false);
    expect(shouldRecordFetch({ state: m, invariants: f })).toBe(false);
  });

  it("両方 failed：失敗で、時刻を記録しない", () => {
    expect(hasFailedSection({ state: f, invariants: f })).toBe(true);
    expect(shouldRecordFetch({ state: f, invariants: f })).toBe(false);
  });
});

describe("formatFetchTime", () => {
  it("日本時間の HH:MM:SS", () => {
    expect(formatFetchTime(Date.parse("2026-11-07T12:34:56Z"))).toBe("21:34:56");
    expect(formatFetchTime(Date.parse("2026-11-07T15:00:05Z"))).toBe("00:00:05");
    expect(formatFetchTime(Date.parse("2026-11-07T00:00:00+09:00"))).toBe("00:00:00");
  });
});
