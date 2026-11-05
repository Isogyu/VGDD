// 手順書の原案（T-012）の試験。Claude の API は呼ばない（mock と demo だけ）。データはすべて架空。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "./db";
import { startSession, addNote } from "./sessions";
import {
  generateProcedure,
  listProcedureSources,
  validateProcedure,
  PROCEDURE_NOTICE,
} from "./procedure";
import {
  buildProcedurePrompt,
  DemoProcedureProvider,
  procedureFixturePath,
  sourcesFingerprint,
  type ProcedureInput,
  type ProcedureProvider,
} from "./ai/procedure-provider";
import { ProviderUnavailableError } from "./ai/provider";

const TASK = "架空の月次集計";

function addKnowledge(
  db: DatabaseSync,
  o: { task?: string; user?: string; body: string; at: string; withdrawn?: string | null },
): number {
  const r = db
    .prepare("INSERT INTO shared_knowledge (task_name, user_id, body, approved_at, withdrawn_at) VALUES (?, ?, ?, ?, ?)")
    .run(o.task ?? TASK, o.user ?? "newcomer_a", o.body, o.at, o.withdrawn ?? null);
  return Number(r.lastInsertRowid);
}

function withdraw(db: DatabaseSync, id: number) {
  db.prepare("UPDATE shared_knowledge SET withdrawn_at = ? WHERE id = ?").run("2026-11-05T10:00:00+09:00", id);
}

/** 共有3件（新人A・先輩C・新人B）の DB */
function prepare() {
  const db = openDb(":memory:");
  const ids = [
    addKnowledge(db, { user: "newcomer_a", body: "集計表は前月の版を複製してから始める", at: "2026-11-03T10:00:00+09:00" }),
    addKnowledge(db, { user: "senior_c", body: "締め日の後に届いた分は翌月に回す。二重計上を防ぐため", at: "2026-11-03T11:00:00+09:00" }),
    addKnowledge(db, { user: "newcomer_b", body: "合計が前月と大きく違うときは先輩に確認する", at: "2026-11-04T09:30:00+09:00" }),
  ];
  return { db, ids };
}

function goodRaw() {
  return JSON.stringify({
    steps: [
      { text: "  前月の集計表を複製する ", evidence: [1, 1] },
      { text: "締め日の後の分を分ける", evidence: [2] },
      { text: "保存する", evidence: [] },
    ],
    decision_points: [{ text: "締め日の後に届いた分", reason: " 二重計上を防ぐため ", evidence: [2, 3] }],
  });
}

function mockProvider(
  outputs: (string | ((input: ProcedureInput) => string))[],
  calls: ProcedureInput[] = [],
): ProcedureProvider {
  let i = 0;
  return {
    name: "mock",
    async generate(input) {
      calls.push(input);
      const o = outputs[Math.min(i, outputs.length - 1)];
      i++;
      return { raw: typeof o === "function" ? o(input) : o, model: "mock-model" };
    },
  };
}

describe("listProcedureSources", () => {
  it("② 取り下げ済みの共有は数えない", () => {
    const { db, ids } = prepare();
    withdraw(db, ids[1]);
    const s = listProcedureSources(TASK, db);
    expect(s.map((x) => x.knowledge_id)).toEqual([ids[0], ids[2]]);
    expect(s.map((x) => x.n)).toEqual([1, 2]);
  });

  it("③ 別の作業名の共有は入らない。作業名は正規化して照合し、承認日時・id の昇順", () => {
    const { db, ids } = prepare();
    addKnowledge(db, { task: "架空の別作業", body: "別作業の共有", at: "2026-11-02T09:00:00+09:00" });
    const early = addKnowledge(db, { body: "一番早い共有", at: "2026-11-02T08:00:00+09:00" });
    const s = listProcedureSources(`  ${TASK}  `, db);
    expect(s.map((x) => x.knowledge_id)).toEqual([early, ...ids]);
    expect(s.some((x) => x.body === "別作業の共有")).toBe(false);
    expect(s[1]).toMatchObject({ n: 2, display_name: "新人A", role: "newcomer" });
    expect(s[2]).toMatchObject({ display_name: "先輩C", role: "senior" });
  });
});

