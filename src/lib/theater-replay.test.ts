import { afterEach, describe, expect, it, vi } from "vitest";
import {
  elapsedLabel,
  FEATURED_TICKETS,
  formatJst,
  INITIAL_REPLAY,
  intervalMs,
  labelFor,
  pickFeatured,
  replayReducer,
  marksLabel,
  REPLAY_FILTERS,
  replayOptions,
  ticketMarks,
  ticketSignature,
  toneFor,
  verdictLabels,
  type ReplayState,
} from "./theater-replay";

describe("labelFor", () => {
  it.each([
    ["returned", "scope", "許された範囲の外のファイルの変更として差し戻された"],
    ["returned", "rebase", "最新の main を含まないとして差し戻された"],
    ["returned", "security", "セキュリティ審査で差し戻された"],
    ["returned", "judiciary", "司法の2系統がともに差し戻した"],
    ["returned", "other", "差し戻された"],
    ["blocked", "disagreement", "司法の2系統が重大な指摘で分かれたため止めた。人の裁定へ"],
    ["blocked", "return_limit", "差し戻しが3回に達したとの記録で止めた。人の判断へ"],
    ["blocked", "spec_unapproved", "仕様が人に承認されていないため止めた"],
    ["blocked", "other", "止めた（理由は記録の分類の外）"],
    ["held", null, "合格。夜間のため統合を保留し、人の承認を待つ"],
    ["merged", null, "統合した（裁判所）"],
    ["released", null, "統合した（人が承認）"],
    ["ruling", null, "人が裁定した"],
    ["minor_disagreement", null, "司法が軽微な指摘で分かれた。厳しい側の指摘を残して進めた"],
    ["resubmitted", null, "作業員の実装を前検査で確認し、申請し直した"],
    ["other", null, "記録の分類の外の出来事"],
  ])("%s / %s の文", (kind, reason, label) => {
    expect(labelFor({ kind, reason })).toBe(label);
  });

  it.each([
    ["held", "scope"],
    ["merged", "other"],
    ["other", "other"],
    ["returned", null],
    ["returned", "disagreement"],
    ["blocked", null],
    ["blocked", "scope"],
    ["未知", null],
    ["constructor", null],
  ])("表にない組み合わせ %s / %s は分類の外", (kind, reason) => {
    expect(labelFor({ kind, reason })).toBe("記録の分類の外の出来事");
  });
});

describe("toneFor", () => {
  it.each([
    ["blocked", "disagreement", "waiting"],
    ["blocked", "return_limit", "waiting"],
    ["blocked", "spec_unapproved", "waiting"],
    ["held", null, "waiting"],
    ["ruling", null, "human"],
    ["released", null, "human"],
    ["merged", null, "merged"],
    ["blocked", "other", "unknown"],
    ["returned", "scope", "normal"],
    ["returned", "rebase", "normal"],
    ["returned", "security", "normal"],
    ["returned", "judiciary", "normal"],
    ["returned", "other", "normal"],
    ["minor_disagreement", null, "normal"],
    ["resubmitted", null, "normal"],
    // 表にある行で、blocked（other）でもないので normal（A2 の「それ以外」）
    ["other", null, "normal"],
  ])("%s / %s は %s", (kind, reason, tone) => {
    expect(toneFor({ kind, reason })).toBe(tone);
  });

  it.each([
    ["held", "scope"],
    ["merged", "other"],
    ["ruling", "other"],
    ["released", "scope"],
    ["other", "other"],
    ["minor_disagreement", "scope"],
    ["resubmitted", "scope"],
    ["returned", null],
    ["blocked", null],
    ["blocked", "scope"],
    ["未知", null],
  ])("表にない組み合わせ %s / %s は unknown", (kind, reason) => {
    expect(toneFor({ kind, reason })).toBe("unknown");
  });
});

