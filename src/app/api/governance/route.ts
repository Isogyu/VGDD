// GET /api/governance：統治のライブ画面のデータ（T-013）。引数は取らない。
// 読むのはリポジトリの docs/ の3か所だけ（src/lib/governance.ts）。例外の本文は応答に入れない。
// 応答は公開してよい項目だけにする（src/lib/governance-public.ts。票の §6 の記録の文は入れない。T-034）。
import { NextResponse, connection } from "next/server";
import { loadGovernance } from "@/lib/governance";
import { toPublicGovernance } from "@/lib/governance-public";

// cacheComponents が有効なため、Route Segment Config（dynamic 等）は使わない。
// リクエストを読まない GET でも、ビルド時に固めず要求のたびに読むよう connection() を待つ。

export async function GET() {
  try {
    await connection();
    return NextResponse.json(toPublicGovernance(loadGovernance()));
  } catch {
    return NextResponse.json({ error: "governance_unavailable" }, { status: 500 });
  }
}
