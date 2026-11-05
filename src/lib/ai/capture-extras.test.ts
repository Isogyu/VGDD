// デモ用の保存済みの AI 出力（手順書の原案・AI の検出）の採取（T-020）の試験。
// Claude の API は呼ばない（mock と demo だけ）。データは seed の合成データ（すべて架空）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { getDb, openDb } from "../db";
import { seedDemo, DEMO_TASK_W1 } from "../seed";
import { generateProcedure, listProcedureSources } from "../procedure";
import { checkSensitiveWithAi } from "../ai-sensitive";
import { getLatestSummary } from "../summarize";
import { buildShareDraft } from "../sharing";
import {
  captureDemoExtras,
  captureProcedureFixtures,
  captureSensitiveFixtures,
  checkCaptureRequest,
  demoSensitiveTexts,
} from "./capture-extras";
import {
  DemoProcedureProvider,
  procedureFixturePath,
  type ProcedureInput,
  type ProcedureProvider,
} from "./procedure-provider";
import {
  DemoSensitiveProvider,
  sensitiveFixturePath,
  type SensitiveInput,
  type SensitiveProvider,
} from "./sensitive-provider";

const GOOD_PROCEDURE = JSON.stringify({
  steps: [
    { text: "依頼を受けたら成果物の形を確認する", evidence: [1, 2] },
    { text: "既存のスクリプトの場所を先に聞く", evidence: [2] },
  ],
  decision_points: [{ text: "列の順を変えるとき", reason: "列の番号で読む表計算が壊れるため", evidence: [2] }],
});
const BAD = "これは JSON ではない";
const GOOD_SENSITIVE = JSON.stringify({
  candidates: [{ match: "tools フォルダ", kind: "other", reason: "社内の置き場所が分かるため" }],
});

function procedureMock(outputs: string[], calls: ProcedureInput[] = []): ProcedureProvider {
  let i = 0;
  return {
    name: "mock",
    async generate(input) {
      calls.push(structuredClone(input));
      const raw = outputs[Math.min(i, outputs.length - 1)];
      i++;
      return { raw, model: "mock-model" };
    },
  };
}

function sensitiveMock(outputs: string[], calls: SensitiveInput[] = []): SensitiveProvider {
  let i = 0;
  return {
    name: "mock",
    async check(input) {
      calls.push(structuredClone(input));
      const raw = outputs[Math.min(i, outputs.length - 1)];
      i++;
      return { raw, model: "mock-model" };
    },
  };
}

const tmpDirs: string[] = [];
function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "capture-extras-"));
  tmpDirs.push(d);
  return d;
}

function seeded(): DatabaseSync {
  const db = openDb(":memory:");
  seedDemo(db);
  return db;
}

function addShare(db: DatabaseSync, body: string, at: string, task = DEMO_TASK_W1): void {
  db.prepare("INSERT INTO shared_knowledge (task_name, user_id, body, approved_at) VALUES (?, 'newcomer_b', ?, ?)").run(
    task,
    body,
    at,
  );
}

const g = globalThis as unknown as { __tsubuyakiDb?: DatabaseSync };
let savedGlobalDb: DatabaseSync | undefined;
let replacedGlobalDb = false;

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  if (replacedGlobalDb) {
    g.__tsubuyakiDb = savedGlobalDb;
    replacedGlobalDb = false;
  }
});

