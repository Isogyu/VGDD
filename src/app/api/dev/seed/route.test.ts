import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { POST } from "./route";

describe("POST /api/dev/seed", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("開発サーバー以外（test / production）では 404 を返し、DB に触らない", async () => {
    for (const env of ["test", "production"]) {
      vi.stubEnv("NODE_ENV", env);
      const r = await POST();
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: "not_found" });
    }
  });

  it("development のときだけ seed が動く（一時ファイルの DB）", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsubuyaki-seed-"));
    vi.stubEnv("TSUBUYAKI_DB_PATH", path.join(dir, "test.db"));
    vi.stubEnv("NODE_ENV", "development");
    const r = await POST();
    expect(r.status).toBe(200);
    const d = (await r.json()) as { ok: boolean; inserted: boolean };
    expect(d.ok).toBe(true);
    expect(d.inserted).toBe(true);
    // 2回目は増えない
    const d2 = (await (await POST()).json()) as { inserted: boolean };
    expect(d2.inserted).toBe(false);
  });
});
