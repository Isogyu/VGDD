import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DemoProvider, fixtureKey, loadFixture, saveFixture, clampEvidence, FIXTURE_DIR } from "./demo";
import { ProviderUnavailableError } from "./provider";
import { validateAndMap, SUMMARY_KEYS } from "../summary-schema";
import { openDb } from "../db";
import { seedDemo, DEMO_TASK_W1, DEMO_TASK_W2, DEMO_TASK_W3 } from "../seed";
import { listNotes, startSession, addNote, endSession } from "../sessions";
import { summarizeSession } from "../summarize";

describe("demo provider（M4-4：API キーなしで保存済みの出力を返す）", () => {
  it("fixture のキーは作業名の正規化後に決まる（空白の違いを吸収）", () => {
    expect(fixtureKey("社内向け集計スクリプトの改修", false)).toBe(fixtureKey("　社内向け集計スクリプトの改修 ", false));
    expect(fixtureKey("A", false)).not.toBe(fixtureKey("A", true));
  });

  it("W1〜W3 の fixture（実 API で採取）が読め、seed のメモに対して検証を通る（M4-4）", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    for (const task of [DEMO_TASK_W1, DEMO_TASK_W2, DEMO_TASK_W3]) {
      const fx = loadFixture(task, false, FIXTURE_DIR);
      expect(fx, `${task} の fixture がない（npm run demo:capture で採取する）`).not.toBeNull();
      expect(fx!.source).toBe("claude");
      const sid = (db.prepare("SELECT id FROM work_sessions WHERE task_name = ?").get(task) as { id: number }).id;
      const noteIds = listNotes(sid, db).map((n) => n.id);
      expect(fx!.note_count).toBe(noteIds.length);
      const v = validateAndMap(fx!.raw, noteIds);
      expect(v.ok, `${task}: ${v.ok ? "" : v.errors.join("; ")}`).toBe(true);
      if (v.ok) {
        // 8項目すべてが埋まり、根拠は seed のメモ ID に写っている
        for (const k of SUMMARY_KEYS) expect(v.summary[k].text.length).toBeGreaterThan(0);
        for (const k of SUMMARY_KEYS) for (const id of v.summary[k].evidence_note_ids) expect(noteIds).toContain(id);
      }
    }
  });

  it("summarizeSession を demo provider で通すと W1 は整理でき、fixture のない作業名は provider_unavailable", async () => {
    const db = openDb(":memory:");
    seedDemo(db);
    const w1 = db.prepare("SELECT id FROM work_sessions WHERE task_name = ?").get(DEMO_TASK_W1) as { id: number };
    const p = new DemoProvider(FIXTURE_DIR);
    const r1 = await summarizeSession(w1.id, { provider: p }, db);
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.model).toMatch(/^demo\(claude/);

    const other = startSession({ userId: "newcomer_b", taskName: "fixture のない作業" }, db, "2026-11-03T15:00:00+09:00");
    if (!other.ok) throw new Error();
    addNote({ sessionId: other.session.id, userId: "newcomer_b", body: "メモ" }, db);
    endSession(other.session.id, db, "2026-11-03T15:10:00+09:00");
    const r2 = await summarizeSession(other.session.id, { provider: p }, db);
    expect(r2).toMatchObject({ ok: false, reason: "provider_unavailable" });
  });

  it("メモが fixture より少ないときは、存在しない番号を落とす", () => {
    const raw = JSON.stringify({ struggle: { text: "x", evidence: [1, 4] }, questions: [] });
    expect(JSON.parse(clampEvidence(raw, 2)).struggle.evidence).toEqual([1]);
  });

  it("保存と読み込みが往復する。fixture がなければ ProviderUnavailableError", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsubuyaki-fx-"));
    const p = new DemoProvider(dir);
    await expect(p.summarize({ taskName: "ない作業", notes: [], partial: false })).rejects.toBeInstanceOf(ProviderUnavailableError);
    saveFixture({ task_name: "ある作業", partial: false, captured_at: "2026-11-03T15:00:00+09:00", model: "m", note_count: 1, raw: "{}" }, dir);
    const out = await p.summarize({ taskName: "ある作業", notes: [{ id: 1, body: "x", kind: "memo", created_at: "2026-11-03T15:00:00+09:00" }], partial: false });
    expect(out).toEqual({ raw: "{}", model: "demo(m)" });
  });
});
