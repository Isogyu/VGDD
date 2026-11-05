import { describe, expect, it } from "vitest";
import { openDb, listUsers, getUser, initializeDb } from "./db";
import { toJstIso, diffMinutes, formatMdHm, formatDuration, formatDelta } from "./time";

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

  it("6つの表ができている", () => {
    const db = openDb(":memory:");
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual([
      "notes",
      "session_summaries",
      "share_candidates",
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
  it("所要時間の表示：1分未満／分／時間と分", () => {
    expect(formatDuration(0)).toBe("1分未満");
    expect(formatDuration(1)).toBe("1分");
    expect(formatDuration(45)).toBe("45分");
    expect(formatDuration(60)).toBe("1時間0分");
    expect(formatDuration(240)).toBe("4時間0分");
    expect(formatDuration(275)).toBe("4時間35分");
    expect(formatDuration(null)).toBe("—");
  });
  it("前回との差の表示", () => {
    expect(formatDelta(-210)).toBe("前回より 3時間30分 短い");
    expect(formatDelta(10)).toBe("前回より 10分 長い");
    expect(formatDelta(0)).toBe("前回と同じ");
    expect(formatDelta(null)).toBe("");
  });
});
