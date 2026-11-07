// T-033 A2・A6：判例の比較の欄の表示の試験。版・日付・題・判例はすべて架空。
// 取得とクリックは試さない（SSR では effect が動かない）。

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LawHistory } from "@/lib/law-history-schema";
import LawComparison, { LawComparisonView } from "./LawComparison";

type Version = LawHistory["versions"][number];

function version(overrides: Partial<Version>): Version {
  return {
    version: "p9.0.0",
    date: "2099-01-01",
    title: "架空の版",
    fixed: ["架空の改善"],
    found_by: ["operation"],
    precedents: ["Z1"],
    tests_total: 10,
    prev_failed: 1,
    obs: [],
    ...overrides,
  };
}

const HISTORY: LawHistory = {
  schema: "vgdd.law-history.v1",
  note: "架空",
  versions: [
    version({ version: "p9.0.0", prev_failed: null, tests_total: null }),
    version({
      version: "p9.1.0",
      date: "2099-02-03",
      title: "架空の穴を塞ぐ",
      fixed: ["架空の改善その1", "架空の改善その2"],
      found_by: ["codex", "owner"],
      precedents: ["Z15", "Z19"],
      tests_total: 120,
      prev_failed: 7,
    }),
    version({ version: "p9.2.0", prev_failed: 3, tests_total: null }),
  ],
};

const noop = () => {};
const view = (selected: string | null, history: LawHistory = HISTORY) =>
  renderToStaticMarkup(<LawComparisonView history={history} selected={selected} onSelect={noop} />);

const SOURCE_NOTE =
  "出どころ：vgdd/kernel/history.json（法律の公開の要約）。落ちた件数は、その版で足した判例を前の版にかけた結果で、防いだ不具合の数ではありません";

describe("LawComparisonView", () => {
  it("見出しと、比べられる版だけのボタン（選んだ版だけ aria-pressed=true）を出す", () => {
    const html = view("p9.1.0");
    expect(html).toMatch(/<h2[^>]*>判例の比較<\/h2>/);
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>p9\.1\.0<\/button>/);
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>p9\.2\.0<\/button>/);
    expect(html).not.toMatch(/<button[^>]*>p9\.0\.0<\/button>/);
    expect(html.match(/aria-pressed="true"/g) ?? []).toHaveLength(1);
  });

  it("選んだ版の旧版・修正版・件数・直した点・判例・見つけた主体と、出どころの1行を出す", () => {
    const html = view("p9.1.0");
    expect(html).toContain("旧版：p9.0.0");
    expect(html).toContain("修正版：p9.1.0（2099-02-03）");
    expect(html).toContain("架空の穴を塞ぐ");
    expect(html).toContain("旧版にかけると 7 件が落ちた");
    expect(html).toContain("修正版の適合性テスト：全 120 件");
    expect(html).toContain("<li class=\"break-words\">架空の改善その1</li>");
    expect(html).toContain("<li class=\"break-words\">架空の改善その2</li>");
    expect(html).toMatch(/>Z15<\/li>/);
    expect(html).toMatch(/>Z19<\/li>/);
    expect(html).toMatch(/>Codex の監査<\/li>/);
    expect(html).toMatch(/>オーナー<\/li>/);
    expect(html).toContain(SOURCE_NOTE);
  });

  it("testsTotal が null の版は「未測定」", () => {
    const html = view("p9.2.0");
    expect(html).toContain("旧版：p9.1.0");
    expect(html).toContain("修正版の適合性テスト：未測定");
    expect(html).not.toContain("全 ");
  });

  it("先頭の版を比べると旧版は「—」", () => {
    const h: LawHistory = { ...HISTORY, versions: [version({ version: "p9.0.0", prev_failed: 2 })] };
    expect(view("p9.0.0", h)).toContain("旧版：—");
  });

  it("比べられる版がなければその文を出す", () => {
    const h: LawHistory = { ...HISTORY, versions: [version({ prev_failed: null })] };
    const html = view(null, h);
    expect(html).toMatch(/<h2[^>]*>判例の比較<\/h2>/);
    expect(html).toContain("比べられる版がありません");
    expect(html).not.toContain("<button");
  });

  it("入力全体を JSON にして出さない", () => {
    const html = view("p9.1.0");
    expect(html).not.toContain("vgdd.law-history.v1");
    expect(html).not.toContain("prev_failed");
  });
});

describe("LawComparison（データを取る部品）の初期の表示", () => {
  it("見出しと「読み込み中…」を出し、失敗の文を出さない", () => {
    const html = renderToStaticMarkup(<LawComparison />);
    expect(html).toMatch(/<h2[^>]*>判例の比較<\/h2>/);
    expect(html).toContain("読み込み中…");
    expect(html).not.toContain("法律の歴史を読めませんでした");
    expect(html).not.toContain("法律の歴史の記録がありません");
  });
});
