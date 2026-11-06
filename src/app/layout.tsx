import type { Metadata } from "next";
import "./globals.css";

// フォントは OS 既定（システムフォント）。next/font/google はビルド時に外部へ取得するため使わない
// （sandbox 内とオフラインの審査環境で失敗する。docs/implementation-notes.md）。

export const metadata: Metadata = {
  title: "VGDD Governance Kernel — AI 開発の統治の可視化",
  description: "AI のチームに開発を任せても、仕様の承認・裁定・停止は人が持つ。役割ごとの権限と承認の条件を実行環境で制御する VGDD Governance Kernel と、その実運用の集計・票の記録・検証結果の可視化。題材はつぶやき業務ログ。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
