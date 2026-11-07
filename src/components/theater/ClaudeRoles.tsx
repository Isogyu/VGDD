"use client";

// 統治シアターの「Claude Code の使い分け」の欄（T-036 A3）。
// 役割の表は固定の文。件数は GET /api/governance の summary（公開済みの集計）を pickRoleSummary で検証し直してから使う。
// 取るのはマウントごとに1回だけ（ポーリングしない）。@/lib/governance は型だけを参照する（値として import すると node:fs が入る）。

import { useEffect, useState } from "react";
import type { GovernanceSummary } from "@/lib/governance";
import { buildHookTotals, buildRoleRows, formatCount, pickRoleSummary } from "@/lib/claude-roles";
import { formatJst } from "@/lib/kernel-state-schema";

const HEADING = "Claude Code の使い分け";

const LEAD = "役割ごとに Claude Code の別の機能で境界を作りました。ツール呼び出しは PreToolUse フックが判定します";

const COLUMNS = [
  "役割",
  "Claude Code の機能",
  "モデル",
  "道具の制限",
  "呼び出しの記録（拒否を含む）",
  "うちフックの拒否",
] as const;

const NOTE =
  "件数は記録の agent_type ごとです。(main) は agent_type のない記録をまとめたもので、行政の長だけの件数ではありません。役割の説明は今の定義、件数は書き出した期間の記録で、過去の件数は今の制限のもとで動いたことを示しません。司法（Claude）は judge.sh が別のプロセスで呼び、この表では件数を対応させません。— は 0 件という意味ではありません。許可は実行の成功を意味しません。拒否の分類は理由の文による分類で、権限ルールなどによる拒否のすべてではありません。Codex は第2の司法と監査で、この表の外です";

const SOURCE_PATH = "docs/governance/summary.json";

type ClaudeRolesViewProps = {
  summary: GovernanceSummary | null;
};

/** 表示だけの部品。summary が null でも役割の表と注記を出し、件数は「—」 */
export function ClaudeRolesView({ summary }: ClaudeRolesViewProps) {
  const rows = buildRoleRows(summary);
  const totals = buildHookTotals(summary);
  return (
    <section aria-label={HEADING} className="flex min-w-0 flex-col gap-3 rounded-lg border border-slate-800 p-4">
      <h2 className="text-lg font-semibold">{HEADING}</h2>
      <p className="text-sm text-slate-300">{LEAD}</p>

      {/* 狭い画面では表だけを横にスクロールさせ、ページには横スクロールを出さない */}
      <div className="min-w-0 max-w-full overflow-x-auto">
        <table className="w-full min-w-[48rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-xs text-slate-300">
              {COLUMNS.map((c) => (
                <th key={c} scope="col" className="px-2 py-1 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-slate-800 align-top">
                <th scope="row" className="px-2 py-1 font-medium">
                  {r.role}
                </th>
                <td className="px-2 py-1">{r.feature}</td>
                <td className="px-2 py-1">{r.model}</td>
                <td className="px-2 py-1">{r.limits}</td>
                <td className="px-2 py-1 text-right tabular-nums">{formatCount(r.calls)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{formatCount(r.deny)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totals !== null && (
        <div className="flex min-w-0 flex-col gap-2 text-sm">
          <p className="tabular-nums">
            {`フックの判定：許可 ${formatCount(totals.allow)}・拒否 ${formatCount(totals.deny)}（${formatCount(totals.sessions)} セッション、記録 ${formatCount(totals.records)} 行（結果の記録を含む）、ハッシュチェーン ${totals.chainOk ? "OK" : "NG"}）`}
          </p>
          {totals.denyKinds.length > 0 && (
            <ul aria-label="拒否の分類" className="flex flex-wrap gap-1.5 text-xs">
              {totals.denyKinds.map((k) => (
                <li key={k.key} className="rounded border border-slate-500 bg-slate-800 px-1.5 py-0.5 tabular-nums text-slate-100">
                  {`${k.label} ${formatCount(k.count)}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="text-xs text-slate-300">{NOTE}</p>
      <p className="text-xs text-slate-300">
        {totals !== null
          ? `出どころ：${SOURCE_PATH}（${formatJst(totals.generatedAt)} に生成、最後の記録は ${formatJst(totals.periodLast)}）`
          : `出どころ：${SOURCE_PATH}`}
      </p>
    </section>
  );
}

type LoadState = { kind: "loading" } | { kind: "none" } | { kind: "error" } | { kind: "ok"; summary: GovernanceSummary };

const STATUS_TEXT = {
  loading: "読み込み中…",
  none: "操作の集計の書き出しがありません",
  error: "操作の集計を読めませんでした",
} as const;

/** データを取る部品。マウントのたびに1回だけ取り、外れた後の応答は反映しない */
export default function ClaudeRoles() {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      try {
        const r = await fetch("/api/governance", { cache: "no-store", signal });
        if (signal.aborted) return;
        if (r.status !== 200) {
          setLoad({ kind: "error" });
          return;
        }
        const body: unknown = await r.json();
        if (signal.aborted) return;
        if (typeof body !== "object" || body === null || Array.isArray(body)) {
          setLoad({ kind: "error" });
          return;
        }
        const raw = (body as { summary?: unknown }).summary;
        // 「書き出しがない」は、生の summary が null のときだけ
        if (raw === null) {
          setLoad({ kind: "none" });
          return;
        }
        const summary = pickRoleSummary(raw);
        if (summary === null) {
          setLoad({ kind: "error" });
          return;
        }
        setLoad({ kind: "ok", summary });
      } catch {
        if (!signal.aborted) setLoad({ kind: "error" });
      }
    })();
    return () => controller.abort();
  }, []);

  if (load.kind === "ok") return <ClaudeRolesView summary={load.summary} />;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p aria-busy={load.kind === "loading"} className="text-sm">
        {STATUS_TEXT[load.kind]}
      </p>
      <ClaudeRolesView summary={null} />
    </div>
  );
}
