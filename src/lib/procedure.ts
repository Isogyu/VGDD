// 手順書の原案と判断のポイントの生成（M5 の裏側。T-012）。
// 材料は、同じ作業名で本人が承認した共有（shared_knowledge。取り下げ済みを除く）だけ。原文のメモは読まない（M9-3、D-62）。
// provider の出力を固定の形で検証し、違反なら違反の内容（値は含めない）を添えて1回だけやり直す。保存はしない。
// 見本：src/lib/summarize.ts（やり直しの回し方・例外の扱い）。

import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { getDb } from "./db";
import { normalizeTaskName } from "./commands";
import { extractJson } from "./summary-schema";
import { ProviderUnavailableError } from "./ai/provider";
import { getProcedureProvider, type ProcedureProvider } from "./ai/procedure-provider";

/** 画面に常に出す注意（M5-4。表示は画面の票で使う） */
export const PROCEDURE_NOTICE = "原案。利用前に本人・先輩の確認が必要";

export const PROCEDURE_MAX_ATTEMPTS = 2;
export const PROCEDURE_MIN_SOURCES = 2;
export const PROCEDURE_MAX_SOURCES = 20;
export const PROCEDURE_MAX_BODY_CHARS = 20000;

export type ProcedureSource = {
  n: number;
  knowledge_id: number;
  display_name: string;
  role: "newcomer" | "senior";
  approved_at: string;
  body: string;
};

/** 作業名が一致し、取り下げられていない承認済みの共有を、承認日時・id の昇順で全件返す */
export function listProcedureSources(taskName: string, db: DatabaseSync = getDb()): ProcedureSource[] {
  const rows = db
    .prepare(
      `SELECT k.id AS knowledge_id, u.display_name AS display_name, u.role AS role, k.approved_at AS approved_at, k.body AS body
         FROM shared_knowledge k
         JOIN users u ON u.id = k.user_id
        WHERE k.task_name = ? AND k.withdrawn_at IS NULL
        ORDER BY k.approved_at ASC, k.id ASC`,
    )
    .all(normalizeTaskName(taskName)) as unknown as Omit<ProcedureSource, "n">[];
  return rows.map((r, i) => ({
    n: i + 1,
    knowledge_id: Number(r.knowledge_id),
    display_name: r.display_name,
    role: r.role,
    approved_at: r.approved_at,
    body: r.body,
  }));
}

export type ProcedureEvidence = { knowledge_id: number; display_name: string; approved_at: string };
export type ProcedureItem = { text: string; evidence: ProcedureEvidence[]; inferred: boolean };
export type ProcedureDecisionPoint = ProcedureItem & { reason: string };

export type Procedure = {
  schema: "tsubuyaki.procedure.v1";
  task_name: string;
  steps: ProcedureItem[];
  decision_points: ProcedureDecisionPoint[];
  source_ids: number[];
};

export type ProcedureValidation =
  | { ok: true; steps: ProcedureItem[]; decision_points: ProcedureDecisionPoint[] }
  | { ok: false; errors: string[] };

const Evidence = z.array(z.number().int()).max(10);

const RawProcedureSchema = z
  .object({
    steps: z
      .array(
        z
          .object({
            text: z.string().min(1).max(300),
            evidence: Evidence,
          })
          .strict(),
      )
      .min(1)
      .max(12),
    decision_points: z
      .array(
        z
          .object({
            text: z.string().min(1).max(300),
            reason: z.string().min(1).max(300),
            evidence: Evidence,
          })
          .strict(),
      )
      .min(0)
      .max(8),
  })
  .strict();

const MAX_ERRORS = 10;

/** provider の出力を検証し、根拠の番号を共有に写す。errors には出力の値そのものを入れない */
export function validateProcedure(raw: unknown, sources: ProcedureSource[]): ProcedureValidation {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(extractJson(raw));
    } catch {
      return { ok: false, errors: ["出力が JSON として解釈できない"] };
    }
  }
  const parsed = RawProcedureSchema.safeParse(value);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => {
      const p = i.path.map((x) => String(x)).join(".") || "(root)";
      return `${p}: ${i.code}`;
    });
    return { ok: false, errors: errors.slice(0, MAX_ERRORS) };
  }
  const errors: string[] = [];
  const mapEvidence = (nums: number[], basePath: string): { evidence: ProcedureEvidence[]; inferred: boolean } => {
    const seen = new Set<number>();
    const evidence: ProcedureEvidence[] = [];
    nums.forEach((n, j) => {
      if (n < 1 || n > sources.length) {
        errors.push(`${basePath}.evidence.${j}: 番号 ${n} は 1〜${sources.length} の外`);
        return;
      }
      if (seen.has(n)) return;
      seen.add(n);
      const s = sources[n - 1];
      evidence.push({ knowledge_id: s.knowledge_id, display_name: s.display_name, approved_at: s.approved_at });
    });
    return { evidence, inferred: evidence.length === 0 };
  };
  const steps: ProcedureItem[] = parsed.data.steps.map((s, i) => ({
    text: s.text.trim(),
    ...mapEvidence(s.evidence, `steps.${i}`),
  }));
  const decision_points: ProcedureDecisionPoint[] = parsed.data.decision_points.map((d, i) => ({
    text: d.text.trim(),
    reason: d.reason.trim(),
    ...mapEvidence(d.evidence, `decision_points.${i}`),
  }));
  if (errors.length > 0) return { ok: false, errors: errors.slice(0, MAX_ERRORS) };
  return { ok: true, steps, decision_points };
}

