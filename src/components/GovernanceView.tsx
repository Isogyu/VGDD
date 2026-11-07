"use client";

// 統治のライブ画面（T-013、D-59③）。票の盤・票1枚の運命・統治の数字を、GET /api/governance から取って表示する。
// 出すのは件数と、票の §6 の行の時刻・担い手・状態だけ（記録の文は出さない。T-034）。生のログは扱わない。

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PublicGovernance, PublicGovernanceEvent, PublicGovernanceTicket } from "@/lib/governance-public";
import { formatMdHm } from "@/lib/time";
import GovernanceMap from "@/components/GovernanceMap";
import KernelPanel from "@/components/KernelPanel";
import KernelInvariants from "@/components/KernelInvariants";
import LawHistory from "@/components/LawHistory";

// 盤の列（この順に左から並べる）。5つ以外の status は「その他」へ
const COLUMNS: { status: string; label: string }[] = [
  { status: "ready", label: "準備" },
  { status: "in_progress", label: "作業中" },
  { status: "review", label: "申請中" },
  { status: "merged", label: "統合" },
  { status: "blocked", label: "判断待ち" },
];

const ACTOR_LABELS: Record<PublicGovernanceEvent["actor"], string> = {
  "gate-runner": "裁判所",
  "night-runner": "夜間の代行",
  release: "朝の統合",
};

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  merged: { label: "統合", className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100" },
  in_progress: { label: "差し戻し", className: "bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100" },
  blocked: { label: "判断待ち", className: "bg-red-100 text-red-900 dark:bg-red-900 dark:text-red-100" },
  review: { label: "申請", className: "bg-sky-100 text-sky-900 dark:bg-sky-900 dark:text-sky-100" },
};

/** 記録の時刻（例 2026-11-03T20:28:02+0900）を「11/03 20:28」にする。記録に書かれた時刻のまま */
function formatTs(ts: string): string {
  return `${ts.slice(5, 7)}/${ts.slice(8, 10)} ${ts.slice(11, 16)}`;
}

