// T-030：/api/governance/replay の応答の検証の試験（A5）。値はすべて架空。

import fs from "node:fs";
import path from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import { loadGovernance } from "@/lib/governance";
import { buildReplay, type GovernanceReplay } from "@/lib/governance-replay";
import { pickReplay, type Replay } from "@/lib/governance-replay-schema";

type Json = Record<string, unknown>;

function validEvent(overrides: Json = {}): Json {
  return {
    seq: 1,
    ts: "2099-01-02T03:04:05+0900",
    actor: "gate-runner",
    kind: "returned",
    reason: "scope",
    judge: "CHANGES_REQUIRED",
    codex: "APPROVED",
    ...overrides,
  };
}

function validTicket(overrides: Json = {}): Json {
  return { id: "T-900", title: "架空の票", status: "merged", events: [validEvent()], ...overrides };
}

function validReplay(overrides: Json = {}): Json {
  return {
    schema: "vgdd.governance-replay.v1",
    generated_at: "2099-01-02T03:04:05+09:00",
    tickets: [validTicket()],
    ...overrides,
  };
}

const EVENT_KEYS = ["actor", "codex", "judge", "kind", "reason", "seq", "ts"];

describe("pickReplay：正しい応答", () => {
  it("正しい応答が同じ中身で通る", () => {
    expect(pickReplay(validReplay())).toEqual(validReplay());
  });

  it("票もイベントも空でも通り、reason・judge・codex は null でも通る", () => {
    expect(pickReplay(validReplay({ tickets: [] }))).not.toBeNull();
    expect(pickReplay(validReplay({ tickets: [validTicket({ events: [] })] }))).not.toBeNull();
    expect(
      pickReplay(validReplay({ tickets: [validTicket({ events: [validEvent({ reason: null, judge: null, codex: null })] })] })),
    ).not.toBeNull();
  });

  it.each([
    ["kind", ["returned", "blocked", "held", "merged", "released", "ruling", "minor_disagreement", "resubmitted", "other"]],
    ["reason", ["scope", "rebase", "security", "judiciary", "disagreement", "return_limit", "spec_unapproved", "other"]],
    ["actor", ["gate-runner", "night-runner", "release"]],
    ["judge", ["APPROVED", "CHANGES_REQUIRED"]],
    ["codex", ["APPROVED", "CHANGES_REQUIRED"]],
  ])("%s の列挙値はすべて通る（T-028 の §2 A1 の表と同じ）", (key, values) => {
    for (const value of values) {
      const json = validReplay({ tickets: [validTicket({ events: [validEvent({ [key]: value })] })] });
      expect(pickReplay(json)?.tickets[0].events[0]).toMatchObject({ [key]: value });
    }
  });
});

describe("pickReplay：余分なキー", () => {
  it("トップ・票・イベントの余分なキーが落ち、キーの集合がちょうどになる", () => {
    const secret = "docs/tasks/T-900-kasou.md abc1234def 架空の理由の文";
    const r = pickReplay(
      validReplay({
        extra: secret,
        tickets: [validTicket({ summary: secret, events: [validEvent({ detail: secret, sha: secret })] })],
      }),
    );
    expect(r).not.toBeNull();
    expect(Object.keys(r as Replay).sort()).toEqual(["generated_at", "schema", "tickets"]);
    expect(Object.keys((r as Replay).tickets[0]).sort()).toEqual(["events", "id", "status", "title"]);
    expect(Object.keys((r as Replay).tickets[0].events[0]).sort()).toEqual(EVENT_KEYS);
    expect(JSON.stringify(r)).not.toContain(secret);
  });

  it("JSON に入った __proto__ の鍵も残らず、プロトタイプも変わらない", () => {
    const parsed = JSON.parse(
      JSON.stringify(validReplay()).replace('"seq":1', '"__proto__":{"polluted":"架空の文"},"seq":1'),
    ) as unknown;
    const r = pickReplay(parsed);
    const event = r?.tickets[0].events[0];
    expect(event).toBeDefined();
    expect(Object.keys(event as object)).not.toContain("__proto__");
    expect((event as unknown as { polluted?: unknown }).polluted).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain("架空の文");
  });

  it("入力のオブジェクトをそのまま返さない", () => {
    const json = validReplay();
    const r = pickReplay(json);
    expect(r).not.toBe(json);
    expect(r?.tickets[0]).not.toBe((json.tickets as unknown[])[0]);
  });
});

