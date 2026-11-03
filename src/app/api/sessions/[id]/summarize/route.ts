// POST /api/sessions/[id]/summarize：AI 整理を実行して保存（M4-1〜M4-4）
// 入力：{ userId, excludeNoteIds?: number[], confirmFlagged?: boolean }
// 要確認のメモが（除外されずに）残っていて confirmFlagged でなければ、送信せず 409 { error: 'flagged_notes', flagged } を返す
// （M6-1「送信前の警告」。本人が「このまま送る／除いて送る／やめる」を選ぶ）
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/db";
import { getSession, listNotes } from "@/lib/sessions";
import { summarizeSession } from "@/lib/summarize";

const Body = z.object({
  userId: z.string().min(1),
  excludeNoteIds: z.array(z.number().int()).max(500).optional(),
  confirmFlagged: z.boolean().optional(),
});

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/summarize">) {
  const { id } = await ctx.params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { userId, excludeNoteIds = [], confirmFlagged = false } = parsed.data;
  if (!getUser(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const session = getSession(sessionId);
  if (!session) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  if (session.user_id !== userId) return NextResponse.json({ error: "not_your_session" }, { status: 403 });
  if (session.status !== "ended") return NextResponse.json({ error: "session_active" }, { status: 409 });

  const exclude = new Set(excludeNoteIds);
  const flagged = listNotes(sessionId).filter((n) => n.flags_json && !exclude.has(n.id));
  if (flagged.length > 0 && !confirmFlagged) {
    return NextResponse.json({ error: "flagged_notes", flagged }, { status: 409 });
  }

  const result = await summarizeSession(sessionId, { excludeNoteIds });
  if (!result.ok) {
    const status = result.reason === "rerun_limit" ? 409 : result.reason === "provider_unavailable" ? 503 : 422;
    return NextResponse.json({ error: result.reason, message: result.message, errors: result.errors ?? null }, { status });
  }
  return NextResponse.json({ summary: result.summary, model: result.model, attempts: result.attempts, summaryId: result.summaryId });
}
