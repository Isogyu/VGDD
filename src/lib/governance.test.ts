import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { countReturns, loadGovernance, parseFrontMatter, parseTimeline } from "./governance";

// 見本の票（架空。リポジトリの実際の票には依存しない）
function ticket(opts: { id: string; title?: string; status?: string; records?: string[]; before?: string[] }): string {
  const fm = ["---", `id: ${opts.id}`];
  if (opts.title !== undefined) fm.push(`title: ${opts.title}`);
  fm.push(`status: ${opts.status ?? "ready"}   # コメント`, "estimate_h: 0.5", "---");
  return [
    ...fm,
    "",
    "## 1. 目的",
    "",
    ...(opts.before ?? []),
    "",
    "## 6. 記録",
    "",
    ...(opts.records ?? []),
    "",
  ].join("\n");
}

const tmpDirs: string[] = [];

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "governance-test-"));
  tmpDirs.push(root);
  fs.mkdirSync(path.join(root, "docs", "tasks"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs", "governance"), { recursive: true });
  return root;
}

function write(root: string, rel: string, content: string): void {
  fs.writeFileSync(path.join(root, rel), content, "utf8");
}

const validSummary = {
  schema: "vgdd.governance-summary.v1",
  generated_at: "2026-11-05T21:00:00+09:00",
  period: { first: "2026-11-02T12:00:00+09:00", last: null },
  chain_ok: true,
  records: 1200,
  sessions: 30,
  agents: 6,
  tool_calls: { allow: 1100, deny: 100 },
  deny_kinds: { files_forbidden: 60, push: 40 },
  by_agent: { worker: { calls: 800, deny: 70 }, judge: { calls: 400, deny: 30 } },
};

const validBoard = {
  schema: "vgdd.board.v1",
  totals: { tickets: 3, merged: 2, rejected: 5, blocked: 1, disagreements: 2 },
  tickets: [],
};

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("parseTimeline（A1）", () => {
  it("① §6 の裁判所の行から ts・actor・status・detail が取れる", () => {
    const md = ticket({
      id: "T-901",
      title: "見本",
      records: [
        "- 2026-11-03T20:28:02+0900 gate-runner: status → in_progress（files_allowed の外を変更している）  ",
        "- 2026-11-03T21:07:40+0900 release: status → merged（main=abc1234）",
        "- 2026-11-04T01:00:00-0500 night-runner: 前検査で確認。status → review で再申請（試行 1）",
      ],
    });
    expect(parseTimeline(md)).toEqual([
      {
        ts: "2026-11-03T20:28:02+0900",
        actor: "gate-runner",
        status: "in_progress",
        detail: "status → in_progress（files_allowed の外を変更している）",
      },
      { ts: "2026-11-03T21:07:40+0900", actor: "release", status: "merged", detail: "status → merged（main=abc1234）" },
      {
        ts: "2026-11-04T01:00:00-0500",
        actor: "night-runner",
        status: "review",
        detail: "前検査で確認。status → review で再申請（試行 1）",
      },
    ]);
  });

  it("② §6 より前の同じ形の行と、立法補佐・時刻の形が違う行は入らない", () => {
    const md = ticket({
      id: "T-902",
      title: "見本",
      before: ["- 2026-11-03T10:00:00+0900 gate-runner: status → merged（§6 より前）"],
      records: [
        "- 2026-11-03T11:00:00+0900 立法補佐: 起草",
        "- 2026-11-03T11:30:00+0900 行政の長: 割り当て",
        "- 2026-11-03T12:00:00+09:00 gate-runner: status → merged（時刻の形が違う）",
        "- 2026-11-03 12:00 gate-runner: status → merged（時刻の形が違う）",
        "- 2026-11-03T13:00:00+0900 gate-runner: status → review",
      ],
    });
    const events = parseTimeline(md);
    expect(events).toHaveLength(1);
    expect(events[0].ts).toBe("2026-11-03T13:00:00+0900");
  });

  it("見出し「## 6. 記録」がなければ空配列", () => {
    const md = "---\nid: T-903\n---\n- 2026-11-03T13:00:00+0900 gate-runner: status → review\n";
    expect(parseTimeline(md)).toEqual([]);
  });

  it("③ status → がない行は status: null", () => {
    const md = ticket({
      id: "T-904",
      title: "見本",
      records: [
        "- 2026-11-03T13:00:00+0900 night-runner: 作業員を起動した",
        "- 2026-11-03T13:05:00+0900 gate-runner: status → （空）",
      ],
    });
    const events = parseTimeline(md);
    expect(events.map((e) => e.status)).toEqual([null, null]);
    expect(events[0].detail).toBe("作業員を起動した");
  });
});

describe("parseFrontMatter（A2）", () => {
  it("④ コメントと前後の空白を落とし、title がない票は null", () => {
    expect(parseFrontMatter(ticket({ id: "T-905", title: "  見本の票  # 注記", status: "review" }))).toEqual({
      id: "T-905",
      title: "見本の票",
      status: "review",
    });
    expect(parseFrontMatter(ticket({ id: "T-906" }))).toBeNull();
    expect(parseFrontMatter("id: T-907\ntitle: x\nstatus: ready\n")).toBeNull();
  });
});

describe("returns と disagreements（A3）", () => {
  it("⑤ 裁判所の in_progress を差し戻し、分かれた blocked を不一致として数える", () => {
    const md = ticket({
      id: "T-908",
      title: "見本",
      records: [
        "- 2026-11-03T10:00:00+0900 gate-runner: status → in_progress（差し戻し1）",
        "- 2026-11-03T11:00:00+0900 gate-runner: status → blocked（judge と Codex の判定が分かれた）",
        "- 2026-11-03T12:00:00+0900 gate-runner: status → in_progress（差し戻し2）",
        "- 2026-11-03T12:30:00+0900 gate-runner: status → blocked（期限切れ）",
        "- 2026-11-03T13:00:00+0900 night-runner: status → in_progress（裁判所ではない）",
        "- 2026-11-03T13:30:00+0900 night-runner: status → blocked（判定が分かれた。裁判所ではない）",
        "- 2026-11-03T14:00:00+0900 gate-runner: status → merged",
      ],
    });
    expect(countReturns(parseTimeline(md))).toEqual({ returns: 2, disagreements: 1 });

    const root = makeRoot();
    write(root, "docs/tasks/T-908-sample.md", md);
    const data = loadGovernance(root);
    expect(data.tickets).toHaveLength(1);
    expect(data.tickets[0]).toMatchObject({ id: "T-908", title: "見本", status: "ready", returns: 2, disagreements: 1 });
    expect(data.tickets[0].timeline).toHaveLength(7);
  });
});

describe("loadGovernance（A3）", () => {
  it("⑥ 名前が規則に合わないファイルは読まない。名前の順に並ぶ", () => {
    const root = makeRoot();
    write(root, "docs/tasks/T-912-b.md", ticket({ id: "T-912", title: "二", status: "merged" }));
    write(root, "docs/tasks/T-911-a.md", ticket({ id: "T-911", title: "一" }));
    write(root, "docs/tasks/README.md", ticket({ id: "T-990", title: "説明" }));
    write(root, "docs/tasks/T-1-x.md", ticket({ id: "T-991", title: "桁違い" }));
    write(root, "docs/tasks/T-913-Upper.md", ticket({ id: "T-992", title: "大文字" }));
    write(root, "docs/tasks/T-914-no-title.md", ticket({ id: "T-914" }));
    const data = loadGovernance(root);
    expect(data.tickets.map((t) => t.id)).toEqual(["T-911", "T-912"]);
    expect(data.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  });

  it("_board.json と summary.json が正しければ取り出す", () => {
    const root = makeRoot();
    write(root, "docs/tasks/_board.json", JSON.stringify(validBoard));
    write(root, "docs/governance/summary.json", JSON.stringify(validSummary));
    const data = loadGovernance(root);
    expect(data.board).toEqual(validBoard.totals);
    expect(data.summary).toEqual(validSummary);
  });

  it("⑦ _board.json がない・壊れている・数でない項目があれば board: null", () => {
    const root = makeRoot();
    expect(loadGovernance(root).board).toBeNull();
    write(root, "docs/tasks/_board.json", "{ 壊れた JSON");
    expect(loadGovernance(root).board).toBeNull();
    write(root, "docs/tasks/_board.json", JSON.stringify({ totals: { ...validBoard.totals, merged: "2" } }));
    expect(loadGovernance(root).board).toBeNull();
    write(root, "docs/tasks/_board.json", JSON.stringify({ totals: { tickets: 1 } }));
    expect(loadGovernance(root).board).toBeNull();
  });

  it("⑦ summary.json がない・壊れている・項目の型が違えば summary: null", () => {
    const root = makeRoot();
    expect(loadGovernance(root).summary).toBeNull();
    write(root, "docs/governance/summary.json", "not json");
    expect(loadGovernance(root).summary).toBeNull();
    write(root, "docs/governance/summary.json", JSON.stringify({ ...validSummary, records: "1200" }));
    expect(loadGovernance(root).summary).toBeNull();
    write(root, "docs/governance/summary.json", JSON.stringify({ ...validSummary, chain_ok: "true" }));
    expect(loadGovernance(root).summary).toBeNull();
    write(root, "docs/governance/summary.json", JSON.stringify({ ...validSummary, schema: "vgdd.other.v1" }));
    expect(loadGovernance(root).summary).toBeNull();
  });

  it("⑧ summary.json の余分な項目は結果に入らない", () => {
    const root = makeRoot();
    const extra = {
      ...validSummary,
      raw_log: "生のログの本文",
      period: { ...validSummary.period, note: "余分" },
      tool_calls: { ...validSummary.tool_calls, ask: 3 },
      by_agent: { worker: { calls: 800, deny: 70, last_command: "秘密のコマンド" } },
    };
    write(root, "docs/governance/summary.json", JSON.stringify(extra));
    const s = loadGovernance(root).summary;
    expect(s).not.toBeNull();
    expect(Object.keys(s!).sort()).toEqual(Object.keys(validSummary).sort());
    expect(s!.period).toEqual(validSummary.period);
    expect(s!.tool_calls).toEqual(validSummary.tool_calls);
    expect(s!.by_agent).toEqual({ worker: { calls: 800, deny: 70 } });
    expect(JSON.stringify(s)).not.toContain("生のログ");
    expect(JSON.stringify(s)).not.toContain("秘密のコマンド");
  });

  it("⑨ 外を指すシンボリックリンク（票・_board.json・docs/tasks そのもの）は読まない", () => {
    // 一時ディレクトリの外（別の一時ディレクトリ）に本物のファイルを置く
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "governance-outside-"));
    tmpDirs.push(outside);
    fs.writeFileSync(path.join(outside, "T-920-secret.md"), ticket({ id: "T-920", title: "外の票" }));
    fs.writeFileSync(path.join(outside, "board.json"), JSON.stringify(validBoard));
    fs.writeFileSync(path.join(outside, "summary.json"), JSON.stringify(validSummary));

    // 票の名前のリンク・_board.json のリンク・summary.json のリンク
    const root = makeRoot();
    write(root, "docs/tasks/T-921-real.md", ticket({ id: "T-921", title: "本物" }));
    fs.symlinkSync(path.join(outside, "T-920-secret.md"), path.join(root, "docs/tasks/T-920-secret.md"));
    fs.symlinkSync(path.join(outside, "board.json"), path.join(root, "docs/tasks/_board.json"));
    fs.symlinkSync(path.join(outside, "summary.json"), path.join(root, "docs/governance/summary.json"));
    const data = loadGovernance(root);
    expect(data.tickets.map((t) => t.id)).toEqual(["T-921"]);
    expect(data.board).toBeNull();
    expect(data.summary).toBeNull();

    // docs/tasks ディレクトリそのもののリンク
    const outsideTasks = path.join(outside, "tasks");
    fs.mkdirSync(outsideTasks);
    fs.writeFileSync(path.join(outsideTasks, "T-922-outside.md"), ticket({ id: "T-922", title: "外" }));
    fs.writeFileSync(path.join(outsideTasks, "_board.json"), JSON.stringify(validBoard));
    const root2 = fs.mkdtempSync(path.join(os.tmpdir(), "governance-test-"));
    tmpDirs.push(root2);
    fs.mkdirSync(path.join(root2, "docs"));
    fs.symlinkSync(outsideTasks, path.join(root2, "docs", "tasks"));
    const data2 = loadGovernance(root2);
    expect(data2.tickets).toEqual([]);
    expect(data2.board).toBeNull();

    // docs そのもののリンク
    const root3 = fs.mkdtempSync(path.join(os.tmpdir(), "governance-test-"));
    tmpDirs.push(root3);
    fs.mkdirSync(path.join(outside, "docs"));
    fs.symlinkSync(outsideTasks, path.join(outside, "docs", "tasks"));
    fs.symlinkSync(path.join(outside, "docs"), path.join(root3, "docs"));
    expect(loadGovernance(root3).tickets).toEqual([]);
  });
});