describe("formatJst", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("+0900 の入力をそのままの壁時計で出す", () => {
    expect(formatJst("2026-11-06T01:07:36+0900")).toBe("11/06 01:07");
  });

  it("UTC で日付をまたぐ入力を Asia/Tokyo にする", () => {
    expect(formatJst("2026-11-05T16:30:00+0000")).toBe("11/06 01:30");
  });

  it("負の時差と、年をまたぐ入力も Asia/Tokyo にする", () => {
    expect(formatJst("2026-12-31T20:15:00-0500")).toBe("01/01 10:15");
  });

  it("実行環境のタイムゾーンによらない", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(formatJst("2026-11-05T16:30:00+0000")).toBe("11/06 01:30");
  });

  it.each([
    "",
    "読めない",
    "2026-11-06",
    "2026-11-06T01:07:36",
    "2026-11-06T01:07:36Z",
    "2026-11-06T01:07:36+09:00",
    "2026-11-06T01:07:36+0900\n",
    "2026-02-31T01:07:36+0900",
    "2026-13-01T01:07:36+0900",
    "2026-11-06T24:00:00+0900",
    "2026-11-06T01:60:00+0900",
    "2026-11-06T01:07:36+2400",
    "2026-11-06T01:07:36+0960",
  ])("読めない入力 %j は決まった文を返す", (ts) => {
    expect(formatJst(ts)).toBe("時刻を確認できません");
  });

  it("文字列でない入力でも例外を出さない", () => {
    expect(formatJst(null as unknown as string)).toBe("時刻を確認できません");
  });
});

describe("elapsedLabel", () => {
  const first = "2026-11-06T01:00:00+0900";

  it("秒を切り捨てる（59 分 59 秒 → 0 時間 59 分）", () => {
    expect(elapsedLabel(first, "2026-11-06T01:59:59+0900")).toBe("実際の経過：最初の出来事から 0 時間 59 分");
  });

  it("61 分 → 1 時間 1 分", () => {
    expect(elapsedLabel(first, "2026-11-06T02:01:00+0900")).toBe("実際の経過：最初の出来事から 1 時間 1 分");
  });

  it("差が0なら 0 時間 0 分", () => {
    expect(elapsedLabel(first, first)).toBe("実際の経過：最初の出来事から 0 時間 0 分");
  });

  it("時差の違う入力でも実際の差を出す", () => {
    expect(elapsedLabel(first, "2026-11-05T16:30:00+0000")).toBe("実際の経過：最初の出来事から 0 時間 30 分");
  });

  it("24 時間を超えても時間で数える", () => {
    expect(elapsedLabel(first, "2026-11-07T03:05:00+0900")).toBe("実際の経過：最初の出来事から 26 時間 5 分");
  });

  it("どちらかが null なら —", () => {
    expect(elapsedLabel(null, first)).toBe("実際の経過：—");
    expect(elapsedLabel(first, null)).toBe("実際の経過：—");
    expect(elapsedLabel(null, null)).toBe("実際の経過：—");
    expect(elapsedLabel("読めない", null)).toBe("実際の経過：—");
  });

  it("読めない入力は決まった文を返す", () => {
    expect(elapsedLabel("読めない", first)).toBe("時刻を確認できません");
    expect(elapsedLabel(first, "読めない")).toBe("時刻を確認できません");
  });

  it("差が負なら決まった文を返す", () => {
    expect(elapsedLabel(first, "2026-11-06T00:59:59+0900")).toBe("時刻を確認できません");
  });
});

