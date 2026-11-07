// 統治シアターの公開用データ（T-028）。票の §6 の記録の行を、列挙値だけのイベントに変える。
// 自由な文（detail）は応答に入れない。この票が保証する非公開の境界は /api/governance/replay の応答だけ。
// 応答は各階層で許可したキーだけを明示して組み立てる（入力のオブジェクトを広げてコピーしない）。

import type { GovernanceData, TimelineActor, TimelineEvent } from "@/lib/governance";

export type PublicEventKind =
  | "returned"
  | "blocked"
  | "held"
  | "merged"
  | "released"
  | "ruling"
  | "minor_disagreement"
  | "resubmitted"
  | "other";

export type PublicEventReason =
  | "scope"
  | "rebase"
  | "security"
  | "judiciary"
  | "disagreement"
  | "return_limit"
  | "spec_unapproved"
  | "other";

export type PublicVerdict = "APPROVED" | "CHANGES_REQUIRED";

export type PublicEvent = {
  seq: number;
  ts: string;
  actor: TimelineActor;
  kind: PublicEventKind;
  reason: PublicEventReason | null;
  judge: PublicVerdict | null;
  codex: PublicVerdict | null;
};

export type PublicTicket = {
  id: string;
  title: string;
  status: string;
  events: PublicEvent[];
};

export type GovernanceReplay = {
  schema: "vgdd.governance-replay.v1";
  generated_at: string;
  tickets: PublicTicket[];
};

type Rule = {
  actor: TimelineActor;
  pattern: RegExp;
  kind: PublicEventKind;
  reason: PublicEventReason | null;
};

// 票 §2 A1 の表と同じ順。上から順に当て、最初に当たった行を使う（具体的な行が先、「上のどれでもない」は後）。
// 正規表現は表の行ごとに1つ。当たるかどうかを見るだけで、文は抜き出さない。
const RULES: readonly Rule[] = [
  { actor: "gate-runner", pattern: /^status → in_progress（files_allowed の外を変更している/, kind: "returned", reason: "scope" },
  { actor: "gate-runner", pattern: /^status → in_progress（ブランチが main を含んでいない/, kind: "returned", reason: "rebase" },
  { actor: "gate-runner", pattern: /^status → in_progress（セキュリティ審査が差し戻し）/, kind: "returned", reason: "security" },
  { actor: "gate-runner", pattern: /^status → in_progress（.*両方が差し戻し/, kind: "returned", reason: "judiciary" },
  { actor: "gate-runner", pattern: /^status → in_progress(?![A-Za-z0-9_])/, kind: "returned", reason: "other" },
  { actor: "gate-runner", pattern: /^status → blocked（judge と Codex の判定が重大な指摘で分かれた/, kind: "blocked", reason: "disagreement" },
  { actor: "gate-runner", pattern: /^status → blocked（差し戻しが 3 回に達した/, kind: "blocked", reason: "return_limit" },
  { actor: "gate-runner", pattern: /^status → blocked（仕様（.*）がオーナーに承認されていない/, kind: "blocked", reason: "spec_unapproved" },
  { actor: "gate-runner", pattern: /^status → blocked(?![A-Za-z0-9_])/, kind: "blocked", reason: "other" },
  { actor: "gate-runner", pattern: /^status → review（判定に合格.*夜間のため統合せず/, kind: "held", reason: null },
  { actor: "gate-runner", pattern: /^status → merged(?![A-Za-z0-9_])/, kind: "merged", reason: null },
  { actor: "release", pattern: /^status → merged(?![A-Za-z0-9_])/, kind: "released", reason: null },
  { actor: "gate-runner", pattern: /^judge と Codex が分かれたが、オーナーの裁定/, kind: "ruling", reason: null },
  { actor: "gate-runner", pattern: /^judge と Codex が minor の指摘で分かれた/, kind: "minor_disagreement", reason: null },
  { actor: "night-runner", pattern: /^作業員の実装を前検査で確認/, kind: "resubmitted", reason: null },
];

// 完全なトークンだけを当てる。直後が英字・数字・_ なら当てない（APPROVED_EXTRA は null）。
// 直前が英字・数字・_ の場合（prejudge=APPROVED）も、別の語の一部なので当てない。
// 件数（/0 件）は値に含めない。
const JUDGE_TOKEN = /(?<![A-Za-z0-9_])judge=(APPROVED|CHANGES_REQUIRED)(?![A-Za-z0-9_])/;
const CODEX_TOKEN = /(?<![A-Za-z0-9_])codex=(APPROVED|CHANGES_REQUIRED)(?![A-Za-z0-9_])/;

function pickVerdict(detail: string, token: RegExp): PublicVerdict | null {
  const m = token.exec(detail);
  if (!m) return null;
  return m[1] === "APPROVED" ? "APPROVED" : "CHANGES_REQUIRED";
}

/** 記録の行を1つ、列挙値だけのイベントに変える。detail の文は返り値に入れない */
export function toPublicEvent(e: TimelineEvent, seq: number): PublicEvent {
  const rule = RULES.find((r) => r.actor === e.actor && r.pattern.test(e.detail));
  return {
    seq,
    ts: e.ts,
    actor: e.actor,
    kind: rule ? rule.kind : "other",
    reason: rule ? rule.reason : null,
    judge: pickVerdict(e.detail, JUDGE_TOKEN),
    codex: pickVerdict(e.detail, CODEX_TOKEN),
  };
}

/** 統治のデータから、公開用の応答を組み立てる。票の順と記録の順はそのまま */
export function buildReplay(data: GovernanceData): GovernanceReplay {
  return {
    schema: "vgdd.governance-replay.v1",
    generated_at: data.generated_at,
    tickets: data.tickets.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      events: t.timeline.map((e, i) => toPublicEvent(e, i + 1)),
    })),
  };
}
