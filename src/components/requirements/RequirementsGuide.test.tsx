// 要件確認の画面（RequirementsGuide）の初期の表示の試験。T-043 A6。描画の操作は試さず、静的な markup だけを見る。
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import RequirementsGuide, {
  ApprovalLine,
  INITIAL_APPROVAL_SLOT,
  RecordView,
  StatusPanel,
  applyApprovalResponse,
  resetApprovalSlot,
  type ApprovalSlot,
} from "./RequirementsGuide";
import { APPROVAL_LABELS, type Answers, type ApprovalView, type RequirementRecord } from "@/lib/requirements/model";

const noop = () => {};

const FILLED: Answers = {
  "problem.who": { text: "架空の株式会社ミナミ商事の経理担当", unknown: false },
  "problem.goal": { text: "請求書の金額の確認が1件1分で終わる", unknown: false },
  "behavior.example": { text: "発注書と請求書の金額が同じなら「一致」と出る", unknown: false },
  "constraints.out_of_scope": { text: "支払いの実行はしない", unknown: false },
};

const RECORD: RequirementRecord = {
  id: "11111111-2222-4333-8444-555555555555",
  title: "架空の請求書の確認",
  created_at: "2026-11-07T23:00:00+09:00",
  answers: FILLED,
  answers_version: 2,
  suggestions: [{ kind: "criterion", target: "behavior.example", text: "金額が違うときは「不一致」と出る" }],
  decisions: ["pending"],
  suggestions_version: 1,
  linked_ticket_id: "T-043",
};

/** button 要素の中の文を全部取り出す */
function buttonTexts(markup: string): string[] {
  return [...markup.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]);
}

describe("RequirementsGuide", () => {
  it("初期の表示：見出しと合成のデータの注意があり、「承認する」がない", () => {
    const markup = renderToStaticMarkup(<RequirementsGuide />);
    expect(markup).toContain("<h1");
    expect(markup).toContain("要件の確認");
    expect(markup).toContain("記録の一覧");
    expect(markup).toContain("新しく始める");
    expect(markup).toContain("データはすべて合成（架空の会社・人物）で試してください");
    expect(markup).not.toContain("承認する");
    expect(buttonTexts(markup).some((t) => t.includes("承認"))).toBe(false);
  });

  it("記録を開いた表示：段階ごとの質問・わからない・AI の提案・下書き・材料があり、承認のボタンはない", () => {
    const markup = renderToStaticMarkup(
      <RecordView
        record={RECORD}
        draft={RECORD.answers}
        linked="T-043"
        dirty={false}
        busy={false}
        importText=""
        approval={{ kind: "current", label: APPROVAL_LABELS.current, staleCopy: true }}
        onAnswer={noop}
        onLinked={noop}
        onSave={noop}
        onReload={noop}
        onImportText={noop}
        onImport={noop}
        onDecide={noop}
      />,
    );
    for (const s of ["課題", "動作", "制約", "確認"]) expect(markup).toContain(`>${s}</legend>`);
    expect(markup).toContain("わからない");
    expect(markup).toContain("AI の提案（本人の回答ではない）");
    expect(markup).toContain("AI の提案を取り込む");
    expect(markup).toContain("票の下書き");
    expect(markup).toContain("AI の補助に渡す材料");
    expect(markup).toContain("承認済み（写しの上で）");
    expect(markup).toContain("（古い写し）");
    const buttons = buttonTexts(markup);
    expect(buttons).toContain("採る");
    expect(buttons).toContain("採らない");
    expect(buttons.some((t) => t.includes("承認"))).toBe(false);
  });

  it("未解決の欄：必須の未回答の件数を出す", () => {
    const markup = renderToStaticMarkup(<StatusPanel record={{ answers: {}, suggestions: [], decisions: [] }} />);
    expect(markup).toContain("下書きにできない：必須の未回答 4 件");
    expect(markup).toContain("反例が未確認");
  });

  it("承認の状態：票を結び付けていなければ状態を出さない", () => {
    const markup = renderToStaticMarkup(<ApprovalLine ticketId={null} approval={null} />);
    expect(markup).not.toContain("承認済み");
    expect(markup).not.toContain("写しがない");
  });
});

// 承認の表示を空に戻す契機と、取り直す契機がそろうこと（差し戻しの指摘の直し）。
// 画面の取り直しの useEffect の依存は [票の ID, 世代]。「読み込み直す」・同じ記録の再選択・
// 同じ票 ID の別の記録を開く、はどれも open() を通り、open() は resetApprovalSlot で空に戻す。
describe("承認の表示の取り直し", () => {
  const CURRENT: ApprovalView = { kind: "current", label: APPROVAL_LABELS.current, staleCopy: false };
  const NONE: ApprovalView = { kind: "not_recorded", label: APPROVAL_LABELS.not_recorded, staleCopy: false };
  /** 画面の useEffect の依存と同じもの */
  const deps = (ticketId: string | null, s: ApprovalSlot) => [ticketId, s.generation];

  /** 記録を開いて取得の応答を反映し終えた状態（票 T-043、承認済みと表示中） */
  function loaded(): ApprovalSlot {
    const s = resetApprovalSlot(INITIAL_APPROVAL_SLOT);
    return applyApprovalResponse(s, s.generation, CURRENT);
  }

  it("空に戻すと表示は null になり、世代が進む", () => {
    const s = loaded();
    expect(s.view).toEqual(CURRENT);
    const r = resetApprovalSlot(s);
    expect(r.view).toBeNull();
    expect(r.generation).toBe(s.generation + 1);
  });

  for (const scenario of ["「読み込み直す」", "同じ記録の再選択", "同じ票 ID の別の記録を開く"]) {
    it(`${scenario}：票の ID が同じままでも取り直しの依存が変わり、取り直しの応答で表示が戻る`, () => {
      const before = loaded();
      // どの契機も open() を通り、成功のたびに空に戻す。票の ID は T-043 のまま
      const after = resetApprovalSlot(before);
      expect(deps("T-043", after)).not.toEqual(deps("T-043", before));
      expect(after.view).toBeNull();
      // 取り直しは after.generation で始まり、その応答で「読み込み中…」から戻る
      const shown = applyApprovalResponse(after, after.generation, NONE);
      expect(shown.view).toEqual(NONE);
    });
  }

  it("古い応答で上書きしない：前の世代の取得の応答は捨てる", () => {
    const first = resetApprovalSlot(INITIAL_APPROVAL_SLOT); // 1回目の取得を始めた
    const second = resetApprovalSlot(first); // 応答の前に読み込み直した
    const latest = applyApprovalResponse(second, second.generation, NONE);
    // 1回目の取得の応答が後から届いても、後の取得の結果を上書きしない
    expect(applyApprovalResponse(latest, first.generation, CURRENT)).toEqual(latest);
    // 後の応答がまだ届いていないときも、前の応答で埋めない（空のまま）
    expect(applyApprovalResponse(second, first.generation, CURRENT).view).toBeNull();
  });
});
