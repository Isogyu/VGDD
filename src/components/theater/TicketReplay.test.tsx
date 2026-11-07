import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Replay } from "@/lib/governance-replay-schema";
import TicketReplay from "./TicketReplay";

type Ticket = Replay["tickets"][number];
type ReplayEvent = Ticket["events"][number];

function event(seq: number, overrides: Partial<ReplayEvent>): ReplayEvent {
  return {
    seq,
    ts: "2026-11-06T01:00:00+0900",
    actor: "gate-runner",
    kind: "other",
    reason: null,
    judge: null,
    codex: null,
    ...overrides,
  };
}

function ticket(id: string, title: string, events: ReplayEvent[] = []): Ticket {
  return { id, title, status: "状態の項目-表示しない", events };
}

// 固定の入力。T-014 の4つの出来事
const t014 = ticket("T-014", "架空の票の題その十四", [
  event(1, {
    ts: "2026-11-05T16:30:00+0000",
    kind: "blocked",
    reason: "disagreement",
    judge: "APPROVED",
    codex: "CHANGES_REQUIRED",
  }),
  event(2, { ts: "2026-11-06T09:05:00+0900", kind: "ruling", actor: "release" }),
  event(3, { ts: "2026-11-06T10:10:10+0900", kind: "resubmitted", actor: "night-runner" }),
  event(4, { ts: "2026-11-06T11:20:30+0900", kind: "merged", judge: "APPROVED", codex: "APPROVED" }),
]);

const tickets: Ticket[] = [
  ticket("T-002", "架空の票の題その二", [event(1, { kind: "returned", reason: "security" })]),
  ticket("T-099", "対象外の票の題", [event(1, { kind: "held" })]),
  ticket("T-026", "架空の票の題その二十六", [event(1, { kind: "released" })]),
  t014,
];

const noop = () => {};
const markup = renderToStaticMarkup(<TicketReplay tickets={tickets} onEventChange={noop} />);
const textOf = (html: string) => html.replace(/<[^>]*>/g, "");

