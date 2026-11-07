import { STAGE_EDGE_IDS, STAGE_NODE_IDS, type StageEdgeId, type StageFocus, type StageNodeId, type StageVerdict } from "@/lib/theater-stage";
import { theaterTokens } from "./tokens";

type GovernanceStageProps = {
  /** 記録の出来事から focusFor で作った値。出来事を選んでいなければ null */
  focus: StageFocus | null;
  stopped: boolean;
};

// 1440×900 の TheaterShell の主役の区画は、内側の幅が約 899px、高さが約 509px。
// viewBox をこの大きさに合わせると表示の倍率がほぼ 1 になり、文字の大きさ（13 以上）が 12px を下回らない。
const VIEW_WIDTH = 900;
const VIEW_HEIGHT = 490;
const FONT_SMALL = 13;
const FONT_LABEL = 16;

// Tailwind が文字列からクラスを見つけられるよう、クラス名は組み立てず、完全な形で書く。
// tokens.ts の text-* / border-* / bg-* を、SVG の fill-* / stroke-* に写したもの（一致は試験で確かめる）。
const SVG_ROLE = {
  human: { text: "fill-pink-200", border: "stroke-pink-500", background: "fill-pink-950", bright: "stroke-pink-200", head: "fill-pink-200" },
  legislative: { text: "fill-violet-300", border: "stroke-violet-500", background: "fill-violet-950", bright: "stroke-violet-300", head: "fill-violet-300" },
  executive: { text: "fill-blue-300", border: "stroke-blue-500", background: "fill-blue-950", bright: "stroke-blue-300", head: "fill-blue-300" },
  judiciary: { text: "fill-yellow-200", border: "stroke-yellow-500", background: "fill-yellow-950", bright: "stroke-yellow-200", head: "fill-yellow-200" },
  kernel: { text: "fill-slate-200", border: "stroke-slate-500", background: "fill-slate-800", bright: "stroke-slate-200", head: "fill-slate-200" },
  merged: { text: "fill-emerald-300", border: "stroke-emerald-500", background: "fill-emerald-950", bright: "stroke-emerald-300", head: "fill-emerald-300" },
} as const;

const SVG_STATE = {
  waiting: { text: "fill-amber-300", border: "stroke-amber-500", background: "fill-amber-950", bright: "stroke-amber-300", head: "fill-amber-300" },
  stopped: { text: "fill-red-300", border: "stroke-red-500", background: "fill-red-950" },
  unknown: { text: "fill-gray-300", border: "stroke-gray-500", background: "fill-gray-900" },
} as const;

/** 強調の切り替えだけを動かす。prefers-reduced-motion では動かさない */
const TRANSITION = "motion-safe:transition-[opacity,fill,stroke,stroke-width] motion-safe:duration-300";

const DASH = "6 4";

type NodeLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** ラベルの下に添える文字（1要素が1行） */
  caption: readonly string[];
};

const NODES: Record<StageNodeId, NodeLayout> = {
  human: { x: 300, y: 10, width: 360, height: 74, caption: ["承認・裁定・停止"] },
  legislative: { x: 12, y: 165, width: 260, height: 130, caption: ["Claude（立法補佐）と人"] },
  executive: { x: 320, y: 165, width: 260, height: 130, caption: ["Claude Code", "（作業員は worktree で並行）"] },
  judiciary: {
    x: 628,
    y: 165,
    // いちばん長い行（13px で約 245）の右にも余白を残すため、ほかの中段の節より少し広い
    width: 268,
    height: 130,
    caption: ["Claude と Codex", "（記録の構成。", "運用では Claude の別セッションでも可）"],
  },
  kernel: { x: 320, y: 380, width: 320, height: 90, caption: ["自作：フック・裁判所・証拠ストア"] },
  merged: { x: 700, y: 400, width: 188, height: 60, caption: [] },
};

type EdgeLayout = {
  /** tokens の役割の色（強調のときに使う） */
  role: StageNodeId;
  label: string;
  /** 線の経路 */
  d: string;
  /** 矢じり */
  head: string;
  labelX: number;
  labelY: number;
  labelAnchor: "start" | "middle" | "end";
};

