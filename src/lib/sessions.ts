// 作業セッションのデータアクセス（M1 開始・M3 終了・M1-4 のヒント）
// サーバー側からだけ import する。

import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";
import { nowJst, diffMinutes } from "./time";
import { normalizeTaskName } from "./commands";
import { detectSensitive } from "./sensitive";
import { parseStoredSummary, itemStatus, type ItemStatus, type SummaryItem } from "./summary-schema";

export interface WorkSession {
  id: number;
  user_id: string;
  task_name: string;
  started_at: string;
  ended_at: string | null;
  duration_min: number | null;
  status: "active" | "ended";
}

export type NoteKind = "memo" | "known" | "unknown" | "answer";
export interface Note {
  id: number;
  session_id: number;
  user_id: string;
  body: string;
  kind: NoteKind;
  created_at: string;
  flags_json: string | null;
}

/** M1-4 の表示に使うヒント */
export interface KnowledgeHints {
  /** ①自分の過去の記録の「つまずき」（M4 の整理結果から） */
  pastStruggles: { session_id: number; started_at: string; text: string }[];
  /** ②チームの承認済み知識（M9 で承認されたもの） */
  teamKnowledge: { id: number; display_name: string; approved_at: string; text: string }[];
}

const SESSION_COLS = "id, user_id, task_name, started_at, ended_at, duration_min, status";

export function getActiveSession(userId: string, db: DatabaseSync = getDb()): WorkSession | undefined {
  return db
    .prepare(`SELECT ${SESSION_COLS} FROM work_sessions WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1`)
    .get(userId) as unknown as WorkSession | undefined;
}

export function getSession(id: number, db: DatabaseSync = getDb()): WorkSession | undefined {
  return db.prepare(`SELECT ${SESSION_COLS} FROM work_sessions WHERE id = ?`).get(id) as unknown as
    | WorkSession
    | undefined;
}

/** 作業終了（M3）。所要時間（分）を記録する。force 開始のときにも使う */
export function endSession(sessionId: number, db: DatabaseSync = getDb(), endedAt: string = nowJst()): WorkSession {
  const s = getSession(sessionId, db);
  if (!s) throw new Error(`session not found: ${sessionId}`);
  if (s.status === "ended") return s;
  const duration = diffMinutes(s.started_at, endedAt);
  db.prepare("UPDATE work_sessions SET ended_at = ?, duration_min = ?, status = 'ended' WHERE id = ?").run(
    endedAt,
    duration,
    sessionId,
  );
  return getSession(sessionId, db)!;
}

export function addNote(
  opts: { sessionId: number; userId: string; body: string; kind?: NoteKind; flagsJson?: string | null },
  db: DatabaseSync = getDb(),
  createdAt: string = nowJst(),
): Note {
  const r = db
    .prepare("INSERT INTO notes (session_id, user_id, body, kind, created_at, flags_json) VALUES (?, ?, ?, ?, ?, ?)")
    .run(opts.sessionId, opts.userId, opts.body, opts.kind ?? "memo", createdAt, opts.flagsJson ?? null);
  return db.prepare("SELECT * FROM notes WHERE id = ?").get(Number(r.lastInsertRowid)) as unknown as Note;
}

export function listNotes(sessionId: number, db: DatabaseSync = getDb()): Note[] {
  return db.prepare("SELECT * FROM notes WHERE session_id = ? ORDER BY id").all(sessionId) as unknown as Note[];
}

/**
 * メモの削除（本人のメモだけ。07 §3「本人が削除できる」）。
 * 誤って入れた機密情報を AI に送る前に消す用途。削除できたら true、本人のものでない・存在しないなら false
 */
export function deleteNote(noteId: number, userId: string, db: DatabaseSync = getDb()): boolean {
  const r = db.prepare("DELETE FROM notes WHERE id = ? AND user_id = ?").run(noteId, userId);
  return Number(r.changes) === 1;
}

/** 履歴の1行：前回（本人の、同じ作業名の、直前に終了した作業）との所要時間の差を含む */
export interface HistoryItem extends WorkSession {
  /** 本人の同じ作業名の前回の所要時間（分）。前回がなければ null */
  prev_duration_min: number | null;
  /** 今回 − 前回（分）。負なら早くなった。前回がなければ null */
  delta_min: number | null;
}