export type GenerateProcedureResult =
  | { ok: true; procedure: Procedure; model: string; attempts: number }
  | {
      ok: false;
      reason: "insufficient_records" | "too_large" | "provider_unavailable" | "schema_violation" | "sources_changed";
      message: string;
      count?: number;
      errors?: string[];
      attempts: number;
    };

/** 例外の本文を応答に入れないための固定の文 */
const PROVIDER_FAILED_MESSAGE = "AI の呼び出しに失敗しました";

function sameIds(a: ProcedureSource[], b: ProcedureSource[]): boolean {
  return a.length === b.length && a.every((s, i) => s.knowledge_id === b[i].knowledge_id);
}

/** 承認済みの共有から手順書の原案を作る（保存しない） */
export async function generateProcedure(
  taskName: string,
  opts: { provider?: ProcedureProvider } = {},
  db: DatabaseSync = getDb(),
): Promise<GenerateProcedureResult> {
  const name = normalizeTaskName(taskName);
  // 材料は最初に1回だけ取る（スナップショット）
  const sources = listProcedureSources(name, db);
  const count = sources.length;
  if (count < PROCEDURE_MIN_SOURCES) {
    return {
      ok: false,
      reason: "insufficient_records",
      message: `記録が不足しています（承認済みの共有が${PROCEDURE_MIN_SOURCES}件以上必要です。いまは ${count} 件）`,
      count,
      attempts: 0,
    };
  }
  const totalChars = sources.reduce((sum, s) => sum + s.body.length, 0);
  if (count > PROCEDURE_MAX_SOURCES || totalChars > PROCEDURE_MAX_BODY_CHARS) {
    return {
      ok: false,
      reason: "too_large",
      message: `共有が多すぎます（${PROCEDURE_MAX_SOURCES}件まで、本文の合計${PROCEDURE_MAX_BODY_CHARS}文字まで。いまは ${count} 件）`,
      count,
      attempts: 0,
    };
  }

  let provider: ProcedureProvider;
  try {
    provider = opts.provider ?? getProcedureProvider();
  } catch (e) {
    const message = e instanceof ProviderUnavailableError ? e.message : PROVIDER_FAILED_MESSAGE;
    return { ok: false, reason: "provider_unavailable", message, attempts: 0 };
  }

  let previousErrors: string[] | undefined;
  for (let attempt = 1; attempt <= PROCEDURE_MAX_ATTEMPTS; attempt++) {
    let raw: string;
    let model: string;
    try {
      const out = await provider.generate({ taskName: name, sources, previousErrors });
      raw = out.raw;
      model = out.model;
    } catch (e) {
      const message = e instanceof ProviderUnavailableError ? e.message : PROVIDER_FAILED_MESSAGE;
      return { ok: false, reason: "provider_unavailable", message, attempts: attempt };
    }
    const v = validateProcedure(raw, sources);
    if (v.ok) {
      // 生成の途中に承認・取り下げがあれば、結果を捨てる
      const now = listProcedureSources(name, db);
      if (!sameIds(sources, now)) {
        return {
          ok: false,
          reason: "sources_changed",
          message: "生成の途中で共有が変わりました。もう一度作ってください",
          attempts: attempt,
        };
      }
      return {
        ok: true,
        procedure: {
          schema: "tsubuyaki.procedure.v1",
          task_name: name,
          steps: v.steps,
          decision_points: v.decision_points,
          source_ids: sources.map((s) => s.knowledge_id),
        },
        model,
        attempts: attempt,
      };
    }
    previousErrors = v.errors;
  }
  return {
    ok: false,
    reason: "schema_violation",
    message: "手順書の原案を作れませんでした（AI の出力が決められた形に2回とも合いませんでした）",
    errors: previousErrors,
    attempts: PROCEDURE_MAX_ATTEMPTS,
  };
}
