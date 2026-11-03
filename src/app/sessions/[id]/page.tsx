import { Suspense } from "react";
import SessionView from "@/components/SessionView";

// S-2 整理結果の画面。params は実行時のデータなので、cacheComponents の下では Suspense の中で読む
// （「runtime data during prerendering」のエラー対策）。データ本体はクライアント側で API から取る。
async function SessionPageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SessionView sessionId={Number(id)} />;
}

export default function SessionPage({ params }: PageProps<"/sessions/[id]">) {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-zinc-500">読み込み中…</div>}>
      <SessionPageInner params={params} />
    </Suspense>
  );
}
