import type { Metadata } from "next";
import WorkScreen from "@/components/WorkScreen";

export const metadata: Metadata = { title: "つぶやき業務ログ（VGDD の題材）" };

// S-1 作業画面。データはクライアント側で API から取る（cacheComponents 有効のため、ここは静的な殻）
export default function Home() {
  return <WorkScreen />;
}
