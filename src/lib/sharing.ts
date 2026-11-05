// 共有前の本人確認の裏側（M9）：共有候補の作成・承認・編集して承認・却下・取り下げ・記録。
// 本文の出どころは整理結果（M4）と、本人が編集で入力した本文だけ。notes の表は読まない。
// 認証はない（要件 §10）。「本人の候補か」は送られた userId と候補の user_id の一致で見るだけで、userId を偽った利用は防がない。
// サーバー側からだけ import する。

import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";
import { getSession } from "./sessions";
import { getLatestSummary } from "./summarize";
import { SUMMARY_LABELS, itemStatus, type ItemStatus, type Summary, type SummaryItem } from "./summary-schema";
import { detectSensitive, type Flag } from "./sensitive";
import { nowJst } from "./time";

/** 共有の本文に入れる項目（この順に並べる） */
export const SHARE_KEYS = ["struggle", "resolution", "decision_reason", "learning"] as const;

/** 最終本文の長さの上限（JavaScript の文字列の長さ） */
const MAX_BODY_LENGTH = 2000;
/** 却下の理由の長さの上限 */
const MAX_REASON_LENGTH = 500;

export type ShareStatus = "pending" | "approved" | "rejected" | "withdrawn";
export type ShareAction = "approve" | "edit_approve" | "reject";

/** share_candidates の1行 */
interface ShareRow {
  id: number;
  session_id: number;
  user_id: string;
  task_name: string;
  summary_id: number;
  draft_body: string;
  status: ShareStatus;
  action: ShareAction | null;
  final_body: string | null;
  reject_reason: string | null;
  knowledge_id: number | null;
  created_at: string;
  decided_at: string | null;
  withdrawn_at: string | null;
}

export interface ShareCandidate extends ShareRow {
  /** draft_body の機密検査の結果 */
  flags: Flag[];
  /** 未決定で、作ったときの整理結果がもう最新ではない（読めない場合を含む） */
  stale: boolean;
}

export type CreateShareError = "session_not_found" | "not_your_session" | "session_active" | "no_summary" | "nothing_to_share";
export type CreateShareResult = { ok: true; candidate: ShareCandidate; created: boolean } | { ok: false; error: CreateShareError };

export type DecideShareError =
  | "share_not_found"
  | "not_your_share"
  | "already_decided"
  | "stale_candidate"
  | "empty_body"
  | "body_too_long"
  | "flagged_body"
  | "reason_too_long";
export type DecideShareResult = { ok: true; candidate: ShareCandidate } | { ok: false; error: DecideShareError; flags?: Flag[] };

export type WithdrawShareError = "share_not_found" | "not_your_share" | "not_approved";
export type WithdrawShareResult = { ok: true; candidate: ShareCandidate } | { ok: false; error: WithdrawShareError };

/** 保存済みの項目の状態。項目が欠けた古いデータは「記録なし」として扱う（getPreviousSummary と同じ考え方） */
function shareItemStatus(item: SummaryItem | undefined): ItemStatus {
  if (!item || typeof item !== "object" || typeof item.text !== "string") return "none";
  return itemStatus({ ...item, evidence_note_ids: Array.isArray(item.evidence_note_ids) ? item.evidence_note_ids : [] });
}