const EDGES: Record<StageEdgeId, EdgeLayout> = {
  spec: { role: "legislative", label: "仕様", d: "M272 230H310", head: "320,230 310,224 310,236", labelX: 296, labelY: 222, labelAnchor: "middle" },
  submit: { role: "executive", label: "申請", d: "M410 295V370", head: "410,380 404,370 416,370", labelX: 402, labelY: 342, labelAnchor: "end" },
  verdict: { role: "judiciary", label: "判定", d: "M700 295L645 386", head: "640,395 640,383 650,390", labelX: 684, labelY: 345, labelAnchor: "start" },
  return: { role: "kernel", label: "差し戻し", d: "M500 380V305", head: "500,295 494,305 506,305", labelX: 508, labelY: 342, labelAnchor: "start" },
  escalate: { role: "kernel", label: "人への差し戻し", d: "M592 380V94", head: "592,84 586,94 598,94", labelX: 584, labelY: 130, labelAnchor: "end" },
  ruling: { role: "human", label: "裁定", d: "M616 84V370", head: "616,380 610,370 622,370", labelX: 624, labelY: 130, labelAnchor: "start" },
  approve: { role: "human", label: "承認", d: "M300 47H142V155", head: "142,165 136,155 148,155", labelX: 150, labelY: 110, labelAnchor: "start" },
  merge: { role: "merged", label: "統合", d: "M640 430H690", head: "700,430 690,424 690,436", labelX: 668, labelY: 422, labelAnchor: "middle" },
};

function verdictText(verdict: StageVerdict): string {
  if (verdict === "APPROVED") return "合格";
  if (verdict === "CHANGES_REQUIRED") return "差し戻し";
  return "—";
}

function stageDescription(focus: StageFocus | null, stopped: boolean): string {
  const parts = ["統治図。"];
  if (stopped) parts.push("停止中。");
  if (focus === null) {
    parts.push("出来事を選んでいません。");
  } else {
    if (focus.nodes.length > 0) {
      parts.push(`関わる役割：${focus.nodes.map((id) => theaterTokens.roles[id].label).join("、")}。`);
    }
    if (!stopped && focus.edges.length > 0) {
      parts.push(`流れ：${focus.edges.map((id) => EDGES[id].label).join("、")}。`);
    }
    if (focus.tone === "waiting") parts.push(`${theaterTokens.states.waiting.label}。`);
    if (focus.tone === "unknown") parts.push(`${theaterTokens.states.unknown.label}。`);
  }
  parts.push(`判定：Claude ${verdictText(focus?.judge ?? null)}、Codex ${verdictText(focus?.codex ?? null)}。`);
  return parts.join("");
}

function VerdictBadge({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <g>
      <rect x={x} y={y} width={118} height={24} rx={4} className="fill-slate-900 stroke-yellow-500 stroke-1" />
      <text x={x + 59} y={y + 17} fontSize={FONT_SMALL} textAnchor="middle" className="fill-yellow-200">
        {text}
      </text>
    </g>
  );
}

type NodeBoxProps = {
  id: StageNodeId;
  focus: StageFocus | null;
  stopped: boolean;
};

