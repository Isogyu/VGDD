// 旧い GET /api/governance の公開の応答を組み立てる（T-034）。票の §6 の記録の文（detail）を除く。
// 各階層で許可したキーだけを明示して組み立てる（入力のオブジェクトを広げてコピーしない）。
// 内部の TimelineEvent の detail は消さない（governance.ts は差し戻しの数えにも使う）。
// 型だけを読む（governance.ts は node:fs を使うので、値は読み込まない）。

import type { GovernanceBoard, GovernanceData, GovernanceSummary, TimelineActor } from "@/lib/governance";

export type PublicGovernanceEvent = {
  ts: string;
  actor: TimelineActor;
  status: string | null;
};

export type PublicGovernanceTicket = {
  id: string;
  title: string;
  status: string;
  returns: number;
  disagreements: number;
  timeline: PublicGovernanceEvent[];
};

export type PublicGovernance = {
  generated_at: string;
  board: GovernanceBoard | null;
  summary: GovernanceSummary | null;
  tickets: PublicGovernanceTicket[];
};

function toPublicBoard(board: GovernanceBoard | null): GovernanceBoard | null {
  if (board === null) return null;
  return {
    tickets: board.tickets,
    merged: board.merged,
    rejected: board.rejected,
    blocked: board.blocked,
    disagreements: board.disagreements,
  };
}

function toPublicSummary(summary: GovernanceSummary | null): GovernanceSummary | null {
  if (summary === null) return null;
  return {
    schema: summary.schema,
    generated_at: summary.generated_at,
    period: { first: summary.period.first, last: summary.period.last },
    chain_ok: summary.chain_ok,
    records: summary.records,
    sessions: summary.sessions,
    agents: summary.agents,
    tool_calls: { allow: summary.tool_calls.allow, deny: summary.tool_calls.deny },
    // 動的なキーは保つ。Object.fromEntries は __proto__ というキーでもプロトタイプを変えない
    deny_kinds: Object.fromEntries(Object.entries(summary.deny_kinds)),
    by_agent: Object.fromEntries(
      Object.entries(summary.by_agent).map(([agent, counts]) => [agent, { calls: counts.calls, deny: counts.deny }]),
    ),
  };
}

/** 統治のデータから、公開の応答を組み立てる。票の順と記録の順はそのまま */
export function toPublicGovernance(data: GovernanceData): PublicGovernance {
  return {
    generated_at: data.generated_at,
    board: toPublicBoard(data.board),
    summary: toPublicSummary(data.summary),
    tickets: data.tickets.map((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      status: ticket.status,
      returns: ticket.returns,
      disagreements: ticket.disagreements,
      timeline: ticket.timeline.map((event) => ({ ts: event.ts, actor: event.actor, status: event.status })),
    })),
  };
}
