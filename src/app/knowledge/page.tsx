import { Suspense } from "react";
import TeamKnowledge from "@/components/TeamKnowledge";

// S-4 チームの知恵の画面（T-015）。データ本体はクライアント側で API から取る。
// src/app/sessions/[id]/page.tsx と同じく Suspense で包む。
export default function KnowledgePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-zinc-500">読み込み中…</div>}>
      <TeamKnowledge />
    </Suspense>
  );
}
