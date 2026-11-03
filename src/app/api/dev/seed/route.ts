// POST /api/dev/seed：デモ用の合成データを入れる（M7 の前倒し・最小分）。
// 開発サーバーで使う。本番ビルド（NODE_ENV=production）では無効。
// `npm run seed` はこのエンドポイントを叩く（scripts/seed.mjs）。
import { NextResponse } from "next/server";
import { seedDemo } from "@/lib/seed";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "disabled_in_production" }, { status: 403 });
  }
  try {
    const r = seedDemo();
    return NextResponse.json({ ok: true, ...r, message: r.inserted ? "デモ用データを入れました" : "すでに入っています" });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 409 });
  }
}
