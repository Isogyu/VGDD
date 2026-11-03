// デモ用 fixture の採取（M4-4）。実 API（Sonnet 5.5）に seed の合成ログを投げ、出力を fixture に保存する。
// オーナーが開発サーバーで npm run demo:capture を実行する（POST /api/dev/capture-fixtures）。送るのは合成データだけ。
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../db";
import { listNotes, type WorkSession } from "../sessions";
import { validateAndMap } from "../summary-schema";
import { ClaudeProvider } from "./claude";
import { saveFixture, type Fixture } from "./demo";
import { nowJst } from "../time";
import type { SummaryProvider } from "./provider";

export interface CaptureResult {
  task_name: string;
  partial: boolean;
  ok: boolean;
  path?: string;
  model?: string;
  attempts: number;
  errors?: string[];
}

/** 新人A の、その作業名の最新の終了済みセッション（seed のもの） */
function latestEndedSession(taskName: string, db: DatabaseSync): WorkSession | undefined {
  return db
    .prepare(
      "SELECT id, user_id, task_name, started_at, ended_at, duration_min, status FROM work_sessions WHERE user_id = 'newcomer_a' AND task_name = ? AND status = 'ended' ORDER BY ended_at DESC, id DESC LIMIT 1",
    )
    .get(taskName) as unknown as WorkSession | undefined;
}

export async function captureFixtures(
  taskNames: string[],
  opts: { partial?: boolean; provider?: SummaryProvider; dir?: string } = {},
  db: DatabaseSync = getDb(),
): Promise<CaptureResult[]> {
  const provider = opts.provider ?? new ClaudeProvider();
  const partial = !!opts.partial;
  const results: CaptureResult[] = [];
  for (const taskName of taskNames) {
    const s = latestEndedSession(taskName, db);
    if (!s) {
      results.push({ task_name: taskName, partial, ok: false, attempts: 0, errors: ["seed の終了済みセッションがない"] });
      continue;
    }
    // 途中整理の fixture は、メモの前半（3件まで）で採る
    const all = listNotes(s.id, db);
    const notes = partial ? all.slice(0, Math.min(3, all.length)) : all;
    const noteIds = notes.map((n) => n.id);
    let previousErrors: string[] | undefined;
    let done = false;
    for (let attempt = 1; attempt <= 2 && !done; attempt++) {
      const out = await provider.summarize({
        taskName,
        notes: notes.map((n) => ({ id: n.id, body: n.body, kind: n.kind, created_at: n.created_at })),
        partial,
        previousErrors,
      });
      const v = validateAndMap(out.raw, noteIds);
      if (v.ok) {
        const fx: Fixture = {
          task_name: taskName,
          partial,
          captured_at: nowJst(),
          model: out.model,
          note_count: notes.length,
          raw: out.raw,
          source: "claude",
        };
        const path = saveFixture(fx, opts.dir);
        results.push({ task_name: taskName, partial, ok: true, path, model: out.model, attempts: attempt });
        done = true;
      } else {
        previousErrors = v.errors;
        if (attempt === 2) results.push({ task_name: taskName, partial, ok: false, attempts: 2, errors: v.errors });
      }
    }
  }
  return results;
}
