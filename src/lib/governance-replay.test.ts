// T-028：記録の行を列挙値だけのイベントに変える関数の試験。
// 列挙値とキーの集合は、実装から import せず、票 §2 の値をここに書き写して照らす。
import { describe, expect, it } from "vitest";
import { loadGovernance, type GovernanceData, type TimelineActor, type TimelineEvent } from "@/lib/governance";
import { buildReplay, toPublicEvent, type PublicEvent } from "@/lib/governance-replay";

const TOP_KEYS = ["generated_at", "schema", "tickets"];
const TICKET_KEYS = ["events", "id", "status", "title"];
const EVENT_KEYS = ["actor", "codex", "judge", "kind", "reason", "seq", "ts"];

const ACTORS = ["gate-runner", "night-runner", "release"];
const KINDS = ["returned", "blocked", "held", "merged", "released", "ruling", "minor_disagreement", "resubmitted", "other"];
const REASONS = ["scope", "rebase", "security", "judiciary", "disagreement", "return_limit", "spec_unapproved", "other", null];
const VERDICTS = ["APPROVED", "CHANGES_REQUIRED", null];

const APPROVED = "APPROVED";
const CR = "CHANGES_REQUIRED";

type Row = {
  name: string;
  // 写した元の票。合成の入力は null
  source: string | null;
  ts: string;
  actor: TimelineActor;
  detail: string;
  kind: string;
  reason: string | null;
  judge: string | null;
  codex: string | null;
};

// 票 §2 A1 の表の15行。実例のある13行は、実際の票の §6 の行をそのまま写した
const TABLE: Row[] = [
  {
    name: "01 returned/scope",
    source: "T-001",
    ts: "2026-11-03T20:28:02+0900",
    actor: "gate-runner",
    detail: "status → in_progress（files_allowed の外を変更している: src/app/api/sessions/[id]/previous/route.ts）",
    kind: "returned",
    reason: "scope",
    judge: null,
    codex: null,
  },
  {
    name: "02 returned/rebase",
    source: "T-002",
    ts: "2026-11-03T21:07:40+0900",
    actor: "gate-runner",
    detail: "status → in_progress（ブランチが main を含んでいない（rebase が必要））",
    kind: "returned",
    reason: "rebase",
    judge: null,
    codex: null,
  },
  {
    name: "03 returned/security",
    source: "T-004",
    ts: "2026-11-04T22:26:17+0900",
    actor: "gate-runner",
    detail: "status → in_progress（セキュリティ審査が差し戻し）",
    kind: "returned",
    reason: "security",
    judge: null,
    codex: null,
  },
  {
    name: "04 returned/judiciary",
    source: "T-000",
    ts: "2026-11-03T17:26:14+0900",
    actor: "gate-runner",
    detail: "status → in_progress（judge=CHANGES_REQUIRED, codex=CHANGES_REQUIRED（両方が差し戻し））",
    kind: "returned",
    reason: "judiciary",
    judge: CR,
    codex: CR,
  },
  {
    name: "05 returned/other（合成）",
    source: null,
    ts: "2026-11-07T00:00:00+0900",
    actor: "gate-runner",
    detail: "status → in_progress（表のどの決まった文にも当たらない合成の理由）",
    kind: "returned",
    reason: "other",
    judge: null,
    codex: null,
  },
  {
    name: "06 blocked/disagreement",
    source: "T-014",
    ts: "2026-11-06T01:07:36+0900",
    actor: "gate-runner",
    detail: "status → blocked（judge と Codex の判定が重大な指摘で分かれた（judge=APPROVED/0 件, codex=CHANGES_REQUIRED/1 件）。オーナーの裁定へ）",
    kind: "blocked",
    reason: "disagreement",
    judge: APPROVED,
    codex: CR,
  },
  {
    name: "07 blocked/return_limit",
    source: "T-002",
    ts: "2026-11-03T21:26:26+0900",
    actor: "gate-runner",
    detail: "status → blocked（差し戻しが 3 回に達した。オーナーの判断へ）",
    kind: "blocked",
    reason: "return_limit",
    judge: null,
    codex: null,
  },
  {
    name: "08 blocked/spec_unapproved",
    source: "T-016",
    ts: "2026-11-05T23:44:00+0900",
    actor: "gate-runner",
    detail: "status → blocked（仕様（main の票の統治の項目と受け入れ条件）がオーナーに承認されていない、または承認の後に変わった。approve-spec.sh で承認する）",
    kind: "blocked",
    reason: "spec_unapproved",
    judge: null,
    codex: null,
  },
  {
    name: "09 blocked/other（合成）",
    source: null,
    ts: "2026-11-07T00:00:01+0900",
    actor: "gate-runner",
    detail: "status → blocked（表のどの決まった文にも当たらない合成の理由）",
    kind: "blocked",
    reason: "other",
    judge: null,
    codex: null,
  },
  {
    name: "10 held",
    source: "T-014",
    ts: "2026-11-06T01:16:51+0900",
    actor: "gate-runner",
    detail: "status → review（判定に合格（judge=APPROVED codex=APPROVED）。夜間のため統合せず、朝のオーナーの承認を待つ）",
    kind: "held",
    reason: null,
    judge: APPROVED,
    codex: APPROVED,
  },
  {
    name: "11 merged",
    source: "T-002",
    ts: "2026-11-03T21:35:46+0900",
    actor: "gate-runner",
    detail: "status → merged（main=dac469070944 judge=APPROVED codex=APPROVED）",
    kind: "merged",
    reason: null,
    judge: APPROVED,
    codex: APPROVED,
  },
  {
    name: "12 released",
    source: "T-014",
    ts: "2026-11-06T01:25:15+0900",
    actor: "release",
    detail: "status → merged（main=65d7173a79cb。夜間の判定に合格した候補 cdc3a0beac50 を、オーナーが朝に承認して統合）",
    kind: "released",
    reason: null,
    judge: null,
    codex: null,
  },
  {
    name: "13 ruling",
    source: "T-026",
    ts: "2026-11-07T01:17:53+0900",
    actor: "gate-runner",
    detail: "judge と Codex が分かれたが、オーナーの裁定（統合）により進める：Codex の指摘（初回の取得中に amber の帯が出ない）は §2 のあいまいさによる。A3(b) の帯の文は取得の後の失敗を指し、取得中に出すと誤りになる。取得中も全体図の Kernel の欄は「確認できない」で、稼働中とは出ないので、§2 の目的は満たす。judge は APPROVED",
    kind: "ruling",
    reason: null,
    judge: null,
    codex: null,
  },
  {
    name: "14 minor_disagreement",
    source: "T-014",
    ts: "2026-11-06T01:05:30+0900",
    actor: "gate-runner",
    detail: "judge と Codex が minor の指摘で分かれた。厳しい側の指摘を残して統合（judge=APPROVED, codex=CHANGES_REQUIRED）",
    kind: "minor_disagreement",
    reason: null,
    judge: APPROVED,
    codex: CR,
  },
  {
    name: "15 resubmitted",
    source: "T-009",
    ts: "2026-11-05T20:24:28+0900",
    actor: "night-runner",
    detail: "作業員の実装を前検査で確認（HEAD 3ed97a3）。status → review で再申請（試行 1）",
    kind: "resubmitted",
    reason: null,
    judge: null,
    codex: null,
  },
];

