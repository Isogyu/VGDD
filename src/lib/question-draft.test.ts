import { describe, expect, it } from "vitest";
import { QUESTION_DRAFT_SECTIONS, buildQuestionDraft } from "./question-draft";
import { REGISTERED_TERMS, detectSensitive } from "./sensitive";
import type { Note } from "./sessions";
import type { Summary, SummaryItem } from "./summary-schema";

// 合成データ（架空の作業名・メモ）
const TASK = "架空の在庫画面の並び替え修正";

function note(id: number, body: string, kind: Note["kind"] = "memo"): Note {
  return {
    id,
    session_id: 1,
    user_id: "demo-user",
    body,
    kind,
    created_at: "2026-11-03T13:10:00+09:00",
    flags_json: null,
  };
}

const NOTES: Note[] = [
  note(11, "並び替えが逆順になる"),
  note(12, "比較関数をどこで差し替えるか分からない", "unknown"),
  note(13, "比較関数の符号を確認した", "known"),
];

function item(text: string, ids: number[], status?: SummaryItem["status"]): SummaryItem {
  return { text, evidence_note_ids: ids, inferred: status === "inferred", ...(status ? { status } : {}) };
}

function makeSummary(): Summary {
  return {
    schema: "tsubuyaki.summary.v1",
    struggle: item("並び替えが逆順になった", [11], "evidenced"),
    cause: item("比較関数の符号が逆だった", [13], "evidenced"),
    tried: item("架空データで再現した", [11], "evidenced"),
    resolution: item("なし", [], "none"),
    decision_reason: item("影響範囲が小さいと判断した", [], "inferred"),
    learning: item("比較関数は小さなテストで確かめる", [13]), // status なし（古い形）→ evidenced
    unresolved: item("他の一覧画面にも同じ比較関数があるか", [], "inferred"),
    ask_human: item("比較関数を共通化してよいか", [], "inferred"),
    questions: [],
    source_note_ids: [11, 12, 13],
  };
}

/** 見出し「【name】」から次の空行までの箇条書きを返す */
function section(draft: string, name: string): string[] {
  const lines = draft.split("\n");
  const at = lines.indexOf(`【${name}】`);
  expect(at).toBeGreaterThanOrEqual(0);
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (l === "") break;
    out.push(l);
  }
  return out;
}

