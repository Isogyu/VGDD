// 要件確認の純粋関数（model.ts）と固定の質問（questions.ts）の試験。T-043 A6。データはすべて合成（架空の会社・人物）。
import { describe, expect, it } from "vitest";
import { QUESTIONS, STAGES } from "./questions";
import {
  APPROVAL_LABELS,
  ASSIST_SCHEMA,
  DRAFT_NOTICE,
  STALE_COPY_LABEL,
  approvalStatus,
  assistMaterial,
  completeness,
  completenessLabel,
  draftTicketText,
  parseAiSuggestions,
  parseAnswers,
  parsePostBody,
  parsePutBody,
  unresolved,
  type Answers,
  type RequirementRecord,
} from "./model";

const FILLED: Answers = {
  "problem.who": { text: "架空の株式会社ミナミ商事の経理担当", unknown: false },
  "problem.goal": { text: "請求書の金額の確認が1件1分で終わる", unknown: false },
  "behavior.example": { text: "発注書が 12,000 円で請求書が 12,000 円なら「一致」と出る", unknown: false },
  "constraints.out_of_scope": { text: "支払いの実行はしない", unknown: false },
};

function rec(answers: Answers, extra: Partial<RequirementRecord> = {}): RequirementRecord {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    title: "架空の請求書の確認",
    created_at: "2026-11-07T23:00:00+09:00",
    answers,
    answers_version: 3,
    suggestions: [],
    decisions: [],
    suggestions_version: 0,
    linked_ticket_id: null,
    ...extra,
  };
}

function assist(over: Record<string, unknown> = {}) {
  return {
    schema: ASSIST_SCHEMA,
    record_id: "11111111-2222-4333-8444-555555555555",
    answers_version: 3,
    suggestions: [{ kind: "criterion", target: "behavior.example", text: "金額が違うときは「不一致」と出る" }],
    ...over,
  };
}

describe("QUESTIONS（A1）", () => {
  it("4つの段階と、必須の id がそろう", () => {
    expect(STAGES.map((s) => s.id)).toEqual(["problem", "behavior", "constraints", "review"]);
    const want: [string, boolean][] = [
      ["problem.who", true],
      ["problem.when", false],
      ["problem.goal", true],
      ["behavior.input", false],
      ["behavior.example", true],
      ["behavior.counter", false],
      ["behavior.error", false],
      ["constraints.data", false],
      ["constraints.external", false],
      ["constraints.out_of_scope", true],
    ];
    for (const [id, required] of want) {
      const q = QUESTIONS.find((x) => x.id === id);
      expect(q, id).toBeDefined();
      expect(q!.required).toBe(required);
      expect(q!.stage).toBe(id.split(".")[0]);
      expect(Object.keys(q!).sort()).toEqual(["id", "required", "stage", "text"]);
    }
    for (const s of STAGES) expect(QUESTIONS.some((q) => q.stage === s.id)).toBe(true);
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
  });
});

describe("parseAnswers", () => {
  it("未知の質問の id・余分な鍵・型の違い・2,001 字を拒む", () => {
    expect(parseAnswers({ "no.such": { text: "x", unknown: false } })).toBeNull();
    expect(parseAnswers({ "problem.who": { text: "x", unknown: false, extra: 1 } })).toBeNull();
    expect(parseAnswers({ "problem.who": { text: "x" } })).toBeNull();
    expect(parseAnswers({ "problem.who": { text: 1, unknown: false } })).toBeNull();
    expect(parseAnswers([])).toBeNull();
    expect(parseAnswers({ "problem.who": { text: "あ".repeat(2001), unknown: false } })).toBeNull();
    expect(parseAnswers({ "problem.who": { text: "あ".repeat(2000), unknown: false } })).not.toBeNull();
  });

  it("質問の順に並べ直し、空でわからないでもない回答は落とす", () => {
    const a = parseAnswers({
      "constraints.out_of_scope": { text: "x", unknown: false },
      "problem.who": { text: "y", unknown: false },
      "problem.when": { text: "", unknown: false },
    });
    expect(Object.keys(a!)).toEqual(["problem.who", "constraints.out_of_scope"]);
  });
});

describe("completeness", () => {
  it("必須がすべて埋まれば ready", () => {
    expect(completeness(FILLED)).toEqual({ ready: true, missing: [] });
  });

  it("「わからない」は充足にしない。空白だけの回答も充足にしない", () => {
    const c = completeness({
      ...FILLED,
      "problem.who": { text: "経理の誰か", unknown: true },
      "problem.goal": { text: "   ", unknown: false },
    });
    expect(c).toEqual({ ready: false, missing: ["problem.who", "problem.goal"] });
    expect(completenessLabel(c)).toBe("下書きにできない：必須の未回答 2 件");
  });
});

