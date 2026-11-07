// 要件確認の保存（store.ts）と API（src/app/api/requirements/**）の試験。T-043 A6。
// DB は :memory:。Z3 は本物を読まず、一時フォルダに合成の Z3 の場所を作り、VGDD_Z3_DIR で指す。
// API はポートを bind せず、ルートの関数に Request を直接渡す。データはすべて合成（架空の会社・人物）。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MEMORY_DB,
  RequirementsStoreError,
  closeRequirementsStore,
  openRequirementsStore,
  readJsonBody,
  resolveDbPath,
  type RequirementsStore,
} from "./store";
import { ASSIST_SCHEMA, type Answers, type RequirementRecord } from "./model";
import * as listRoute from "@/app/api/requirements/route";
import * as itemRoute from "@/app/api/requirements/[id]/route";

const FILLED: Answers = {
  "problem.who": { text: "架空の株式会社ミナミ商事の経理担当", unknown: false },
  "problem.goal": { text: "請求書の金額の確認が1件1分で終わる", unknown: false },
  "behavior.example": { text: "発注書が 12,000 円で請求書が 12,000 円なら「一致」と出る", unknown: false },
  "constraints.out_of_scope": { text: "支払いの実行はしない", unknown: false },
};

function assist(rec: Pick<RequirementRecord, "id" | "answers_version">, n = 1) {
  return {
    schema: ASSIST_SCHEMA,
    record_id: rec.id,
    answers_version: rec.answers_version,
    suggestions: Array.from({ length: n }, (_, i) => ({ kind: "question", target: null, text: `合成の提案 ${i + 1}` })),
  };
}

// ---------- DB のパスの検査 ----------

describe("resolveDbPath", () => {
  let tmp: string;
  let fakeHome: string;
  let fakeZ3: string;
  let work: string;

  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "t043-path-")));
    fakeHome = path.join(tmp, "home");
    fakeZ3 = path.join(tmp, "z3-elsewhere");
    work = path.join(tmp, "work");
    fs.mkdirSync(path.join(fakeHome, "tsubuyaki-z3"), { recursive: true });
    fs.mkdirSync(fakeZ3, { recursive: true });
    fs.mkdirSync(path.join(work, "data"), { recursive: true });
    fs.writeFileSync(path.join(work, "data", "tsubuyaki.db"), "");
    fs.writeFileSync(path.join(work, "data", "notes.txt"), "");
  });
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const opts = () => ({ cwd: work, homeDir: fakeHome, z3Dir: fakeZ3, appDbPath: undefined });

  function rejects(raw: string | undefined): boolean {
    try {
      resolveDbPath(raw, opts());
      return false;
    } catch (e) {
      expect(e).toBeInstanceOf(RequirementsStoreError);
      // 固定のエラー：符号だけで、パスを含めない
      expect((e as Error).message).toBe("db_path_rejected");
      return true;
    }
  }

  it(":memory: は許す", () => {
    expect(resolveDbPath(MEMORY_DB, opts())).toBe(MEMORY_DB);
  });

  it("既定は data/vgdd-requirements.db（まだないファイルは親を解いて判定する）", () => {
    expect(resolveDbPath(undefined, opts())).toBe(path.join(work, "data", "vgdd-requirements.db"));
    expect(resolveDbPath("sub/dir/x.db", opts())).toBe(path.join(work, "sub", "dir", "x.db"));
  });

  it(".db 以外の拡張子を拒む", () => {
    expect(rejects("data/x.sqlite")).toBe(true);
    expect(rejects("data/x.db-wal")).toBe(true);
    expect(rejects("data/x")).toBe(true);
  });

  it("Z3（~/tsubuyaki-z3 と VGDD_Z3_DIR）の下を拒む", () => {
    expect(rejects(path.join(fakeHome, "tsubuyaki-z3", "r.db"))).toBe(true);
    expect(rejects(path.join(fakeZ3, "deep", "r.db"))).toBe(true);
    expect(rejects(path.join(work, "..", "z3-elsewhere", "r.db"))).toBe(true);
    // 大文字と小文字の違いでも拒む
    expect(rejects(path.join(fakeZ3.toUpperCase(), "r.db"))).toBe(true);
  });

  it("題材のアプリの DB（data/tsubuyaki.db）と一致する指定を拒む", () => {
    expect(rejects("data/tsubuyaki.db")).toBe(true);
    expect(rejects("./data/../data/tsubuyaki.db")).toBe(true);
    expect(() => resolveDbPath("data/other.db", { ...opts(), appDbPath: "data/other.db" })).toThrow(RequirementsStoreError);
  });

  it("記号リンクの先が Z3・題材の DB・.db 以外なら拒む", () => {
    fs.symlinkSync(path.join(fakeZ3), path.join(work, "z3link"));
    fs.symlinkSync(path.join(work, "data", "tsubuyaki.db"), path.join(work, "alias.db"));
    fs.symlinkSync(path.join(work, "data", "notes.txt"), path.join(work, "notes.db"));
    fs.symlinkSync(path.join(fakeZ3, "missing.db"), path.join(work, "dangling.db"));
    expect(rejects("z3link/r.db")).toBe(true);
    expect(rejects("alias.db")).toBe(true);
    expect(rejects("notes.db")).toBe(true);
    expect(rejects("dangling.db")).toBe(true);
  });

  it("拒んだ指定では DB を開かない（固定のエラー）", () => {
    expect(() => openRequirementsStore("data/tsubuyaki.db", opts())).toThrow("db_path_rejected");
  });
});

