// POST /api/sessions/[id]/checkin：進行中の作業の「いまの理解を整理」（M10-1）
// 入力：{ userId, excludeNoteIds?: number[], confirmFlagged?: boolean, answers?: [{ question, text }] }
// answers があれば先にメモ（kind: answer）として保存してから途中整理（partial: true）を行う。
// 途中整理は session_summaries に保存しないので、やり直しの回数（MAX_RERUNS）は数えない。作業は終了しない。
// 要確認のメモが（除外されずに）残っていて confirmFlagged でなければ、送信せず 409 { error: 'flagged_notes', flagged } を返す（M6-1）
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/db";
import { getSession, listNotes, addNote, type Note } from "@/lib/sessions";
import { summarizeSession } from "@/lib/summarize";
import { detectSensitive } from "@/lib/sensitive";
import { normalizeText } from "@/lib/commands";
import { groupUnderstanding } from "@/lib/understanding";

const Body = z.object({
  userId: z.string().min(1),
  excludeNoteIds: z.array(z.number().int()).max(500).optional(),
  confirmFlagged: z.boolean().optional(),
  answers: z
    .array(z.object({ question: z.string().min(1).max(300), text: z.string().min(1).max(1000) }))
    .max(2)
    .optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/checkin">) {
  const { id } = await ctx.params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { userId, excludeNoteIds = [], confirmFlagged = false, answers } = parsed.data;
  if (!getUser(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const session = getSession(sessionId);
  if (!session) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  if (session.user_id !== userId) return NextResponse.json({ error: "not_your_session" }, { status: 403 });
  if (session.status !== "active") return NextResponse.json({ error: "session_ended" }, { status: 409 });

  // 追加の質問への答えを先にメモとして保存する（根拠として参照できるようにする）
  const savedNotes: Note[] = [];
  if (answers && answers.length > 0) {
    for (const a of answers) {
      const text = normalizeText(a.text);
      if (!text) continue;
      const body = `Q: ${a.question}\nA: ${text}`;
      const flags = detectSensitive(text);
      savedNotes.push(addNote({ sessionId, userId, body, kind: "answer", flagsJson: flags.length ? JSON.stringify(flags) : null }));
    }
    if (savedNotes.length === 0) return NextResponse.json({ error: "no_valid_answers" }, { status: 400 });
  }

  const exclude = new Set(excludeNoteIds);
  const flagged = listNotes(sessionId).filter((n) => n.flags_json && !exclude.has(n.id));
  if (flagged.length > 0 && !confirmFlagged) {
    return NextResponse.json({ error: "flagged_notes", flagged }, { status: 409 });
  }

  // 途中整理：保存しない（partial: true）
  const result = await summarizeSession(sessionId, { partial: true, excludeNoteIds });
  if (!result.ok) {
    const status = result.reason === "provider_unavailable" ? 503 : 422;
    return NextResponse.json({ error: result.reason, message: result.message }, { status });
  }
  return NextResponse.json({
    understanding: groupUnderstanding(result.summary),
    summary: result.summary,
    model: result.model,
    attempts: result.attempts,
    savedNotes,
  });
}
