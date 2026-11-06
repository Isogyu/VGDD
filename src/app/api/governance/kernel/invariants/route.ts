// GET /api/governance/kernel/invariants：不変条件と承認待ちの写し（T-024）。引数は取らない。
// 読むのは docs/governance/kernel-invariants.json の1か所だけ（src/lib/kernel-invariants.ts）。例外の本文は応答に入れない。
// この写しは表示用で、承認の効力を与えない。
import { NextResponse, connection } from "next/server";
import { loadKernelInvariants } from "@/lib/kernel-invariants";

// cacheComponents が有効なため、Route Segment Config（dynamic 等）は使わない。
// リクエストを読まない GET でも、ビルド時に固めず要求のたびに読むよう connection() を待つ。

export async function GET() {
  try {
    await connection();
    return NextResponse.json({ invariants: loadKernelInvariants() });
  } catch {
    return NextResponse.json({ error: "invariants_unavailable" }, { status: 500 });
  }
}
