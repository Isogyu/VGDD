// AI 整理の実行（M4-1〜M4-5、M10-1 の共通部）。
// provider の出力を固定スキーマで検証し、違反なら違反内容を添えて1回だけやり直す。2回失敗したら失敗として返す（M4-3）。
// 結果は session_summaries に保存する（途中整理は保存しない：partial）。

import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";
import { getSession, listNotes, type Note } from "./sessions";
import { validateAndMap, parseStoredSummary, type Summary } from "./summary-schema";
import { getProvider, ProviderUnavailableError, type SummaryProvider } from "./ai";
import { nowJst } from "./time";

export const MAX_ATTEMPTS = 2;
/** 追加の質問への答えによるやり直しは1回まで（M4-5） */
export const MAX_RERUNS = 1;

export type SummarizeResult =
  | { ok: true; summary: Summary; model: string; attempts: number; summaryId: number | null }
  | { ok: false; reason: "provider_unavailable" | "schema_violation" | "no_notes" | "rerun_limit"; message: string; errors?: string[]; attempts: number };

export interface SummarizeOptions {
  /** 整理から除くメモ ID（要確認のメモを本人が除いた場合） */
  excludeNoteIds?: number[];
  /** 途中整理（M10-1）。保存しない */
  partial?: boolean;
  provider?: SummaryProvider;
}

/** セッションの最新の整理結果 */
export function getLatestSummary(sessionId: number, db: DatabaseSync = getDb()): { id: number; summary: Summary; model: string | null; created_at: string } | null {
  const row = db
    .prepare("SELECT id, json, model, created_at FROM session_summaries WHERE session_id = ? ORDER BY id DESC LIMIT 1")
    .get(sessionId) as { id: number; json: string; model: string | null; created_at: string } | undefined;
  if (!row) return null;
  const summary = parseStoredSummary(row.json);
  return summary ? { id: row.id, summary, model: row.model, created_at: row.created_at } : null;
}

export function countSummaries(sessionId: number, db: DatabaseSync = getDb()): number {
  return (db.prepare("SELECT count(*) c FROM session_summaries WHERE session_id = ?").get(sessionId) as { c: number }).c;
}

export async function summarizeSession(
  sessionId: number,
  opts: SummarizeOptions = {},
  db: DatabaseSync = getDb(),
): Promise<SummarizeResult> {
  const session = getSession(sessionId, db);
  if (!session) return { ok: false, reason: "no_notes", message: "セッションが見つかりません", attempts: 0 };
  const partial = !!opts.partial;
  if (!partial && countSummaries(sessionId, db) > MAX_RERUNS) {
    return { ok: false, reason: "rerun_limit", message: "やり直しは1回までです", attempts: 0 };
  }
  const exclude = new Set(opts.excludeNoteIds ?? []);
  const notes: Note[] = listNotes(sessionId, db).filter((n) => !exclude.has(n.id));
  if (notes.length === 0) {
    return { ok: false, reason: "no_notes", message: "整理するメモがありません", attempts: 0 };
  }
  const noteIds = notes.map((n) => n.id);

  let provider: SummaryProvider;
  try {
    provider = opts.provider ?? getProvider();
  } catch (e) {
    return { ok: false, reason: "provider_unavailable", message: e instanceof Error ? e.message : String(e), attempts: 0 };
  }

  let previousErrors: string[] | undefined;
  let model: string = provider.name;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw: string;
    try {
      const out = await provider.summarize({
        taskName: session.task_name,
        notes: notes.map((n) => ({ id: n.id, body: n.body, kind: n.kind, created_at: n.created_at })),
        partial,
        previousErrors,
      });
      raw = out.raw;
      model = out.model;
    } catch (e) {
      if (e instanceof ProviderUnavailableError) {
        return { ok: false, reason: "provider_unavailable", message: e.message, attempts: attempt };
      }
      return {
        ok: false,
        reason: "provider_unavailable",
        message: `AI の呼び出しに失敗しました：${e instanceof Error ? e.message : String(e)}`,
        attempts: attempt,
      };
    }
    const v = validateAndMap(raw, noteIds);
    if (v.ok) {
      let summaryId: number | null = null;
      if (!partial) {
        const r = db
          .prepare("INSERT INTO session_summaries (session_id, json, model, created_at) VALUES (?, ?, ?, ?)")
          .run(sessionId, JSON.stringify(v.summary), model, nowJst());
        summaryId = Number(r.lastInsertRowid);
      }
      return { ok: true, summary: v.summary, model, attempts: attempt, summaryId };
    }
    previousErrors = v.errors;
  }
  return {
    ok: false,
    reason: "schema_violation",
    message: "整理できませんでした（AI の出力が決められた形に2回とも合いませんでした）",
    errors: previousErrors,
    attempts: MAX_ATTEMPTS,
  };
}
