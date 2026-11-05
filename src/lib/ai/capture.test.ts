import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { getDb, openDb } from "../db";
import { addNote, endSession, startSession } from "../sessions";
import { DEMO_TASKS, DEMO_TASK_W1, seedDemo } from "../seed";
import { captureFixtures, CaptureFixturesBodySchema } from "./capture";
import type { SummarizeInput, SummaryProvider } from "./provider";

const g = globalThis as unknown as { __tsubuyakiDb?: DatabaseSync };
let savedGlobalDb: DatabaseSync | undefined;
let replacedDb: DatabaseSync | undefined;
const tmpDirs: string[] = [];

afterEach(() => {
  if (replacedDb) {
    g.__tsubuyakiDb = savedGlobalDb;
    replacedDb.close();
    replacedDb = undefined;
    savedGlobalDb = undefined;
  }
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tsubuyaki-capture-"));
  tmpDirs.push(d);
  return d;
}

/** 受け取った入力を記録し、検証に通らない出力を返す（fixture は保存されない） */
function recordingProvider(calls: SummarizeInput[]): SummaryProvider {
  return {
    name: "mock",
    async summarize(input) {
      calls.push(input);
      return { raw: "{}", model: "mock" };
    },
  };
}

describe("captureFixtures（db を渡さない）", () => {
  it("⑤ 材料はメモリの DB の seed の新人A の W1 のメモだけで、getDb() の側に足したメモは入らない", async () => {
    // getDb() の側：seed に加えて、同じ作業名の新しい終了済みの作業と目印のメモを足す（実際のメモの代わり）
    const other = openDb(":memory:");
    seedDemo(other);
    const started = startSession({ userId: "newcomer_a", taskName: DEMO_TASK_W1 }, other, "2026-11-05T10:00:00+09:00");
    if (!started.ok) throw new Error("試験の準備に失敗");
    addNote(
      { sessionId: started.session.id, userId: "newcomer_a", body: "getDb の側だけに足した架空のメモ" },
      other,
      "2026-11-05T10:05:00+09:00",
    );
    endSession(started.session.id, other, "2026-11-05T11:00:00+09:00");
    savedGlobalDb = g.__tsubuyakiDb;
    replacedDb = other;
    g.__tsubuyakiDb = other;
    expect(getDb()).toBe(other);

    const calls: SummarizeInput[] = [];
    const dir = tmpDir();
    const r = await captureFixtures([DEMO_TASK_W1], { provider: recordingProvider(calls), dir });

    expect(calls.length).toBeGreaterThan(0);
    const w1 = DEMO_TASKS.find((t) => t.key === "W1")!;
    for (const c of calls) {
      expect(c.taskName).toBe(DEMO_TASK_W1);
      expect(c.notes.map((n) => n.body)).toEqual(w1.memos.map(([, body]) => body));
      expect(JSON.stringify(c.notes)).not.toContain("getDb の側だけに足した");
    }
    // 出力が検証に通らないので保存されない（一時ディレクトリにも書かれない）
    expect(r).toHaveLength(1);
    expect(r[0].ok).toBe(false);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });
});

describe("CaptureFixturesBodySchema", () => {
  it("⑥ 201 文字の要素・11 件・文字列でない要素・未知の項目は不合格、{}・{ tasks: [] }・{ tasks: [\"x\"], partial: true } は合格", () => {
    const ng = [
      { tasks: ["a".repeat(201)] },
      { tasks: Array.from({ length: 11 }, (_, i) => `t${i}`) },
      { tasks: [1] },
      { tasks: ["x"], extra: true },
      { tasks: [""] },
      { partial: "yes" },
    ];
    for (const b of ng) expect(CaptureFixturesBodySchema.safeParse(b).success).toBe(false);

    const ok = [{}, { tasks: [] }, { tasks: ["x"], partial: true }, { tasks: ["a".repeat(200)] }, { tasks: Array(10).fill("t") }];
    for (const b of ok) expect(CaptureFixturesBodySchema.safeParse(b).success).toBe(true);
  });
});
