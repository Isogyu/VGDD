// 整理結果（8項目）と根拠のメモを Markdown にする純粋関数（T-002）。
// 日報やチャットに貼って使う。メモの番号は notes の並び順の番号（1始まり。S-2 の #番号と同じ）。

import type { Note, WorkSession } from "@/lib/sessions";
import { SUMMARY_KEYS, SUMMARY_LABELS, itemStatus, type Summary } from "@/lib/summary-schema";
import { formatDuration, formatHm, formatMdHm } from "@/lib/time";

/** Markdown の最後の行（AI の原案であることの注意書き） */
export const MARKDOWN_DISCLAIMER = "※ これは AI の原案です。利用前に本人・先輩の確認が必要です。";

/** 改行を空白にして1行にする（箇条書きの1項目に収めるため） */
function oneLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, " ").trim();
}

export function summaryToMarkdown(summary: Summary, notes: Note[], session: WorkSession): string {
  // メモ ID → 番号（notes の並び順、1始まり）
  const noteNumber = (id: number): number => notes.findIndex((n) => n.id === id) + 1;

  const lines: string[] = [];
  // ① 見出し
  lines.push(`# ${session.task_name}`, "");
  // ② 開始時刻と所要
  lines.push(`開始: ${formatMdHm(session.started_at)} ／ 所要: ${formatDuration(session.duration_min)}`, "");

  // ③ 8項目
  for (const key of SUMMARY_KEYS) {
    const item = summary[key];
    const status = itemStatus(item);
    const mark = status === "inferred" ? "（AI の推測）" : status === "none" ? "（記録なし）" : "";
    lines.push(`## ${SUMMARY_LABELS[key]}${mark}`, "");
    lines.push(item.text, "");
    const nums = item.evidence_note_ids
      .map(noteNumber)
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    const unique = nums.filter((n, i) => nums.indexOf(n) === i);
    if (unique.length > 0) {
      lines.push(`根拠: ${unique.map((n) => `#${n}`).join(", ")}`, "");
    }
  }

  // ④ 根拠のメモ（AI に送ったメモだけ。番号順）
  lines.push("## 根拠のメモ", "");
  const sourceIds = new Set(summary.source_note_ids);
  const sourceLines = notes
    .map((note, i) => ({ note, num: i + 1 }))
    .filter(({ note }) => sourceIds.has(note.id))
    .map(({ note, num }) => `- #${num} ${formatHm(note.created_at)} ${oneLine(note.body)}`);
  if (sourceLines.length > 0) lines.push(...sourceLines, "");

  // 最後の行
  lines.push(MARKDOWN_DISCLAIMER);
  return lines.join("\n");
}
