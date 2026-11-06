// 不変条件と承認待ちの写し（裁判所が書き出す vgdd.kernel-invariants.v1、法律 p0.4.4）の形の検証と表示用の集計。T-024。
// 純粋関数だけを置く（node:fs は使わない）。サーバーの読み込み（kernel-invariants.ts）と画面（KernelInvariants）の両方から使う。
// この写しは表示用で、承認の効力を与えない。判断の根拠にしない。自由な文（題名）の項目は持たない。

import { z } from "zod";

// ---------- 補助の型（書き出し側と同じ形） ----------

const Iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?([+-]\d{2}:\d{2}|Z)$/);
const Ver = z.string().max(40).regex(/^p\d+\.\d+\.\d+[a-z]?$/);

const kernelInvariantsSchema = z
  .object({
    schema: z.literal("vgdd.kernel-invariants.v1"),
    generated_at: Iso,
    kernel_version: Ver.nullable(),
    verified_by: z
      .object({ kernel_version: Ver, impl: z.literal("z3"), at: Iso.nullable() })
      .strict()
      .nullable(),
    invariants: z
      .array(
        z
          .object({
            id: z.string().regex(/^INV-\d{2}$/),
            status: z.enum(["enforced", "partial", "not_applicable"]),
            tests: z.number().int().min(0).max(1_000_000),
            verified: z.boolean().nullable(),
          })
          .strict(),
      )
      .max(50),
    pending_approvals: z
      .array(
        z
          .object({
            task: z.string().regex(/^T-\d{3,4}$/),
            status: z.enum(["ready", "in_progress", "review", "blocked"]),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

export type KernelInvariants = z.infer<typeof kernelInvariantsSchema>;

/** 形が合えば写しを返す。合わなければ null */
export function pickKernelInvariants(json: unknown): KernelInvariants | null {
  const r = kernelInvariantsSchema.safeParse(json);
  return r.success ? r.data : null;
}

/** 状態ごとの件数と、最後の適合性テストの結果ごとの件数を数える */
export function summarizeInvariants(x: KernelInvariants): {
  enforced: number;
  partial: number;
  notApplicable: number;
  passed: number;
  failed: number;
  unknown: number;
} {
  const count = (pred: (row: KernelInvariants["invariants"][number]) => boolean) =>
    x.invariants.filter(pred).length;
  return {
    enforced: count((r) => r.status === "enforced"),
    partial: count((r) => r.status === "partial"),
    notApplicable: count((r) => r.status === "not_applicable"),
    passed: count((r) => r.verified === true),
    failed: count((r) => r.verified === false),
    unknown: count((r) => r.verified === null),
  };
}