function NodeBox({ id, focus, stopped }: NodeBoxProps) {
  const layout = NODES[id];
  const token = theaterTokens.roles[id];
  const active = focus?.nodes.includes(id) ?? false;
  const dimmed = focus !== null && !active;
  const unknown = focus?.tone === "unknown";
  const waitingHere = id === "human" && focus?.tone === "waiting";
  const stoppedHere = id === "kernel" && stopped;

  // 優先の順：停止（Kernel）→ 判断待ち（人）→ 確認できない（全体）→ 役割の色
  const colors = stoppedHere
    ? SVG_STATE.stopped
    : waitingHere
      ? SVG_STATE.waiting
      : unknown
        ? SVG_STATE.unknown
        : SVG_ROLE[id];
  const strokeWidth = active ? "stroke-[3]" : dimmed ? "stroke-1" : "stroke-[1.5]";
  const opacity = dimmed && !stoppedHere ? "opacity-50" : "opacity-100";
  const dashed = unknown && !stoppedHere && !waitingHere;
  const centered = id === "merged";
  const textX = centered ? layout.x + layout.width / 2 : layout.x + 12;

  return (
    <g data-node={id} data-active={active ? "true" : "false"} className={`${opacity} ${TRANSITION}`}>
      <rect
        x={layout.x}
        y={layout.y}
        width={layout.width}
        height={layout.height}
        rx={8}
        strokeDasharray={dashed ? DASH : undefined}
        className={`${colors.background} ${colors.border} ${strokeWidth} ${TRANSITION}`}
      />
      <text
        x={textX}
        y={centered ? layout.y + layout.height / 2 + 6 : layout.y + 25}
        fontSize={FONT_LABEL}
        textAnchor={centered ? "middle" : "start"}
        className={`${colors.text} font-bold ${TRANSITION}`}
      >
        {`${token.mark} ${token.label}`}
      </text>
      {layout.caption.map((line, index) => (
        <text
          key={line}
          x={textX}
          y={layout.y + 45 + index * 18}
          fontSize={FONT_SMALL}
          className={`${colors.text} ${TRANSITION}`}
        >
          {line}
        </text>
      ))}
      {waitingHere ? (
        <text
          data-state="waiting"
          x={layout.x + layout.width - 12}
          y={layout.y + 25}
          fontSize={FONT_SMALL}
          textAnchor="end"
          className={`${SVG_STATE.waiting.text} font-bold`}
        >
          {`${theaterTokens.states.waiting.mark} ${theaterTokens.states.waiting.label}`}
        </text>
      ) : null}
      {stoppedHere ? (
        <text
          data-state="stopped"
          x={layout.x + layout.width - 12}
          y={layout.y + 25}
          fontSize={FONT_SMALL}
          textAnchor="end"
          className={`${SVG_STATE.stopped.text} font-bold`}
        >
          {`${theaterTokens.states.stopped.mark} 停止中`}
        </text>
      ) : null}
      {id === "judiciary" ? (
        <>
          <VerdictBadge x={layout.x + 8} y={layout.y + 100} text={`Claude：${verdictText(focus?.judge ?? null)}`} />
          <VerdictBadge x={layout.x + 134} y={layout.y + 100} text={`Codex：${verdictText(focus?.codex ?? null)}`} />
        </>
      ) : null}
    </g>
  );
}

type EdgeLineProps = {
  id: StageEdgeId;
  focus: StageFocus | null;
  stopped: boolean;
};

function EdgeLine({ id, focus, stopped }: EdgeLineProps) {
  const layout = EDGES[id];
  const active = !stopped && (focus?.edges.includes(id) ?? false);
  const dimmed = focus !== null && !active;
  // 経路は細く暗い線、記録が示す出来事は太く明るい線
  const bright = id === "escalate" && focus?.tone === "waiting" ? SVG_STATE.waiting : SVG_ROLE[layout.role];
  const line = active ? `${bright.bright} stroke-[4]` : "stroke-slate-500 stroke-[1.5]";
  const head = active ? bright.head : "fill-slate-500";
  const label = active ? `${bright.text} font-bold` : "fill-slate-300";

  return (
    <g data-edge={id} data-active={active ? "true" : "false"} className={`${dimmed ? "opacity-50" : "opacity-100"} ${TRANSITION}`}>
      <path d={layout.d} className={`fill-none ${line} ${TRANSITION}`} />
      <polygon points={layout.head} className={`${head} ${TRANSITION}`} />
      <text
        x={layout.labelX}
        y={layout.labelY}
        fontSize={FONT_SMALL}
        textAnchor={layout.labelAnchor}
        className={`${label} ${TRANSITION}`}
      >
        {layout.label}
      </text>
    </g>
  );
}

// 統治シアターの主役の図（T-031 A3）。受け取った focus と stopped を描くだけで、データも状態も持たない。
export default function GovernanceStage({ focus, stopped }: GovernanceStageProps) {
  const unknown = focus?.tone === "unknown";
  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      role="img"
      aria-label={stageDescription(focus, stopped)}
      className="block h-auto w-full"
    >
      {unknown ? (
        <g data-state="unknown">
          <rect
            x={1}
            y={1}
            width={VIEW_WIDTH - 2}
            height={VIEW_HEIGHT - 2}
            rx={8}
            strokeDasharray={DASH}
            className={`${SVG_STATE.unknown.background} ${SVG_STATE.unknown.border} stroke-[1.5]`}
          />
          <text x={12} y={30} fontSize={FONT_SMALL} className={`${SVG_STATE.unknown.text} font-bold`}>
            {`${theaterTokens.states.unknown.mark} ${theaterTokens.states.unknown.label}`}
          </text>
        </g>
      ) : null}
      {STAGE_EDGE_IDS.map((id) => (
        <EdgeLine key={id} id={id} focus={focus} stopped={stopped} />
      ))}
      {STAGE_NODE_IDS.map((id) => (
        <NodeBox key={id} id={id} focus={focus} stopped={stopped} />
      ))}
    </svg>
  );
}
