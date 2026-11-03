// GET /api/sessions/[id]?userId=…：S-2 用。セッション・メモ・最新の整理結果・前回との差・要確認メモ・やり直し可否
import { NextResponse } from "next/server";
import { getUser } from "@/lib/db";
import { getSession, listNotes, getHistoryItem } from "@/lib/sessions";
import { getLatestSummary, countSummaries, MAX_RERUNS } from "@/lib/summarize";
import { resolveProviderName } from "@/lib/ai";

export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  const { id } = await ctx.params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!getUser(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const session = getSession(sessionId);
  if (!session) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  if (session.user_id !== userId) return NextResponse.json({ error: "not_your_session" }, { status: 403 });

  const notes = listNotes(sessionId);
  const latest = getLatestSummary(sessionId);
  const count = countSummaries(sessionId);
  return NextResponse.json({
    session,
    notes,
    history: getHistoryItem(sessionId) ?? null,
    summary: latest,
    flaggedNoteIds: notes.filter((n) => n.flags_json).map((n) => n.id),
    rerunsLeft: Math.max(0, MAX_RERUNS + 1 - count),
    provider: resolveProviderName(),
  });
}
