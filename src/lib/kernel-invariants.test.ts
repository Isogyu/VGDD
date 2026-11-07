// T-024：不変条件と承認待ちの写しの検証・集計・読み込みの試験（A7 の①〜⑥）。
// loadKernelInvariants は一時ディレクトリの root で試す。
// 版・日時・票番号・判例の件数はすべて架空（schema・impl・status は形が決めている定数、INV の番号は形を試すための値）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as invariantsLiveGet } from "@/app/api/governance/kernel/invariants/route";
import * as invariantsSubmissionRoute from "@/app/api/governance/kernel/invariants/submission/route";
import { loadKernelInvariants } from "@/lib/kernel-invariants";
import {
  pickKernelInvariants,
  summarizeInvariants,
  type KernelInvariants,
} from "@/lib/kernel-invariants-schema";

// T-030：route.ts の試験のため。connection() はリクエストの外で呼べないので差し替える
const { connectionMock } = vi.hoisted(() => ({ connectionMock: vi.fn(async () => undefined) }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: connectionMock,
}));

const MAX_BYTES = 1_048_576;

/** 正しい形の写し（JSON の値）。上書きしたい項目は overrides で渡す */
function validJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "vgdd.kernel-invariants.v1",
    generated_at: "2099-01-02T03:04:05+09:00",
    kernel_version: "p9.8.7",
    verified_by: { kernel_version: "p9.8.7", impl: "z3", at: "2099-01-02T03:00:00.123Z" },
    invariants: [
      { id: "INV-01", status: "enforced", tests: 7, verified: true },
      { id: "INV-02", status: "partial", tests: 3, verified: false },
      { id: "INV-03", status: "not_applicable", tests: 0, verified: null },
    ],
    pending_approvals: [
      { task: "T-9001", status: "ready" },
      { task: "T-902", status: "blocked" },
    ],
    ...overrides,
  };
}

function mustPick(json: unknown): KernelInvariants {
  const x = pickKernelInvariants(json);
  if (x === null) throw new Error("検証に落ちた");
  return x;
}

// ---------- ① 正しい JSON ----------

describe("pickKernelInvariants：正しい JSON", () => {
  it("正しい JSON が通る", () => {
    const x = mustPick(validJson());
    expect(x.kernel_version).toBe("p9.8.7");
    expect(x.invariants).toHaveLength(3);
    expect(x.pending_approvals[1]).toEqual({ task: "T-902", status: "blocked" });
  });

  it("kernel_version・verified_by・verified_by.at が null でも通り、配列は空でも通る", () => {
    expect(
      pickKernelInvariants(
        validJson({ kernel_version: null, verified_by: null, invariants: [], pending_approvals: [] }),
      ),
    ).not.toBeNull();
    expect(
      pickKernelInvariants(validJson({ verified_by: { kernel_version: "p9.8.7a", impl: "z3", at: null } })),
    ).not.toBeNull();
  });
});

// ---------- ② strict ----------

describe("pickKernelInvariants：未知の項目（strict）", () => {
  it("外側に未知の項目が1つあると null", () => {
    expect(pickKernelInvariants(validJson({ extra: 1 }))).toBeNull();
  });

  it("invariants の要素に未知の項目が1つあると null", () => {
    expect(
      pickKernelInvariants(
        validJson({ invariants: [{ id: "INV-01", status: "enforced", tests: 1, verified: true, extra: 1 }] }),
      ),
    ).toBeNull();
  });

  it("pending_approvals の要素に未知の項目が1つあると null", () => {
    expect(
      pickKernelInvariants(validJson({ pending_approvals: [{ task: "T-9001", status: "ready", extra: 1 }] })),
    ).toBeNull();
  });

  it("verified_by に未知の項目が1つあると null", () => {
    expect(
      pickKernelInvariants(
        validJson({ verified_by: { kernel_version: "p9.8.7", impl: "z3", at: null, extra: 1 } }),
      ),
    ).toBeNull();
  });
});

