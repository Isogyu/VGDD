// POST /api/shares/[shareId]：共有候補の承認・編集して承認・却下・取り下げ（M9-2・M9-3・M9-5）
// 入力：{ userId, action: "approve" | "edit_approve" | "reject" | "withdraw", body?, reason?, confirmFlagged? }
// 本文に要確認の語句があり confirmFlagged でなければ、承認せず 409 { error: 'flagged_body', flags } を返す（M6-1 と同じ考え方）
// 本文は console に出さない
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/db";
import { decideShare, withdrawShare, type DecideShareError, type WithdrawShareError } from "@/lib/sharing";

const Body = z.object({
  userId: z.string().min(1),
  action: z.enum(["approve", "edit_approve", "reject", "withdraw"]),
  body: z.string().max(4000).optional(),
  reason: z.string().max(1000).optional(),
  confirmFlagged: z.boolean().optional(),
});

const ERROR_STATUS: Record<DecideShareError | WithdrawShareError, number> = {
  share_not_found: 404,
  not_your_share: 403,
  already_decided: 409,
  not_approved: 409,
  stale_candidate: 409,
  flagged_body: 409,
  empty_body: 400,
  body_too_long: 400,
  reason_too_long: 400,
};

export async function POST(req: Request, ctx: RouteContext<"/api/shares/[shareId]">) {
  const { shareId } = await ctx.params;
  const candidateId = Number(shareId);
  if (!Number.isInteger(candidateId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { userId, action, body, reason, confirmFlagged } = parsed.data;
  if (!getUser(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const result =
    action === "withdraw"
      ? withdrawShare(candidateId, userId)
      : decideShare(candidateId, userId, { action, body, reason, confirmFlagged });
  if (!result.ok) {
    const flags = "flags" in result ? result.flags : undefined;
    return NextResponse.json(
      result.error === "flagged_body" ? { error: result.error, flags } : { error: result.error },
      { status: ERROR_STATUS[result.error] },
    );
  }
  return NextResponse.json({ candidate: result.candidate });
}