/**
 * 終了した作業の一覧（新しい順）。右側の履歴とデモの「半日 → 30分」の表示に使う。
 * 前回との差は**本人の同じ作業名の前回**とだけ比べる。他の人との比較は出さない（人事評価に使わない方針、M9-4）。
 */
export function listHistory(userId: string, db: DatabaseSync = getDb(), limit = 5): HistoryItem[] {
  return db
    .prepare(
      `SELECT w.id, w.user_id, w.task_name, w.started_at, w.ended_at, w.duration_min, w.status,
              p.duration_min AS prev_duration_min,
              CASE WHEN p.duration_min IS NULL THEN NULL ELSE w.duration_min - p.duration_min END AS delta_min
         FROM work_sessions w
         LEFT JOIN work_sessions p
           ON p.id = (SELECT id FROM work_sessions q
                       WHERE q.user_id = w.user_id AND q.task_name = w.task_name AND q.status = 'ended'
                         AND (q.ended_at < w.ended_at OR (q.ended_at = w.ended_at AND q.id < w.id))
                       ORDER BY q.ended_at DESC, q.id DESC LIMIT 1)
        WHERE w.user_id = ? AND w.status = 'ended'
        ORDER BY w.ended_at DESC, w.id DESC LIMIT ?`,
    )
    .all(userId, limit) as unknown as HistoryItem[];
}

/** 終了直後の表示用：この作業の前回（本人・同じ作業名）との差 */
export function getHistoryItem(sessionId: number, db: DatabaseSync = getDb()): HistoryItem | undefined {
  const s = getSession(sessionId, db);
  if (!s || s.status !== "ended") return undefined;
  return listHistory(s.user_id, db, 1000).find((h) => h.id === sessionId);
}

/** S-2 の「前回との比較」（T-001）：前回の整理結果のうち、つまずきと学びだけ */
export interface PreviousSummary {
  session_id: number;
  task_name: string;
  ended_at: string;
  struggle: { text: string; status: ItemStatus };
  learning: { text: string; status: ItemStatus };
}

/** 保存済みの項目を「本文と状態」に直す。項目が欠けている古いデータは「記録なし」として扱う */
function toPreviousItem(item: SummaryItem | undefined): { text: string; status: ItemStatus } {
  if (!item || typeof item !== "object" || typeof item.text !== "string") return { text: "", status: "none" };
  const normalized: SummaryItem = {
    ...item,
    evidence_note_ids: Array.isArray(item.evidence_note_ids) ? item.evidence_note_ids : [],
  };
  return { text: item.text, status: itemStatus(normalized) };
}

/**
 * この作業の「前回」の整理結果（つまずき・学び）を返す。
 * 前回＝本人（同じ user_id）・同じ作業名・終了済みで、ended_at がこの作業の started_at より前のうち最新のもの
 * （listHistory の「前回」と同じ並び順：ended_at の新しい順、同時刻なら id の大きい順）。
 * 他の人の記録は使わない（M9-4）。前回がない、または前回に整理結果がない・読めないときは null。
 */
export function getPreviousSummary(sessionId: number, db: DatabaseSync = getDb()): PreviousSummary | null {
  const s = getSession(sessionId, db);
  if (!s) return null;
  const prev = db
    .prepare(
      `SELECT id, task_name, ended_at FROM work_sessions
        WHERE user_id = ? AND task_name = ? AND status = 'ended' AND id <> ?
          AND ended_at IS NOT NULL AND ended_at < ?
        ORDER BY ended_at DESC, id DESC LIMIT 1`,
    )
    .get(s.user_id, s.task_name, s.id, s.started_at) as { id: number; task_name: string; ended_at: string } | undefined;
  if (!prev) return null;

  // 整理結果は最新の1件（getLatestSummary と同じく id の大きいもの）
  const row = db
    .prepare("SELECT json FROM session_summaries WHERE session_id = ? ORDER BY id DESC LIMIT 1")
    .get(prev.id) as { json: string } | undefined;
  if (!row) return null;
  const summary = parseStoredSummary(row.json);
  if (!summary) return null;

  return {
    session_id: prev.id,
    task_name: prev.task_name,
    ended_at: prev.ended_at,
    struggle: toPreviousItem(summary.struggle),
    learning: toPreviousItem(summary.learning),
  };
}

