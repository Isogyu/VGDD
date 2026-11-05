// GET /api/knowledge/team：チームの知恵（S-4、T-015）。本人が承認し、取り下げられていない共有を作業名ごとに返す。
// 引数は取らない。例外の本文は応答にもログにも出さない。
import { NextResponse } from "next/server";
import { listTeamKnowledge } from "@/lib/team-knowledge";

export async function GET() {
  try {
    return NextResponse.json({ groups: listTeamKnowledge() });
  } catch {
    return NextResponse.json({ error: "knowledge_unavailable" }, { status: 500 });
  }
}
