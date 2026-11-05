"use client";

// 統治のライブ画面の「Kernel」の区画（T-022）。GET /api/governance/kernel から裁判所が書き出した状態の写しを取って表示する。
// 取るのはマウントごとに1回だけ（表示は取得した時点の写し）。古い写しかどうか（stale）だけを 60 秒ごとに計算し直す。
// 出すのは件数と結論だけ。生のログは扱わない。受け取った値は pickKernelState で検証し直してから使う。

import { useEffect, useState } from "react";
import {
  formatJst,
  pickKernelState,
  summarizeKernel,
  type KernelState,
  type VerdictValue,
} from "@/lib/kernel-state-schema";

type LoadState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "error" }
  | { kind: "ok"; state: KernelState };

const KIND_LABELS = new Map<string, string>([
  ["preflight_failed", "起動時の点検で不足"],
  ["judiciary_unavailable", "呼び出しの失敗"],
]);

// 成立条件①〜⑤と、どう強制しているか（固定の文）
const CONDITIONS: { label: string; how: string }[] = [
  { label: "①役割分離", how: "フック・権限・sandbox・別プロセスで、役割ごとにできる操作を分ける" },
  { label: "②仕様の統治", how: "受け入れ条件の指紋をオーナーが承認する。裁判所は司法の前に照合する" },
  { label: "③独立司法", how: "司法は差分と受け入れ条件だけを見る。ツールを持たない。2つの系統で判定する" },
  {
    label: "④Kernel による強制",
    how: "main に入れるのは裁判所と朝の承認だけ。未承認・不合格・保護パス・停止中は入らない",
  },
  { label: "⑤証跡", how: "判定ごとの記録とハッシュチェーン、チェックポイント" },
];

const STALE_RECHECK_MS = 60_000;

function orDash(v: string | null): string {
  return v === null ? "—" : v;
}

function verdictText(v: VerdictValue): string {
  return v === null ? "—" : v;
}

function chainText(ok: boolean | null): string {
  if (ok === null) return "未確認";
  return ok ? "改ざんなし" : "不整合";
}