/** 記録の時刻をミリ秒にする（+0900 を +09:00 に直して解釈）。解釈できなければ NaN */
function tsToMs(ts: string): number {
  return Date.parse(ts.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
}

/** timeline を時刻の順に並べる（同じ時刻・解釈できない時刻は出てきた順のまま） */
function sortTimeline(timeline: PublicGovernanceEvent[]): PublicGovernanceEvent[] {
  return timeline
    .map((e, i) => ({ e, i, ms: tsToMs(e.ts) }))
    .sort((a, b) => {
      if (Number.isNaN(a.ms) || Number.isNaN(b.ms) || a.ms === b.ms) return a.i - b.i;
      return a.ms - b.ms;
    })
    .map((x) => x.e);
}

/** 最初に選ぶ票：timeline の件数が最も多い票。同数なら id の大きい票 */
function defaultTicketId(tickets: PublicGovernanceTicket[]): string | null {
  let best: PublicGovernanceTicket | null = null;
  for (const t of tickets) {
    if (
      !best ||
      t.timeline.length > best.timeline.length ||
      (t.timeline.length === best.timeline.length && t.id > best.id)
    ) {
      best = t;
    }
  }
  return best ? best.id : null;
}

function Tile({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="min-w-[9rem] flex-1 rounded border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {note && <div className="mt-1 text-xs text-zinc-500">{note}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === null) return null;
  const b = STATUS_BADGES[status];
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${b ? b.className : "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"}`}>
      {b ? b.label : status}
    </span>
  );
}

export default function GovernanceView() {
  const [data, setData] = useState<PublicGovernance | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 押して選んだ票。null のあいだは既定の票（defaultTicketId）を出す
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/governance");
        if (cancelled) return;
        if (!r.ok) {
          setError(`読み込めませんでした（${r.status}）`);
          return;
        }
        const d = (await r.json()) as PublicGovernance;
        if (!cancelled) setData(d);
      } catch {
        if (!cancelled) setError("読み込めませんでした");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-5xl p-6">
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</p>
        <Link href="/" className="mt-3 inline-block text-sm underline">← 作業画面へ</Link>
      </div>
    );
  }
  if (!data) return <div className="p-6 text-sm text-zinc-500">読み込み中…</div>;

  const { summary, board, tickets } = data;
  const known = new Set(COLUMNS.map((c) => c.status));
  const others = tickets.filter((t) => !known.has(t.status));
  const columns = [
    ...COLUMNS.map((c) => ({ ...c, tickets: tickets.filter((t) => t.status === c.status) })),
    ...(others.length > 0 ? [{ status: "other", label: "その他", tickets: others }] : []),
  ];
  const currentId = selectedId ?? defaultTicketId(tickets);
  const current = tickets.find((t) => t.id === currentId) ?? null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 sm:p-6">
      {/* 1. 見出しと説明 */}
      <header>
        <Link href="/" className="text-sm text-zinc-500 underline">← 作業画面へ</Link>
        <h2 className="mt-1 text-xl font-semibold">証拠：実運用の集計・票の記録・検証結果</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">
          題材のアプリ（つぶやき業務ログ）を AI のチームが開発したときの、実運用の集計・票の記録・検証結果。Kernel の写しは自動で取り直し、ほかの区画は画面を開いた時点のもの（件数とリポジトリの記録だけ。生のログは公開していない）
        </p>
      </header>

      <GovernanceMap board={data.board} summary={data.summary} />
      <KernelPanel />
      <KernelInvariants />
      <LawHistory />

      {/* 2. 数字のタイル */}
      <section aria-label="統治の数字" className="flex flex-col gap-2">
        {summary ? (
          <div className="flex flex-wrap gap-2">
            <Tile label="証拠ストアの記録件数" value={summary.records} />
            <Tile label="拒否" value={summary.tool_calls.deny} />
            <Tile label="エージェントの種類" value={summary.agents} />
            <Tile label="ハッシュチェーン" value={summary.chain_ok ? "改ざんなし" : "不整合"} />
          </div>
        ) : (
          <p className="text-sm text-zinc-500">操作の集計はまだ書き出されていません</p>
        )}
        {board && (
          <div className="flex flex-wrap gap-2">
            <Tile label="票" value={board.tickets} />
            <Tile label="統合" value={board.merged} />
            <Tile label="差し戻し・停止の累計" value={board.rejected} note="裁判所が数えた、差し戻しと判断待ちの合計" />
            <Tile label="司法の不一致" value={board.disagreements} />
          </div>
        )}
      </section>

      {/* 3. 票の盤 */}
      <section aria-label="票の盤">
        <h2 className="mb-2 text-sm font-medium text-zinc-500">票の盤</h2>
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {columns.map((col) => (
            <div key={col.status} className="rounded bg-zinc-50 p-2 dark:bg-zinc-900">
              <h3 className="mb-2 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                {col.label} <span className="text-zinc-400">{col.tickets.length}</span>
              </h3>
              <ul className="flex flex-col gap-1.5">
                {col.tickets.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      aria-pressed={t.id === currentId}
                      className={`w-full rounded border p-2 text-left text-xs ${
                        t.id === currentId
                          ? "border-zinc-800 bg-white dark:border-zinc-200 dark:bg-zinc-800"
                          : "border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950"
                      }`}
                    >
                      <div className="font-mono text-zinc-500">{t.id}</div>
                      <div className="mt-0.5 line-clamp-3">{t.title}</div>
                      <div className="mt-1 text-zinc-500">差し戻し {t.returns} 回</div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* 4. 票1枚の運命 */}
      <section aria-label="票1枚の運命">
        <h2 className="mb-2 text-sm font-medium text-zinc-500">票1枚の運命</h2>
        {current ? (
          <div className="rounded border border-zinc-200 p-3 dark:border-zinc-700">
            <p className="text-sm font-medium">
              <span className="font-mono text-zinc-500">{current.id}</span> {current.title}
            </p>
            {current.timeline.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">記録はまだありません</p>
            ) : (
              <ol className="mt-3 flex flex-col gap-2 border-l border-zinc-300 pl-4 dark:border-zinc-600">
                {sortTimeline(current.timeline).map((e, i) => (
                  <li key={`${e.ts}-${i}`} className="text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-zinc-500">{formatTs(e.ts)}</span>
                      <span className="text-xs font-medium">{ACTOR_LABELS[e.actor]}</span>
                      <StatusBadge status={e.status} />
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">票がありません</p>
        )}
      </section>

      {/* 5. 日時 */}
      <footer className="flex flex-wrap gap-4 text-xs text-zinc-500">
        <span>最後に集計した日時：{summary ? formatMdHm(summary.generated_at) : "—"}</span>
        <span>画面を作った日時：{formatMdHm(data.generated_at)}</span>
      </footer>
    </div>
  );
}
