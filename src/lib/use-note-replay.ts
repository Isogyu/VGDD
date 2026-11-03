// T-003 で実装。整理の待ち時間に、左のメモを上から順に強調する演出のためのフック。
// 強調中のメモ番号（1始まりの #番号）を返す。強調しないときは null。
// 関数名・引数・返り値の型は T-000 の差し込み口のまま（SessionView が前提にしている）。

import { useEffect, useState } from "react";

/** 強調を次のメモへ進める間隔（ミリ秒） */
export const REPLAY_INTERVAL_MS = 800;

/**
 * 次に強調するメモ番号を返す純粋関数。
 * - count が 0 以下なら null
 * - current が null なら 1（先頭から）
 * - current が count 未満なら current + 1
 * - current が count 以上なら 1（末尾で先頭に戻る）
 */
export function nextReplayIndex(current: number | null, count: number): number | null {
  if (count <= 0) return null;
  if (current === null) return 1;
  if (current < count) return current + 1;
  return 1;
}

/** 動きを減らす設定（prefers-reduced-motion: reduce）か。matchMedia がない環境では false（動かす） */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** フックが持つ状態。running は前回の描画での「動かすか」、index は強調中の番号（null は未着手＝先頭） */
export interface ReplayState {
  running: boolean;
  index: number | null;
}

/**
 * 描画のたびに呼ぶ純粋関数。running（active && count > 0）が前回から変わっていたら
 * index を null に戻して running を更新する。変わっていなければ同じオブジェクトをそのまま返す。
 * active のまま count が 0 になって戻ったときも、ここで先頭からやり直しになる（OBS-021）。
 */
export function reduceReplayOnRender(state: ReplayState, count: number, active: boolean): ReplayState {
  const running = active && count > 0;
  if (state.running === running) return state;
  return { running, index: null };
}

/**
 * 表示する番号を返す純粋関数。
 * - running でなければ null
 * - index が null なら 1
 * - index が count を超えていれば（メモが減ったとき）1
 */
export function displayIndex(state: ReplayState, count: number): number | null {
  if (!state.running) return null;
  const current = state.index ?? 1;
  return current > count ? 1 : current;
}

export function useNoteReplay(count: number, active: boolean): number | null {
  const [state, setState] = useState<ReplayState>(() => ({ running: active && count > 0, index: null }));
  // running が切り替わったら、描画中に index を捨てる（effect 内の同期的な setState を避ける React の推奨形）
  const next = reduceReplayOnRender(state, count, active);
  if (next !== state) {
    setState(next);
  }

  const running = next.running;

  useEffect(() => {
    if (!running) return;
    // 動きを減らす設定なら interval を作らず、1 のまま動かさない
    if (prefersReducedMotion()) return;
    const id = setInterval(() => {
      // 表示中の番号（null は 1）から次へ進める
      setState((s) => ({ ...s, index: nextReplayIndex(s.index ?? 1, count) }));
    }, REPLAY_INTERVAL_MS);
    // active が false になる・count が変わる・unmount するときに必ず止める
    return () => clearInterval(id);
  }, [running, count]);

  return displayIndex(next, count);
}
