import { describe, expect, it } from "vitest";
import { EVIDENCE_SECTIONS } from "./evidence-sections";

describe("EVIDENCE_SECTIONS（T-041 A1・A4、T-047 A1・A3）", () => {
  it("7行の key・title・defaultOpen が票の表どおりの順で並ぶ", () => {
    expect(EVIDENCE_SECTIONS.map((s) => ({ key: s.key, title: s.title, defaultOpen: s.defaultOpen }))).toEqual([
      { key: "map", title: "統治の全体図", defaultOpen: true },
      { key: "kernel", title: "Kernel の状態", defaultOpen: true },
      { key: "invariants", title: "不変条件と承認待ち", defaultOpen: true },
      { key: "history", title: "法律が判例で育った歴史", defaultOpen: true },
      { key: "numbers", title: "統治の数字", defaultOpen: true },
      { key: "board", title: "票の盤", defaultOpen: true },
      { key: "fate", title: "票1枚の運命", defaultOpen: true },
    ]);
  });

  it("各行は key・title・defaultOpen の3つだけを持つ", () => {
    for (const s of EVIDENCE_SECTIONS) {
      expect(Object.keys(s).sort()).toEqual(["defaultOpen", "key", "title"]);
    }
  });

  it("defaultOpen が true の行の key が7つとも並ぶ（最初はすべて開いておく）", () => {
    expect(EVIDENCE_SECTIONS.filter((s) => s.defaultOpen).map((s) => s.key)).toEqual([
      "map",
      "kernel",
      "invariants",
      "history",
      "numbers",
      "board",
      "fate",
    ]);
  });

  it("key は重ならない", () => {
    const keys = EVIDENCE_SECTIONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
