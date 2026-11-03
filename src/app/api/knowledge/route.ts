// GET /api/knowledge?userId=…&taskName=…：M1-4 のヒント（自分の過去のつまずき、チームの承認済み知識）
import { NextResponse } from "next/server";
import { getUser } from "@/lib/db";
import { getKnowledgeHints } from "@/lib/sessions";
import { normalizeTaskName } from "@/lib/commands";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const userId = params.get("userId") ?? "";
  const taskName = normalizeTaskName(params.get("taskName") ?? "");
  if (!getUser(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  if (!taskName) return NextResponse.json({ error: "task_name_empty" }, { status: 400 });
  return NextResponse.json({ taskName, hints: getKnowledgeHints(userId, taskName) });
}
