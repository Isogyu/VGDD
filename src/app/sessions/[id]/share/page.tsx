import { Suspense } from "react";
import ShareReview from "@/components/ShareReview";

// S-3 共有候補の確認の画面（T-014、M9・M6-3）。src/app/sessions/[id]/page.tsx と同じく、
// params は Suspense の中で読む。データ本体はクライアント側で API から取る。
async function SharePageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ShareReview sessionId={Number(id)} />;
}

export default function SharePage({ params }: PageProps<"/sessions/[id]/share">) {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-zinc-500">読み込み中…</div>}>
      <SharePageInner params={params} />
    </Suspense>
  );
}
