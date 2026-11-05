// AI の追加の検出（T-017）の試験。Claude の API は呼ばない（mock と demo だけ）。文はすべて架空。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "./db";
import { startSession } from "./sessions";
import { detectSensitive } from "./sensitive";
import { checkSensitiveWithAi, checkShareWithAi, validateAiFlags } from "./ai-sensitive";
import {
  buildSensitivePrompt,
  DemoSensitiveProvider,
  getSensitiveProvider,
  sensitiveFixturePath,
  setSensitiveProviderOverride,
  type SensitiveInput,
  type SensitiveProvider,
} from "./ai/sensitive-provider";
import { ProviderUnavailableError } from "./ai/provider";

const TRAP5 = "ホクト製菓の案件で見積りが 350 万円になった";

type Out = string | ((input: SensitiveInput) => string) | Error;

function mockProvider(outputs: Out[], calls: SensitiveInput[] = []): SensitiveProvider {
  let i = 0;
  return {
    name: "mock",
    async check(input) {
      // 受け取った入力の写しを残す（後から書き換えられても比べられるように）
      calls.push(structuredClone(input));
      const o = outputs[Math.min(i, outputs.length - 1)];
      i++;
      if (o instanceof Error) throw o;
      return { raw: typeof o === "function" ? o(input) : o, model: "mock-model" };
    },
  };
}

const cand = (match: string, kind = "other", reason = "架空の理由") => ({ match, kind, reason });
const rawOf = (...cs: ReturnType<typeof cand>[]) => JSON.stringify({ candidates: cs });

afterEach(() => setSensitiveProviderOverride(null));

