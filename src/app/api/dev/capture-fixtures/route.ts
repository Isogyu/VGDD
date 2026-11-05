// POST /api/dev/capture-fixtures：デモ用 fixture を実 API で採取して保存する（development のみ、要 ANTHROPIC_API_KEY）
// 入力：{ tasks?: string[], partial?: boolean }　既定（省略か空の配列）は seed の3作業（W1〜W3）の終了後の整理
// 門は capture-extras と同じ（T-023）：404 → 403（Origin あり）→ 415（JSON 以外）→ 400（body が不正）→ 503（キーなし）。
// 材料はメモリの DB に入れた seed の合成データだけ（captureFixtures に db を渡さない）。例外の本文は応答にもログにも出さない。
import { NextResponse } from "next/server";
import { captureFixtures, CaptureFixturesBodySchema } from "@/lib/ai/capture";
import { checkCaptureRequest } from "@/lib/ai/capture-extras";
import { hasApiKey } from "@/lib/ai";
import { DEMO_TASKS } from "@/lib/seed";

export async function POST(req: Request) {
  // checkCaptureRequest は 404・403・415 の判定にだけ使う（body は常に {}。このルートの body は下で別に検証する）
  const check = checkCaptureRequest({
    nodeEnv: process.env.NODE_ENV,
    origin: req.headers.get("origin"),
    contentType: req.headers.get("content-type"),
    body: {},
  });
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  // body は JSON として読んだ値。読めなければ undefined（→ 400）
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    body = undefined;
  }
  const parsed = CaptureFixturesBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  if (!hasApiKey()) return NextResponse.json({ error: "no_api_key" }, { status: 503 });

  const tasks = parsed.data.tasks && parsed.data.tasks.length ? parsed.data.tasks : DEMO_TASKS.map((t) => t.taskName);
  try {
    const results = await captureFixtures(tasks, { partial: !!parsed.data.partial });
    return NextResponse.json({ ok: results.every((r) => r.ok), results });
  } catch {
    // 例外の本文（メモや API の応答を含みうる）は応答に入れない
    return NextResponse.json({ ok: false, error: "capture_failed" }, { status: 500 });
  }
}
