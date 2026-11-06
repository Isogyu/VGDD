// GET /api/governance/history：法律の公開の要約（T-025）。引数は取らない。
// 読むのは vgdd/kernel/history.json の1か所だけ（src/lib/law-history.ts）。例外の本文は応答に入れない。
import { NextResponse, connection } from "next/server";
import { loadLawHistory } from "@/lib/law-history";

// cacheComponents が有効なため、Route Segment Config（dynamic 等）は使わない。
// リクエストを読まない GET でも、ビルド時に固めず要求のたびに読むよう connection() を待つ。

export async function GET() {
  try {
    await connection();
    return NextResponse.json({ history: loadLawHistory() });
  } catch {
    return NextResponse.json({ error: "history_unavailable" }, { status: 500 });
  }
}
