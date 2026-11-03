// GET /api/sessions/active?userId=…：進行中の作業と、そのメモ、経過分（M1-1 の表示用）
import { NextResponse } from "next/server";
import { getUser } from "@/lib/db";
import { getActiveSession, listNotes } from "@/lib/sessions";
import { nowJst, diffMinutes } from "@/lib/time";

export async function GET(req: Request) {
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!getUser(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const session = getActiveSession(userId) ?? null;
  if (!session) return NextResponse.json({ session: null, notes: [], elapsedMin: 0, now: nowJst() });
  const now = nowJst();
  return NextResponse.json({
    session,
    notes: listNotes(session.id),
    elapsedMin: diffMinutes(session.started_at, now),
    now,
  });
}
