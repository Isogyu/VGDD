// AI 整理（M4）の固定スキーマ。
// provider（Claude / demo / mock）は「メモの番号（#1〜#n）」で根拠を返し、ここで検証してからメモ ID に写す。
// 項目は8つ。根拠（evidence）が空の項目は「AI の推測」として表示する（M4-2）。
// 追加の質問（questions）は最大2件（M4-5、D-40⑤：1問ずつ出す）。

import { z } from "zod";

export const SUMMARY_KEYS = [
  "struggle",
  "cause",
  "tried",
  "resolution",
  "decision_reason",
  "learning",
  "unresolved",
  "ask_human",
] as const;
export type SummaryKey = (typeof SUMMARY_KEYS)[number];

export const SUMMARY_LABELS: Record<SummaryKey, string> = {
  struggle: "つまずき",
  cause: "原因",
  tried: "試したこと",
  resolution: "解決",
  decision_reason: "判断の理由",
  learning: "学び",
  unresolved: "未解決",
  ask_human: "人に確認すべきこと",
};

/** provider が返す形：根拠はメモの番号（1 始まり） */
const RawItem = z
  .object({
    text: z.string().min(1).max(600),
    evidence: z.array(z.number().int().positive()).max(20).default([]),
  })
  .strict();

export const RawSummarySchema = z
  .object({
    struggle: RawItem,
    cause: RawItem,
    tried: RawItem,
    resolution: RawItem,
    decision_reason: RawItem,
    learning: RawItem,
    unresolved: RawItem,
    ask_human: RawItem,
    questions: z
      .array(
        z
          .object({
            text: z.string().min(1).max(300),
            target: z.enum(SUMMARY_KEYS),
          })
          .strict(),
      )
      .max(2)
      .default([]),
  })
  .strict();
export type RawSummary = z.infer<typeof RawSummarySchema>;

/**
 * 項目の状態（画面のバッジに使う）：
 *   evidenced＝根拠のメモがある／inferred＝根拠がないのに内容を述べている（「AI の推測」）／none＝記録がない（「なし」「書かれていない」）
 */
export type ItemStatus = "evidenced" | "inferred" | "none";

/** DB に保存する形：根拠はメモ ID、推測フラグつき */
export interface SummaryItem {
  text: string;
  evidence_note_ids: number[];
  inferred: boolean;
  status?: ItemStatus;
}

/** 「記録なし」を表す本文（根拠がなく、内容を述べていない） */
const NONE_TEXT = /^(なし|該当なし|特になし|記録なし|不明|（?記録がない）?|メモ(には|からは|に)?(書かれていない|分からない|確認できない)[。．]?)$/u;

/** 「なし」等で始まり、直後が句読点か文末（例：「なし。メモには書かれていない」） */
const NONE_PREFIX = /^(なし|該当なし|特になし|記録なし|不明)([。．、，：:]|$)/u;

/** 記録がないことを述べる語（「ではない」は入れない：内容を述べる否定文と区別するため） */
const NONE_PHRASES = ["書かれていない", "記録がない", "記録はない", "メモにない", "言及がない", "触れられていない", "確認できない"];

/** 該当語を含む文を none とみなす長さの上限 */
const NONE_PHRASE_MAX_LENGTH = 60;

/**
 * 該当語の後ろに続いてよい文字（A2 ③の列挙どおり）：。 ． 、 ， ： : ！ ？ ! ? と空白の0個以上の並びだけ。
 * これ以外の文字（絵文字・記号・かっこ・ほかの句読点）が1つでも続けば none にしない
 */
const TRAILING_SYMBOLS = /^[。．、，：:！？!?\s]*$/u;

/**
 * 60 文字以内で、該当語を含み、かつ該当語で文が終わる（後ろは句点などの記号だけ）か。
 * 「原因はメモに書かれていないが、権限の設定が関係している可能性がある」のように、
 * 該当語の後ろに内容が続く文は推測を述べているので false（「記録なし」に隠さない）。
 */
