// POST /api/sessions/[id]/end：作業終了（M3-1）。終了時刻と所要時間（分）を記録して返す。
// 入力：{ userId, unknown? }　出力：200 { session, noteCount, history }／404・403・409
//   unknown：終了時の「分からなかったこと」（任意、D-40 の既知の未知）。kind=unknown のメモとして保存する
//   history：本人の同じ作業名の前回との差（delta_min）を含む履歴の1行
// M3-2（終了後に自動で AI 整理を開始）は M4 の回でここに接続する。
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/db";
import { getSession, endSession, listNotes, addNote, getHistoryItem } from "@/lib/sessions";
import { normalizeText } from "@/lib/commands";
import { detectSensitive } from "@/lib/sensitive";

const Body = z.object({ userId: z.string().min(1), unknown: z.string().max(2000).optional() });

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/end">) {
  const { id } = await ctx.params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { userId } = parsed.data;
  const unknown = normalizeText(parsed.data.unknown ?? "");
  if (!getUser(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const session = getSession(sessionId);
  if (!session) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  if (session.user_id !== userId) return NextResponse.json({ error: "not_your_session" }, { status: 403 });
  if (session.status !== "active") return NextResponse.json({ error: "already_ended", session }, { status: 409 });

  if (unknown) {
    const flags = detectSensitive(unknown);
    addNote({ sessionId, userId, body: unknown, kind: "unknown", flagsJson: flags.length ? JSON.stringify(flags) : null });
  }
  const ended = endSession(sessionId);
  return NextResponse.json({
    session: ended,
    noteCount: listNotes(sessionId).length,
    history: getHistoryItem(sessionId) ?? null,
  });
}
