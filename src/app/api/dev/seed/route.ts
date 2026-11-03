// POST /api/dev/seed：デモ用の合成データを入れる（M7 の前倒し・最小分）。
// 開発サーバー（NODE_ENV=development）のときだけ動く。それ以外は存在しないものとして 404 を返す。
// `npm run seed` はこのエンドポイントを叩く（scripts/seed.mjs）。
import { NextResponse } from "next/server";
import { seedDemo } from "@/lib/seed";

export async function POST(req?: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // { reset: true } で、デモ用テーブルの全行を消してから入れ直す（npm run seed -- --reset）
  let reset = false;
  if (req) {
    const body = (await req.json().catch(() => null)) as { reset?: unknown } | null;
    reset = body?.reset === true;
  }
  try {
    const r = seedDemo(undefined, { reset });
    const message = reset
      ? "デモ用データを消して入れ直しました"
      : r.inserted
        ? "デモ用データを入れました"
        : "すでに入っています";
    return NextResponse.json({ ok: true, ...r, message });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}
