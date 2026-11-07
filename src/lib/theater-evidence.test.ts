// T-033 A1・A6：判例の比較と判断待ちを組み立てる純粋関数の試験。
// 版・日付・題・票の ID はすべて架空（最後の1件だけリポジトリの実際の vgdd/kernel/history.json を読む）。

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { KernelInvariants } from "@/lib/kernel-invariants-schema";
import { pickKernelState, type KernelState } from "@/lib/kernel-state-schema";
import { pickLawHistory, type LawHistory } from "@/lib/law-history-schema";
import {
  FEATURED_VERSION,
  comparableVersions,
  comparisonFor,
  defaultVersion,
  invariantTone,
  pendingDecisions,
} from "@/lib/theater-evidence";

type Version = LawHistory["versions"][number];

function version(overrides: Partial<Version>): Version {
  return {
    version: "p9.0.0",
    date: "2099-01-01",
    title: "架空の版",
    fixed: ["架空の改善"],
    found_by: ["operation"],
    precedents: ["Z1"],
    tests_total: 10,
    prev_failed: 1,
    obs: [],
    ...overrides,
  };
}

function history(versions: Version[]): LawHistory {
  return { schema: "vgdd.law-history.v1", note: "架空", versions };
}

const SAMPLE = history([
  version({ version: "p9.0.0", prev_failed: null, tests_total: null }),
  version({ version: "p9.1.0", prev_failed: 5, found_by: ["codex", "owner"] }),
  version({ version: "p9.2.0", prev_failed: null }),
  version({ version: "p9.3.0", prev_failed: 2, tests_total: null, precedents: ["Z7", "Z8"] }),
]);

describe("comparableVersions", () => {
  it("prev_failed が null でない版を、元の順のまま返す", () => {
    expect(comparableVersions(SAMPLE).map((v) => v.version)).toEqual(["p9.1.0", "p9.3.0"]);
  });
});

describe("defaultVersion", () => {
  it("比べられる版に FEATURED_VERSION があればそれ", () => {
    const h = history([
      version({ version: "p9.0.0" }),
      version({ version: FEATURED_VERSION }),
      version({ version: "p9.9.9" }),
    ]);
    expect(defaultVersion(h)).toBe("p0.4.3");
  });

  it("FEATURED_VERSION が比べられない版なら、比べられる版の最後", () => {
    const h = history([
      version({ version: "p9.0.0" }),
      version({ version: FEATURED_VERSION, prev_failed: null }),
      version({ version: "p9.9.9" }),
      version({ version: "p9.9.10", prev_failed: null }),
    ]);
    expect(defaultVersion(h)).toBe("p9.9.9");
  });

  it("FEATURED_VERSION がなければ、比べられる版の最後", () => {
    expect(defaultVersion(SAMPLE)).toBe("p9.3.0");
  });

  it("比べられる版がなければ null", () => {
    expect(defaultVersion(history([version({ prev_failed: null })]))).toBeNull();
  });
});

describe("comparisonFor", () => {
  it("その版の項目と、1つ前の項目の版名を返す", () => {
    expect(comparisonFor(SAMPLE, "p9.3.0")).toEqual({
      version: "p9.3.0",
      date: "2099-01-01",
      title: "架空の版",
      fixed: ["架空の改善"],
      precedents: ["Z7", "Z8"],
      foundBy: ["運用の記録"],
      prevFailed: 2,
      testsTotal: null,
      previousVersion: "p9.2.0",
    });
  });

  it("見つけた主体を表示名にする", () => {
    expect(comparisonFor(SAMPLE, "p9.1.0")?.foundBy).toEqual(["Codex の監査", "オーナー"]);
    const all = history([
      version({ found_by: ["executive_head", "legislative", "codex", "judge", "owner", "operation"] }),
    ]);
    expect(comparisonFor(all, "p9.0.0")?.foundBy).toEqual([
      "行政の長",
      "立法補佐",
      "Codex の監査",
      "司法（Claude）",
      "オーナー",
      "運用の記録",
    ]);
  });

  it("先頭の版の previousVersion は null", () => {
    expect(comparisonFor(SAMPLE, "p9.0.0")?.previousVersion).toBeNull();
  });

  it("未知の主体は「—」", () => {
    // スキーマにない値を作る所だけ型アサーションを使う
    const unknownFinder = "stranger" as Version["found_by"][number];
    const h = history([version({ found_by: ["owner", unknownFinder] })]);
    expect(comparisonFor(h, "p9.0.0")?.foundBy).toEqual(["オーナー", "—"]);
  });

  it("ない版なら null", () => {
    expect(comparisonFor(SAMPLE, "p0.0.1")).toBeNull();
  });
});

// ---------- 判断待ち ----------

const AT = "2099-01-02T03:04:05+09:00";

function stateOf(overrides: Record<string, unknown> = {}): KernelState {
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
  return s;
}

function invariantsOf(overrides: Partial<KernelInvariants> = {}): KernelInvariants {
  return {
    schema: "vgdd.kernel-invariants.v1",
    generated_at: AT,
    kernel_version: "p9.8.7",
    verified_by: null,
    invariants: [],
    pending_approvals: [],
    ...overrides,
  };
}

