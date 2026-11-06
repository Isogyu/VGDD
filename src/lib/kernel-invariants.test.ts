// T-024：不変条件と承認待ちの写しの検証・集計・読み込みの試験（A7 の①〜⑥）。
// loadKernelInvariants は一時ディレクトリの root で試す。
// 版・日時・票番号・判例の件数はすべて架空（schema・impl・status は形が決めている定数、INV の番号は形を試すための値）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadKernelInvariants } from "@/lib/kernel-invariants";
import {
  pickKernelInvariants,
  summarizeInvariants,
  type KernelInvariants,
} from "@/lib/kernel-invariants-schema";

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
});
