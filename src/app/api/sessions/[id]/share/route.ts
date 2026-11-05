// POST /api/sessions/[id]/share：作業の整理結果から共有候補を作る（M9-1）
// 入力：{ userId }。本文の出どころは整理結果だけ（notes の表は読まない）。本文は console に出さない
// 同じ版の未決定の候補がすでにあれば、作らずにそれを返す（200）。新しく作ったら 201
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/db";
import { createShareCandidate, type CreateShareError } from "@/lib/sharing";

const Body = z.object({
  userId: z.string().min(1),
});

const ERROR_STATUS: Record<CreateShareError, number> = {
  session_not_found: 404,
  not_your_session: 403,
  session_active: 409,
  no_summary: 409,
  nothing_to_share: 422,
};

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/share">) {
  const { id } = await ctx.params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { userId } = parsed.data;
  if (!getUser(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const result = createShareCandidate(sessionId, userId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: ERROR_STATUS[result.error] });
  return NextResponse.json({ candidate: result.candidate }, { status: result.created ? 201 : 200 });
}
