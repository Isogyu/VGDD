// デモ用の保存済みの AI 出力（手順書の原案・AI の検出）を実 API で採取する（M4-4・M8-2 の拡張。T-020）。
// オーナーが開発サーバーで npm run demo:capture -- --extras を実行する（POST /api/dev/capture-extras）。
// 材料はメモリの DB に入れた seed の合成データだけ（今の DB は使わない）。本文は応答・ログに出さない。
// 見本：src/lib/ai/capture.ts（やり直しの回し方・保存の形）。
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { getDb, openDb } from "../db";
import {
  listProcedureSources,
  validateProcedure,
  PROCEDURE_MAX_SOURCES,
  PROCEDURE_MAX_BODY_CHARS,
  PROCEDURE_MIN_SOURCES,
} from "../procedure";
import { validateAiFlags } from "../ai-sensitive";
import { detectSensitive } from "../sensitive";
import { seedDemo, DEMO_TASK_W1 } from "../seed";
import { getLatestSummary } from "../summarize";
import { buildShareDraft } from "../sharing";
import { nowJst } from "../time";
import {
  ClaudeProcedureProvider,
  procedureFixturePath,
  sourcesFingerprint,
  type ProcedureFixture,
  type ProcedureProvider,
} from "./procedure-provider";
import {
  ClaudeSensitiveProvider,
  sensitiveFixturePath,
  type SensitiveInput,
  type SensitiveProvider,
} from "./sensitive-provider";

export type ExtraCaptureResult = {
  kind: "procedure" | "sensitive";
  /** procedure は作業名、sensitive は本文の先頭20文字 */
  key: string;
  ok: boolean;
  path?: string;
  model?: string;
  attempts: number;
  errors?: string[];
};

const MAX_ATTEMPTS = 2;
const SENSITIVE_MAX_CHARS = 2000;

export type CaptureKind = "procedure" | "sensitive" | "all";

export type CaptureRequestCheck =
  | { ok: true; kind: CaptureKind }
  | {
      ok: false;
      status: 404 | 403 | 415 | 400;
      error: "not_found" | "forbidden_origin" | "unsupported_media_type" | "invalid_body";
    };

const CaptureBodySchema = z.object({ kind: z.enum(["procedure", "sensitive", "all"]).optional() }).strict();

/**
 * POST /api/dev/capture-extras の要求の判定（API キーの確認より前）。純粋な関数。
 * 判定の順：404（development 以外）→ 403（Origin あり）→ 415（JSON 以外）→ 400（body が不正）。
 * body は JSON として読んだ値（読めなければ undefined）。
 */
export function checkCaptureRequest(input: {
  nodeEnv: string | undefined;
  origin: string | null;
  contentType: string | null;
  body: unknown;
}): CaptureRequestCheck {
  if (input.nodeEnv !== "development") return { ok: false, status: 404, error: "not_found" };
  // ブラウザーの別のサイトから採取を起こさせない（scripts/demo-capture.mjs の Node の fetch は Origin を付けない）
  if (input.origin !== null) return { ok: false, status: 403, error: "forbidden_origin" };
  if (!(input.contentType ?? "").toLowerCase().startsWith("application/json")) {
    return { ok: false, status: 415, error: "unsupported_media_type" };
  }
  const body = input.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: "invalid_body" };
  }
  const parsed = CaptureBodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: "invalid_body" };
  return { ok: true, kind: parsed.data.kind ?? "all" };
}

function writeJson(p: string, value: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + "\n", "utf8");
}

/** 手順書の原案の fixture を採る。材料は db の承認済みの共有だけ */
export async function captureProcedureFixtures(
  taskNames: string[],
  opts: { provider?: ProcedureProvider; dir?: string } = {},
  db: DatabaseSync = getDb(),
): Promise<ExtraCaptureResult[]> {
  // provider は、実際に呼ぶときに初めて作る（材料が足りないだけで API キーを求めない）
  let provider: ProcedureProvider | undefined = opts.provider;
  const results: ExtraCaptureResult[] = [];
  for (const taskName of taskNames) {
    const sources = listProcedureSources(taskName, db);
    if (sources.length < PROCEDURE_MIN_SOURCES) {
      results.push({ kind: "procedure", key: taskName, ok: false, attempts: 0, errors: ["承認済みの共有が2件未満"] });
      continue;
    }
    const totalChars = sources.reduce((sum, s) => sum + s.body.length, 0);
    if (sources.length > PROCEDURE_MAX_SOURCES || totalChars > PROCEDURE_MAX_BODY_CHARS) {
      // generateProcedure で再生できない fixture を作らない
      results.push({ kind: "procedure", key: taskName, ok: false, attempts: 0, errors: ["材料が多すぎる"] });
      continue;
    }
    provider ??= new ClaudeProcedureProvider();
    let previousErrors: string[] | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const out = await provider.generate(previousErrors ? { taskName, sources, previousErrors } : { taskName, sources });
      const v = validateProcedure(out.raw, sources);
      if (v.ok) {
        const fx: ProcedureFixture = {
          task_name: taskName,
          model: out.model,
          captured_at: nowJst(),
          sources_fingerprint: sourcesFingerprint(sources),
          raw: out.raw,
        };
        const p = procedureFixturePath(taskName, opts.dir);
        writeJson(p, fx);
        results.push({ kind: "procedure", key: taskName, ok: true, path: p, model: out.model, attempts: attempt });
        break;
      }
      previousErrors = v.errors;
      if (attempt === MAX_ATTEMPTS) {
        results.push({ kind: "procedure", key: taskName, ok: false, attempts: MAX_ATTEMPTS, errors: v.errors });
      }
    }
  }
  return results;
}