// ---------- ③ 4つの入力を別々に ----------

describe("pickKernelInvariants：形の違う値", () => {
  it('invariants[].status が "done" なら null', () => {
    expect(
      pickKernelInvariants(validJson({ invariants: [{ id: "INV-01", status: "done", tests: 1, verified: true }] })),
    ).toBeNull();
  });

  it('invariants[].id が "INV-1" なら null', () => {
    expect(
      pickKernelInvariants(validJson({ invariants: [{ id: "INV-1", status: "enforced", tests: 1, verified: true }] })),
    ).toBeNull();
  });

  it('pending_approvals[].task が "T-draft" なら null', () => {
    expect(pickKernelInvariants(validJson({ pending_approvals: [{ task: "T-draft", status: "ready" }] }))).toBeNull();
  });

  it("invariants[] に title の項目があると null", () => {
    expect(
      pickKernelInvariants(
        validJson({ invariants: [{ id: "INV-01", status: "enforced", tests: 1, verified: true, title: "架空の題名" }] }),
      ),
    ).toBeNull();
  });

  it("schema・日時の形・版の形・impl が違うと null", () => {
    expect(pickKernelInvariants(validJson({ schema: "vgdd.kernel-invariants.v2" }))).toBeNull();
    expect(pickKernelInvariants(validJson({ generated_at: "2099-01-02" }))).toBeNull();
    expect(pickKernelInvariants(validJson({ generated_at: "2099-01-02T03:04:05" }))).toBeNull();
    expect(pickKernelInvariants(validJson({ kernel_version: "9.8.7" }))).toBeNull();
    expect(
      pickKernelInvariants(validJson({ verified_by: { kernel_version: "p9.8.7", impl: "repo", at: null } })),
    ).toBeNull();
  });

  it("tests と配列の上限を超えると null（ちょうど上限は通る）", () => {
    const row = (tests: number) => ({ id: "INV-01", status: "enforced", tests, verified: true });
    const pending = { task: "T-9001", status: "ready" };
    expect(pickKernelInvariants(validJson({ invariants: [row(1_000_000)] }))).not.toBeNull();
    expect(pickKernelInvariants(validJson({ invariants: [row(1_000_001)] }))).toBeNull();
    expect(pickKernelInvariants(validJson({ invariants: Array(50).fill(row(1)) }))).not.toBeNull();
    expect(pickKernelInvariants(validJson({ invariants: Array(51).fill(row(1)) }))).toBeNull();
    expect(pickKernelInvariants(validJson({ pending_approvals: Array(500).fill(pending) }))).not.toBeNull();
    expect(pickKernelInvariants(validJson({ pending_approvals: Array(501).fill(pending) }))).toBeNull();
  });
});

// ---------- ⑥ 集計 ----------

describe("summarizeInvariants", () => {
  it("強制 8・一部 3・対象外 1、合格 10・不合格 1・— 1 を数える", () => {
    const row = (n: number, status: string, verified: boolean | null) => ({
      id: `INV-${String(n).padStart(2, "0")}`,
      status,
      tests: 1,
      verified,
    });
    const invariants = [
      ...Array.from({ length: 8 }, (_, i) => row(i + 1, "enforced", true)),
      row(9, "partial", true),
      row(10, "partial", true),
      row(11, "partial", false),
      row(12, "not_applicable", null),
    ];
    expect(summarizeInvariants(mustPick(validJson({ invariants })))).toEqual({
      enforced: 8,
      partial: 3,
      notApplicable: 1,
      passed: 10,
      failed: 1,
      unknown: 1,
    });
  });

  it("空なら6つとも 0", () => {
    expect(summarizeInvariants(mustPick(validJson({ invariants: [] })))).toEqual({
      enforced: 0,
      partial: 0,
      notApplicable: 0,
      passed: 0,
      failed: 0,
      unknown: 0,
    });
  });
});

// ---------- ④⑤ 読み込み ----------

