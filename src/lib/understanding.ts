// 「いまの理解を整理」（M10-1）：途中整理の結果を D-40 の区分に並べ替える純粋関数。
// ①既知の既知＝確認済みの事実（confirmed）、AI の推測（inferred）、未確認（unverified）、
// ②既知の未知＝人に確認すべきこと（ask_human）、④未知の未知＝追加の質問（questions）。
// DB・AI には触れない（型と純粋関数だけを import する）。

import { SUMMARY_KEYS, SUMMARY_LABELS, itemStatus, type Summary, type SummaryItem, type SummaryKey } from "@/lib/summary-schema";

export interface UnderstandingItem {
  key: SummaryKey;
  label: string;
  text: string;
  evidence_note_ids: number[];
}

export interface Understanding {
  confirmed: UnderstandingItem[];
  inferred: UnderstandingItem[];
  unverified: UnderstandingItem[];
  ask_human: UnderstandingItem | null;
  questions: Summary["questions"];
}

export const UNDERSTANDING_LABELS = {
  confirmed: "確認済みの事実",
  inferred: "AI の推測",
  unverified: "未確認",
  ask_human: "人に確認すべきこと",
} as const;

/** 事実として並べ替える6項目（未解決と人に確認すべきことは別扱い） */
export const FACT_KEYS = ["struggle", "cause", "tried", "resolution", "decision_reason", "learning"] as const satisfies readonly SummaryKey[];

/** 記録がない項目の本文 */
export const NOT_IN_NOTES_TEXT = "まだメモにない";

function toItem(key: SummaryKey, item: SummaryItem, text: string = item.text): UnderstandingItem {
  return { key, label: SUMMARY_LABELS[key], text, evidence_note_ids: [...item.evidence_note_ids] };
}

export function groupUnderstanding(summary: Summary): Understanding {
  const confirmed: UnderstandingItem[] = [];
  const inferred: UnderstandingItem[] = [];
  const unverified: UnderstandingItem[] = [];

  // SUMMARY_KEYS の順に見る（FACT_KEYS に含まれるものだけ）
  const factKeys: readonly SummaryKey[] = FACT_KEYS;
  for (const key of SUMMARY_KEYS) {
    if (!factKeys.includes(key)) continue;
    const item = summary[key];
    const status = itemStatus(item);
    if (status === "evidenced") confirmed.push(toItem(key, item));
    else if (status === "inferred") inferred.push(toItem(key, item));
    else unverified.push(toItem(key, item, NOT_IN_NOTES_TEXT));
  }

  // 未解決：記録がなければ出さない。あれば未確認の先頭に本文のまま入れる
  if (itemStatus(summary.unresolved) !== "none") {
    unverified.unshift(toItem("unresolved", summary.unresolved));
  }

  const askHuman = itemStatus(summary.ask_human) === "none" ? null : toItem("ask_human", summary.ask_human);

  return { confirmed, inferred, unverified, ask_human: askHuman, questions: summary.questions };
}
