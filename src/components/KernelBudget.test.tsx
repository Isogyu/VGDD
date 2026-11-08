// 「予算と実行（台帳の集計）」の部品（KernelBudget）の静的な markup の試験。T-045 A5。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import KernelBudget, { FIXED_NOTE } from "./KernelBudget";
import { formatJst, pickKernelState, type KernelState } from "@/lib/kernel-state-schema";

const SNAPSHOT_PATH = fileURLToPath(
  new URL("../../docs/governance/snapshots/submission/kernel-state.json", import.meta.url),
);

function loadSnapshotJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Record<string, unknown>;
}

function stateOf(json: unknown): KernelState {
  const s = pickKernelState(json);
  if (s === null) throw new Error("fixture が検証を通らない");
  return s;
}

const ids = (n: number) => Array.from({ length: n }, (_, i) => `T-${String(i + 100).padStart(3, "0")}`);

const BUDGET = {
  period_id: "freeze-20261108",
  until: "2026-11-08T14:00:00+09:00",
  tokens: { settled: 20_000_000, reserved: 4_000_000, unknown_runs: 2, limit: 30_000_000 },
  judge_calls: { used: 10, limit: 10 },
  attempts: { used: 3, limit: 10 },
  workers: { active: 1, limit: null },
};
const RUNS = {
  requested: 12,
  reserved: 11,
  started: 10,
  exited: 9,
  settled: 8,
  cancelled: 1,
  liveness_unknown: 1,
  usage_unknown: 2,
};
const ACCEPTANCE = { accepted_count: 5, pending_count: 30, accepted: ids(5), pending: ids(25) };

function render(extra: Record<string, unknown>): string {
  return renderToStaticMarkup(<KernelBudget state={stateOf({ ...loadSnapshotJson(), ...extra })} />);
}

describe("KernelBudget", () => {
  it("3項目のない今の写しでは、3つの「写しにない」と固定の注記だけで、件数を出さない", () => {
    const json = loadSnapshotJson();
    expect(json.budget).toBeUndefined();
    expect(json.runs).toBeUndefined();
    expect(json.acceptance).toBeUndefined();
    const html = renderToStaticMarkup(<KernelBudget state={stateOf(json)} />);
    expect(html).toContain("予算と実行（台帳の集計）");
    expect(html).toContain("この写しには予算の集計がない");
    expect(html).toContain("この写しには実行の状態がない");
    expect(html).toContain("この写しには受け入れの記録がない");
    expect(html).toContain(FIXED_NOTE);
    // 項目がないとき、数字を一切出さない（0 を作り足さない）
    // （class の「gap-3」などを除くため、タグを外した文字だけを見る）
    expect(html.replace(/<[^>]*>/g, "")).not.toMatch(/\d/);
    expect(html).not.toContain("<table");
  });

  it("合成の3項目で、数・上限の注記・照合の注記・待ちの票の 20 件・ほか K 件を出す", () => {
    const html = render({ budget: BUDGET, runs: RUNS, acceptance: ACCEPTANCE });
    // 予算：24,000,000 / 30,000,000 = 80% → 近い。司法 10/10 = 100% → 達した
    expect(html).toContain("24,000,000 ／ 30,000,000（80%）（上限に近い）");
    expect(html).toContain("10 ／ 10（100%）（上限に達した）");
    expect(html).toContain("3 ／ 10（30%）");
    expect(html).not.toContain("3 ／ 10（30%）（");
    expect(html).toContain("1（上限なし）");
    expect(html).not.toContain("1（上限なし）（");
    // 表と caption
    expect(html).toContain("<caption");
    expect(html).toContain("予算の使用");
    expect(html).toContain("実行の状態");
    // 実行の状態
    expect(html).toContain("12 件");
    expect(html).toContain("生死が不明");
    expect(html).toContain("1 件（オーナーの照合が要る）");
    expect(html).toContain("2 件（オーナーの照合が要る）");
    expect(html.match(/（オーナーの照合が要る）/g)).toHaveLength(2);
    // 受け入れ
    expect(html).toContain("受け入れ済み 5 件・受け入れ待ち 30 件");
    for (const id of ids(20)) expect(html).toContain(`>${id}<`);
    for (const id of ids(25).slice(20)) expect(html).not.toContain(`>${id}<`);
    expect(html).toContain("ほか 10 件");
    // 不明の注記
    expect(html).toContain("利用量を読めなかった実行 2 件は、予約の全量を使ったものとして数えている");
    expect(html).toContain(FIXED_NOTE);
    expect(html).not.toContain("写しにない");
  });

  it("ちょうど 100% の行には「上限に達した」だけを出し「上限に近い」を出さない", () => {
    const html = render({
      budget: { ...BUDGET, tokens: { settled: 50, reserved: 50, unknown_runs: 0, limit: 100 }, judge_calls: { used: 1, limit: 10 } },
    });
    expect(html).toContain("100 ／ 100（100%）（上限に達した）");
    expect(html).not.toContain("上限に近い");
  });

  it("until が null なら「終わりの指定なし」、日時なら「X まで」", () => {
    const withNull = render({ budget: { ...BUDGET, until: null } });
    expect(withNull).toContain("終わりの指定なし");
    expect(withNull).not.toContain("まで");
    const withDate = render({ budget: BUDGET });
    expect(withDate).toContain(`${formatJst(BUDGET.until)} まで`);
    expect(withDate).not.toContain("終わりの指定なし");
  });

  it("unknown_runs が 0 なら不明の注記を出さない", () => {
    const html = render({ budget: { ...BUDGET, tokens: { ...BUDGET.tokens, unknown_runs: 0 } } });
    expect(html).not.toContain("利用量を読めなかった実行");
  });

  it("period_id がパスの形なら、その文字列を画面に出さない", () => {
    const html = render({ budget: { ...BUDGET, period_id: "/Users/foo" } });
    expect(html).not.toContain("/Users/foo");
    expect(html).toContain("（表示しない形の期間名）");
  });

  it("3項目のうち1つだけがあれば、ほかの2つに「写しにない」を出す", () => {
    const onlyRuns = render({ runs: RUNS });
    expect(onlyRuns).toContain("この写しには予算の集計がない");
    expect(onlyRuns).not.toContain("この写しには実行の状態がない");
    expect(onlyRuns).toContain("この写しには受け入れの記録がない");

    const onlyAcceptance = render({ acceptance: ACCEPTANCE });
    expect(onlyAcceptance).toContain("この写しには予算の集計がない");
    expect(onlyAcceptance).toContain("この写しには実行の状態がない");
    expect(onlyAcceptance).not.toContain("この写しには受け入れの記録がない");

    const onlyBudget = render({ budget: BUDGET });
    expect(onlyBudget).not.toContain("この写しには予算の集計がない");
    expect(onlyBudget).toContain("この写しには実行の状態がない");
    expect(onlyBudget).toContain("この写しには受け入れの記録がない");
  });

  it("固定の注記の文", () => {
    expect(FIXED_NOTE).toBe(
      "契約の利用枠（サブスクリプション）の残りは読めない。推定費用は出さない。数えるのは Kernel の窓口を通った呼び出しだけで、行政の長・立法補佐・オーナーのメインの会話は含まない",
    );
  });
});