// ---------- 保存 ----------

describe("RequirementsStore（:memory:）", () => {
  let store: RequirementsStore;
  beforeEach(() => {
    store = openRequirementsStore(MEMORY_DB);
  });
  afterEach(() => store.close());

  it("作成・取得・一覧（一覧は id・題・時刻・ready だけ）", () => {
    const rec = store.create("架空の請求書の確認");
    expect(rec.answers_version).toBe(0);
    expect(store.get(rec.id)).toEqual(rec);
    const list = store.list();
    expect(list).toEqual([{ id: rec.id, title: rec.title, created_at: rec.created_at, ready: false }]);
    expect(store.get("no-such-id")).toBeNull();
  });

  it("回答の保存で answers_version が1つ増え、ready が一覧に出る", () => {
    const rec = store.create("合成");
    const r = store.saveAnswers(rec.id, { answers_version: 0, answers: FILLED, linked_ticket_id: "T-043" });
    expect(r.ok).toBe(true);
    const got = store.get(rec.id)!;
    expect(got.answers_version).toBe(1);
    expect(got.answers).toEqual(FILLED);
    expect(got.linked_ticket_id).toBe("T-043");
    expect(store.list()[0].ready).toBe(true);
  });

  it("answers_version の不一致で拒む", () => {
    const rec = store.create("合成");
    const r = store.saveAnswers(rec.id, { answers_version: 5, answers: FILLED, linked_ticket_id: null });
    expect(r).toEqual({ ok: false, code: "version_conflict" });
    expect(store.get(rec.id)!.answers_version).toBe(0);
  });

  it("同じ版での2つの保存は片方だけ通る", () => {
    const rec = store.create("合成");
    const a = store.saveAnswers(rec.id, { answers_version: 0, answers: FILLED, linked_ticket_id: null });
    const b = store.saveAnswers(rec.id, {
      answers_version: 0,
      answers: { "problem.who": { text: "別の担当", unknown: false } },
      linked_ticket_id: null,
    });
    expect([a.ok, b.ok]).toEqual([true, false]);
    expect(store.get(rec.id)!.answers).toEqual(FILLED);
  });

  it("存在しない記録は not_found", () => {
    expect(store.saveAnswers("00000000-0000-4000-8000-000000000000", { answers_version: 0, answers: {}, linked_ticket_id: null })).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("提案の取り込み：最新の answers_version と合うときだけ取り込み、suggestions_version を増やす", () => {
    const rec = store.create("合成");
    store.saveAnswers(rec.id, { answers_version: 0, answers: FILLED, linked_ticket_id: null });
    const old = store.importSuggestions(rec.id, assist({ id: rec.id, answers_version: 0 }));
    expect(old).toEqual({ ok: false, code: "invalid" });
    const ok = store.importSuggestions(rec.id, assist({ id: rec.id, answers_version: 1 }, 2));
    expect(ok.ok).toBe(true);
    const got = store.get(rec.id)!;
    expect(got.suggestions).toHaveLength(2);
    expect(got.decisions).toEqual(["pending", "pending"]);
    // 回答の変更（提案の無効化）で 1、取り込みで 2
    expect(got.suggestions_version).toBe(2);
  });

  it("採否の更新：古い版は拒み、成功すると suggestions_version が増える", () => {
    const rec = store.create("合成");
    store.importSuggestions(rec.id, assist(rec, 2));
    const cur = store.get(rec.id)!;
    expect(store.decide(rec.id, { answers_version: 0, suggestions_version: 0, index: 0, decision: "accepted" })).toEqual({
      ok: false,
      code: "version_conflict",
    });
    const r = store.decide(rec.id, { answers_version: 0, suggestions_version: cur.suggestions_version, index: 1, decision: "rejected" });
    expect(r.ok).toBe(true);
    const got = store.get(rec.id)!;
    expect(got.decisions).toEqual(["pending", "rejected"]);
    // 同じ版での2回目は拒む
    expect(store.decide(rec.id, { answers_version: 0, suggestions_version: cur.suggestions_version, index: 0, decision: "accepted" }).ok).toBe(false);
    // 範囲外の番号は形の違い
    expect(store.decide(rec.id, { answers_version: 0, suggestions_version: got.suggestions_version, index: 9, decision: "accepted" })).toEqual({
      ok: false,
      code: "invalid",
    });
  });

  it("回答を変えると、前の提案と採否が無効になる（同じ回答の保存では残る）", () => {
    const rec = store.create("合成");
    store.importSuggestions(rec.id, assist(rec, 1));
    // 回答が同じ（どちらも空）なら提案は残る
    store.saveAnswers(rec.id, { answers_version: 0, answers: {}, linked_ticket_id: "T-001" });
    expect(store.get(rec.id)!.suggestions).toHaveLength(1);
    store.saveAnswers(rec.id, { answers_version: 1, answers: FILLED, linked_ticket_id: "T-001" });
    const got = store.get(rec.id)!;
    expect(got.suggestions).toEqual([]);
    expect(got.decisions).toEqual([]);
    expect(got.answers_version).toBe(2);
  });

  it("提案の上限（31 件・501 字・32KB を超える JSON）を拒む", () => {
    const rec = store.create("合成");
    expect(store.importSuggestions(rec.id, assist(rec, 31))).toEqual({ ok: false, code: "invalid" });
    const long = assist(rec, 1);
    long.suggestions[0].text = "あ".repeat(501);
    expect(store.importSuggestions(rec.id, long)).toEqual({ ok: false, code: "invalid" });
    const big = JSON.stringify({ ...assist(rec, 1), pad: "x".repeat(33 * 1024) });
    expect(store.importSuggestions(rec.id, big)).toEqual({ ok: false, code: "invalid" });
  });
});

// ---------- 本文の読み取り ----------

describe("readJsonBody", () => {
  it("Content-Length がなくても、読みながら数えて 32,768 バイトを超えたら 413", async () => {
    const chunk = new TextEncoder().encode("a".repeat(8192));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent >= 10) return c.close();
        sent++;
        c.enqueue(chunk);
      },
    });
    const req = new Request("http://localhost/x", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    const r = await readJsonBody(req);
    expect(r).toEqual({ ok: false, failure: { status: 413, error: "payload_too_large" } });
    // 超えた時点でやめる（全部は読まない）
    expect(sent).toBeLessThan(10);
  });

  it("Content-Length が小さく偽られていても数える", async () => {
    const req = new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-length": "2" },
      body: JSON.stringify({ t: "あ".repeat(11_000) }),
    });
    const r = await readJsonBody(req);
    expect(r.ok).toBe(false);
  });

  it("ちょうど 32,768 バイトは通し、UTF-8 として正しくない本文は 400", async () => {
    const s = JSON.stringify({ t: "" });
    const exact = JSON.stringify({ t: "a".repeat(32_768 - s.length) });
    expect(new TextEncoder().encode(exact).byteLength).toBe(32_768);
    expect((await readJsonBody(new Request("http://localhost/x", { method: "POST", body: exact }))).ok).toBe(true);
    const bad = new Request("http://localhost/x", { method: "POST", body: new Uint8Array([0x7b, 0xff, 0x7d]) });
    expect(await readJsonBody(bad)).toEqual({ ok: false, failure: { status: 400, error: "invalid_body" } });
  });
});

