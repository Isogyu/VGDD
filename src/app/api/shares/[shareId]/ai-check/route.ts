// POST /api/shares/[shareId]/ai-check：共有候補の本文を AI でも確かめる（M6-2。T-017）
// 入力：{ userId }。決定論的な検出（deterministic）と AI の候補（ai）を別の配列で返す。AI は決定論的な検出を取り消さない。
// 他人の候補・決定済みの候補・ない候補では本文も検出結果も返さない。DB には書かない。本文は console に出さない
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/db";
import { AI_SENSITIVE_NOTICE, checkShareWithAi, type CheckShareError } from "@/lib/ai-sensitive";

const Body = z.object({
  userId: z.string().min(1),
});

const SHARE_ERROR_STATUS: Record<CheckShareError, number> = {
  share_not_found: 404,
  not_your_share: 403,
  already_decided: 409,
};

const CHECK_ERROR_STATUS = {
  provider_unavailable: 503,
  schema_violation: 422,
  empty_text: 422,
  too_long: 422,
} as const;

export async function POST(req: Request, ctx: RouteContext<"/api/shares/[shareId]/ai-check">) {
  const { shareId } = await ctx.params;
  const candidateId = Number(shareId);
  if (!Number.isInteger(candidateId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { userId } = parsed.data;
  if (!getUser(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const result = await checkShareWithAi(candidateId, userId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: SHARE_ERROR_STATUS[result.error] });
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, message: result.message, deterministic: result.deterministic },
      { status: CHECK_ERROR_STATUS[result.reason] },
    );
  }
  return NextResponse.json({
    deterministic: result.deterministic,
    ai: result.ai,
    model: result.model,
    notice: AI_SENSITIVE_NOTICE,
  });
}
