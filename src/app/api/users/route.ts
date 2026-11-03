// GET /api/users：固定ユーザーの一覧（画面上部のセレクタ用）
import { NextResponse } from "next/server";
import { listUsers } from "@/lib/db";

// cacheComponents が有効なため、Route Segment Config（dynamic 等）は使わない。
// Route Handler は既定で動的に実行される。

export async function GET() {
  return NextResponse.json({ users: listUsers() });
}
