import type { Metadata } from "next";
import "./globals.css";

// フォントは OS 既定（システムフォント）。next/font/google はビルド時に外部へ取得するため使わない
// （sandbox 内とオフラインの審査環境で失敗する。docs/implementation-notes.md）。

export const metadata: Metadata = {
  title: "つぶやき業務ログ",
  description: "新人のつまずきを、組織の知識に変える。作業中のつぶやきから、手順書の原案と判断のポイントを作る。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
