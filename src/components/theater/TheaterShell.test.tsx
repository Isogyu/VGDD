import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TheaterPage, { metadata } from "@/app/governance/theater/page";
import TheaterShell from "./TheaterShell";
import { theaterTokens } from "./tokens";

const shellMarkup = renderToStaticMarkup(
  <TheaterShell
    header={<span>中身-header</span>}
    stage={<span>中身-stage</span>}
    side={<span>中身-side</span>}
    controls={<span>中身-controls</span>}
  />,
);

const regions = [
  { open: "<header", close: "</header>", content: "中身-header" },
  { open: '<section aria-label="統治図"', close: "</section>", content: "中身-stage" },
  { open: '<aside aria-label="選んだ票"', close: "</aside>", content: "中身-side" },
  { open: '<footer aria-label="再生の操作"', close: "</footer>", content: "中身-controls" },
];

const roleKeys = ["human", "legislative", "executive", "judiciary", "kernel", "merged"];
const stateKeys = ["waiting", "stopped", "unknown"];
const allTokens = [...Object.values(theaterTokens.roles), ...Object.values(theaterTokens.states)];

describe("TheaterShell", () => {
  it("4つの区画が header → stage → side → controls の順に出る", () => {
    const positions = regions.map(({ open }) => shellMarkup.indexOf(open));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("渡した中身が、それぞれの区画の中に入る", () => {
    for (const { open, close, content } of regions) {
      const start = shellMarkup.indexOf(open);
      const end = shellMarkup.indexOf(close, start);
      expect(shellMarkup.slice(start, end)).toContain(content);
    }
    expect(shellMarkup.match(/中身-/g)).toHaveLength(regions.length);
  });

  it("画面の高さを行で 15:65:20 に分け、背景と文字はテーマによらず固定する", () => {
    for (const className of ["lg:h-dvh", "lg:grid-rows-[15fr_65fr_20fr]", "bg-slate-950", "text-slate-100"]) {
      expect(shellMarkup).toContain(className);
    }
    expect(shellMarkup).not.toContain("dark:");
  });

  it("動きのクラスを付けない", () => {
    expect(shellMarkup).not.toMatch(/transition|animate-/);
    expect(JSON.stringify(theaterTokens)).not.toMatch(/transition|animate-/);
  });
});

describe("theaterTokens", () => {
  it("役割の6つと状態の3つがそろう", () => {
    expect(Object.keys(theaterTokens.roles)).toEqual(roleKeys);
    expect(Object.keys(theaterTokens.states)).toEqual(stateKeys);
  });

  it("各項目に、ラベルと1文字の形の印と、文字・枠・背景のクラスがある", () => {
    for (const token of allTokens) {
      expect(token.label.length).toBeGreaterThan(0);
      expect([...token.mark]).toHaveLength(1);
      expect(token.text).toMatch(/^text-/);
      expect(token.border).toMatch(/border-[a-z]+-\d+/);
      expect(token.background).toMatch(/^bg-[a-z]+-\d+$/);
    }
  });

  it("ラベルと形の印が互いに重ならない", () => {
    const labels = allTokens.map((token) => token.label);
    const marks = allTokens.map((token) => token.mark);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(marks).size).toBe(marks.length);
  });

  it("役割の文字色は 200〜300 で、決められた色の向きを持つ", () => {
    for (const role of Object.values(theaterTokens.roles)) {
      expect(role.text).toMatch(/^text-[a-z]+-(200|300)$/);
    }
    const { legislative, executive, judiciary, kernel, merged } = theaterTokens.roles;
    expect(legislative.text).toContain("violet");
    expect(executive.text).toContain("blue");
    expect(judiciary.text).toMatch(/amber|yellow/);
    expect(kernel.text).toContain("slate");
    expect(merged.text).toContain("emerald");
  });

  it("状態の色は琥珀・赤・灰で、確認できないの枠だけ破線", () => {
    const { waiting, stopped, unknown } = theaterTokens.states;
    expect(waiting.text).toContain("amber");
    expect(stopped.text).toContain("red");
    expect(unknown.text).toContain("gray");
    expect(unknown.border).toContain("border-dashed");
    expect(allTokens.filter((token) => token.border.includes("border-dashed"))).toEqual([unknown]);
  });
});

describe("/governance/theater", () => {
  const pageMarkup = renderToStaticMarkup(<TheaterPage />);

  it("作品名と1行の文を出す", () => {
    expect(pageMarkup).toMatch(/<h1[^>]*>VGDD Governance Kernel<\/h1>/);
    expect(pageMarkup).toMatch(
      /<p[^>]*>AI が作る。別系統の AI が独立して確かめる。統合の条件は Kernel が強制し、承認と停止は人が持つ。<\/p>/,
    );
  });

  it("ほかの3つの区画は、名前と仮の文だけで、数字を出さない", () => {
    for (const name of ["統治図", "選んだ票", "再生の操作"]) {
      expect(pageMarkup).toContain(`>${name}（後の票で中身を入れる）<`);
    }
    const text = pageMarkup.replace(/<[^>]*>/g, "");
    expect(text).not.toMatch(/\d/);
  });

  it("metadata の title が決められた文字列である", () => {
    expect(metadata.title).toBe("統治シアター（試作）— VGDD Governance Kernel");
  });
});
