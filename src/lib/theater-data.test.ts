// T-030：統治シアターのデータを取る関数の試験（A5）。偽の fetchFn で試す。値はすべて架空。
// 最後の describe だけ、実際の route.ts の GET を fetchFn からつなぎ、リポジトリの提出記録を読む。

import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as invariantsLiveGet } from "@/app/api/governance/kernel/invariants/route";
import { GET as invariantsSubmissionGet } from "@/app/api/governance/kernel/invariants/submission/route";
import { GET as kernelLiveGet } from "@/app/api/governance/kernel/route";
import { GET as kernelSubmissionGet } from "@/app/api/governance/kernel/submission/route";
import { GET as replayGet } from "@/app/api/governance/replay/route";
import { loadTheaterData, type TheaterSource } from "@/lib/theater-data";

// connection() はリクエストの外で呼べないので、試験では待つだけにする
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => undefined,
}));

const REPLAY_URL = "/api/governance/replay";
const URLS: Record<TheaterSource, { state: string; invariants: string }> = {
  live: { state: "/api/governance/kernel", invariants: "/api/governance/kernel/invariants" },
  submission: {
    state: "/api/governance/kernel/submission",
    invariants: "/api/governance/kernel/invariants/submission",
  },
};
const SOURCES: TheaterSource[] = ["live", "submission"];
const ITEMS = ["replay", "state", "invariants"] as const;
type Item = (typeof ITEMS)[number];

const replayBody = {
  schema: "vgdd.governance-replay.v1",
  generated_at: "2099-01-02T03:04:05+09:00",
  tickets: [
    {
      id: "T-900",
      title: "架空の票",
      status: "merged",
      events: [
        {
          seq: 1,
          ts: "2099-01-02T03:04:05+0900",
          actor: "release",
          kind: "released",
          reason: null,
          judge: "APPROVED",
          codex: "APPROVED",
        },
      ],
    },
  ],
};

const STATE_GENERATED_AT = "2099-01-02T03:04:06+09:00";
const stateWire = {
  schema: "vgdd.kernel-state.v1",
  generated_at: STATE_GENERATED_AT,
  kernel_version: "p9.8.7",
  policy_version: "p9.8.7",
  stopped: { active: false, since: null },
  judiciary: { status: "ok", kind: null, since: null },
  approvals: [],
  held: [],
  rulings: { count: 0, tasks: [] },
  annulments: { count: 0 },
  verdicts: {
    count: 1,
    by_task: { "T-900": { judge: "APPROVED", codex: "APPROVED", security: null, at: STATE_GENERATED_AT } },
  },
  disagreements: { count: 0, tasks: [] },
  evidence: { records: 1, chain_ok: true, checkpoint_mismatches: 0, checkpoint_at: null, last_record_at: null },
  conformance: null,
};

const invariantsWire = {
  schema: "vgdd.kernel-invariants.v1",
  generated_at: "2099-01-02T03:04:07+09:00",
  kernel_version: "p9.8.7",
  verified_by: null,
  invariants: [{ id: "INV-01", status: "enforced", tests: 1, verified: true }],
  pending_approvals: [],
};

/** 正しい応答の本文。submission の2つには source が付く */
function bodyOf(source: TheaterSource, item: Item): Record<string, unknown> {
  if (item === "replay") return replayBody;
  const value = item === "state" ? stateWire : invariantsWire;
  return source === "submission" ? { source: "submission", [item]: value } : { [item]: value };
}

