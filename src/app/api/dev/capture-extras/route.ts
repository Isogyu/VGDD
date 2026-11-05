// POST /api/dev/capture-extras：デモ用の手順書の原案・AI の検出の fixture を実 API で採取して保存する（T-020）
// development のみ、要 ANTHROPIC_API_KEY。入力：{ kind?: "procedure" | "sensitive" | "all" }（省略は all）
// 材料はメモリの DB に入れた seed の合成データだけ（今の DB は使わない）。本文・例外の本文は応答にもログにも出さない。
import { NextResponse } from "next/server";
import { captureDemoExtras, checkCaptureRequest } from "@/lib/ai/capture-extras";
import { hasApiKey } from "@/lib/ai";

export async function POST(req: Request) {
  // body は JSON として読んだ値。読めなければ undefined（判定は checkCaptureRequest で 404 → 403 → 415 → 400 の順）
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    body = undefined;
  }
  const check = checkCaptureRequest({
    nodeEnv: process.env.NODE_ENV,
    origin: req.headers.get("origin"),
    contentType: req.headers.get("content-type"),
    body,
  });
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  if (!hasApiKey()) return NextResponse.json({ error: "no_api_key" }, { status: 503 });
  try {
    const { ok, results } = await captureDemoExtras(check.kind);
    return NextResponse.json({ ok, results });
  } catch {
    // 例外の本文（本文や API の応答を含みうる）は応答に入れない
    return NextResponse.json({ ok: false, error: "capture_failed" }, { status: 500 });
  }
}
