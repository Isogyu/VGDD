// Kernel の状態の写し（docs/governance/kernel-state.json、法律 p0.4.3 §1）の形の検証と表示用の整形。T-022。
// 純粋関数だけを置く（node:fs は使わない）。サーバーの読み込み（kernel-state.ts）と画面（KernelPanel）の両方から使う。
// この写しは表示用。判断の根拠にしない。

import { z } from "zod";
import { formatMdHm, toJstIso } from "@/lib/time";

// ---------- 補助の型 ----------

const Iso = z.string().min(10).max(40);
const Short = z.string().min(1).max(40);
const TASK_ID = /^T-\d{3,4}$/;
const TaskId = z.string().regex(TASK_ID);
const Count = z.number().int().min(0).max(1_000_000);
const Verdict = z.enum(["APPROVED", "CHANGES_REQUIRED"]).nullable();

const verdictEntrySchema = z
  .object({ judge: Verdict, codex: Verdict, security: Verdict, at: Iso })
  .strict();

// ---------- T-042：任意の3項目（budget・runs・acceptance）だけに使う検証 ----------
// 今の Count（上限 100 万）と Iso は流用しない。文字列は period_id・until・票の ID だけ。

/** 新しい3項目の「数」：0 以上 Number.MAX_SAFE_INTEGER 以下の整数 */
const SafeCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const SafeLimit = SafeCount.nullable();

/** タイムゾーン付きの日時（秒まで必須、小数秒は任意、Z か ±HH:MM） */
const OFFSET_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/** 暦の上で有効な日時か（2月30日・25時・オフセット +24:00 などを拒む） */
function isValidOffsetDateTime(s: string): boolean {
  const m = OFFSET_DATETIME.exec(s);
  if (m === null) return false;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (month < 1 || month > 12) return false;
  // 0〜99 年を 1900 年代として扱わないよう、setUTCFullYear で年を正しく置く
  const last = new Date(0);
  last.setUTCFullYear(year, month, 0);
  const daysInMonth = last.getUTCDate();
  if (day < 1 || day > daysInMonth) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (m[7] !== undefined) {
    if (Number(m[8]) > 23 || Number(m[9]) > 59) return false;
  }
  return !Number.isNaN(Date.parse(s));
}

const OffsetDateTime = z.string().max(40).refine(isValidOffsetDateTime);

const usedLimitSchema = z.object({ used: SafeCount, limit: SafeLimit }).strict();

const budgetSchema = z
  .object({
    period_id: z.string().min(1).max(40),
    until: OffsetDateTime.nullable(),
    tokens: z
      .object({ settled: SafeCount, reserved: SafeCount, unknown_runs: SafeCount, limit: SafeLimit })
      .strict(),
    judge_calls: usedLimitSchema,
    attempts: usedLimitSchema,
    workers: z.object({ active: SafeCount, limit: SafeLimit }).strict(),
  })
  .strict();

const runsSchema = z
  .object({
    requested: SafeCount,
    reserved: SafeCount,
    started: SafeCount,
    exited: SafeCount,
    settled: SafeCount,
    cancelled: SafeCount,
    liveness_unknown: SafeCount,
    usage_unknown: SafeCount,
  })
  .strict();

const acceptanceSchema = z
  .object({
    accepted_count: SafeCount,
    pending_count: SafeCount,
    accepted: z.array(TaskId).max(500),
    pending: z.array(TaskId).max(500),
  })
  .strict()
  .refine((a) => a.accepted_count >= a.accepted.length && a.pending_count >= a.pending.length);

// verdicts.by_task は (2) で別に扱うので、ここには持たない
const kernelStateSchema = z
  .object({
    schema: z.literal("vgdd.kernel-state.v1"),
    generated_at: Iso,
    kernel_version: Short.nullable(),
    policy_version: Short.nullable(),
    stopped: z.object({ active: z.boolean(), since: Iso.nullable() }).strict(),
    judiciary: z
      .object({
        status: z.enum(["ok", "unavailable"]),
        kind: z.enum(["preflight_failed", "judiciary_unavailable"]).nullable(),
        since: Iso.nullable(),
      })
      .strict()
      .refine((j) => (j.status === "ok" ? j.kind === null : j.kind !== null)),
    approvals: z
      .array(z.object({ task: TaskId, current: z.boolean(), approved_at: Iso.nullable() }).strict())
      .max(500),
    held: z.array(z.object({ task: TaskId, since: Iso.nullable() }).strict()).max(500),
    rulings: z.object({ count: Count, tasks: z.array(TaskId).max(500) }).strict(),
    annulments: z.object({ count: Count }).strict(),
    verdicts: z.object({ count: Count }).strict(),
    disagreements: z.object({ count: Count, tasks: z.array(TaskId).max(500) }).strict(),
    evidence: z
      .object({
        records: Count,
        chain_ok: z.boolean().nullable(),
        checkpoint_mismatches: Count.nullable(),
        checkpoint_at: Iso.nullable(),
        last_record_at: Iso.nullable(),
      })
      .strict(),
    conformance: z
      .object({
        passed: Count,
        total: Count,
        impl: z.enum(["repo", "z3"]).nullable(),
        kernel_version: Short.nullable(),
        at: Iso.nullable(),
      })
      .strict()
      .refine((c) => c.passed <= c.total)
      .nullable(),
    // T-042：任意。書かれていなければ undefined（鍵も作らない）
    budget: budgetSchema.optional(),
    runs: runsSchema.optional(),
    acceptance: acceptanceSchema.optional(),
  })
  .strict();

