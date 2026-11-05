import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { seedDemo, DEMO_TASK_W1, DEMO_TASK_W2, DEMO_TASK_W3, DEMO_TASKS } from "./seed";
import { getKnowledgeHints, startSession, listHistory } from "./sessions";
import { listProcedureSources } from "@/lib/procedure";

describe("seedDemo（M7 の前倒し）", () => {
  it("1回目は W1〜W3 が入り、2回目は何も増えない", () => {
    const db = openDb(":memory:");
    const a = seedDemo(db);
    const b = seedDemo(db);
    expect(a.inserted).toBe(true);
    expect(a.insertedTasks).toEqual(["W1", "W2", "W3"]);
    expect(b).toEqual({ inserted: false, sessionId: a.sessionId, insertedTasks: [], reset: undefined });
    expect(db.prepare("SELECT count(*) c FROM work_sessions").get()).toEqual({ c: 4 });
    expect(db.prepare("SELECT count(*) c FROM notes").get()).toEqual({ c: 15 });
    expect(db.prepare("SELECT count(*) c FROM session_summaries").get()).toEqual({ c: 1 });
    expect(db.prepare("SELECT count(*) c FROM shared_knowledge").get()).toEqual({ c: 2 });
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
    expect(a.teamKnowledge).toHaveLength(2);
    expect(a.teamKnowledge[0].display_name).toBe("新人A");

    const b = getKnowledgeHints("newcomer_b", DEMO_TASK_W1, db);
    expect(b.pastStruggles).toHaveLength(0);
    expect(b.teamKnowledge).toHaveLength(2);
  });

  it("reset：進行中の作業があっても、全行を消してから入れ直せる（users は残る）", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    startSession({ userId: "newcomer_a", taskName: "別の作業" }, db);
    expect(db.prepare("SELECT count(*) c FROM work_sessions").get()).toEqual({ c: 5 });

    const r = seedDemo(db, { reset: true });
    expect(r.inserted).toBe(true);
    expect(r.reset).toEqual({ share_candidates: 0, shared_knowledge: 2, session_summaries: 1, notes: 15, work_sessions: 5 });
    expect(db.prepare("SELECT count(*) c FROM work_sessions").get()).toEqual({ c: 4 });
    expect(db.prepare("SELECT count(*) c FROM users").get()).toEqual({ c: 3 });
    expect(getKnowledgeHints("newcomer_a", DEMO_TASK_W1, db).teamKnowledge).toHaveLength(2);
  });

  it("T-018：seed の後、W1 の手順書の材料は2件で、1件目が先輩C（承認日時の古い順）", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    const sources = listProcedureSources(DEMO_TASK_W1, db);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({
      n: 1,
      display_name: "先輩C",
      role: "senior",
      approved_at: "2026-10-20T10:10:00+09:00",
      body: "出力形式の変更を頼まれたら、まず今の CSV の見本と、それを読む人・仕組みを確認する。列の番号で読む表計算があると列の順を変えるだけで壊れるので、変える前に読む側に知らせる。既存のスクリプトは共有ドライブの tools フォルダにある。",
    });
    expect(sources[1]).toMatchObject({ n: 2, display_name: "新人A", approved_at: "2026-10-27T14:10:00+09:00" });
    // 共有は先輩C の W1 の作業に結びつき、先輩C の整理結果は入れない
    const sk = db.prepare("SELECT session_id FROM shared_knowledge WHERE user_id = 'senior_c'").get() as { session_id: number };
    const ws = db.prepare("SELECT user_id, task_name FROM work_sessions WHERE id = ?").get(sk.session_id);
    expect(ws).toEqual({ user_id: "senior_c", task_name: DEMO_TASK_W1 });
    expect(
      db.prepare("SELECT count(*) c FROM session_summaries s JOIN work_sessions w ON w.id = s.session_id WHERE w.user_id = 'senior_c'").get(),
    ).toEqual({ c: 0 });
  });

  it("T-018：先輩C の W1 の作業は終了済みでメモ3件（この順・この時刻・この本文）。2回目の seed で増えない", () => {
    const db = openDb(":memory:");
    seedDemo(db);
    seedDemo(db);
    const sessions = db
      .prepare("SELECT id, task_name, started_at, ended_at, status FROM work_sessions WHERE user_id = 'senior_c'")
      .all() as { id: number; task_name: string; started_at: string; ended_at: string; status: string }[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      task_name: DEMO_TASK_W1,
      started_at: "2026-10-20T09:00:00+09:00",
      ended_at: "2026-10-20T10:00:00+09:00",
      status: "ended",
    });
    const notes = db
      .prepare("SELECT created_at, body, kind FROM notes WHERE session_id = ? ORDER BY id")
      .all(sessions[0].id) as { created_at: string; body: string; kind: string }[];
    expect(notes.map((n) => ({ ...n }))).toEqual([
      { created_at: "2026-10-20T09:05:00+09:00", kind: "memo", body: "出力形式の変更を頼まれたら、まず今の CSV の見本と、それを読む人と仕組みを依頼者に聞く" },
      { created_at: "2026-10-20T09:30:00+09:00", kind: "memo", body: "経理の集計の表計算が列の番号で読んでいるので、列の順を変えるだけで壊れる。変える前に読む側の担当に知らせる" },
      { created_at: "2026-10-20T09:50:00+09:00", kind: "memo", body: "既存のスクリプトは共有ドライブの tools フォルダにある。探す前に場所を聞くほうが早い" },
    ]);
    expect(db.prepare("SELECT count(*) c FROM shared_knowledge WHERE user_id = 'senior_c'").get()).toEqual({ c: 1 });
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
