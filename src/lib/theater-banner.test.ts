import { describe, expect, it } from "vitest";
import type { KernelInvariants } from "@/lib/kernel-invariants-schema";
import { formatJst, pickKernelState, type KernelState } from "@/lib/kernel-state-schema";
import { pendingSummaryText, stopBannerText } from "@/lib/theater-banner";
import type { TheaterSection } from "@/lib/theater-data";

// 合成の写し（架空の票の ID と時刻だけ）
const AT = "2099-01-02T03:04:05+09:00";
const SINCE = "2099-01-02T01:00:00+09:00";

function stateOf(overrides: Record<string, unknown> = {}): TheaterSection<KernelState> {
  const s = pickKernelState({
    schema: "vgdd.kernel-state.v1",
    generated_at: AT,
    kernel_version: "p9.8.7",
    policy_version: "p9.8.7",
    stopped: { active: false, since: null },
    judiciary: { status: "ok", kind: null, since: null },
    approvals: [],
    held: [],
    rulings: { count: 0, tasks: [] },
    annulments: { count: 0 },
    verdicts: { count: 0, by_task: {} },
    disagreements: { count: 0, tasks: [] },
    evidence: { records: 0, chain_ok: true, checkpoint_mismatches: 0, checkpoint_at: null, last_record_at: null },
    conformance: null,
    ...overrides,
  });
  if (s === null) throw new Error("合成の Kernel の写しが形に合わない");
  return { kind: "ok", value: s };
}

function invariantsOf(overrides: Partial<KernelInvariants> = {}): TheaterSection<KernelInvariants> {
  return {
    kind: "ok",
    value: {
      schema: "vgdd.kernel-invariants.v1",
      generated_at: AT,
      kernel_version: "p9.8.7",
      verified_by: null,
      invariants: [],
      pending_approvals: [],
      ...overrides,
    },
  };
}

describe("stopBannerText", () => {
  it("停止中で since があれば、整形した時刻つきの文", () => {
    const text = stopBannerText(stateOf({ stopped: { active: true, since: SINCE } }));
    expect(text).toBe(`Kernel は停止中（${formatJst(SINCE)} から）。統合しません`);
    expect(text).toBe("Kernel は停止中（1/2 01:00 から）。統合しません");
  });

  it("停止中で since が null なら、時刻なしの文", () => {
    expect(stopBannerText(stateOf({ stopped: { active: true, since: null } }))).toBe("Kernel は停止中。統合しません");
  });

  it("停止していなければ null", () => {
    expect(stopBannerText(stateOf())).toBeNull();
  });

  it("missing・failed・null（取得前）なら null", () => {
    expect(stopBannerText({ kind: "missing" })).toBeNull();
    expect(stopBannerText({ kind: "failed" })).toBeNull();
    expect(stopBannerText(null)).toBeNull();
  });
});

describe("pendingSummaryText", () => {
  it("判断待ちが2件なら「判断待ち 2 件」", () => {
    const state = stateOf({ held: [{ task: "T-901", since: AT }] });
    const invariants = invariantsOf({ pending_approvals: [{ task: "T-902", status: "ready" }] });
    expect(pendingSummaryText(state, invariants)).toBe("判断待ち 2 件");
  });

  it("判断待ちが0件なら「判断待ちはありません」", () => {
    expect(pendingSummaryText(stateOf(), invariantsOf())).toBe("判断待ちはありません");
  });

  it("state が ok でなければ、invariants があっても null", () => {
    const invariants = invariantsOf({ pending_approvals: [{ task: "T-902", status: "ready" }] });
    expect(pendingSummaryText(null, invariants)).toBeNull();
    expect(pendingSummaryText({ kind: "missing" }, invariants)).toBeNull();
    expect(pendingSummaryText({ kind: "failed" }, invariants)).toBeNull();
  });

  it("invariants が failed・null のときは、仕様の承認待ちを数えない", () => {
    const state = stateOf({ held: [{ task: "T-901", since: AT }] });
    expect(pendingSummaryText(state, { kind: "failed" })).toBe("判断待ち 1 件");
    expect(pendingSummaryText(state, { kind: "missing" })).toBe("判断待ち 1 件");
    expect(pendingSummaryText(state, null)).toBe("判断待ち 1 件");
  });

  it("停止も判断待ちの1件として数える（判断待ちの欄と同じ数え方）", () => {
    const state = stateOf({ stopped: { active: true, since: SINCE } });
    expect(pendingSummaryText(state, invariantsOf())).toBe("判断待ち 1 件");
  });
});
