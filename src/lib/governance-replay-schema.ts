// /api/governance/replay の応答（T-028 の vgdd.governance-replay.v1）を、クライアントで検証する。T-030。
// 純粋関数だけを置く（node:fs は使わない）。governance-replay.ts は governance.ts を通して node:fs を読むので import しない。
// 列挙値は src/lib/governance-replay.ts と同じ（ずれないことは試験の型の比較で確かめる）。

import { z } from "zod";

const Verdict = z.enum(["APPROVED", "CHANGES_REQUIRED"]).nullable();

// z.object は既定で未知のキーを落とす。新しいオブジェクトに、ここに挙げたキーだけが入る。
const eventSchema = z.object({
  seq: z.number().int().min(1),
  // 記録の行の時刻の形（2026-11-06T01:07:36+0900）。この項目に自由な文を通さない
  ts: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/),
  actor: z.enum(["gate-runner", "night-runner", "release"]),
  kind: z.enum([
    "returned",
    "blocked",
    "held",
    "merged",
    "released",
    "ruling",
    "minor_disagreement",
    "resubmitted",
    "other",
  ]),
  reason: z
    .enum(["scope", "rebase", "security", "judiciary", "disagreement", "return_limit", "spec_unapproved", "other"])
    .nullable(),
  judge: Verdict,
  codex: Verdict,
});

const replaySchema = z.object({
  schema: z.literal("vgdd.governance-replay.v1"),
  generated_at: z.string().min(1),
  tickets: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      status: z.string().min(1),
      events: z.array(eventSchema),
    }),
  ),
});

export type Replay = z.infer<typeof replaySchema>;

/** 形が合えば、許可したキーだけで組み立て直した値を返す。合わなければ null */
export function pickReplay(json: unknown): Replay | null {
  const r = replaySchema.safeParse(json);
  return r.success ? r.data : null;
}