describe("captureProcedureFixtures", () => {
  it("① 承認済みの共有が1件なら provider を呼ばずに ng", async () => {
    const db = openDb(":memory:");
    addShare(db, "架空の手順の共有", "2026-11-01T10:00:00+09:00");
    const calls: ProcedureInput[] = [];
    const dir = tmpDir();
    const r = await captureProcedureFixtures([DEMO_TASK_W1], { provider: procedureMock([GOOD_PROCEDURE], calls), dir }, db);
    expect(r).toEqual([
      { kind: "procedure", key: DEMO_TASK_W1, ok: false, attempts: 0, errors: ["承認済みの共有が2件未満"] },
    ]);
    expect(calls).toHaveLength(0);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("② 正しい出力で fixture ができ、DemoProcedureProvider で generateProcedure が成功する（往復）", async () => {
    const db = seeded();
    const dir = tmpDir();
    const r = await captureProcedureFixtures([DEMO_TASK_W1], { provider: procedureMock([GOOD_PROCEDURE]), dir }, db);
    expect(r).toHaveLength(1);
    expect(r[0].ok).toBe(true);
    expect(r[0].attempts).toBe(1);
    expect(r[0].path).toBe(procedureFixturePath(DEMO_TASK_W1, dir));
    const text = fs.readFileSync(r[0].path!, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    const fx = JSON.parse(text);
    expect(Object.keys(fx)).toEqual(["task_name", "model", "captured_at", "sources_fingerprint", "raw"]);
    expect(fx.raw).toBe(GOOD_PROCEDURE);

    const g2 = await generateProcedure(DEMO_TASK_W1, { provider: new DemoProcedureProvider(dir) }, db);
    expect(g2.ok).toBe(true);
    if (g2.ok) expect(g2.procedure.steps).toHaveLength(2);
  });

  it("② 1回目が違反なら previousErrors つきでもう1回だけ呼ぶ", async () => {
    const db = seeded();
    const calls: ProcedureInput[] = [];
    const r = await captureProcedureFixtures(
      [DEMO_TASK_W1],
      { provider: procedureMock([BAD, GOOD_PROCEDURE], calls), dir: tmpDir() },
      db,
    );
    expect(r[0].ok).toBe(true);
    expect(r[0].attempts).toBe(2);
    expect(calls[0].previousErrors).toBeUndefined();
    expect(calls[1].previousErrors).toEqual(["出力が JSON として解釈できない"]);
  });

  it("③ 2回とも壊れた出力ならファイルができない", async () => {
    const db = seeded();
    const dir = tmpDir();
    const calls: ProcedureInput[] = [];
    const r = await captureProcedureFixtures([DEMO_TASK_W1], { provider: procedureMock([BAD], calls), dir }, db);
    expect(r[0]).toMatchObject({ kind: "procedure", ok: false, attempts: 2 });
    expect(r[0].errors?.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(2);
    expect(fs.existsSync(procedureFixturePath(DEMO_TASK_W1, dir))).toBe(false);
  });

  it("⑧ 共有が21件なら provider を呼ばずに ng", async () => {
    const db = openDb(":memory:");
    for (let i = 0; i < 21; i++) addShare(db, `架空の共有 ${i}`, `2026-11-01T10:${String(i).padStart(2, "0")}:00+09:00`);
    expect(listProcedureSources(DEMO_TASK_W1, db)).toHaveLength(21);
    const calls: ProcedureInput[] = [];
    const r = await captureProcedureFixtures([DEMO_TASK_W1], { provider: procedureMock([GOOD_PROCEDURE], calls), dir: tmpDir() }, db);
    expect(r).toEqual([{ kind: "procedure", key: DEMO_TASK_W1, ok: false, attempts: 0, errors: ["材料が多すぎる"] }]);
    expect(calls).toHaveLength(0);
  });

  it("⑧ 本文の合計が20000文字を超えるなら provider を呼ばずに ng", async () => {
    const db = openDb(":memory:");
    addShare(db, "あ".repeat(10000), "2026-11-01T10:00:00+09:00");
    addShare(db, "い".repeat(10001), "2026-11-01T11:00:00+09:00");
    const calls: ProcedureInput[] = [];
    const r = await captureProcedureFixtures([DEMO_TASK_W1], { provider: procedureMock([GOOD_PROCEDURE], calls), dir: tmpDir() }, db);
    expect(r[0].errors).toEqual(["材料が多すぎる"]);
    expect(calls).toHaveLength(0);
  });
});

describe("captureSensitiveFixtures", () => {
  it("④ AI の検出の fixture ができ、DemoSensitiveProvider で checkSensitiveWithAi が成功する（往復）", async () => {
    const text = demoSensitiveTexts(seeded())[0];
    const dir = tmpDir();
    const r = await captureSensitiveFixtures([text], { provider: sensitiveMock([GOOD_SENSITIVE]), dir });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "sensitive", key: text.slice(0, 20), ok: true, attempts: 1, model: "mock-model" });
    expect(r[0].path).toBe(sensitiveFixturePath(text, dir));
    const fileText = fs.readFileSync(r[0].path!, "utf8");
    expect(fileText.endsWith("\n")).toBe(true);
    expect(JSON.parse(fileText)).toEqual({ model: "mock-model", raw: GOOD_SENSITIVE });

    const c = await checkSensitiveWithAi(text, { provider: new DemoSensitiveProvider(dir) });
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.ai.map((f) => f.match)).toContain("tools フォルダ");
  });

  it("⑤ 2001文字の本文は provider を呼ばずに ng", async () => {
    const calls: SensitiveInput[] = [];
    const dir = tmpDir();
    const text = "あ".repeat(2001);
    const r = await captureSensitiveFixtures([text], { provider: sensitiveMock([GOOD_SENSITIVE], calls), dir });
    expect(r).toEqual([{ kind: "sensitive", key: "あ".repeat(20), ok: false, attempts: 0, errors: ["本文が長すぎる"] }]);
    expect(calls).toHaveLength(0);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("⑨ 空の配列なら「採取する本文がない」の ng を1件返す", async () => {
    const calls: SensitiveInput[] = [];
    const r = await captureSensitiveFixtures([], { provider: sensitiveMock([GOOD_SENSITIVE], calls), dir: tmpDir() });
    expect(r).toEqual([{ kind: "sensitive", key: "-", ok: false, attempts: 0, errors: ["採取する本文がない"] }]);
    expect(calls).toHaveLength(0);
  });

  it("⑩ 空白だけの本文は provider を呼ばずに ng でファイルができない", async () => {
    const calls: SensitiveInput[] = [];
    const dir = tmpDir();
    const r = await captureSensitiveFixtures(["  \n　 "], { provider: sensitiveMock([GOOD_SENSITIVE], calls), dir });
    expect(r[0]).toMatchObject({ kind: "sensitive", ok: false, attempts: 0, errors: ["本文が空"] });
    expect(calls).toHaveLength(0);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("⑩ 2回とも壊れた出力の本文は ng でファイルができない（2回目は previousErrors つき）", async () => {
    const calls: SensitiveInput[] = [];
    const dir = tmpDir();
    const text = "架空の会社の打ち合わせの記録";
    const r = await captureSensitiveFixtures([text], { provider: sensitiveMock([BAD], calls), dir });
    expect(r[0]).toMatchObject({ kind: "sensitive", key: text.slice(0, 20), ok: false, attempts: 2 });
    expect(r[0].errors).toEqual(["出力が JSON として解釈できない"]);
    expect(calls).toHaveLength(2);
    expect(calls[0].previousErrors).toBeUndefined();
    expect(calls[1].previousErrors).toEqual(["出力が JSON として解釈できない"]);
    expect(fs.existsSync(sensitiveFixturePath(text, dir))).toBe(false);
  });
});

describe("demoSensitiveTexts", () => {
  it("⑥ seed の後に1件で、buildShareDraft の本文と同じ", () => {
    const db = seeded();
    const texts = demoSensitiveTexts(db);
    expect(texts).toHaveLength(1);
    const sid = (
      db
        .prepare("SELECT id FROM work_sessions WHERE user_id = 'newcomer_a' AND task_name = ? AND status = 'ended' ORDER BY ended_at DESC, id DESC LIMIT 1")
        .get(DEMO_TASK_W1) as { id: number }
    ).id;
    const latest = getLatestSummary(Number(sid), db);
    expect(latest).not.toBeNull();
    expect(texts[0]).toBe(buildShareDraft(latest!.summary));
  });

  it("⑥ 作業がなければ空の配列", () => {
    expect(demoSensitiveTexts(openDb(":memory:"))).toEqual([]);
  });
});

describe("captureDemoExtras", () => {
  it("⑦ mock が受け取った入力に、メモの本文（notes の表の本文）が入らない", async () => {
    const pCalls: ProcedureInput[] = [];
    const sCalls: SensitiveInput[] = [];
    const r = await captureDemoExtras("all", {
      procedureProvider: procedureMock([GOOD_PROCEDURE], pCalls),
      sensitiveProvider: sensitiveMock([GOOD_SENSITIVE], sCalls),
      dir: tmpDir(),
    });
    expect(r.ok).toBe(true);
    expect(pCalls.length).toBeGreaterThan(0);
    expect(sCalls.length).toBeGreaterThan(0);
    const notes = (seeded().prepare("SELECT body FROM notes").all() as { body: string }[]).map((n) => n.body);
    expect(notes.length).toBeGreaterThan(0);
    const sent = JSON.stringify([pCalls, sCalls]);
    for (const body of notes) expect(sent.includes(body)).toBe(false);
  });

  it("⑪ getDb() の側の DB に足した共有を材料にしない（mock の受け取った sources が seed の2件だけ）", async () => {
    const other = openDb(":memory:");
    seedDemo(other);
    addShare(other, "試験の中で getDb の側だけに足した架空の共有", "2026-11-02T09:00:00+09:00");
    savedGlobalDb = g.__tsubuyakiDb;
    replacedGlobalDb = true;
    g.__tsubuyakiDb = other;
    expect(listProcedureSources(DEMO_TASK_W1, getDb())).toHaveLength(3);

    const pCalls: ProcedureInput[] = [];
    const r = await captureDemoExtras("all", {
      procedureProvider: procedureMock([GOOD_PROCEDURE], pCalls),
      sensitiveProvider: sensitiveMock([GOOD_SENSITIVE]),
      dir: tmpDir(),
    });
    expect(r.ok).toBe(true);
    expect(pCalls).toHaveLength(1);
    expect(pCalls[0].sources).toHaveLength(2);
    expect(pCalls[0].sources.map((s) => s.body)).toEqual(listProcedureSources(DEMO_TASK_W1, seeded()).map((s) => s.body));
    expect(JSON.stringify(pCalls[0].sources)).not.toContain("getDb の側だけに足した");
  });

  it("A4 の ok の規則：要求した種別だけを採り、どれかが ng なら ok は false", async () => {
    const dir = tmpDir();
    const onlyProcedure = await captureDemoExtras("procedure", { procedureProvider: procedureMock([GOOD_PROCEDURE]), dir });
    expect(onlyProcedure.ok).toBe(true);
    expect(onlyProcedure.results.map((x) => x.kind)).toEqual(["procedure"]);

    const onlySensitive = await captureDemoExtras("sensitive", { sensitiveProvider: sensitiveMock([GOOD_SENSITIVE]), dir });
    expect(onlySensitive.ok).toBe(true);
    expect(onlySensitive.results.map((x) => x.kind)).toEqual(["sensitive"]);

    const partlyBad = await captureDemoExtras("all", {
      procedureProvider: procedureMock([GOOD_PROCEDURE]),
      sensitiveProvider: sensitiveMock([BAD]),
      dir,
    });
    expect(partlyBad.ok).toBe(false);
    expect(partlyBad.results.map((x) => [x.kind, x.ok])).toEqual([
      ["procedure", true],
      ["sensitive", false],
    ]);
  });
});

describe("checkCaptureRequest（⑫ ルートの要求の判定）", () => {
  // 通る要求を基準に、1項目ずつ変えて試す
  const base = { nodeEnv: "development", origin: null, contentType: "application/json", body: {} } as const;

  it("⑫ development でなければ 404 not_found（production・test・未設定）", () => {
    for (const nodeEnv of ["production", "test", undefined]) {
      expect(checkCaptureRequest({ ...base, nodeEnv })).toEqual({ ok: false, status: 404, error: "not_found" });
    }
  });

  it("⑫ Origin があれば 403 forbidden_origin（http://localhost:3000 でも、空文字でも）", () => {
    for (const origin of ["http://localhost:3000", "https://example.invalid", ""]) {
      expect(checkCaptureRequest({ ...base, origin })).toEqual({ ok: false, status: 403, error: "forbidden_origin" });
    }
  });

  it("⑫ Content-Type が application/json で始まらなければ 415 unsupported_media_type", () => {
    for (const contentType of [null, "", "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]) {
      expect(checkCaptureRequest({ ...base, contentType })).toEqual({
        ok: false,
        status: 415,
        error: "unsupported_media_type",
      });
    }
  });

  it("⑫ Content-Type は大文字・charset つきでも application/json なら通る", () => {
    expect(checkCaptureRequest({ ...base, contentType: "Application/JSON; charset=utf-8" })).toEqual({
      ok: true,
      kind: "all",
    });
  });

  it("⑫ body が undefined・null・配列・文字列・未知の項目つき・kind が3つ以外なら 400 invalid_body", () => {
    const bad: unknown[] = [
      undefined,
      null,
      [],
      [{ kind: "all" }],
      "all",
      '{"kind":"all"}',
      42,
      { kind: "all", extra: 1 },
      { other: "x" },
      { kind: "summary" },
      { kind: "" },
      { kind: null },
      { kind: 1 },
    ];
    for (const body of bad) {
      expect(checkCaptureRequest({ ...base, body })).toEqual({ ok: false, status: 400, error: "invalid_body" });
    }
  });

  it("⑫ {} なら kind: all、kind を指定すればその kind", () => {
    expect(checkCaptureRequest(base)).toEqual({ ok: true, kind: "all" });
    for (const kind of ["procedure", "sensitive", "all"] as const) {
      expect(checkCaptureRequest({ ...base, body: { kind } })).toEqual({ ok: true, kind });
    }
  });

  it("⑫ 判定の順は 404 → 403 → 415 → 400", () => {
    const allBad = { nodeEnv: "production", origin: "http://localhost:3000", contentType: "text/plain", body: null };
    expect(checkCaptureRequest(allBad)).toMatchObject({ ok: false, status: 404 });
    expect(checkCaptureRequest({ ...allBad, nodeEnv: "development" })).toMatchObject({ ok: false, status: 403 });
    expect(checkCaptureRequest({ ...allBad, nodeEnv: "development", origin: null })).toMatchObject({
      ok: false,
      status: 415,
    });
    expect(
      checkCaptureRequest({ ...allBad, nodeEnv: "development", origin: null, contentType: "application/json" }),
    ).toMatchObject({ ok: false, status: 400 });
    // nodeEnv が違い origin もある入力は 404
    expect(checkCaptureRequest({ ...base, nodeEnv: "production", origin: "http://localhost:3000" })).toEqual({
      ok: false,
      status: 404,
      error: "not_found",
    });
  });
});
