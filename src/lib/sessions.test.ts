import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { startSession, getActiveSession, endSession, listNotes, getKnowledgeHints } from "./sessions";

const T0 = "2026-11-03T13:00:00+09:00";
const T1 = "2026-11-03T13:47:30+09:00";

describe("startSession（M1-1・M1-3）", () => {
  it("入力1回でセッションが1件でき、作業名と開始時刻が入る", () => {
    const db = openDb(":memory:");
    const r = startSession({ userId: "newcomer_a", taskName: "　社内向け集計スクリプトの改修 " }, db, T0);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.task_name).toBe("社内向け集計スクリプトの改修");
    expect(r.session.started_at).toBe(T0);
    expect(r.session.status).toBe("active");
    expect(getActiveSession("newcomer_a", db)?.id).toBe(r.session.id);
    expect(getActiveSession("newcomer_b", db)).toBeUndefined();
  });

  it("進行中があると force なしでは開始せず active_exists を返す（M1-3）", () => {
    const db = openDb(":memory:");
    startSession({ userId: "newcomer_a", taskName: "A" }, db, T0);
    const r = startSession({ userId: "newcomer_a", taskName: "B" }, db, T1);
    expect(r).toMatchObject({ ok: false, reason: "active_exists" });
    if (r.ok) return;
    expect(r.active.task_name).toBe("A");
    expect(db.prepare("SELECT count(*) c FROM work_sessions").get()).toEqual({ c: 1 });
  });

  it("force なら進行中を終了（所要時間つき）してから開始する", () => {
    const db = openDb(":memory:");
    startSession({ userId: "newcomer_a", taskName: "A" }, db, T0);
    const r = startSession({ userId: "newcomer_a", taskName: "B", force: true }, db, T1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.endedPrevious?.task_name).toBe("A");
    expect(r.endedPrevious?.status).toBe("ended");
    expect(r.endedPrevious?.duration_min).toBe(47);
    expect(getActiveSession("newcomer_a", db)?.task_name).toBe("B");
  });

  it("known / unknown（D-40⑥）はメモとして保存される。空なら保存しない", () => {
    const db = openDb(":memory:");
    const r = startSession(
      { userId: "newcomer_a", taskName: "A", known: "依頼者は経理部", unknown: "  " },
      db,
      T0,
    );
    if (!r.ok) throw new Error();
    const notes = listNotes(r.session.id, db);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: "known", body: "依頼者は経理部", created_at: T0 });
  });

  it("空の作業名は受け付けない", () => {
    const db = openDb(":memory:");
    expect(() => startSession({ userId: "newcomer_a", taskName: "   " }, db)).toThrow();
  });
});

describe("endSession（M3 の下地）", () => {
  it("終了時刻と所要時間（分、切り捨て）を記録し、2回目は変えない", () => {
    const db = openDb(":memory:");
    const r = startSession({ userId: "newcomer_a", taskName: "A" }, db, T0);
    if (!r.ok) throw new Error();
    const e = endSession(r.session.id, db, T1);
    expect(e).toMatchObject({ status: "ended", ended_at: T1, duration_min: 47 });
    const again = endSession(r.session.id, db, "2026-11-03T18:00:00+09:00");
    expect(again.duration_min).toBe(47);
  });
});

describe("getKnowledgeHints（M1-4）", () => {
  function seed(db: ReturnType<typeof openDb>) {
    // 新人A の過去の記録（終了済み）＋ M4 の整理結果
    const past = startSession({ userId: "newcomer_a", taskName: "開発環境の構築" }, db, "2026-11-01T10:00:00+09:00");
    if (!past.ok) throw new Error();
    endSession(past.session.id, db, "2026-11-01T11:00:00+09:00");
    db.prepare("INSERT INTO session_summaries (session_id, json, model, created_at) VALUES (?, ?, 'demo', ?)").run(
      past.session.id,
      JSON.stringify({ struggle: { text: "環境変数の設定漏れで起動しなかった", evidence_note_ids: [] } }),
      "2026-11-01T11:01:00+09:00",
    );
    // 別の作業名の記録（出ないこと）
    const other = startSession({ userId: "newcomer_a", taskName: "API 開発" }, db, "2026-11-02T10:00:00+09:00");
    if (!other.ok) throw new Error();
    endSession(other.session.id, db, "2026-11-02T10:30:00+09:00");
    db.prepare("INSERT INTO session_summaries (session_id, json, model, created_at) VALUES (?, ?, 'demo', ?)").run(
      other.session.id,
      JSON.stringify({ struggle: { text: "仕様が曖昧" } }),
      "2026-11-02T10:31:00+09:00",
    );
    // チームの承認済み知識（新人A が承認）と、取り下げ済みのもの
    db.prepare(
      "INSERT INTO shared_knowledge (task_name, user_id, body, approved_at) VALUES ('開発環境の構築', 'newcomer_a', '最初に .env.example をコピーしてから差分だけ直す', '2026-11-01T12:00:00+09:00')",
    ).run();
    db.prepare(
      "INSERT INTO shared_knowledge (task_name, user_id, body, approved_at, withdrawn_at) VALUES ('開発環境の構築', 'senior_c', '取り下げ済み', '2026-11-01T12:30:00+09:00', '2026-11-01T13:00:00+09:00')",
    ).run();
  }

  it("①自分の過去のつまずき ②チームの承認済み知識 を、同じ作業名だけ返す", () => {
    const db = openDb(":memory:");
    seed(db);
    const h = getKnowledgeHints("newcomer_a", "開発環境の構築", db);
    expect(h.pastStruggles).toEqual([
      { session_id: 1, started_at: "2026-11-01T10:00:00+09:00", text: "環境変数の設定漏れで起動しなかった" },
    ]);
    expect(h.teamKnowledge).toEqual([
      { id: 1, display_name: "新人A", approved_at: "2026-11-01T12:00:00+09:00", text: "最初に .env.example をコピーしてから差分だけ直す" },
    ]);
  });

  it("新人B が同じ作業を始めると、自分の過去はないが新人A の承認済み知識が出る（D-33②）", () => {
    const db = openDb(":memory:");
    seed(db);
    const h = getKnowledgeHints("newcomer_b", "開発環境の構築", db);
    expect(h.pastStruggles).toEqual([]);
    expect(h.teamKnowledge.map((k) => k.display_name)).toEqual(["新人A"]);
  });

  it("作業名が違えば何も出ない（完全一致。意味検索はしない）", () => {
    const db = openDb(":memory:");
    seed(db);
    const h = getKnowledgeHints("newcomer_a", "開発環境", db);
    expect(h.pastStruggles).toEqual([]);
    expect(h.teamKnowledge).toEqual([]);
  });
});