describe("replayReducer", () => {
  const at = (index: number, playing = false, speed: ReplayState["speed"] = 1): ReplayState => ({
    index,
    playing,
    speed,
  });

  it("初期状態", () => {
    expect(INITIAL_REPLAY).toEqual({ index: -1, playing: false, speed: 1 });
  });

  describe("play", () => {
    it("index を変えずに再生中にする", () => {
      expect(replayReducer(at(-1), { type: "play", count: 3 })).toEqual(at(-1, true));
      expect(replayReducer(at(1), { type: "play", count: 3 })).toEqual(at(1, true));
    });

    it("最後の出来事では何も変えない", () => {
      const state = at(2);
      expect(replayReducer(state, { type: "play", count: 3 })).toBe(state);
    });

    it("すでに再生中なら同じ状態のまま（タイマーを数え直さない）", () => {
      const state = at(0, true);
      expect(replayReducer(state, { type: "play", count: 3 })).toBe(state);
    });
  });

  describe("tick", () => {
    it("再生中は1つ進む（-1 からは 0 へ）", () => {
      expect(replayReducer(at(-1, true), { type: "tick", count: 3 })).toEqual(at(0, true));
      expect(replayReducer(at(0, true), { type: "tick", count: 3 })).toEqual(at(1, true));
    });

    it("最後の出来事に達したら止まる", () => {
      expect(replayReducer(at(1, true), { type: "tick", count: 3 })).toEqual(at(2, false));
      expect(replayReducer(at(-1, true), { type: "tick", count: 1 })).toEqual(at(0, false));
    });

    it("停止中は何も変えない", () => {
      const state = at(1);
      expect(replayReducer(state, { type: "tick", count: 3 })).toBe(state);
    });
  });

  it("pause は再生中を止め、index を変えない", () => {
    expect(replayReducer(at(1, true), { type: "pause", count: 3 })).toEqual(at(1, false));
  });

  describe("next・prev", () => {
    it("再生を止めて1つ動く", () => {
      expect(replayReducer(at(0, true), { type: "next", count: 3 })).toEqual(at(1, false));
      expect(replayReducer(at(2, true), { type: "prev", count: 3 })).toEqual(at(1, false));
    });

    it("最後より先、-1 より前には動かない", () => {
      expect(replayReducer(at(2), { type: "next", count: 3 })).toEqual(at(2));
      expect(replayReducer(at(-1), { type: "prev", count: 3 })).toEqual(at(-1));
      expect(replayReducer(at(0), { type: "prev", count: 3 })).toEqual(at(-1));
    });

    it("端にいても再生は止める", () => {
      expect(replayReducer(at(-1, true), { type: "prev", count: 3 })).toEqual(at(-1, false));
    });
  });

  it("reset は速さを保って最初に戻す", () => {
    expect(replayReducer(at(2, true, 2), { type: "reset", count: 3 })).toEqual(at(-1, false, 2));
  });

  describe("setSpeed", () => {
    it("速さだけを変える", () => {
      expect(replayReducer(at(1, true), { type: "setSpeed", speed: 0.5, count: 3 })).toEqual(at(1, true, 0.5));
      expect(replayReducer(at(1), { type: "setSpeed", speed: 2, count: 3 })).toEqual(at(1, false, 2));
    });

    it("同じ速さなら同じ状態のまま（タイマーを数え直さない）", () => {
      const state = at(1, true);
      expect(replayReducer(state, { type: "setSpeed", speed: 1, count: 3 })).toBe(state);
    });

    it("決められた値でなければ変えない", () => {
      const state = at(1);
      expect(replayReducer(state, { type: "setSpeed", speed: 3 as unknown as 1, count: 3 })).toBe(state);
    });
  });

  describe("出来事が0件", () => {
    it.each(["play", "tick", "pause", "next", "prev", "reset"] as const)("%s は位置と再生中を初期に戻す", (type) => {
      expect(replayReducer(at(2, true, 2), { type, count: 0 })).toEqual(at(-1, false, 2));
    });

    it("setSpeed も位置と再生中を初期に戻し、速さは指定に従う", () => {
      expect(replayReducer(at(2, true), { type: "setSpeed", speed: 2, count: 0 })).toEqual(at(-1, false, 2));
    });

    it("play で再生中にならない", () => {
      expect(replayReducer(INITIAL_REPLAY, { type: "play", count: 0 })).toBe(INITIAL_REPLAY);
    });
  });
});

describe("intervalMs", () => {
  it("1倍で 1500、0.5倍で 3000、2倍で 750", () => {
    expect(intervalMs(1)).toBe(1500);
    expect(intervalMs(0.5)).toBe(3000);
    expect(intervalMs(2)).toBe(750);
  });
});

