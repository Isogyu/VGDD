import { Suspense } from "react";
import ShareRecords from "@/components/ShareRecords";

// 本人の共有の記録と取り下げの画面（T-014、M9-5）。データ本体はクライアント側で API から取る。
// src/app/sessions/[id]/page.tsx と同じく Suspense で包む。
export default function SharesPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-zinc-500">読み込み中…</div>}>
      <ShareRecords />
    </Suspense>
  );
}
