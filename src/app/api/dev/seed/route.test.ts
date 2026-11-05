import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "@/lib/db";
import { addNote, listNotes } from "@/lib/sessions";
import { seedDemo } from "@/lib/seed";
import { POST } from "./route";

/** 毎回新しく作る（Request の body は一度しか読めない） */
function seedRequest(opts: { body?: string; headers?: Record<string, string> } = {}): Request {
  return new Request("http://localhost/api/dev/seed", {
    method: "POST",
    headers: opts.headers ?? { "content-type": "application/json" },
    body: opts.body ?? "{}",
  });
}

// ①〜④：試験ごとに空のメモリの DB を getDb() の接続（globalThis）に差し込み、afterEach で元に戻す
const g = globalThis as unknown as { __tsubuyakiDb?: DatabaseSync };
let savedGlobalDb: DatabaseSync | undefined;
let testDb: DatabaseSync | undefined;

function useMemoryDb(): DatabaseSync {
  savedGlobalDb = g.__tsubuyakiDb;
  testDb = openDb(":memory:");
  g.__tsubuyakiDb = testDb;
  return testDb;
}

function countSessions(db: DatabaseSync): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM work_sessions").get() as { n: number }).n;
}

describe("POST /api/dev/seed", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    if (testDb) {
      g.__tsubuyakiDb = savedGlobalDb;
      testDb.close();
      testDb = undefined;
      savedGlobalDb = undefined;
    }
  });

  it("開発サーバー以外（test / production）では 404 を返し、DB に触らない", async () => {
    for (const env of ["test", "production"]) {
      vi.stubEnv("NODE_ENV", env);
      const r = await POST(
        new Request("http://localhost/api/dev/seed", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      );
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: "not_found" });
    }
  });

  it("development のときだけ seed が動く（一時ファイルの DB）", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsubuyaki-seed-"));
    vi.stubEnv("TSUBUYAKI_DB_PATH", path.join(dir, "test.db"));
    vi.stubEnv("NODE_ENV", "development");
    const r = await POST(
      new Request("http://localhost/api/dev/seed", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
    );
    expect(r.status).toBe(200);
    const d = (await r.json()) as { ok: boolean; inserted: boolean };
    expect(d.ok).toBe(true);
    expect(d.inserted).toBe(true);
    // 2回目は増えない
    const d2 = (await (
      await POST(
        new Request("http://localhost/api/dev/seed", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
      )
    ).json()) as { inserted: boolean };
    expect(d2.inserted).toBe(false);
  });

  it("① Origin のある要求は 403 forbidden_origin で何も入れない。その後の正しい要求で inserted が true", async () => {
    const db = useMemoryDb();
    vi.stubEnv("NODE_ENV", "development");
    const r = await POST(
      seedRequest({
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ reset: true }),
      }),
    );
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "forbidden_origin" });
    expect(countSessions(db)).toBe(0);

    const ok = await POST(seedRequest());
    expect(ok.status).toBe(200);
    const d = (await ok.json()) as { ok: boolean; inserted: boolean };
    expect(d.ok).toBe(true);
    expect(d.inserted).toBe(true);
  });

  it("② Content-Type が text/plain なら 415 unsupported_media_type で何も入れない", async () => {
    const db = useMemoryDb();
    vi.stubEnv("NODE_ENV", "development");
    const r = await POST(seedRequest({ headers: { "content-type": "text/plain" }, body: JSON.stringify({ reset: true }) }));
    expect(r.status).toBe(415);
    expect(await r.json()).toEqual({ error: "unsupported_media_type" });
    expect(countSessions(db)).toBe(0);
  });

  it("③ { reset: \"yes\" } と { reset: true, x: 1 }、JSON でない本文は 400 invalid_body で何も入れない", async () => {
    const db = useMemoryDb();
    vi.stubEnv("NODE_ENV", "development");
    for (const body of [JSON.stringify({ reset: "yes" }), JSON.stringify({ reset: true, x: 1 }), "not json", "[]"]) {
      const r = await POST(seedRequest({ body }));
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "invalid_body" });
    }
    expect(countSessions(db)).toBe(0);
  });

  it("④ application/json の { reset: true } で入れ直す（目印のメモが消える）", async () => {
    const db = useMemoryDb();
    vi.stubEnv("NODE_ENV", "development");
    const { sessionId } = seedDemo(db);
    addNote({ sessionId, userId: "newcomer_a", body: "試験の目印の架空のメモ" }, db);
    expect(listNotes(sessionId, db).map((n) => n.body)).toContain("試験の目印の架空のメモ");

    const r = await POST(seedRequest({ body: JSON.stringify({ reset: true }) }));
    expect(r.status).toBe(200);
    const d = (await r.json()) as { ok: boolean; inserted: boolean; sessionId: number; reset?: Record<string, number> };
    expect(d.ok).toBe(true);
    expect(d.inserted).toBe(true);
    expect(d.reset).toBeDefined();
    const bodies = (db.prepare("SELECT body FROM notes").all() as { body: string }[]).map((n) => n.body);
    expect(bodies).not.toContain("試験の目印の架空のメモ");
    expect(listNotes(d.sessionId, db)).toHaveLength(4);
  });
});
