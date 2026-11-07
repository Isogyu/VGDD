// 統治シアターの主役の図の部品の ID と、記録の出来事 → 図のどこを光らせるかの対応（T-031）。
// 純粋関数だけを置く（node:fs は使わない）。

/** 節（役割）の ID。名前は tokens.ts の役割と同じ */
export const STAGE_NODE_IDS = ["human", "legislative", "executive", "judiciary", "kernel", "merged"] as const;
export type StageNodeId = (typeof STAGE_NODE_IDS)[number];

/** 制度の上の経路の両端。図に描く線はこの8本だけ */
export const STAGE_EDGES = {
  spec: { from: "legislative", to: "executive" },
  submit: { from: "executive", to: "kernel" },
  // 司法は Kernel に呼ばれて判定を返す
  verdict: { from: "judiciary", to: "kernel" },
  return: { from: "kernel", to: "executive" },
  // 裁定または統合の承認を待つ
  escalate: { from: "kernel", to: "human" },
  ruling: { from: "human", to: "kernel" },
  approve: { from: "human", to: "legislative" },
  merge: { from: "kernel", to: "merged" },
} as const satisfies Record<string, { from: StageNodeId; to: StageNodeId }>;
export type StageEdgeId = keyof typeof STAGE_EDGES;
export const STAGE_EDGE_IDS = Object.keys(STAGE_EDGES) as readonly StageEdgeId[];

export type StageVerdict = "APPROVED" | "CHANGES_REQUIRED" | null;

/** T-028 の公開用のイベントのうち、図が使う4項目（同じ形をここに書く） */
export type StageEvent = {
  kind:
    | "returned"
    | "blocked"
    | "held"
    | "merged"
    | "released"
    | "ruling"
    | "minor_disagreement"
    | "resubmitted"
    | "other";
  reason:
    | "scope"
    | "rebase"
    | "security"
    | "judiciary"
    | "disagreement"
    | "return_limit"
    | "spec_unapproved"
    | "other"
    | null;
  judge: StageVerdict;
  codex: StageVerdict;
};

export type StageTone = "normal" | "waiting" | "unknown";

export type StageFocus = {
  nodes: readonly StageNodeId[];
  edges: readonly StageEdgeId[];
  tone: StageTone;
  judge: StageVerdict;
  codex: StageVerdict;
};

type Row = Pick<StageFocus, "nodes" | "edges" | "tone">;

/** 記録から何も言えない出来事。どの節も線も光らせない */
const UNKNOWN_ROW: Row = { nodes: [], edges: [], tone: "unknown" };

function rowFor(kind: StageEvent["kind"], reason: StageEvent["reason"]): Row {
  switch (kind) {
    case "returned":
      switch (reason) {
        case "scope":
        case "rebase":
        case "other":
          return { nodes: ["kernel", "executive"], edges: ["return"], tone: "normal" };
        case "security":
        case "judiciary":
          return { nodes: ["judiciary", "kernel", "executive"], edges: ["verdict", "return"], tone: "normal" };
        default:
          return UNKNOWN_ROW;
      }
    case "blocked":
      switch (reason) {
        case "disagreement":
          return { nodes: ["judiciary", "kernel", "human"], edges: ["verdict", "escalate"], tone: "waiting" };
        case "return_limit":
          return { nodes: ["kernel", "human"], edges: ["escalate"], tone: "waiting" };
        case "spec_unapproved":
          return { nodes: ["legislative", "kernel", "human"], edges: ["escalate"], tone: "waiting" };
        case "other":
          return { nodes: ["kernel"], edges: [], tone: "unknown" };
        default:
          return UNKNOWN_ROW;
      }
    case "held":
      return { nodes: ["judiciary", "kernel", "human"], edges: ["verdict", "escalate"], tone: "waiting" };
    case "merged":
      return { nodes: ["kernel", "merged"], edges: ["merge"], tone: "normal" };
    case "released":
      return { nodes: ["human", "kernel", "merged"], edges: ["merge"], tone: "normal" };
    case "ruling":
      return { nodes: ["human", "kernel"], edges: ["ruling"], tone: "normal" };
    case "minor_disagreement":
      return { nodes: ["judiciary", "kernel"], edges: ["verdict"], tone: "normal" };
    case "resubmitted":
      return { nodes: ["executive", "kernel"], edges: ["submit"], tone: "normal" };
    default:
      return UNKNOWN_ROW;
  }
}

/** 記録の出来事を1つ受け、光らせる節と線・調子を返す（T-031 A2 の表）。表にない組み合わせは `other` と同じ扱い */
export function focusFor({ kind, reason, judge, codex }: StageEvent): StageFocus {
  return { ...rowFor(kind, reason), judge, codex };
}
