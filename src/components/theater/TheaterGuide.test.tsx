import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GUIDE_NOTE, GUIDE_STEPS } from "@/lib/theater-guide";
import TheaterGuide from "./TheaterGuide";

const noop = () => {};

function render(step: number): string {
  return renderToStaticMarkup(<TheaterGuide step={step} onPrev={noop} onNext={noop} onClose={noop} />);
}

describe("TheaterGuide", () => {
  it("手順 0 では「1 / 5」と最初の手順の文を出し、「戻る」が disabled", () => {
    const markup = render(0);
    expect(markup).toContain("1 / 5");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>戻る<\/button>/);
    expect(markup).toMatch(/<button[^>]*>次へ<\/button>/);
    expect(markup).not.toMatch(/<button[^>]*>終える<\/button>/);
    expect(markup).toMatch(/<button[^>]*>案内を終える<\/button>/);
    expect(markup).toContain(`<h3 class="font-medium">${GUIDE_STEPS[0].title}</h3>`);
    expect(markup).toContain(GUIDE_STEPS[0].body);
    expect(markup).not.toContain("<h2");
  });

  it("手順 4 では「5 / 5」で「終える」が出て「次へ」が出ず、「戻る」は押せる", () => {
    const markup = render(4);
    expect(markup).toContain("5 / 5");
    expect(markup).toMatch(/<button[^>]*>終える<\/button>/);
    expect(markup).not.toContain("次へ");
    expect(markup).toMatch(/<button type="button" class="[^"]*">戻る<\/button>/);
    expect(markup).toMatch(/<button[^>]*>案内を終える<\/button>/);
    expect(markup).toContain(GUIDE_STEPS[4].title);
  });

  it("ボタンは button 要素の3つ", () => {
    for (const step of [0, 2, 4]) {
      expect(render(step).match(/<button /g)).toHaveLength(3);
    }
  });

  it("GUIDE_NOTE と、region・aria-label・aria-live を出す", () => {
    const markup = render(2);
    expect(markup).toContain(GUIDE_NOTE);
    expect(markup).toMatch(/<div role="region" aria-label="はじめて見る人への案内"/);
    expect(markup).toContain('aria-live="polite"');
  });

  it("動きの演出の指定を付けない", () => {
    const markup = render(1);
    expect(markup).not.toMatch(/transition|animate/);
  });
});
