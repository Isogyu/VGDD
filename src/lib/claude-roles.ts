// 統治シアターの「Claude Code の使い分け」の欄のデータ（T-036 A1・A2）。
// 役割の表は固定の文。件数は公開済みの集計（docs/governance/summary.json を GET /api/governance が返したもの）から組み立てる。
// ブラウザで使うため、React・node:fs・node:path は読まない。@/lib/governance は型だけを参照する（値として import すると node:fs が入る）。

import { z } from "zod";
import type { GovernanceSummary } from "@/lib/governance";

export type ClaudeRole = {
  key: string;
  role: string;
  feature: string;
  model: string;
  limits: string;
  /** 集計の by_agent の鍵。対応させない行は null */
  agentKey: string | null;
};

/** 役割の表（A1。文は票の表のとおり。表の中のバッククォートは書式なので、中身だけを入れる） */
export const CLAUDE_ROLES: readonly ClaudeRole[] = [
  {
    key: "main",
    role: "メインのセッション",
    feature: "行政の長などが、作業員を起動して申請する",
    model: "指定なし",
    limits: "権限ルールと sandbox で Z3 に触れない",
    agentKey: "(main)",
  },
  {
    key: "worker",
    role: "作業員",
    feature: "サブエージェント worker。自分の git worktree で実装する（isolation: worktree）",
    model: "Opus",
    limits: "ほかのエージェントの起動・Web の取得を外す",
    agentKey: "worker",
  },
  {
    key: "tester",
    role: "テスト担当",
    feature: "サブエージェント tester。作業員とは別に試験を書く（isolation: worktree）",
    model: "Opus",
    limits: "ほかのエージェントの起動・Web の取得を外す",
    agentKey: "tester",
  },
  {
    key: "helper",
    role: "汎用の補助",
    feature: "汎用のサブエージェント（調べもの・点検）",
    model: "指定なし",
    limits: "権限ルールとフックは同じ",
    agentKey: "general-purpose",
  },
  {
    key: "judge",
    role: "司法（Claude）",
    feature:
      "サブエージェント judge を、裁判所の judge.sh が claude -p --agent judge で別のプロセスとして呼ぶ。差分・受け入れ条件・監査の結果だけを入力にする",
    model: "Sonnet",
    limits: "定義に並べた組み込みのツールを disallowedTools で禁止",
    agentKey: null,
  },
  {
    key: "constitutional",
    role: "憲法審査",
    feature: "サブエージェント constitutional-review。法律の改正案が憲法に合うかを読む",
    model: "Sonnet",
    limits: "定義に並べた組み込みのツールを disallowedTools で禁止",
    agentKey: "constitutional-review",
  },
];

// ---------- 集計の検証 ----------
// pickSummary（src/lib/governance.ts）の summarySchema と同じ形のスキーマ。
// @/lib/governance は node:fs を含むので値として import せず、ここに同じ形で置く（厳しくも緩くもしない。A2）。
// 形を変えるときは、governance.ts の summarySchema と一緒に変える。
const roleSummarySchema = z.object({
  schema: z.literal("vgdd.governance-summary.v1"),
  generated_at: z.string(),
  period: z.object({ first: z.string().nullable(), last: z.string().nullable() }),
  chain_ok: z.boolean(),
  records: z.number(),
  sessions: z.number(),
  agents: z.number(),
  tool_calls: z.object({ allow: z.number(), deny: z.number() }),
  deny_kinds: z.record(z.string(), z.number()),
  by_agent: z.record(z.string(), z.object({ calls: z.number(), deny: z.number() })),
});

/** summary.json の中身を、ブラウザで検証し直す。pickSummary と同じ入力で同じ判定。合えば決めた項目だけで組み立て直す */
export function pickRoleSummary(json: unknown): GovernanceSummary | null {
  const r = roleSummarySchema.safeParse(json);
  if (!r.success) return null;
  const s = r.data;
  // pickSummary と同じく、決めた項目だけで組み立て直す
  const byAgent: Record<string, { calls: number; deny: number }> = {};
  for (const [k, v] of Object.entries(s.by_agent)) byAgent[k] = { calls: v.calls, deny: v.deny };
  return {
    schema: s.schema,
    generated_at: s.generated_at,
    period: { first: s.period.first, last: s.period.last },
    chain_ok: s.chain_ok,
    records: s.records,
    sessions: s.sessions,
    agents: s.agents,
    tool_calls: { allow: s.tool_calls.allow, deny: s.tool_calls.deny },
    deny_kinds: { ...s.deny_kinds },
    by_agent: byAgent,
  };
}

// ---------- 行の組み立て ----------

export type ClaudeRoleRow = ClaudeRole & {
  /** 呼び出しの記録（拒否を含む）。対応がない・集計がないときは null（0 で埋めない） */
  calls: number | null;
  /** うちフックの拒否。calls と同じく null がありうる */
  deny: number | null;
};

/** CLAUDE_ROLES の順のまま、各行に集計の calls と deny を足す */
export function buildRoleRows(summary: GovernanceSummary | null): ClaudeRoleRow[] {
  return CLAUDE_ROLES.map((role) => {
    const key = role.agentKey;
    const found =
      key !== null && summary !== null && Object.prototype.hasOwnProperty.call(summary.by_agent, key)
        ? summary.by_agent[key]
        : null;
    return { ...role, calls: found ? found.calls : null, deny: found ? found.deny : null };
  });
}

const DENY_KIND_LABELS: Readonly<Record<string, string>> = {
  protected_path: "保護パスへの操作",
  git_scope: "git の範囲の外",
  z3: "Z3",
  readonly_outside: "読むだけのフォルダ",
  hook_internal: "証拠ストア・入力の形",
  other: "その他",
};

const UNKNOWN_DENY_KIND_LABEL = "その他の分類";

/** 拒否の分類の鍵の表示名。決めていない鍵は「その他の分類」 */
export function denyKindLabel(key: string): string {
  return Object.prototype.hasOwnProperty.call(DENY_KIND_LABELS, key) ? DENY_KIND_LABELS[key] : UNKNOWN_DENY_KIND_LABEL;
}

export type DenyKind = { key: string; label: string; count: number };

export type HookTotals = {
  allow: number;
  deny: number;
  sessions: number;
  records: number;
  chainOk: boolean;
  generatedAt: string;
  periodLast: string | null;
  /** 件数の多い順。同じ件数は鍵の名前の順 */
  denyKinds: DenyKind[];
};

/** 鍵の名前の順（UTF-16 の符号の順。ロケールに左右されない） */
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** フックの集計。summary が null なら null */
export function buildHookTotals(summary: GovernanceSummary | null): HookTotals | null {
  if (summary === null) return null;
  const denyKinds = Object.entries(summary.deny_kinds)
    .map(([key, count]) => ({ key, label: denyKindLabel(key), count }))
    .sort((a, b) => b.count - a.count || compareKeys(a.key, b.key));
  return {
    allow: summary.tool_calls.allow,
    deny: summary.tool_calls.deny,
    sessions: summary.sessions,
    records: summary.records,
    chainOk: summary.chain_ok,
    generatedAt: summary.generated_at,
    periodLast: summary.period.last,
    denyKinds,
  };
}

/** 件数の表示。null は「—」、数は3桁ごとに「,」で区切る */
export function formatCount(n: number | null): string {
  return n === null ? "—" : n.toLocaleString("en-US");
}
