import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { listTeamKnowledge } from "./team-knowledge";

// 試験のデータはすべて架空（作業名・本文とも実在の案件ではない）

function insertKnowledge(
  db: DatabaseSync,
  k: { task_name: string; user_id: string; body: string; approved_at: string; withdrawn_at?: string | null },
): number {
  const r = db
    .prepare(
      "INSERT INTO shared_knowledge (task_name, user_id, session_id, body, approved_at, withdrawn_at) VALUES (?, ?, NULL, ?, ?, ?)",
    )
    .run(k.task_name, k.user_id, k.body, k.approved_at, k.withdrawn_at ?? null);
  return Number(r.lastInsertRowid);
}

describe("listTeamKnowledge", () => {
  it("① 取り下げ済みの共有は出ない", () => {
    const db = openDb(":memory:");
    const kept = insertKnowledge(db, {
      task_name: "架空の集計作業",
      user_id: "newcomer_a",
      body: "残す共有",
      approved_at: "2026-11-03T10:00:00+09:00",
    });
    insertKnowledge(db, {
      task_name: "架空の集計作業",
      user_id: "senior_c",
      body: "取り下げた共有",
      approved_at: "2026-11-03T11:00:00+09:00",
      withdrawn_at: "2026-11-03T12:00:00+09:00",
    });
    const groups = listTeamKnowledge(db);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.id)).toEqual([kept]);
    expect(JSON.stringify(groups)).not.toContain("取り下げた共有");
  });

  it("① 作業名の共有がすべて取り下げ済みなら、その作業名も出ない", () => {
    const db = openDb(":memory:");
    insertKnowledge(db, {
      task_name: "架空の点検作業",
      user_id: "newcomer_b",
      body: "取り下げた共有",
      approved_at: "2026-11-03T10:00:00+09:00",
      withdrawn_at: "2026-11-03T10:30:00+09:00",
    });
    expect(listTeamKnowledge(db)).toEqual([]);
  });

  it("② 作業名ごとにまとまり、作業名の昇順・各まとまりは承認日時の昇順（同時刻は id の昇順）", () => {
    const db = openDb(":memory:");
    const b2 = insertKnowledge(db, { task_name: "B 架空の作業", user_id: "senior_c", body: "B の2件目", approved_at: "2026-11-04T09:00:00+09:00" });
    const a2 = insertKnowledge(db, { task_name: "A 架空の作業", user_id: "newcomer_a", body: "A の2件目", approved_at: "2026-11-03T15:00:00+09:00" });
    const b1 = insertKnowledge(db, { task_name: "B 架空の作業", user_id: "newcomer_b", body: "B の1件目", approved_at: "2026-11-03T08:00:00+09:00" });
    const a1 = insertKnowledge(db, { task_name: "A 架空の作業", user_id: "senior_c", body: "A の1件目", approved_at: "2026-11-03T09:00:00+09:00" });
    const a3 = insertKnowledge(db, { task_name: "A 架空の作業", user_id: "newcomer_b", body: "A の3件目", approved_at: "2026-11-03T15:00:00+09:00" });

    const groups = listTeamKnowledge(db);
    expect(groups.map((g) => g.task_name)).toEqual(["A 架空の作業", "B 架空の作業"]);
    expect(groups[0].items.map((i) => i.id)).toEqual([a1, a2, a3]);
    expect(groups[1].items.map((i) => i.id)).toEqual([b1, b2]);
    expect(groups[0].items[0]).toMatchObject({ body: "A の1件目", approved_at: "2026-11-03T09:00:00+09:00" });
  });

  it("③ display_name と role が users から入る", () => {
    const db = openDb(":memory:");
    insertKnowledge(db, { task_name: "架空の集計作業", user_id: "newcomer_a", body: "新人の共有", approved_at: "2026-11-03T10:00:00+09:00" });
    insertKnowledge(db, { task_name: "架空の集計作業", user_id: "senior_c", body: "先輩の共有", approved_at: "2026-11-03T11:00:00+09:00" });
    const [g] = listTeamKnowledge(db);
    expect(g.items.map((i) => ({ display_name: i.display_name, role: i.role }))).toEqual([
      { display_name: "新人A", role: "newcomer" },
      { display_name: "先輩C", role: "senior" },
    ]);
    // 返す項目は決められたものだけ（user_id などは含めない）
    expect(Object.keys(g.items[0]).sort()).toEqual(["approved_at", "body", "display_name", "id", "role"]);
  });

  it("④ 共有のない作業名は出ない（作業の記録があっても）", () => {
    const db = openDb(":memory:");
    // 共有のない作業名の作業セッション（work_sessions にはあるが shared_knowledge にはない）
    db.prepare("INSERT INTO work_sessions (user_id, task_name, started_at) VALUES ('newcomer_b', '共有のない架空の作業', '2026-11-03T09:00:00+09:00')").run();
    insertKnowledge(db, { task_name: "架空の集計作業", user_id: "newcomer_a", body: "共有", approved_at: "2026-11-03T10:00:00+09:00" });
    const groups = listTeamKnowledge(db);
    expect(groups.map((g) => g.task_name)).toEqual(["架空の集計作業"]);
  });

  it("作業名が constructor・__proto__ のような文字列でも、作業名ごとに正しくまとまる（差し戻し A4）", () => {
    const db = openDb(":memory:");
    const c1 = insertKnowledge(db, { task_name: "constructor", user_id: "newcomer_a", body: "c の1件目", approved_at: "2026-11-03T09:00:00+09:00" });
    const p1 = insertKnowledge(db, { task_name: "__proto__", user_id: "senior_c", body: "p の1件目", approved_at: "2026-11-03T10:00:00+09:00" });
    const c2 = insertKnowledge(db, { task_name: "constructor", user_id: "senior_c", body: "c の2件目", approved_at: "2026-11-03T11:00:00+09:00" });
    const t1 = insertKnowledge(db, { task_name: "toString", user_id: "newcomer_b", body: "t の1件目", approved_at: "2026-11-03T12:00:00+09:00" });

    const groups = listTeamKnowledge(db);
    // SQLite の文字列の昇順（"_" < "c" < "t"）
    expect(groups.map((g) => g.task_name)).toEqual(["__proto__", "constructor", "toString"]);
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([[p1], [c1, c2], [t1]]);
    for (const g of groups) {
      expect(typeof g.task_name).toBe("string");
      expect(Array.isArray(g.items)).toBe(true);
    }
  });

  it("④ 共有が1件もなければ空の配列", () => {
    const db = openDb(":memory:");
    expect(listTeamKnowledge(db)).toEqual([]);
  });
});
