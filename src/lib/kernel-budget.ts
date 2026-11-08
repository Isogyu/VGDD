// Kernel の写しの任意の3項目（budget・runs・acceptance）を画面に出すための純粋関数。T-045。
// 検証は pickKernelState（kernel-state-schema.ts）が済ませている。ここでは検証し直さず、表示の形にするだけ。

import type { KernelAcceptance, KernelBudget, KernelRuns } from "@/lib/kernel-state-schema";

const NUMBER_FORMAT = new Intl.NumberFormat("ja-JP");

/** 数を3桁ごとに「,」で区切る */
export function fmt(n: number): string {
  return NUMBER_FORMAT.format(n);
}

export type UsageRow = {
  used: number;
  limit: number | null;
  percent: number | null;
  text: string;
};

/** 使用量と上限から、割合と表示の文を作る。上限 null・0 のとき割合は null */
export function usageRow(used: number, limit: number | null): UsageRow {
  if (limit === null) {
    return { used, limit, percent: null, text: `${fmt(used)}（上限なし）` };
  }
  if (limit === 0) {
    return { used, limit, percent: null, text: `${fmt(used)} ／ 上限 0` };
  }
  // 100 を超えてもそのまま出す
  const percent = Math.floor((used * 100) / limit);
  return { used, limit, percent, text: `${fmt(used)} ／ ${fmt(limit)}（${percent}%）` };
}

export type BudgetRow = { label: string; row: UsageRow };

/** 予算の4行を決まった順で返す。トークンは精算済みと予約中の和 */
export function budgetRows(b: KernelBudget): BudgetRow[] {
  return [
    { label: "トークン（精算済み＋予約中）", row: usageRow(b.tokens.settled + b.tokens.reserved, b.tokens.limit) },
    { label: "司法の呼び出し", row: usageRow(b.judge_calls.used, b.judge_calls.limit) },
    { label: "試行", row: usageRow(b.attempts.used, b.attempts.limit) },
    { label: "作業員（同時）", row: usageRow(b.workers.active, b.workers.limit) },
  ];
}

const PERIOD_ALLOWED = /^[A-Za-z0-9._-]{1,40}$/;
const LONG_HEX = /[0-9a-fA-F]{12,}/;
export const HIDDEN_PERIOD_LABEL = "（表示しない形の期間名）";

/** 期間名を画面に出してよい形ならそのまま、パス・文・ハッシュらしいものは固定の文にする */
export function periodLabel(period_id: string): string {
  if (PERIOD_ALLOWED.test(period_id) && !LONG_HEX.test(period_id)) return period_id;
  return HIDDEN_PERIOD_LABEL;
}

const PENDING_PREVIEW_MAX = 20;

/** 受け入れ待ちの票の ID を先頭から最大 20 件と、残りの件数 */
export function pendingPreview(a: KernelAcceptance): { ids: string[]; more: number } {
  const ids = a.pending.slice(0, PENDING_PREVIEW_MAX);
  return { ids, more: Math.max(0, a.pending_count - ids.length) };
}

export type RunsKey = keyof KernelRuns;
export type RunsRow = { key: RunsKey; label: string; count: number };

const RUNS_LABELS: { key: RunsKey; label: string }[] = [
  { key: "requested", label: "要求" },
  { key: "reserved", label: "予約" },
  { key: "started", label: "起動" },
  { key: "exited", label: "終了" },
  { key: "settled", label: "精算" },
  { key: "cancelled", label: "取り消し" },
  { key: "liveness_unknown", label: "生死が不明" },
  { key: "usage_unknown", label: "利用量が不明" },
];

/** 実行の状態の8つの件数を決まった順で返す */
export function runsRows(r: KernelRuns): RunsRow[] {
  return RUNS_LABELS.map(({ key, label }) => ({ key, label, count: r[key] }));
}
