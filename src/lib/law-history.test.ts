// T-025：法律の公開の要約の検証・集計・読み込みの試験（A6 の①〜⑦）。
// loadLawHistory は一時ディレクトリの root で試す（⑦だけリポジトリの実物を読む）。
// 版・日付・題名・件数はすべて架空（found_by は形が決めている定数）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadLawHistory } from "@/lib/law-history";
import { pickLawHistory, summarizeLawHistory, type LawHistory } from "@/lib/law-history-schema";

const MAX_BYTES = 262_144;

/** 正しい形の版（JSON の値）。上書きしたい項目は overrides で渡す */
function validVersion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: "p9.8.7",
    date: "2099-01-02",
    title: "架空の版",
    fixed: ["架空の改善"],
    found_by: ["operation"],
    precedents: ["Z1"],
    tests_total: 10,
    prev_failed: 2,
    obs: ["OBS-999"],
    ...overrides,
  };
}

/** 正しい形の要約（JSON の値）。上書きしたい項目は overrides で渡す */
function validJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "vgdd.law-history.v1",
    note: "架空の要約",
    versions: [validVersion()],
    ...overrides,
  };
}

/** 版を1つ上書きした要約を検証する */
function pickWithVersion(overrides: Record<string, unknown>): LawHistory | null {
  return pickLawHistory(validJson({ versions: [validVersion(overrides)] }));
}

function mustPick(json: unknown): LawHistory {
  const x = pickLawHistory(json);
  if (x === null) throw new Error("検証に落ちた");
  return x;
}

// ---------- ① 正しい JSON ----------

describe("pickLawHistory：正しい JSON", () => {
  it("正しい JSON が通る", () => {
    const x = mustPick(validJson());
    expect(x.schema).toBe("vgdd.law-history.v1");
    expect(x.versions).toHaveLength(1);
    expect(x.versions[0].version).toBe("p9.8.7");
    expect(x.versions[0].obs).toEqual(["OBS-999"]);
  });

  it("tests_total・prev_failed が null でも、配列が空でも、版の末尾が英小文字でも通る", () => {
    expect(
      pickWithVersion({ version: "p9.8.7a", fixed: [], found_by: [], precedents: [], tests_total: null, prev_failed: null, obs: [] }),
    ).not.toBeNull();
  });
});

// ---------- ② 未知の項目（strict） ----------

describe("pickLawHistory：未知の項目（strict）", () => {
  it("外側に未知の項目があると null", () => {
    expect(pickLawHistory(validJson({ extra: 1 }))).toBeNull();
  });

  it("版の要素に未知の項目があると null", () => {
    expect(pickWithVersion({ extra: 1 })).toBeNull();
  });
});

// ---------- ③ 値の形 ----------

describe("pickLawHistory：値の形", () => {
  it('version が "0.4.4" だと null', () => {
    expect(pickWithVersion({ version: "0.4.4" })).toBeNull();
  });

  it('found_by に "ai" があると null', () => {
    expect(pickWithVersion({ found_by: ["ai"] })).toBeNull();
  });

  it('precedents に "g15" があると null', () => {
    expect(pickWithVersion({ precedents: ["g15"] })).toBeNull();
  });

  it('obs に "OBS-1" があると null', () => {
    expect(pickWithVersion({ obs: ["OBS-1"] })).toBeNull();
  });

  it('precedents の "INV06a" が通る', () => {
    expect(pickWithVersion({ precedents: ["INV06a"] })).not.toBeNull();
  });

  it('precedents の "INV06d" が通る', () => {
    expect(pickWithVersion({ precedents: ["INV06d"] })).not.toBeNull();
  });

  it('precedents の "INV-META" が通る', () => {
    expect(pickWithVersion({ precedents: ["INV-META"] })).not.toBeNull();
  });

  it('precedents の "G15" が通る', () => {
    expect(pickWithVersion({ precedents: ["G15"] })).not.toBeNull();
  });

  it("versions が空・schema が違う・JSON がオブジェクトでないと null", () => {
    expect(pickLawHistory(validJson({ versions: [] }))).toBeNull();
    expect(pickLawHistory(validJson({ schema: "vgdd.law-history.v2" }))).toBeNull();
    expect(pickLawHistory(null)).toBeNull();
    expect(pickLawHistory([])).toBeNull();
  });
});

// ---------- ④⑤ 読み込み（一時ディレクトリの root） ----------

