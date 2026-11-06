import { describe, expect, it } from "vitest";
import { buildGovernanceMap, type GovernanceBox } from "@/lib/governance-map";
import type { GovernanceBoard, GovernanceSummary } from "@/lib/governance";
import { pickKernelState, type KernelState } from "@/lib/kernel-state-schema";

// 票 T-026 §2 A5 の具体例（JSON の文字列のまま）
const STATE_JSON = `{"schema":"vgdd.kernel-state.v1","generated_at":"2026-11-07T00:28:57+09:00","kernel_version":"p0.4.4","policy_version":"p0.4.3","stopped":{"active":false,"since":null},"judiciary":{"status":"ok","kind":null,"since":null},"approvals":[{"task":"T-010","current":true,"approved_at":"2026-11-06T22:18:11+09:00"},{"task":"T-011","current":true,"approved_at":"2026-11-06T22:18:11+09:00"}],"held":[],"rulings":{"count":2,"tasks":["T-017","T-019"]},"annulments":{"count":16},"verdicts":{"count":128,"by_task":{"T-000":{"judge":"APPROVED","codex":"APPROVED","security":null,"at":"2026-11-03T18:08:59+09:00"},"T-001":{"judge":"APPROVED","codex":"APPROVED","security":null,"at":"2026-11-03T21:07:35+09:00"}}},"disagreements":{"count":13,"tasks":["T-001","T-003"]},"evidence":{"records":5191,"chain_ok":true,"checkpoint_mismatches":1,"checkpoint_at":"2026-11-07T00:28:53+09:00","last_record_at":"2026-11-07T00:28:43.392+09:00"},"conformance":{"passed":377,"total":377,"impl":"z3","kernel_version":"p0.4.4","at":"2026-11-06T22:15:49+09:00"}}`;
const BOARD_JSON = `{"tickets":25,"merged":25,"rejected":33,"blocked":0,"disagreements":13}`;
const SUMMARY_JSON = `{"schema":"vgdd.governance-summary.v1","generated_at":"2026-11-06T06:49:17.201+09:00","period":{"first":"2026-11-03T11:23:53.146+09:00","last":"2026-11-06T06:31:25.593+09:00"},"chain_ok":true,"records":5031,"sessions":12,"agents":4,"tool_calls":{"allow":2698,"deny":56},"deny_kinds":{"protected_path":26},"by_agent":{"(main)":{"calls":1593,"deny":30},"general-purpose":{"calls":253,"deny":5},"worker":{"calls":902,"deny":21},"constitutional-review":{"calls":6,"deny":0}}}`;

/** 具体例の JSON に項目の変更を重ねて、pickKernelState に通す（最初に非 null を確かめる） */
function makeState(overrides: Record<string, unknown> = {}): KernelState {
  const raw = { ...(JSON.parse(STATE_JSON) as Record<string, unknown>), ...overrides };
  const state = pickKernelState(raw);
  expect(state).not.toBeNull();
  return state as KernelState;
}

const board = JSON.parse(BOARD_JSON) as GovernanceBoard;

function makeSummary(): GovernanceSummary {
  return JSON.parse(SUMMARY_JSON) as GovernanceSummary;
}

/** 箱の figures から label の値を取る。label がなければ試験を落とす */
function valueOf(box: GovernanceBox, label: string): string {
  const figure = box.figures.find((f) => f.label === label);
  if (!figure) throw new Error(`label がない：${label}`);
  return figure.value;
}

