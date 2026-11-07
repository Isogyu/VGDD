import { describe, expect, it } from "vitest";
import { GUIDE_NOTE, GUIDE_STEPS } from "./theater-guide";
import { STAGE_EDGE_IDS, STAGE_NODE_IDS } from "./theater-stage";

// 票 T-037 A1 の表をそのまま写した期待値
const EXPECTED = [
  {
    title: "誰のための画面か",
    body: "複数の AI に開発を任せ、仕様の承認と統合の判断を1人で担う開発者のための画面です。AI が作り、別の AI が確かめ、統合の条件は Kernel が強制します。",
    nodes: ["human"],
    edges: [],
  },
  {
    title: "人が決める",
    body: "人（オーナー）が目的を決め、立法補佐（Claude）が書いた作業の条件（票）を承認します。承認のない票は統合されません。",
    nodes: ["human", "legislative"],
    edges: ["approve"],
  },
  {
    title: "AI が作る",
    body: "行政（Claude Code）の作業員が、隔離した場所で票のとおりに実装し、Kernel に申請します。",
    nodes: ["legislative", "executive", "kernel"],
    edges: ["spec", "submit"],
  },
  {
    title: "別の AI が確かめる",
    body: "司法（Claude と Codex）が、差分・受け入れ条件・監査の結果だけで独立に判定します。重大な指摘で判定が分かれたら、Kernel は統合せずに人の裁定を待ちます。",
    nodes: ["judiciary", "kernel", "human"],
    edges: ["verdict", "escalate"],
  },
  {
    title: "条件を満たしたものだけが入る",
    body: "Kernel は、仕様の承認・監査・司法の判定や人の裁定など、統合の条件を確かめます。停止中は統合せず、夜間に合格した票は held として、人の統合の承認を待ちます。下の再生で、本物の記録を1票ずつ追えます。",
    nodes: ["kernel", "merged"],
    edges: ["merge"],
  },
];

describe("GUIDE_STEPS", () => {
  it("手順は5つ", () => {
    expect(GUIDE_STEPS).toHaveLength(5);
  });

  it("各手順の title・body・focus.nodes・focus.edges が A1 の表どおり（順も同じ）", () => {
    GUIDE_STEPS.forEach((step, i) => {
      expect(step.title).toBe(EXPECTED[i].title);
      expect(step.body).toBe(EXPECTED[i].body);
      expect([...step.focus.nodes]).toEqual(EXPECTED[i].nodes);
      expect([...step.focus.edges]).toEqual(EXPECTED[i].edges);
    });
  });

  it("節と線の ID はどれも図の部品の ID に含まれる", () => {
    for (const step of GUIDE_STEPS) {
      for (const node of step.focus.nodes) expect(STAGE_NODE_IDS).toContain(node);
      for (const edge of step.focus.edges) expect(STAGE_EDGE_IDS).toContain(edge);
    }
  });

  it("tone は normal、judge・codex は null", () => {
    for (const step of GUIDE_STEPS) {
      expect(step.focus.tone).toBe("normal");
      expect(step.focus.judge).toBeNull();
      expect(step.focus.codex).toBeNull();
    }
  });

  it("手順は { title, body, focus } だけを持つ", () => {
    for (const step of GUIDE_STEPS) {
      expect(Object.keys(step).sort()).toEqual(["body", "focus", "title"]);
    }
  });
});

describe("GUIDE_NOTE", () => {
  it("注意の文が A1 のとおり", () => {
    expect(GUIDE_NOTE).toBe("案内の光は説明のための強調で、記録の出来事ではありません");
  });
});