describe("unresolved", () => {
  it("必須の未回答・「わからない」・反例が未確認・未決定の AI の提案を並べる", () => {
    const r = rec(
      {
        "problem.who": FILLED["problem.who"],
        "problem.goal": { text: "", unknown: true },
        "constraints.external": { text: "", unknown: true },
      },
      {
        suggestions: [
          { kind: "missing", target: null, text: "締め日の扱いが未確認" },
          { kind: "question", target: "problem.when", text: "月末だけですか" },
        ],
        decisions: ["accepted", "pending"],
      },
    );
    const items = unresolved(r);
    expect(items.map((i) => [i.kind, i.question_id])).toEqual([
      ["missing_required", "behavior.example"],
      ["missing_required", "constraints.out_of_scope"],
      ["unknown", "problem.goal"],
      ["unknown", "constraints.external"],
      ["counter_unconfirmed", "behavior.counter"],
      ["ai_pending", "problem.when"],
    ]);
    expect(items.find((i) => i.kind === "counter_unconfirmed")!.label).toBe("反例が未確認");
  });

  it("答えると減る", () => {
    const before = unresolved(rec({})).length;
    const after = unresolved(rec(FILLED)).length;
    const withCounter = unresolved(rec({ ...FILLED, "behavior.counter": { text: "金額が違うのに一致と出る", unknown: false } })).length;
    expect(after).toBeLessThan(before);
    expect(withCounter).toBe(0);
  });
});

describe("draftTicketText", () => {
  it("ready でなければ null", () => {
    expect(draftTicketText(rec({}))).toBeNull();
    expect(draftTicketText(rec({ ...FILLED, "behavior.example": { text: "x", unknown: true } }))).toBeNull();
  });

  it("反例がないときは候補を作らず、未解決に「反例が未確認」と出す", () => {
    const t = draftTicketText(rec(FILLED))!;
    expect(t.split("\n")[0]).toBe(DRAFT_NOTICE);
    expect(DRAFT_NOTICE).toBe("この下書きに効力はない。票にするのは立法補佐、承認するのはオーナー（approve-spec）");
    expect(t).toContain("## 1. 目的");
    expect(t).toContain("- 課題（誰が困るか）：架空の株式会社ミナミ商事の経理担当");
    expect(t).toContain("- 場面（いつ・どの場面で）：（未回答）");
    expect(t).toContain("- ゴール（どうなればよいか）：請求書の金額の確認が1件1分で終わる");
    expect(t).toContain("## 2. 受け入れ条件の候補");
    expect(t).toContain("- A1. 正しい結果の例：発注書が 12,000 円で請求書が 12,000 円なら「一致」と出る");
    expect(t).not.toContain("A2.");
    expect(t).not.toContain("反例（こうなってはいけない）");
    expect(t).toContain("## 未解決の事項\n\n- 反例が未確認");
  });

  it("反例があれば A2. の候補にし、未解決がなければ「なし」", () => {
    const t = draftTicketText(rec({ ...FILLED, "behavior.counter": { text: "金額が違うのに「一致」と出る", unknown: false } }))!;
    expect(t).toContain("- A2. 反例（こうなってはいけない）：金額が違うのに「一致」と出る");
    expect(t).not.toContain("A3.");
    expect(t).toContain("## 未解決の事項\n\n- なし");
  });

  it("反例が「わからない」なら候補にしない", () => {
    const t = draftTicketText(rec({ ...FILLED, "behavior.counter": { text: "", unknown: true } }))!;
    expect(t).not.toContain("A2.");
    expect(t).toContain("- 反例が未確認");
  });
});

describe("parseAiSuggestions", () => {
  const r = rec(FILLED);

  it("形と版が合えば提案を返す（文字列でも解析済みの値でも）", () => {
    expect(parseAiSuggestions(assist(), r)).toEqual(assist().suggestions);
    expect(parseAiSuggestions(JSON.stringify(assist()), r)).toEqual(assist().suggestions);
  });

  it("版の不一致・記録の不一致は null（古い回答への取り込みを拒む）", () => {
    expect(parseAiSuggestions(assist({ answers_version: 2 }), r)).toBeNull();
    expect(parseAiSuggestions(assist({ record_id: "99999999-2222-4333-8444-555555555555" }), r)).toBeNull();
    expect(parseAiSuggestions(assist({ schema: "vgdd.requirements-assist.v2" }), r)).toBeNull();
  });

  it("余分な項目・形の違いは null", () => {
    expect(parseAiSuggestions({ ...assist(), extra: true }, r)).toBeNull();
    expect(parseAiSuggestions(assist({ suggestions: [{ kind: "criterion", target: null, text: "x", note: "y" }] }), r)).toBeNull();
    expect(parseAiSuggestions(assist({ suggestions: [{ kind: "approve", target: null, text: "x" }] }), r)).toBeNull();
    expect(parseAiSuggestions(assist({ suggestions: [{ kind: "question", target: "no.such", text: "x" }] }), r)).toBeNull();
    expect(parseAiSuggestions(assist({ suggestions: {} }), r)).toBeNull();
    expect(parseAiSuggestions("{not json", r)).toBeNull();
    expect(parseAiSuggestions(null, r)).toBeNull();
  });

  it("上限：提案 30 件まで、文は 1〜500 字、JSON は 32KB まで", () => {
    const n = (k: number) => Array.from({ length: k }, () => ({ kind: "missing", target: null, text: "x" }));
    expect(parseAiSuggestions(assist({ suggestions: n(30) }), r)).toHaveLength(30);
    expect(parseAiSuggestions(assist({ suggestions: n(31) }), r)).toBeNull();
    expect(parseAiSuggestions(assist({ suggestions: [{ kind: "missing", target: null, text: "" }] }), r)).toBeNull();
    expect(parseAiSuggestions(assist({ suggestions: [{ kind: "missing", target: null, text: "あ".repeat(500) }] }), r)).toHaveLength(1);
    expect(parseAiSuggestions(assist({ suggestions: [{ kind: "missing", target: null, text: "あ".repeat(501) }] }), r)).toBeNull();
    const big = JSON.stringify(assist()) + " ".repeat(33 * 1024);
    expect(parseAiSuggestions(big, r)).toBeNull();
  });
});