describe("buildGovernanceMap", () => {
  it("①3つの入力がそろうと、5つの箱の title・role・figures が票の文と順のとおりで、value が入力から数えた値になる", () => {
    const map = buildGovernanceMap({ state: makeState(), board, summary: makeSummary() });
    expect(map).toEqual({
      citizen: {
        title: "市民（オーナー）",
        role: "目的と制約を決め、仕様を承認し、裁定し、止める",
        figures: [
          { label: "承認済みの仕様", value: "2" },
          { label: "裁定", value: "2" },
          { label: "Kernel（取得した写し）", value: "稼働中" },
        ],
      },
      legislative: {
        title: "立法（立法補佐・憲法審査）",
        role: "憲法と法律を起草し、票の受け入れ条件を書く",
        figures: [
          { label: "法律の版", value: "p0.4.4" },
          { label: "憲法審査の呼び出し", value: "6" },
        ],
      },
      executive: {
        title: "行政（行政の長・作業員）",
        role: "票を読んで作業員を起こし、隔離した作業場所で実装する。自分では統合できない",
        figures: [
          { label: "行政の長の操作", value: "1593" },
          { label: "作業員の操作", value: "902" },
          { label: "補助のエージェントの操作", value: "253" },
        ],
      },
      judiciary: {
        title: "司法（judge・Codex）",
        role: "差分と受け入れ条件だけを見て、2つの系統で判定する。ツールを持たない",
        figures: [
          { label: "判定した票の数", value: "2" },
          { label: "judge と Codex が分かれた票の数", value: "2" },
        ],
      },
      kernel: {
        title: "Kernel（裁判所・フック・証拠ストア）",
        role: "成立した規則を、権限・停止・統合・証跡として実行時に強制する。自分で合否を判断しない",
        figures: [
          { label: "票の数", value: "25" },
          { label: "統合の出来事の数", value: "25" },
          { label: "held の票の数", value: "0" },
          { label: "拒否した操作の数", value: "56" },
          { label: "証拠の記録の数", value: "5191" },
        ],
      },
    });
  });

  it("①の補足：承認済みの仕様は current が true のものだけを数える", () => {
    const state = makeState({
      approvals: [
        { task: "T-010", current: true, approved_at: "2026-11-06T22:18:11+09:00" },
        { task: "T-011", current: false, approved_at: "2026-11-06T22:18:11+09:00" },
      ],
    });
    const map = buildGovernanceMap({ state, board, summary: makeSummary() });
    expect(valueOf(map.citizen, "承認済みの仕様")).toBe("1");
  });

  it("②state が null だと state から取る数は「—」で、board・summary から取れる数は出る", () => {
    const map = buildGovernanceMap({ state: null, board, summary: makeSummary() });
    expect(valueOf(map.citizen, "承認済みの仕様")).toBe("—");
    expect(valueOf(map.citizen, "裁定")).toBe("—");
    expect(valueOf(map.citizen, "Kernel（取得した写し）")).toBe("確認できない");
    expect(valueOf(map.legislative, "法律の版")).toBe("—");
    expect(valueOf(map.judiciary, "判定した票の数")).toBe("—");
    expect(valueOf(map.judiciary, "judge と Codex が分かれた票の数")).toBe("—");
    expect(valueOf(map.kernel, "held の票の数")).toBe("—");
    expect(valueOf(map.kernel, "証拠の記録の数")).toBe("—");

    expect(valueOf(map.legislative, "憲法審査の呼び出し")).toBe("6");
    expect(valueOf(map.executive, "行政の長の操作")).toBe("1593");
    expect(valueOf(map.executive, "作業員の操作")).toBe("902");
    expect(valueOf(map.executive, "補助のエージェントの操作")).toBe("253");
    expect(valueOf(map.kernel, "票の数")).toBe("25");
    expect(valueOf(map.kernel, "統合の出来事の数")).toBe("25");
    expect(valueOf(map.kernel, "拒否した操作の数")).toBe("56");
  });

  it("③summary.by_agent に worker がないと「作業員の操作」だけ「—」になる", () => {
    const summary = makeSummary();
    delete summary.by_agent.worker;
    const map = buildGovernanceMap({ state: makeState(), board, summary });
    expect(valueOf(map.executive, "作業員の操作")).toBe("—");
    expect(valueOf(map.executive, "行政の長の操作")).toBe("1593");
    expect(valueOf(map.executive, "補助のエージェントの操作")).toBe("253");
    expect(valueOf(map.legislative, "憲法審査の呼び出し")).toBe("6");
  });

  it("④stopped.active が true なら「停止中」、state が null なら「確認できない」", () => {
    const stopped = makeState({ stopped: { active: true, since: "2026-11-07T00:20:00+09:00" } });
    const whenStopped = buildGovernanceMap({ state: stopped, board, summary: makeSummary() });
    expect(valueOf(whenStopped.citizen, "Kernel（取得した写し）")).toBe("停止中");

    const whenNull = buildGovernanceMap({ state: null, board, summary: makeSummary() });
    expect(valueOf(whenNull.citizen, "Kernel（取得した写し）")).toBe("確認できない");
  });

  it("⑤kernel_version が null なら「法律の版」が「—」になる", () => {
    const map = buildGovernanceMap({ state: makeState({ kernel_version: null }), board, summary: makeSummary() });
    expect(valueOf(map.legislative, "法律の版")).toBe("—");
  });

  it("⑥by_task が空の Map・held が 0 件でも数は「0」で「—」にならない", () => {
    const state = makeState({ verdicts: { count: 0, by_task: {} }, held: [] });
    expect(state.verdicts.by_task.size).toBe(0);
    const map = buildGovernanceMap({ state, board, summary: makeSummary() });
    expect(valueOf(map.judiciary, "判定した票の数")).toBe("0");
    expect(valueOf(map.kernel, "held の票の数")).toBe("0");
  });

  it("⑦3つの入力がすべて null でも例外にならず、数はすべて「—」になる", () => {
    const map = buildGovernanceMap({ state: null, board: null, summary: null });
    const { citizen, legislative, executive, judiciary, kernel } = map;
    for (const box of [citizen, legislative, executive, judiciary, kernel]) {
      for (const figure of box.figures) {
        const expected = figure.label === "Kernel（取得した写し）" ? "確認できない" : "—";
        expect(figure.value).toBe(expected);
      }
    }
  });
});
