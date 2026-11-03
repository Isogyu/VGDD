import { describe, expect, it } from "vitest";
import { openDb, listUsers, getUser, initializeDb } from "./db";
import { toJstIso, diffMinutes, formatMdHm } from "./time";

describe("db（node:sqlite）", () => {
  it("スキーマを適用し、固定ユーザー3人が入る。再初期化しても増えない", () => {
    const db = openDb(":memory:");
    expect(listUsers(db).map((u) => u.display_name)).toEqual(["新人A", "新人B", "先輩C"]);
    // 2回目の初期化（CREATE IF NOT EXISTS と INSERT OR IGNORE）
    initializeDb(db);
    expect(listUsers(db)).toHaveLength(3);
    expect(getUser("senior_c", db)?.role).toBe("senior");
    expect(getUser("nobody", db)).toBeUndefined();
  });

  it("5つの表ができている", () => {
    const db = openDb(":memory:");
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual([
      "notes",
      "session_summaries",
      "shared_knowledge",
      "users",
      "work_sessions",
    ]);
  });
});

describe("time（JST 固定）", () => {
  it("UTC の Date を +09:00 の文字列にする", () => {
    expect(toJstIso(new Date("2026-11-03T03:05:09Z"))).toBe("2026-11-03T12:05:09+09:00");
    // 日付をまたぐ
    expect(toJstIso(new Date("2026-11-03T16:00:00Z"))).toBe("2026-11-04T01:00:00+09:00");
  });
  it("所要時間は分で切り捨て、負にならない", () => {
    expect(diffMinutes("2026-11-03T12:00:00+09:00", "2026-11-03T12:34:59+09:00")).toBe(34);
    expect(diffMinutes("2026-11-03T12:00:00+09:00", "2026-11-03T11:59:00+09:00")).toBe(0);
  });
  it("表示用の形", () => {
    expect(formatMdHm("2026-11-03T09:07:00+09:00")).toBe("11/3 09:07");
  });
});
