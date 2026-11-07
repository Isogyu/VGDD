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
});
