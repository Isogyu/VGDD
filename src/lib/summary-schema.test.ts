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

  it("T-008 ①：「なし。メモには書かれていない」（evidence 空）は none。保存する text は変えない", () => {
    const r = validateAndMap(good({ cause: { text: "なし。メモには書かれていない", evidence: [] } }), NOTE_IDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.cause).toEqual({ text: "なし。メモには書かれていない", evidence_note_ids: [], inferred: false, status: "none" });
    expect(itemStatus({ text: "なし。メモには書かれていない", evidence_note_ids: [], inferred: false })).toBe("none");
  });

  it("T-008 ②：「原因はメモに記録がない」（evidence 空）は none", () => {
    const r = validateAndMap(good({ cause: { text: "原因はメモに記録がない", evidence: [] } }), NOTE_IDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.cause.status).toBe("none");
    expect(r.summary.cause.inferred).toBe(false);
  });

  it("T-008 ③：内容を述べる否定文「設定漏れが原因ではなく、ポートの競合だった」（evidence 空）は inferred のまま", () => {
    const r = validateAndMap(good({ cause: { text: "設定漏れが原因ではなく、ポートの競合だった", evidence: [] } }), NOTE_IDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.cause.status).toBe("inferred");
    expect(r.summary.cause.inferred).toBe(true);
  });

  it("T-008 ③の2：「書かれていない」の後ろに推測の内容が続く文（evidence 空）は inferred（記録なしに隠さない）", () => {
    const text = "原因はメモに書かれていないが、権限の設定が関係している可能性がある";
    const r = validateAndMap(good({ cause: { text, evidence: [] } }), NOTE_IDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.cause.status).toBe("inferred");
    expect(isNoneText(text)).toBe(false);
  });

  it("T-008 ③の3：該当語の後ろに句読点・空白以外（絵文字）が続く「記録がない😀」（evidence 空）は inferred", () => {
    const text = "記録がない😀";
    const r = validateAndMap(good({ cause: { text, evidence: [] } }), NOTE_IDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.cause.status).toBe("inferred");
    expect(isNoneText(text)).toBe(false);
  });

  it("T-008 ③の4：該当語の後ろにコロンが続く「記録がない：」（evidence 空）は none", () => {
    const text = "記録がない：";
    const r = validateAndMap(good({ cause: { text, evidence: [] } }), NOTE_IDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.cause.status).toBe("none");
    expect(r.summary.cause.inferred).toBe(false);
    expect(isNoneText(text)).toBe(true);
  });

  it("T-008 ③の5：該当語の後ろに列挙にない文字（かっこ）が続く「記録がない（」（evidence 空）は inferred", () => {
    const text = "記録がない（";
    const r = validateAndMap(good({ cause: { text, evidence: [] } }), NOTE_IDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.cause.status).toBe("inferred");
    expect(isNoneText(text)).toBe(false);
  });

  it("T-008 ④：evidence が1件以上なら、本文が「なし」でも evidenced", () => {
    const r = validateAndMap(good({ resolution: { text: "なし", evidence: [2] } }), NOTE_IDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.resolution).toEqual({ text: "なし", evidence_note_ids: [102], inferred: false, status: "evidenced" });
  });

  it("T-008：isNoneText の広げた判定（先頭一致・該当語で終わる文・61 文字以上）", () => {
    for (const t of ["なし。", "該当なし：メモにない", "特になし、", "不明。理由は書かれていない", "記録なし", "メモには記録はない。", "この点には触れられていない", "  確認できない  "])
      expect(isNoneText(t)).toBe(true);
    // 先頭が「なし」でも直後が句読点でなければ false（既存の対照と同じ）
    expect(isNoneText("なしと言われた")).toBe(false);
    // 61 文字以上は該当語で終わっても false
    const long = "あ".repeat(54) + "書かれていない";
    expect(long.length).toBe(61);
    expect(isNoneText(long)).toBe(false);
    expect(isNoneText("あ".repeat(53) + "書かれていない")).toBe(true);
  });

  it("同じ入力は常に同じ結果", () => {
    const a = validateAndMap(good(), NOTE_IDS);
    for (let i = 0; i < 20; i++) expect(validateAndMap(good(), NOTE_IDS)).toEqual(a);
  });
});
