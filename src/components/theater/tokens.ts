// 統治シアターの、役割と状態の表示の決まり（T-029 A1）。
// 色だけに頼らないよう、どの項目もラベル（日本語）と形の印（1文字）を持つ。
// Tailwind が文字列からクラスを見つけられるよう、クラス名は組み立てず、完全な形で書く。
// 背景は半透明にしない（文字色とのコントラストを値で確かめられるようにするため）。
export const theaterTokens = {
  // 画面全体。親のテーマ（ライト／ダーク）にかかわらず、この組で固定する
  page: {
    background: "bg-slate-950",
    text: "text-slate-100",
  },
  roles: {
    // 人：承認・裁定・停止
    human: {
      label: "人",
      mark: "◆",
      text: "text-pink-200",
      border: "border border-pink-500",
      background: "bg-pink-950",
    },
    // 立法
    legislative: {
      label: "立法",
      mark: "▲",
      text: "text-violet-300",
      border: "border border-violet-500",
      background: "bg-violet-950",
    },
    // 行政：Claude Code
    executive: {
      label: "行政",
      mark: "■",
      text: "text-blue-300",
      border: "border border-blue-500",
      background: "bg-blue-950",
    },
    // 司法：Claude と Codex
    judiciary: {
      label: "司法",
      mark: "●",
      text: "text-yellow-200",
      border: "border border-yellow-500",
      background: "bg-yellow-950",
    },
    // Kernel：統合の条件を確かめる（中立色）
    kernel: {
      label: "Kernel",
      mark: "◎",
      text: "text-slate-200",
      border: "border border-slate-500",
      background: "bg-slate-800",
    },
    // 統合
    merged: {
      label: "統合",
      mark: "✓",
      text: "text-emerald-300",
      border: "border border-emerald-500",
      background: "bg-emerald-950",
    },
  },
  states: {
    // 判断待ち（琥珀色）
    waiting: {
      label: "判断待ち",
      mark: "…",
      text: "text-amber-300",
      border: "border border-amber-500",
      background: "bg-amber-950",
    },
    // 停止（赤）
    stopped: {
      label: "停止",
      mark: "×",
      text: "text-red-300",
      border: "border border-red-500",
      background: "bg-red-950",
    },
    // 確認できない（灰色。枠は破線）
    unknown: {
      label: "確認できない",
      mark: "?",
      text: "text-gray-300",
      border: "border border-dashed border-gray-500",
      background: "bg-gray-900",
    },
  },
} as const;
