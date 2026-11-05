import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_TASKS } from "@/lib/seed";

// captureFixtures だけを差し替える（CaptureFixturesBodySchema は本物を使う）。実 API は呼ばない
const captureMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ai/capture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/capture")>();
  return { ...actual, captureFixtures: captureMock };
});

import { POST } from "./route";

function req(opts: { body?: string; headers?: Record<string, string> } = {}): Request {
  return new Request("http://localhost/api/dev/capture-fixtures", {
    method: "POST",
    headers: opts.headers ?? { "content-type": "application/json" },
    body: opts.body ?? "{}",
  });
}

const OK_RESULT = { task_name: "x", partial: false, ok: true, attempts: 1 };

describe("POST /api/dev/capture-fixtures", () => {
  beforeEach(() => {
    captureMock.mockReset();
    captureMock.mockResolvedValue([OK_RESULT]);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("⑦⑧ 404 → 403 → 415 → 400 → 503 の順で判定し、拒否のときは captureFixtures を呼ばない", async () => {
    // 404：development 以外。Origin・Content-Type・body・キーがすべて不正でも 404
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    let r = await POST(req({ headers: { origin: "http://evil.example", "content-type": "text/plain" }, body: "x" }));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "not_found" });

    // 403：Origin あり（Content-Type・body・キーが不正でも 403）
    vi.stubEnv("NODE_ENV", "development");
    r = await POST(req({ headers: { origin: "http://localhost:3000", "content-type": "text/plain" }, body: "x" }));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "forbidden_origin" });

    // 415：JSON 以外（body・キーが不正でも 415）
    r = await POST(req({ headers: { "content-type": "text/plain" }, body: "x" }));
    expect(r.status).toBe(415);
    expect(await r.json()).toEqual({ error: "unsupported_media_type" });

    // 400：body が不正（キーがなくても 400）
    for (const body of [
      "x",
      "[]",
      JSON.stringify({ tasks: "W1" }),
      JSON.stringify({ tasks: ["a".repeat(201)] }),
      JSON.stringify({ tasks: Array.from({ length: 11 }, (_, i) => `t${i}`) }),
      JSON.stringify({ partial: "yes" }),
      JSON.stringify({ partial: true, x: 1 }),
    ]) {
      r = await POST(req({ body }));
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ error: "invalid_body" });
    }

    // 503：キーなし。本文は { error } だけ（message は付けない）
    r = await POST(req({ body: JSON.stringify({ partial: true }) }));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "no_api_key" });

    expect(captureMock).not.toHaveBeenCalled();
  });

  it("⑨ tasks の省略と空の配列は既定の3作業。partial が渡り、成功の応答は今の形", async () => {
    const defaults = DEMO_TASKS.map((t) => t.taskName);
    expect(defaults).toHaveLength(3);

    let r = await POST(req({ body: "{}" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, results: [OK_RESULT] });
    expect(captureMock).toHaveBeenLastCalledWith(defaults, { partial: false });

    r = await POST(req({ body: JSON.stringify({ tasks: [], partial: true }) }));
    expect(r.status).toBe(200);
    expect(captureMock).toHaveBeenLastCalledWith(defaults, { partial: true });

    captureMock.mockResolvedValueOnce([OK_RESULT, { ...OK_RESULT, ok: false, attempts: 2, errors: ["e"] }]);
    r = await POST(req({ body: JSON.stringify({ tasks: ["架空の作業"], partial: true }) }));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { ok: boolean }).ok).toBe(false);
    expect(captureMock).toHaveBeenLastCalledWith(["架空の作業"], { partial: true });
    // 材料は captureFixtures の中のメモリの DB（ルートは db を渡さない）
    for (const call of captureMock.mock.calls) expect(call).toHaveLength(2);
  });

  it("⑩ captureFixtures の例外は 500 capture_failed。例外の本文は応答にも console にも出ない", async () => {
    const secret = "例外の本文に入った架空のメモ SECRET-MARKER-42";
    captureMock.mockRejectedValueOnce(new Error(secret));
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );

    const r = await POST(req({ body: "{}" }));
    expect(r.status).toBe(500);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: "capture_failed" });
    expect(text).not.toContain("SECRET-MARKER-42");
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain("SECRET-MARKER-42");
    }
  });
});