function event(actor: TimelineActor, detail: string): TimelineEvent {
  return { ts: "2026-11-07T00:00:00+0900", actor, status: null, detail };
}

describe("toPublicEvent：票 §2 A1 の表の15行", () => {
  it.each(TABLE)("$name", (row) => {
    const got = toPublicEvent({ ts: row.ts, actor: row.actor, status: null, detail: row.detail }, 3);
    expect(got).toEqual({
      seq: 3,
      ts: row.ts,
      actor: row.actor,
      kind: row.kind,
      reason: row.reason,
      judge: row.judge,
      codex: row.codex,
    });
  });

  it("表の行は15行で、実例は13行、合成は2行", () => {
    expect(TABLE).toHaveLength(15);
    expect(TABLE.filter((r) => r.source !== null)).toHaveLength(13);
  });

  it("実例の13行は、実際の票の §6 の行と同じ（時刻・役割・文）", () => {
    const tickets = loadGovernance(process.cwd()).tickets;
    for (const row of TABLE) {
      if (row.source === null) continue;
      const ticket = tickets.find((t) => t.id === row.source);
      expect(ticket, row.name).toBeDefined();
      const same = ticket?.timeline.some((e) => e.ts === row.ts && e.actor === row.actor && e.detail === row.detail);
      expect(same, row.name).toBe(true);
    }
  });

  it("件数の付く形の両方の差し戻しも judiciary で、件数は捨てる", () => {
    const got = toPublicEvent(
      event("gate-runner", "status → in_progress（judge=CHANGES_REQUIRED/2 件, codex=CHANGES_REQUIRED/1 件（両方が差し戻し））"),
      1,
    );
    expect(got.kind).toBe("returned");
    expect(got.reason).toBe("judiciary");
    expect(got.judge).toBe(CR);
    expect(got.codex).toBe(CR);
  });
});

