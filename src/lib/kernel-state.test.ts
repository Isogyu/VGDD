// T-022：Kernel の状態の写しの検証・整形・読み込みの試験（A8 の①〜⑬）。
// loadKernelState は一時ディレクトリの root で試す。値はすべて架空。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import * as kernelSubmissionRoute from "@/app/api/governance/kernel/submission/route";
import { GET as kernelLiveGet } from "@/app/api/governance/kernel/route";
import { loadKernelState } from "@/lib/kernel-state";
import {
  formatJst,
  pickKernelState,
  summarizeKernel,
  toWire,
  type KernelAcceptance,
  type KernelBudget,
  type KernelRuns,
  type KernelState,
  type KernelStateWire,
} from "@/lib/kernel-state-schema";

// T-030：route.ts の試験のため。connection() はリクエストの外で呼べないので差し替える
const { connectionMock } = vi.hoisted(() => ({ connectionMock: vi.fn(async () => undefined) }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: connectionMock,
}));

/** 正しい形の状態（JSON の値）。上書きしたい項目は overrides で渡す */
function validJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "vgdd.kernel-state.v1",
    generated_at: "2026-11-06T04:11:00+09:00",
    kernel_version: "p0.4.3",
    policy_version: "p0.4.0",
    stopped: { active: false, since: null },
    judiciary: { status: "ok", kind: null, since: null },
    approvals: [
      { task: "T-010", current: true, approved_at: "2026-11-05T22:58:05+09:00" },
      { task: "T-011", current: false, approved_at: "2026-11-05T22:44:22+09:00" },
    ],
    held: [{ task: "T-020", since: "2026-11-06T01:00:00+09:00" }],
    rulings: { count: 2, tasks: ["T-017", "T-019"] },
    annulments: { count: 16 },
    verdicts: {
      count: 3,
      by_task: {
        "T-015": { judge: "APPROVED", codex: "APPROVED", security: null, at: "2026-11-06T00:39:27+09:00" },
        "T-001": {
          judge: "CHANGES_REQUIRED",
          codex: "APPROVED",
          security: "APPROVED",
          at: "2026-11-03T21:07:35+09:00",
        },
      },
    },
    disagreements: { count: 5, tasks: ["T-001"] },
    evidence: {
      records: 4825,
      chain_ok: true,
      checkpoint_mismatches: 1,
      checkpoint_at: "2026-11-06T04:10:00+09:00",
      last_record_at: "2026-11-06T04:10:59.123+09:00",
    },
    conformance: { passed: 348, total: 348, impl: "z3", kernel_version: "p0.4.3", at: "2026-11-06T04:00:00+09:00" },
    ...overrides,
  };
}

function mustPick(json: unknown): KernelState {
  const s = pickKernelState(json);
  if (s === null) throw new Error("検証に落ちた");
  return s;
}

// ---------- 一時ディレクトリ ----------

const tmpRoots: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kernel-state-test-"));
  tmpRoots.push(root);
  return root;
}

function writeState(root: string, text: string): string {
  const dir = path.join(root, "docs", "governance");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "kernel-state.json");
  fs.writeFileSync(file, text);
  return file;
}

