// GET /api/governance/kernel/submission：提出記録の Kernel の状態の写し（T-030）。引数は取らない。
// 読むのは docs/governance/snapshots/submission/kernel-state.json の1か所だけ（src/lib/kernel-state.ts）。例外の本文は応答に入れない。
// 稼働中の写しとは分けて、応答の source で提出記録であることを示す。この写しは表示用で、判断の根拠にしない。
import { NextResponse, connection } from "next/server";
import { loadKernelState } from "@/lib/kernel-state";
import { toWire } from "@/lib/kernel-state-schema";

// cacheComponents が有効なため、Route Segment Config（dynamic 等）は使わない。
// リクエストを読まない GET でも、ビルド時に固めず要求のたびに読むよう connection() を待つ。

export async function GET() {
  try {
    await connection();
    const s = loadKernelState(process.cwd(), "submission");
    // Map はそのまま JSON にすると {} になるので、通信の形に戻して返す
    return NextResponse.json({ source: "submission", state: s === null ? null : toWire(s) });
  } catch {
    return NextResponse.json({ error: "kernel_unavailable" }, { status: 500 });
  }
}
