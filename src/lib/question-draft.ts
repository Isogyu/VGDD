// 整理結果（8項目）とメモから、先輩への質問文の下書きを組み立てる純粋関数（T-006、M10-2）。
// 送信はしない。画面でコピーしてチャットなどに貼って使う。
// 下書きに入れるのは整理結果の本文・作業名・「分からないこと」のメモ本文だけ（メモ ID・時刻・根拠の番号は入れない）。

import type { Note } from "@/lib/sessions";
import { SUMMARY_KEYS, SUMMARY_LABELS, itemStatus, type Summary, type SummaryKey } from "@/lib/summary-schema";

/** 下書きの見出し（この順で並ぶ） */
export const QUESTION_DRAFT_SECTIONS = ["担当作業", "いま理解していること", "試したこと", "未確認のこと", "聞きたいこと"] as const;

/** 「いま理解していること」に入れる候補の項目（並びは SUMMARY_KEYS の順で決める） */
const UNDERSTANDING_KEYS: readonly SummaryKey[] = ["struggle", "cause", "resolution", "learning", "decision_reason"];

const CLOSING_LINE = "お手すきのときにお願いします。";

function heading(name: (typeof QUESTION_DRAFT_SECTIONS)[number]): string {
  return `【${name}】`;
}

export function buildQuestionDraft(input: { taskName: string; summary: Summary; notes: Note[] }): string {
  const { taskName, summary, notes } = input;
  const lines: string[] = [];

  // 書き出し
  lines.push(`お疲れさまです。「${taskName}」について確認したいことがあります。`, "");

  // ① 担当作業
  lines.push(heading("担当作業"), taskName, "");

  // ② いま理解していること：根拠のある項目だけ（SUMMARY_KEYS の順）
  lines.push(heading("いま理解していること"));
  const understood = SUMMARY_KEYS.filter((key) => UNDERSTANDING_KEYS.includes(key) && itemStatus(summary[key]) === "evidenced").map(
    (key) => `- ${SUMMARY_LABELS[key]}：${summary[key].text}`,
  );
  lines.push(...(understood.length > 0 ? understood : ["- （まだ確認できたことがありません）"]), "");

  // ③ 試したこと
  lines.push(heading("試したこと"));
  lines.push(itemStatus(summary.tried) !== "none" ? `- ${summary.tried.text}` : "- （まだありません）", "");

  // ④ 未確認のこと：AI の推測の項目 → 未解決 → 「分からないこと」のメモ
  lines.push(heading("未確認のこと"));
  const unconfirmed: string[] = [];
  for (const key of SUMMARY_KEYS) {
    if (key === "ask_human") continue;
    if (itemStatus(summary[key]) === "inferred") unconfirmed.push(`- ${SUMMARY_LABELS[key]}：${summary[key].text}（AI の推測）`);
  }
  if (itemStatus(summary.unresolved) !== "none") unconfirmed.push(`- ${summary.unresolved.text}`);
  for (const note of notes) {
    if (note.kind === "unknown") unconfirmed.push(`- ${note.body}`);
  }
  lines.push(...(unconfirmed.length > 0 ? unconfirmed : ["- （なし）"]), "");

  // ⑤ 聞きたいこと
  lines.push(heading("聞きたいこと"));
  lines.push(
    itemStatus(summary.ask_human) !== "none"
      ? `- ${summary.ask_human.text}`
      : "- （整理結果に「人に確認すべきこと」がありません。自分の言葉で書いてください）",
    "",
  );

  // 結び
  lines.push(CLOSING_LINE);
  return lines.join("\n");
}
