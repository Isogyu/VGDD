// POST /api/dev/seed：デモ用の合成データを入れる（M7 の前倒し・最小分）。
// 開発サーバー（NODE_ENV=development）のときだけ動く。それ以外は存在しないものとして 404 を返す。
// `npm run seed` はこのエンドポイントを叩く（scripts/seed.mjs。Node の fetch は Origin を付けない）。
// 門は capture-extras と同じ（T-023）：404 → 403（Origin あり）→ 415（JSON 以外）→ 400（body が不正）。
// 別のサイトのページからの要求（ブラウザーは POST に Origin を付ける）で開発 DB を消させない。
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkCaptureRequest } from "@/lib/ai/capture-extras";
import { seedDemo } from "@/lib/seed";

const SeedBodySchema = z.object({ reset: z.boolean().optional() }).strict();

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
  const parsed = SeedBodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  // { reset: true } で、デモ用テーブルの全行を消してから入れ直す（npm run seed -- --reset）
  const reset = parsed.data.reset === true;
  try {
    const r = seedDemo(undefined, { reset });
    const message = reset
      ? "デモ用データを消して入れ直しました"
      : r.inserted
        ? "デモ用データを入れました"
        : "すでに入っています";
    return NextResponse.json({ ok: true, ...r, message });
  } catch {
    // 例外の本文は応答にもログにも出さない
    return NextResponse.json({ ok: false, error: "seed_failed" }, { status: 500 });
  }
}
