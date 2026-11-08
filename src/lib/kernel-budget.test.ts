// kernel-budget.ts の純粋関数の試験。T-045 A5。
import { describe, expect, it } from "vitest";
import {
  HIDDEN_PERIOD_LABEL,
  budgetRows,
  pendingPreview,
  periodLabel,
  runsRows,
  usageRow,
} from "./kernel-budget";
import type { KernelAcceptance, KernelBudget, KernelRuns } from "@/lib/kernel-state-schema";

describe("usageRow", () => {
  it("上限 null は割合 null・「上限なし」", () => {
    expect(usageRow(5, null)).toEqual({ used: 5, limit: null, percent: null, text: "5（上限なし）" });
  });
  it("上限 0 は割合 null・「上限 0」", () => {
    expect(usageRow(3, 0)).toEqual({ used: 3, limit: 0, percent: null, text: "3 ／ 上限 0" });
  });
  it("ちょうど 80%", () => {
    expect(usageRow(8, 10)).toEqual({ used: 8, limit: 10, percent: 80, text: "8 ／ 10（80%）" });
  });
  it("100% を超えてもそのまま・切り捨て", () => {
    expect(usageRow(25, 20).percent).toBe(125);
    expect(usageRow(25, 20).text).toBe("25 ／ 20（125%）");
    expect(usageRow(2, 3).percent).toBe(66);
  });
  it("3桁ごとに区切る", () => {
    expect(usageRow(30_000_000, null).text).toBe("30,000,000（上限なし）");
    expect(usageRow(15_000_000, 30_000_000).text).toBe("15,000,000 ／ 30,000,000（50%）");
  });
});

const BUDGET: KernelBudget = {
  period_id: "freeze-20261108",
  until: null,
  tokens: { settled: 1_000, reserved: 234, unknown_runs: 0, limit: 10_000 },
  judge_calls: { used: 4, limit: 5 },
  attempts: { used: 7, limit: null },
  workers: { active: 2, limit: 2 },
};

describe("budgetRows", () => {
  it("4行をこの順で返し、トークンは精算済み＋予約中", () => {
    const rows = budgetRows(BUDGET);
    expect(rows.map((r) => r.label)).toEqual([
      "トークン（精算済み＋予約中）",
      "司法の呼び出し",
      "試行",
      "作業員（同時）",
    ]);
    expect(rows[0].row).toEqual({ used: 1_234, limit: 10_000, percent: 12, text: "1,234 ／ 10,000（12%）" });
    expect(rows[1].row.percent).toBe(80);
    expect(rows[2].row.percent).toBeNull();
    expect(rows[3].row.percent).toBe(100);
  });
});

describe("runsRows", () => {
  it("8つの件数をこの順とラベルで返す", () => {
    const r: KernelRuns = {
      requested: 1,
      reserved: 2,
      started: 3,
      exited: 4,
      settled: 5,
      cancelled: 6,
      liveness_unknown: 7,
      usage_unknown: 8,
    };
    expect(runsRows(r)).toEqual([
      { key: "requested", label: "要求", count: 1 },
      { key: "reserved", label: "予約", count: 2 },
      { key: "started", label: "起動", count: 3 },
      { key: "exited", label: "終了", count: 4 },
      { key: "settled", label: "精算", count: 5 },
      { key: "cancelled", label: "取り消し", count: 6 },
      { key: "liveness_unknown", label: "生死が不明", count: 7 },
      { key: "usage_unknown", label: "利用量が不明", count: 8 },
    ]);
  });
});

describe("periodLabel", () => {
  it("許す形はそのまま", () => {
    expect(periodLabel("freeze-20261108")).toBe("freeze-20261108");
    expect(periodLabel("p0.4.9_night")).toBe("p0.4.9_night");
    expect(periodLabel("z".repeat(40))).toBe("z".repeat(40));
  });
  it("パス・空白を含む文・41字・16進12字の連続は固定の文", () => {
    // 「a」は16進の文字なので、40字の連続は16進12字以上の連続として拒む
    expect(periodLabel("a".repeat(40))).toBe(HIDDEN_PERIOD_LABEL);
    expect(periodLabel("/Users/foo")).toBe(HIDDEN_PERIOD_LABEL);
    expect(periodLabel("this is a sentence")).toBe(HIDDEN_PERIOD_LABEL);
    expect(periodLabel("b".repeat(41))).toBe(HIDDEN_PERIOD_LABEL);
    expect(periodLabel("p-0123456789ab")).toBe(HIDDEN_PERIOD_LABEL);
    expect(periodLabel("")).toBe(HIDDEN_PERIOD_LABEL);
  });
  it("固定の文は「（表示しない形の期間名）」", () => {
    expect(HIDDEN_PERIOD_LABEL).toBe("（表示しない形の期間名）");
  });
});

describe("pendingPreview", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `T-${String(i + 100).padStart(3, "0")}`);
  it("件数 100・配列 25 件 → ids 20 件（配列の順）・more 80", () => {
    const a: KernelAcceptance = { accepted_count: 0, pending_count: 100, accepted: [], pending: ids(25) };
    const p = pendingPreview(a);
    expect(p.ids).toEqual(ids(25).slice(0, 20));
    expect(p.more).toBe(80);
  });
  it("件数と配列が同じで 20 件以下なら more 0", () => {
    const a: KernelAcceptance = { accepted_count: 1, pending_count: 3, accepted: ["T-001"], pending: ids(3) };
    expect(pendingPreview(a)).toEqual({ ids: ids(3), more: 0 });
  });
});