describe("FEATURED_TICKETS・pickFeatured", () => {
  it("例の票の順", () => {
    expect(FEATURED_TICKETS).toEqual(["T-014", "T-026", "T-013"]);
  });

  it("入力にある票を、入力の順でなく FEATURED_TICKETS の順で返す", () => {
    const picked = pickFeatured([{ id: "T-002" }, { id: "T-013" }, { id: "T-014" }]);
    expect(picked.map((ticket) => ticket.id)).toEqual(["T-014", "T-013"]);
  });

  it("どれもなければ空", () => {
    expect(pickFeatured([{ id: "T-002" }])).toEqual([]);
  });
});

describe("ticketSignature", () => {
  const ticket = (id: string, seqs: number[]) => ({ id, events: seqs.map((seq) => ({ seq })) });

  it("同じ票・同じ seq の並びなら同じ", () => {
    expect(ticketSignature(ticket("T-014", [1, 2]))).toBe(ticketSignature(ticket("T-014", [1, 2])));
  });

  it("票、出来事の数、seq の並びのどれかが変われば変わる", () => {
    const base = ticketSignature(ticket("T-014", [1, 2]));
    expect(ticketSignature(ticket("T-026", [1, 2]))).not.toBe(base);
    expect(ticketSignature(ticket("T-014", [1, 2, 3]))).not.toBe(base);
    expect(ticketSignature(ticket("T-014", [2, 1]))).not.toBe(base);
  });

  it("票がなければ空", () => {
    expect(ticketSignature(null)).toBe("");
  });
});

describe("verdictLabels", () => {
  it("結論を日本語にする", () => {
    expect(verdictLabels({ judge: "APPROVED", codex: "CHANGES_REQUIRED" })).toEqual([
      "Claude：合格",
      "Codex：差し戻し",
    ]);
    expect(verdictLabels({ judge: "CHANGES_REQUIRED", codex: "APPROVED" })).toEqual([
      "Claude：差し戻し",
      "Codex：合格",
    ]);
  });

  it("null の系統は出さない", () => {
    expect(verdictLabels({ judge: null, codex: "APPROVED" })).toEqual(["Codex：合格"]);
    expect(verdictLabels({ judge: "APPROVED", codex: null })).toEqual(["Claude：合格"]);
    expect(verdictLabels({ judge: null, codex: null })).toEqual([]);
  });
});

// T-040 A1・A4：合成の票だけを使う
type MarkEvent = { kind: string; reason: string | null };
const ev = (kind: string, reason: string | null = null): MarkEvent => ({ kind, reason });
const synth = (id: string, events: MarkEvent[]) => ({ id, title: `架空の題 ${id}`, events });

describe("ticketMarks", () => {
  it("出来事がなければすべて 0", () => {
    expect(ticketMarks(synth("T-100", []))).toEqual({ returned: 0, disagreement: 0, ruling: 0 });
  });

  it("returned はどの reason でも差し戻しに数える", () => {
    const marks = ticketMarks(
      synth("T-100", [ev("returned", "scope"), ev("returned", "rebase"), ev("returned", "security"), ev("returned", "other")]),
    );
    expect(marks).toEqual({ returned: 4, disagreement: 0, ruling: 0 });
  });

  it("不一致は minor_disagreement と、blocked で reason が disagreement のものの合計", () => {
    const marks = ticketMarks(
      synth("T-100", [ev("minor_disagreement"), ev("blocked", "disagreement"), ev("blocked", "disagreement")]),
    );
    expect(marks).toEqual({ returned: 0, disagreement: 3, ruling: 0 });
  });

  it("blocked で reason が disagreement 以外は数えない", () => {
    const marks = ticketMarks(
      synth("T-100", [
        ev("blocked", "return_limit"),
        ev("blocked", "spec_unapproved"),
        ev("blocked", "other"),
        ev("blocked", null),
      ]),
    );
    expect(marks).toEqual({ returned: 0, disagreement: 0, ruling: 0 });
  });

  it("ruling だけを裁定に数え、released・held・merged・resubmitted・other は数えない", () => {
    const marks = ticketMarks(
      synth("T-100", [
        ev("ruling"),
        ev("released"),
        ev("held"),
        ev("merged"),
        ev("resubmitted"),
        ev("other"),
        ev("ruling"),
      ]),
    );
    expect(marks).toEqual({ returned: 0, disagreement: 0, ruling: 2 });
  });

  it("後の出来事で引かない（差し戻しの後に統合しても数は残る）", () => {
    const marks = ticketMarks(synth("T-100", [ev("returned", "scope"), ev("resubmitted"), ev("merged")]));
    expect(marks.returned).toBe(1);
  });
});

