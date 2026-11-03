import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { startSession, addNote, listNotes, deleteNote } from "./sessions";

describe("メモ（M2-1・M2-2）", () => {
  it("連続して5件書いても、順序と時刻が保たれる", () => {
    const db = openDb(":memory:");
    const r = startSession({ userId: "newcomer_a", taskName: "A" }, db, "2026-11-03T13:00:00+09:00");
    if (!r.ok) throw new Error();
    const times = ["13:01:00", "13:01:05", "13:01:05", "13:02:30", "13:10:00"].map((t) => `2026-11-03T${t}+09:00`);
    times.forEach((t, i) => addNote({ sessionId: r.session.id, userId: "newcomer_a", body: `メモ${i + 1}` }, db, t));
    const notes = listNotes(r.session.id, db);
    expect(notes.map((n) => n.body)).toEqual(["メモ1", "メモ2", "メモ3", "メモ4", "メモ5"]);
    expect(notes.map((n) => n.created_at)).toEqual(times);
    expect(notes.every((n) => n.kind === "memo" && n.flags_json === null)).toBe(true);
  });

  it("別のセッションのメモは混ざらない", () => {
    const db = openDb(":memory:");
    const a = startSession({ userId: "newcomer_a", taskName: "A" }, db);
    const b = startSession({ userId: "newcomer_b", taskName: "A" }, db);
    if (!a.ok || !b.ok) throw new Error();
    addNote({ sessionId: a.session.id, userId: "newcomer_a", body: "Aのメモ" }, db);
    addNote({ sessionId: b.session.id, userId: "newcomer_b", body: "Bのメモ" }, db);
    expect(listNotes(a.session.id, db).map((n) => n.body)).toEqual(["Aのメモ"]);
    expect(listNotes(b.session.id, db).map((n) => n.body)).toEqual(["Bのメモ"]);
  });

  it("本人のメモだけ削除できる。他人のメモや存在しない ID は false", () => {
    const db = openDb(":memory:");
    const a = startSession({ userId: "newcomer_a", taskName: "A" }, db);
    if (!a.ok) throw new Error();
    const n1 = addNote({ sessionId: a.session.id, userId: "newcomer_a", body: "消すメモ" }, db);
    const n2 = addNote({ sessionId: a.session.id, userId: "newcomer_a", body: "残すメモ" }, db);
    expect(deleteNote(n1.id, "newcomer_b", db)).toBe(false); // 他人
    expect(deleteNote(9999, "newcomer_a", db)).toBe(false); // 存在しない
    expect(deleteNote(n1.id, "newcomer_a", db)).toBe(true);
    expect(listNotes(a.session.id, db).map((n) => n.id)).toEqual([n2.id]);
    expect(deleteNote(n1.id, "newcomer_a", db)).toBe(false); // 2回目
  });

  it("検査結果（flags_json）が保存される", () => {
    const db = openDb(":memory:");
    const r = startSession({ userId: "newcomer_a", taskName: "A" }, db);
    if (!r.ok) throw new Error();
    const flags = [{ type: "email", match: "x@example.com", start: 0, end: 13 }];
    const n = addNote({ sessionId: r.session.id, userId: "newcomer_a", body: "x@example.com に送った", flagsJson: JSON.stringify(flags) }, db);
    expect(JSON.parse(n.flags_json!)).toEqual(flags);
  });
});
