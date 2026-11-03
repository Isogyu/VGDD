import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { startSession, addNote, endSession } from "./sessions";
import { summarizeSession, getLatestSummary, countSummaries } from "./summarize";
import { SUMMARY_KEYS } from "./summary-schema";
import type { SummaryProvider, SummarizeInput } from "./ai/provider";
import { ProviderUnavailableError } from "./ai/provider";

function goodRaw(n = 3) {
  const o: Record<string, unknown> = {};
  for (const k of SUMMARY_KEYS) o[k] = { text: `${k} の本文`, evidence: [1] };
  o.ask_human = { text: "既存コードの場所", evidence: [Math.min(3, n)] };
  o.questions = [{ text: "最初に何を確認しましたか？", target: "tried" }];
  return JSON.stringify(o);
}

function mockProvider(outputs: string[], calls: SummarizeInput[] = []): SummaryProvider {
  let i = 0;
  return {
    name: "mock",
    async summarize(input) {
      calls.push(input);
      const raw = outputs[Math.min(i, outputs.length - 1)];
      i++;
      return { raw, model: "mock-model" };
    },
  };
}

function prepare() {
  const db = openDb(":memory:");
  const r = startSession({ userId: "newcomer_a", taskName: "W1" }, db, "2026-11-03T13:00:00+09:00");
  if (!r.ok) throw new Error();
  const ids = ["依頼の意図が分からない", "AI と壁打ち", "既存コードの場所が分からない"].map(
    (b, i) => addNote({ sessionId: r.session.id, userId: "newcomer_a", body: b }, db, `2026-11-03T13:0${i + 1}:00+09:00`).id,
  );
  endSession(r.session.id, db, "2026-11-03T13:30:00+09:00");
  return { db, sessionId: r.session.id, ids };
}

describe("summarizeSession（M4-1〜M4-5）", () => {
  it("正常：1回で通り、保存される。根拠がメモ ID に写る", async () => {
    const { db, sessionId, ids } = prepare();
    const calls: SummarizeInput[] = [];
    const r = await summarizeSession(sessionId, { provider: mockProvider([goodRaw()], calls) }, db);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.attempts).toBe(1);
    expect(r.summary.ask_human.evidence_note_ids).toEqual([ids[2]]);
    expect(r.summary.questions).toHaveLength(1);
    expect(getLatestSummary(sessionId, db)?.summary.struggle.text).toBe("struggle の本文");
    expect(calls[0].notes.map((n) => n.id)).toEqual(ids);
    expect(calls[0].partial).toBe(false);
    expect(calls[0].previousErrors).toBeUndefined();
  });

  it("スキーマ違反なら違反内容を添えて1回やり直し、2回目で通る（M4-3）", async () => {
    const { db, sessionId } = prepare();
    const calls: SummarizeInput[] = [];
    const bad = JSON.stringify({ struggle: { text: "x", evidence: [9] } });
    const r = await summarizeSession(sessionId, { provider: mockProvider([bad, goodRaw()], calls) }, db);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.attempts).toBe(2);
    expect(calls[1].previousErrors?.join("\n")).toMatch(/cause|#9|evidence/);
  });

  it("2回とも違反なら失敗を返し、保存しない", async () => {
    const { db, sessionId } = prepare();
    const r = await summarizeSession(sessionId, { provider: mockProvider(["not json"]) }, db);
    expect(r).toMatchObject({ ok: false, reason: "schema_violation", attempts: 2 });
    expect(countSummaries(sessionId, db)).toBe(0);
  });

  it("除外したメモは provider に渡さず、番号はつめ直される", async () => {
    const { db, sessionId, ids } = prepare();
    const calls: SummarizeInput[] = [];
    const r = await summarizeSession(sessionId, { excludeNoteIds: [ids[1]], provider: mockProvider([goodRaw(2)], calls) }, db);
    expect(r.ok).toBe(true);
    expect(calls[0].notes.map((n) => n.id)).toEqual([ids[0], ids[2]]);
    if (r.ok) expect(r.summary.source_note_ids).toEqual([ids[0], ids[2]]);
  });

  it("やり直しは1回まで（3回目の整理は rerun_limit）", async () => {
    const { db, sessionId } = prepare();
    const p = mockProvider([goodRaw()]);
    expect((await summarizeSession(sessionId, { provider: p }, db)).ok).toBe(true);
    expect((await summarizeSession(sessionId, { provider: p }, db)).ok).toBe(true);
    const third = await summarizeSession(sessionId, { provider: p }, db);
    expect(third).toMatchObject({ ok: false, reason: "rerun_limit" });
    expect(countSummaries(sessionId, db)).toBe(2);
  });

  it("途中整理（partial）は保存しない", async () => {
    const { db, sessionId } = prepare();
    const calls: SummarizeInput[] = [];
    const r = await summarizeSession(sessionId, { partial: true, provider: mockProvider([goodRaw()], calls) }, db);
    expect(r.ok).toBe(true);
    expect(calls[0].partial).toBe(true);
    expect(countSummaries(sessionId, db)).toBe(0);
  });

  it("provider が使えない（デモモードで fixture なし等）は provider_unavailable", async () => {
    const { db, sessionId } = prepare();
    const p: SummaryProvider = {
      name: "demo",
      async summarize() {
        throw new ProviderUnavailableError("デモモードでは整理できません");
      },
    };
    const r = await summarizeSession(sessionId, { provider: p }, db);
    expect(r).toMatchObject({ ok: false, reason: "provider_unavailable" });
  });

  it("メモがなければ no_notes", async () => {
    const db = openDb(":memory:");
    const s = startSession({ userId: "newcomer_a", taskName: "空" }, db);
    if (!s.ok) throw new Error();
    const r = await summarizeSession(s.session.id, { provider: mockProvider([goodRaw()]) }, db);
    expect(r).toMatchObject({ ok: false, reason: "no_notes" });
  });
});
