"use client";

// 統治のライブ画面の「法律が判例で育った歴史」の区画（T-025）。GET /api/governance/history から法律の公開の要約を取って表示する。
// 取るのはマウントごとに1回だけ（ポーリングしない）。受け取った値は pickLawHistory で検証し直してから使う。

import { useEffect, useState } from "react";
import {
  pickLawHistory,
  summarizeLawHistory,
  type LawHistory as LawHistoryData,
} from "@/lib/law-history-schema";

type LoadState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "error" }
  | { kind: "ok"; data: LawHistoryData };

const SECTION_LABEL = "法律が判例で育った歴史";

// 見つけた主体の表示名（固定の対応）
const FINDER_LABELS = new Map<string, string>([
  ["executive_head", "行政の長"],
  ["legislative", "立法補佐"],
  ["codex", "Codex の監査"],
  ["judge", "司法（Claude）"],
  ["owner", "オーナー"],
  ["operation", "運用の記録"],
]);

/** 前の版で落ちた件数の1行。測っていなければ null */
function prevFailedText(v: LawHistoryData["versions"][number]): string | null {
  if (v.prev_failed === null) return null;
  const total = v.tests_total === null ? "" : `／全 ${v.tests_total} 件`;
  return `前の版にかけると ${v.prev_failed} 件が落ちた${total}`;
}

export default function LawHistory() {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  // マウントごとに1回だけ取る。unmount で中断し、中断の後は state を更新しない
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      try {
        const r = await fetch("/api/governance/history", { cache: "no-store", signal });
        if (signal.aborted) return;
        if (!r.ok) {
          setLoad({ kind: "error" });
          return;
        }
        const body: unknown = await r.json();
        if (signal.aborted) return;
        if (typeof body !== "object" || body === null || !("history" in body)) {
          setLoad({ kind: "error" });
          return;
        }
        const raw = (body as { history: unknown }).history;
        if (raw === null) {
          setLoad({ kind: "none" });
          return;
        }
        const data = pickLawHistory(raw);
        setLoad(data === null ? { kind: "error" } : { kind: "ok", data });
      } catch {
        if (!signal.aborted) setLoad({ kind: "error" });
      }
    })();
    return () => controller.abort();
  }, []);

  if (load.kind === "loading") {
    return <section aria-label={SECTION_LABEL} aria-busy="true" />;
  }
  if (load.kind === "none") {
    return (
      <section aria-label={SECTION_LABEL}>
        <p className="text-sm text-zinc-500">法律の歴史の記録がありません</p>
      </section>
    );
  }
  if (load.kind === "error") {
    return (
      <section aria-label={SECTION_LABEL}>
        <p className="text-sm text-zinc-500">法律の歴史を読めませんでした</p>
      </section>
    );
  }

  const { data } = load;
  const s = summarizeLawHistory(data);
  const latest = s.latestTests === null ? "—" : `${s.latestTests} 件`;

  return (
    <section
      aria-label={SECTION_LABEL}
      className="flex flex-col gap-4 rounded border border-zinc-200 p-4 dark:border-zinc-700"
    >
      {/* 1. 見出しと要約 */}
      <div>
        <h2 className="text-sm font-medium text-zinc-500">{SECTION_LABEL}</h2>
        <p className="mt-1 text-sm tabular-nums">
          {`${s.versions} 版で ${s.improvements} 件の改善。最新の適合性テストは ${latest}`}
        </p>
      </div>

      {/* 2. 版ごとの行（versions の順のまま。新しい版が下） */}
      <ol className="flex flex-col gap-4 border-l border-zinc-300 pl-4 dark:border-zinc-600">
        {data.versions.map((v, i) => {
          const prevFailed = prevFailedText(v);
          return (
            <li key={`${v.version}-${i}`} className="flex flex-col gap-1.5 text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono font-medium">{v.version}</span>
                <span className="text-xs text-zinc-500 tabular-nums">{v.date}</span>
                <span className="break-words">{v.title}</span>
              </div>
              <ul className="list-disc pl-5 text-zinc-600 dark:text-zinc-300">
                {v.fixed.map((f, j) => (
                  <li key={`${f}-${j}`} className="break-words">
                    {f}
                  </li>
                ))}
              </ul>
              <ul className="flex flex-wrap gap-1.5 text-xs">
                {v.found_by.map((f, j) => (
                  <li
                    key={`${f}-${j}`}
                    className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    {FINDER_LABELS.get(f) ?? "—"}
                  </li>
                ))}
              </ul>
              {v.precedents.length > 0 && (
                <ul className="flex flex-wrap gap-1.5 font-mono text-xs">
                  {v.precedents.map((p, j) => (
                    <li key={`${p}-${j}`} className="rounded border border-zinc-200 px-1.5 py-0.5 dark:border-zinc-700">
                      {p}
                    </li>
                  ))}
                </ul>
              )}
              {prevFailed !== null && <p className="text-xs tabular-nums">{prevFailed}</p>}
              {v.obs.length > 0 && <p className="font-mono text-xs text-zinc-500">{v.obs.join("、")}</p>}
            </li>
          );
        })}
      </ol>

      {/* 3. 注意 */}
      <div className="flex flex-col gap-1 text-xs text-zinc-500">
        <p>前の版で落ちた件数は、その版で足した判例が空回りしていない証拠。記録は法律の公開の要約 vgdd/kernel/history.json</p>
        <p>バッジは、その版の問題を最初に見つけた主体。直す・判例を書く・承認するは、立法補佐・作業員・オーナーが正規の改正の手続きで分担した</p>
      </div>
    </section>
  );
}
