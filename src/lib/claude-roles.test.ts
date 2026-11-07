import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildHookTotals,
  buildRoleRows,
  CLAUDE_ROLES,
  denyKindLabel,
  formatCount,
  pickRoleSummary,
} from "./claude-roles";
// 判定の一致を確かめるためだけに、試験の中で pickSummary を値として読む（A5）
import { pickSummary, type GovernanceSummary } from "./governance";

// 合成の集計（架空の件数）
function synthetic(): GovernanceSummary {
  return {
    schema: "vgdd.governance-summary.v1",
    generated_at: "2026-11-07T12:00:00.000+09:00",
    period: { first: "2026-11-03T10:00:00.000+09:00", last: "2026-11-07T11:00:00.000+09:00" },
    chain_ok: true,
    records: 12345,
    sessions: 7,
    agents: 4,
    tool_calls: { allow: 4321, deny: 21 },
    deny_kinds: { other: 3, protected_path: 10, z3: 3, mystery_kind: 5 },
    by_agent: {
      "(main)": { calls: 1500, deny: 9 },
      worker: { calls: 2600, deny: 11 },
      tester: { calls: 42, deny: 1 },
      "constitutional-review": { calls: 6, deny: 0 },
    },
  };
}

describe("CLAUDE_ROLES", () => {
  it("6行の key の順と agentKey", () => {
    expect(CLAUDE_ROLES.map((r) => r.key)).toEqual(["main", "worker", "tester", "helper", "judge", "constitutional"]);
    expect(CLAUDE_ROLES.map((r) => r.agentKey)).toEqual([
      "(main)",
      "worker",
      "tester",
      "general-purpose",
      null,
      "constitutional-review",
    ]);
  });

  it("表の文にバッククォートを入れない", () => {
    for (const r of CLAUDE_ROLES) {
      for (const text of [r.role, r.feature, r.model, r.limits]) expect(text).not.toContain("`");
    }
  });

  it("文は票の表のとおり（作業員と司法の行）", () => {
    const worker = CLAUDE_ROLES[1];
    expect(worker.feature).toBe("サブエージェント worker。自分の git worktree で実装する（isolation: worktree）");
    expect(worker.limits).toBe("ほかのエージェントの起動・Web の取得を外す");
    const judge = CLAUDE_ROLES[4];
    expect(judge.role).toBe("司法（Claude）");
    expect(judge.feature).toBe(
      "サブエージェント judge を、裁判所の judge.sh が claude -p --agent judge で別のプロセスとして呼ぶ。差分・受け入れ条件・監査の結果だけを入力にする",
    );
    expect(judge.model).toBe("Sonnet");
    expect(judge.limits).toBe("定義に並べた組み込みのツールを disallowedTools で禁止");
  });
});

describe("buildRoleRows", () => {
  it("by_agent の値を写し、鍵がない行と agentKey が null の行は null", () => {
    const rows = buildRoleRows(synthetic());
    expect(rows.map((r) => r.key)).toEqual(CLAUDE_ROLES.map((r) => r.key));
    const byKey = Object.fromEntries(rows.map((r) => [r.key, { calls: r.calls, deny: r.deny }]));
    expect(byKey.main).toEqual({ calls: 1500, deny: 9 });
    expect(byKey.worker).toEqual({ calls: 2600, deny: 11 });
    expect(byKey.tester).toEqual({ calls: 42, deny: 1 });
    expect(byKey.constitutional).toEqual({ calls: 6, deny: 0 });
    // general-purpose の鍵がない
    expect(byKey.helper).toEqual({ calls: null, deny: null });
    // agentKey が null
    expect(byKey.judge).toEqual({ calls: null, deny: null });
  });

  it("行は役割の文をそのまま持つ", () => {
    const rows = buildRoleRows(synthetic());
    rows.forEach((r, i) => {
      const { key, role, feature, model, limits, agentKey } = CLAUDE_ROLES[i];
      expect({ key: r.key, role: r.role, feature: r.feature, model: r.model, limits: r.limits, agentKey: r.agentKey }).toEqual(
        { key, role, feature, model, limits, agentKey },
      );
    });
  });

  it("summary が null のとき全行 null", () => {
    const rows = buildRoleRows(null);
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(r.calls).toBeNull();
      expect(r.deny).toBeNull();
    }
  });
});

describe("buildHookTotals", () => {
  it("summary が null なら null", () => {
    expect(buildHookTotals(null)).toBeNull();
  });

  it("項目の対応と、拒否の分類の並べ方（件数の多い順、同数は鍵の名前の順）と、未知の鍵の表示名", () => {
    const t = buildHookTotals(synthetic());
    expect(t).toEqual({
      allow: 4321,
      deny: 21,
      sessions: 7,
      records: 12345,
      chainOk: true,
      generatedAt: "2026-11-07T12:00:00.000+09:00",
      periodLast: "2026-11-07T11:00:00.000+09:00",
      denyKinds: [
        { key: "protected_path", label: "保護パスへの操作", count: 10 },
        { key: "mystery_kind", label: "その他の分類", count: 5 },
        { key: "other", label: "その他", count: 3 },
        { key: "z3", label: "Z3", count: 3 },
      ],
    });
  });

  it("鍵の表示名", () => {
    expect(denyKindLabel("protected_path")).toBe("保護パスへの操作");
    expect(denyKindLabel("git_scope")).toBe("git の範囲の外");
    expect(denyKindLabel("z3")).toBe("Z3");
    expect(denyKindLabel("readonly_outside")).toBe("読むだけのフォルダ");
    expect(denyKindLabel("hook_internal")).toBe("証拠ストア・入力の形");
    expect(denyKindLabel("other")).toBe("その他");
    expect(denyKindLabel("unheard_of")).toBe("その他の分類");
    expect(denyKindLabel("constructor")).toBe("その他の分類");
  });

  it("chain_ok が false と period.last が null を写す", () => {
    const s = { ...synthetic(), chain_ok: false, period: { first: null, last: null } };
    const t = buildHookTotals(s);
    expect(t?.chainOk).toBe(false);
    expect(t?.periodLast).toBeNull();
  });
});

