"use client";

// 統治シアター（T-034）。T-029〜T-032 の部品をつなぎ、データの取得・今の出来事・見る source の切り替えを持つ。
// 出すのは、票の ID と題、整形した時刻、決まった文、判定の結論、source と書き出しの時刻だけ。

import { useEffect, useState } from "react";
import type { Replay } from "@/lib/governance-replay-schema";
// 写しの generated_at は +09:00 の形なので、写し用の formatJst で整形する（null は「—」）
import { formatJst as formatSnapshotJst } from "@/lib/kernel-state-schema";
import { loadTheaterData, type TheaterData, type TheaterSource } from "@/lib/theater-data";
// 記録の出来事の ts は +0900 の形なので、再生用の formatJst で整形する
import { formatJst, labelFor, verdictLabels } from "@/lib/theater-replay";
import { focusFor } from "@/lib/theater-stage";
import GovernanceStage from "./GovernanceStage";
import TheaterShell from "./TheaterShell";
import TicketReplay from "./TicketReplay";

type ReplayEvent = Replay["tickets"][number]["events"][number];

const LOADING = "読み込み中…";

const SOURCES: readonly { value: TheaterSource; label: string }[] = [
  { value: "submission", label: "提出記録" },
  { value: "live", label: "稼働中の観測" },
];

const SECTION_STATUS = {
  ok: "取得済み",
  missing: "書き出しがありません",
  failed: "取得できませんでした",
} as const;

function sourceLabel(source: TheaterSource): string {
  return SOURCES.find((s) => s.value === source)?.label ?? source;
}

function sectionStatus(section: { kind: keyof typeof SECTION_STATUS } | undefined): string {
  return section ? SECTION_STATUS[section.kind] : LOADING;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt className="text-slate-400">{label}：</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default function GovernanceTheater() {
  const [source, setSource] = useState<TheaterSource>("submission");
  // null のあいだは取得中
  const [data, setData] = useState<TheaterData | null>(null);
  const [currentEvent, setCurrentEvent] = useState<ReplayEvent | null>(null);

  useEffect(() => {
    // source が変わった後と部品が外れた後の応答は反映しない
    let stale = false;
    void loadTheaterData(source, fetch).then((loaded) => {
      if (!stale) setData(loaded);
    });
    return () => {
      stale = true;
    };
  }, [source]);

  const selectSource = (next: TheaterSource) => {
    if (next === source) return;
    setSource(next);
    setData(null);
    setCurrentEvent(null);
  };

  const stopped = data?.state.kind === "ok" && data.state.value.stopped.active;
  const verdicts = currentEvent ? verdictLabels(currentEvent) : [];

  return (
    <TheaterShell
      header={
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold">VGDD Governance Kernel</h1>
              <p className="text-sm text-slate-300">
                AI が作る。別系統の AI が独立して確かめる。統合の条件は Kernel が強制し、承認と停止は人が持つ。
              </p>
            </div>
            <div role="group" aria-label="見る記録" className="flex shrink-0 gap-1">
              {SOURCES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={source === value}
                  onClick={() => selectSource(value)}
                  className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 hover:bg-slate-700 aria-pressed:border-slate-300 aria-pressed:bg-slate-700 aria-pressed:font-semibold"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-200">
            <Fact label="見ている記録" value={sourceLabel(source)} />
            <Fact label="Kernel の写しの書き出し" value={formatSnapshotJst(data?.generated_at ?? null)} />
            <Fact label="公開イベント" value={sectionStatus(data?.replay)} />
            <Fact label="Kernel の写し" value={sectionStatus(data?.state)} />
            <Fact label="不変条件の写し" value={sectionStatus(data?.invariants)} />
          </dl>
        </div>
      }
      stage={
        // 図の高さの制約は 1024px 以上だけ。狭い画面では SVG の縦横比どおりの高さ
        <div className="lg:h-full lg:[&_svg]:mx-auto lg:[&_svg]:max-h-full lg:[&_svg]:w-auto">
          <GovernanceStage focus={currentEvent ? focusFor(currentEvent) : null} stopped={stopped} />
        </div>
      }
      side={
        <div className="flex flex-col gap-2">
          {currentEvent ? (
            <>
              <p className="font-medium">{labelFor(currentEvent)}</p>
              <p className="text-sm tabular-nums text-slate-300">{formatJst(currentEvent.ts)}</p>
              {verdicts.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm">
                  {verdicts.map((verdict) => (
                    <li key={verdict}>{verdict}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p>下の再生を押すと、票1枚の記録を順に追います</p>
          )}
          <p className="text-xs text-slate-300">出来事は票の §6 の記録の分類です。記録の文そのものは公開していません</p>
        </div>
      }
      controls={
        data === null ? (
          <p>{LOADING}</p>
        ) : data.replay.kind === "ok" ? (
          // source が変わったら外して作り直す。再生は始まる前から
          <TicketReplay key={source} tickets={data.replay.value.tickets} onEventChange={setCurrentEvent} />
        ) : (
          <p>記録を取得できませんでした</p>
        )
      }
    />
  );
}
