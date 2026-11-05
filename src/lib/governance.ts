// 統治のライブ画面（/governance）のデータ。T-013。
// 読むのはリポジトリの docs/ の中の3か所だけ：
//   ① <root>/docs/tasks/T-NNN-*.md（票。§6 の記録の行と front matter の id・title・status）
//   ② <root>/docs/tasks/_board.json（裁判所が書く盤。totals の5つの数だけ）
//   ③ <root>/docs/governance/summary.json（オーナーが書き出す件数だけの集計。zod で検証した項目だけ）
// 生のログ（証拠ストア・判定の全文）は読まない・出さない。パスの組み立てに外からの入力は使わない。
// シンボリックリンクはたどらない（lstat で確かめ、リンクなら「ない」として扱う）。

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { nowJst } from "@/lib/time";

export type TimelineActor = "gate-runner" | "night-runner" | "release";

export type TimelineEvent = {
  ts: string;
  actor: TimelineActor;
  status: string | null;
  detail: string;
};

export type GovernanceTicket = {
  id: string;
  title: string;
  status: string;
  timeline: TimelineEvent[];
  returns: number;
  disagreements: number;
};

export type GovernanceBoard = {
  tickets: number;
  merged: number;
  rejected: number;
  blocked: number;
  disagreements: number;
};

const summarySchema = z.object({
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

export type GovernanceSummary = {
  schema: "vgdd.governance-summary.v1";
  generated_at: string;
  period: { first: string | null; last: string | null };
  chain_ok: boolean;
  records: number;
  sessions: number;
  agents: number;
  tool_calls: { allow: number; deny: number };
  deny_kinds: Record<string, number>;
  by_agent: Record<string, { calls: number; deny: number }>;
};

export type GovernanceData = {
  generated_at: string;
  tickets: GovernanceTicket[];
  board: GovernanceBoard | null;
  summary: GovernanceSummary | null;
};

// ---------- 純粋関数 ----------

const RECORD_HEADING = /^## 6\. 記録\s*$/;
const TIMELINE_LINE =
  /^- (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}) (gate-runner|night-runner|release): (.*)$/;
const STATUS_IN_DETAIL = /status → ([a-z_]+)/;

/** 票の本文から §6 の記録の行（裁判所・夜間の代行・release）だけを、出てきた順に取り出す */
export function parseTimeline(markdown: string): TimelineEvent[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => RECORD_HEADING.test(l));
  if (start < 0) return [];
  const events: TimelineEvent[] = [];
  for (const line of lines.slice(start + 1)) {
    const m = TIMELINE_LINE.exec(line);
    if (!m) continue;
    const detail = m[3].trim();
    const s = STATUS_IN_DETAIL.exec(detail);
    events.push({ ts: m[1], actor: m[2] as TimelineActor, status: s ? s[1] : null, detail });
  }
  return events;
}

/** 票の front matter から id・title・status を読む。どれかがなければ null */
export function parseFrontMatter(markdown: string): { id: string; title: string; status: string } | null {
  const lines = markdown.split(/\r?\n/);
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end < 0) return null;
  const found: Partial<Record<"id" | "title" | "status", string>> = {};
  for (const line of lines.slice(1, end)) {
    const m = /^(id|title|status): (.*)$/.exec(line);
    if (!m) continue;
    const key = m[1] as "id" | "title" | "status";
    if (found[key] !== undefined) continue; // 最初に出てきた行を使う
    const hash = m[2].indexOf("#");
    const value = (hash >= 0 ? m[2].slice(0, hash) : m[2]).trim();
    if (value) found[key] = value;
  }
  if (!found.id || !found.title || !found.status) return null;
  return { id: found.id, title: found.title, status: found.status };
}

/** timeline から差し戻しの回数と司法の不一致の回数を数える */
export function countReturns(timeline: TimelineEvent[]): { returns: number; disagreements: number } {
  let returns = 0;
  let disagreements = 0;
  for (const e of timeline) {
    if (e.actor !== "gate-runner") continue;
    if (e.status === "in_progress") returns += 1;
    if (e.status === "blocked" && e.detail.includes("分かれた")) disagreements += 1;
  }
  return { returns, disagreements };
}

/** _board.json の中身（パース済み）から totals の5つの数を取り出す。形が違えば null */
export function pickBoardTotals(json: unknown): GovernanceBoard | null {
  if (typeof json !== "object" || json === null) return null;
  const totals = (json as { totals?: unknown }).totals;
  if (typeof totals !== "object" || totals === null) return null;
  const t = totals as Record<string, unknown>;
  const keys = ["tickets", "merged", "rejected", "blocked", "disagreements"] as const;
  for (const k of keys) {
    if (typeof t[k] !== "number" || !Number.isFinite(t[k])) return null;
  }
  return {
    tickets: t.tickets as number,
    merged: t.merged as number,
    rejected: t.rejected as number,
    blocked: t.blocked as number,
    disagreements: t.disagreements as number,
  };
}

/** summary.json の中身（パース済み）を検証し、決めた項目だけを取り出す。通らなければ null */
export function pickSummary(json: unknown): GovernanceSummary | null {
  const r = summarySchema.safeParse(json);
  if (!r.success) return null;
  const s = r.data;
  // z.object は余分な項目を落とすが、念のため決めた項目だけで組み立て直す
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

// ---------- ファイルの読み込み ----------

const TICKET_NAME = /^T-\d{3}-[a-z0-9-]+\.md$/;
const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;

/** 実在するディレクトリで、シンボリックリンクでないときだけ true */
function isRealDir(p: string): boolean {
  try {
    const st = fs.lstatSync(p);
    return !st.isSymbolicLink() && st.isDirectory();
  } catch {
    return false;
  }
}

/** シンボリックリンクでない通常のファイルだけを読む。読めなければ null（例外は投げない） */
function readRegularFile(p: string): string | null {
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    // lstat と open の間にリンクへ差し替えられても、O_NOFOLLOW で最後の要素のリンクはたどらない
    const fd = fs.openSync(p, fs.constants.O_RDONLY | O_NOFOLLOW);
    try {
      const fst = fs.fstatSync(fd);
      if (!fst.isFile()) return null;
      return fs.readFileSync(fd, "utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function readJson(p: string): unknown {
  const text = readRegularFile(p);
  if (text === null) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** リポジトリの docs/ から統治の画面のデータを作る。root は既定でアプリの作業ツリー */
export function loadGovernance(root: string = process.cwd()): GovernanceData {
  // パスは root と固定の名前だけで組み立てる（外からの入力は使わない）
  const docsDir = path.join(root, "docs");
  const tasksDir = path.join(docsDir, "tasks");
  const governanceDir = path.join(docsDir, "governance");

  const docsOk = isRealDir(docsDir);
  const tasksOk = docsOk && isRealDir(tasksDir);
  const governanceOk = docsOk && isRealDir(governanceDir);

  const tickets: GovernanceTicket[] = [];
  if (tasksOk) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(tasksDir).filter((n) => TICKET_NAME.test(n)).sort();
    } catch {
      names = [];
    }
    for (const name of names) {
      const text = readRegularFile(path.join(tasksDir, name));
      if (text === null) continue;
      const fm = parseFrontMatter(text);
      if (!fm) continue;
      const timeline = parseTimeline(text);
      tickets.push({ ...fm, timeline, ...countReturns(timeline) });
    }
  }

  const board = tasksOk ? pickBoardTotals(readJson(path.join(tasksDir, "_board.json"))) : null;
  const summary = governanceOk ? pickSummary(readJson(path.join(governanceDir, "summary.json"))) : null;

  return { generated_at: nowJst(), tickets, board, summary };
}
