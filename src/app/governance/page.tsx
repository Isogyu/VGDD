import { Suspense } from "react";
import GovernanceView from "@/components/GovernanceView";

// 統治のライブ画面（T-013）。データ本体はクライアント側で GET /api/governance から取る。
// sessions/[id]/page.tsx と同じく Suspense で包む。
export default function GovernancePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-zinc-500">読み込み中…</div>}>
      <GovernanceView />
    </Suspense>
  );
}
