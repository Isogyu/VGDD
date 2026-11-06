// 法律の公開の要約（vgdd/kernel/history.json、vgdd.law-history.v1）の形の検証と表示用の集計。T-025。
// 純粋関数だけを置く（node:fs は使わない）。サーバーの読み込み（law-history.ts）と画面（LawHistory）の両方から使う。

import { z } from "zod";

const Version = z
  .object({
    version: z.string().regex(/^p\d+\.\d+\.\d+[a-z]?$/),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    title: z.string().min(1).max(120),
    fixed: z.array(z.string().min(1).max(200)).max(20),
    found_by: z.array(z.enum(["executive_head", "legislative", "codex", "judge", "owner", "operation"])).max(6),
    precedents: z.array(z.string().regex(/^[A-Z][A-Za-z0-9-]{0,11}$/)).max(50),
    tests_total: z.number().int().min(0).max(1_000_000).nullable(),
    prev_failed: z.number().int().min(0).max(1_000_000).nullable(),
    obs: z.array(z.string().regex(/^OBS-\d{3}$/)).max(20),
  })
  .strict();

const lawHistorySchema = z
  .object({
    schema: z.literal("vgdd.law-history.v1"),
    note: z.string().max(1000),
    versions: z.array(Version).min(1).max(100),
  })
  .strict();

export type LawHistory = z.infer<typeof lawHistorySchema>;

/** 形が合えば法律の歴史を返す。合わなければ null */
export function pickLawHistory(json: unknown): LawHistory | null {
  const r = lawHistorySchema.safeParse(json);
  return r.success ? r.data : null;
}

/**
 * 表示用の集計。
 * improvements は全版の fixed の件数の合計で、独立した脆弱性の数ではない。
 * byFinder は主体ごとの、その主体を含む版の数（同じ版の中の重複は1回に数える）。
 * latestTests は最後の版の tests_total。
 */
export function summarizeLawHistory(h: LawHistory): {
  versions: number;
  improvements: number;
  byFinder: ReadonlyMap<string, number>;
  latestTests: number | null;
} {
  let improvements = 0;
  const byFinder = new Map<string, number>();
  for (const v of h.versions) {
    improvements += v.fixed.length;
    for (const finder of new Set(v.found_by)) {
      byFinder.set(finder, (byFinder.get(finder) ?? 0) + 1);
    }
  }
  return {
    versions: h.versions.length,
    improvements,
    byFinder,
    latestTests: h.versions.at(-1)?.tests_total ?? null,
  };
}
