// GET /api/sessions/[id]/previous?userId=…：S-2 の「前回との比較」（T-001）。
// 本人の同じ作業名の前回の整理結果（つまずき・学び）を返す。判定の順は GET /api/sessions/[id] と同じ。
import { NextResponse } from "next/server";
import { getUser } from "@/lib/db";
import { getSession, getPreviousSummary } from "@/lib/sessions";

export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[id]/previous">) {
  const { id } = await ctx.params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!getUser(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const session = getSession(sessionId);
  if (!session) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  if (session.user_id !== userId) return NextResponse.json({ error: "not_your_session" }, { status: 403 });

  return NextResponse.json({ previous: getPreviousSummary(sessionId) });
}