function endsWithNonePhrase(text: string): boolean {
  if (text.length > NONE_PHRASE_MAX_LENGTH) return false;
  return NONE_PHRASES.some((phrase) => {
    const at = text.lastIndexOf(phrase);
    return at !== -1 && TRAILING_SYMBOLS.test(text.slice(at + phrase.length));
  });
}

export function isNoneText(text: string): boolean {
  const t = text.trim();
  return NONE_TEXT.test(t) || NONE_PREFIX.test(t) || endsWithNonePhrase(t);
}

/** 保存済みの古いデータ（status なし）にも使える状態の判定 */
export function itemStatus(item: SummaryItem): ItemStatus {
  if (item.status) return item.status;
  if (item.evidence_note_ids.length > 0) return "evidenced";
  return isNoneText(item.text) ? "none" : "inferred";
}
export interface Summary {
  schema: "tsubuyaki.summary.v1";
  struggle: SummaryItem;
  cause: SummaryItem;
  tried: SummaryItem;
  resolution: SummaryItem;
  decision_reason: SummaryItem;
  learning: SummaryItem;
  unresolved: SummaryItem;
  ask_human: SummaryItem;
  questions: { id: string; text: string; target: SummaryKey }[];
  /** 整理に使ったメモ ID（除外したメモは含まない） */
  source_note_ids: number[];
}

export type ValidationResult =
  | { ok: true; summary: Summary }
  | { ok: false; errors: string[] };

/**
 * provider の出力（JSON 文字列または値）を検証し、メモ番号をメモ ID に写す。
 * 違反は人が読める文で返す（やり直しのプロンプトに添える）。
 */
export function validateAndMap(raw: unknown, noteIds: number[]): ValidationResult {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(extractJson(raw));
    } catch {
      return { ok: false, errors: ["出力が JSON として解釈できない。JSON だけを返すこと"] };
    }
  }
  const parsed = RawSummarySchema.safeParse(value);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return { ok: false, errors: errors.slice(0, 10) };
  }
  const r = parsed.data;
  const errors: string[] = [];
  const toItem = (key: SummaryKey): SummaryItem => {
    const item = r[key];
    const ids: number[] = [];
    for (const n of item.evidence) {
      if (n < 1 || n > noteIds.length) errors.push(`${key}.evidence: メモ番号 #${n} は存在しない（1〜${noteIds.length}）`);
      else if (!ids.includes(noteIds[n - 1])) ids.push(noteIds[n - 1]);
    }
    const text = item.text.trim();
    const status: ItemStatus = ids.length > 0 ? "evidenced" : isNoneText(text) ? "none" : "inferred";
    return { text, evidence_note_ids: ids, inferred: status === "inferred", status };
  };
  const summary: Summary = {
    schema: "tsubuyaki.summary.v1",
    struggle: toItem("struggle"),
    cause: toItem("cause"),
    tried: toItem("tried"),
    resolution: toItem("resolution"),
    decision_reason: toItem("decision_reason"),
    learning: toItem("learning"),
    unresolved: toItem("unresolved"),
    ask_human: toItem("ask_human"),
    questions: r.questions.map((q, i) => ({ id: `q${i + 1}`, text: q.text.trim(), target: q.target })),
    source_note_ids: noteIds,
  };
  if (errors.length) return { ok: false, errors };
  return { ok: true, summary };
}

/** 前後の説明文やコードフェンスを落として JSON 部分だけを取り出す */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start !== -1 && end > start ? body.slice(start, end + 1) : body;
}

/** 保存済みの JSON を読む（壊れていれば null） */
export function parseStoredSummary(json: string): Summary | null {
  try {
    const v = JSON.parse(json) as Partial<Summary>;
    if (v && v.struggle && typeof v.struggle === "object") return v as Summary;
    return null;
  } catch {
    return null;
  }
}
