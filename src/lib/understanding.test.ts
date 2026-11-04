import { describe, expect, it } from "vitest";
import { SUMMARY_KEYS, SUMMARY_LABELS, type Summary, type SummaryItem, type SummaryKey } from "./summary-schema";
import { groupUnderstanding, UNDERSTANDING_LABELS, NOT_IN_NOTES_TEXT } from "./understanding";

// 架空の作業メモから作った整理結果（見本：summary-schema.test.ts）
const evidenced = (text: string, ids: number[] = [11]): SummaryItem => ({ text, evidence_note_ids: ids, inferred: false, status: "evidenced" });
const inferred = (text: string): SummaryItem => ({ text, evidence_note_ids: [], inferred: true, status: "inferred" });
const none = (): SummaryItem => ({ text: "なし", evidence_note_ids: [], inferred: false, status: "none" });

function makeSummary(overrides: Partial<Record<SummaryKey, SummaryItem>> & { questions?: Summary["questions"] } = {}): Summary {
  const base = {} as Record<SummaryKey, SummaryItem>;
  for (const k of SUMMARY_KEYS) base[k] = evidenced(`${k} の本文`);
  return {
    schema: "tsubuyaki.summary.v1",
    ...base,
    unresolved: none(),
    ask_human: none(),
    questions: [],
    source_note_ids: [11, 12, 13],
    ...overrides,
  };
}

describe("groupUnderstanding（M10-1、D-40 の区分）", () => {
  it("①evidenced の項目が confirmed に SUMMARY_KEYS の順で入る", () => {
    const u = groupUnderstanding(makeSummary({ learning: evidenced("帳票の列順は設定ファイルで決まる", [12, 13]) }));
    expect(u.confirmed.map((i) => i.key)).toEqual(["struggle", "cause", "tried", "resolution", "decision_reason", "learning"]);
    expect(u.confirmed[0]).toEqual({ key: "struggle", label: SUMMARY_LABELS.struggle, text: "struggle の本文", evidence_note_ids: [11] });
    expect(u.confirmed[5]).toEqual({ key: "learning", label: "学び", text: "帳票の列順は設定ファイルで決まる", evidence_note_ids: [12, 13] });
    expect(u.inferred).toEqual([]);
    expect(u.unverified).toEqual([]);
    expect(UNDERSTANDING_LABELS).toEqual({ confirmed: "確認済みの事実", inferred: "AI の推測", unverified: "未確認", ask_human: "人に確認すべきこと" });
  });

  it("②inferred の項目が inferred に入る（古い形の status なしも itemStatus で判定）", () => {
    const legacy: SummaryItem = { text: "設定の読み込み順が原因かもしれない", evidence_note_ids: [], inferred: true };
    const u = groupUnderstanding(makeSummary({ cause: legacy, decision_reason: inferred("影響範囲が小さいほうを選んだと思われる") }));
    expect(u.inferred.map((i) => i.key)).toEqual(["cause", "decision_reason"]);
    expect(u.inferred[0]).toEqual({ key: "cause", label: "原因", text: "設定の読み込み順が原因かもしれない", evidence_note_ids: [] });
    expect(u.confirmed.map((i) => i.key)).toEqual(["struggle", "tried", "resolution", "learning"]);
  });

  it("③none の項目が unverified に「まだメモにない」で入り、unresolved（evidenced）が先頭に入る", () => {
    const u = groupUnderstanding(
      makeSummary({ resolution: none(), learning: none(), unresolved: evidenced("テスト環境での再現がまだ", [13]) }),
    );
    expect(u.unverified).toEqual([
      { key: "unresolved", label: "未解決", text: "テスト環境での再現がまだ", evidence_note_ids: [13] },
      { key: "resolution", label: "解決", text: NOT_IN_NOTES_TEXT, evidence_note_ids: [] },
      { key: "learning", label: "学び", text: "まだメモにない", evidence_note_ids: [] },
    ]);
    // unresolved が none なら出さない
    expect(groupUnderstanding(makeSummary({ resolution: none() })).unverified.map((i) => i.key)).toEqual(["resolution"]);
  });

  it("④ask_human が none なら null、evidenced なら項目", () => {
    expect(groupUnderstanding(makeSummary()).ask_human).toBeNull();
    const u = groupUnderstanding(makeSummary({ ask_human: evidenced("架空の取引先コードの採番規則", [12]) }));
    expect(u.ask_human).toEqual({ key: "ask_human", label: "人に確認すべきこと", text: "架空の取引先コードの採番規則", evidence_note_ids: [12] });
    // 6項目の区分には入らない
    expect([...u.confirmed, ...u.inferred, ...u.unverified].some((i) => i.key === "ask_human")).toBe(false);
  });

  it("⑤questions が 0 件でも 2 件でもそのまま返る", () => {
    expect(groupUnderstanding(makeSummary()).questions).toEqual([]);
    const questions: Summary["questions"] = [
      { id: "q1", text: "最初に何を確認しましたか？", target: "tried" },
      { id: "q2", text: "その方法を選んだ理由は？", target: "decision_reason" },
    ];
    expect(groupUnderstanding(makeSummary({ questions })).questions).toEqual(questions);
  });
});