describe("toPublicEvent：表に当たらない行", () => {
  it.each<[string, TimelineActor, string]>([
    ["決まった文でない", "gate-runner", "どの決まった文でもない記録の行"],
    ["文の途中の status は先頭でない", "gate-runner", "前置きの文 status → merged"],
    ["夜間の語のない review", "gate-runner", "status → review（判定に合格）"],
    ["表にない status", "gate-runner", "status → rejected（合成の理由）"],
    ["似た名前の status（merged の続き）", "gate-runner", "status → merged_extra"],
    ["似た名前の status（blocked の続き）", "gate-runner", "status → blocked2"],
    ["似た名前の status（in_progress の続き）", "gate-runner", "status → in_progress_x"],
    ["役割が違う：night-runner の merged", "night-runner", "status → merged（合成）"],
    ["役割が違う：release の blocked", "release", "status → blocked（差し戻しが 3 回に達した）"],
    ["役割が違う：release の in_progress", "release", "status → in_progress（セキュリティ審査が差し戻し）"],
    ["役割が違う：gate-runner の再申請", "gate-runner", "作業員の実装を前検査で確認"],
    ["役割が違う：night-runner の裁定", "night-runner", "judge と Codex が分かれたが、オーナーの裁定"],
  ])("%s は other で、判定もない", (_name, actor, detail) => {
    const got = toPublicEvent(event(actor, detail), 1);
    expect(got.kind).toBe("other");
    expect(got.reason).toBeNull();
    expect(got.judge).toBeNull();
    expect(got.codex).toBeNull();
  });

  it("判定のトークンがあれば、kind は other のまま judge・codex だけが入る", () => {
    const got = toPublicEvent(event("gate-runner", "どの決まった文でもない judge=APPROVED, codex=CHANGES_REQUIRED/2 件"), 1);
    expect(got.kind).toBe("other");
    expect(got.reason).toBeNull();
    expect(got.judge).toBe(APPROVED);
    expect(got.codex).toBe(CR);
  });

  it("APPROVED_EXTRA のように直後に英字・数字・_ が続くトークンは当てない", () => {
    for (const tail of ["_EXTRA", "X", "x", "1", "_"]) {
      const got = toPublicEvent(event("gate-runner", `合成の文 judge=APPROVED${tail} codex=CHANGES_REQUIRED${tail}`), 1);
      expect(got.kind, tail).toBe("other");
      expect(got.judge, tail).toBeNull();
      expect(got.codex, tail).toBeNull();
    }
  });

  it("別の語の一部や、2つの値のほかは当てない", () => {
    const got = toPublicEvent(event("gate-runner", "prejudge=APPROVED xcodex=APPROVED judge=REJECTED codex=approved"), 1);
    expect(got.judge).toBeNull();
    expect(got.codex).toBeNull();
  });

  it("件数は捨てて、値だけを返す", () => {
    const got = toPublicEvent(event("gate-runner", "合成の文 judge=APPROVED/0 件, codex=CHANGES_REQUIRED/12 件"), 1);
    expect(got.judge).toBe(APPROVED);
    expect(got.codex).toBe(CR);
  });
});

// 余分な項目の試験で、応答のどこにも残ってはいけない文字列
const SECRETS = [
  "合成の自由な文",
  "abcdef1234567",
  "src/lib/synthetic-secret.ts",
  "main=feedface1234",
  "余分な要約の文",
  "余分な項目の文",
  "余分なイベントの文",
  "イベントの status の文",
  "盤の余分な文",
  "集計の余分な文",
  "トップの余分な文",
];

function syntheticData(): GovernanceData {
  const freeText = "合成の自由な文 abcdef1234567 src/lib/synthetic-secret.ts main=feedface1234";
  const raw = {
    generated_at: "2026-11-07T02:00:00+0900",
    extra: "トップの余分な文",
    board: { tickets: 2, merged: 1, rejected: 0, blocked: 0, disagreements: 0, note: "盤の余分な文" },
    summary: { schema: "vgdd.governance-summary.v1", note: "集計の余分な文" },
    tickets: [
      {
        id: "T-901",
        title: "合成の票その1",
        status: "merged",
        returns: 1,
        disagreements: 0,
        summary: "余分な要約の文",
        extra: "余分な項目の文",
        timeline: [
          { ts: "2026-11-07T01:00:00+0900", actor: "gate-runner", status: "in_progress", detail: `status → in_progress（${freeText}）`, extra: "余分なイベントの文" },
          { ts: "2026-11-07T01:00:01+0900", actor: "night-runner", status: "イベントの status の文", detail: `作業員の実装を前検査で確認 ${freeText}` },
          { ts: "2026-11-07T01:00:02+0900", actor: "release", status: "merged", detail: `status → merged（${freeText} judge=APPROVED codex=CHANGES_REQUIRED/1 件）` },
          { ts: "2026-11-07T01:00:03+0900", actor: "gate-runner", status: null, detail: freeText },
        ],
      },
      {
        id: "T-902",
        title: "合成の票その2",
        status: "ready",
        returns: 0,
        disagreements: 0,
        summary: "余分な要約の文",
        timeline: [{ ts: "2026-11-07T01:01:00+0900", actor: "gate-runner", status: "blocked", detail: `status → blocked（${freeText}）` }],
      },
      { id: "T-903", title: "合成の票その3", status: "ready", returns: 0, disagreements: 0, timeline: [] },
    ],
  };
  return raw as unknown as GovernanceData;
}

