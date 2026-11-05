import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { seedDemo, DEMO_TASK_W1, DEMO_TASK_W2, DEMO_TASK_W3, DEMO_TASKS } from "./seed";
import { getKnowledgeHints, startSession, listHistory } from "./sessions";

describe("seedDemo（M7 の前倒し）", () => {
  it("1回目は W1〜W3 が入り、2回目は何も増えない", () => {
    const db = openDb(":memory:");
    const a = seedDemo(db);
    const b = seedDemo(db);
    expect(a.inserted).toBe(true);
    expect(a.insertedTasks).toEqual(["W1", "W2", "W3"]);
    expect(b).toEqual({ inserted: false, sessionId: a.sessionId, insertedTasks: [], reset: undefined });
    expect(db.prepare("SELECT count(*) c FROM work_sessions").get()).toEqual({ c: 3 });
    expect(db.prepare("SELECT count(*) c FROM notes").get()).toEqual({ c: 12 });
    expect(db.prepare("SELECT count(*) c FROM session_summaries").get()).toEqual({ c: 1 });
    expect(db.prepare("SELECT count(*) c FROM shared_knowledge").get()).toEqual({ c: 1 });
    expect(DEMO_TASKS.map((t) => t.taskName)).toEqual([DEMO_TASK_W1, DEMO_TASK_W2, DEMO_TASK_W3]);
  });

  it("W1〜W3 はすべて終了済みで、履歴に所要時間つきで並ぶ（W1 は 240 分＝半日）", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    const h = listHistory("newcomer_a", db);
    expect(h.map((s) => [s.task_name, s.duration_min])).toEqual([
      [DEMO_TASK_W3, 60],
      [DEMO_TASK_W2, 90],
      [DEMO_TASK_W1, 240],
    ]);
  });

  it("入れた直後、新人A が W1 を始めると M1-4 の①②が出る。新人B には②だけ出る", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    const a = getKnowledgeHints("newcomer_a", DEMO_TASK_W1, db);
    expect(a.pastStruggles).toHaveLength(1);
    expect(a.pastStruggles[0].text).toContain("既存スクリプトの場所");
    expect(a.teamKnowledge).toHaveLength(1);
    expect(a.teamKnowledge[0].display_name).toBe("新人A");

    const b = getKnowledgeHints("newcomer_b", DEMO_TASK_W1, db);
    expect(b.pastStruggles).toHaveLength(0);
    expect(b.teamKnowledge).toHaveLength(1);
  });

  it("reset：進行中の作業があっても、全行を消してから入れ直せる（users は残る）", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    startSession({ userId: "newcomer_a", taskName: "別の作業" }, db);
    expect(db.prepare("SELECT count(*) c FROM work_sessions").get()).toEqual({ c: 4 });

    const r = seedDemo(db, { reset: true });
    expect(r.inserted).toBe(true);
    expect(r.reset).toEqual({ share_candidates: 0, shared_knowledge: 1, session_summaries: 1, notes: 12, work_sessions: 4 });
    expect(db.prepare("SELECT count(*) c FROM work_sessions").get()).toEqual({ c: 3 });
    expect(db.prepare("SELECT count(*) c FROM users").get()).toEqual({ c: 3 });
    expect(getKnowledgeHints("newcomer_a", DEMO_TASK_W1, db).teamKnowledge).toHaveLength(1);
  });

  it("デモの作業は終了済みなので、新人A はすぐ次の作業を始められる", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    expect(startSession({ userId: "newcomer_a", taskName: DEMO_TASK_W1 }, db).ok).toBe(true);
  });

  it("メールアドレスや会社名の形を含まない（架空のデータ。実案件の語の照合はリポジトリ外のオーナーの検査で行う）", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    const texts = [
      ...(db.prepare("SELECT body FROM notes").all() as { body: string }[]).map((r) => r.body),
      ...(db.prepare("SELECT json FROM session_summaries").all() as { json: string }[]).map((r) => r.json),
      ...(db.prepare("SELECT body FROM shared_knowledge").all() as { body: string }[]).map((r) => r.body),
    ].join("\n");
    expect(texts).not.toMatch(/@/);
    expect(texts).not.toMatch(/株式会社|有限会社|Inc\.|Corp\./);
  });
});
