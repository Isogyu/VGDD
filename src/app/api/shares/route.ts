// GET /api/shares?userId=…：本人の共有の記録の一覧（M9-5）
import { NextResponse } from "next/server";
import { getUser } from "@/lib/db";
import { listShareRecords } from "@/lib/sharing";

export async function GET(req: Request) {
  const userId = new URL(req.url).searchParams.get("userId") ?? "";
  if (!userId || !getUser(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  return NextResponse.json({ records: listShareRecords(userId) });
}
