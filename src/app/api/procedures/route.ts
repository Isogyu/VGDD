// POST /api/procedures：承認済みの共有から手順書の原案と判断のポイントを作る（M5 の裏側。T-012）
// 入力：{ taskName: string(1〜100) }。保存はしない（呼ぶたびに作る）。
// 共有の本文・例外の本文はログにも応答のエラーにも出さない。
import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeTaskName } from "@/lib/commands";
import { generateProcedure, PROCEDURE_NOTICE } from "@/lib/procedure";

const Body = z.object({
  taskName: z.string().min(1).max(100),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  // 入力の値は応答に入れない
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const taskName = normalizeTaskName(parsed.data.taskName);
  if (!taskName) return NextResponse.json({ error: "task_name_empty" }, { status: 400 });

  const result = await generateProcedure(taskName);
  if (!result.ok) {
    switch (result.reason) {
      case "insufficient_records":
      case "too_large":
        return NextResponse.json({ error: result.reason, message: result.message, count: result.count }, { status: 422 });
      case "provider_unavailable":
        return NextResponse.json({ error: result.reason, message: result.message }, { status: 503 });
      case "schema_violation":
        return NextResponse.json({ error: result.reason, message: result.message, errors: result.errors ?? [] }, { status: 422 });
      case "sources_changed":
        return NextResponse.json({ error: result.reason, message: result.message }, { status: 409 });
    }
  }
  return NextResponse.json({
    procedure: result.procedure,
    model: result.model,
    attempts: result.attempts,
    notice: PROCEDURE_NOTICE,
  });
}