function sortedKeys(o: object): string[] {
  return Object.keys(o).sort();
}

function expectEventShape(e: PublicEvent, seq: number) {
  expect(sortedKeys(e)).toEqual(EVENT_KEYS);
  expect(e.seq).toBe(seq);
  expect(ACTORS).toContain(e.actor);
  expect(KINDS).toContain(e.kind);
  expect(REASONS).toContain(e.reason);
  expect(VERDICTS).toContain(e.judge);
  expect(VERDICTS).toContain(e.codex);
}

describe("buildReplay：余分な項目の試験", () => {
  it("トップレベル・票・イベントのキーの集合が、許可した集合に完全に一致する", () => {
    const replay = buildReplay(syntheticData());
    expect(sortedKeys(replay)).toEqual(TOP_KEYS);
    expect(replay.tickets).toHaveLength(3);
    for (const t of replay.tickets) {
      expect(sortedKeys(t)).toEqual(TICKET_KEYS);
      t.events.forEach((e, i) => expectEventShape(e, i + 1));
    }
  });

  it("合成の文字列が応答のどこにも残らない", () => {
    const json = JSON.stringify(buildReplay(syntheticData()));
    for (const s of SECRETS) expect(json, s).not.toContain(s);
  });

  it("schema・generated_at を返し、票と記録の順と件数を保ち、seq は票ごとに 1 から連続する", () => {
    const data = syntheticData();
    const replay = buildReplay(data);
    expect(replay.schema).toBe("vgdd.governance-replay.v1");
    expect(replay.generated_at).toBe(data.generated_at);
    expect(replay.tickets.map((t) => t.id)).toEqual(["T-901", "T-902", "T-903"]);
    expect(replay.tickets.map((t) => t.title)).toEqual(["合成の票その1", "合成の票その2", "合成の票その3"]);
    expect(replay.tickets.map((t) => t.status)).toEqual(["merged", "ready", "ready"]);
    expect(replay.tickets.map((t) => t.events.length)).toEqual(data.tickets.map((t) => t.timeline.length));
    expect(replay.tickets.map((t) => t.events.map((e) => e.seq))).toEqual([[1, 2, 3, 4], [1], []]);
    expect(replay.tickets[0].events.map((e) => e.ts)).toEqual(data.tickets[0].timeline.map((e) => e.ts));
    expect(replay.tickets[0].events.map((e) => e.kind)).toEqual(["returned", "resubmitted", "released", "other"]);
    expect(replay.tickets[0].events[2].judge).toBe(APPROVED);
    expect(replay.tickets[0].events[2].codex).toBe(CR);
  });
});

describe("buildReplay：実際の docs/tasks", () => {
  const replay = buildReplay(loadGovernance(process.cwd()));

  it("漏えいの試験（補助）：events の中に SHA・パス・文の形がなく、キーは7つちょうど", () => {
    expect(replay.tickets.length).toBeGreaterThan(0);
    const events = replay.tickets.map((t) => t.events);
    expect(events.flat().length).toBeGreaterThan(0);
    for (const t of replay.tickets) t.events.forEach((e, i) => expectEventShape(e, i + 1));

    const json = JSON.stringify(events);
    expect(json).not.toMatch(/[0-9a-f]{7,}/);
    expect(json).not.toContain("/");
    expect(json).not.toContain("files_allowed");
    expect(json).not.toContain("main=");
    expect(json).not.toContain("（");
  });

  it("T-014 は minor_disagreement → blocked(disagreement) → held → released の順", () => {
    const t = replay.tickets.find((x) => x.id === "T-014");
    expect(t?.events.map((e) => [e.kind, e.reason])).toEqual([
      ["minor_disagreement", null],
      ["blocked", "disagreement"],
      ["held", null],
      ["released", null],
    ]);
  });

  it("T-002・T-003 に blocked(return_limit) がある", () => {
    for (const id of ["T-002", "T-003"]) {
      const t = replay.tickets.find((x) => x.id === id);
      expect(t?.events.some((e) => e.kind === "blocked" && e.reason === "return_limit"), id).toBe(true);
    }
  });
});
