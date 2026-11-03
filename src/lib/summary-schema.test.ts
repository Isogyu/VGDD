import { describe, expect, it } from "vitest";
import { validateAndMap, extractJson, SUMMARY_KEYS, itemStatus, isNoneText } from "./summary-schema";

const NOTE_IDS = [101, 102, 103];

function good(overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {};
  for (const k of SUMMARY_KEYS) base[k] = { text: `${k} の本文`, evidence: [1] };
  base.ask_human = { text: "既存コードの場所", evidence: [3] };
  base.unresolved = { text: "なし", evidence: [] };
  base.decision_reason = { text: "推測の判断", evidence: [] };
  base.questions = [{ text: "最初に何を確認しましたか？", target: "tried" }];
  return { ...base, ...overrides };
}

describe("validateAndMap（M4-1・M4-2・M4-3）", () => {
  it("正常：8項目が埋まり、メモ番号がメモ ID に写る。根拠なしは推測、「なし」は推測ではない", () => {
    const r = validateAndMap(good(), NOTE_IDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.struggle).toEqual({ text: "struggle の本文", evidence_note_ids: [101], inferred: false, status: "evidenced" });
    expect(r.summary.ask_human.evidence_note_ids).toEqual([103]);
    expect(r.summary.unresolved).toEqual({ text: "なし", evidence_note_ids: [], inferred: false, status: "none" });
    expect(r.summary.decision_reason.inferred).toBe(true);
    expect(r.summary.decision_reason.status).toBe("inferred");
    expect(r.summary.questions).toEqual([{ id: "q1", text: "最初に何を確認しましたか？", target: "tried" }]);
    expect(r.summary.source_note_ids).toEqual(NOTE_IDS);
  });

  it("JSON 文字列（コードフェンスや前置きつき）も受け付ける", () => {
    const text = "結果です。\n```json\n" + JSON.stringify(good()) + "\n```\n以上";
    expect(validateAndMap(text, NOTE_IDS).ok).toBe(true);
    expect(extractJson("前置き {\"a\":1} 後置き")).toBe('{"a":1}');
  });

  it("必須項目の欠落を検出する", () => {
    const g = good();
    delete (g as Record<string, unknown>).learning;
    const r = validateAndMap(g, NOTE_IDS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join("\n")).toContain("learning");
  });

  it("未知の項目を検出する（strict）", () => {
    const r = validateAndMap(good({ extra: { text: "x", evidence: [] } }), NOTE_IDS);
    expect(r.ok).toBe(false);
  });

  it("存在しないメモ番号を検出する", () => {
    const r = validateAndMap(good({ cause: { text: "x", evidence: [9] } }), NOTE_IDS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toContain("#9");
  });

  it("質問は2件まで。3件なら違反", () => {
    const qs = [1, 2, 3].map((i) => ({ text: `q${i}`, target: "cause" }));
    expect(validateAndMap(good({ questions: qs }), NOTE_IDS).ok).toBe(false);
    expect(validateAndMap(good({ questions: qs.slice(0, 2) }), NOTE_IDS).ok).toBe(true);
  });

  it("JSON として読めないものは違反", () => {
    const r = validateAndMap("これは JSON ではありません", NOTE_IDS);
    expect(r.ok).toBe(false);
  });

  it("「記録なし」と「AI の推測」を区別する：根拠がなく内容も述べていなければ none、内容を述べていれば inferred", () => {
    for (const t of ["なし", "該当なし", "記録なし", "メモには書かれていない", "メモからは分からない。", "不明"]) expect(isNoneText(t)).toBe(true);
    for (const t of ["先輩に聞く判断をしたとみられる", "なしと言われた", "特になしだが確認は要る"]) expect(isNoneText(t)).toBe(false);
    // 保存済みの古いデータ（status なし）でも判定できる
    expect(itemStatus({ text: "なし", evidence_note_ids: [], inferred: false })).toBe("none");
    expect(itemStatus({ text: "推測の内容", evidence_note_ids: [], inferred: true })).toBe("inferred");
    expect(itemStatus({ text: "根拠あり", evidence_note_ids: [1], inferred: false })).toBe("evidenced");
    expect(itemStatus({ text: "x", evidence_note_ids: [], inferred: false, status: "none" })).toBe("none");
  });

  it("同じ入力は常に同じ結果", () => {
    const a = validateAndMap(good(), NOTE_IDS);
    for (let i = 0; i < 20; i++) expect(validateAndMap(good(), NOTE_IDS)).toEqual(a);
  });
});