describe("REPLAY_FILTERS", () => {
  it("決まった4つを決まった順で", () => {
    expect(REPLAY_FILTERS).toEqual([
      { value: "all", label: "すべて" },
      { value: "disagreement", label: "不一致あり" },
      { value: "ruling", label: "裁定あり" },
      { value: "returned", label: "差し戻しあり" },
    ]);
  });
});

describe("replayOptions", () => {
  const input = [
    synth("T-030", [ev("held")]),
    synth("T-013", [ev("returned", "scope")]),
    synth("T-002", [ev("returned", "security"), ev("ruling")]),
    synth("T-050", []),
    synth("T-014", [ev("blocked", "disagreement"), ev("ruling")]),
    synth("T-026", []),
    synth("T-010", [ev("minor_disagreement")]),
  ];
  const ids = (list: { id: string }[]) => list.map((ticket) => ticket.id);

  it("出来事のない票を除き、代表の票を FEATURED_TICKETS の順で先頭に、残りを ID の昇順で並べる", () => {
    expect(ids(replayOptions(input, "all"))).toEqual(["T-014", "T-013", "T-002", "T-010", "T-030"]);
  });

  it("代表の票を2回入れない", () => {
    const list = ids(replayOptions(input, "all"));
    expect(new Set(list).size).toBe(list.length);
  });

  it("出来事のない代表の票（T-026）は先頭に入れない", () => {
    expect(ids(replayOptions(input, "all"))).not.toContain("T-026");
  });

  it("残りは文字列の昇順（入力の順に依らない）", () => {
    const reversed = [...input].reverse();
    expect(ids(replayOptions(reversed, "all"))).toEqual(["T-014", "T-013", "T-002", "T-010", "T-030"]);
  });

  it("同じ id の票は1回だけ", () => {
    const list = ids(replayOptions([synth("T-002", [ev("held")]), synth("T-002", [ev("merged")])], "all"));
    expect(list).toEqual(["T-002"]);
  });

  it.each([
    ["disagreement", ["T-014", "T-010"]],
    ["ruling", ["T-014", "T-002"]],
    ["returned", ["T-013", "T-002"]],
  ] as const)("%s で絞ると、その印が 1 以上の票だけを同じ順で残す", (filter, expected) => {
    expect(ids(replayOptions(input, filter))).toEqual(expected);
  });

  it("合う票がなければ空", () => {
    expect(replayOptions([synth("T-030", [ev("held")])], "ruling")).toEqual([]);
    expect(replayOptions([], "all")).toEqual([]);
  });

  it("入力の値をそのまま返す（作り直さない）", () => {
    expect(replayOptions(input, "all")[0]).toBe(input[4]);
  });
});

describe("marksLabel", () => {
  it("0 でない印だけを、差し戻し・不一致・裁定の順に「・」でつなぐ", () => {
    expect(marksLabel({ returned: 3, disagreement: 2, ruling: 1 })).toBe("差し戻し 3・不一致 2・裁定 1");
    expect(marksLabel({ returned: 0, disagreement: 2, ruling: 1 })).toBe("不一致 2・裁定 1");
    expect(marksLabel({ returned: 1, disagreement: 0, ruling: 0 })).toBe("差し戻し 1");
  });

  it("すべて 0 なら空の文字列", () => {
    expect(marksLabel({ returned: 0, disagreement: 0, ruling: 0 })).toBe("");
  });
});
