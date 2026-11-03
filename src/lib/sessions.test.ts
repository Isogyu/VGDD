import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { startSession, getActiveSession, endSession, listNotes, getKnowledgeHints, listHistory, getHistoryItem, getPreviousSummary } from "./sessions";
import type { PreviousSummary as PreviousSummaryData } from "./sessions";
import { selectPreviousToRender, type FetchedPrevious } from "@/components/PreviousSummary";

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

  it("known / unknown も機密検査を通り、該当があれば flags_json が付く（司法の指摘 T-M1M3）", () => {
    const db = openDb(":memory:");
    const r = startSession(
      { userId: "newcomer_a", taskName: "A", known: "依頼者の内線は 03-1234-5678", unknown: "ホクト製菓の担当者が誰か" },
      db,
      T0,
    );
    if (!r.ok) throw new Error();
    const notes = listNotes(r.session.id, db);
    expect(notes).toHaveLength(2);
    const known = notes.find((n) => n.kind === "known")!;
    const unknown = notes.find((n) => n.kind === "unknown")!;
    expect(JSON.parse(known.flags_json!).map((f: { type: string }) => f.type)).toEqual(["phone"]);
    expect(JSON.parse(unknown.flags_json!).map((f: { type: string }) => f.type)).toEqual(["registered_term"]);
    // 該当がなければ null
    const r2 = startSession({ userId: "newcomer_b", taskName: "A", known: "依頼者は経理部" }, db, T0);
    if (!r2.ok) throw new Error();
    expect(listNotes(r2.session.id, db)[0].flags_json).toBeNull();
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

describe("listHistory（終了した作業の一覧）", () => {
  it("終了した作業だけを新しい順に、上限件数で返す", () => {
    const db = openDb(":memory:");
    // 開始・終了を明示（終了順は 作業3 > 作業1 > 作業6 > 作業2 > 作業5 > 作業4）
    const rows: [string, string, string][] = [
      ["作業1", "2026-11-02T09:00:00+09:00", "2026-11-02T09:30:00+09:00"],
      ["作業2", "2026-11-01T09:00:00+09:00", "2026-11-01T13:00:00+09:00"],
      ["作業3", "2026-11-03T08:00:00+09:00", "2026-11-03T08:20:00+09:00"],
      ["作業4", "2026-10-30T09:00:00+09:00", "2026-10-30T09:05:00+09:00"],
      ["作業5", "2026-10-31T09:00:00+09:00", "2026-10-31T10:00:00+09:00"],
      ["作業6", "2026-11-01T14:00:00+09:00", "2026-11-01T14:45:00+09:00"],
    ];
    for (const [name, s, e] of rows) {
      const r = startSession({ userId: "newcomer_a", taskName: name }, db, s);
      if (!r.ok) throw new Error();
      endSession(r.session.id, db, e);
    }
    expect(startSession({ userId: "newcomer_a", taskName: "進行中" }, db).ok).toBe(true);
    const h = listHistory("newcomer_a", db, 5);
    expect(h).toHaveLength(5);
    expect(h.every((s) => s.status === "ended")).toBe(true);
    expect(h.map((s) => s.task_name)).toEqual(["作業3", "作業1", "作業6", "作業2", "作業5"]);
    expect(h.map((s) => s.duration_min)).toEqual([20, 30, 45, 240, 60]);
    expect(h.every((s) => s.delta_min === null && s.prev_duration_min === null)).toBe(true); // 同じ作業名の前回がない
    expect(listHistory("newcomer_b", db)).toEqual([]);
  });

  it("前回との差は、本人の同じ作業名の直前の終了とだけ比べる（他人は比べない）", () => {
    const db = openDb(":memory:");
    const run = (user: string, name: string, s: string, e: string) => {
      const r = startSession({ userId: user, taskName: name }, db, s);
      if (!r.ok) throw new Error();
      endSession(r.session.id, db, e);
      return r.session.id;
    };
    run("newcomer_a", "W1", "2026-10-27T10:00:00+09:00", "2026-10-27T14:00:00+09:00"); // 240分
    run("newcomer_b", "W1", "2026-10-28T10:00:00+09:00", "2026-10-28T10:10:00+09:00"); // 他人の 10分（比べない）
    const second = run("newcomer_a", "W1", "2026-11-03T13:00:00+09:00", "2026-11-03T13:30:00+09:00"); // 30分
    run("newcomer_a", "別の作業", "2026-11-03T14:00:00+09:00", "2026-11-03T14:05:00+09:00");

    const h = listHistory("newcomer_a", db);
    expect(h.map((x) => [x.task_name, x.duration_min, x.prev_duration_min, x.delta_min])).toEqual([
      ["別の作業", 5, null, null],
      ["W1", 30, 240, -210],
      ["W1", 240, null, null],
    ]);
    expect(getHistoryItem(second, db)?.delta_min).toBe(-210);
    // 新人B の履歴は新人A と比べない
    expect(listHistory("newcomer_b", db)[0].delta_min).toBeNull();
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

describe("getPreviousSummary（T-001：前回との比較）", () => {
  type Db = ReturnType<typeof openDb>;
  const TASK = "月次レポートの集計";

  /** 終了済みの作業を1件作り、id を返す */
  function endedSession(db: Db, userId: string, taskName: string, startedAt: string, endedAt: string): number {
    const r = startSession({ userId, taskName }, db, startedAt);
    if (!r.ok) throw new Error();
    endSession(r.session.id, db, endedAt);
    return r.session.id;
  }

  /** parseStoredSummary が読める形の整理結果を1件入れる */
  function addSummary(db: Db, sessionId: number, struggle: string, learning: string, createdAt: string) {
    db.prepare("INSERT INTO session_summaries (session_id, json, model, created_at) VALUES (?, ?, 'demo', ?)").run(
      sessionId,
      JSON.stringify({
        schema: "tsubuyaki.summary.v1",
        struggle: { text: struggle, evidence_note_ids: [1], inferred: false, status: "evidenced" },
        learning: { text: learning, evidence_note_ids: [], inferred: false, status: "none" },
      }),
      createdAt,
    );
  }

  it("①前回がなければ null（初めての作業）", () => {
    const db = openDb(":memory:");
    const r = startSession({ userId: "newcomer_a", taskName: TASK }, db, T0);
    if (!r.ok) throw new Error();
    expect(getPreviousSummary(r.session.id, db)).toBeNull();
  });

  it("②他人の同じ作業名の記録（終了・整理済み）だけなら null（他人の記録は使わない、M9-4）", () => {
    const db = openDb(":memory:");
    const others = endedSession(db, "newcomer_b", TASK, "2026-11-01T10:00:00+09:00", "2026-11-01T11:00:00+09:00");
    addSummary(db, others, "新人B のつまずき", "新人B の学び", "2026-11-01T11:01:00+09:00");
    const r = startSession({ userId: "newcomer_a", taskName: TASK }, db, T0);
    if (!r.ok) throw new Error();
    expect(getPreviousSummary(r.session.id, db)).toBeNull();
  });

  it("③自分の同じ作業名の終了済み2件（整理結果あり）→ 直前の1件が返る", () => {
    const db = openDb(":memory:");
    const first = endedSession(db, "newcomer_a", TASK, "2026-11-01T10:00:00+09:00", "2026-11-01T14:00:00+09:00");
    addSummary(db, first, "集計の列の意味が分からなかった", "なし", "2026-11-01T14:01:00+09:00");
    const second = endedSession(db, "newcomer_a", TASK, "2026-11-02T10:00:00+09:00", "2026-11-02T11:00:00+09:00");
    addSummary(db, second, "古い版の手順書を見てしまった", "なし", "2026-11-02T11:01:00+09:00");
    // 別の作業名の記録は前回に数えない
    const other = endedSession(db, "newcomer_a", "別の作業", "2026-11-02T12:00:00+09:00", "2026-11-02T12:30:00+09:00");
    addSummary(db, other, "別の作業のつまずき", "なし", "2026-11-02T12:31:00+09:00");

    const r = startSession({ userId: "newcomer_a", taskName: TASK }, db, T0);
    if (!r.ok) throw new Error();
    expect(getPreviousSummary(r.session.id, db)).toEqual({
      session_id: second,
      task_name: TASK,
      ended_at: "2026-11-02T11:00:00+09:00",
      struggle: { text: "古い版の手順書を見てしまった", status: "evidenced" },
      learning: { text: "なし", status: "none" },
    });
    // 2回目から見た前回は1回目
    expect(getPreviousSummary(second, db)?.struggle.text).toBe("集計の列の意味が分からなかった");
  });

  it("前回はあるが整理結果がなければ null", () => {
    const db = openDb(":memory:");
    endedSession(db, "newcomer_a", TASK, "2026-11-01T10:00:00+09:00", "2026-11-01T11:00:00+09:00");
    const r = startSession({ userId: "newcomer_a", taskName: TASK }, db, T0);
    if (!r.ok) throw new Error();
    expect(getPreviousSummary(r.session.id, db)).toBeNull();
  });
});

describe("selectPreviousToRender（T-001：取得結果を sessionId・userId と結び付ける、OBS-018）", () => {
  const previous: PreviousSummaryData = {
    session_id: 1,
    task_name: "月次レポートの集計",
    ended_at: "2026-11-02T11:00:00+09:00",
    struggle: { text: "新人A のつまずき", status: "evidenced" },
    learning: { text: "なし", status: "none" },
  };
  const fetchedForA: FetchedPrevious = { sessionId: 10, userId: "newcomer_a", previous };

  it("取得結果がまだない（取得中）なら null", () => {
    expect(selectPreviousToRender(null, 10, "newcomer_a")).toBeNull();
  });

  it("userId を変えた直後（state は前のユーザーの結果）なら null", () => {
    expect(selectPreviousToRender(fetchedForA, 10, "newcomer_b")).toBeNull();
  });

  it("sessionId を変えた直後（state は前の作業の結果）なら null", () => {
    expect(selectPreviousToRender(fetchedForA, 11, "newcomer_a")).toBeNull();
  });

  it("sessionId・userId が一致すれば取得した previous を返す（前回なしの null もそのまま）", () => {
    expect(selectPreviousToRender(fetchedForA, 10, "newcomer_a")).toBe(previous);
    expect(selectPreviousToRender({ sessionId: 10, userId: "newcomer_a", previous: null }, 10, "newcomer_a")).toBeNull();
  });
});
