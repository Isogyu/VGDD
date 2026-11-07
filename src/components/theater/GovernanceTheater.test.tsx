import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import GovernanceTheater from "./GovernanceTheater";

// 初期の表示だけを試す（SSR では effect が動かないので、取得はしない）
const markup = renderToStaticMarkup(<GovernanceTheater />);

describe("GovernanceTheater の初期の表示", () => {
  it("作品名と1行の文を出す", () => {
    expect(markup).toMatch(/<h1[^>]*>VGDD Governance Kernel<\/h1>/);
    expect(markup).toMatch(
      /<p[^>]*>AI が作る。別系統の AI が独立して確かめる。統合の条件は Kernel が強制し、承認と停止は人が持つ。<\/p>/,
    );
  });

  it("source の切り替えのボタンがあり、最初は「提出記録」が押されている", () => {
    expect(markup).toMatch(/<button[^>]*aria-pressed="true"[^>]*>提出記録<\/button>/);
    expect(markup).toMatch(/<button[^>]*aria-pressed="false"[^>]*>稼働中の観測<\/button>/);
    expect(markup).toContain("<dd>提出記録</dd>");
  });

  it("3つの取得の状態がどれも「読み込み中…」で、書き出しの時刻は「—」", () => {
    for (const label of ["公開イベント", "Kernel の写し", "不変条件の写し"]) {
      expect(markup).toContain(`${label}：</dt><dd>読み込み中…</dd>`);
    }
    expect(markup).toContain("Kernel の写しの書き出し：</dt><dd>—</dd>");
  });

  it("主役の図は出来事なしで出て、高さの制約は 1024px 以上だけの指定を包みから与える", () => {
    expect(markup).toContain("出来事を選んでいません。");
    expect(markup).not.toContain("停止中");
    for (const className of ["lg:h-full", "lg:[&amp;_svg]:max-h-full", "lg:[&amp;_svg]:w-auto", "lg:[&amp;_svg]:mx-auto"]) {
      expect(markup).toContain(className);
    }
    expect(markup).not.toMatch(/[" ]\[&amp;_svg\]/);
  });

  it("選んだ票の区画に、再生の前の案内と、記録の文を公開していないことを出す", () => {
    expect(markup).toContain("下の再生を押すと、票1枚の記録を順に追います");
    expect(markup).toContain("出来事は票の §6 の記録の分類です。記録の文そのものは公開していません");
  });

  it("取得前は、失敗の文を出さない", () => {
    expect(markup).not.toContain("取得できませんでした");
    expect(markup).not.toContain("書き出しがありません");
  });

  // T-033 A4・A6
  it("シアターの下に「判例の比較」と「判断待ちと次の担当」の見出しを出す", () => {
    expect(markup).toMatch(/<h2[^>]*>判例の比較<\/h2>/);
    expect(markup).toMatch(/<h2[^>]*>判断待ちと次の担当<\/h2>/);
    // 最初の画面（再生の操作の区画）の後ろに置く
    const footerEnd = markup.indexOf("</footer>");
    expect(footerEnd).toBeGreaterThan(-1);
    expect(markup.indexOf("判例の比較")).toBeGreaterThan(footerEnd);
    expect(markup.indexOf("判断待ちと次の担当")).toBeGreaterThan(footerEnd);
  });

  it("新しい区画はシアターの背景と文字の色で、1024px 以上で横に2列", () => {
    const m = markup.match(/<section aria-label="判例の比較と判断待ち" class="([^"]*)"/);
    expect(m).not.toBeNull();
    const classes = (m?.[1] ?? "").split(" ");
    for (const c of ["bg-slate-950", "text-slate-100", "grid-cols-1", "lg:grid-cols-2"]) {
      expect(classes).toContain(c);
    }
  });

  it("取得前の判断待ちの欄は、見ている source の表示名と「読み込み中…」", () => {
    expect(markup).toContain("提出記録・—の写しから");
  });

  // T-035 A5：提出記録では取り直しの項目を出さない
  it("初期の表示（提出記録）に「今すぐ取得」と「最後の取得」と取得の失敗の文を出さない", () => {
    expect(markup).not.toContain("今すぐ取得");
    expect(markup).not.toContain("最後の取得");
    expect(markup).not.toContain("最新の取得で一部または全部を取得できませんでした");
  });

  // T-036 A4・A5
  it("判例の比較・判断待ちの下に「Claude Code の使い分け」の見出しを出す", () => {
    expect(markup).toMatch(/<h2[^>]*>Claude Code の使い分け<\/h2>/);
    // T-033 の区画の直後に、シアターの色の横幅いっぱいの入れ物を置く
    const wrapper = markup.indexOf('</div></section><div class="bg-slate-950 text-slate-100 w-full');
    expect(wrapper).toBeGreaterThan(markup.indexOf("判断待ちと次の担当"));
    expect(markup.indexOf("Claude Code の使い分け")).toBeGreaterThan(wrapper);
  });

  // T-037 A3・A5
  it("初期の表示に「はじめて見る」ボタンを見出しの区画に出し、案内の欄は出さない", () => {
    expect(markup).toMatch(/<button[^>]*>はじめて見る<\/button>/);
    const headerEnd = markup.indexOf("</header>");
    expect(headerEnd).toBeGreaterThan(-1);
    expect(markup.indexOf("はじめて見る")).toBeLessThan(headerEnd);
    expect(markup).not.toContain('aria-label="はじめて見る人への案内"');
    expect(markup).not.toContain("案内の光は説明のための強調で、記録の出来事ではありません");
  });
});