describe("API の本文の形", () => {
  it("PUT：linked_ticket_id は null か T- と数字3〜4桁", () => {
    expect(parsePutBody({ answers_version: 0, answers: {}, linked_ticket_id: "T-043" })).not.toBeNull();
    expect(parsePutBody({ answers_version: 0, answers: {}, linked_ticket_id: "T-1234" })).not.toBeNull();
    expect(parsePutBody({ answers_version: 0, answers: {}, linked_ticket_id: "T-12345" })).toBeNull();
    expect(parsePutBody({ answers_version: 0, answers: {}, linked_ticket_id: "T-０４３" })).toBeNull();
    expect(parsePutBody({ answers_version: -1, answers: {}, linked_ticket_id: null })).toBeNull();
    expect(parsePutBody({ answers_version: 0, answers: {} })).toBeNull();
  });

  it("POST：action で import と decide を分ける", () => {
    expect(parsePostBody({ action: "import", suggestions: assist() })).toEqual({ action: "import", suggestions: assist() });
    expect(parsePostBody({ action: "decide", answers_version: 1, suggestions_version: 2, index: 0, decision: "accepted" })).not.toBeNull();
    expect(parsePostBody({ action: "decide", answers_version: 1, suggestions_version: 2, index: 0, decision: "approve" })).toBeNull();
    expect(parsePostBody({ action: "approve" })).toBeNull();
  });
});

describe("assistMaterial", () => {
  it("record_id・answers_version・質問と回答を出す", () => {
    const m = assistMaterial(rec(FILLED));
    expect(m.record_id).toBe("11111111-2222-4333-8444-555555555555");
    expect(m.answers_version).toBe(3);
    expect(m.questions).toHaveLength(QUESTIONS.length);
    expect(m.questions.find((q) => q.id === "problem.when")!.answer).toBeNull();
  });
});

describe("approvalStatus（表示だけ）", () => {
  const now = new Date("2026-11-08T00:00:00+09:00");
  const state = (approvals: unknown, generated_at: unknown = "2026-11-07T23:55:00+09:00") => ({
    state: { generated_at, approvals },
  });

  it("4つの文", () => {
    expect(approvalStatus(state([{ task: "T-043", current: true, approved_at: null }]), "T-043", now)).toEqual({
      kind: "current",
      label: APPROVAL_LABELS.current,
      staleCopy: false,
    });
    expect(approvalStatus(state([{ task: "T-043", current: false, approved_at: null }]), "T-043", now).label).toBe("承認が古い");
    expect(approvalStatus(state([]), "T-043", now).label).toBe("写しに承認の記録がない");
    expect(approvalStatus({ state: null }, "T-043", now).label).toBe("写しがない");
    expect(approvalStatus(state("x"), "T-043", now).label).toBe("写しがない");
    expect(approvalStatus(state([{ task: "T-043" }]), "T-043", now).label).toBe("写しがない");
    expect(approvalStatus(null, "T-043", now).label).toBe("写しがない");
    expect(approvalStatus(state([]), "T-043", now, true).label).toBe("写しがない");
    expect(APPROVAL_LABELS.current).toBe("承認済み（写しの上で）");
  });

  it("generated_at が 10 分より前か不正なら「古い写し」", () => {
    expect(STALE_COPY_LABEL).toBe("古い写し");
    expect(approvalStatus(state([], "2026-11-07T23:49:59+09:00"), "T-043", now).staleCopy).toBe(true);
    expect(approvalStatus(state([], "2026-11-07T23:50:00+09:00"), "T-043", now).staleCopy).toBe(false);
    expect(approvalStatus(state([], "昨日"), "T-043", now).staleCopy).toBe(true);
    expect(approvalStatus(state([], 123), "T-043", now).staleCopy).toBe(true);
  });
});
