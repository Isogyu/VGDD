// 「証拠」の7つの区画の見出しと、最初に開いておくかの表（T-041）。
// GovernanceView が各区画を details で包むときに、同じ key の行の title を summary に、defaultOpen を open の初期値に使う。
// React は import しない（純粋な表として試験する）。

export type EvidenceSectionKey = "map" | "kernel" | "invariants" | "history" | "numbers" | "board" | "fate";

export type EvidenceSection = {
  key: EvidenceSectionKey;
  title: string;
  defaultOpen: boolean;
};

/** 画面に並べる順。最初に開いておくのは「統治の数字」だけ */
export const EVIDENCE_SECTIONS: readonly EvidenceSection[] = [
  { key: "map", title: "統治の全体図", defaultOpen: false },
  { key: "kernel", title: "Kernel の状態", defaultOpen: false },
  { key: "invariants", title: "不変条件と承認待ち", defaultOpen: false },
  { key: "history", title: "法律が判例で育った歴史", defaultOpen: false },
  { key: "numbers", title: "統治の数字", defaultOpen: true },
  { key: "board", title: "票の盤", defaultOpen: false },
  { key: "fate", title: "票1枚の運命", defaultOpen: false },
];
