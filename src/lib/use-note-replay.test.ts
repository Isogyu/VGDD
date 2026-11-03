import { describe, expect, it } from "vitest";
import {
  displayIndex,
  nextReplayIndex,
  reduceReplayOnRender,
  REPLAY_INTERVAL_MS,
  type ReplayState,
} from "./use-note-replay";

// フックの描画を純粋関数で模す：描画（reduceReplayOnRender → displayIndex）と tick（interval の更新）
function render(state: ReplayState, count: number, active: boolean): [ReplayState, number | null] {
  const next = reduceReplayOnRender(state, count, active);
  return [next, displayIndex(next, count)];
}
function tick(state: ReplayState, count: number): ReplayState {
  return { ...state, index: nextReplayIndex(state.index ?? 1, count) };
}

describe("強調位置の初期化（T-003・OBS-021）", () => {
  it("active のまま count 3 → 0 → 3 で、再開直後が 1", () => {
    let s: ReplayState = { running: false, index: null };
    let shown: number | null;
    [s, shown] = render(s, 3, true);
    expect(shown).toBe(1);
    s = tick(s, 3);
    s = tick(s, 3);
    [s, shown] = render(s, 3, true);
    expect(shown).toBe(3);
    [s, shown] = render(s, 0, true);
    expect(shown).toBeNull();
    [s, shown] = render(s, 3, true);
    expect(shown).toBe(1);
  });

  it("active が true → false → true でも再開直後が 1", () => {
    let s: ReplayState = { running: false, index: null };
    let shown: number | null;
    [s, shown] = render(s, 3, true);
    expect(shown).toBe(1);
    s = tick(s, 3);
    [s, shown] = render(s, 3, true);
    expect(shown).toBe(2);
    [s, shown] = render(s, 3, false);
    expect(shown).toBeNull();
    [s, shown] = render(s, 3, true);
    expect(shown).toBe(1);
  });

  it("running が変わらなければ同じ状態を返す（描画中の setState が繰り返されない）", () => {
    const s: ReplayState = { running: true, index: 2 };
    expect(reduceReplayOnRender(s, 3, true)).toBe(s);
    expect(reduceReplayOnRender(s, 5, true)).toBe(s);
  });

  it("displayIndex：running でなければ null、index が count を超えたら 1", () => {
    expect(displayIndex({ running: false, index: 2 }, 3)).toBeNull();
    expect(displayIndex({ running: true, index: null }, 3)).toBe(1);
    expect(displayIndex({ running: true, index: 5 }, 3)).toBe(1);
  });
});

describe("整理の待ち時間のメモ振り返り（T-003）", () => {
  it("count が 0 以下なら null", () => {
    expect(nextReplayIndex(null, 0)).toBeNull();
    expect(nextReplayIndex(2, 0)).toBeNull();
    expect(nextReplayIndex(1, -1)).toBeNull();
  });

  it("current が null なら 1 から始める", () => {
    expect(nextReplayIndex(null, 5)).toBe(1);
    expect(nextReplayIndex(null, 1)).toBe(1);
  });

  it("途中なら次の番号へ進む", () => {
    expect(nextReplayIndex(1, 5)).toBe(2);
    expect(nextReplayIndex(4, 5)).toBe(5);
  });

  it("末尾で先頭に戻る", () => {
    expect(nextReplayIndex(5, 5)).toBe(1);
    expect(nextReplayIndex(1, 1)).toBe(1);
    // メモが減って current が count を超えたときも先頭へ
    expect(nextReplayIndex(7, 3)).toBe(1);
  });

  it("1 から順に回すと 1→2→3→1 と巡回する", () => {
    const seen: (number | null)[] = [];
    let cur: number | null = null;
    for (let i = 0; i < 5; i++) {
      cur = nextReplayIndex(cur, 3);
      seen.push(cur);
    }
    expect(seen).toEqual([1, 2, 3, 1, 2]);
  });

  it("強調を進める間隔は 800 ミリ秒", () => {
    expect(REPLAY_INTERVAL_MS).toBe(800);
  });
});