describe("buildQuestionDraft（T-006）", () => {
  it("5つの見出しが QUESTION_DRAFT_SECTIONS の順で並び、1行目と最後の行が決まった文", () => {
    const draft = buildQuestionDraft({ taskName: TASK, summary: makeSummary(), notes: NOTES });
    const lines = draft.split("\n");
    expect(lines[0]).toBe(`お疲れさまです。「${TASK}」について確認したいことがあります。`);
    expect(lines[lines.length - 1]).toBe("お手すきのときにお願いします。");

    expect(QUESTION_DRAFT_SECTIONS).toEqual(["担当作業", "いま理解していること", "試したこと", "未確認のこと", "聞きたいこと"]);
    const headings = lines.filter((l) => /^【.+】$/.test(l));
    expect(headings).toEqual(QUESTION_DRAFT_SECTIONS.map((s) => `【${s}】`));
    expect(section(draft, "担当作業")).toEqual([TASK]);
  });

  it("evidenced は「いま理解していること」、inferred は「未確認のこと」に（AI の推測）付き、unknown のメモも「未確認のこと」に入る", () => {
    const draft = buildQuestionDraft({ taskName: TASK, summary: makeSummary(), notes: NOTES });
    // SUMMARY_KEYS の順（つまずき → 原因 → 学び）。none の「解決」と inferred の「判断の理由」は入らない
    expect(section(draft, "いま理解していること")).toEqual([
      "- つまずき：並び替えが逆順になった",
      "- 原因：比較関数の符号が逆だった",
      "- 学び：比較関数は小さなテストで確かめる",
    ]);
    expect(section(draft, "試したこと")).toEqual(["- 架空データで再現した"]);
    // ① inferred の項目（ask_human を除く）② unresolved ③ unknown のメモ
    expect(section(draft, "未確認のこと")).toEqual([
      "- 判断の理由：影響範囲が小さいと判断した（AI の推測）",
      "- 未解決：他の一覧画面にも同じ比較関数があるか（AI の推測）",
      "- 比較関数をどこで差し替えるか分からない",
    ]);
    expect(section(draft, "聞きたいこと")).toEqual(["- 比較関数を共通化してよいか"]);
    // ask_human は「未確認のこと」に（AI の推測）として出さない
    expect(draft).not.toContain("人に確認すべきこと：");
    // unknown 以外のメモ本文は入らない
    expect(draft).not.toContain("並び替えが逆順になる\n");
    expect(draft).not.toContain("比較関数の符号を確認した");
  });

  it("ask_human・tried が none、該当項目がないときは代わりの文が入る", () => {
    const empty = item("記録なし", [], "none");
    const summary: Summary = {
      ...makeSummary(),
      struggle: empty,
      cause: empty,
      tried: empty,
      resolution: empty,
      decision_reason: empty,
      learning: empty,
      unresolved: empty,
      ask_human: item("なし", []), // status なし（古い形）→ none
    };
    const draft = buildQuestionDraft({ taskName: TASK, summary, notes: [note(11, "メモ", "memo")] });
    expect(section(draft, "聞きたいこと")).toEqual([
      "- （整理結果に「人に確認すべきこと」がありません。自分の言葉で書いてください）",
    ]);
    expect(section(draft, "いま理解していること")).toEqual(["- （まだ確認できたことがありません）"]);
    expect(section(draft, "試したこと")).toEqual(["- （まだありません）"]);
    expect(section(draft, "未確認のこと")).toEqual(["- （なし）"]);
  });

  it("T-008 ①：本文「なし。メモには書かれていない」（evidence 空・status なし）の項目は【未確認のこと】に出ない", () => {
    const summary: Summary = {
      ...makeSummary(),
      cause: item("なし。メモには書かれていない", []), // status なし → isNoneText で none
      decision_reason: item("なし。メモには書かれていない", []),
      unresolved: item("なし。メモには書かれていない", []),
    };
    const draft = buildQuestionDraft({ taskName: TASK, summary, notes: NOTES });
    expect(section(draft, "未確認のこと")).toEqual(["- 比較関数をどこで差し替えるか分からない"]);
    expect(draft).not.toContain("書かれていない");
  });

  it("T-008 ②：unresolved が inferred のとき、【未確認のこと】の「未解決」の行は1回だけ", () => {
    const draft = buildQuestionDraft({ taskName: TASK, summary: makeSummary(), notes: NOTES });
    const rows = section(draft, "未確認のこと");
    expect(rows.filter((l) => l.includes("他の一覧画面にも同じ比較関数があるか"))).toEqual([
      "- 未解決：他の一覧画面にも同じ比較関数があるか（AI の推測）",
    ]);
    // evidenced なら本文だけの1行、none なら出さない
    const evidenced = buildQuestionDraft({
      taskName: TASK,
      summary: { ...makeSummary(), unresolved: item("共通化の可否", [12], "evidenced") },
      notes: NOTES,
    });
    expect(section(evidenced, "未確認のこと").filter((l) => l.includes("共通化の可否"))).toEqual(["- 共通化の可否"]);
  });

  it("T-008 ③：同じ文の行は2回出ない（unknown のメモが重なっても1回）", () => {
    const notes = [...NOTES, note(14, "比較関数をどこで差し替えるか分からない", "unknown")];
    const draft = buildQuestionDraft({ taskName: TASK, summary: makeSummary(), notes });
    const rows = section(draft, "未確認のこと");
    expect(rows.filter((l) => l === "- 比較関数をどこで差し替えるか分からない")).toHaveLength(1);
    expect(new Set(rows).size).toBe(rows.length);
  });

  it("登録語句（顧客名）を含む ask_human から作った下書きは detectSensitive が registered_term を返す（M10-3）", () => {
    const customer = REGISTERED_TERMS.customers[0];
    const summary: Summary = { ...makeSummary(), ask_human: item(`${customer}向けの並び順の仕様を確認したい`, [], "inferred") };
    const draft = buildQuestionDraft({ taskName: TASK, summary, notes: NOTES });
    expect(draft).toContain(customer);
    const flags = detectSensitive(draft);
    expect(flags.some((f) => f.type === "registered_term" && f.match === customer)).toBe(true);
    // 登録語句がなければ registered_term は出ない
    const clean = buildQuestionDraft({ taskName: TASK, summary: makeSummary(), notes: NOTES });
    expect(detectSensitive(clean).some((f) => f.type === "registered_term")).toBe(false);
  });
});