function urlOf(source: TheaterSource, item: Item): string {
  return item === "replay" ? REPLAY_URL : URLS[source][item];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** 偽の fetchFn。上書きのない URL には正しい応答を返す。知らない URL は 404。呼ばれた URL を記録する */
function fakeFetch(source: TheaterSource, overrides: Record<string, () => Promise<Response>> = {}) {
  const calls: string[] = [];
  const known = new Map(ITEMS.map((item) => [urlOf(source, item), bodyOf(source, item)]));
  const fetchFn = async (url: string): Promise<Response> => {
    calls.push(url);
    const override = overrides[url];
    if (override) return override();
    const body = known.get(url);
    return body === undefined ? jsonResponse({ error: "not_found" }, 404) : jsonResponse(body);
  };
  return { fetchFn, calls };
}

function expectedUrls(source: TheaterSource): string[] {
  return [REPLAY_URL, URLS[source].state, URLS[source].invariants].sort();
}

describe("取りに行く URL", () => {
  it("live は replay・kernel・invariants の3つだけを1回ずつ呼ぶ", async () => {
    const { fetchFn, calls } = fakeFetch("live");
    await loadTheaterData("live", fetchFn);
    expect([...calls].sort()).toEqual(
      ["/api/governance/replay", "/api/governance/kernel", "/api/governance/kernel/invariants"].sort(),
    );
  });

  it("submission は replay・kernel/submission・invariants/submission の3つだけを1回ずつ呼ぶ", async () => {
    const { fetchFn, calls } = fakeFetch("submission");
    await loadTheaterData("submission", fetchFn);
    expect([...calls].sort()).toEqual(
      [
        "/api/governance/replay",
        "/api/governance/kernel/submission",
        "/api/governance/kernel/invariants/submission",
      ].sort(),
    );
  });
});

describe("すべて成功したとき", () => {
  it.each(SOURCES)("%s：返り値の形と generated_at", async (source) => {
    const { fetchFn } = fakeFetch(source);
    const d = await loadTheaterData(source, fetchFn);
    expect(Object.keys(d).sort()).toEqual(["generated_at", "invariants", "replay", "source", "state"]);
    expect(d.source).toBe(source);
    expect(d.generated_at).toBe(STATE_GENERATED_AT);
    expect(d.replay).toEqual({ kind: "ok", value: replayBody });
    if (d.state.kind !== "ok") throw new Error("state が ok でない");
    // pickKernelState を通ったので by_task は Map
    expect(d.state.value.verdicts.by_task.get("T-900")?.judge).toBe("APPROVED");
    expect(d.invariants).toEqual({ kind: "ok", value: invariantsWire });
  });
});

describe("missing", () => {
  it("live で Kernel が null なら missing で generated_at は null、submission の URL を呼ばない", async () => {
    const { fetchFn, calls } = fakeFetch("live", {
      [URLS.live.state]: async () => jsonResponse({ state: null }),
    });
    const d = await loadTheaterData("live", fetchFn);
    expect(d.state).toEqual({ kind: "missing" });
    expect(d.generated_at).toBeNull();
    expect([...calls].sort()).toEqual(expectedUrls("live"));
    expect(calls.some((u) => u.includes("submission"))).toBe(false);
  });

  it("live で不変条件が null なら missing", async () => {
    const { fetchFn } = fakeFetch("live", {
      [URLS.live.invariants]: async () => jsonResponse({ invariants: null }),
    });
    const d = await loadTheaterData("live", fetchFn);
    expect(d.invariants).toEqual({ kind: "missing" });
    expect(d.generated_at).toBe(STATE_GENERATED_AT);
  });

  it("submission で source が正しく写しが null なら missing", async () => {
    const { fetchFn } = fakeFetch("submission", {
      [URLS.submission.state]: async () => jsonResponse({ source: "submission", state: null }),
      [URLS.submission.invariants]: async () => jsonResponse({ source: "submission", invariants: null }),
    });
    const d = await loadTheaterData("submission", fetchFn);
    expect(d.state).toEqual({ kind: "missing" });
    expect(d.invariants).toEqual({ kind: "missing" });
    expect(d.generated_at).toBeNull();
  });
});

// どの失敗も、どの項目でも、どの source でも同じに扱う
const FAILURES: [string, () => Promise<Response>][] = [
  ["500", async () => jsonResponse({ error: "kernel_unavailable" }, 500)],
  ["404", async () => jsonResponse({ error: "not_found" }, 404)],
  ["200 以外の成功（201）", async () => jsonResponse({}, 201)],
  ["fetch の例外", () => Promise.reject(new Error("架空の通信の失敗"))],
  ["JSON の読み取りの失敗", async () => new Response("{ JSON ではない", { status: 200 })],
  ["形の違い（空のオブジェクト）", async () => jsonResponse({})],
  ["形の違い（配列）", async () => jsonResponse([])],
  ["形の違い（null）", async () => jsonResponse(null)],
];

describe("failed", () => {
  for (const source of SOURCES) {
    for (const item of ITEMS) {
      it.each(FAILURES)(`${source} の ${item}：%s で failed になり、ほかの2つは ok、別の source を呼ばない`, async (_name, respond) => {
        const { fetchFn, calls } = fakeFetch(source, { [urlOf(source, item)]: respond });
        const d = await loadTheaterData(source, fetchFn);
        expect(d[item]).toEqual({ kind: "failed" });
        for (const other of ITEMS.filter((i) => i !== item)) {
          expect(d[other].kind).toBe("ok");
        }
        expect(d.generated_at).toBe(item === "state" ? null : STATE_GENERATED_AT);
        expect([...calls].sort()).toEqual(expectedUrls(source));
      });
    }
  }

  it.each(SOURCES)("%s：fetchFn が同期で例外を投げても、3つとも failed で返る", async (source) => {
    const calls: string[] = [];
    const d = await loadTheaterData(source, (url) => {
      calls.push(url);
      throw new Error("架空の同期の失敗");
    });
    expect(d).toEqual({
      source,
      replay: { kind: "failed" },
      state: { kind: "failed" },
      invariants: { kind: "failed" },
      generated_at: null,
    });
    expect([...calls].sort()).toEqual(expectedUrls(source));
  });

  it.each(SOURCES)("%s：Kernel の写しの中身が検証に通らないと failed", async (source) => {
    const bad = { ...stateWire, extra: 1 };
    const { fetchFn } = fakeFetch(source, {
      [URLS[source].state]: async () =>
        jsonResponse(source === "submission" ? { source: "submission", state: bad } : { state: bad }),
    });
    const d = await loadTheaterData(source, fetchFn);
    expect(d.state).toEqual({ kind: "failed" });
    expect(d.generated_at).toBeNull();
  });

  it.each(SOURCES)("%s：不変条件の写しの中身が検証に通らないと failed", async (source) => {
    const bad = { ...invariantsWire, extra: 1 };
    const { fetchFn } = fakeFetch(source, {
      [URLS[source].invariants]: async () =>
        jsonResponse(source === "submission" ? { source: "submission", invariants: bad } : { invariants: bad }),
    });
    expect((await loadTheaterData(source, fetchFn)).invariants).toEqual({ kind: "failed" });
  });

  it.each([
    ["欠け", {}],
    ["live", { source: "live" }],
    ["大文字の違い", { source: "Submission" }],
    ["null", { source: null }],
  ])("submission の応答の source が %s なら、写しが正しくても null でも failed", async (_name, sourceField) => {
    for (const value of ["valid", "null"] as const) {
      const { fetchFn } = fakeFetch("submission", {
        [URLS.submission.state]: async () => jsonResponse({ ...sourceField, state: value === "valid" ? stateWire : null }),
        [URLS.submission.invariants]: async () =>
          jsonResponse({ ...sourceField, invariants: value === "valid" ? invariantsWire : null }),
      });
      const d = await loadTheaterData("submission", fetchFn);
      expect(d.state).toEqual({ kind: "failed" });
      expect(d.invariants).toEqual({ kind: "failed" });
      expect(d.replay.kind).toBe("ok");
      expect(d.generated_at).toBeNull();
    }
  });

  it("replay が検証に通らないと failed で、missing にはならない", async () => {
    for (const body of [{ ...replayBody, schema: "x" }, { tickets: null }, null]) {
      const { fetchFn } = fakeFetch("live", { [REPLAY_URL]: async () => jsonResponse(body) });
      expect((await loadTheaterData("live", fetchFn)).replay).toEqual({ kind: "failed" });
    }
  });
});

describe("source を変えない", () => {
  it.each(SOURCES)("%s：3つとも失敗しても、自分の source の URL を1回ずつ呼ぶだけ", async (source) => {
    const fail = async () => jsonResponse({ error: "unavailable" }, 500);
    const { fetchFn, calls } = fakeFetch(source, {
      [REPLAY_URL]: fail,
      [URLS[source].state]: fail,
      [URLS[source].invariants]: fail,
    });
    const d = await loadTheaterData(source, fetchFn);
    expect(d.source).toBe(source);
    expect([...calls].sort()).toEqual(expectedUrls(source));
  });
});

describe("公開しない項目", () => {
  it("detail・SHA・パスを足した replay の応答から、それらが返り値に残らない", async () => {
    const detail = "status → merged（main=abc1234def567 の docs/tasks/T-900-kasou.md を統合した架空の文）";
    const sha = "abc1234def567";
    const filePath = "/Users/kasou/project/docs/tasks/T-900-kasou.md";
    const body = {
      ...replayBody,
      detail,
      sha,
      path: filePath,
      tickets: replayBody.tickets.map((t) => ({
        ...t,
        detail,
        sha,
        path: filePath,
        events: t.events.map((e) => ({ ...e, detail, sha, path: filePath })),
      })),
    };
    const { fetchFn } = fakeFetch("submission", { [REPLAY_URL]: async () => jsonResponse(body) });
    const d = await loadTheaterData("submission", fetchFn);
    expect(d.replay).toEqual({ kind: "ok", value: replayBody });
    const text = JSON.stringify(d);
    expect(text).not.toContain("abc1234def567");
    expect(text).not.toContain("docs/tasks");
    expect(text).not.toContain("detail");
    expect(text).not.toContain('"sha"');
    expect(text).not.toContain('"path"');
  });
});

describe("クライアントで使えること", () => {
  it("node:fs と governance-replay.ts・governance.ts を読まない", () => {
    const text = fs.readFileSync(path.join(process.cwd(), "src/lib/theater-data.ts"), "utf8");
    const imports = text.split("\n").filter((l) => l.startsWith("import "));
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) {
      expect(line).not.toMatch(/node:|"fs"|"path"|@\/lib\/governance(-replay)?"|@\/lib\/kernel-(state|invariants)"/);
    }
  });
});

