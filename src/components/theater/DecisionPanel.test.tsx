// T-033 A3・A6：判断待ちと次の担当の欄の表示の試験。票の ID・時刻はすべて架空。

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { KernelInvariants } from "@/lib/kernel-invariants-schema";
import { pickKernelState, type KernelState } from "@/lib/kernel-state-schema";
import type { TheaterSection } from "@/lib/theater-data";
import DecisionPanel from "./DecisionPanel";

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

function render(
  state: TheaterSection<KernelState> | null,
  invariants: TheaterSection<KernelInvariants> | null,
  generatedAt: string | null = null,
): string {
  return renderToStaticMarkup(
    <DecisionPanel state={state} invariants={invariants} sourceLabel="提出記録" generatedAt={generatedAt} />,
  );
}

const ROW = /<li[^>]*>(?:(?!<\/li>).)*次の担当：/g;

describe("DecisionPanel", () => {
  it("取得前は見出しと「読み込み中…」を出し、行を作らない", () => {
    const html = render(null, null);
    expect(html).toMatch(/<h2[^>]*>判断待ちと次の担当<\/h2>/);
    expect(html).toContain("提出記録・—の写しから");
    expect(html).toContain("<p>読み込み中…</p>");
    expect(html).not.toContain("次の担当：");
    expect(html).not.toContain("判断待ちはありません");
  });

  it("state が missing のときの文を出し、行は0件", () => {
    const html = render({ kind: "missing" }, { kind: "ok", value: invariantsOf({ pending_approvals: [{ task: "T-904", status: "ready" }] }) });
    expect(html).toContain("Kernel の写しの書き出しがありません。判断待ちは決められません");
    expect(html.match(ROW) ?? []).toHaveLength(0);
    expect(html).not.toContain("T-904");
  });

  it("state が failed のときの文を出し、行は0件", () => {
    const html = render({ kind: "failed" }, { kind: "failed" });
    expect(html).toContain("Kernel の写しを取得できませんでした。判断待ちは決められません");
    expect(html.match(ROW) ?? []).toHaveLength(0);
  });

  it("停止・held・確かめられない承認・仕様の承認待ちを A1 の順に、次の担当と時刻つきで出す", () => {
    const state = stateOf({
      stopped: { active: true, since: "2099-01-02T01:00:00+09:00" },
      held: [{ task: "T-901", since: "2099-01-02T03:00:00+09:00" }],
      approvals: [{ task: "T-902", current: false, approved_at: AT }],
    });
    const invariants = invariantsOf({ pending_approvals: [{ task: "T-904", status: "ready" }] });
    const html = render({ kind: "ok", value: state }, { kind: "ok", value: invariants }, AT);

    expect(html).toContain("提出記録・1/2 03:04の写しから");
    expect(html.match(ROW) ?? []).toHaveLength(4);
    const order = [
      "Kernel は停止中。統合しない",
      "次の担当：オーナー（再開）",
      "1/2 01:00",
      "T-901：判定に合格。統合を保留",
      "次の担当：オーナー（release で承認）",
      "1/2 03:00",
      "T-902：今の仕様・法律の系統に対する承認を確かめられない",
      "次の担当：オーナー（承認の確認。必要なら承認し直し）",
      "T-904：仕様の承認待ち",
      "次の担当：オーナー（仕様の承認）",
    ];
    let last = -1;
    for (const text of order) {
      const at = html.indexOf(text);
      expect(at, text).toBeGreaterThan(last);
      last = at;
    }
    expect(html).not.toContain("不変条件の写しがないため");
  });

  it("行が0件なら「判断待ちはありません」", () => {
    const html = render({ kind: "ok", value: stateOf() }, { kind: "ok", value: invariantsOf() });
    expect(html).toContain("判断待ちはありません");
    expect(html.match(ROW) ?? []).toHaveLength(0);
  });

  it("不変条件の写しが ok でなければ、仕様の承認待ちを含まないことを添える", () => {
    const html = render({ kind: "ok", value: stateOf() }, { kind: "missing" });
    expect(html).toContain("判断待ちはありません");
    expect(html).toContain("不変条件の写しがないため、仕様の承認待ちは含みません");
    expect(html).not.toMatch(/<h3[^>]*>不変条件<\/h3>/);
  });

  it("不変条件の札を文つきで並べ、緑は ok の札だけに付ける", () => {
    const invariants = invariantsOf({
      invariants: [
        { id: "INV-01", status: "enforced", tests: 3, verified: true },
        { id: "INV-03", status: "partial", tests: 2, verified: true },
        { id: "INV-05", status: "enforced", tests: 1, verified: false },
        { id: "INV-07", status: "not_applicable", tests: 0, verified: null },
      ],
    });
    const html = render({ kind: "ok", value: stateOf() }, { kind: "ok", value: invariants });
    expect(html).toMatch(/<h3[^>]*>不変条件<\/h3>/);

    const chip = (text: string) => {
      const m = html.match(new RegExp(`<li class="([^"]*)">${text}</li>`));
      expect(m, text).not.toBeNull();
      return m?.[1] ?? "";
    };
    expect(chip("INV-01・強制・試験 3 件・合格")).toContain("emerald");
    const partial = chip("INV-03・一部・試験 2 件・合格");
    expect(partial).not.toMatch(/emerald|green/);
    expect(chip("INV-05・強制・試験 1 件・不合格")).not.toMatch(/emerald|green/);
    expect(chip("INV-07・対象外・試験 0 件・未確認")).not.toMatch(/emerald|green/);
  });
});
