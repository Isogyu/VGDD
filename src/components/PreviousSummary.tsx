"use client";

// S-2 の右の列で、本人の同じ作業の前回の整理結果（つまずき・学び）を小さく並べる部品（T-001）。
// props の名前と型は T-000 の差し込み口のまま変えない。
// 前回がない・取得中・取得に失敗したときは何も描かない。

import { useEffect, useState } from "react";
import type { PreviousSummary as PreviousSummaryData } from "@/lib/sessions";
import { formatMdHm } from "@/lib/time";

export interface PreviousSummaryProps {
  sessionId: number;
  userId: string;
  taskName: string;
}

/** 取得結果を、どの作業・どのユーザーについての結果かと結び付けて持つ（OBS-018） */
export interface FetchedPrevious {
  sessionId: number;
  userId: string;
  previous: PreviousSummaryData | null;
}

/**
 * 描いてよい前回の整理結果を返す純粋関数。
 * 取得結果がない、または取得結果の sessionId・userId が現在の props と一致しないときは null。
 * props が変わった直後（新しい取得が終わるまで）に、前の作業・前のユーザーの記録を描かないため。
 */
export function selectPreviousToRender(
  fetched: FetchedPrevious | null,
  sessionId: number,
  userId: string,
): PreviousSummaryData | null {
  if (!fetched) return null;
  if (fetched.sessionId !== sessionId || fetched.userId !== userId) return null;
  return fetched.previous;
}

/** 「記録なし」の項目は本文の代わりに「記録なし」と出す */
function itemText(item: PreviousSummaryData["struggle"]): string {
  return item.status === "none" ? "記録なし" : item.text;
}

export default function PreviousSummary({ sessionId, userId, taskName }: PreviousSummaryProps) {
  const [fetched, setFetched] = useState<FetchedPrevious | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sessions/${sessionId}/previous?userId=${encodeURIComponent(userId)}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ previous: PreviousSummaryData | null }>) : null))
      .then((data) => {
        if (!cancelled) setFetched({ sessionId, userId, previous: data?.previous ?? null });
      })
      .catch(() => {
        if (!cancelled) setFetched({ sessionId, userId, previous: null });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, userId]);

  // 取得結果が現在の作業・ユーザーのものであるときだけ描く（取得中・取得失敗・props の変更直後は null）
  const previous = selectPreviousToRender(fetched, sessionId, userId);
  // 別の作業の前回が一瞬残らないよう、表示中の作業と作業名が合うときだけ描く
  if (!previous || previous.task_name !== taskName) return null;

  // 「11/3 13:05」から月日だけ取り出す
  const md = formatMdHm(previous.ended_at).split(" ")[0];
  return (
    <section
      aria-label="前回との比較"
      className="rounded border border-sky-300 bg-sky-50 p-3 text-sm dark:border-sky-800 dark:bg-sky-950"
    >
      <p>
        <span className="font-medium">前回（{md}）のつまずき：</span>
        {itemText(previous.struggle)}
      </p>
      <p className="mt-1">
        <span className="font-medium">学び：</span>
        {itemText(previous.learning)}
      </p>
      <p className="mt-2 text-xs">
        <a href={`/sessions/${previous.session_id}`} className="text-sky-700 underline dark:text-sky-300">
          前回の記録を見る
        </a>
      </p>
    </section>
  );
}