describe("実際の route.ts とのつなぎ", () => {
  const routes: Record<string, () => Promise<Response>> = {
    [REPLAY_URL]: replayGet,
    [URLS.live.state]: kernelLiveGet,
    [URLS.live.invariants]: invariantsLiveGet,
    [URLS.submission.state]: kernelSubmissionGet,
    [URLS.submission.invariants]: invariantsSubmissionGet,
  };

  let calls: string[] = [];
  const fetchFn = async (url: string): Promise<Response> => {
    calls.push(url);
    return routes[url]();
  };

  beforeEach(() => {
    calls = [];
  });

  it("submission：リポジトリの提出記録が、API と検証を通って3つとも ok になる", async () => {
    const d = await loadTheaterData("submission", fetchFn);
    expect(d.replay.kind).toBe("ok");
    expect(d.state.kind).toBe("ok");
    expect(d.invariants.kind).toBe("ok");
    if (d.state.kind !== "ok") throw new Error("state が ok でない");
    expect(d.generated_at).toBe(d.state.value.generated_at);
    // Map のまま JSON にすると by_task が空になるので、toWire を通っていることを件数で確かめる
    expect(d.state.value.verdicts.by_task.size).toBeGreaterThan(0);
    expect([...calls].sort()).toEqual(expectedUrls("submission"));
  });

  it("live：稼働中の写しを読み、submission の URL を呼ばない", async () => {
    const d = await loadTheaterData("live", fetchFn);
    expect(d.replay.kind).toBe("ok");
    // 稼働中の写しは git で追跡しないので、ある環境とない環境の両方がある
    expect(["ok", "missing"]).toContain(d.state.kind);
    expect(["ok", "missing"]).toContain(d.invariants.kind);
    expect([...calls].sort()).toEqual(expectedUrls("live"));
  });
});
