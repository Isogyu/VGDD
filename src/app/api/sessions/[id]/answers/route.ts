// POST /api/sessions/[id]/answers：追加の質問への答えを保存し、整理をやり直す（M4-5。やり直しは1回まで）
// 入力：{ userId, answers: [{ questionId, text }] }
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/db";
import { getSession, addNote } from "@/lib/sessions";
import { summarizeSession, getLatestSummary, countSummaries, MAX_RERUNS } from "@/lib/summarize";
import { detectSensitive } from "@/lib/sensitive";
import { normalizeText } from "@/lib/commands";

const Body = z.object({
  userId: z.string().min(1),
  answers: z.array(z.object({ questionId: z.string().min(1), text: z.string().min(1).max(1000) })).min(1).max(2),
  excludeNoteIds: z.array(z.number().int()).max(500).optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/answers">) {
  const { id } = await ctx.params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { userId, answers, excludeNoteIds = [] } = parsed.data;
  if (!getUser(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const session = getSession(sessionId);
  if (!session) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  if (session.user_id !== userId) return NextResponse.json({ error: "not_your_session" }, { status: 403 });
  const latest = getLatestSummary(sessionId);
  if (!latest) return NextResponse.json({ error: "no_summary" }, { status: 409 });
  if (countSummaries(sessionId) > MAX_RERUNS) return NextResponse.json({ error: "rerun_limit" }, { status: 409 });

  // 質問文と答えを1つのメモにして保存（根拠として参照できるようにする）
  const questionById = new Map(latest.summary.questions.map((q) => [q.id, q]));
  const saved = [];
  for (const a of answers) {
    const q = questionById.get(a.questionId);
    const text = normalizeText(a.text);
    if (!q || !text) continue;
    const body = `Q: ${q.text}\nA: ${text}`;
    const flags = detectSensitive(text);
    saved.push(addNote({ sessionId, userId, body, kind: "answer", flagsJson: flags.length ? JSON.stringify(flags) : null }));
  }
  if (saved.length === 0) return NextResponse.json({ error: "no_valid_answers" }, { status: 400 });

  const result = await summarizeSession(sessionId, { excludeNoteIds });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason, message: result.message, savedNotes: saved }, { status: result.reason === "rerun_limit" ? 409 : 422 });
  }
  return NextResponse.json({ summary: result.summary, model: result.model, attempts: result.attempts, savedNotes: saved });
}