describe("generateProcedure", () => {
  it("① 共有が1件なら insufficient_records で count: 1、provider は呼ばれない", async () => {
    const db = openDb(":memory:");
    addKnowledge(db, { body: "ただ1件の共有", at: "2026-11-03T10:00:00+09:00" });
    const calls: ProcedureInput[] = [];
    const r = await generateProcedure(TASK, { provider: mockProvider([goodRaw()], calls) }, db);
    expect(r).toMatchObject({ ok: false, reason: "insufficient_records", count: 1, attempts: 0 });
    if (!r.ok) expect(r.message).toBe("記録が不足しています（承認済みの共有が2件以上必要です。いまは 1 件）");
    expect(calls).toHaveLength(0);
  });

  it("② 取り下げで1件になれば insufficient_records", async () => {
    const db = openDb(":memory:");
    addKnowledge(db, { body: "残る共有", at: "2026-11-03T10:00:00+09:00" });
    addKnowledge(db, { body: "取り下げた共有", at: "2026-11-03T11:00:00+09:00", withdrawn: "2026-11-04T10:00:00+09:00" });
    const r = await generateProcedure(TASK, { provider: mockProvider([goodRaw()]) }, db);
    expect(r).toMatchObject({ ok: false, reason: "insufficient_records", count: 1 });
  });

  it("④ 正しい出力で、evidence の番号が共有に写り、空の evidence は inferred: true", async () => {
    const { db, ids } = prepare();
    const calls: ProcedureInput[] = [];
    const r = await generateProcedure(TASK, { provider: mockProvider([goodRaw()], calls) }, db);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.attempts).toBe(1);
    expect(r.model).toBe("mock-model");
    const p = r.procedure;
    expect(p.schema).toBe("tsubuyaki.procedure.v1");
    expect(p.task_name).toBe(TASK);
    expect(p.source_ids).toEqual(ids);
    expect(p.steps[0]).toEqual({
      text: "前月の集計表を複製する",
      evidence: [{ knowledge_id: ids[0], display_name: "新人A", approved_at: "2026-11-03T10:00:00+09:00" }],
      inferred: false,
    });
    expect(p.steps[2]).toEqual({ text: "保存する", evidence: [], inferred: true });
    expect(p.decision_points[0].reason).toBe("二重計上を防ぐため");
    expect(p.decision_points[0].evidence.map((e) => e.knowledge_id)).toEqual([ids[1], ids[2]]);
    expect(p.decision_points[0].evidence[0].display_name).toBe("先輩C");
    expect(calls[0].previousErrors).toBeUndefined();
    expect(PROCEDURE_NOTICE).toBe("原案。利用前に本人・先輩の確認が必要");
  });

  it("⑤ 1回目が JSON でなく2回目が正しければ attempts: 2 で成功し、2回目の previousErrors が空でない", async () => {
    const { db } = prepare();
    const calls: ProcedureInput[] = [];
    const r = await generateProcedure(TASK, { provider: mockProvider(["これは JSON ではない", goodRaw()], calls) }, db);
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(calls).toHaveLength(2);
    expect(calls[1].previousErrors?.length ?? 0).toBeGreaterThan(0);
    expect(calls[1].previousErrors).toContain("出力が JSON として解釈できない");
  });

  it("⑥ 2回とも違反なら schema_violation", async () => {
    const { db } = prepare();
    const calls: ProcedureInput[] = [];
    const r = await generateProcedure(TASK, { provider: mockProvider(['{"steps":[]}'], calls) }, db);
    expect(r).toMatchObject({ ok: false, reason: "schema_violation", attempts: 2 });
    if (!r.ok) expect(r.errors?.length ?? 0).toBeGreaterThan(0);
    expect(calls).toHaveLength(2);
  });

  it("⑧ provider が ProviderUnavailableError を投げれば provider_unavailable", async () => {
    const { db } = prepare();
    const p: ProcedureProvider = {
      name: "mock",
      async generate() {
        throw new ProviderUnavailableError("使えません（試験）");
      },
    };
    const r = await generateProcedure(TASK, { provider: p }, db);
    expect(r).toMatchObject({ ok: false, reason: "provider_unavailable", message: "使えません（試験）", attempts: 1 });
  });

  it("⑩ 共有が21件なら too_large で provider は呼ばれない", async () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 21; i++) {
      addKnowledge(db, { body: `架空の共有 ${i}`, at: `2026-11-03T10:${String(i).padStart(2, "0")}:00+09:00` });
    }
    const calls: ProcedureInput[] = [];
    const r = await generateProcedure(TASK, { provider: mockProvider([goodRaw()], calls) }, db);
    expect(r).toMatchObject({ ok: false, reason: "too_large", count: 21, attempts: 0 });
    expect(calls).toHaveLength(0);
  });

  it("⑩ 本文の合計が 20000 字を超えても too_large", async () => {
    const db = openDb(":memory:");
    addKnowledge(db, { body: "あ".repeat(10000), at: "2026-11-03T10:00:00+09:00" });
    addKnowledge(db, { body: "い".repeat(10001), at: "2026-11-03T11:00:00+09:00" });
    const calls: ProcedureInput[] = [];
    const r = await generateProcedure(TASK, { provider: mockProvider([goodRaw()], calls) }, db);
    expect(r).toMatchObject({ ok: false, reason: "too_large", count: 2 });
    expect(calls).toHaveLength(0);
  });

  it("⑪ 1回目の呼び出しの中で共有を1件取り下げると sources_changed", async () => {
    const { db, ids } = prepare();
    const p = mockProvider([
      () => {
        withdraw(db, ids[2]);
        return goodRaw();
      },
    ]);
    const r = await generateProcedure(TASK, { provider: p }, db);
    expect(r).toMatchObject({
      ok: false,
      reason: "sources_changed",
      message: "生成の途中で共有が変わりました。もう一度作ってください",
    });
  });

  it("⑫ provider が本文を含む普通の Error を投げると provider_unavailable で、message に本文が入らない", async () => {
    const { db } = prepare();
    const secret = "締め日の後に届いた分は翌月に回す";
    const p: ProcedureProvider = {
      name: "mock",
      async generate() {
        throw new Error(`失敗：${secret}`);
      },
    };
    const r = await generateProcedure(TASK, { provider: p }, db);
    expect(r).toMatchObject({ ok: false, reason: "provider_unavailable", message: "AI の呼び出しに失敗しました" });
    expect(JSON.stringify(r)).not.toContain(secret);
  });
});

