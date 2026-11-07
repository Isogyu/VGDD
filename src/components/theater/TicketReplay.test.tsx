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
  // 出来事のない票（T-040：並びに入れない）
  ticket("T-050", "出来事のない票の題"),
];

const noop = () => {};
const markup = renderToStaticMarkup(<TicketReplay tickets={tickets} onEventChange={noop} />);
const textOf = (html: string) => html.replace(/<[^>]*>/g, "");

function itemsOfList(html: string): string[] {
  const list = /<ol[^>]*>(.*)<\/ol>/.exec(html)?.[1] ?? "";
  return [...list.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((match) => textOf(match[1]));
}

describe("TicketReplay の初期の表示", () => {
  // T-040 で直した：代表の3枚だけから、記録のある全票（★と印つき）に
  it("選ぶ欄は、★の代表の票を T-014・T-026 の順で先頭に、残りの記録のある票を ID の順で、ID と題と印で並べる", () => {
    const options = [...markup.matchAll(/<option[^>]*>(.*?)<\/option>/g)].map((match) => textOf(match[1]));
    expect(options).toEqual([
      "★T-014 架空の票の題その十四（不一致 1・裁定 1）",
      "★T-026 架空の票の題その二十六",
      "T-002 架空の票の題その二（差し戻し 1）",
      "T-099 対象外の票の題",
    ]);
    expect(markup).not.toContain("T-013");
    // 出来事のない票は並べない
    expect(markup).not.toContain("T-050");
  });

  it("印のない票の option には（）を付けず、代表でない票には★を付けない", () => {
    expect(markup).toMatch(/<option value="T-099">T-099 対象外の票の題<\/option>/);
    expect(markup).toMatch(/<option value="T-002">T-002 架空の票の題その二（差し戻し 1）<\/option>/);
  });

  it("絞り込みのボタンの組を select の前に出し、最初は「すべて」が押されている", () => {
    expect(markup).toMatch(/<div role="group" aria-label="票の絞り込み"/);
    const group = /<div role="group" aria-label="票の絞り込み"[^>]*>(.*?)<\/div>/.exec(markup)?.[1] ?? "";
    const buttons = [...group.matchAll(/<button type="button" aria-pressed="(true|false)"[^>]*>(.*?)<\/button>/g)].map(
      (match) => [match[2], match[1]],
    );
    expect(buttons).toEqual([
      ["すべて", "true"],
      ["不一致あり", "false"],
      ["裁定あり", "false"],
      ["差し戻しあり", "false"],
    ]);
    expect(markup.indexOf("票の絞り込み")).toBeLessThan(markup.indexOf("<select"));
  });

  it("select の下、今の再生の説明の行の上に、絞り込みの前の記録のある票の数を出す", () => {
    const line = "記録のある票は全 4 票です。★の代表の票を先頭に、残りを ID の順に並べます";
    expect(textOf(markup)).toContain(line);
    expect(markup.indexOf(line)).toBeGreaterThan(markup.indexOf("</select>"));
    expect(markup.indexOf(line)).toBeLessThan(markup.indexOf('aria-live="polite"'));
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

  // T-040 で直した：先頭に絞り込みの4つのボタンが増えた
  it("絞り込みの4つ、5つのボタンの名前と、速さの3つを type=button で出す", () => {
    const names = [...markup.matchAll(/<button type="button"[^>]*>(.*?)<\/button>/g)].map((match) => match[1]);
    expect(names).toEqual([
      "すべて",
      "不一致あり",
      "裁定あり",
      "差し戻しあり",
      "再生",
      "一時停止",
      "1つ戻す",
      "1つ送る",
      "最初から",
      "0.5倍",
      "1倍",
      "2倍",
    ]);
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

  // T-040 で直した：行が増えたので、収まらない分は外枠（区画の中）でもスクロールする。一覧は最低の高さを持つ
  it("一覧は部品の中でスクロールし、外枠は親の高さに従って、収まらない分を区画の中でスクロールする", () => {
    expect(markup).toMatch(/^<div class="[^"]*h-full min-h-0[^"]*overflow-y-auto/);
    expect(markup).toMatch(/<ol[^>]*class="[^"]*min-h-16[^"]*overflow-y-auto/);
    expect(markup.match(/overflow-y-auto/g)).toHaveLength(2);
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

// T-039 A3・A5
describe("TicketReplay の最初の選択（initialTicketId）", () => {
  const selected = (html: string) =>
    [...html.matchAll(/<option[^>]*value="([^"]*)"[^>]*selected=""/g)].map((match) => match[1]);

  it("並びの2番目の票（T-026）を渡すと、その票が選ばれた表示になる", () => {
    const html = renderToStaticMarkup(<TicketReplay tickets={tickets} onEventChange={noop} initialTicketId="T-026" />);
    expect(selected(html)).toEqual(["T-026"]);
    // 一覧は T-026 の1つの出来事
    expect(itemsOfList(html)).toHaveLength(1);
    expect(itemsOfList(html)[0]).not.toContain("司法の2系統が重大な指摘で分かれた");
  });

  // T-040 A2・A4：代表でない票でも、最初の並びにあれば選ぶ
  it("代表でない票（T-002）を渡すと、その票が選ばれた表示になる", () => {
    const html = renderToStaticMarkup(<TicketReplay tickets={tickets} onEventChange={noop} initialTicketId="T-002" />);
    expect(selected(html)).toEqual(["T-002"]);
    expect(itemsOfList(html)).toEqual(["11/06 01:00セキュリティ審査で差し戻された"]);
  });

  // T-040 で直した：T-002 は並びに入ったので、「入力にあるが並びにない票」は出来事のない票（T-050）にした
  it.each([
    ["入力にあるが並びにない票（出来事がない）", "T-050"],
    ["入力にない例の票", "T-013"],
    ["入力にない票", "T-999"],
    ["null", null],
    ["undefined", undefined],
  ])("%s なら並びの先頭（T-014）", (_name, initialTicketId) => {
    const html = renderToStaticMarkup(
      <TicketReplay tickets={tickets} onEventChange={noop} initialTicketId={initialTicketId} />,
    );
    expect(selected(html)).toEqual(["T-014"]);
    expect(itemsOfList(html)).toHaveLength(4);
  });

  it("並びの先頭を渡しても、初期の表示は props を渡さないときと同じ", () => {
    const html = renderToStaticMarkup(<TicketReplay tickets={tickets} onEventChange={noop} initialTicketId="T-014" />);
    expect(html).toBe(markup);
  });
});

// T-040 で直した：代表の票がなくても記録のある票は並ぶ。並びが空のときは、絞り込みのボタンの組と決まった文だけを出す
describe("TicketReplay の代表の票がないとき", () => {
  it("代表でない記録のある票だけでも、その票を選んで再生できる", () => {
    const html = renderToStaticMarkup(
      <TicketReplay
        tickets={[ticket("T-002", "架空の票の題その二", [event(1, { kind: "held" })])]}
        onEventChange={noop}
      />,
    );
    expect(html).toMatch(/<option[^>]*value="T-002"[^>]*selected=""/);
    expect(itemsOfList(html)).toHaveLength(1);
    expect(textOf(html)).toContain("記録のある票は全 1 票です");
  });
});

describe("TicketReplay の並びが空のとき", () => {
  it.each([
    ["入力が空", []],
    // T-040 で直した：出来事のない票は並びに入れない（以前は選んで空の一覧を出していた）
    ["出来事のない票だけ", [ticket("T-026", "架空の票の題その二十六")]],
  ])("%s なら、絞り込みのボタンの組と「この条件に合う票はありません」を出し、select・再生の操作・速さ・出来事を出さない", (_name, input) => {
    const html = renderToStaticMarkup(<TicketReplay tickets={input} onEventChange={noop} />);
    const text = textOf(html);
    expect(html).toMatch(/<div role="group" aria-label="票の絞り込み"/);
    expect(html).toMatch(/<button type="button" aria-pressed="true"[^>]*>すべて</);
    expect(text).toContain("この条件に合う票はありません");
    expect(text).toContain("記録のある票は全 0 票です");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<ol");
    expect(html).not.toContain('aria-label="速さ"');
    expect(html).not.toContain("aria-live");
    for (const name of ["再生", "一時停止", "1つ戻す", "1つ送る", "最初から", "1倍"]) {
      expect(html).not.toContain(`>${name}</button>`);
    }
    expect(html.match(/<button/g)).toHaveLength(4);
    expect(html).not.toContain("T-026");
  });

  it("空でも、描画の最中に onEventChange を呼ばない", () => {
    const onEventChange = vi.fn();
    renderToStaticMarkup(<TicketReplay tickets={[]} onEventChange={onEventChange} />);
    expect(onEventChange).not.toHaveBeenCalled();
  });
});
