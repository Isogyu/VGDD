import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { focusFor, STAGE_EDGE_IDS, STAGE_EDGES, STAGE_NODE_IDS, type StageEvent, type StageFocus } from "@/lib/theater-stage";
import GovernanceStage from "./GovernanceStage";
import { theaterTokens } from "./tokens";

const render = (focus: StageFocus | null, stopped = false) =>
  renderToStaticMarkup(<GovernanceStage focus={focus} stopped={stopped} />);

const event = (kind: StageEvent["kind"], reason: StageEvent["reason"] = null): StageEvent => ({
  kind,
  reason,
  judge: "APPROVED",
  codex: "CHANGES_REQUIRED",
});

/** data-active="true" の付いた ID の集合 */
function activeIds(markup: string, attribute: "data-node" | "data-edge"): Set<string> {
  const ids = [...markup.matchAll(new RegExp(`<g ${attribute}="([a-z]+)" data-active="true"`, "g"))].map((m) => m[1]);
  return new Set(ids);
}

/** 節または線の <g> の始まりから、次の節・線の <g> の始まりまで */
function partOf(markup: string, attribute: "data-node" | "data-edge", id: string): string {
  const start = markup.indexOf(`<g ${attribute}="${id}"`);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = markup.slice(start + 1);
  const next = rest.search(/<g data-(node|edge)=/);
  return next === -1 ? rest : rest.slice(0, next);
}

// 票の A2 の表のすべての行
const events: StageEvent[] = [
  event("returned", "scope"),
  event("returned", "rebase"),
  event("returned", "other"),
  event("returned", "security"),
  event("returned", "judiciary"),
  event("blocked", "disagreement"),
  event("blocked", "return_limit"),
  event("blocked", "spec_unapproved"),
  event("blocked", "other"),
  event("held"),
  event("merged"),
  event("released"),
  event("ruling"),
  event("minor_disagreement"),
  event("resubmitted"),
  event("other"),
];

const toFill = (name: string) => name.replace(/^(?:text|bg)-/, "fill-");
const toStroke = (name: string) => name.replace(/^text-/, "stroke-");
const borderToStroke = (border: string) => border.split(" ").at(-1)!.replace(/^border-/, "stroke-");

