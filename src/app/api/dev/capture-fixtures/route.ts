// POST /api/dev/capture-fixtures：デモ用 fixture を実 API で採取して保存する（development のみ、要 ANTHROPIC_API_KEY）
// 入力：{ tasks?: string[], partial?: boolean }　既定は seed の3作業（W1〜W3）の終了後の整理
import { NextResponse } from "next/server";
import { captureFixtures } from "@/lib/ai/capture";
import { hasApiKey } from "@/lib/ai";
import { DEMO_TASKS } from "@/lib/seed";

export async function POST(req: Request) {
  if (process.env.NODE_ENV !== "development") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!hasApiKey()) return NextResponse.json({ error: "no_api_key", message: "ANTHROPIC_API_KEY が .env.local にありません" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { tasks?: string[]; partial?: boolean };
  const tasks = Array.isArray(body.tasks) && body.tasks.length ? body.tasks : DEMO_TASKS.map((t) => t.taskName);
  try {
    const results = await captureFixtures(tasks, { partial: !!body.partial });
    return NextResponse.json({ ok: results.every((r) => r.ok), results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