describe("loadKernelInvariants", () => {
  const roots: string[] = [];

  /** 一時ディレクトリの root を作る（試験の後に片付ける） */
  function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kernel-invariants-"));
    roots.push(root);
    return root;
  }

  /** root の下に docs/governance を作って、そのパスを返す */
  function makeGovernance(root: string): string {
    const dir = path.join(root, "docs", "governance");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  const FILE = "kernel-invariants.json";

  afterEach(() => {
    for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
  });

  it("正しいファイルを読む", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(makeGovernance(root), FILE), JSON.stringify(validJson()));
    expect(loadKernelInvariants(root)?.kernel_version).toBe("p9.8.7");
  });

  it("ファイルがなければ null", () => {
    const root = makeRoot();
    makeGovernance(root);
    expect(loadKernelInvariants(root)).toBeNull();
  });

  it("ファイルがシンボリックリンクなら null（指す先が正しくても）", () => {
    const root = makeRoot();
    const target = path.join(root, "target.json");
    fs.writeFileSync(target, JSON.stringify(validJson()));
    fs.symlinkSync(target, path.join(makeGovernance(root), FILE));
    expect(loadKernelInvariants(root)).toBeNull();
  });

  it("docs/governance がディレクトリへのシンボリックリンクなら null（指す先が正しくても）", () => {
    const root = makeRoot();
    const realDir = path.join(root, "real");
    fs.mkdirSync(realDir);
    fs.writeFileSync(path.join(realDir, FILE), JSON.stringify(validJson()));
    fs.mkdirSync(path.join(root, "docs"));
    fs.symlinkSync(realDir, path.join(root, "docs", "governance"));
    expect(loadKernelInvariants(root)).toBeNull();
  });

  it("docs がディレクトリへのシンボリックリンクなら null（指す先が正しくても）", () => {
    const root = makeRoot();
    const realDocs = path.join(root, "real");
    fs.mkdirSync(path.join(realDocs, "governance"), { recursive: true });
    fs.writeFileSync(path.join(realDocs, "governance", FILE), JSON.stringify(validJson()));
    fs.symlinkSync(realDocs, path.join(root, "docs"));
    expect(loadKernelInvariants(root)).toBeNull();
  });

  it("ファイルの場所がディレクトリなら null", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(makeGovernance(root), FILE));
    expect(loadKernelInvariants(root)).toBeNull();
  });

  it("JSON でない・形が合わないファイルは null", () => {
    const root = makeRoot();
    const file = path.join(makeGovernance(root), FILE);
    fs.writeFileSync(file, "{ JSON ではない");
    expect(loadKernelInvariants(root)).toBeNull();
    fs.writeFileSync(file, JSON.stringify(validJson({ extra: 1 })));
    expect(loadKernelInvariants(root)).toBeNull();
  });

  /** 有効な JSON を末尾の空白で詰めて、ちょうど size バイトにする */
  function paddedJson(size: number): string {
    const text = JSON.stringify(validJson());
    return text + " ".repeat(size - Buffer.byteLength(text));
  }

  it("末尾の空白で詰めた 1,048,576 バイトのファイルは読める", () => {
    const root = makeRoot();
    const file = path.join(makeGovernance(root), FILE);
    fs.writeFileSync(file, paddedJson(MAX_BYTES));
    expect(fs.statSync(file).size).toBe(MAX_BYTES);
    expect(loadKernelInvariants(root)).not.toBeNull();
  });

  it("末尾の空白で詰めた 1,048,577 バイトのファイルは null", () => {
    const root = makeRoot();
    const file = path.join(makeGovernance(root), FILE);
    fs.writeFileSync(file, paddedJson(MAX_BYTES + 1));
    expect(fs.statSync(file).size).toBe(MAX_BYTES + 1);
    expect(loadKernelInvariants(root)).toBeNull();
  });

  // ---------- T-030：source（稼働中の写しと提出記録） ----------

  const LIVE_VERSION = "p1.1.1";
  const SUBMISSION_VERSION = "p2.2.2";

  /** root の下に docs/governance/snapshots/submission を作って、そのパスを返す */
  function makeSubmissionDir(root: string): string {
    const dir = path.join(makeGovernance(root), "snapshots", "submission");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  describe("source", () => {
    it("live と submission の両方があるとき、source ごとに正しい方を読む", () => {
      const root = makeRoot();
      fs.writeFileSync(
        path.join(makeGovernance(root), FILE),
        JSON.stringify(validJson({ kernel_version: LIVE_VERSION })),
      );
      fs.writeFileSync(
        path.join(makeSubmissionDir(root), FILE),
        JSON.stringify(validJson({ kernel_version: SUBMISSION_VERSION })),
      );
      expect(loadKernelInvariants(root, "live")?.kernel_version).toBe(LIVE_VERSION);
      expect(loadKernelInvariants(root, "submission")?.kernel_version).toBe(SUBMISSION_VERSION);
    });

    it("引数1つの呼び出しは live を読む", () => {
      const root = makeRoot();
      fs.writeFileSync(
        path.join(makeGovernance(root), FILE),
        JSON.stringify(validJson({ kernel_version: LIVE_VERSION })),
      );
      fs.writeFileSync(
        path.join(makeSubmissionDir(root), FILE),
        JSON.stringify(validJson({ kernel_version: SUBMISSION_VERSION })),
      );
      expect(loadKernelInvariants(root)?.kernel_version).toBe(LIVE_VERSION);
    });

    it("片方しかないとき、もう片方に切り替えない", () => {
      const onlySubmission = makeRoot();
      fs.writeFileSync(path.join(makeSubmissionDir(onlySubmission), FILE), JSON.stringify(validJson()));
      expect(loadKernelInvariants(onlySubmission)).toBeNull();
      expect(loadKernelInvariants(onlySubmission, "live")).toBeNull();

      const onlyLive = makeRoot();
      fs.writeFileSync(path.join(makeGovernance(onlyLive), FILE), JSON.stringify(validJson()));
      expect(loadKernelInvariants(onlyLive, "submission")).toBeNull();
    });

    it("snapshots がディレクトリへのリンクなら null（指す先が正しくても）", () => {
      const root = makeRoot();
      const real = path.join(root, "real");
      fs.mkdirSync(path.join(real, "submission"), { recursive: true });
      fs.writeFileSync(path.join(real, "submission", FILE), JSON.stringify(validJson()));
      fs.symlinkSync(real, path.join(makeGovernance(root), "snapshots"));
      expect(loadKernelInvariants(root, "submission")).toBeNull();
    });

    it("submission がディレクトリへのリンクなら null（指す先が正しくても）", () => {
      const root = makeRoot();
      const real = path.join(root, "real");
      fs.mkdirSync(real);
      fs.writeFileSync(path.join(real, FILE), JSON.stringify(validJson()));
      const snapshots = path.join(makeGovernance(root), "snapshots");
      fs.mkdirSync(snapshots);
      fs.symlinkSync(real, path.join(snapshots, "submission"));
      expect(loadKernelInvariants(root, "submission")).toBeNull();
    });

    it("JSON のファイルがリンクなら null（指す先が正しくても）", () => {
      const root = makeRoot();
      const target = path.join(root, "target.json");
      fs.writeFileSync(target, JSON.stringify(validJson()));
      fs.symlinkSync(target, path.join(makeSubmissionDir(root), FILE));
      expect(loadKernelInvariants(root, "submission")).toBeNull();
    });

    it("docs・docs/governance がリンクなら、submission でも null", () => {
      const viaGovernance = makeRoot();
      const realGovernance = path.join(viaGovernance, "real");
      fs.mkdirSync(path.join(realGovernance, "snapshots", "submission"), { recursive: true });
      fs.writeFileSync(path.join(realGovernance, "snapshots", "submission", FILE), JSON.stringify(validJson()));
      fs.mkdirSync(path.join(viaGovernance, "docs"));
      fs.symlinkSync(realGovernance, path.join(viaGovernance, "docs", "governance"));
      expect(loadKernelInvariants(viaGovernance, "submission")).toBeNull();

      const viaDocs = makeRoot();
      const realDocs = path.join(viaDocs, "real");
      fs.mkdirSync(path.join(realDocs, "governance", "snapshots", "submission"), { recursive: true });
      fs.writeFileSync(path.join(realDocs, "governance", "snapshots", "submission", FILE), JSON.stringify(validJson()));
      fs.symlinkSync(realDocs, path.join(viaDocs, "docs"));
      expect(loadKernelInvariants(viaDocs, "submission")).toBeNull();
    });

    it("ファイルの場所がディレクトリ（通常のファイルでない）なら null", () => {
      const root = makeRoot();
      fs.mkdirSync(path.join(makeSubmissionDir(root), FILE));
      expect(loadKernelInvariants(root, "submission")).toBeNull();
    });

    it("ちょうど 1,048,576 バイトは読み、1,048,577 バイトは null", () => {
      const root = makeRoot();
      const file = path.join(makeSubmissionDir(root), FILE);
      fs.writeFileSync(file, paddedJson(MAX_BYTES));
      expect(loadKernelInvariants(root, "submission")).not.toBeNull();
      fs.writeFileSync(file, paddedJson(MAX_BYTES + 1));
      expect(loadKernelInvariants(root, "submission")).toBeNull();
    });

    it("JSON でない・形が合わないものは null", () => {
      const root = makeRoot();
      const file = path.join(makeSubmissionDir(root), FILE);
      fs.writeFileSync(file, "{ JSON ではない");
      expect(loadKernelInvariants(root, "submission")).toBeNull();
      fs.writeFileSync(file, JSON.stringify(validJson({ extra: 1 })));
      expect(loadKernelInvariants(root, "submission")).toBeNull();
    });

    it("A6：リポジトリの実際の提出記録が今の検証に通る", () => {
      expect(loadKernelInvariants(process.cwd(), "submission")).not.toBeNull();
    });
  });

  // ---------- T-030：GET /api/governance/kernel/invariants/submission ----------

  describe("GET /api/governance/kernel/invariants/submission", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("export する HTTP メソッドは GET だけで、引数を取らない", () => {
      expect(Object.keys(invariantsSubmissionRoute)).toEqual(["GET"]);
      expect(invariantsSubmissionRoute.GET.length).toBe(0);
    });

    it("source と写しを返す", async () => {
      const root = makeRoot();
      fs.writeFileSync(path.join(makeSubmissionDir(root), FILE), JSON.stringify(validJson()));
      vi.spyOn(process, "cwd").mockReturnValue(root);
      const r = await invariantsSubmissionRoute.GET();
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ source: "submission", invariants: validJson() });
    });

    it("提出記録がなければ invariants は null（稼働中の写しがあっても切り替えない）", async () => {
      const root = makeRoot();
      fs.writeFileSync(path.join(makeGovernance(root), FILE), JSON.stringify(validJson()));
      vi.spyOn(process, "cwd").mockReturnValue(root);
      const r = await invariantsSubmissionRoute.GET();
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ source: "submission", invariants: null });
    });

    it("例外は本文を入れずに 500", async () => {
      connectionMock.mockRejectedValueOnce(new Error("架空の例外の本文"));
      const r = await invariantsSubmissionRoute.GET();
      expect(r.status).toBe(500);
      expect(await r.json()).toEqual({ error: "invariants_unavailable" });
    });

    it("稼働中の写しがなく提出記録があるとき、今の API は invariants: null のまま（切り替わらない）", async () => {
      const root = makeRoot();
      fs.writeFileSync(path.join(makeSubmissionDir(root), FILE), JSON.stringify(validJson()));
      vi.spyOn(process, "cwd").mockReturnValue(root);
      const r = await invariantsLiveGet();
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ invariants: null });
    });
  });
});