export type VerdictValue = z.infer<typeof Verdict>;
export type VerdictEntry = z.infer<typeof verdictEntrySchema>;
type KernelStateBase = z.infer<typeof kernelStateSchema>;
/** T-042：任意の3項目の型（KernelState・KernelStateWire には任意の項目として入る） */
export type KernelBudget = z.infer<typeof budgetSchema>;
export type KernelRuns = z.infer<typeof runsSchema>;
export type KernelAcceptance = z.infer<typeof acceptanceSchema>;

/** 検証を通った Kernel の状態。verdicts.by_task だけ Map（鍵は T-NNN の票の ID）。budget・runs・acceptance は任意 */
export type KernelState = Omit<KernelStateBase, "verdicts"> & {
  verdicts: { count: number; by_task: ReadonlyMap<string, VerdictEntry> };
};

/** 通信の形。verdicts.by_task を普通のオブジェクトに戻したもの（Map は JSON.stringify で {} になるため） */
export type KernelStateWire = Omit<KernelStateBase, "verdicts"> & {
  verdicts: { count: number; by_task: Record<string, VerdictEntry> };
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * JSON を Kernel の状態として検証する。形が合わなければ null。
 * verdicts.by_task は zod に渡す前に Object.entries で取り出し、T-NNN の鍵だけを Map に移す
 * （__proto__・constructor などの鍵は捨てる）。値は1件ずつ検証し、落ちた値だけを捨てる。
 */
export function pickKernelState(json: unknown): KernelState | null {
  // (1) オブジェクト（null・配列でない）でなければ null
  if (!isPlainObject(json)) return null;

  // (2) by_task を Map に移し、zod には by_task を除いた形を渡す
  const byTask = new Map<string, VerdictEntry>();
  let input: Record<string, unknown> = json;
  const verdicts = json.verdicts;
  if (isPlainObject(verdicts)) {
    const rawByTask = verdicts.by_task;
    if (isPlainObject(rawByTask)) {
      for (const [key, value] of Object.entries(rawByTask)) {
        if (!TASK_ID.test(key)) continue;
        const r = verdictEntrySchema.safeParse(value);
        if (r.success) byTask.set(key, r.data);
      }
    }
    const rest = Object.fromEntries(Object.entries(verdicts).filter(([k]) => k !== "by_task"));
    input = Object.fromEntries(
      Object.entries(json).map(([k, v]) => (k === "verdicts" ? [k, rest] : [k, v])),
    );
  }

  // (3) strict で検証する
  const parsed = kernelStateSchema.safeParse(input);
  if (!parsed.success) return null;
  return { ...parsed.data, verdicts: { count: parsed.data.verdicts.count, by_task: byTask } };
}

/** 通信の形にする（by_task の Map を Object.fromEntries で普通のオブジェクトに戻す） */
export function toWire(state: KernelState): KernelStateWire {
  return {
    ...state,
    verdicts: { count: state.verdicts.count, by_task: Object.fromEntries(state.verdicts.by_task) },
  };
}

// ---------- 表示用の整形 ----------

/** 日時を JST の「11/3 13:05」にする。null か Date にできない文字列は「—」 */
export function formatJst(iso: string | null): string {
  if (iso === null) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return formatMdHm(toJstIso(new Date(ms)));
}

export type VerdictRow = {
  task: string;
  judge: VerdictValue;
  codex: VerdictValue;
  security: VerdictValue;
  at: string;
  disagreed: boolean;
};

export type KernelSummary = {
  approvedCurrent: number;
  approvalsSorted: KernelState["approvals"];
  verdictRows: VerdictRow[];
  heldCount: number;
  rulingCount: number;
  stale: boolean;
};

/** 古い写しとみなす経過時間（ミリ秒）。ちょうどこの値は古くない */
const STALE_MS = 600_000;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 画面に出す件数と並びを作る。件数は配列の長さを使う（count と食い違っても長さ） */
export function summarizeKernel(state: KernelState, now: Date): KernelSummary {
  const approvalsSorted = [...state.approvals].sort((a, b) => {
    if (a.approved_at === null && b.approved_at === null) return compareText(a.task, b.task);
    if (a.approved_at === null) return 1;
    if (b.approved_at === null) return -1;
    if (a.approved_at !== b.approved_at) return compareText(b.approved_at, a.approved_at);
    return compareText(a.task, b.task);
  });

  const disagreed = new Set(state.disagreements.tasks);
  const verdictRows: VerdictRow[] = [...state.verdicts.by_task.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([task, v]) => ({ task, ...v, disagreed: disagreed.has(task) }));

  const generatedMs = Date.parse(state.generated_at);
  const stale = Number.isNaN(generatedMs) || now.getTime() - generatedMs > STALE_MS;

  return {
    approvedCurrent: state.approvals.filter((a) => a.current).length,
    approvalsSorted,
    verdictRows,
    heldCount: state.held.length,
    rulingCount: state.rulings.tasks.length,
    stale,
  };
}