describe("pickReplay：形の違い", () => {
  it.each([
    ["kind", "unknown_kind"],
    ["reason", "unknown_reason"],
    ["actor", "worker"],
    ["judge", "SKIPPED"],
    ["codex", "APPROVED_EXTRA"],
  ])("%s が列挙値の外なら null", (key, value) => {
    const json = validReplay({ tickets: [validTicket({ events: [validEvent({ [key]: value })] })] });
    expect(pickReplay(json)).toBeNull();
  });

  it.each([
    ["seq が文字列", { seq: "1" }],
    ["seq が null", { seq: null }],
    ["seq が 0", { seq: 0 }],
    ["seq が小数", { seq: 1.5 }],
    ["ts が自由な文", { ts: "docs/tasks/T-900-kasou.md" }],
    ["ts が別の形", { ts: "2099-01-02" }],
    ["reason が欠ける", { reason: undefined }],
  ])("%s なら null", (_name, overrides) => {
    const json = validReplay({ tickets: [validTicket({ events: [validEvent(overrides)] })] });
    expect(pickReplay(json)).toBeNull();
  });

  it.each([
    ["文字列", "x"],
    ["オブジェクト", {}],
    ["null", null],
    ["欠ける", undefined],
  ])("events が配列でない（%s）なら null", (_name, events) => {
    expect(pickReplay(validReplay({ tickets: [validTicket({ events })] }))).toBeNull();
  });

  it("schema・generated_at・tickets・票の項目が違うと null", () => {
    expect(pickReplay(validReplay({ schema: "vgdd.governance-replay.v2" }))).toBeNull();
    expect(pickReplay(validReplay({ generated_at: 1 }))).toBeNull();
    expect(pickReplay(validReplay({ tickets: {} }))).toBeNull();
    expect(pickReplay(validReplay({ tickets: [validTicket({ id: 1 })] }))).toBeNull();
    expect(pickReplay(validReplay({ tickets: [validTicket({ title: null })] }))).toBeNull();
    expect(pickReplay(validReplay({ tickets: [validTicket({ status: undefined })] }))).toBeNull();
  });

  it("null・配列・文字列・エラーの応答は null", () => {
    expect(pickReplay(null)).toBeNull();
    expect(pickReplay([])).toBeNull();
    expect(pickReplay("x")).toBeNull();
    expect(pickReplay({ error: "governance_replay_unavailable" })).toBeNull();
  });
});

describe("T-028 との一致", () => {
  it("検証の型が T-028 の応答の型と同じ（列挙値がずれると型検査で落ちる）", () => {
    expectTypeOf<Replay>().toEqualTypeOf<GovernanceReplay>();
  });

  it("リポジトリの実際の票から作った応答が、そのままの中身で通る", () => {
    const wire = JSON.parse(JSON.stringify(buildReplay(loadGovernance(process.cwd())))) as GovernanceReplay;
    expect(wire.tickets.length).toBeGreaterThan(0);
    expect(wire.tickets.some((t) => t.events.length > 0)).toBe(true);
    expect(pickReplay(wire)).toEqual(wire);
  });
});

describe("クライアントで使えること", () => {
  it("node:fs と governance-replay.ts を読まない", () => {
    const text = fs.readFileSync(path.join(process.cwd(), "src/lib/governance-replay-schema.ts"), "utf8");
    const imports = text.split("\n").filter((l) => l.startsWith("import "));
    expect(imports).toEqual(['import { z } from "zod";']);
  });
});