/** AI の検出の fixture を採る */
export async function captureSensitiveFixtures(
  texts: string[],
  opts: { provider?: SensitiveProvider; dir?: string } = {},
): Promise<ExtraCaptureResult[]> {
  if (texts.length === 0) {
    return [{ kind: "sensitive", key: "-", ok: false, attempts: 0, errors: ["採取する本文がない"] }];
  }
  let provider: SensitiveProvider | undefined = opts.provider;
  const results: ExtraCaptureResult[] = [];
  for (const text of texts) {
    const key = text.slice(0, 20);
    if (text.trim() === "") {
      results.push({ kind: "sensitive", key, ok: false, attempts: 0, errors: ["本文が空"] });
      continue;
    }
    if (text.length > SENSITIVE_MAX_CHARS) {
      results.push({ kind: "sensitive", key, ok: false, attempts: 0, errors: ["本文が長すぎる"] });
      continue;
    }
    provider ??= new ClaudeSensitiveProvider();
    const deterministic = detectSensitive(text);
    let previousErrors: string[] | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const known = deterministic.map((f) => ({ start: f.start, end: f.end, type: f.type }));
      const input: SensitiveInput = previousErrors ? { text, known, previousErrors } : { text, known };
      const out = await provider.check(input);
      const v = validateAiFlags(out.raw, text, detectSensitive(text));
      if (v.ok) {
        const p = sensitiveFixturePath(text, opts.dir);
        writeJson(p, { model: out.model, raw: out.raw });
        results.push({ kind: "sensitive", key, ok: true, path: p, model: out.model, attempts: attempt });
        break;
      }
      previousErrors = v.errors;
      if (attempt === MAX_ATTEMPTS) {
        results.push({ kind: "sensitive", key, ok: false, attempts: MAX_ATTEMPTS, errors: v.errors });
      }
    }
  }
  return results;
}

/** S-3 で新人A が開く最初の共有候補の本文（合成データの W1 の最新の整理結果から作る）。なければ空の配列 */
export function demoSensitiveTexts(db: DatabaseSync = getDb()): string[] {
  const row = db
    .prepare(
      "SELECT id FROM work_sessions WHERE user_id = 'newcomer_a' AND task_name = ? AND status = 'ended' ORDER BY ended_at DESC, id DESC LIMIT 1",
    )
    .get(DEMO_TASK_W1) as { id: number } | undefined;
  if (!row) return [];
  const latest = getLatestSummary(Number(row.id), db);
  if (!latest) return [];
  const body = buildShareDraft(latest.summary);
  return body === null ? [] : [body];
}

/**
 * メモリの DB に seed の合成データだけを入れ、要求した種別の fixture を採る。
 * ok は、要求した種別ごとに1件以上の結果があり、すべての結果が ok のときだけ true。
 */
export async function captureDemoExtras(
  kind: "procedure" | "sensitive" | "all",
  opts: { procedureProvider?: ProcedureProvider; sensitiveProvider?: SensitiveProvider; dir?: string } = {},
): Promise<{ ok: boolean; results: ExtraCaptureResult[] }> {
  const db = openDb(":memory:");
  try {
    seedDemo(db);
    const wantProcedure = kind === "procedure" || kind === "all";
    const wantSensitive = kind === "sensitive" || kind === "all";
    const results: ExtraCaptureResult[] = [];
    if (wantProcedure) {
      results.push(...(await captureProcedureFixtures([DEMO_TASK_W1], { provider: opts.procedureProvider, dir: opts.dir }, db)));
    }
    if (wantSensitive) {
      results.push(...(await captureSensitiveFixtures(demoSensitiveTexts(db), { provider: opts.sensitiveProvider, dir: opts.dir })));
    }
    const has = (k: ExtraCaptureResult["kind"]) => results.some((r) => r.kind === k);
    const ok =
      results.every((r) => r.ok) && (!wantProcedure || has("procedure")) && (!wantSensitive || has("sensitive"));
    return { ok, results };
  } finally {
    db.close();
  }
}
