"use client";

// 統治のライブ画面の先頭に置く「統治の全体図」と「停止の表示」（T-026。可視化 V1・V2）。
// Kernel の状態の写しを GET /api/governance/kernel から 60 秒ごとに取り、票の盤と操作の集計は親から受ける。
// 受け取った値は pickKernelState で検証し直してから使う。この写しは表示用で、判断の根拠にしない。

import { useEffect, useState } from "react";
// 型だけを読む（governance.ts は node:fs を使うので、値は読み込まない）
import type { GovernanceBoard, GovernanceSummary } from "@/lib/governance";
import { buildGovernanceMap, type GovernanceBox } from "@/lib/governance-map";
import {
  formatJst,
  pickKernelState,
  summarizeKernel,
  type KernelState,
} from "@/lib/kernel-state-schema";

const FETCH_INTERVAL_MS = 60_000;
const NOW_INTERVAL_MS = 60_000;

// loading は最初の取得の結果が出るまで。まだ失敗していないので、失敗の帯は出さない
type LoadState = { kind: "loading" } | { kind: "unknown" } | { kind: "ok"; state: KernelState };

function Box({ box, emphasized = false }: { box: GovernanceBox; emphasized?: boolean }) {
  return (
    <div
      className={`rounded p-3 ${
        emphasized
          ? "border-2 border-zinc-500 dark:border-zinc-400"
          : "border border-zinc-200 dark:border-zinc-700"
      }`}
    >
      <h3 className="text-sm font-semibold">{box.title}</h3>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">{box.role}</p>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {box.figures.map((f) => (
          <div key={f.label}>
            <dt className="text-xs text-zinc-500">{f.label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function GovernanceMap({
  board,
  summary,
}: {
  board: GovernanceBoard | null;
  summary: GovernanceSummary | null;
}) {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  // 最後に取得に成功した時刻（端末の時計）
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  // 古さの判定に使う現在時刻。取得とは別に進める（取得が長引いても表示が切り替わる）
  const [now, setNow] = useState<Date>(() => new Date());

  // マウントのときと 60 秒ごとに取る。前の取得が終わっていなければ中断し、中断の後は state を更新しない
  useEffect(() => {
    let current: AbortController | null = null;

    const fetchState = async () => {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      const { signal } = controller;
      try {
        const r = await fetch("/api/governance/kernel", { cache: "no-store", signal });
        if (signal.aborted) return;
        if (!r.ok) {
          setLoad({ kind: "unknown" });
          return;
        }
        const body: unknown = await r.json();
        if (signal.aborted) return;
        if (typeof body !== "object" || body === null || !("state" in body)) {
          setLoad({ kind: "unknown" });
          return;
        }
        setLastFetchedAt(new Date().toISOString());
        // pickKernelState は null を含む形の合わない値に null を返す
        const state = pickKernelState((body as { state: unknown }).state);
        setLoad(state === null ? { kind: "unknown" } : { kind: "ok", state });
      } catch {
        if (!signal.aborted) setLoad({ kind: "unknown" });
      }
    };

    void fetchState();
    const id = setInterval(() => void fetchState(), FETCH_INTERVAL_MS);
    return () => {
      clearInterval(id);
      current?.abort();
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), NOW_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const state = load.kind === "ok" ? load.state : null;
  const map = buildGovernanceMap({ state, board, summary });
  const stale = state !== null && summarizeKernel(state, now).stale;

  return (
    <div className="flex flex-col gap-3">
      {/* 1. 状態の帯（V2） */}
      {state?.stopped.active && (
        <p
          role="alert"
          className="rounded border-2 border-red-600 bg-red-100 p-3 text-base font-semibold text-red-900 dark:bg-red-950 dark:text-red-100"
        >
          取得した写し（書き出し {formatJst(state.generated_at)}）では、Kernel は停止中（{formatJst(state.stopped.since)} から）。停止の後に始まる AI の書き込み・Bash・作業員の起動は拒否される。停止の前から動いている処理は止めない
        </p>
      )}
      {load.kind === "unknown" && (
        <p className="rounded border border-amber-400 bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100">
          Kernel の状態を確認できない（取得に失敗した）。稼働中とはみなさない
        </p>
      )}

      {/* 2. 写しの時刻 */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span>
          Kernel の写し：書き出し {state ? formatJst(state.generated_at) : "—"}・最後の取得 {formatJst(lastFetchedAt)}
        </span>
        {stale && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-900 dark:text-amber-100">
            古い写し（10 分を超えて書き出しがない）
          </span>
        )}
      </div>

      {/* 3. 全体図（V1） */}
      <section aria-label="統治の全体図" className="flex flex-col gap-2">
        <Box box={map.citizen} emphasized />
        <p className="text-center text-xs text-zinc-500">承認・裁定・停止 ↓</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Box box={map.legislative} />
          <Box box={map.executive} />
          <Box box={map.judiciary} />
        </div>
        <p className="text-center text-xs text-zinc-500">すべての操作は Kernel を通る ↓</p>
        <Box box={map.kernel} />
        <div className="mt-1 flex flex-col gap-1 text-xs text-zinc-500">
          <p>Kernel の写しは 60 秒ごとに取得する。票の盤と操作の集計は画面を開いた時点のもの。取得の時点が違う数を並べている</p>
          <p>この全体図と下の Kernel の区画は別々に取得するので、通信の遅れや失敗のときは一時的に食い違うことがある。停止の帯が消えても、再開の条件を確かめたことにはならない（再開はオーナーが kernel-resume.sh で条件を確かめて行う）</p>
          <p>数字は裁判所の写しと操作の集計から。生のログは公開していない</p>
        </div>
      </section>
    </div>
  );
}