describe("checkSensitiveWithAi", () => {
  it("① 罠の5件目：AI の金額が ai_amount で1件、決定論的な登録語句が1件", async () => {
    const r = await checkSensitiveWithAi(TRAP5, { provider: mockProvider([rawOf(cand("350 万円", "amount"))]) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ai).toHaveLength(1);
    expect(r.ai[0]).toMatchObject({ type: "ai_amount", match: "350 万円", source: "ai" });
    expect(TRAP5.slice(r.ai[0].start, r.ai[0].end)).toBe("350 万円");
    expect(r.deterministic.filter((f) => f.type === "registered_term")).toHaveLength(1);
    expect(r.deterministic).toEqual(detectSensitive(TRAP5));
    expect(r.attempts).toBe(1);
    expect(r.model).toBe("mock-model");
  });

  it("② 決定論的な検出と同じ範囲の候補は ai に入らない", async () => {
    const r = await checkSensitiveWithAi(TRAP5, {
      provider: mockProvider([rawOf(cand("ホクト製菓", "customer"), cand("ホクト", "customer"))]),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ai).toEqual([]);
    expect(r.deterministic).toEqual(detectSensitive(TRAP5));
  });

  it("③ 本文にない match は捨てられ、違反にならない", async () => {
    const calls: SensitiveInput[] = [];
    const r = await checkSensitiveWithAi(TRAP5, {
      provider: mockProvider([rawOf(cand("架空の存在しない語", "plan"), cand("見積り", "other"))], calls),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.attempts).toBe(1);
    expect(calls).toHaveLength(1);
    expect(r.ai.map((f) => f.match)).toEqual(["見積り"]);
  });

  it("④ 壊れた出力の後に正しい出力なら attempts: 2 で成功", async () => {
    const r = await checkSensitiveWithAi(TRAP5, {
      provider: mockProvider(["これは JSON ではない", rawOf(cand("350 万円", "amount"))]),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.attempts).toBe(2);
    expect(r.ai).toHaveLength(1);
  });

  it("⑤ 2回とも壊れていれば schema_violation で、deterministic は入っている", async () => {
    const calls: SensitiveInput[] = [];
    const r = await checkSensitiveWithAi(TRAP5, {
      provider: mockProvider([JSON.stringify({ candidates: [{ match: "350 万円", kind: "money", reason: "x" }] })], calls),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("schema_violation");
    expect(r.message).toBe("AI の出力を読めませんでした");
    expect(r.attempts).toBe(2);
    expect(calls).toHaveLength(2);
    expect(r.deterministic).toEqual(detectSensitive(TRAP5));
    // errors に出力の値を含めない
    expect(r.errors?.join("\n")).not.toContain("money");
    expect(r.errors?.join("\n")).not.toContain("350");
  });

  it("⑥ ProviderUnavailableError で provider_unavailable、deterministic は入っている", async () => {
    const r = await checkSensitiveWithAi(TRAP5, {
      provider: mockProvider([new ProviderUnavailableError("キーがない")]),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("provider_unavailable");
    expect(r.message).toBe("AI が使えません（API キーがない、またはデモの保存済みの結果がありません）");
    expect(r.attempts).toBe(1);
    expect(r.deterministic).toEqual(detectSensitive(TRAP5));
  });

  it("⑦ 本文を含む普通の Error で、message に本文が入らない", async () => {
    const r = await checkSensitiveWithAi(TRAP5, {
      provider: mockProvider([new Error(`失敗：${TRAP5}`)]),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("provider_unavailable");
    expect(r.message).toBe("AI の呼び出しに失敗しました");
    expect(r.message).not.toContain("ホクト製菓");
    expect(JSON.stringify(r)).not.toContain("失敗：");
  });

  it("⑧ 空白だけの本文は provider を呼ばずに empty_text", async () => {
    const calls: SensitiveInput[] = [];
    const r = await checkSensitiveWithAi("  \n\t ", { provider: mockProvider([rawOf()], calls) });
    expect(calls).toHaveLength(0);
    expect(r).toEqual({ ok: false, reason: "empty_text", message: "本文が空です", deterministic: [], attempts: 0 });
  });

  it("⑩ mock が known の配列と要素を書き換えても、deterministic は detectSensitive(text) と等しい（成功）", async () => {
    const text = "ホクト製菓とみなみ運輸の件。連絡は taro@example.com へ。予算は 120 万円";
    const p: SensitiveProvider = {
      name: "mock",
      async check(input) {
        for (const k of input.known) {
          k.start = 0;
          k.end = 0;
          k.type = "書き換え";
        }
        input.known.length = 0;
        return { raw: rawOf(cand("120 万円", "amount")), model: "mock-model" };
      },
    };
    const r = await checkSensitiveWithAi(text, { provider: p });
    expect(r.ok).toBe(true);
    expect(r.deterministic).toEqual(detectSensitive(text));
    expect(r.deterministic.length).toBeGreaterThan(0);
  });

  it("⑩ mock が known を書き換えて失敗しても、deterministic は detectSensitive(text) と等しい（失敗）", async () => {
    const p: SensitiveProvider = {
      name: "mock",
      async check(input) {
        input.known.splice(0, input.known.length, { start: 0, end: 1, type: "偽" });
        if (input.known[0]) input.known[0].end = 999;
        return { raw: "壊れた出力", model: "mock-model" };
      },
    };
    const r = await checkSensitiveWithAi(TRAP5, { provider: p });
    expect(r.ok).toBe(false);
    expect(r.deterministic).toEqual(detectSensitive(TRAP5));
  });

  it("⑪ 本文を含む ProviderUnavailableError を投げても、message に本文が入らない", async () => {
    const r = await checkSensitiveWithAi(TRAP5, {
      provider: mockProvider([new ProviderUnavailableError(`使えない：${TRAP5}`)]),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("provider_unavailable");
    expect(r.message).not.toContain("ホクト製菓");
    expect(r.message).not.toContain("使えない：");
  });

  it("⑫ 2001文字の本文は provider を呼ばずに too_long", async () => {
    const calls: SensitiveInput[] = [];
    const text = "あ".repeat(2001);
    const r = await checkSensitiveWithAi(text, { provider: mockProvider([rawOf()], calls) });
    expect(calls).toHaveLength(0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("too_long");
    expect(r.message).toBe("本文が長すぎるため AI では確かめません（2000文字まで）");
    expect(r.attempts).toBe(0);
    // 2000文字ちょうどなら呼ぶ
    const r2 = await checkSensitiveWithAi("あ".repeat(2000), { provider: mockProvider([rawOf()], calls) });
    expect(r2.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("⑭ 1回目の入力は { text, known } だけ、2回目は previousErrors が足される", async () => {
    const calls: SensitiveInput[] = [];
    await checkSensitiveWithAi(TRAP5, { provider: mockProvider(["壊れた出力", rawOf()], calls) });
    expect(calls).toHaveLength(2);
    const known = detectSensitive(TRAP5).map((f) => ({ start: f.start, end: f.end, type: f.type }));
    expect(Object.keys(calls[0]).sort()).toEqual(["known", "text"]);
    expect(calls[0]).toEqual({ text: TRAP5, known });
    expect(Object.keys(calls[1]).sort()).toEqual(["known", "previousErrors", "text"]);
    expect(calls[1]).toEqual({ text: TRAP5, known, previousErrors: ["出力が JSON として解釈できない"] });
  });

  it("override で差し替えた provider を使う", async () => {
    setSensitiveProviderOverride(mockProvider([rawOf(cand("350 万円", "amount"))]));
    expect(getSensitiveProvider().name).toBe("mock");
    const r = await checkSensitiveWithAi(TRAP5);
    expect(r.ok).toBe(true);
  });
});

describe("validateAiFlags", () => {
  it("⑬ 同じ語句が2回出て1回目だけが known と重なるとき、2回目が ai に入る", () => {
    const text = "架空商事の件。のちほど架空商事に連絡";
    const first = text.indexOf("架空商事");
    const second = text.indexOf("架空商事", first + 4);
    const known = [{ type: "registered_term" as const, match: "架空商事", start: first, end: first + 4 }];
    const v = validateAiFlags(rawOf(cand("架空商事", "customer")), text, known);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.flags).toEqual([
      { type: "ai_customer", match: "架空商事", start: second, end: second + 4, reason: "架空の理由", source: "ai" },
    ]);
  });

  it("同じ範囲は最初の1つだけ、返す順は start の昇順、コードフェンスつきも読む", () => {
    const text = "来月に新工場を建てる計画。予算は 900 万円";
    const raw = "```json\n" + rawOf(cand("900 万円", "amount", "一つ目"), cand("新工場", "plan"), cand("900 万円", "other", "二つ目")) + "\n```";
    const v = validateAiFlags(raw, text, []);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.flags.map((f) => f.match)).toEqual(["新工場", "900 万円"]);
    expect(v.flags[1]).toMatchObject({ type: "ai_amount", reason: "一つ目" });
  });

  it("strict：余分な項目・21件以上・長すぎる match は違反（errors に値を含めない）", () => {
    const extra = validateAiFlags({ candidates: [], note: "秘密の値" }, "x", []);
    expect(extra.ok).toBe(false);
    if (!extra.ok) expect(extra.errors.join("")).not.toContain("秘密の値");
    const many = validateAiFlags({ candidates: Array.from({ length: 21 }, () => cand("x")) }, "x", []);
    expect(many.ok).toBe(false);
    const long = validateAiFlags({ candidates: [cand("あ".repeat(101))] }, "x", []);
    expect(long.ok).toBe(false);
    const empty = validateAiFlags({ candidates: [] }, "x", []);
    expect(empty).toEqual({ ok: true, flags: [] });
  });
});

describe("buildSensitivePrompt", () => {
  it("本文・known の範囲と種類・前回の問題だけを入れる", () => {
    const p = buildSensitivePrompt({
      text: TRAP5,
      known: [{ start: 0, end: 5, type: "registered_term" }],
      previousErrors: ["candidates.0.kind: invalid_value"],
    });
    expect(p).toContain(TRAP5);
    expect(p).toContain("0〜5（registered_term）");
    expect(p).toContain("candidates.0.kind: invalid_value");
  });
});

describe("DemoSensitiveProvider", () => {
  it("⑨ 一時ディレクトリの fixture を読め、ないときは ProviderUnavailableError", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsubuyaki-sensitive-"));
    try {
      const fx = sensitiveFixturePath(TRAP5, dir);
      expect(path.basename(fx)).toMatch(/^sensitive-[0-9a-f]{16}\.json$/);
      const raw = rawOf(cand("350 万円", "amount"));
      fs.writeFileSync(fx, JSON.stringify({ model: "claude-sonnet-5-5", raw }), "utf8");
      const p = new DemoSensitiveProvider(dir);
      const out = await p.check({ text: TRAP5, known: [] });
      expect(out.raw).toBe(raw);
      expect(out.model).toContain("claude-sonnet-5-5");

      const r = await checkSensitiveWithAi(TRAP5, { provider: p });
      expect(r.ok).toBe(true);

      await expect(p.check({ text: "fixture のない架空の本文", known: [] })).rejects.toBeInstanceOf(
        ProviderUnavailableError,
      );
      // raw が文字列でない fixture も使えない
      fs.writeFileSync(sensitiveFixturePath("壊れた fixture", dir), JSON.stringify({ model: "m", raw: 1 }), "utf8");
      await expect(p.check({ text: "壊れた fixture", known: [] })).rejects.toBeInstanceOf(ProviderUnavailableError);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("checkShareWithAi", () => {
  const OWNER = "newcomer_a";
  const OTHER = "newcomer_b";

  function prepareDb(): { db: DatabaseSync; insert: (body: string, status?: string, user?: string) => number } {
    const db = openDb(":memory:");
    const s = startSession({ userId: OWNER, taskName: "架空の見積り作業" }, db, "2026-11-03T13:00:00+09:00");
    if (!s.ok) throw new Error("開始できない");
    const sum = db
      .prepare("INSERT INTO session_summaries (session_id, json, model, created_at) VALUES (?, '{}', 'demo', '2026-11-03T14:00:00+09:00')")
      .run(s.session.id);
    const summaryId = Number(sum.lastInsertRowid);
    const insert = (body: string, status = "pending", user = OWNER) => {
      const r = db
        .prepare(
          "INSERT INTO share_candidates (session_id, user_id, task_name, summary_id, draft_body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, '2026-11-03T14:00:00+09:00')",
        )
        .run(s.session.id, user, "架空の見積り作業", summaryId, body, status);
      return Number(r.lastInsertRowid);
    };
    return { db, insert };
  }

  it("⑮ 他人の userId・pending でない候補・ない候補では provider を呼ばない", async () => {
    const { db, insert } = prepareDb();
    const pendingId = insert(TRAP5);
    const approvedId = insert("承認済みの架空の本文", "approved");
    const calls: SensitiveInput[] = [];
    const p = mockProvider([rawOf()], calls);
    expect(await checkShareWithAi(pendingId, OTHER, { provider: p }, db)).toEqual({ ok: false, error: "not_your_share" });
    expect(await checkShareWithAi(approvedId, OWNER, { provider: p }, db)).toEqual({ ok: false, error: "already_decided" });
    expect(await checkShareWithAi(99999, OWNER, { provider: p }, db)).toEqual({ ok: false, error: "share_not_found" });
    expect(calls).toHaveLength(0);
  });

  it("⑮ 成功のときは provider の text が候補の draft_body と同じ", async () => {
    const { db, insert } = prepareDb();
    const id = insert(TRAP5);
    const calls: SensitiveInput[] = [];
    const r = await checkShareWithAi(id, OWNER, { provider: mockProvider([rawOf(cand("350 万円", "amount"))], calls) }, db);
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toBe(TRAP5);
    expect(r.ok).toBe(true);
    if (!("deterministic" in r) || !r.ok) return;
    expect(r.ai).toHaveLength(1);
    expect(r.deterministic).toEqual(detectSensitive(TRAP5));
    // DB には書かない
    const row = db.prepare("SELECT status, final_body FROM share_candidates WHERE id = ?").get(id) as {
      status: string;
      final_body: string | null;
    };
    expect(row).toEqual({ status: "pending", final_body: null });
  });
});