function itemsOfList(html: string): string[] {
  const list = /<ol[^>]*>(.*)<\/ol>/.exec(html)?.[1] ?? "";
  return [...list.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((match) => textOf(match[1]));
}

describe("TicketReplay の初期の表示", () => {
  it("選ぶ欄は FEATURED_TICKETS のうち入力にある票を T-014・T-026 の順で、ID と題で並べる", () => {
    const options = [...markup.matchAll(/<option[^>]*>(.*?)<\/option>/g)].map((match) => textOf(match[1]));
    expect(options).toEqual(["T-014 架空の票の題その十四", "T-026 架空の票の題その二十六"]);
    expect(markup).not.toContain("T-013");
    expect(markup).not.toContain("T-002");
    expect(markup).not.toContain("T-099");
  });

  it("最初の選択は T-014", () => {
    expect(markup).toMatch(/<option[^>]*value="T-014"[^>]*selected=""/);
    expect(markup).not.toMatch(/<option[^>]*value="T-026"[^>]*selected=""/);
  });

  it("T-014 の4つの出来事を、時刻と A1 の文で順に並べる", () => {
    const items = itemsOfList(markup);
    expect(items).toHaveLength(4);
    const expected = [
      ["11/06 01:30", "司法の2系統が重大な指摘で分かれたため止めた。人の裁定へ"],
      ["11/06 09:05", "人が裁定した"],
      ["11/06 10:10", "作業員の実装を前検査で確認し、申請し直した"],
      ["11/06 11:20", "統合した（裁判所）"],
    ];
    expected.forEach(([time, label], i) => {
      expect(items[i].startsWith(time + label)).toBe(true);
    });
  });

  it("判定の結論を添え、null の系統は出さない", () => {
    const items = itemsOfList(markup);
    expect(items[0]).toContain("Claude：合格");
    expect(items[0]).toContain("Codex：差し戻し");
    expect(items[1]).not.toMatch(/Claude|Codex/);
    expect(items[2]).not.toMatch(/Claude|Codex/);
    expect(items[3]).toContain("Claude：合格");
    expect(items[3]).toContain("Codex：合格");
  });

  it("A2 の種類ごとにラベルと形の印を添え、normal には付けない", () => {
    const items = itemsOfList(markup);
    expect(items[0]).toContain("… 判断待ち");
    expect(items[1]).toContain("◆ 人");
    expect(items[2]).toBe("11/06 10:10作業員の実装を前検査で確認し、申請し直した");
    expect(items[3]).toContain("✓ 統合");
  });

  it("5つのボタンの名前と、速さの3つを type=button で出す", () => {
    const names = [...markup.matchAll(/<button type="button"[^>]*>(.*?)<\/button>/g)].map((match) => match[1]);
    expect(names).toEqual(["再生", "一時停止", "1つ戻す", "1つ送る", "最初から", "0.5倍", "1倍", "2倍"]);
    expect(markup.match(/<button/g)).toHaveLength(names.length);
    expect(markup).toMatch(/<button type="button"[^>]*aria-pressed="true"[^>]*>1倍</);
  });

  it("決まった文を出す", () => {
    const text = textOf(markup);
    expect(text).toContain("再生では時間を圧縮しています");
    expect(text).toContain("記録の当時の分類です。後の訂正や取り消しは含みません");
    expect(text).toContain("実際の経過：—");
  });

  it("注意書きは一覧の下に出る", () => {
    expect(markup.indexOf("記録の当時の分類です")).toBeGreaterThan(markup.indexOf("</ol>"));
  });

  it("始まる前の文を aria-live の欄に出し、今の出来事の印はない", () => {
    expect(markup).toMatch(/aria-live="polite"[^>]*>再生を押すと、この票の記録を順に追います</);
    expect(markup).not.toContain("aria-current");
  });

  it("一覧だけが部品の中でスクロールし、外枠は親の高さに従う", () => {
    expect(markup).toMatch(/^<div class="[^"]*h-full min-h-0/);
    expect(markup).toMatch(/<ol[^>]*class="[^"]*min-h-0[^"]*overflow-y-auto/);
    expect(markup.match(/overflow-y-auto/g)).toHaveLength(1);
  });

  it("動きは motion-safe の transition だけ", () => {
    expect(markup).toContain("motion-safe:transition-colors");
    expect(markup.replaceAll("motion-safe:transition-colors", "")).not.toMatch(/transition|animate-/);
  });

  it("余分な項目と入力の JSON を出さない", () => {
    expect(markup).not.toContain("状態の項目-表示しない");
    expect(markup).not.toMatch(/gate-runner|night-runner|release"|disagreement|APPROVED|CHANGES_REQUIRED/);
    expect(markup).not.toContain("{");
  });

  it("描画の最中に onEventChange を呼ばない", () => {
    const onEventChange = vi.fn();
    renderToStaticMarkup(<TicketReplay tickets={tickets} onEventChange={onEventChange} />);
    expect(onEventChange).not.toHaveBeenCalled();
  });
});

describe("TicketReplay の例の票がないとき", () => {
  it.each([
    ["対象外の票だけ", [ticket("T-002", "架空の票の題その二", [event(1, { kind: "held" })])]],
    ["入力が空", []],
  ])("%s なら「再生できる票がありません」だけを出す", (_name, input) => {
    const html = renderToStaticMarkup(<TicketReplay tickets={input} onEventChange={noop} />);
    expect(textOf(html)).toBe("再生できる票がありません");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<select");
  });
});

describe("TicketReplay の出来事が0件の票", () => {
  it("文を補わず、一覧は空で、経過は —", () => {
    const html = renderToStaticMarkup(
      <TicketReplay tickets={[ticket("T-026", "架空の票の題その二十六")]} onEventChange={noop} />,
    );
    expect(itemsOfList(html)).toEqual([]);
    expect(textOf(html)).toContain("実際の経過：—");
  });
});