export type StartResult =
  | { ok: true; session: WorkSession; endedPrevious: WorkSession | null }
  | { ok: false; reason: "active_exists"; active: WorkSession };

/**
 * 作業開始（M1-1・M1-3）。
 * 進行中の作業があれば、force でない限り開始せず active_exists を返す（画面側で確認を出す）。
 * force のときは進行中を終了してから開始する。
 * known / unknown（D-40⑥：開始時の「分かっていること／分からないこと」）があればメモとして保存する。
 */
export function startSession(
  opts: { userId: string; taskName: string; force?: boolean; known?: string; unknown?: string },
  db: DatabaseSync = getDb(),
  startedAt: string = nowJst(),
): StartResult {
  const taskName = normalizeTaskName(opts.taskName);
  if (!taskName) throw new Error("taskName is empty");

  const active = getActiveSession(opts.userId, db);
  let endedPrevious: WorkSession | null = null;
  if (active) {
    if (!opts.force) return { ok: false, reason: "active_exists", active };
    endedPrevious = endSession(active.id, db, startedAt);
  }

  const r = db
    .prepare("INSERT INTO work_sessions (user_id, task_name, started_at, status) VALUES (?, ?, ?, 'active')")
    .run(opts.userId, taskName, startedAt);
  const session = getSession(Number(r.lastInsertRowid), db)!;

  // 開始時の「分かっていること／分からないこと」も、他のメモと同じく機密検査を通す（M2-3・M6-1。司法の指摘 T-M1M3）
  const known = opts.known?.trim();
  const unknown = opts.unknown?.trim();
  const flagsOf = (body: string) => {
    const flags = detectSensitive(body);
    return flags.length ? JSON.stringify(flags) : null;
  };
  if (known) addNote({ sessionId: session.id, userId: opts.userId, body: known, kind: "known", flagsJson: flagsOf(known) }, db, startedAt);
  if (unknown) addNote({ sessionId: session.id, userId: opts.userId, body: unknown, kind: "unknown", flagsJson: flagsOf(unknown) }, db, startedAt);

  return { ok: true, session, endedPrevious };
}

/** M4 の整理結果 JSON のうち、M1-4 が読む最小の形（正式なスキーマは M4 で定義する） */
interface SummaryLike {
  struggle?: { text?: string } | string;
}

function struggleText(json: string): string | null {
  try {
    const s = JSON.parse(json) as SummaryLike;
    const v = s.struggle;
    if (!v) return null;
    if (typeof v === "string") return v;
    return v.text ?? null;
  } catch {
    return null;
  }
}

/**
 * M1-4：同じ作業名（完全一致）のヒントを最大 limit 件ずつ返す。意味検索はしない。
 * ①自分の過去の記録の「つまずき」 ②チームの承認済み知識（取り下げ済みは除く）
 */
export function getKnowledgeHints(
  userId: string,
  taskName: string,
  db: DatabaseSync = getDb(),
  limit = 2,
): KnowledgeHints {
  const name = normalizeTaskName(taskName);
  const summaries = db
    .prepare(
      `SELECT s.session_id, w.started_at, s.json
         FROM session_summaries s JOIN work_sessions w ON w.id = s.session_id
        WHERE w.user_id = ? AND w.task_name = ? AND w.status = 'ended'
        ORDER BY s.created_at DESC, s.id DESC LIMIT ?`,
    )
    .all(userId, name, limit * 3) as unknown as { session_id: number; started_at: string; json: string }[];
  const pastStruggles = summaries
    .map((r) => ({ session_id: r.session_id, started_at: r.started_at, text: struggleText(r.json) }))
    .filter((r): r is { session_id: number; started_at: string; text: string } => !!r.text)
    .slice(0, limit);

  const teamKnowledge = db
    .prepare(
      `SELECT k.id, u.display_name, k.approved_at, k.body AS text
         FROM shared_knowledge k JOIN users u ON u.id = k.user_id
        WHERE k.task_name = ? AND k.withdrawn_at IS NULL
        ORDER BY k.approved_at DESC, k.id DESC LIMIT ?`,
    )
    .all(name, limit) as unknown as KnowledgeHints["teamKnowledge"];

  return { pastStruggles, teamKnowledge };
}