// ---------- API（ルートの関数に Request を直接渡す） ----------

describe("API /api/requirements", () => {
  const ORIGIN = "http://localhost:3000";
  const saved = process.env.VGDD_REQUIREMENTS_DB_PATH;

  beforeEach(() => {
    process.env.VGDD_REQUIREMENTS_DB_PATH = MEMORY_DB;
    closeRequirementsStore();
  });
  afterAll(() => {
    closeRequirementsStore();
    if (saved === undefined) delete process.env.VGDD_REQUIREMENTS_DB_PATH;
    else process.env.VGDD_REQUIREMENTS_DB_PATH = saved;
  });

  function req(
    url: string,
    init: { method?: string; host?: string | null; origin?: string | null; type?: string | null; body?: BodyInit } = {},
  ): Request {
    const h = new Headers();
    const host = init.host === undefined ? "localhost:3000" : init.host;
    if (host !== null) h.set("host", host);
    const method = init.method ?? "GET";
    if (method !== "GET") {
      const origin = init.origin === undefined ? ORIGIN : init.origin;
      if (origin !== null) h.set("origin", origin);
      const type = init.type === undefined ? "application/json" : init.type;
      if (type !== null) h.set("content-type", type);
    }
    return new Request(url, { method, headers: h, body: init.body });
  }

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  async function create(title = "架空の請求書の確認"): Promise<RequirementRecord> {
    const r = await listRoute.POST(req(`${ORIGIN}/api/requirements`, { method: "POST", body: JSON.stringify({ title }) }));
    expect(r.status).toBe(201);
    return ((await r.json()) as { record: RequirementRecord }).record;
  }

  it("一覧と作成（ローカルの要求）", async () => {
    const rec = await create();
    const r = await listRoute.GET(req(`${ORIGIN}/api/requirements`));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { records: unknown[] };
    expect(body.records).toEqual([{ id: rec.id, title: rec.title, created_at: rec.created_at, ready: false }]);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("[::1] と 127.0.0.1 も通す（ポートは問わない）", async () => {
    expect((await listRoute.GET(req("http://[::1]:8080/api/requirements", { host: "[::1]:8080" }))).status).toBe(200);
    expect((await listRoute.GET(req("http://127.0.0.1/api/requirements", { host: "127.0.0.1" }))).status).toBe(200);
  });

  it("外の Host・Host の欠け・形の違う Host・外の URL は 403（すべてのメソッド）", async () => {
    const rec = await create();
    const cases: Request[] = [
      req(`${ORIGIN}/api/requirements`, { host: "attacker.example" }),
      req(`${ORIGIN}/api/requirements`, { host: null }),
      req(`${ORIGIN}/api/requirements`, { host: "localhost.:3000" }),
      req(`${ORIGIN}/api/requirements`, { host: "localhost:3000@evil.example" }),
      req("http://evil.example/api/requirements", { host: "localhost:3000" }),
    ];
    for (const c of cases) {
      const r = await listRoute.GET(c);
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ error: "forbidden_host" });
    }
    const outside = { host: "evil.example", body: JSON.stringify({ title: "x" }) };
    expect((await listRoute.POST(req(`${ORIGIN}/api/requirements`, { method: "POST", ...outside }))).status).toBe(403);
    expect((await itemRoute.GET(req(`${ORIGIN}/api/requirements/${rec.id}`, { host: "evil.example" }), ctx(rec.id))).status).toBe(403);
    expect((await itemRoute.PUT(req(`${ORIGIN}/api/requirements/${rec.id}`, { method: "PUT", ...outside }), ctx(rec.id))).status).toBe(403);
    expect((await itemRoute.POST(req(`${ORIGIN}/api/requirements/${rec.id}`, { method: "POST", ...outside }), ctx(rec.id))).status).toBe(403);
    // 存在しない記録でも、記録の確認より前に 403
    expect((await itemRoute.GET(req(`${ORIGIN}/api/requirements/x`, { host: "evil.example" }), ctx("x"))).status).toBe(403);
  });

  it("別の origin・Origin の欠けは 403、JSON でない本文は 415", async () => {
    const rec = await create();
    const url = `${ORIGIN}/api/requirements/${rec.id}`;
    const body = JSON.stringify({ answers_version: 0, answers: {}, linked_ticket_id: null });
    for (const origin of ["http://evil.example", "http://localhost:3001", "https://localhost:3000", "null", `${ORIGIN}/path`, null]) {
      const r = await itemRoute.PUT(req(url, { method: "PUT", origin, body }), ctx(rec.id));
      expect(r.status).toBe(403);
      expect(await r.json()).toEqual({ error: "forbidden_origin" });
    }
    expect((await listRoute.POST(req(`${ORIGIN}/api/requirements`, { method: "POST", origin: null, body: '{"title":"x"}' }))).status).toBe(403);
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", null]) {
      const r = await itemRoute.PUT(req(url, { method: "PUT", type, body }), ctx(rec.id));
      expect(r.status).toBe(415);
    }
    expect((await itemRoute.POST(req(url, { method: "POST", type: "text/plain", body: '{"action":"import"}' }), ctx(rec.id))).status).toBe(415);
    expect((await listRoute.GET(req(`${ORIGIN}/api/requirements`))).status).toBe(200);
  });

  it("32,768 バイトを超える本文は 413（Content-Length の有無によらない）", async () => {
    const rec = await create();
    const big = JSON.stringify({ answers_version: 0, answers: { "problem.who": { text: "あ".repeat(11_000), unknown: false } }, linked_ticket_id: null });
    const r = await itemRoute.PUT(req(`${ORIGIN}/api/requirements/${rec.id}`, { method: "PUT", body: big }), ctx(rec.id));
    expect(r.status).toBe(413);
    const r2 = await listRoute.POST(req(`${ORIGIN}/api/requirements`, { method: "POST", body: JSON.stringify({ title: "x".repeat(40_000) }) }));
    expect(r2.status).toBe(413);
  });

  it("存在しない記録は 404、形の違いは 400、古い版は 409", async () => {
    const rec = await create();
    const url = `${ORIGIN}/api/requirements/${rec.id}`;
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await itemRoute.GET(req(`${ORIGIN}/api/requirements/${missing}`), ctx(missing))).status).toBe(404);
    expect((await itemRoute.GET(req(`${ORIGIN}/api/requirements/bad`), ctx("bad"))).status).toBe(404);
    const put = (body: unknown) => itemRoute.PUT(req(url, { method: "PUT", body: JSON.stringify(body) }), ctx(rec.id));
    expect((await itemRoute.PUT(req(`${ORIGIN}/api/requirements/${missing}`, { method: "PUT", body: JSON.stringify({ answers_version: 0, answers: {}, linked_ticket_id: null }) }), ctx(missing))).status).toBe(404);
    expect((await put({ answers_version: 0, answers: { "no.such": { text: "x", unknown: false } }, linked_ticket_id: null })).status).toBe(400);
    expect((await put({ answers_version: 0, answers: {}, linked_ticket_id: "T-12" })).status).toBe(400);
    expect((await put({ answers_version: 0, answers: {}, linked_ticket_id: null, extra: 1 })).status).toBe(400);
    expect((await itemRoute.PUT(req(url, { method: "PUT", body: "{not json" }), ctx(rec.id))).status).toBe(400);
    expect((await put({ answers_version: 0, answers: FILLED, linked_ticket_id: "T-043" })).status).toBe(200);
    const stale = await put({ answers_version: 0, answers: {}, linked_ticket_id: null });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "version_conflict" });

    const post = (body: unknown) => itemRoute.POST(req(url, { method: "POST", body: JSON.stringify(body) }), ctx(rec.id));
    // 古い answers_version の提案の JSON は 400
    expect((await post({ action: "import", suggestions: assist({ id: rec.id, answers_version: 0 }) })).status).toBe(400);
    const ok = await post({ action: "import", suggestions: assist({ id: rec.id, answers_version: 1 }, 2) });
    expect(ok.status).toBe(200);
    const after = ((await ok.json()) as { record: RequirementRecord }).record;
    expect(after.decisions).toEqual(["pending", "pending"]);
    expect((await post({ action: "decide", answers_version: 1, suggestions_version: 0, index: 0, decision: "accepted" })).status).toBe(409);
    expect((await post({ action: "decide", answers_version: 0, suggestions_version: after.suggestions_version, index: 0, decision: "accepted" })).status).toBe(409);
    expect((await post({ action: "decide", answers_version: 1, suggestions_version: after.suggestions_version, index: 0, decision: "maybe" })).status).toBe(400);
    expect((await post({ action: "other" })).status).toBe(400);
    const d = await post({ action: "decide", answers_version: 1, suggestions_version: after.suggestions_version, index: 0, decision: "accepted" });
    expect(d.status).toBe(200);
    expect(((await d.json()) as { record: RequirementRecord }).record.decisions).toEqual(["accepted", "pending"]);
  });

  it("DB の指定が拒まれたときは固定の符号だけを返す（パスを出さない）", async () => {
    process.env.VGDD_REQUIREMENTS_DB_PATH = "data/tsubuyaki.db";
    closeRequirementsStore();
    const r = await listRoute.GET(req(`${ORIGIN}/api/requirements`));
    expect(r.status).toBe(500);
    const text = await r.text();
    expect(text).toBe(JSON.stringify({ error: "store_unavailable" }));
  });
});
