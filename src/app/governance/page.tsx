import { Suspense } from "react";
import GovernanceView from "@/components/GovernanceView";
import GovernanceTheater from "@/components/theater/GovernanceTheater";

// 統治のページ。先頭に統治シアター（T-034）、その下に証拠の区画（T-013）。データ本体はどちらもクライアント側で API から取る。
// sessions/[id]/page.tsx と同じく Suspense で包む。
export default function GovernancePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-zinc-500">読み込み中…</div>}>
      <GovernanceTheater />
      <GovernanceView />
    </Suspense>
  );
}
