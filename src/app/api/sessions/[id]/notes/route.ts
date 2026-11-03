// POST /api/sessions/[id]/notes：作業中のメモを追加する（M2-1）。保存のたびに機密検査（M2-3・M6-1）を行い、
// 結果を flags_json に残して返す。保存は止めない（警告を出し、AI への送信（M4）の前に本人が判断する）。
// 入力：{ userId, body }　出力：201 { note, flags, warning }
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/db";
import { getSession, addNote } from "@/lib/sessions";
import { detectSensitive, describeFlags } from "@/lib/sensitive";
import { normalizeText } from "@/lib/commands";

const Body = z.object({
  userId: z.string().min(1),
  body: z.string().min(1).max(2000),
});

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/notes">) {
  const { id } = await ctx.params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }
  const { userId } = parsed.data;
  const body = normalizeText(parsed.data.body);
  if (!body) return NextResponse.json({ error: "body_empty" }, { status: 400 });
  if (!getUser(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const session = getSession(sessionId);
  if (!session) return NextResponse.json({ error: "session_not_found" }, { status: 404 });
  if (session.user_id !== userId) return NextResponse.json({ error: "not_your_session" }, { status: 403 });
  if (session.status !== "active") return NextResponse.json({ error: "session_ended" }, { status: 409 });

  const flags = detectSensitive(body);
  const note = addNote({ sessionId, userId, body, kind: "memo", flagsJson: flags.length ? JSON.stringify(flags) : null });
  return NextResponse.json({ note, flags, warning: describeFlags(flags) || null }, { status: 201 });
}