afterEach(() => {
  for (const r of tmpRoots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

// ---------- pickKernelState ----------

describe("pickKernelState", () => {
  it("① 正しい JSON が通り、各項目が入る", () => {
    const s = mustPick(validJson());
    expect(s.schema).toBe("vgdd.kernel-state.v1");
    expect(s.kernel_version).toBe("p0.4.3");
    expect(s.policy_version).toBe("p0.4.0");
    expect(s.stopped).toEqual({ active: false, since: null });
    expect(s.approvals).toHaveLength(2);
    expect(s.held[0]).toEqual({ task: "T-020", since: "2026-11-06T01:00:00+09:00" });
    expect(s.rulings.tasks).toEqual(["T-017", "T-019"]);
    expect(s.annulments.count).toBe(16);
    expect(s.verdicts.count).toBe(3);
    expect(s.verdicts.by_task.size).toBe(2);
    expect(s.verdicts.by_task.get("T-001")?.judge).toBe("CHANGES_REQUIRED");
    expect(s.disagreements.tasks).toEqual(["T-001"]);
    expect(s.evidence.checkpoint_mismatches).toBe(1);
    expect(s.conformance?.impl).toBe("z3");
  });

  it("① 裁判所の書き出し（p0.4.3、06:24 の写しから抜粋して書き写した形）が通る", () => {
    const text = `{
      "schema": "vgdd.kernel-state.v1",
      "generated_at": "2026-11-06T06:24:47+09:00",
      "kernel_version": "p0.4.3",
      "policy_version": "p0.4.3",
      "stopped": { "active": false, "since": null },
      "judiciary": { "status": "ok", "kind": null, "since": null },
      "approvals": [
        { "task": "T-010", "current": true, "approved_at": "2026-11-05T22:58:05+09:00" },
        { "task": "T-023", "current": true, "approved_at": "2026-11-06T06:19:34+09:00" }
      ],
      "held": [],
      "rulings": { "count": 2, "tasks": ["T-017", "T-019"] },
      "annulments": { "count": 16 },
      "verdicts": {
        "count": 114,
        "by_task": {
          "T-000": { "judge": "APPROVED", "codex": "APPROVED", "security": null, "at": "2026-11-03T18:08:59+09:00" },
          "T-017": { "judge": "CHANGES_REQUIRED", "codex": "APPROVED", "security": "APPROVED", "at": "2026-11-06T01:01:10+09:00" }
        }
      },
      "disagreements": { "count": 13, "tasks": ["T-001", "T-017"] },
      "evidence": {
        "records": 4895,
        "chain_ok": true,
        "checkpoint_mismatches": 1,
        "checkpoint_at": "2026-11-06T06:24:43+09:00",
        "last_record_at": "2026-11-06T06:24:46.875+09:00"
      },
      "conformance": { "passed": 348, "total": 348, "impl": "z3", "kernel_version": "p0.4.3", "at": "2026-11-06T06:14:50+09:00" }
    }`;
    const s = mustPick(JSON.parse(text));
    expect(s.verdicts.by_task.size).toBe(2);
    expect(s.conformance?.passed).toBe(348);
    expect(s.evidence.last_record_at).toBe("2026-11-06T06:24:46.875+09:00");
  });

  it("① null・配列・文字列は null", () => {
    expect(pickKernelState(null)).toBeNull();
    expect(pickKernelState([])).toBeNull();
    expect(pickKernelState("x")).toBeNull();
  });

  it("② 未知の項目が1つあると null（strict）", () => {
    expect(pickKernelState(validJson({ extra: 1 }))).toBeNull();
    expect(pickKernelState(validJson({ tickets: { total: 3 } }))).toBeNull();
    const nested = validJson();
    (nested.evidence as Record<string, unknown>).unknown = true;
    expect(pickKernelState(nested)).toBeNull();
    const inVerdicts = validJson();
    (inVerdicts.verdicts as Record<string, unknown>).extra = 1;
    expect(pickKernelState(inVerdicts)).toBeNull();
  });

  it("③ by_task の constructor・__proto__・T-1・T-draft-x の鍵は捨てられ、T-015 は残る", () => {
    const entry = '{"judge":"APPROVED","codex":"APPROVED","security":null,"at":"2026-11-06T00:39:27+09:00"}';
    const base = validJson();
    const text = JSON.stringify(base).replace(
      /"by_task":\{.*?\}\}\}/,
      `"by_task":{"constructor":${entry},"__proto__":${entry},"T-1":${entry},"T-draft-x":${entry},"T-015":${entry}}}`,
    );
    const parsed = JSON.parse(text) as unknown;
    // 入力に __proto__ の鍵が自分の項目として入っていることを確かめる
    const raw = (parsed as { verdicts: { by_task: object } }).verdicts.by_task;
    expect(Object.keys(raw)).toContain("__proto__");

    const s = mustPick(parsed);
    const map = s.verdicts.by_task;
    expect(map instanceof Map).toBe(true);
    expect(map.has("constructor")).toBe(false);
    expect(map.has("__proto__")).toBe(false);
    expect(map.has("T-1")).toBe(false);
    expect(map.has("T-draft-x")).toBe(false);
    expect(map.has("T-015")).toBe(true);
    expect(map.size).toBe(1);
  });

  it("③ by_task が無い・配列なら空の Map", () => {
    const none = mustPick(validJson({ verdicts: { count: 0 } }));
    expect(none.verdicts.by_task instanceof Map).toBe(true);
    expect(none.verdicts.by_task.size).toBe(0);
    const arr = mustPick(validJson({ verdicts: { count: 0, by_task: [] } }));
    expect(arr.verdicts.by_task instanceof Map).toBe(true);
    expect(arr.verdicts.by_task.size).toBe(0);
  });

  it("⑦ judiciary.status が ok で kind が非 null なら null", () => {
    expect(
      pickKernelState(validJson({ judiciary: { status: "ok", kind: "preflight_failed", since: null } })),
    ).toBeNull();
    // unavailable で kind が null も null
    expect(pickKernelState(validJson({ judiciary: { status: "unavailable", kind: null, since: null } }))).toBeNull();
  });

  it("⑦ conformance.passed > total なら null", () => {
    expect(
      pickKernelState(
        validJson({ conformance: { passed: 349, total: 348, impl: "repo", kernel_version: null, at: null } }),
      ),
    ).toBeNull();
    // conformance が null は通る
    expect(mustPick(validJson({ conformance: null })).conformance).toBeNull();
  });

  it("⑨ stopped.active: true と judiciary.status: unavailable の値がそのまま入り、status: down は null", () => {
    const s = mustPick(
      validJson({
        stopped: { active: true, since: "2026-11-06T03:00:00+09:00" },
        judiciary: { status: "unavailable", kind: "judiciary_unavailable", since: "2026-11-06T03:01:00+09:00" },
      }),
    );
    expect(s.stopped).toEqual({ active: true, since: "2026-11-06T03:00:00+09:00" });
    expect(s.judiciary).toEqual({
      status: "unavailable",
      kind: "judiciary_unavailable",
      since: "2026-11-06T03:01:00+09:00",
    });
    expect(
      pickKernelState(validJson({ judiciary: { status: "down", kind: "judiciary_unavailable", since: null } })),
    ).toBeNull();
  });

  it("⑩ by_task の値に codex: SKIPPED を含む1件は落ち、ほかの値は残る", () => {
    const json = validJson();
    const byTask = (json.verdicts as { by_task: Record<string, unknown> }).by_task;
    byTask["T-016"] = { judge: "APPROVED", codex: "SKIPPED", security: null, at: "2026-11-06T00:47:34+09:00" };
    const s = mustPick(json);
    expect(s.verdicts.by_task.has("T-016")).toBe(false);
    expect(s.verdicts.by_task.has("T-015")).toBe(true);
    expect(s.verdicts.by_task.has("T-001")).toBe(true);
  });

  it("⑫ 通信の往復（toWire → JSON → pickKernelState）で by_task の2件が残る", () => {
    const first = mustPick(validJson());
    expect(first.verdicts.by_task.size).toBe(2);
    const wire = JSON.parse(JSON.stringify(toWire(first))) as unknown;
    const second = mustPick(wire);
    expect(second.verdicts.by_task.size).toBe(2);
    expect(second.verdicts.by_task.get("T-015")).toEqual(first.verdicts.by_task.get("T-015"));
    expect(second.verdicts.by_task.get("T-001")).toEqual(first.verdicts.by_task.get("T-001"));
    expect(toWire(second)).toEqual(toWire(first));
  });
});

// ---------- summarizeKernel ----------

describe("summarizeKernel", () => {
  const generatedAt = "2026-11-06T04:11:00+09:00";
  const generatedMs = Date.parse(generatedAt);

  it("⑧ approvedCurrent の数と、approvalsSorted の並び（降順・同時刻は task の昇順・null は末尾）", () => {
    const s = mustPick(
      validJson({
        approvals: [
          { task: "T-030", current: true, approved_at: null },
          { task: "T-012", current: true, approved_at: "2026-11-05T10:00:00+09:00" },
          { task: "T-011", current: false, approved_at: "2026-11-05T12:00:00+09:00" },
          { task: "T-020", current: true, approved_at: null },
          { task: "T-014", current: true, approved_at: "2026-11-05T12:00:00+09:00" },
          { task: "T-013", current: true, approved_at: "2026-11-05T12:00:00+09:00" },
        ],
      }),
    );
    const sum = summarizeKernel(s, new Date(generatedMs));
    expect(sum.approvedCurrent).toBe(5);
    expect(sum.approvalsSorted.map((a) => a.task)).toEqual(["T-011", "T-013", "T-014", "T-012", "T-020", "T-030"]);
    // 元の配列は並べ替えない
    expect(s.approvals[0].task).toBe("T-030");
  });

  it("⑧ verdictRows は task の昇順で disagreed が付き、件数は配列の長さ", () => {
    const s = mustPick(validJson());
    const sum = summarizeKernel(s, new Date(generatedMs));
    expect(sum.verdictRows.map((r) => r.task)).toEqual(["T-001", "T-015"]);
    expect(sum.verdictRows[0].disagreed).toBe(true);
    expect(sum.verdictRows[1].disagreed).toBe(false);
    expect(sum.verdictRows[0].judge).toBe("CHANGES_REQUIRED");
    // count（3）ではなく長さ
    expect(sum.verdictRows).toHaveLength(2);
    expect(sum.heldCount).toBe(1);
    expect(sum.rulingCount).toBe(2);
  });

  it("⑧ generated_at が 11 分前なら stale、9 分前なら stale でない、Date にできなければ stale", () => {
    const s = mustPick(validJson());
    expect(summarizeKernel(s, new Date(generatedMs + 11 * 60_000)).stale).toBe(true);
    expect(summarizeKernel(s, new Date(generatedMs + 9 * 60_000)).stale).toBe(false);
    const bad = mustPick(validJson({ generated_at: "not-a-date-x" }));
    expect(summarizeKernel(bad, new Date(generatedMs)).stale).toBe(true);
  });

  it("⑬ ちょうど 600,000 ミリ秒前は stale でなく、600,001 ミリ秒前は stale", () => {
    const s = mustPick(validJson());
    expect(summarizeKernel(s, new Date(generatedMs + 600_000)).stale).toBe(false);
    expect(summarizeKernel(s, new Date(generatedMs + 600_001)).stale).toBe(true);
  });
});

// ---------- formatJst ----------

describe("formatJst", () => {
  it("⑪ +09:00 の文字列・Z の文字列（JST に変換）・不正な文字列・null", () => {
    expect(formatJst("2026-11-06T04:11:00+09:00")).toBe("11/6 04:11");
    expect(formatJst("2026-11-05T19:11:00Z")).toBe("11/6 04:11");
    expect(formatJst("not-a-date")).toBe("—");
    expect(formatJst(null)).toBe("—");
  });
});

// ---------- loadKernelState ----------

describe("loadKernelState", () => {
  it("① 一時ディレクトリの正しいファイルを読む", () => {
    const root = makeRoot();
    writeState(root, JSON.stringify(validJson()));
    const s = loadKernelState(root);
    expect(s).not.toBeNull();
    expect(s?.verdicts.by_task.size).toBe(2);
  });

  it("④ ファイルがないと null", () => {
    const root = makeRoot();
    expect(loadKernelState(root)).toBeNull();
    fs.mkdirSync(path.join(root, "docs", "governance"), { recursive: true });
    expect(loadKernelState(root)).toBeNull();
  });

  it("④ ファイルがシンボリックリンクなら null", () => {
    const root = makeRoot();
    const dir = path.join(root, "docs", "governance");
    fs.mkdirSync(dir, { recursive: true });
    const real = path.join(root, "real.json");
    fs.writeFileSync(real, JSON.stringify(validJson()));
    fs.symlinkSync(real, path.join(dir, "kernel-state.json"));
    expect(loadKernelState(root)).toBeNull();
  });

  it("④ docs/governance がディレクトリへのシンボリックリンクなら null", () => {
    const root = makeRoot();
    const realDir = path.join(root, "elsewhere");
    fs.mkdirSync(realDir);
    fs.writeFileSync(path.join(realDir, "kernel-state.json"), JSON.stringify(validJson()));
    fs.mkdirSync(path.join(root, "docs"));
    fs.symlinkSync(realDir, path.join(root, "docs", "governance"));
    expect(loadKernelState(root)).toBeNull();
  });

  it("④ docs がディレクトリへのシンボリックリンクなら null", () => {
    const root = makeRoot();
    const realDocs = path.join(root, "elsewhere-docs");
    fs.mkdirSync(path.join(realDocs, "governance"), { recursive: true });
    fs.writeFileSync(path.join(realDocs, "governance", "kernel-state.json"), JSON.stringify(validJson()));
    fs.symlinkSync(realDocs, path.join(root, "docs"));
    expect(loadKernelState(root)).toBeNull();
  });

  it("⑤ ちょうど 1,048,576 バイトは読み、1,048,577 バイトは null", () => {
    const body = JSON.stringify(validJson());
    const root1 = makeRoot();
    const exact = body + " ".repeat(1_048_576 - Buffer.byteLength(body));
    expect(Buffer.byteLength(exact)).toBe(1_048_576);
    writeState(root1, exact);
    expect(loadKernelState(root1)).not.toBeNull();

    const root2 = makeRoot();
    const over = body + " ".repeat(1_048_577 - Buffer.byteLength(body));
    expect(Buffer.byteLength(over)).toBe(1_048_577);
    writeState(root2, over);
    expect(loadKernelState(root2)).toBeNull();
  });

  it("⑥ JSON でないと null", () => {
    const root = makeRoot();
    writeState(root, "{ not json");
    expect(loadKernelState(root)).toBeNull();
  });

  it("② ファイルの中身が strict に落ちると null", () => {
    const root = makeRoot();
    writeState(root, JSON.stringify(validJson({ extra: true })));
    expect(loadKernelState(root)).toBeNull();
  });
});

// ---------- T-030：source（稼働中の写しと提出記録） ----------

const LIVE_VERSION = "p1.1.1-live";
const SUBMISSION_VERSION = "p2.2.2-submission";
const FILE = "kernel-state.json";

/** root の下に docs/governance/snapshots/submission を作って、そのパスを返す */
function makeSubmissionDir(root: string): string {
  const dir = path.join(root, "docs", "governance", "snapshots", "submission");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSubmission(root: string, text: string): string {
  const file = path.join(makeSubmissionDir(root), FILE);
  fs.writeFileSync(file, text);
  return file;
}

describe("loadKernelState の source", () => {
  it("live と submission の両方があるとき、source ごとに正しい方を読む", () => {
    const root = makeRoot();
    writeState(root, JSON.stringify(validJson({ kernel_version: LIVE_VERSION })));
    writeSubmission(root, JSON.stringify(validJson({ kernel_version: SUBMISSION_VERSION })));
    expect(loadKernelState(root, "live")?.kernel_version).toBe(LIVE_VERSION);
    expect(loadKernelState(root, "submission")?.kernel_version).toBe(SUBMISSION_VERSION);
  });

  it("引数1つの呼び出しは live を読む", () => {
    const root = makeRoot();
    writeState(root, JSON.stringify(validJson({ kernel_version: LIVE_VERSION })));
    writeSubmission(root, JSON.stringify(validJson({ kernel_version: SUBMISSION_VERSION })));
    expect(loadKernelState(root)?.kernel_version).toBe(LIVE_VERSION);
  });

  it("片方しかないとき、もう片方に切り替えない", () => {
    const onlySubmission = makeRoot();
    writeSubmission(onlySubmission, JSON.stringify(validJson()));
    expect(loadKernelState(onlySubmission)).toBeNull();
    expect(loadKernelState(onlySubmission, "live")).toBeNull();

    const onlyLive = makeRoot();
    writeState(onlyLive, JSON.stringify(validJson()));
    expect(loadKernelState(onlyLive, "submission")).toBeNull();
  });

  it("snapshots がディレクトリへのリンクなら null（指す先が正しくても）", () => {
    const root = makeRoot();
    const real = path.join(root, "elsewhere");
    fs.mkdirSync(path.join(real, "submission"), { recursive: true });
    fs.writeFileSync(path.join(real, "submission", FILE), JSON.stringify(validJson()));
    fs.mkdirSync(path.join(root, "docs", "governance"), { recursive: true });
    fs.symlinkSync(real, path.join(root, "docs", "governance", "snapshots"));
    expect(loadKernelState(root, "submission")).toBeNull();
  });

  it("submission がディレクトリへのリンクなら null（指す先が正しくても）", () => {
    const root = makeRoot();
    const real = path.join(root, "elsewhere");
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, FILE), JSON.stringify(validJson()));
    fs.mkdirSync(path.join(root, "docs", "governance", "snapshots"), { recursive: true });
    fs.symlinkSync(real, path.join(root, "docs", "governance", "snapshots", "submission"));
    expect(loadKernelState(root, "submission")).toBeNull();
  });

  it("JSON のファイルがリンクなら null（指す先が正しくても）", () => {
    const root = makeRoot();
    const target = path.join(root, "target.json");
    fs.writeFileSync(target, JSON.stringify(validJson()));
    fs.symlinkSync(target, path.join(makeSubmissionDir(root), FILE));
    expect(loadKernelState(root, "submission")).toBeNull();
  });

  it("docs・docs/governance がリンクなら、submission でも null", () => {
    const viaGovernance = makeRoot();
    const realGovernance = path.join(viaGovernance, "elsewhere");
    fs.mkdirSync(path.join(realGovernance, "snapshots", "submission"), { recursive: true });
    fs.writeFileSync(path.join(realGovernance, "snapshots", "submission", FILE), JSON.stringify(validJson()));
    fs.mkdirSync(path.join(viaGovernance, "docs"));
    fs.symlinkSync(realGovernance, path.join(viaGovernance, "docs", "governance"));
    expect(loadKernelState(viaGovernance, "submission")).toBeNull();

    const viaDocs = makeRoot();
    const realDocs = path.join(viaDocs, "elsewhere");
    fs.mkdirSync(path.join(realDocs, "governance", "snapshots", "submission"), { recursive: true });
    fs.writeFileSync(path.join(realDocs, "governance", "snapshots", "submission", FILE), JSON.stringify(validJson()));
    fs.symlinkSync(realDocs, path.join(viaDocs, "docs"));
    expect(loadKernelState(viaDocs, "submission")).toBeNull();
  });

  it("ファイルの場所がディレクトリ（通常のファイルでない）なら null", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(makeSubmissionDir(root), FILE));
    expect(loadKernelState(root, "submission")).toBeNull();
  });

  it("ちょうど 1,048,576 バイトは読み、1,048,577 バイトは null", () => {
    const body = JSON.stringify(validJson());
    const root1 = makeRoot();
    writeSubmission(root1, body + " ".repeat(1_048_576 - Buffer.byteLength(body)));
    expect(loadKernelState(root1, "submission")).not.toBeNull();

    const root2 = makeRoot();
    writeSubmission(root2, body + " ".repeat(1_048_577 - Buffer.byteLength(body)));
    expect(loadKernelState(root2, "submission")).toBeNull();
  });

  it("JSON でない・形が合わないものは null", () => {
    const root = makeRoot();
    writeSubmission(root, "{ not json");
    expect(loadKernelState(root, "submission")).toBeNull();
    writeSubmission(root, JSON.stringify(validJson({ extra: true })));
    expect(loadKernelState(root, "submission")).toBeNull();
  });

  it("A6：リポジトリの実際の提出記録が今の検証に通る", () => {
    expect(loadKernelState(process.cwd(), "submission")).not.toBeNull();
  });
});

