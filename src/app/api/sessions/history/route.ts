// GET /api/sessions/history?userId=…&limit=5：終了した作業の一覧（新しい順）
import { NextResponse } from "next/server";
import { getUser } from "@/lib/db";
import { listHistory } from "@/lib/sessions";

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const userId = params.get("userId") ?? "";
  const limitRaw = Number(params.get("limit") ?? "5");
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 && limitRaw <= 50 ? limitRaw : 5;
  if (!getUser(userId)) return NextResponse.json({ error: "user_not_found" }, { status: 404 });
  return NextResponse.json({ sessions: listHistory(userId, undefined, limit) });
}
