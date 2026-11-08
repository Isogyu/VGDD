// 要件確認（/requirements、T-043）の純粋関数。React と node: は import しない（画面・API・保存の全部から使う）。
// 完成度・未解決の一覧・票の下書きの文・AI の提案の取り込みの検証・承認の状態の表示を、LLM から独立したデータだけで決める。
// ここで作る文や表示に効力はない。票にするのは立法補佐、承認するのはオーナー（approve-spec）。

import { QUESTIONS, findQuestion, isQuestionId } from "./questions";

// ---------- 上限 ----------

export const TITLE_MAX_CHARS = 100;
export const ANSWER_MAX_CHARS = 2000;
export const SUGGESTION_TEXT_MAX_CHARS = 500;
export const SUGGESTIONS_MAX = 30;
/** AI の提案の JSON の上限（UTF-8 のバイト数） */
export const SUGGESTIONS_JSON_MAX_BYTES = 32 * 1024;
/** 更新の本文の上限（UTF-8 のバイト数） */
export const BODY_MAX_BYTES = 32_768;
/** 承認の状態の写しを「古い写し」とする経過時間 */
export const COPY_STALE_MS = 10 * 60 * 1000;

export const ASSIST_SCHEMA = "vgdd.requirements-assist.v1";
export const DRAFT_NOTICE = "この下書きに効力はない。票にするのは立法補佐、承認するのはオーナー（approve-spec）";

// ---------- 型 ----------

export interface Answer {
  text: string;
  unknown: boolean;
}

/** 質問の id から回答への対応。答えていない質問の鍵はない */
export type Answers = Record<string, Answer>;

export type SuggestionKind = "missing" | "question" | "criterion";
export const SUGGESTION_KINDS: readonly SuggestionKind[] = ["missing", "question", "criterion"];

export interface Suggestion {
  kind: SuggestionKind;
  target: string | null;
  text: string;
}

export type Decision = "accepted" | "rejected" | "pending";
export const DECISIONS: readonly Decision[] = ["accepted", "rejected", "pending"];

export interface RequirementRecord {
  id: string;
  title: string;
  created_at: string;
  answers: Answers;
  /** 回答を保存するたびに1つ増える */
  answers_version: number;
  /** 取り込んだ AI の提案（本人の回答ではない） */
  suggestions: Suggestion[];
  /** 提案ごとの採否（suggestions と同じ長さ） */
  decisions: Decision[];
  /** 提案の取り込み・採否の更新・提案の無効化のたびに1つ増える */
  suggestions_version: number;
  /** 結び付けた票の ID（T-NNN）か null */
  linked_ticket_id: string | null;
}

export interface RecordListItem {
  id: string;
  title: string;
  created_at: string;
  ready: boolean;
}

// ---------- 補助 ----------

const TICKET_ID = /^T-[0-9]{3,4}$/;

export function isTicketId(v: unknown): v is string {
  return typeof v === "string" && TICKET_ID.test(v);
}

/** 文字数（コードポイントで数える） */
export function charLength(s: string): number {
  return Array.from(s).length;
}

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** 鍵がちょうど keys と同じか（余分な鍵・足りない鍵を拒む） */
function hasExactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