// ---------- T-030：GET /api/governance/kernel/submission ----------

describe("GET /api/governance/kernel/submission", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("export する HTTP メソッドは GET だけで、引数を取らない", () => {
    expect(Object.keys(kernelSubmissionRoute)).toEqual(["GET"]);
    expect(kernelSubmissionRoute.GET.length).toBe(0);
  });

  it("source と、通信の形（by_task が残る）の写しを返す", async () => {
    const root = makeRoot();
    writeSubmission(root, JSON.stringify(validJson({ kernel_version: SUBMISSION_VERSION })));
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const r = await kernelSubmissionRoute.GET();
    expect(r.status).toBe(200);
    const body = (await r.json()) as { source: string; state: unknown };
    expect(Object.keys(body).sort()).toEqual(["source", "state"]);
    expect(body.source).toBe("submission");
    const picked = mustPick(body.state);
    expect(picked.kernel_version).toBe(SUBMISSION_VERSION);
    expect(picked.verdicts.by_task.size).toBe(2);
  });

  it("提出記録がなければ state は null", async () => {
    const root = makeRoot();
    // 稼働中の写しがあっても、そちらには切り替えない
    writeState(root, JSON.stringify(validJson()));
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const r = await kernelSubmissionRoute.GET();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ source: "submission", state: null });
  });

  it("例外は本文を入れずに 500", async () => {
    connectionMock.mockRejectedValueOnce(new Error("架空の例外の本文"));
    const r = await kernelSubmissionRoute.GET();
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "kernel_unavailable" });
  });

  it("稼働中の写しがなく提出記録があるとき、今の API は state: null のまま（切り替わらない）", async () => {
    const root = makeRoot();
    writeSubmission(root, JSON.stringify(validJson()));
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const r = await kernelLiveGet();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ state: null });
  });
});

