// 統治シアターの下の2つの欄（判例の比較・判断待ちと次の担当）の組み立て。T-033 A1。
// 純粋関数だけを置く（node:fs は読まない。React は import しない）。
// 入力は検証済みの写し（法律の公開の要約・Kernel の写し・不変条件の写し）で、ないものを推し量って足さない。

import type { KernelInvariants } from "@/lib/kernel-invariants-schema";
import type { KernelState } from "@/lib/kernel-state-schema";
import type { LawHistory } from "@/lib/law-history-schema";

type LawVersion = LawHistory["versions"][number];

// ---------- 判例の比較 ----------

/** 最初に選ぶ代表例の版（片方の司法の判定が欠けても統合された穴。判例 G15・G19） */
export const FEATURED_VERSION = "p0.4.3";

/** prev_failed が null でない版を、元の順のまま返す */
export function comparableVersions(history: LawHistory): LawVersion[] {
  return history.versions.filter((v) => v.prev_failed !== null);
}

/** 比べられる版に FEATURED_VERSION があればそれ、なければ比べられる版の最後、1つもなければ null */
export function defaultVersion(history: LawHistory): string | null {
  const list = comparableVersions(history);
  if (list.some((v) => v.version === FEATURED_VERSION)) return FEATURED_VERSION;
  return list.at(-1)?.version ?? null;
}

// 見つけた主体の表示名（固定の対応。ほかの値は「—」）
const FINDER_LABELS: ReadonlyMap<string, string> = new Map([
  ["executive_head", "行政の長"],
  ["legislative", "立法補佐"],
  ["codex", "Codex の監査"],
  ["judge", "司法（Claude）"],
  ["owner", "オーナー"],
  ["operation", "運用の記録"],
]);

export type Comparison = {
  version: string;
  date: string;
  title: string;
  fixed: string[];
  precedents: string[];
  foundBy: string[];
  prevFailed: number | null;
  testsTotal: number | null;
  /** versions の中で1つ前の項目の版名。先頭なら null */
  previousVersion: string | null;
};

/** その版と、1つ前の項目の版名を返す。版がなければ null */
export function comparisonFor(history: LawHistory, version: string): Comparison | null {
  const index = history.versions.findIndex((v) => v.version === version);
  if (index < 0) return null;
  const v = history.versions[index];
  return {
    version: v.version,
    date: v.date,
    title: v.title,
    fixed: [...v.fixed],
    precedents: [...v.precedents],
    foundBy: v.found_by.map((f) => FINDER_LABELS.get(f) ?? "—"),
    prevFailed: v.prev_failed,
    testsTotal: v.tests_total,
    previousVersion: index > 0 ? history.versions[index - 1].version : null,
  };
}

// ---------- 判断待ちと次の担当 ----------

export type PendingDecision = {
  key: string;
  what: string;
  next: string;
  /** ISO の文字列か null */
  since: string | null;
};

/**
 * 判断待ちの行を、停止 → 司法が使えない → held → 確かめられない承認 → 仕様の承認待ち の順で返す。
 * 同じ票は1行だけにし、先に当たった行を残す。state が null なら 1〜4 を、invariants が null なら 5 を作らない。
 */
export function pendingDecisions(
  state: KernelState | null,
  invariants: KernelInvariants | null,
): PendingDecision[] {
  const rows: PendingDecision[] = [];
  const seenTasks = new Set<string>();
  const addTask = (task: string, what: string, next: string, since: string | null) => {
    if (seenTasks.has(task)) return;
    seenTasks.add(task);
    rows.push({ key: task, what, next, since });
  };

  if (state !== null) {
    if (state.stopped.active) {
      rows.push({
        key: "stopped",
        what: "Kernel は停止中。統合しない",
        next: "オーナー（再開）",
        since: state.stopped.since,
      });
    }
    if (state.judiciary.status === "unavailable") {
      rows.push({
        key: "judiciary",
        what: "司法が使えない。統合しない",
        next: "記録からは決められない",
        since: state.judiciary.since,
      });
    }
    for (const h of state.held) {
      addTask(h.task, `${h.task}：判定に合格。統合を保留`, "オーナー（release で承認）", h.since);
    }
    for (const a of state.approvals) {
      if (a.current) continue;
      // 写しに原因はないので、仕様が変わったとは書かない
      addTask(
        a.task,
        `${a.task}：今の仕様・法律の系統に対する承認を確かめられない`,
        "オーナー（承認の確認。必要なら承認し直し）",
        null,
      );
    }
  }

  if (invariants !== null) {
    for (const p of invariants.pending_approvals) {
      addTask(p.task, `${p.task}：仕様の承認待ち`, "オーナー（仕様の承認）", null);
    }
  }

  return rows;
}

export type InvariantTone = "ok" | "partial" | "failed" | "unknown";

/** 不変条件の1行の色の分類。failed（verified が false）を partial より先に判定する */
export function invariantTone(row: KernelInvariants["invariants"][number]): InvariantTone {
  if (row.verified === false) return "failed";
  if (row.status === "partial") return "partial";
  if (row.status === "enforced" && row.verified === true) return "ok";
  return "unknown";
}