describe("loadLawHistory：一時ディレクトリの root", () => {
  const roots: string[] = [];

  /** 空の root を作る（試験の後に消す） */
  function makeRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "law-history-"));
    roots.push(root);
    return root;
  }

  /** vgdd/kernel/ まである root を作り、kernel ディレクトリのパスも返す */
  function makeKernelRoot(): { root: string; kernelDir: string } {
    const root = makeRoot();
    const kernelDir = path.join(root, "vgdd", "kernel");
    fs.mkdirSync(kernelDir, { recursive: true });
    return { root, kernelDir };
  }

  /** 有効な JSON を、末尾の空白で詰めて指定のバイト数にする */
  function paddedJson(bytes: number): string {
    const text = JSON.stringify(validJson());
    return text + " ".repeat(bytes - Buffer.byteLength(text));
  }

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("正しいファイルを読める", () => {
    const { root, kernelDir } = makeKernelRoot();
    fs.writeFileSync(path.join(kernelDir, "history.json"), JSON.stringify(validJson()));
    expect(loadLawHistory(root)?.versions[0].version).toBe("p9.8.7");
  });

  it("ファイルがなければ null", () => {
    const { root } = makeKernelRoot();
    expect(loadLawHistory(root)).toBeNull();
  });

  it("vgdd がなければ null", () => {
    expect(loadLawHistory(makeRoot())).toBeNull();
  });

  it("history.json がシンボリックリンクなら null（リンク先が有効でも）", () => {
    const { root, kernelDir } = makeKernelRoot();
    const target = path.join(root, "target.json");
    fs.writeFileSync(target, JSON.stringify(validJson()));
    fs.symlinkSync(target, path.join(kernelDir, "history.json"));
    expect(loadLawHistory(root)).toBeNull();
  });

  it("vgdd/kernel がディレクトリへのシンボリックリンクなら null（リンク先に有効なファイルがあっても）", () => {
    const root = makeRoot();
    fs.mkdirSync(path.join(root, "vgdd"));
    const realDir = path.join(root, "real-kernel");
    fs.mkdirSync(realDir);
    fs.writeFileSync(path.join(realDir, "history.json"), JSON.stringify(validJson()));
    fs.symlinkSync(realDir, path.join(root, "vgdd", "kernel"));
    expect(loadLawHistory(root)).toBeNull();
  });

  it("vgdd がディレクトリへのシンボリックリンクなら null（リンク先に有効なファイルがあっても）", () => {
    const root = makeRoot();
    const realDir = path.join(root, "real-vgdd");
    fs.mkdirSync(path.join(realDir, "kernel"), { recursive: true });
    fs.writeFileSync(path.join(realDir, "kernel", "history.json"), JSON.stringify(validJson()));
    fs.symlinkSync(realDir, path.join(root, "vgdd"));
    expect(loadLawHistory(root)).toBeNull();
  });

  it("vgdd がディレクトリでなければ null", () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, "vgdd"), "");
    expect(loadLawHistory(root)).toBeNull();
  });

  it("history.json がディレクトリなら null", () => {
    const { root, kernelDir } = makeKernelRoot();
    fs.mkdirSync(path.join(kernelDir, "history.json"));
    expect(loadLawHistory(root)).toBeNull();
  });

  it("JSON でない・形が合わないファイルは null", () => {
    const { root, kernelDir } = makeKernelRoot();
    const file = path.join(kernelDir, "history.json");
    fs.writeFileSync(file, "{not json");
    expect(loadLawHistory(root)).toBeNull();
    fs.writeFileSync(file, JSON.stringify(validJson({ extra: 1 })));
    expect(loadLawHistory(root)).toBeNull();
  });

  it(`末尾の空白で詰めた ${MAX_BYTES} バイトは非 null`, () => {
    const { root, kernelDir } = makeKernelRoot();
    const file = path.join(kernelDir, "history.json");
    fs.writeFileSync(file, paddedJson(MAX_BYTES));
    expect(fs.statSync(file).size).toBe(MAX_BYTES);
    expect(loadLawHistory(root)).not.toBeNull();
  });

  it(`末尾の空白で詰めた ${MAX_BYTES + 1} バイトは null`, () => {
    const { root, kernelDir } = makeKernelRoot();
    const file = path.join(kernelDir, "history.json");
    fs.writeFileSync(file, paddedJson(MAX_BYTES + 1));
    expect(fs.statSync(file).size).toBe(MAX_BYTES + 1);
    expect(loadLawHistory(root)).toBeNull();
  });
});

// ---------- ⑥ 集計 ----------

describe("summarizeLawHistory", () => {
  it("版の数・改善の合計・主体ごとの版の数・最後の版のテスト数を返す", () => {
    const s = summarizeLawHistory(
      mustPick(
        validJson({
          versions: [
            validVersion({ fixed: ["架空1", "架空2"], found_by: ["operation", "codex"], tests_total: 5 }),
            validVersion({ fixed: [], found_by: ["codex"], tests_total: 7 }),
            validVersion({ fixed: ["架空3"], found_by: ["owner"], tests_total: 9 }),
          ],
        }),
      ),
    );
    expect(s.versions).toBe(3);
    expect(s.improvements).toBe(3);
    expect(s.byFinder.get("operation")).toBe(1);
    expect(s.byFinder.get("codex")).toBe(2);
    expect(s.byFinder.get("owner")).toBe(1);
    expect(s.byFinder.get("judge")).toBeUndefined();
    expect(s.latestTests).toBe(9);
  });

  it("同じ版の found_by に同じ主体が2回あっても1と数える", () => {
    const s = summarizeLawHistory(mustPick(validJson({ versions: [validVersion({ found_by: ["codex", "codex"] })] })));
    expect(s.byFinder.get("codex")).toBe(1);
  });

  it("latestTests は最後の版の値（前の版に値があっても null は null、0 は 0）", () => {
    const withLast = (tests_total: number | null) =>
      summarizeLawHistory(
        mustPick(validJson({ versions: [validVersion({ tests_total: 5 }), validVersion({ tests_total })] })),
      ).latestTests;
    expect(withLast(null)).toBeNull();
    expect(withLast(0)).toBe(0);
  });
});

// ---------- ⑦ リポジトリの実物 ----------

describe("loadLawHistory：リポジトリの実物", () => {
  it("vgdd/kernel/history.json を読むと非 null", () => {
    expect(loadLawHistory(process.cwd())).not.toBeNull();
  });
});
