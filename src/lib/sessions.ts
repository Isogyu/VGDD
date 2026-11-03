// 作業セッションのデータアクセス（M1 開始・M3 終了・M1-4 のヒント）
// サーバー側からだけ import する。

import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";
import { nowJst, diffMinutes } from "./time";
import { normalizeTaskName } from "./commands";

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

  const known = opts.known?.trim();
  const unknown = opts.unknown?.trim();
  if (known) addNote({ sessionId: session.id, userId: opts.userId, body: known, kind: "known" }, db, startedAt);
  if (unknown) addNote({ sessionId: session.id, userId: opts.userId, body: unknown, kind: "unknown" }, db, startedAt);

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