export default function KernelPanel() {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  // stale の計算に使う現在時刻。取得の後と 60 秒ごとに進める
  const [now, setNow] = useState<Date>(() => new Date());

  // マウントごとに1回だけ取る。unmount で中断し、中断の後は state を更新しない
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      try {
        const r = await fetch("/api/governance/kernel", { cache: "no-store", signal });
        if (signal.aborted) return;
        if (!r.ok) {
          setLoad({ kind: "error" });
          return;
        }
        const body: unknown = await r.json();
        if (signal.aborted) return;
        if (typeof body !== "object" || body === null || !("state" in body)) {
          setLoad({ kind: "error" });
          return;
        }
        const raw = (body as { state: unknown }).state;
        if (raw === null) {
          setLoad({ kind: "none" });
          return;
        }
        const state = pickKernelState(raw);
        setNow(new Date());
        setLoad(state === null ? { kind: "error" } : { kind: "ok", state });
      } catch {
        if (!signal.aborted) setLoad({ kind: "error" });
      }
    })();
    return () => controller.abort();
  }, []);

  // stale だけを 60 秒ごとに計算し直す
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), STALE_RECHECK_MS);
    return () => clearInterval(id);
  }, []);

  if (load.kind === "loading") {
    return <section aria-label="Kernel" aria-busy="true" />;
  }
  if (load.kind === "none") {
    return (
      <section aria-label="Kernel">
        <p className="text-sm text-zinc-500">
          Kernel の状態の書き出しがありません（裁判所が稼働していないか、この環境では公開していません）
        </p>
      </section>
    );
  }
  if (load.kind === "error") {
    return (
      <section aria-label="Kernel">
        <p className="text-sm text-zinc-500">Kernel の状態を読めませんでした</p>
      </section>
    );
  }

  const { state } = load;
  const s = summarizeKernel(state, now);
  const { conformance, evidence } = state;
  const mismatches = evidence.checkpoint_mismatches;

  const numbers: string[] = [
    conformance
      ? `適合性テスト ${conformance.passed}/${conformance.total}（${orDash(conformance.impl)}、${formatJst(conformance.at)}）`
      : "未記録",
    `承認済み ${s.approvedCurrent} 票`,
    `判定 ${s.verdictRows.length} 件、不一致 ${state.disagreements.tasks.length} 件`,
    `held ${s.heldCount} 件、裁定 ${s.rulingCount} 件、取り消し ${state.annulments.count} 件`,
    `記録 ${evidence.records} 件、ハッシュチェーン ${chainText(evidence.chain_ok)}、` +
      `チェックポイントの食い違い ${mismatches === null ? "—" : `${mismatches} 件`}、` +
      `最後のチェックポイント ${formatJst(evidence.checkpoint_at)}`,
  ];

  return (
    <section aria-label="Kernel" className="flex flex-col gap-4 rounded border border-zinc-200 p-4 dark:border-zinc-700">
      <h2 className="text-sm font-medium text-zinc-500">Kernel</h2>

      {/* 1. 書き出し日時 */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <span>書き出し：{formatJst(state.generated_at)}</span>
        {s.stale && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-900 dark:text-amber-100">
            古い写しです（10分を超えて更新がありません）
          </span>
        )}
      </div>

      {/* 2. 稼働／停止中 */}
      <div className="flex flex-wrap items-center gap-3">
        {state.stopped.active ? (
          <span className="text-3xl font-semibold text-red-700 dark:text-red-400">
            停止中（{formatJst(state.stopped.since)} から）
          </span>
        ) : (
          <span className="text-3xl font-semibold text-emerald-700 dark:text-emerald-400">稼働中</span>
        )}
        {state.judiciary.status !== "ok" && (
          <span className="rounded bg-amber-100 px-2 py-1 text-sm text-amber-900 dark:bg-amber-900 dark:text-amber-100">
            司法の道具が使えません（{KIND_LABELS.get(state.judiciary.kind ?? "") ?? "—"}）
          </span>
        )}
      </div>

      {/* 3. 法律の版 */}
      <p className="text-sm">
        Kernel {orDash(state.kernel_version)}・フック {orDash(state.policy_version)}
      </p>

      {/* 4. 成立条件①〜⑤ */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-zinc-500">
            <tr>
              <th className="py-1 pr-3 font-medium">成立条件</th>
              <th className="py-1 pr-3 font-medium">どう強制しているか</th>
              <th className="py-1 font-medium">いまの数字</th>
            </tr>
          </thead>
          <tbody>
            {CONDITIONS.map((c, i) => (
              <tr key={c.label} className="border-t border-zinc-200 align-top dark:border-zinc-700">
                <td className="py-1.5 pr-3 whitespace-nowrap">{c.label}</td>
                <td className="py-1.5 pr-3 text-zinc-600 dark:text-zinc-300">{c.how}</td>
                <td className="py-1.5 tabular-nums">
                  {numbers[i]}
                  {i === 4 && mismatches !== null && mismatches >= 1 && (
                    <p className="mt-1 text-xs text-zinc-500">
                      食い違いは裁判所の記録の取り方の競合でも生じる（OBS-055。p0.4.3 で修正）。改ざんかどうかはオーナーが verify-chain で確かめる
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 5. 承認済みの仕様 */}
      <div>
        <h3 className="mb-1 text-xs font-medium text-zinc-500">承認済みの仕様</h3>
        {s.approvalsSorted.length === 0 ? (
          <p className="text-sm text-zinc-500">—</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-xs">
            {s.approvalsSorted.map((a) => (
              <li key={a.task} className="rounded border border-zinc-200 px-2 py-1 dark:border-zinc-700">
                <span className="font-mono">{a.task}</span>{" "}
                <span className="text-zinc-500">{formatJst(a.approved_at)}</span>
                {!a.current && (
                  <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                    仕様が変わった（承認し直しが要る）
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 6. held・裁定・取り消し */}
      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <h3 className="mb-1 text-xs font-medium text-zinc-500">held</h3>
          {state.held.length === 0 ? (
            <p className="text-zinc-500">—</p>
          ) : (
            <ul>
              {state.held.map((h) => (
                <li key={h.task}>
                  <span className="font-mono">{h.task}</span>{" "}
                  <span className="text-zinc-500">{formatJst(h.since)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-1 text-xs font-medium text-zinc-500">裁定</h3>
          {state.rulings.tasks.length === 0 ? (
            <p className="text-zinc-500">—</p>
          ) : (
            <p className="font-mono">{state.rulings.tasks.join("、")}</p>
          )}
        </div>
        <div>
          <h3 className="mb-1 text-xs font-medium text-zinc-500">取り消し</h3>
          <p className="tabular-nums">{state.annulments.count} 件</p>
        </div>
      </div>

      {/* 7. 判定の一覧 */}
      <div className="overflow-x-auto">
        <h3 className="mb-1 text-xs font-medium text-zinc-500">判定</h3>
        {s.verdictRows.length === 0 ? (
          <p className="text-sm text-zinc-500">—</p>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 pr-3 font-medium">票</th>
                <th className="py-1 pr-3 font-medium">judge</th>
                <th className="py-1 pr-3 font-medium">Codex</th>
                <th className="py-1 font-medium">security</th>
              </tr>
            </thead>
            <tbody>
              {s.verdictRows.map((v) => (
                <tr
                  key={v.task}
                  className={`border-t border-zinc-200 dark:border-zinc-700 ${
                    v.disagreed ? "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100" : ""
                  }`}
                >
                  <td className="py-1 pr-3 font-mono">{v.task}</td>
                  <td className="py-1 pr-3">{verdictText(v.judge)}</td>
                  <td className="py-1 pr-3">{verdictText(v.codex)}</td>
                  <td className="py-1">{verdictText(v.security)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 8. 注意 */}
      <p className="text-xs text-zinc-500">生のログは公開していない。ここにあるのは裁判所が書き出した件数と結論だけ</p>
    </section>
  );
}
