"use client";

// 統治シアターの「判例の比較」の欄（T-033 A2）。GET /api/governance/history から法律の公開の要約を取り、版を選んで旧版と修正版を並べる。
// 取るのはマウントごとに1回だけ（ポーリングしない）。受け取った値は pickLawHistory で検証し直してから使う。
// 出すのは、版名・日付・題・直した点・判例の名前・件数・見つけた主体の表示名と、決まった文だけ。

import { useEffect, useState, type ReactNode } from "react";
import { pickLawHistory, type LawHistory } from "@/lib/law-history-schema";
import { comparableVersions, comparisonFor, defaultVersion } from "@/lib/theater-evidence";

const HEADING = "判例の比較";

const SOURCE_NOTE =
  "出どころ：vgdd/kernel/history.json（法律の公開の要約）。落ちた件数は、その版で足した判例を前の版にかけた結果で、防いだ不具合の数ではありません";

function Frame({ children }: { children: ReactNode }) {
  return (
    <section aria-label={HEADING} className="flex min-w-0 flex-col gap-3 rounded-lg border border-slate-800 p-4">
      <h2 className="text-lg font-semibold">{HEADING}</h2>
      {children}
    </section>
  );
}

type LawComparisonViewProps = {
  history: LawHistory;
  /** 選んだ版名。選んでいなければ null */
  selected: string | null;
  onSelect: (version: string) => void;
};

/** 表示だけの部品。比べられる版のボタンと、選んだ版の比較を出す */
export function LawComparisonView({ history, selected, onSelect }: LawComparisonViewProps) {
  const versions = comparableVersions(history);
  if (versions.length === 0) {
    return (
      <Frame>
        <p>比べられる版がありません</p>
      </Frame>
    );
  }

  // 比べられる版の中から選んだときだけ、中身を出す
  const c = selected !== null && versions.some((v) => v.version === selected) ? comparisonFor(history, selected) : null;

  return (
    <Frame>
      <div role="group" aria-label="比べる版" className="flex flex-wrap gap-1">
        {versions.map((v, i) => (
          <button
            key={`${v.version}-${i}`}
            type="button"
            aria-pressed={v.version === selected}
            onClick={() => onSelect(v.version)}
            className="rounded border border-slate-600 bg-slate-800 px-2 py-1 font-mono text-sm text-slate-100 hover:bg-slate-700 aria-pressed:border-slate-300 aria-pressed:bg-slate-700 aria-pressed:font-semibold"
          >
            {v.version}
          </button>
        ))}
      </div>

      {c !== null && (
        <div className="flex min-w-0 flex-col gap-2 text-sm">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <p className="font-mono">{`旧版：${c.previousVersion ?? "—"}`}</p>
            <p className="font-mono">{`修正版：${c.version}（${c.date}）`}</p>
          </div>
          <p className="break-words font-medium">{c.title}</p>
          <p className="tabular-nums">{`旧版にかけると ${c.prevFailed} 件が落ちた`}</p>
          <p className="tabular-nums">
            {c.testsTotal === null ? "修正版の適合性テスト：未測定" : `修正版の適合性テスト：全 ${c.testsTotal} 件`}
          </p>
          {c.fixed.length > 0 && (
            <ul className="list-disc pl-5 text-slate-200">
              {c.fixed.map((f, j) => (
                <li key={`${f}-${j}`} className="break-words">
                  {f}
                </li>
              ))}
            </ul>
          )}
          {c.precedents.length > 0 && (
            <ul aria-label="足した判例" className="flex flex-wrap gap-1.5 font-mono text-xs">
              {c.precedents.map((p, j) => (
                <li key={`${p}-${j}`} className="rounded border border-slate-500 bg-slate-800 px-1.5 py-0.5 text-slate-100">
                  {p}
                </li>
              ))}
            </ul>
          )}
          {c.foundBy.length > 0 && (
            <ul aria-label="見つけた主体" className="flex flex-wrap gap-1.5 text-xs">
              {c.foundBy.map((f, j) => (
                <li key={`${f}-${j}`} className="rounded border border-violet-500 bg-violet-950 px-1.5 py-0.5 text-violet-200">
                  {f}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="text-xs text-slate-300">{SOURCE_NOTE}</p>
    </Frame>
  );
}

type LoadState = { kind: "loading" } | { kind: "none" } | { kind: "error" } | { kind: "ok"; history: LawHistory };

const STATUS_TEXT = {
  loading: "読み込み中…",
  none: "法律の歴史の記録がありません",
  error: "法律の歴史を読めませんでした",
} as const;

/** データを取る部品。マウントのたびに1回だけ取り、外れた後の応答は反映しない */
export default function LawComparison() {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      try {
        const r = await fetch("/api/governance/history", { cache: "no-store", signal });
        if (signal.aborted) return;
        if (r.status !== 200) {
          setLoad({ kind: "error" });
          return;
        }
        const body: unknown = await r.json();
        if (signal.aborted) return;
        if (typeof body !== "object" || body === null || Array.isArray(body) || !("history" in body)) {
          setLoad({ kind: "error" });
          return;
        }
        const raw = (body as { history: unknown }).history;
        if (raw === null) {
          setLoad({ kind: "none" });
          return;
        }
        const history = pickLawHistory(raw);
        if (history === null) {
          setLoad({ kind: "error" });
          return;
        }
        setSelected(defaultVersion(history));
        setLoad({ kind: "ok", history });
      } catch {
        if (!signal.aborted) setLoad({ kind: "error" });
      }
    })();
    return () => controller.abort();
  }, []);

  if (load.kind !== "ok") {
    return (
      <Frame>
        <p aria-busy={load.kind === "loading"}>{STATUS_TEXT[load.kind]}</p>
      </Frame>
    );
  }
  return <LawComparisonView history={load.history} selected={selected} onSelect={setSelected} />;
}