describe("pendingDecisions", () => {
  it("停止・司法・held・確かめられない承認・仕様の承認待ちの順に並べる", () => {
    const state = stateOf({
      stopped: { active: true, since: "2099-01-02T01:00:00+09:00" },
      judiciary: { status: "unavailable", kind: "judiciary_unavailable", since: "2099-01-02T02:00:00+09:00" },
      held: [{ task: "T-901", since: "2099-01-02T03:00:00+09:00" }],
      approvals: [
        { task: "T-902", current: false, approved_at: AT },
        { task: "T-903", current: true, approved_at: AT },
      ],
    });
    const invariants = invariantsOf({ pending_approvals: [{ task: "T-904", status: "ready" }] });
    expect(pendingDecisions(state, invariants)).toEqual([
      { key: "stopped", what: "Kernel は停止中。統合しない", next: "オーナー（再開）", since: "2099-01-02T01:00:00+09:00" },
      {
        key: "judiciary",
        what: "司法が使えない。統合しない",
        next: "記録からは決められない",
        since: "2099-01-02T02:00:00+09:00",
      },
      {
        key: "T-901",
        what: "T-901：判定に合格。統合を保留",
        next: "オーナー（release で承認）",
        since: "2099-01-02T03:00:00+09:00",
      },
      {
        key: "T-902",
        what: "T-902：今の仕様・法律の系統に対する承認を確かめられない",
        next: "オーナー（承認の確認。必要なら承認し直し）",
        since: null,
      },
      { key: "T-904", what: "T-904：仕様の承認待ち", next: "オーナー（仕様の承認）", since: null },
    ]);
  });

  it("同じ票は1行だけにし、先に当たった行を残す", () => {
    const state = stateOf({
      held: [
        { task: "T-901", since: AT },
        { task: "T-901", since: null },
      ],
      approvals: [
        { task: "T-901", current: false, approved_at: null },
        { task: "T-902", current: false, approved_at: null },
      ],
    });
    const invariants = invariantsOf({
      pending_approvals: [
        { task: "T-902", status: "ready" },
        { task: "T-901", status: "review" },
        { task: "T-903", status: "blocked" },
      ],
    });
    const rows = pendingDecisions(state, invariants);
    expect(rows.map((r) => r.key)).toEqual(["T-901", "T-902", "T-903"]);
    expect(rows[0]).toMatchObject({ what: "T-901：判定に合格。統合を保留", since: AT });
    expect(rows[1].what).toBe("T-902：今の仕様・法律の系統に対する承認を確かめられない");
    expect(rows[2].what).toBe("T-903：仕様の承認待ち");
  });

  it("state が null なら 1〜4 を作らない", () => {
    const invariants = invariantsOf({ pending_approvals: [{ task: "T-904", status: "ready" }] });
    expect(pendingDecisions(null, invariants).map((r) => r.key)).toEqual(["T-904"]);
  });

  it("invariants が null なら 5 を作らない", () => {
    const state = stateOf({ held: [{ task: "T-901", since: null }] });
    expect(pendingDecisions(state, null).map((r) => r.key)).toEqual(["T-901"]);
  });

  it("両方 null なら行は0件。何もない写しでも0件", () => {
    expect(pendingDecisions(null, null)).toEqual([]);
    expect(pendingDecisions(stateOf(), invariantsOf())).toEqual([]);
  });

  it("合成の KernelState は by_task を Map で持つ", () => {
    const state: KernelState = { ...stateOf(), verdicts: { count: 0, by_task: new Map() } };
    expect(pendingDecisions(state, null)).toEqual([]);
  });
});

describe("invariantTone", () => {
  type Row = KernelInvariants["invariants"][number];
  const row = (status: Row["status"], verified: Row["verified"]): Row => ({ id: "INV-01", status, tests: 1, verified });

  it("enforced で verified が true は ok", () => {
    expect(invariantTone(row("enforced", true))).toBe("ok");
  });

  it("partial は verified が true でも partial", () => {
    expect(invariantTone(row("partial", true))).toBe("partial");
    expect(invariantTone(row("partial", null))).toBe("partial");
  });

  it("verified が false は status によらず failed", () => {
    expect(invariantTone(row("enforced", false))).toBe("failed");
    expect(invariantTone(row("partial", false))).toBe("failed");
    expect(invariantTone(row("not_applicable", false))).toBe("failed");
  });

  it("それ以外は unknown", () => {
    expect(invariantTone(row("enforced", null))).toBe("unknown");
    expect(invariantTone(row("not_applicable", true))).toBe("unknown");
    expect(invariantTone(row("not_applicable", null))).toBe("unknown");
  });
});

describe("リポジトリの実際の vgdd/kernel/history.json", () => {
  it("defaultVersion が p0.4.3 で、その判例に G15 と G19 がある", () => {
    const raw: unknown = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "vgdd", "kernel", "history.json"), "utf8"),
    );
    const h = pickLawHistory(raw);
    expect(h).not.toBeNull();
    if (h === null) return;
    expect(defaultVersion(h)).toBe("p0.4.3");
    const c = comparisonFor(h, "p0.4.3");
    expect(c?.precedents).toContain("G15");
    expect(c?.precedents).toContain("G19");
  });
});
