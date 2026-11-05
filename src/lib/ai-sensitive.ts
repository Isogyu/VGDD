// 共有候補への AI の追加の検出（M6-2 の裏側。T-017）。
// 決定論的な検出（M6-1、detectSensitive）に、AI が挙げた候補を「足す」だけ。AI は決定論的な検出を減らせない・変えられない。
// AI の候補は別の配列（ai）に入れ、source: "ai" を付ける。自動では置き換えない。保存はしない（DB には書かない）。
// provider の出力を固定の形で検証し、違反なら違反の内容（値は含めない）を添えて1回だけやり直す。
// 見本：src/lib/procedure.ts（やり直しの回し方・例外の扱い）。

import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { getDb } from "./db";
import { detectSensitive, type Flag } from "./sensitive";
import { extractJson } from "./summary-schema";
import { ProviderUnavailableError } from "./ai/provider";
import { getSensitiveProvider, type SensitiveInput, type SensitiveProvider } from "./ai/sensitive-provider";

export const AI_SENSITIVE_MAX_ATTEMPTS = 2;
export const AI_SENSITIVE_MAX_CHARS = 2000;

/** 画面に出す注意（画面は別の票） */
export const AI_SENSITIVE_NOTICE =
  "AI の検出は候補です。見落としも誤りもあります。決定論的な検出は AI の結果で取り消されません";

export type AiFlag = {
  type: "ai_customer" | "ai_amount" | "ai_plan" | "ai_other";
  match: string;
  start: number;
  end: number;
  reason: string;
  source: "ai";
};

const RawAiSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            match: z.string().min(1).max(100),
            kind: z.enum(["customer", "amount", "plan", "other"]),
            reason: z.string().min(1).max(200),
          })
          .strict(),
      )
      .min(0)
      .max(20),
  })
  .strict();

const MAX_ERRORS = 10;

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

/** provider の出力を検証し、本文の中の位置に写す。errors には出力の値そのものを入れない */
export function validateAiFlags(
  raw: unknown,
  text: string,
  known: Flag[],
): { ok: true; flags: AiFlag[] } | { ok: false; errors: string[] } {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(extractJson(raw));
    } catch {
      return { ok: false, errors: ["出力が JSON として解釈できない"] };
    }
  }
  const parsed = RawAiSchema.safeParse(value);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => {
      const p = i.path.map((x) => String(x)).join(".") || "(root)";
      return `${p}: ${i.code}`;
    });
    return { ok: false, errors: errors.slice(0, MAX_ERRORS) };
  }

  const flags: AiFlag[] = [];
  const seen = new Set<string>();
  for (const c of parsed.data.candidates) {
    const type = `ai_${c.kind}` as AiFlag["type"];
    // match のすべての出現を、前の出現の終わりから探す。本文に現れなければ何も足さない（違反にはしない）
    let idx = text.indexOf(c.match);
    while (idx !== -1) {
      const range = { start: idx, end: idx + c.match.length };
      const key = `${range.start}:${range.end}`;
      if (!known.some((k) => overlaps(range, k)) && !seen.has(key)) {
        seen.add(key);
        flags.push({ type, match: c.match, start: range.start, end: range.end, reason: c.reason, source: "ai" });
      }
      idx = text.indexOf(c.match, range.end);
    }
  }
  // 安定ソート：同じ start なら先に挙がった順
  flags.sort((a, b) => a.start - b.start);
  return { ok: true, flags };
}

export type CheckSensitiveResult =
  | { ok: true; deterministic: Flag[]; ai: AiFlag[]; model: string; attempts: number }
  | {
      ok: false;
      reason: "provider_unavailable" | "schema_violation" | "empty_text" | "too_long";
      message: string;
      deterministic: Flag[];
      errors?: string[];
      attempts: number;
    };

/** 例外の本文を応答に入れないための固定の文 */
const UNAVAILABLE_MESSAGE = "AI が使えません（API キーがない、またはデモの保存済みの結果がありません）";
const PROVIDER_FAILED_MESSAGE = "AI の呼び出しに失敗しました";

function failureMessage(e: unknown): string {
  return e instanceof ProviderUnavailableError ? UNAVAILABLE_MESSAGE : PROVIDER_FAILED_MESSAGE;
}

/** 本文を決定論的に検出し、AI の追加の候補を足す（保存しない） */
export async function checkSensitiveWithAi(
  text: string,
  opts: { provider?: SensitiveProvider } = {},
): Promise<CheckSensitiveResult> {
  // 決定論的な検出は常に入れる。AI の結果で減らさない・変えない
  const deterministic = detectSensitive(text);
  if (text.trim() === "") {
    return { ok: false, reason: "empty_text", message: "本文が空です", deterministic, attempts: 0 };
  }
  if (text.length > AI_SENSITIVE_MAX_CHARS) {
    return {
      ok: false,
      reason: "too_long",
      message: `本文が長すぎるため AI では確かめません（${AI_SENSITIVE_MAX_CHARS}文字まで）`,
      deterministic,
      attempts: 0,
    };
  }

  let provider: SensitiveProvider;
  try {
    provider = opts.provider ?? getSensitiveProvider();
  } catch (e) {
    return { ok: false, reason: "provider_unavailable", message: failureMessage(e), deterministic, attempts: 0 };
  }

  let previousErrors: string[] | undefined;
  for (let attempt = 1; attempt <= AI_SENSITIVE_MAX_ATTEMPTS; attempt++) {
    // provider には、deterministic とは別に作った配列を毎回渡す（配列・要素を共有しない）
    const known = deterministic.map((f) => ({ start: f.start, end: f.end, type: f.type }));
    const input: SensitiveInput = previousErrors ? { text, known, previousErrors } : { text, known };
    let raw: string;
    let model: string;
    try {
      const out = await provider.check(input);
      raw = out.raw;
      model = out.model;
    } catch (e) {
      return { ok: false, reason: "provider_unavailable", message: failureMessage(e), deterministic, attempts: attempt };
    }
    const v = validateAiFlags(raw, text, deterministic);
    if (v.ok) return { ok: true, deterministic, ai: v.flags, model, attempts: attempt };
    previousErrors = v.errors;
  }
  return {
    ok: false,
    reason: "schema_violation",
    message: "AI の出力を読めませんでした",
    deterministic,
    errors: previousErrors,
    attempts: AI_SENSITIVE_MAX_ATTEMPTS,
  };
}

export type CheckShareError = "share_not_found" | "not_your_share" | "already_decided";

export type CheckShareResult = { ok: false; error: CheckShareError } | CheckSensitiveResult;

/** 共有候補の本文を AI でも確かめる。候補は share_candidates だけから読む（notes は読まない）。DB には書かない */
export async function checkShareWithAi(
  shareId: number,
  userId: string,
  opts: { provider?: SensitiveProvider } = {},
  db: DatabaseSync = getDb(),
): Promise<CheckShareResult> {
  const row = db
    .prepare("SELECT id, user_id, status, draft_body FROM share_candidates WHERE id = ?")
    .get(shareId) as { id: number; user_id: string; status: string; draft_body: string } | undefined;
  if (!row) return { ok: false, error: "share_not_found" };
  if (row.user_id !== userId) return { ok: false, error: "not_your_share" };
  if (row.status !== "pending") return { ok: false, error: "already_decided" };
  return checkSensitiveWithAi(row.draft_body, opts);
}
