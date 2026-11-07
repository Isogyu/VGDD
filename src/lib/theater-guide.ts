// 統治シアターの「はじめて見る」の案内（T-037 A1）。固定の文と、主役の図で光らせる節と線だけを置く。
// React は import しない。node:fs も読まない。図の強調は T-031 の StageFocus をそのまま使う。

import type { StageFocus } from "@/lib/theater-stage";

export type GuideStep = {
  title: string;
  body: string;
  focus: StageFocus;
};

/** 案内の5つの手順（文は票の A1 の表のとおり） */
export const GUIDE_STEPS: readonly GuideStep[] = [
  {
    title: "誰のための画面か",
    body: "複数の AI に開発を任せ、仕様の承認と統合の判断を1人で担う開発者のための画面です。AI が作り、別の AI が確かめ、統合の条件は Kernel が強制します。",
    focus: { nodes: ["human"], edges: [], tone: "normal", judge: null, codex: null },
  },
  {
    title: "人が決める",
    body: "人（オーナー）が目的を決め、立法補佐（Claude）が書いた作業の条件（票）を承認します。承認のない票は統合されません。",
    focus: { nodes: ["human", "legislative"], edges: ["approve"], tone: "normal", judge: null, codex: null },
  },
  {
    title: "AI が作る",
    body: "行政（Claude Code）の作業員が、隔離した場所で票のとおりに実装し、Kernel に申請します。",
    focus: {
      nodes: ["legislative", "executive", "kernel"],
      edges: ["spec", "submit"],
      tone: "normal",
      judge: null,
      codex: null,
    },
  },
  {
    title: "別の AI が確かめる",
    body: "司法（Claude と Codex）が、差分・受け入れ条件・監査の結果だけで独立に判定します。重大な指摘で判定が分かれたら、Kernel は統合せずに人の裁定を待ちます。",
    focus: {
      nodes: ["judiciary", "kernel", "human"],
      edges: ["verdict", "escalate"],
      tone: "normal",
      judge: null,
      codex: null,
    },
  },
  {
    title: "条件を満たしたものだけが入る",
    body: "Kernel は、仕様の承認・監査・司法の判定や人の裁定など、統合の条件を確かめます。停止中は統合せず、夜間に合格した票は held として、人の統合の承認を待ちます。下の再生で、本物の記録を1票ずつ追えます。",
    focus: { nodes: ["kernel", "merged"], edges: ["merge"], tone: "normal", judge: null, codex: null },
  },
];

/** 案内の欄に添える注意の文 */
export const GUIDE_NOTE = "案内の光は説明のための強調で、記録の出来事ではありません";