function isVersion(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function isFilled(a: Answer | undefined): boolean {
  return a !== undefined && !a.unknown && a.text.trim() !== "";
}

// ---------- 回答の形 ----------

/**
 * 回答の検証。質問の id から { text, unknown } への対応だけを受ける。未知の質問の id・余分な鍵・上限を超える文は null。
 * 返す値は質問の順に並べ直し、「空で、わからないでもない」回答は落とす（答えていないのと同じ）。
 */
export function parseAnswers(v: unknown): Answers | null {
  if (!isPlainObject(v)) return null;
  for (const [id, a] of Object.entries(v)) {
    if (!isQuestionId(id)) return null;
    if (!isPlainObject(a) || !hasExactKeys(a, ["text", "unknown"])) return null;
    if (typeof a.text !== "string" || typeof a.unknown !== "boolean") return null;
    if (charLength(a.text) > ANSWER_MAX_CHARS) return null;
  }
  const out: Answers = {};
  for (const q of QUESTIONS) {
    if (!Object.prototype.hasOwnProperty.call(v, q.id)) continue;
    const a = v[q.id] as Answer;
    if (a.text === "" && !a.unknown) continue;
    out[q.id] = { text: a.text, unknown: a.unknown };
  }
  return out;
}

/** 2つの回答が同じか（parseAnswers で並べ直した形どうしを比べる） */
export function sameAnswers(a: Answers, b: Answers): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------- 完成度・未解決 ----------

export interface Completeness {
  ready: boolean;
  /** 充足していない必須の質問の id（質問の順） */
  missing: string[];
}

/** 必須の質問がすべて「わからないでなく、空でない」か。「わからない」は充足にしない */
export function completeness(answers: Answers): Completeness {
  const missing = QUESTIONS.filter((q) => q.required && !isFilled(answers[q.id])).map((q) => q.id);
  return { ready: missing.length === 0, missing };
}

export type UnresolvedKind = "missing_required" | "unknown" | "counter_unconfirmed" | "ai_pending";

export interface UnresolvedItem {
  kind: UnresolvedKind;
  question_id: string | null;
  /** ai_pending のときの提案の番号（0 から） */
  index: number | null;
  label: string;
}

const COUNTER_ID = "behavior.counter";

/**
 * 未解決の一覧：必須の未回答、本人が「わからない」と答えた質問、反例が未確認、AI の提案のうち採否が未決定のもの。
 * 必須の質問を「わからない」と答えたときは「わからない」の項目だけを出す（二重に数えない）。
 */
export function unresolved(record: Pick<RequirementRecord, "answers" | "suggestions" | "decisions">): UnresolvedItem[] {
  const items: UnresolvedItem[] = [];
  for (const q of QUESTIONS) {
    const a = record.answers[q.id];
    if (q.required && !isFilled(a) && !(a?.unknown ?? false)) {
      items.push({ kind: "missing_required", question_id: q.id, index: null, label: `必須の未回答：${q.text}` });
    }
  }
  for (const q of QUESTIONS) {
    if (record.answers[q.id]?.unknown) {
      items.push({ kind: "unknown", question_id: q.id, index: null, label: `「わからない」と答えた：${q.text}` });
    }
  }
  if (!isFilled(record.answers[COUNTER_ID])) {
    items.push({ kind: "counter_unconfirmed", question_id: COUNTER_ID, index: null, label: "反例が未確認" });
  }
  record.suggestions.forEach((s, i) => {
    if ((record.decisions[i] ?? "pending") === "pending") {
      items.push({ kind: "ai_pending", question_id: s.target, index: i, label: `AI の提案（採否が未決定）：${s.text}` });
    }
  });
  return items;
}

/** 下書きにできないときの1行（画面の右の欄） */
export function completenessLabel(c: Completeness): string {
  return c.ready ? "下書きにできる：必須の質問がそろった" : `下書きにできない：必須の未回答 ${c.missing.length} 件`;
}

// ---------- 票の下書きの文 ----------

function answerText(answers: Answers, id: string): string {
  const a = answers[id];
  if (a === undefined) return "（未回答）";
  if (a.unknown) return "（わからない）";
  if (a.text.trim() === "") return "（未回答）";
  // Markdown の箇条書きの中で改行を保つため、2行目から字下げする
  return a.text.trim().replace(/\r\n?/g, "\n").split("\n").join("\n  ");
}

/**
 * 票の下書きの文（Markdown）。completeness が ready のときだけ返し、そうでなければ null。
 * 受け入れ条件の候補は、正しい結果の例と（回答があれば）反例から作り、実際に出した候補に A1. から連番を振る。
 */
export function draftTicketText(record: Pick<RequirementRecord, "answers" | "suggestions" | "decisions">): string | null {
  const { answers } = record;
  if (!completeness(answers).ready) return null;

  const criteria: string[] = [];
  criteria.push(`正しい結果の例：${answerText(answers, "behavior.example")}`);
  if (isFilled(answers[COUNTER_ID])) {
    criteria.push(`反例（こうなってはいけない）：${answerText(answers, COUNTER_ID)}`);
  }

  const open = unresolved(record);
  const lines: string[] = [
    DRAFT_NOTICE,
    "",
    "## 1. 目的",
    "",
    `- 課題（誰が困るか）：${answerText(answers, "problem.who")}`,
    `- 場面（いつ・どの場面で）：${answerText(answers, "problem.when")}`,
    `- ゴール（どうなればよいか）：${answerText(answers, "problem.goal")}`,
    "",
    "## 2. 受け入れ条件の候補",
    "",
    ...criteria.map((c, i) => `- A${i + 1}. ${c}`),
    "",
    "## 未解決の事項",
    "",
    ...(open.length === 0 ? ["- なし"] : open.map((u) => `- ${u.label}`)),
  ];
  return lines.join("\n");
}

// ---------- AI の補助に渡す材料 ----------

export interface AssistMaterial {
  record_id: string;
  answers_version: number;
  questions: { id: string; text: string; required: boolean; answer: Answer | null }[];
}

/** 端末の別の道具に渡す材料（保存済みの回答から作る。answers_version は取り込みのときの照合に使う） */
export function assistMaterial(record: Pick<RequirementRecord, "id" | "answers_version" | "answers">): AssistMaterial {
  return {
    record_id: record.id,
    answers_version: record.answers_version,
    questions: QUESTIONS.map((q) => ({
      id: q.id,
      text: q.text,
      required: q.required,
      answer: record.answers[q.id] ?? null,
    })),
  };
}

// ---------- AI の提案の取り込みの検証 ----------

/**
 * AI の提案の検証。json は文字列（貼った JSON）か、解析済みの値。
 * 形が { schema, record_id, answers_version, suggestions } と完全に一致し、record_id と answers_version が今の記録と合うときだけ、
 * 提案の配列を返す。古い回答への取り込み・余分な項目・形の違い・上限を超えるものは null。
 */
export function parseAiSuggestions(
  json: unknown,
  record: Pick<RequirementRecord, "id" | "answers_version">,
): Suggestion[] | null {
  let v: unknown = json;
  if (typeof json === "string") {
    if (utf8Bytes(json) > SUGGESTIONS_JSON_MAX_BYTES) return null;
    try {
      v = JSON.parse(json);
    } catch {
      return null;
    }
  } else {
    let s: string | undefined;
    try {
      s = JSON.stringify(json);
    } catch {
      return null;
    }
    if (s === undefined || utf8Bytes(s) > SUGGESTIONS_JSON_MAX_BYTES) return null;
  }

  if (!isPlainObject(v) || !hasExactKeys(v, ["schema", "record_id", "answers_version", "suggestions"])) return null;
  if (v.schema !== ASSIST_SCHEMA) return null;
  if (typeof v.record_id !== "string" || v.record_id !== record.id) return null;
  if (!isVersion(v.answers_version) || v.answers_version !== record.answers_version) return null;
  if (!Array.isArray(v.suggestions) || v.suggestions.length > SUGGESTIONS_MAX) return null;

  const out: Suggestion[] = [];
  for (const s of v.suggestions) {
    if (!isPlainObject(s) || !hasExactKeys(s, ["kind", "target", "text"])) return null;
    if (typeof s.kind !== "string" || !(SUGGESTION_KINDS as readonly string[]).includes(s.kind)) return null;
    if (s.target !== null && (typeof s.target !== "string" || !isQuestionId(s.target))) return null;
    if (typeof s.text !== "string") return null;
    const n = charLength(s.text);
    if (n < 1 || n > SUGGESTION_TEXT_MAX_CHARS || s.text.trim() === "") return null;
    out.push({ kind: s.kind as SuggestionKind, target: s.target, text: s.text });
  }
  return out;
}

export function suggestionKindLabel(k: SuggestionKind): string {
  if (k === "missing") return "不足の指摘";
  if (k === "question") return "追加の質問";
  return "受け入れ条件の候補";
}

export function decisionLabel(d: Decision): string {
  if (d === "accepted") return "採る";
  if (d === "rejected") return "採らない";
  return "未決定";
}

export function questionText(id: string | null): string | null {
  if (id === null) return null;
  return findQuestion(id)?.text ?? null;
}

// ---------- API の本文の形 ----------

export function parseCreateBody(v: unknown): { title: string } | null {
  if (!isPlainObject(v) || !hasExactKeys(v, ["title"])) return null;
  if (typeof v.title !== "string") return null;
  const title = v.title.trim();
  if (title === "" || charLength(title) > TITLE_MAX_CHARS) return null;
  return { title };
}

export interface PutBody {
  answers_version: number;
  answers: Answers;
  linked_ticket_id: string | null;
}

export function parsePutBody(v: unknown): PutBody | null {
  if (!isPlainObject(v) || !hasExactKeys(v, ["answers_version", "answers", "linked_ticket_id"])) return null;
  if (!isVersion(v.answers_version)) return null;
  if (v.linked_ticket_id !== null && !isTicketId(v.linked_ticket_id)) return null;
  const answers = parseAnswers(v.answers);
  if (answers === null) return null;
  return { answers_version: v.answers_version, answers, linked_ticket_id: v.linked_ticket_id };
}

export type PostBody =
  | { action: "import"; suggestions: unknown }
  | { action: "decide"; answers_version: number; suggestions_version: number; index: number; decision: Decision };

export function parsePostBody(v: unknown): PostBody | null {
  if (!isPlainObject(v)) return null;
  if (v.action === "import") {
    if (!hasExactKeys(v, ["action", "suggestions"])) return null;
    return { action: "import", suggestions: v.suggestions };
  }
  if (v.action === "decide") {
    if (!hasExactKeys(v, ["action", "answers_version", "suggestions_version", "index", "decision"])) return null;
    if (!isVersion(v.answers_version) || !isVersion(v.suggestions_version) || !isVersion(v.index)) return null;
    if (typeof v.decision !== "string" || !(DECISIONS as readonly string[]).includes(v.decision)) return null;
    return {
      action: "decide",
      answers_version: v.answers_version,
      suggestions_version: v.suggestions_version,
      index: v.index,
      decision: v.decision as Decision,
    };
  }
  return null;
}

// ---------- 承認の状態（表示だけ） ----------

export const APPROVAL_LABELS = {
  current: "承認済み（写しの上で）",
  stale: "承認が古い",
  not_recorded: "写しに承認の記録がない",
  no_copy: "写しがない",
} as const;
export const STALE_COPY_LABEL = "古い写し";

export type ApprovalStatusKind = keyof typeof APPROVAL_LABELS;

export interface ApprovalView {
  kind: ApprovalStatusKind;
  label: string;
  /** 写しの generated_at が 10 分より前か不正（写しがないときは false） */
  staleCopy: boolean;
}

const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * GET /api/governance/kernel の応答から、結び付けた票の承認の状態を表示用に決める。
 * この表示は承認の操作にも効力の判断にも使わない。fetchFailed は取得の失敗（通信・状態の符号・JSON の解析）。
 */
export function approvalStatus(response: unknown, ticketId: string, now: Date, fetchFailed = false): ApprovalView {
  const noCopy: ApprovalView = { kind: "no_copy", label: APPROVAL_LABELS.no_copy, staleCopy: false };
  if (fetchFailed || !isPlainObject(response) || !Object.prototype.hasOwnProperty.call(response, "state")) {
    return noCopy;
  }
  const state = response.state;
  if (state === null || !isPlainObject(state)) return noCopy;
  const approvals = state.approvals;
  if (!Array.isArray(approvals)) return noCopy;
  for (const a of approvals) {
    if (!isPlainObject(a) || typeof a.task !== "string" || typeof a.current !== "boolean") return noCopy;
  }

  const g = state.generated_at;
  const t = typeof g === "string" && ISO_PREFIX.test(g) ? Date.parse(g) : NaN;
  const staleCopy = !Number.isFinite(t) || now.getTime() - t > COPY_STALE_MS;

  const hit = (approvals as { task: string; current: boolean }[]).find((a) => a.task === ticketId);
  if (hit === undefined) return { kind: "not_recorded", label: APPROVAL_LABELS.not_recorded, staleCopy };
  if (hit.current) return { kind: "current", label: APPROVAL_LABELS.current, staleCopy };
  return { kind: "stale", label: APPROVAL_LABELS.stale, staleCopy };
}