describe("validateProcedure", () => {
  it("⑦ 範囲外の番号（sources.length + 1）は違反", () => {
    const { db } = prepare();
    const sources = listProcedureSources(TASK, db);
    const raw = JSON.stringify({ steps: [{ text: "手順", evidence: [sources.length + 1] }], decision_points: [] });
    const v = validateProcedure(raw, sources);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors).toEqual(["steps.0.evidence.0: 番号 4 は 1〜3 の外"]);
    const zero = validateProcedure({ steps: [{ text: "手順", evidence: [0] }], decision_points: [] }, sources);
    expect(zero.ok).toBe(false);
  });

  it("⑬ 違反の errors に、出力に入れた目印の文字列が入らない", () => {
    const { db } = prepare();
    const sources = listProcedureSources(TASK, db);
    const mark = "MARK_架空の目印_7Q";
    const raws: unknown[] = [
      JSON.stringify({ steps: [{ text: mark.repeat(40), evidence: [] }], decision_points: [] }),
      JSON.stringify({ steps: [{ text: "手順", evidence: [], [mark]: mark }], decision_points: [] }),
      JSON.stringify({ steps: [{ text: "手順", evidence: [mark] }], decision_points: [], [mark]: 1 }),
      JSON.stringify({ steps: [{ text: 1, evidence: [] }], decision_points: [{ text: mark, reason: "", evidence: [] }] }),
      `${mark} {"steps": ${mark}}`,
      { steps: mark },
    ];
    for (const raw of raws) {
      const v = validateProcedure(raw, sources);
      expect(v.ok).toBe(false);
      if (!v.ok) {
        expect(v.errors.length).toBeGreaterThan(0);
        expect(v.errors.length).toBeLessThanOrEqual(10);
        expect(v.errors.join("\n")).not.toContain("MARK");
      }
    }
  });

  it("コードフェンスと前後の説明文を除いて読む。errors は最大10件", () => {
    const { db } = prepare();
    const sources = listProcedureSources(TASK, db);
    const v = validateProcedure("説明です\n```json\n" + goodRaw() + "\n```\n以上", sources);
    expect(v.ok).toBe(true);
    const many = { steps: Array.from({ length: 12 }, () => ({ text: "", evidence: [] })), decision_points: [] };
    const w = validateProcedure(many, sources);
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.errors).toHaveLength(10);
  });
});

