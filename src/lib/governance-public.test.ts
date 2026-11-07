import { describe, expect, it } from "vitest";
import { loadGovernance, type GovernanceData } from "@/lib/governance";
import { toPublicGovernance } from "./governance-public";

const SECRET_DETAIL = "status → merged（合成の自由な文 main=0123456789abcdef /架空/パス/ファイル.ts）";
const EXTRA = "余分な項目の合成の文字列";

const sortedKeys = (value: object) => Object.keys(value).sort();

// 余分な項目は型の外なので、未知の入力を受けた場合として型を外して渡す
function syntheticInput(): GovernanceData {
  return {
    generated_at: "2026-11-07T10:00:00+09:00",
    extra_top: EXTRA,
    board: { tickets: 5, merged: 3, rejected: 2, blocked: 1, disagreements: 0, extra_board: EXTRA },
    summary: {
      schema: "vgdd.governance-summary.v1",
      generated_at: "2026-11-07T09:00:00+09:00",
      period: { first: null, last: "2026-11-07T08:00:00+09:00", extra_period: EXTRA },
      chain_ok: true,
      records: 100,
      sessions: 7,
      agents: 4,
      tool_calls: { allow: 90, deny: 10, extra_calls: EXTRA },
      deny_kinds: { 架空の拒否: 6, other: 4 },
      by_agent: { 架空の作業員: { calls: 50, deny: 3, extra_agent: EXTRA } },
      extra_summary: EXTRA,
    },
    tickets: [
      {
        id: "T-999",
        title: "架空の票",
        status: "merged",
        returns: 1,
        disagreements: 2,
        extra_ticket: EXTRA,
        timeline: [
          { ts: "2026-11-07T08:00:00+0900", actor: "gate-runner", status: "merged", detail: SECRET_DETAIL, extra_event: EXTRA },
          { ts: "2026-11-07T08:30:00+0900", actor: "release", status: null, detail: SECRET_DETAIL },
        ],
      },
    ],
  } as unknown as GovernanceData;
}

describe("toPublicGovernance", () => {
  it("トップ・票・出来事のキーが、決めた形とちょうど一致する", () => {
    const out = toPublicGovernance(syntheticInput());
    expect(sortedKeys(out)).toEqual(["board", "generated_at", "summary", "tickets"]);
    expect(sortedKeys(out.tickets[0])).toEqual(["disagreements", "id", "returns", "status", "timeline", "title"]);
    for (const event of out.tickets[0].timeline) {
      expect(sortedKeys(event)).toEqual(["actor", "status", "ts"]);
    }
  });

  it("記録の文と余分な項目の合成の文字列が、応答のどこにも残らない", () => {
    const text = JSON.stringify(toPublicGovernance(syntheticInput()));
    for (const leaked of ["detail", "合成の自由な文", "0123456789abcdef", "/架空/パス/", EXTRA, "extra_"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("票と出来事の値を保つ", () => {
    const { generated_at, tickets } = toPublicGovernance(syntheticInput());
    expect(generated_at).toBe("2026-11-07T10:00:00+09:00");
    expect(tickets).toEqual([
      {
        id: "T-999",
        title: "架空の票",
        status: "merged",
        returns: 1,
        disagreements: 2,
        timeline: [
          { ts: "2026-11-07T08:00:00+0900", actor: "gate-runner", status: "merged" },
          { ts: "2026-11-07T08:30:00+0900", actor: "release", status: null },
        ],
      },
    ]);
  });

  it("board と summary は既知の項目と値と null を保ち、入れ子の余分な項目を落とす", () => {
    const { board, summary } = toPublicGovernance(syntheticInput());
    expect(board).toEqual({ tickets: 5, merged: 3, rejected: 2, blocked: 1, disagreements: 0 });
    expect(summary).toEqual({
      schema: "vgdd.governance-summary.v1",
      generated_at: "2026-11-07T09:00:00+09:00",
      period: { first: null, last: "2026-11-07T08:00:00+09:00" },
      chain_ok: true,
      records: 100,
      sessions: 7,
      agents: 4,
      tool_calls: { allow: 90, deny: 10 },
      deny_kinds: { 架空の拒否: 6, other: 4 },
      by_agent: { 架空の作業員: { calls: 50, deny: 3 } },
    });
  });

  it("board と summary が null なら null のまま", () => {
    const out = toPublicGovernance({ generated_at: "2026-11-07T10:00:00+09:00", tickets: [], board: null, summary: null });
    expect(out).toEqual({ generated_at: "2026-11-07T10:00:00+09:00", board: null, summary: null, tickets: [] });
  });

  it("動的なキーが __proto__ でも、プロトタイプを変えず、by_agent の値は calls と deny だけにする", () => {
    const input = syntheticInput();
    input.summary!.deny_kinds = JSON.parse('{"__proto__": 1}') as Record<string, number>;
    input.summary!.by_agent = JSON.parse('{"__proto__": {"calls": 2, "deny": 1, "extra_agent": "x"}}') as Record<
      string,
      { calls: number; deny: number }
    >;
    const summary = toPublicGovernance(input).summary!;
    expect(Object.getPrototypeOf(summary.deny_kinds)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(summary.by_agent)).toBe(Object.prototype);
    expect(Object.entries(summary.deny_kinds)).toEqual([["__proto__", 1]]);
    expect(Object.entries(summary.by_agent)).toEqual([["__proto__", { calls: 2, deny: 1 }]]);
  });

  it("リポジトリの実際の票でも、出来事に記録の文が入らない", () => {
    const { tickets } = toPublicGovernance(loadGovernance(process.cwd()));
    const events = tickets.flatMap((ticket) => ticket.timeline);
    expect(tickets.length).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);

    const text = JSON.stringify(events);
    expect(text).not.toContain("files_allowed");
    expect(text).not.toContain("main=");
    expect(text).not.toMatch(/[0-9a-fA-F]{12,}/);
    for (const event of events) {
      expect(sortedKeys(event)).toEqual(["actor", "status", "ts"]);
    }
  });
});