describe("formatCount", () => {
  it("3桁ごとに「,」、null は「—」", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000)).toBe("1,000");
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(null)).toBe("—");
  });
});

// ---------- pickRoleSummary と pickSummary の判定の一致 ----------

function without(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

const base = synthetic() as unknown as Record<string, unknown>;

const cases: [string, unknown][] = [
  // 正しいもの
  ["正しい合成の入力", synthetic()],
  ["余分な項目がある", { ...base, source_file: "tool_calls.jsonl", by_tool: { Bash: 1 }, outcomes: { success: 1 } }],
  ["by_agent の値に余分な項目がある", { ...base, by_agent: { worker: { calls: 1, deny: 0, outcomes: 1 } } }],
  ["period が null と null", { ...base, period: { first: null, last: null } }],
  ["deny_kinds と by_agent が空", { ...base, deny_kinds: {}, by_agent: {} }],
  // A2：数は「数」として判定する。pickSummary より厳しくも緩くもしない
  ["負の数と小数", { ...base, records: -1, sessions: 1.5 }],
  ["by_agent に constructor の鍵", { ...base, by_agent: { constructor: { calls: 1, deny: 0 } } }],
  // 項目が欠けたもの
  ...(
    ["schema", "generated_at", "period", "chain_ok", "records", "sessions", "agents", "tool_calls", "deny_kinds", "by_agent"] as const
  ).map((k): [string, unknown] => [`${k} が欠けた`, without(base, k)]),
  ["period.last が欠けた", { ...base, period: { first: null } }],
  ["tool_calls.deny が欠けた", { ...base, tool_calls: { allow: 1 } }],
  ["by_agent の値の deny が欠けた", { ...base, by_agent: { worker: { calls: 1 } } }],
  // 型が違うもの
  ["null", null],
  ["配列", []],
  ["文字列", "summary"],
  ["schema が違う", { ...base, schema: "vgdd.governance-summary.v2" }],
  ["generated_at が数", { ...base, generated_at: 1 }],
  ["period が配列", { ...base, period: [] }],
  ["period.first が数", { ...base, period: { first: 1, last: null } }],
  ["chain_ok が文字列", { ...base, chain_ok: "true" }],
  ["records が文字列", { ...base, records: "1" }],
  ["agents が NaN", { ...base, agents: Number.NaN }],
  ["sessions が無限", { ...base, sessions: Number.POSITIVE_INFINITY }],
  ["tool_calls.allow が null", { ...base, tool_calls: { allow: null, deny: 0 } }],
  ["deny_kinds が配列", { ...base, deny_kinds: [1, 2] }],
  ["deny_kinds の値が文字列", { ...base, deny_kinds: { z3: "3" } }],
  ["by_agent が配列", { ...base, by_agent: [] }],
  ["by_agent の値が数", { ...base, by_agent: { worker: 3 } }],
  ["by_agent の値が配列", { ...base, by_agent: { worker: [1, 0] } }],
  ["by_agent の calls が文字列", { ...base, by_agent: { worker: { calls: "1", deny: 0 } } }],
];

describe("pickRoleSummary は pickSummary と同じ判定", () => {
  it.each(cases)("%s", (_name, input) => {
    const ours = pickRoleSummary(input);
    const theirs = pickSummary(input);
    expect(ours === null).toBe(theirs === null);
    // 合うときは、同じ項目だけで組み立て直した同じ値
    expect(ours).toEqual(theirs);
  });

  it("合成の入力では、余分な項目を落とす", () => {
    const picked = pickRoleSummary({ ...base, source_file: "x", by_agent: { worker: { calls: 1, deny: 0, outcomes: 1 } } });
    expect(picked).not.toBeNull();
    expect(Object.keys(picked ?? {})).not.toContain("source_file");
    expect(picked?.by_agent.worker).toEqual({ calls: 1, deny: 0 });
  });

  it("リポジトリの実際の summary.json でも判定が一致し、作業員の行の calls が 1 以上", () => {
    const file = fileURLToPath(new URL("../../docs/governance/summary.json", import.meta.url));
    const json: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    const ours = pickRoleSummary(json);
    const theirs = pickSummary(json);
    expect(ours).not.toBeNull();
    expect(theirs).not.toBeNull();
    expect(ours).toEqual(theirs);
    const worker = buildRoleRows(ours).find((r) => r.key === "worker");
    expect(worker?.calls ?? 0).toBeGreaterThanOrEqual(1);
  });
});
