import type { Metadata } from "next";
import RequirementsGuide from "@/components/requirements/RequirementsGuide";

// 要件確認の画面（T-043）。ローカルだけで動かす。データ本体はクライアント側で /api/requirements* から取る。
// トップの画面や /governance からの導線は、別の票で足す。

export const metadata: Metadata = {
  title: "要件の確認 — VGDD",
};

export default function RequirementsPage() {
  return <RequirementsGuide />;
}