describe("GovernanceStage の骨組み", () => {
  const markup = render(null);

  it("1つの svg で、viewBox が固定され、幅いっぱいに縮む。role と aria-label がある", () => {
    expect(markup.match(/<svg/g)).toHaveLength(1);
    expect(markup).toMatch(/viewBox="0 0 900 490"/);
    expect(markup).toContain('role="img"');
    expect(markup).toMatch(/class="[^"]*w-full/);
    expect(markup).toMatch(/aria-label="統治図。[^"]+"/);
  });

  it("6つの節のラベルと形の印が出る", () => {
    for (const id of STAGE_NODE_IDS) {
      const { label, mark } = theaterTokens.roles[id];
      expect(partOf(markup, "data-node", id)).toContain(`${mark} ${label}`);
    }
    expect(markup.match(/<g data-node=/g)).toHaveLength(6);
  });

  it("4つの担い手の文字が、それぞれの節に出る（折り返しても文字は変えない）", () => {
    const captions = [
      { id: "executive", lines: ["Claude Code", "（作業員は worktree で並行）"], whole: "Claude Code（作業員は worktree で並行）" },
      {
        id: "judiciary",
        lines: ["Claude と Codex", "（記録の構成。", "運用では Claude の別セッションでも可）"],
        whole: "Claude と Codex（記録の構成。運用では Claude の別セッションでも可）",
      },
      { id: "legislative", lines: ["Claude（立法補佐）と人"], whole: "Claude（立法補佐）と人" },
      { id: "kernel", lines: ["自作：フック・裁判所・証拠ストア"], whole: "自作：フック・裁判所・証拠ストア" },
    ];
    for (const { id, lines, whole } of captions) {
      expect(lines.join("")).toBe(whole);
      for (const line of lines) expect(partOf(markup, "data-node", id)).toContain(`>${line}</text>`);
    }
  });

  it("線の要素はちょうど8つで、A1 の8本だけ", () => {
    const ids = [...markup.matchAll(/data-edge="([a-z]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(8);
    expect(new Set(ids)).toEqual(new Set(Object.keys(STAGE_EDGES)));
    // data-edge の外に線を描かない（判定の札の rect は線ではない）
    expect(markup.match(/<path/g)).toHaveLength(8);
    expect(markup.match(/<polygon/g)).toHaveLength(8);
    expect(markup).not.toMatch(/<line|<polyline/);
  });

  it("人が上、立法・行政・司法が中段の左から順、Kernel が下、統合が Kernel の右", () => {
    const box = (id: string) => {
      const m = partOf(markup, "data-node", id).match(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/);
      expect(m).not.toBeNull();
      const [x, y, width, height] = m!.slice(1).map(Number);
      return { x, y, width, height };
    };
    const human = box("human");
    const legislative = box("legislative");
    const executive = box("executive");
    const judiciary = box("judiciary");
    const kernel = box("kernel");
    const merged = box("merged");
    expect(human.y + human.height).toBeLessThan(executive.y);
    expect(legislative.y).toBe(executive.y);
    expect(judiciary.y).toBe(executive.y);
    expect(legislative.x + legislative.width).toBeLessThan(executive.x);
    expect(executive.x + executive.width).toBeLessThan(judiciary.x);
    expect(executive.y + executive.height).toBeLessThan(kernel.y);
    expect(kernel.x + kernel.width).toBeLessThan(merged.x);
  });

  it("文字は、viewBox の幅 900 を約 899px で描いても 12px 以上", () => {
    const sizes = [...render(focusFor(event("blocked", "other")), true).matchAll(/font-size="(\d+)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes) * (899 / 900)).toBeGreaterThanOrEqual(12);
  });

  it("節の色は tokens.ts の役割に合う", () => {
    for (const id of STAGE_NODE_IDS) {
      const part = partOf(markup, "data-node", id);
      const token = theaterTokens.roles[id];
      expect(part).toContain(toFill(token.text));
      expect(part).toContain(toFill(token.background));
      expect(part).toContain(borderToStroke(token.border));
    }
  });

  it("動きは motion-safe の 300ms 以下の transition だけで、常に動く演出がない", () => {
    for (const m of [render(null), render(focusFor(event("held")), true), render(focusFor(event("other")))]) {
      const classes = [...m.matchAll(/class="([^"]*)"/g)].flatMap((c) => c[1].split(/\s+/));
      expect(classes.filter((c) => /(^|:)(transition|duration)/.test(c)).every((c) => c.startsWith("motion-safe:"))).toBe(true);
      const durations = classes.filter((c) => /duration-/.test(c)).map((c) => Number(c.split("duration-")[1]));
      expect(durations.length).toBeGreaterThan(0);
      expect(Math.max(...durations)).toBeLessThanOrEqual(300);
      expect(classes.filter((c) => /animate-/.test(c))).toEqual([]);
      expect(m).not.toMatch(/<animate/);
    }
  });
});

describe("focus の強調", () => {
  it.each(events)("$kind（$reason）で、強調の節と線が nodes・edges と完全に一致する", (e) => {
    const focus = focusFor(e);
    const markup = render(focus);
    expect(activeIds(markup, "data-node")).toEqual(new Set(focus.nodes));
    expect(activeIds(markup, "data-edge")).toEqual(new Set(focus.edges));
    expect(markup.match(/<g data-edge=/g)).toHaveLength(8);
  });

  it("focus: null なら強調がなく、どの節も線も暗くしない。判定の札は両方「—」", () => {
    const markup = render(null);
    expect(activeIds(markup, "data-node").size).toBe(0);
    expect(activeIds(markup, "data-edge").size).toBe(0);
    expect(markup).not.toContain("opacity-50");
    expect(markup).toContain(">Claude：—</text>");
    expect(markup).toContain(">Codex：—</text>");
  });

  it("強調する線は太く明るく、ほかは細く暗い。節も太さと明るさで分ける", () => {
    const markup = render(focusFor(event("merged")));
    const merge = partOf(markup, "data-edge", "merge");
    expect(merge).toContain("stroke-[4]");
    expect(merge).toContain(toStroke(theaterTokens.roles.merged.text));
    expect(merge).toContain("opacity-100");
    const spec = partOf(markup, "data-edge", "spec");
    expect(spec).toContain("stroke-[1.5]");
    expect(spec).toContain("stroke-slate-500");
    expect(spec).toContain("opacity-50");
    expect(partOf(markup, "data-node", "kernel")).toContain("stroke-[3]");
    const human = partOf(markup, "data-node", "human");
    expect(human).toContain("opacity-50");
    expect(human).toContain("stroke-1");
  });

  it.each([
    ["APPROVED", "APPROVED", "合格", "合格"],
    ["CHANGES_REQUIRED", "APPROVED", "差し戻し", "合格"],
    ["APPROVED", "CHANGES_REQUIRED", "合格", "差し戻し"],
    [null, "CHANGES_REQUIRED", "—", "差し戻し"],
    [null, null, "—", "—"],
  ] as const)("判定の札：judge %s・codex %s", (judge, codex, judgeText, codexText) => {
    const part = partOf(render(focusFor({ kind: "held", reason: null, judge, codex })), "data-node", "judiciary");
    expect(part).toContain(`>Claude：${judgeText}</text>`);
    expect(part).toContain(`>Codex：${codexText}</text>`);
  });

  it("aria-label が今の状態を言葉で表す", () => {
    const label = (m: string) => m.match(/aria-label="([^"]*)"/)?.[1];
    expect(label(render(null))).toContain("出来事を選んでいません");
    const merged = label(render(focusFor(event("merged"))));
    expect(merged).toContain("関わる役割：Kernel、統合");
    expect(merged).toContain("流れ：統合");
    expect(merged).toContain("判定：Claude 合格、Codex 差し戻し");
    expect(label(render(focusFor(event("held"))))).toContain("判断待ち");
    expect(label(render(focusFor(event("other"))))).toContain("確認できない");
    const stopped = label(render(focusFor(event("merged")), true));
    expect(stopped).toContain("停止中");
    expect(stopped).not.toContain("流れ：");
  });
});

describe("tone", () => {
  const { waiting, unknown, stopped } = theaterTokens.states;

  it("waiting なら人の節に判断待ち（琥珀色・形の印）が出る", () => {
    for (const e of [event("held"), event("blocked", "disagreement"), event("blocked", "return_limit"), event("blocked", "spec_unapproved")]) {
      const human = partOf(render(focusFor(e)), "data-node", "human");
      expect(human).toContain(`${waiting.mark} ${waiting.label}`);
      expect(human).toContain(toFill(waiting.text));
      expect(human).toContain(toFill(waiting.background));
      expect(human).toContain(borderToStroke(waiting.border));
    }
  });

  it("normal なら判断待ちが出ない", () => {
    expect(render(focusFor(event("merged")))).not.toContain(waiting.label);
    expect(render(null)).not.toContain(waiting.label);
  });

  it("unknown なら全体に確認できない（灰色・破線）が出る", () => {
    for (const e of [event("other"), event("blocked", "other")]) {
      const markup = render(focusFor(e));
      expect(markup).toContain(`${unknown.mark} ${unknown.label}`);
      const frame = markup.slice(markup.indexOf('<g data-state="unknown"'), markup.indexOf("<g data-edge="));
      expect(frame).toContain("stroke-dasharray");
      expect(frame).toContain(borderToStroke(unknown.border));
      expect(frame).toContain(toFill(unknown.background));
      for (const id of STAGE_NODE_IDS) {
        const node = partOf(markup, "data-node", id);
        expect(node).toContain("stroke-dasharray");
        expect(node).toContain(borderToStroke(unknown.border));
      }
    }
  });

  it("normal・waiting では確認できないが出ない", () => {
    expect(render(focusFor(event("merged")))).not.toContain(unknown.label);
    expect(render(focusFor(event("held")))).not.toContain(unknown.label);
    expect(render(null)).not.toContain(unknown.label);
  });

  it.each([null, ...events])("stopped なら Kernel の節に停止中（赤・形の印）が出て、強調の線が0本（%j）", (e) => {
    const markup = render(e === null ? null : focusFor(e), true);
    const kernel = partOf(markup, "data-node", "kernel");
    expect(kernel).toContain(`${stopped.mark} 停止中`);
    expect(kernel).toContain(toFill(stopped.text));
    expect(kernel).toContain(toFill(stopped.background));
    expect(kernel).toContain(borderToStroke(stopped.border));
    expect(activeIds(markup, "data-edge").size).toBe(0);
    expect(markup.match(/stroke-\[4\]/g)).toBeNull();
    expect(markup.match(/<g data-edge=/g)).toHaveLength(STAGE_EDGE_IDS.length);
  });

  it("stopped でなければ停止中が出ない", () => {
    expect(render(focusFor(event("merged")))).not.toContain("停止中");
  });
});