/** 整理結果から共有の本文を作る。共有する項目がすべて「記録なし」なら null */
export function buildShareDraft(summary: Summary): string | null {
  const lines: string[] = [];
  for (const key of SHARE_KEYS) {
    const item = summary[key] as SummaryItem | undefined;
    const status = shareItemStatus(item);
    if (!item || status === "none") continue;
    const text = item.text.replace(/\r\n|\n|\r/g, " ");
    lines.push(`【${SUMMARY_LABELS[key]}】${text}${status === "inferred" ? "（AI の推測）" : ""}`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function isStale(row: ShareRow, db: DatabaseSync): boolean {
  if (row.status !== "pending") return false;
  return getLatestSummary(row.session_id, db)?.id !== row.summary_id;
}

function toCandidate(row: ShareRow, db: DatabaseSync): ShareCandidate {
  return { ...row, flags: detectSensitive(row.draft_body), stale: isStale(row, db) };
}

function getRow(id: number, db: DatabaseSync): ShareRow | undefined {
  return db.prepare("SELECT * FROM share_candidates WHERE id = ?").get(id) as unknown as ShareRow | undefined;
}

function findPendingRow(sessionId: number, summaryId: number, db: DatabaseSync): ShareRow | undefined {
  return db
    .prepare("SELECT * FROM share_candidates WHERE session_id = ? AND summary_id = ? AND status = 'pending'")
    .get(sessionId, summaryId) as unknown as ShareRow | undefined;
}

/**
 * work を1つの BEGIN IMMEDIATE〜COMMIT の中で実行する。
 * ok: false の返却と例外では ROLLBACK し、判定の後に別の書き込みが割り込まないようにする。
 */
function inImmediateTransaction<T extends { ok: boolean }>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec(result.ok ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // SQLite が自動で巻き戻した後は ROLLBACK が失敗する。元の例外を優先して投げる
    }
    throw e;
  }
}

/** 共有候補を作る。同じ版の未決定の候補がすでにあれば、作らずにそれを返す */
export function createShareCandidate(sessionId: number, userId: string, db: DatabaseSync = getDb()): CreateShareResult {
  return inImmediateTransaction<CreateShareResult>(db, () => {
    const session = getSession(sessionId, db);
    if (!session) return { ok: false, error: "session_not_found" };
    if (session.user_id !== userId) return { ok: false, error: "not_your_session" };
    if (session.status !== "ended") return { ok: false, error: "session_active" };
    const latest = getLatestSummary(sessionId, db);
    if (!latest) return { ok: false, error: "no_summary" };
    const draft = buildShareDraft(latest.summary);
    if (draft === null) return { ok: false, error: "nothing_to_share" };

    const existing = findPendingRow(sessionId, latest.id, db);
    if (existing) return { ok: true, candidate: toCandidate(existing, db), created: false };

    try {
      const r = db
        .prepare(
          `INSERT INTO share_candidates (session_id, user_id, task_name, summary_id, draft_body, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        )
        .run(sessionId, userId, session.task_name, latest.id, draft, nowJst());
      return { ok: true, candidate: toCandidate(getRow(Number(r.lastInsertRowid), db)!, db), created: true };
    } catch (e) {
      // idx_share_pending の一意の違反なら、既存の候補を返す
      if (!(e instanceof Error) || !e.message.includes("UNIQUE constraint failed")) throw e;
      const raced = findPendingRow(sessionId, latest.id, db);
      if (!raced) throw e;
      return { ok: true, candidate: toCandidate(raced, db), created: false };
    }
  });
}

/** 候補を承認・編集して承認・却下する。判定と書き込みは1つのトランザクションの中で行う */
export function decideShare(
  candidateId: number,
  userId: string,
  input: { action: ShareAction; body?: string; reason?: string; confirmFlagged?: boolean },
  db: DatabaseSync = getDb(),
): DecideShareResult {
  return inImmediateTransaction<DecideShareResult>(db, () => {
    const row = getRow(candidateId, db);
    if (!row) return { ok: false, error: "share_not_found" };
    if (row.user_id !== userId) return { ok: false, error: "not_your_share" };
    if (row.status !== "pending") return { ok: false, error: "already_decided" };
    if (isStale(row, db)) return { ok: false, error: "stale_candidate" };

    const now = nowJst();
    if (input.action === "reject") {
      const reason = (input.reason ?? "").trim();
      if (reason.length > MAX_REASON_LENGTH) return { ok: false, error: "reason_too_long" };
      const r = db
        .prepare(
          `UPDATE share_candidates SET status = 'rejected', action = 'reject', reject_reason = ?, decided_at = ?
            WHERE id = ? AND status = 'pending'`,
        )
        .run(reason || null, now, row.id);
      if (Number(r.changes) !== 1) return { ok: false, error: "already_decided" };
      return { ok: true, candidate: toCandidate(getRow(row.id, db)!, db) };
    }

    const finalBody = input.action === "approve" ? row.draft_body : (input.body ?? "").trim();
    if (finalBody.length === 0) return { ok: false, error: "empty_body" };
    if (finalBody.length > MAX_BODY_LENGTH) return { ok: false, error: "body_too_long" };
    const flags = detectSensitive(finalBody);
    if (flags.length > 0 && input.confirmFlagged !== true) return { ok: false, error: "flagged_body", flags };

    const knowledge = db
      .prepare("INSERT INTO shared_knowledge (task_name, user_id, session_id, body, approved_at) VALUES (?, ?, ?, ?, ?)")
      .run(row.task_name, row.user_id, row.session_id, finalBody, now);
    const r = db
      .prepare(
        `UPDATE share_candidates SET status = 'approved', action = ?, final_body = ?, knowledge_id = ?, decided_at = ?
          WHERE id = ? AND status = 'pending'`,
      )
      .run(input.action, finalBody, Number(knowledge.lastInsertRowid), now, row.id);
    if (Number(r.changes) !== 1) return { ok: false, error: "already_decided" };
    return { ok: true, candidate: toCandidate(getRow(row.id, db)!, db) };
  });
}

/** 承認した候補を取り下げる。知識と候補に同じ時刻を書く */
export function withdrawShare(candidateId: number, userId: string, db: DatabaseSync = getDb()): WithdrawShareResult {
  return inImmediateTransaction<WithdrawShareResult>(db, () => {
    const row = getRow(candidateId, db);
    if (!row) return { ok: false, error: "share_not_found" };
    if (row.user_id !== userId) return { ok: false, error: "not_your_share" };
    if (row.status !== "approved") return { ok: false, error: "not_approved" };

    const now = nowJst();
    const knowledge = db.prepare("UPDATE shared_knowledge SET withdrawn_at = ? WHERE id = ?").run(now, row.knowledge_id);
    // 知識の行を取り下げられなければ、候補だけを取り下げ済みにしない（知識が出続けるため）
    if (Number(knowledge.changes) !== 1) return { ok: false, error: "not_approved" };
    const r = db
      .prepare("UPDATE share_candidates SET status = 'withdrawn', withdrawn_at = ? WHERE id = ? AND status = 'approved'")
      .run(now, row.id);
    if (Number(r.changes) !== 1) return { ok: false, error: "not_approved" };
    return { ok: true, candidate: toCandidate(getRow(row.id, db)!, db) };
  });
}

/** 本人の候補を id の降順で全件返す */
export function listShareRecords(userId: string, db: DatabaseSync = getDb()): ShareCandidate[] {
  const rows = db.prepare("SELECT * FROM share_candidates WHERE user_id = ? ORDER BY id DESC").all(userId) as unknown as ShareRow[];
  return rows.map((row) => toCandidate(row, db));
}
