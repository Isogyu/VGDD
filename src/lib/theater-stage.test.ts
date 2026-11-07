import { describe, expect, it } from "vitest";
import type { Replay } from "@/lib/governance-replay-schema";
import { theaterTokens } from "@/components/theater/tokens";
import {
  focusFor,
  STAGE_EDGE_IDS,
  STAGE_EDGES,
  STAGE_NODE_IDS,
  type StageEdgeId,
  type StageEvent,
  type StageNodeId,
  type StageTone,
} from "./theater-stage";

type Row = {
  kind: StageEvent["kind"];
  reason: StageEvent["reason"];
  nodes: StageNodeId[];
  edges: StageEdgeId[];
  tone: StageTone;
};

// 票の A2 の表。まとめて書かれた reason も1行ずつに分ける
const table: Row[] = [
  { kind: "returned", reason: "scope", nodes: ["kernel", "executive"], edges: ["return"], tone: "normal" },
  { kind: "returned", reason: "rebase", nodes: ["kernel", "executive"], edges: ["return"], tone: "normal" },
  { kind: "returned", reason: "other", nodes: ["kernel", "executive"], edges: ["return"], tone: "normal" },
  {
    kind: "returned",
    reason: "security",
    nodes: ["judiciary", "kernel", "executive"],
    edges: ["verdict", "return"],
    tone: "normal",
  },
  {
    kind: "returned",
    reason: "judiciary",
    nodes: ["judiciary", "kernel", "executive"],
    edges: ["verdict", "return"],
    tone: "normal",
  },
  {
    kind: "blocked",
    reason: "disagreement",
    nodes: ["judiciary", "kernel", "human"],
    edges: ["verdict", "escalate"],
    tone: "waiting",
  },
  { kind: "blocked", reason: "return_limit", nodes: ["kernel", "human"], edges: ["escalate"], tone: "waiting" },
  {
    kind: "blocked",
    reason: "spec_unapproved",
    nodes: ["legislative", "kernel", "human"],
    edges: ["escalate"],
    tone: "waiting",
  },
  { kind: "blocked", reason: "other", nodes: ["kernel"], edges: [], tone: "unknown" },
  {
    kind: "held",
    reason: null,
    nodes: ["judiciary", "kernel", "human"],
    edges: ["verdict", "escalate"],
    tone: "waiting",
  },
  { kind: "merged", reason: null, nodes: ["kernel", "merged"], edges: ["merge"], tone: "normal" },
  { kind: "released", reason: null, nodes: ["human", "kernel", "merged"], edges: ["merge"], tone: "normal" },
  { kind: "ruling", reason: null, nodes: ["human", "kernel"], edges: ["ruling"], tone: "normal" },
  { kind: "minor_disagreement", reason: null, nodes: ["judiciary", "kernel"], edges: ["verdict"], tone: "normal" },
  { kind: "resubmitted", reason: null, nodes: ["executive", "kernel"], edges: ["submit"], tone: "normal" },
  { kind: "other", reason: null, nodes: [], edges: [], tone: "unknown" },
];

const sorted = (ids: readonly string[]) => [...ids].sort();

describe("図の部品の ID", () => {
  it("節の ID は tokens.ts の役割と同じ", () => {
    expect(sorted(STAGE_NODE_IDS)).toEqual(sorted(Object.keys(theaterTokens.roles)));
  });

  it("線は8本で、両端は A1 のとおり", () => {
    expect(STAGE_EDGES).toEqual({
      spec: { from: "legislative", to: "executive" },
      submit: { from: "executive", to: "kernel" },
      verdict: { from: "judiciary", to: "kernel" },
      return: { from: "kernel", to: "executive" },
      escalate: { from: "kernel", to: "human" },
      ruling: { from: "human", to: "kernel" },
      approve: { from: "human", to: "legislative" },
      merge: { from: "kernel", to: "merged" },
    });
    expect(STAGE_EDGE_IDS).toHaveLength(8);
  });
});

describe("focusFor", () => {
  it.each(table)("$kind（$reason）", ({ kind, reason, nodes, edges, tone }) => {
    const focus = focusFor({ kind, reason, judge: null, codex: null });
    // 重なりがなく、集合として期待値と完全に一致する（順も表のとおり）
    expect(new Set(focus.nodes).size).toBe(focus.nodes.length);
    expect(new Set(focus.edges).size).toBe(focus.edges.length);
    expect(new Set(focus.nodes)).toEqual(new Set(nodes));
    expect(new Set(focus.edges)).toEqual(new Set(edges));
    expect(focus.nodes).toEqual(nodes);
    expect(focus.edges).toEqual(edges);
    expect(focus.tone).toBe(tone);
  });

  it.each([
    ["APPROVED", "APPROVED"],
    ["APPROVED", "CHANGES_REQUIRED"],
    ["CHANGES_REQUIRED", null],
    [null, null],
  ] as const)("judge %s・codex %s をそのまま返す", (judge, codex) => {
    for (const { kind, reason } of table) {
      const focus = focusFor({ kind, reason, judge, codex });
      expect(focus.judge).toBe(judge);
      expect(focus.codex).toBe(codex);
    }
  });

  it("表にない組み合わせは other と同じ（何も光らせず、確認できない）", () => {
    const unknown = { nodes: [], edges: [], tone: "unknown", judge: null, codex: null };
    expect(focusFor({ kind: "returned", reason: null, judge: null, codex: null })).toEqual(unknown);
    expect(focusFor({ kind: "returned", reason: "disagreement", judge: null, codex: null })).toEqual(unknown);
    expect(focusFor({ kind: "blocked", reason: null, judge: null, codex: null })).toEqual(unknown);
    expect(focusFor({ kind: "blocked", reason: "scope", judge: null, codex: null })).toEqual(unknown);
  });

  it("reason を見ない kind は、reason があっても同じ結果を返す", () => {
    const withoutReason = focusFor({ kind: "merged", reason: null, judge: null, codex: null });
    expect(focusFor({ kind: "merged", reason: "other", judge: null, codex: null })).toEqual(withoutReason);
  });

  it("T-028 の公開用のイベントをそのまま渡せる（型の確認）", () => {
    const event: Replay["tickets"][number]["events"][number] = {
      seq: 1,
      ts: "2026-11-06T01:07:36+0900",
      actor: "gate-runner",
      kind: "merged",
      reason: null,
      judge: "APPROVED",
      codex: "APPROVED",
    };
    expect(focusFor(event).edges).toEqual(["merge"]);
  });
});