// ---------- T-042：任意の3項目（budget・runs・acceptance） ----------

/** 正しい形の budget（値は架空） */
function validBudget(): Record<string, unknown> {
  return {
    period_id: "2026-11-07-day",
    until: "2026-11-08T09:00:00+09:00",
    tokens: { settled: 120_000, reserved: 30_000, unknown_runs: 1, limit: 2_000_000 },
    judge_calls: { used: 12, limit: 40 },
    attempts: { used: 3, limit: null },
    workers: { active: 2, limit: 3 },
  };
}

function validRuns(): Record<string, unknown> {
  return {
    requested: 1,
    reserved: 1,
    started: 2,
    exited: 0,
    settled: 5,
    cancelled: 1,
    liveness_unknown: 1,
    usage_unknown: 2,
  };
}

function validAcceptance(): Record<string, unknown> {
  return { accepted_count: 3, pending_count: 2, accepted: ["T-010", "T-011", "T-012"], pending: ["T-042", "T-1000"] };
}

function withAll(): Record<string, unknown> {
  return validJson({ budget: validBudget(), runs: validRuns(), acceptance: validAcceptance() });
}

/** JSON の値を複製して、path の場所の値を value に置き換える */
function setAt(json: Record<string, unknown>, keys: string[], value: unknown): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(json)) as Record<string, unknown>;
  let cur: Record<string, unknown> = copy;
  for (const k of keys.slice(0, -1)) cur = cur[k] as Record<string, unknown>;
  cur[keys[keys.length - 1]] = value;
  return copy;
}

