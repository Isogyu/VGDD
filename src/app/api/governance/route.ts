// GET /api/governance：統治のライブ画面のデータ（T-013）。引数は取らない。
// 読むのはリポジトリの docs/ の3か所だけ（src/lib/governance.ts）。例外の本文は応答に入れない。
import { NextResponse, connection } from "next/server";
import { loadGovernance } from "@/lib/governance";

// cacheComponents が有効なため、Route Segment Config（dynamic 等）は使わない。
// リクエストを読まない GET でも、ビルド時に固めず要求のたびに読むよう connection() を待つ。

export async function GET() {
  try {
    await connection();
    return NextResponse.json(loadGovernance());
  } catch {
    return NextResponse.json({ error: "governance_unavailable" }, { status: 500 });
  }
}
