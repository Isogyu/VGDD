"use client";

// 統治シアター（T-034）。T-029〜T-032 の部品をつなぎ、データの取得・今の出来事・見る source の切り替えを持つ。
// 出すのは、票の ID と題、整形した時刻、決まった文、判定の結論、source と書き出しの時刻だけ。

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Replay } from "@/lib/governance-replay-schema";
// 写しの generated_at は +09:00 の形なので、写し用の formatJst で整形する（null は「—」）
import { formatJst as formatSnapshotJst } from "@/lib/kernel-state-schema";
import { pendingSummaryText, stopBannerText } from "@/lib/theater-banner";
import { loadTheaterData, type TheaterData, type TheaterSource } from "@/lib/theater-data";
import { GUIDE_STEPS } from "@/lib/theater-guide";
import {
  formatFetchTime,
  hasFailedSection,
  LIVE_REFRESH_MS,
  mergeRefresh,
  shouldRecordFetch,
} from "@/lib/theater-refresh";
// 記録の出来事の ts は +0900 の形なので、再生用の formatJst で整形する
import { formatJst, labelFor, verdictLabels } from "@/lib/theater-replay";
import { focusFor } from "@/lib/theater-stage";
import { parseStartSource, parseStartTicket } from "@/lib/theater-start";
import ClaudeRoles from "./ClaudeRoles";
import DecisionPanel from "./DecisionPanel";
import GovernanceStage from "./GovernanceStage";
import LawComparison from "./LawComparison";
import TheaterGuide from "./TheaterGuide";
import TheaterShell from "./TheaterShell";
import TicketReplay from "./TicketReplay";
import { theaterTokens } from "./tokens";

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
  // 開始の設定（T-039 A2）。最初に作られたときに URL の値を検証して一度だけ決め、URL が変わっても取り直さない。
  // 生の値は使わず、決まった値（source）と票の ID の形（ticket）にしたものだけを持つ
  const searchParams = useSearchParams();
  const [start] = useState(() => ({
    source: parseStartSource(searchParams.get("source")),
    ticketId: parseStartTicket(searchParams.get("ticket")),
  }));
  const [source, setSource] = useState<TheaterSource>(start.source);
  // null のあいだは取得中
  const [data, setData] = useState<TheaterData | null>(null);
  const [currentEvent, setCurrentEvent] = useState<ReplayEvent | null>(null);
  // 最後の取得の時刻（HH:MM:SS、日本時間）と、最新の取得の失敗。source を変えたら初めに戻す（T-035 A3）
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  // 「はじめて見る」の案内の手順（0〜4）。null は案内していない（T-037 A3）。source の切り替えでは戻さない
  const [guideStep, setGuideStep] = useState<number | null>(null);

  // 「source を選んでいる期間」の番号。effect のたびと部品が外れたときに進める。
  // 要求は始めたときの番号を持ち、応答の時点で今の番号と違えば何も反映しない（T-035 A2）
  const periodRef = useRef(0);
  // 最初の取得が終わった期間の番号。これと今の番号が同じときだけ取り直す
  const readyPeriodRef = useRef<number | null>(null);
  // 走っている取得（最初の取得と取り直し）の期間の番号。自動と手動で共通の排他に使う
  const runningPeriodRef = useRef<number | null>(null);
  // 合わせる元の、今表示している data
  const dataRef = useRef<TheaterData | null>(null);

  const showData = useCallback((next: TheaterData | null) => {
    dataRef.current = next;
    setData(next);
  }, []);

  const recordFetch = useCallback((loaded: TheaterData, failed: boolean) => {
    setFetchFailed(failed);
    if (shouldRecordFetch(loaded)) setLastFetchedAt(formatFetchTime(Date.now()));
  }, []);

  // 稼働中の観測の取り直し。自動（タイマー）と手動（今すぐ取得）の両方がここを通る
  const refresh = useCallback(
    (period: number) => {
      if (period !== periodRef.current) return;
      if (readyPeriodRef.current !== period) return;
      if (runningPeriodRef.current === period) return;
      runningPeriodRef.current = period;
      void loadTheaterData("live", fetch)
        .then((next) => {
          if (period !== periodRef.current) return;
          const current = dataRef.current;
          if (current === null) return;
          const merged = mergeRefresh(current, next);
          showData(merged.data);
          recordFetch(next, merged.failed);
        })
        .finally(() => {
          // 前の期間の要求は、今の期間の「走っている」状態を変えない
          if (runningPeriodRef.current === period) runningPeriodRef.current = null;
        });
    },
    [showData, recordFetch],
  );

  useEffect(() => {
    const period = ++periodRef.current;
    // 最初の取得も排他の対象にする（最初の取得が終わる前は取り直さない）
    runningPeriodRef.current = period;
    void loadTheaterData(source, fetch)
      .then((loaded) => {
        // source が変わった後と部品が外れた後の応答は反映しない
        if (period !== periodRef.current) return;
        showData(loaded);
        recordFetch(loaded, hasFailedSection(loaded));
        // 失敗でも最初の取得は終わったとみなす
        readyPeriodRef.current = period;
      })
      .finally(() => {
        if (runningPeriodRef.current === period) runningPeriodRef.current = null;
      });
    const timer = source === "live" ? setInterval(() => refresh(period), LIVE_REFRESH_MS) : null;
    return () => {
      periodRef.current += 1;
      if (timer !== null) clearInterval(timer);
    };
  }, [source, refresh, showData, recordFetch]);

  const selectSource = (next: TheaterSource) => {
    if (next === source) return;
    setSource(next);
    showData(null);
    setCurrentEvent(null);
    setLastFetchedAt(null);
    setFetchFailed(false);
  };

  const stopped = data?.state.kind === "ok" && data.state.value.stopped.active;
  const verdicts = currentEvent ? verdictLabels(currentEvent) : [];
  // 案内中は案内の手順の強調、そうでなければ選んだ出来事の強調。currentEvent は案内中も更新され続ける
  const stageFocus =
    guideStep !== null ? GUIDE_STEPS[guideStep].focus : currentEvent ? focusFor(currentEvent) : null;
  const lastGuideStep = GUIDE_STEPS.length - 1;
  // 帯と件数は、判断待ちの欄（DecisionPanel）に渡すものと同じ、今表示している data から作る（T-038 A2）
  const stopBanner = stopBannerText(data?.state ?? null);
  const pendingSummary = pendingSummaryText(data?.state ?? null, data?.invariants ?? null);

  return (
    <>
    <TheaterShell
      header={
        <div className="flex flex-col gap-1">
          {stopBanner !== null && (
            // 見出しの区画の先頭に、横幅いっぱいの停止の帯。1行で収まる余白と文字の大きさ。狭い画面では折り返す
            <p
              role="status"
              className="w-full min-w-0 break-words rounded border border-red-500 bg-red-950 px-3 py-1 text-sm font-bold text-red-100"
            >
              {stopBanner}
            </p>
          )}
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold">VGDD Governance Kernel</h1>
              <p className="text-sm text-slate-300">
                AI が作る。別系統の AI が独立して確かめる。統合の条件は Kernel が強制し、承認と停止は人が持つ。
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1">
              {guideStep === null && (
                // source によらず出す。案内中は出さない（T-037 A3）
                <button
                  type="button"
                  onClick={() => setGuideStep(0)}
                  className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 hover:bg-slate-700"
                >
                  はじめて見る
                </button>
              )}
              <div role="group" aria-label="見る記録" className="flex gap-1">
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
              {source === "live" && (
                // 最初の取得が終わる前と、取得が走っている間は、押しても要求を出さない（refresh の中で確かめる）
                <button
                  type="button"
                  onClick={() => refresh(periodRef.current)}
                  className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 hover:bg-slate-700"
                >
                  今すぐ取得
                </button>
              )}
            </div>
          </div>
          {/* 取得の状態の項目の並びと、その後の判断待ちの件数を同じ行に並べる（狭い画面では折り返す） */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs">
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-200">
              <Fact label="見ている記録" value={sourceLabel(source)} />
              <Fact label="Kernel の写しの書き出し" value={formatSnapshotJst(data?.generated_at ?? null)} />
              {source === "live" && <Fact label="最後の取得" value={lastFetchedAt ?? "—"} />}
              <Fact label="公開イベント" value={sectionStatus(data?.replay)} />
              <Fact label="Kernel の写し" value={sectionStatus(data?.state)} />
              <Fact label="不変条件の写し" value={sectionStatus(data?.invariants)} />
            </dl>
            {pendingSummary !== null && (
              // 下の「判断待ちと次の担当」の欄へのページ内リンク
              <a href="#decisions" className="font-semibold text-amber-200 underline hover:text-amber-100">
                {pendingSummary}
              </a>
            )}
          </div>
          {source === "live" && fetchFailed && (
            <p className="text-xs text-slate-200">
              最新の取得で一部または全部を取得できませんでした。取得できなかった項目は前の表示のままです
            </p>
          )}
        </div>
      }
      stage={
        // 図の高さの制約は 1024px 以上だけ。狭い画面では SVG の縦横比どおりの高さ
        <div className="lg:h-full lg:[&_svg]:mx-auto lg:[&_svg]:max-h-full lg:[&_svg]:w-auto">
          <GovernanceStage focus={stageFocus} stopped={stopped} />
        </div>
      }
      side={
        // 案内中は、この区画の中身だけを案内に替える。再生（controls）は同じ位置に描いたまま
        guideStep !== null ? (
          <TheaterGuide
            step={guideStep}
            onPrev={() => setGuideStep((s) => (s === null ? s : Math.max(0, s - 1)))}
            onNext={() => setGuideStep((s) => (s === null ? s : Math.min(lastGuideStep, s + 1)))}
            onClose={() => setGuideStep(null)}
          />
        ) : (
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
        )
      }
      controls={
        data === null ? (
          <p>{LOADING}</p>
        ) : data.replay.kind === "ok" ? (
          // source が変わったら外して作り直す。再生は始まる前から。作り直すたびに、最初に決めた票を選ぶ（T-039 A2）
          <TicketReplay
            key={source}
            tickets={data.replay.value.tickets}
            onEventChange={setCurrentEvent}
            initialTicketId={start.ticketId}
          />
        ) : (
          <p>記録を取得できませんでした</p>
        )
      }
    />
    {/* 最初の画面の外（T-033 A4）。1024px 以上で横に2列、未満で縦に1列。写しは今見ている source のものだけを渡す */}
    <section
      aria-label="判例の比較と判断待ち"
      className={`${theaterTokens.page.background} ${theaterTokens.page.text} grid w-full grid-cols-1 gap-4 p-4 lg:grid-cols-2`}
    >
      <div className="min-w-0">
        <LawComparison />
      </div>
      {/* 見出しの判断待ちの件数のリンク先（T-038 A2） */}
      <div id="decisions" className="min-w-0">
        <DecisionPanel
          state={data?.state ?? null}
          invariants={data?.invariants ?? null}
          sourceLabel={sourceLabel(source)}
          generatedAt={data?.generated_at ?? null}
        />
      </div>
    </section>
    {/* T-036 A4：判例の比較・判断待ちの下に、横幅いっぱいの区画を1つ。source に依らず、取り直しにも加えない */}
    <div className={`${theaterTokens.page.background} ${theaterTokens.page.text} w-full min-w-0 px-4 pb-4`}>
      <ClaudeRoles />
    </div>
    </>
  );
}
