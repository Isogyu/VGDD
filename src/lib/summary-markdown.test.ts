import { describe, expect, it } from "vitest";
import type { Note, WorkSession } from "./sessions";
import { SUMMARY_KEYS, SUMMARY_LABELS, type Summary, type SummaryItem } from "./summary-schema";
import { MARKDOWN_DISCLAIMER, summaryToMarkdown } from "./summary-markdown";

// 合成データ（架空の作業名・メモ）
const SESSION: WorkSession = {
  id: 1,
  user_id: "demo-user",
  task_name: "架空の在庫画面の並び替え修正",
  started_at: "2026-11-03T13:05:00+09:00",
  ended_at: "2026-11-03T13:50:00+09:00",
  duration_min: 45,
  status: "ended",
};

function note(id: number, body: string, hm: string): Note {
  return {
    id,
    session_id: 1,
    user_id: "demo-user",
    body,
    kind: "memo",
    created_at: `2026-11-03T${hm}:00+09:00`,
    flags_json: null,
  };
}

// #1〜#4。#2（id 12）は AI に送らなかった（除外した）メモ
const NOTES: Note[] = [
  note(11, "並び替えが逆順になる", "13:10"),
  note(12, "除外した個人的なメモ", "13:15"),
  note(13, "比較関数の符号を確認した", "13:20"),
  note(14, "テスト用の架空データで再現した", "13:30"),
];

function item(text: string, ids: number[], status?: SummaryItem["status"]): SummaryItem {
  return { text, evidence_note_ids: ids, inferred: status === "inferred", ...(status ? { status } : {}) };
}

function makeSummary(): Summary {
  return {
    schema: "tsubuyaki.summary.v1",
    struggle: item("並び替えが逆順になった", [11], "evidenced"),
    cause: item("比較関数の符号が逆だった", [14, 13], "evidenced"),
    tried: item("架空データで再現した", [14], "evidenced"),
    resolution: item("符号を直した", [13], "evidenced"),
    decision_reason: item("影響範囲が小さいと判断した", [], "inferred"),
    learning: item("比較関数は小さなテストで確かめる", [13]), // status なし（古い形）→ evidenced
    unresolved: item("なし", []), // status なし（古い形）→ none
    ask_human: item("記録なし", [], "none"),
    questions: [],
    source_note_ids: [11, 13, 14],
  };
}

describe("summaryToMarkdown（T-002）", () => {
  it("作業名の見出し・開始と所要の行・8つの見出しがこの順で並ぶ", () => {
    const md = summaryToMarkdown(makeSummary(), NOTES, SESSION);
    const lines = md.split("\n");
    expect(lines[0]).toBe("# 架空の在庫画面の並び替え修正");
    const timeLine = lines.find((l) => l.includes("11/3 13:05"));
    expect(timeLine).toBeDefined();
    expect(timeLine).toContain("45分");
    expect(md.indexOf("11/3 13:05")).toBeLessThan(md.indexOf("## "));

    const h2 = lines.filter((l) => l.startsWith("## "));
    expect(h2).toHaveLength(9);
    SUMMARY_KEYS.forEach((key, i) => {
      expect(h2[i].startsWith(`## ${SUMMARY_LABELS[key]}`)).toBe(true);
    });
    expect(h2[8]).toBe("## 根拠のメモ");
  });

  it("inferred は「（AI の推測）」、none は「（記録なし）」が見出しの末尾に付く。根拠はメモの番号で書く", () => {
    const md = summaryToMarkdown(makeSummary(), NOTES, SESSION);
    const lines = md.split("\n");
    expect(lines).toContain("## 判断の理由（AI の推測）");
    expect(lines).toContain("## 未解決（記録なし）");
    expect(lines).toContain("## 人に確認すべきこと（記録なし）");
    expect(lines).toContain("## つまずき");
    expect(lines).toContain("## 学び");
    // 根拠の番号は notes の並び順（1始まり）、番号順
    expect(lines).toContain("根拠: #3, #4");
    expect(lines).toContain("根拠: #1");
    // 根拠のない項目には「根拠:」行を出さない
    const reasonAt = lines.indexOf("## 判断の理由（AI の推測）");
    expect(lines.slice(reasonAt, reasonAt + 4).some((l) => l.startsWith("根拠:"))).toBe(false);
  });

  it("除外したメモは「根拠のメモ」に出ず、含まれるメモは #番号・時刻・本文つきで番号順に出る", () => {
    const md = summaryToMarkdown(makeSummary(), NOTES, SESSION);
    const section = md.slice(md.indexOf("## 根拠のメモ"));
    const items = section.split("\n").filter((l) => l.startsWith("- "));
    expect(items).toEqual([
      "- #1 13:10 並び替えが逆順になる",
      "- #3 13:20 比較関数の符号を確認した",
      "- #4 13:30 テスト用の架空データで再現した",
    ]);
    expect(md).not.toContain("除外した個人的なメモ");
    expect(md).not.toContain("#2 ");
  });

  it("最後の行は AI の原案である旨の注意書き", () => {
    const md = summaryToMarkdown(makeSummary(), NOTES, SESSION);
    const lines = md.split("\n");
    expect(lines[lines.length - 1]).toBe("※ これは AI の原案です。利用前に本人・先輩の確認が必要です。");
    expect(MARKDOWN_DISCLAIMER).toBe(lines[lines.length - 1]);
  });

  it("根拠のメモが空でも見出しと最後の行は出る", () => {
    const md = summaryToMarkdown({ ...makeSummary(), source_note_ids: [] }, NOTES, SESSION);
    expect(md).toContain("## 根拠のメモ");
    expect(md.split("\n").filter((l) => l.startsWith("- "))).toEqual([]);
    expect(md.endsWith(MARKDOWN_DISCLAIMER)).toBe(true);
  });
});
