// GET /api/governance/replay：統治シアターの公開用データ（T-028）。引数は取らない。
// 記録の行は列挙値だけに変えて返す（src/lib/governance-replay.ts）。例外の本文は応答に入れない。
import { NextResponse, connection } from "next/server";
import { loadGovernance } from "@/lib/governance";
import { buildReplay } from "@/lib/governance-replay";

// cacheComponents が有効なため、Route Segment Config（dynamic 等）は使わない。
// リクエストを読まない GET でも、ビルド時に固めず要求のたびに読むよう connection() を待つ。

export async function GET() {
  try {
    await connection();
    return NextResponse.json(buildReplay(loadGovernance()));
  } catch {
    return NextResponse.json({ error: "governance_replay_unavailable" }, { status: 500 });
  }
}