describe("buildProcedurePrompt", () => {
  it("⑨ 共有の本文と 先輩／新人 の区別が入り、notes の表に入れた本文は入らない", () => {
    const { db } = prepare();
    const s = startSession({ userId: "newcomer_a", taskName: TASK }, db, "2026-11-03T09:00:00+09:00");
    if (!s.ok) throw new Error("セッションを作れない");
    const rawNote = "承認していない原文のメモ_架空";
    addNote({ sessionId: s.session.id, userId: "newcomer_a", body: rawNote }, db, "2026-11-03T09:05:00+09:00");
    const sources = listProcedureSources(TASK, db);
    const prompt = buildProcedurePrompt({ taskName: TASK, sources });
    expect(prompt).toContain("#1 [新人A・新人・2026-11-03 10:00] 集計表は前月の版を複製してから始める");
    expect(prompt).toContain("#2 [先輩C・先輩・2026-11-03 11:00] 締め日の後に届いた分は翌月に回す。二重計上を防ぐため");
    expect(prompt).toContain(TASK);
    expect(prompt).not.toContain(rawNote);
    expect(prompt).not.toContain("前回の出力の問題");
    const retry = buildProcedurePrompt({ taskName: TASK, sources, previousErrors: ["steps: too_small"] });
    expect(retry).toContain("前回の出力の問題");
    expect(retry).toContain("steps: too_small");
  });

  it("⑨ generateProcedure が provider に渡す材料にも原文のメモは入らない", async () => {
    const { db } = prepare();
    const s = startSession({ userId: "newcomer_b", taskName: TASK }, db, "2026-11-03T09:00:00+09:00");
    if (!s.ok) throw new Error("セッションを作れない");
    const rawNote = "承認していない原文のメモ_その2";
    addNote({ sessionId: s.session.id, userId: "newcomer_b", body: rawNote }, db, "2026-11-03T09:05:00+09:00");
    const calls: ProcedureInput[] = [];
    await generateProcedure(TASK, { provider: mockProvider([goodRaw()], calls) }, db);
    expect(JSON.stringify(calls[0])).not.toContain(rawNote);
    expect(buildProcedurePrompt(calls[0])).not.toContain(rawNote);
  });
});

describe("DemoProcedureProvider", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("⑭ 一時ディレクトリの fixture を読める。ない作業名・指紋が違うときは ProviderUnavailableError", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "procedure-fx-"));
    dirs.push(dir);
    const { db, ids } = prepare();
    const sources = listProcedureSources(TASK, db);
    const file = procedureFixturePath(TASK, dir);
    expect(path.basename(file)).toMatch(/^procedure-[0-9a-f]{8}\.json$/);
    fs.writeFileSync(
      file,
      JSON.stringify({
        task_name: TASK,
        model: "claude-test",
        captured_at: "2026-11-05T12:00:00+09:00",
        sources_fingerprint: sourcesFingerprint(sources),
        raw: goodRaw(),
      }),
    );
    const demo = new DemoProcedureProvider(dir);
    const out = await demo.generate({ taskName: TASK, sources });
    expect(out).toEqual({ raw: goodRaw(), model: "demo(claude-test)" });

    // demo provider を通して generateProcedure も成功する
    const r = await generateProcedure(TASK, { provider: demo }, db);
    expect(r).toMatchObject({ ok: true, model: "demo(claude-test)" });

    // ない作業名
    await expect(demo.generate({ taskName: "架空の存在しない作業", sources })).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(demo.generate({ taskName: "架空の存在しない作業", sources })).rejects.toThrow(
      "デモモードでは、この作業名の保存済みの手順書の原案がありません。ANTHROPIC_API_KEY を設定すると Claude で作れます",
    );

    // 共有を1件取り下げた後は指紋が違う
    withdraw(db, ids[0]);
    const after = listProcedureSources(TASK, db);
    await expect(demo.generate({ taskName: TASK, sources: after })).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(demo.generate({ taskName: TASK, sources: after })).rejects.toThrow("保存済みの原案は、いまの共有と一致しません");
  });

  it("⑭ sources_fingerprint がない fixture は ProviderUnavailableError", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "procedure-fx-"));
    dirs.push(dir);
    const { db } = prepare();
    const sources = listProcedureSources(TASK, db);
    fs.writeFileSync(procedureFixturePath(TASK, dir), JSON.stringify({ task_name: TASK, model: "m", raw: goodRaw() }));
    await expect(new DemoProcedureProvider(dir).generate({ taskName: TASK, sources })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });
});
