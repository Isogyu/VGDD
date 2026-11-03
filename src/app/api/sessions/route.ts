// POST /api/sessions：作業開始（M1-1・M1-3）
// 入力：{ userId, taskName, force?, known?, unknown? }
// 出力：201 { session, endedPrevious, hints }／409 { error: 'active_exists', active }／400・404
import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/db";
import { startSession, getKnowledgeHints } from "@/lib/sessions";
import { normalizeTaskName } from "@/lib/commands";

const Body = z.object({
  userId: z.string().min(1),
  taskName: z.string().min(1).max(200),
  force: z.boolean().optional(),
  known: z.string().max(2000).optional(),
  unknown: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }
  const { userId, taskName, force, known, unknown } = parsed.data;
  if (!getUser(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  if (!normalizeTaskName(taskName)) return NextResponse.json({ error: "task_name_empty" }, { status: 400 });

  const result = startSession({ userId, taskName, force, known, unknown });
  if (!result.ok) {
    return NextResponse.json({ error: result.reason, active: result.active }, { status: 409 });
  }
  const hints = getKnowledgeHints(userId, result.session.task_name);
  return NextResponse.json(
    { session: result.session, endedPrevious: result.endedPrevious, hints },
    { status: 201 },
  );
}