/** 3項目の中の数の欄（path）をすべて挙げる */
const NUMBER_PATHS: string[][] = [
  ["budget", "tokens", "settled"],
  ["budget", "tokens", "reserved"],
  ["budget", "tokens", "unknown_runs"],
  ["budget", "tokens", "limit"],
  ["budget", "judge_calls", "used"],
  ["budget", "judge_calls", "limit"],
  ["budget", "attempts", "used"],
  ["budget", "attempts", "limit"],
  ["budget", "workers", "active"],
  ["budget", "workers", "limit"],
  ...Object.keys(validRuns()).map((k) => ["runs", k]),
  ["acceptance", "accepted_count"],
  ["acceptance", "pending_count"],
];

/** 余分な鍵を足して試す階層 */
const OBJECT_PATHS: string[][] = [
  ["budget"],
  ["budget", "tokens"],
  ["budget", "judge_calls"],
  ["budget", "attempts"],
  ["budget", "workers"],
  ["runs"],
  ["acceptance"],
];

describe("T-042：任意の3項目", () => {
  it("3項目のない今の写しが通り、3項目は undefined で鍵もない（pickKernelState・toWire）", () => {
    const s = mustPick(validJson());
    expect(s.budget).toBeUndefined();
    expect(s.runs).toBeUndefined();
    expect(s.acceptance).toBeUndefined();
    for (const k of ["budget", "runs", "acceptance"]) {
      expect(Object.prototype.hasOwnProperty.call(s, k)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(toWire(s), k)).toBe(false);
      expect(JSON.stringify(toWire(s))).not.toContain(`"${k}"`);
    }
  });

  it("リポジトリの提出記録（3項目なし）が今までどおり通る", () => {
    const file = path.join(process.cwd(), "docs", "governance", "snapshots", "submission", "kernel-state.json");
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    expect("budget" in json || "runs" in json || "acceptance" in json).toBe(false);
    const s = mustPick(json);
    expect(s.budget).toBeUndefined();
    expect(s.runs).toBeUndefined();
    expect(s.acceptance).toBeUndefined();
    // loadKernelState からも同じ
    expect(loadKernelState(process.cwd(), "submission")).not.toBeNull();
  });

  it("3項目の正しい合成の値が通り、toWire で同じ値が返る", () => {
    const s = mustPick(withAll());
    expect(s.budget).toEqual(validBudget());
    expect(s.runs).toEqual(validRuns());
    expect(s.acceptance).toEqual(validAcceptance());
    const w = toWire(s);
    expect(w.budget).toEqual(validBudget());
    expect(w.runs).toEqual(validRuns());
    expect(w.acceptance).toEqual(validAcceptance());
    // 通信の往復でも同じ
    const again = mustPick(JSON.parse(JSON.stringify(w)));
    expect(toWire(again)).toEqual(w);
    // 今の項目は変わらない
    expect(s.verdicts.by_task.size).toBe(2);
    expect(s.conformance?.passed).toBe(348);
  });

  it("until が null・Z・小数秒でも通る", () => {
    for (const until of [null, "2026-11-08T00:00:00Z", "2026-11-08T09:00:00.123+09:00", "2028-02-29T23:59:59-05:30"]) {
      expect(pickKernelState(setAt(withAll(), ["budget", "until"], until))).not.toBeNull();
    }
  });

  it("until の境目（9桁の小数秒・うるう年の2月29日・23:59:59・月末の日）が通る", () => {
    for (const until of [
      "2026-11-08T09:00:00.123456789Z",
      "2026-11-08T09:00:00.123456789+09:00",
      "2026-11-08T09:00:00.1Z",
      "2028-02-29T00:00:00Z",
      "2026-11-08T23:59:59+09:00",
      "2026-11-08T23:59:59.999999999Z",
      "2026-04-30T00:00:00Z",
      "2026-12-31T23:59:59-12:00",
      "0000-02-29T00:00:00Z", // ISO 8601 の暦では 0 年はうるう年
    ]) {
      expect(pickKernelState(setAt(withAll(), ["budget", "until"], until))).not.toBeNull();
      expect(mustPick(setAt(withAll(), ["budget", "until"], until)).budget?.until).toBe(until);
    }
  });

  it("3項目のうち1つだけを足した写しが通り、ほかの2つは作られない", () => {
    const cases: [string, Record<string, unknown>][] = [
      ["budget", validBudget()],
      ["runs", validRuns()],
      ["acceptance", validAcceptance()],
    ];
    for (const [key, value] of cases) {
      const s = mustPick(validJson({ [key]: value }));
      expect((s as Record<string, unknown>)[key]).toEqual(value);
      const w = toWire(s) as Record<string, unknown>;
      expect(w[key]).toEqual(value);
      for (const other of ["budget", "runs", "acceptance"].filter((k) => k !== key)) {
        expect(Object.prototype.hasOwnProperty.call(s, other)).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(w, other)).toBe(false);
      }
    }
  });

  it("30,000,000 と Number.MAX_SAFE_INTEGER が数の欄に通る", () => {
    for (const p of NUMBER_PATHS) {
      expect(pickKernelState(setAt(withAll(), p, 30_000_000))).not.toBeNull();
      expect(pickKernelState(setAt(withAll(), p, Number.MAX_SAFE_INTEGER))).not.toBeNull();
    }
    const s = mustPick(setAt(withAll(), ["budget", "tokens", "settled"], 30_000_000));
    expect(s.budget?.tokens.settled).toBe(30_000_000);
  });

  it("足したすべての階層の余分な鍵で、写し全体が null", () => {
    for (const p of OBJECT_PATHS) {
      expect(pickKernelState(setAt(withAll(), [...p, "extra"], 1))).toBeNull();
      expect(pickKernelState(setAt(withAll(), [...p, "reason"], "理由の本文"))).toBeNull();
      expect(pickKernelState(setAt(withAll(), [...p, "path"], "/架空/パス"))).toBeNull();
      expect(pickKernelState(setAt(withAll(), [...p, "sha256"], "0".repeat(64)))).toBeNull();
    }
  });

  it("数の欄の負の数・小数・安全な整数の範囲外・文字列で、写し全体が null", () => {
    for (const p of NUMBER_PATHS) {
      for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, 2 ** 60, "1", Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(pickKernelState(setAt(withAll(), p, bad))).toBeNull();
      }
    }
    // limit 以外の数は null も拒む
    expect(pickKernelState(setAt(withAll(), ["budget", "tokens", "settled"], null))).toBeNull();
    expect(pickKernelState(setAt(withAll(), ["runs", "started"], null))).toBeNull();
    expect(pickKernelState(setAt(withAll(), ["acceptance", "accepted_count"], null))).toBeNull();
  });

  it("配列の票の ID でない文字列と 501 件で、写し全体が null（500 件は通る）", () => {
    for (const key of ["accepted", "pending"]) {
      for (const bad of ["T-1", "T-12345", "T-draft-x", "t-010", "T-010 ", "x", "", "T-０１０"]) {
        expect(pickKernelState(setAt(withAll(), ["acceptance", key], [bad]))).toBeNull();
      }
      expect(pickKernelState(setAt(withAll(), ["acceptance", key], [10]))).toBeNull();
      const ids = (n: number) => Array.from({ length: n }, (_, i) => `T-${String(i).padStart(4, "0")}`);
      const ok = setAt(setAt(withAll(), ["acceptance", key], ids(500)), ["acceptance", `${key}_count`], 500);
      expect(pickKernelState(ok)).not.toBeNull();
      const over = setAt(setAt(withAll(), ["acceptance", key], ids(501)), ["acceptance", `${key}_count`], 501);
      expect(pickKernelState(over)).toBeNull();
    }
  });

  it("長すぎる・空の period_id で、写し全体が null（40 字は通る）", () => {
    expect(pickKernelState(setAt(withAll(), ["budget", "period_id"], "p".repeat(40)))).not.toBeNull();
    expect(pickKernelState(setAt(withAll(), ["budget", "period_id"], "p".repeat(41)))).toBeNull();
    expect(pickKernelState(setAt(withAll(), ["budget", "period_id"], ""))).toBeNull();
    expect(pickKernelState(setAt(withAll(), ["budget", "period_id"], 1))).toBeNull();
    expect(pickKernelState(setAt(withAll(), ["budget", "period_id"], null))).toBeNull();
  });

  it("不正な until で、写し全体が null", () => {
    for (const bad of [
      "2026-11-08T09:00:00", // タイムゾーンなし
      "2026-11-08",
      "not-a-date",
      "",
      "2026-02-30T00:00:00+09:00", // 存在しない日
      "2027-02-29T00:00:00Z",
      "2026-13-01T00:00:00Z",
      "2026-11-08T24:00:00Z",
      "2026-11-08T09:60:00Z",
      "2026-11-08T09:00:60Z",
      "2026-11-08T09:00:00+24:00",
      "2026-11-08T09:00:00+0900",
      "2026-11-08T09:00:00+09:00 ",
      "2026-11-08T09:00:00+09:00" + "0".repeat(20),
      123,
      "2026-11-08T09:00+09:00", // 秒の省略
      "2026-11-08T09:00Z",
      "2026-11-08T09:00:00.1234567890Z", // 10桁の小数秒
      "2026-11-08T09:00:00.Z", // 小数点だけで桁がない
      "2026-04-31T00:00:00Z", // 30日までの月の31日
      "2026-11-08T24:00:00.000+09:00", // 24時（小数秒つき）
      "0001-02-29T00:00:00Z", // 1 年はうるう年でない
    ]) {
      expect(pickKernelState(setAt(withAll(), ["budget", "until"], bad))).toBeNull();
    }
  });

  it("件数が配列の長さより小さい acceptance で、写し全体が null（等しい・大きいは通る）", () => {
    expect(pickKernelState(setAt(withAll(), ["acceptance", "accepted_count"], 2))).toBeNull();
    expect(pickKernelState(setAt(withAll(), ["acceptance", "pending_count"], 1))).toBeNull();
    expect(pickKernelState(setAt(withAll(), ["acceptance", "accepted_count"], 3))).not.toBeNull();
    expect(pickKernelState(setAt(withAll(), ["acceptance", "accepted_count"], 100))).not.toBeNull();
  });

  it("3項目の欠けた鍵・オブジェクトでない値で、写し全体が null", () => {
    const noTokens = validBudget();
    delete noTokens.tokens;
    expect(pickKernelState(validJson({ budget: noTokens }))).toBeNull();
    const noUsage = validRuns();
    delete noUsage.usage_unknown;
    expect(pickKernelState(validJson({ runs: noUsage }))).toBeNull();
    for (const key of ["budget", "runs", "acceptance"]) {
      for (const bad of [null, [], "x", 1]) {
        expect(pickKernelState(validJson({ [key]: bad }))).toBeNull();
      }
    }
  });

  it("型：KernelState と KernelStateWire に3つが任意の項目として入る", () => {
    expectTypeOf<KernelState["budget"]>().toEqualTypeOf<KernelBudget | undefined>();
    expectTypeOf<KernelState["runs"]>().toEqualTypeOf<KernelRuns | undefined>();
    expectTypeOf<KernelState["acceptance"]>().toEqualTypeOf<KernelAcceptance | undefined>();
    expectTypeOf<KernelStateWire["budget"]>().toEqualTypeOf<KernelBudget | undefined>();
    expectTypeOf<KernelStateWire["runs"]>().toEqualTypeOf<KernelRuns | undefined>();
    expectTypeOf<KernelStateWire["acceptance"]>().toEqualTypeOf<KernelAcceptance | undefined>();
    expectTypeOf<KernelBudget["period_id"]>().toEqualTypeOf<string>();
    expectTypeOf<KernelBudget["until"]>().toEqualTypeOf<string | null>();
    expectTypeOf<KernelAcceptance["accepted"]>().toEqualTypeOf<string[]>();
  });
});
