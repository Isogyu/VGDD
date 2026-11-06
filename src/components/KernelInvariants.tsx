"use client";

// 統治のライブ画面の「不変条件と承認待ち」の区画（T-024）。GET /api/governance/kernel/invariants から裁判所が書き出した写しを取って表示する。
// この写しは表示用で、承認の効力を与えない（承認はオーナーの approve-spec.sh）。この部品に承認の操作は置かない。
// 取るのはマウントごとに1回だけ（ポーリングしない）。受け取った値は pickKernelInvariants で検証し直してから使う。

import { useEffect, useState } from "react";
import {
  pickKernelInvariants,
  summarizeInvariants,
  type KernelInvariants as KernelInvariantsData,
} from "@/lib/kernel-invariants-schema";
import { formatJst } from "@/lib/kernel-state-schema";

type LoadState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "error" }
  | { kind: "ok"; data: KernelInvariantsData };

// 不変条件の文（固定の対応）
const INVARIANT_TEXTS = new Map<string, string>([
  ["INV-01", "行政 AI は自分自身の権限を拡張できない"],
  ["INV-02", "司法 AI は自らが検証する実装を直接修正しない"],
  ["INV-03", "AI の委任によって権限が増加しない"],
  ["INV-04", "重大な違反時は通常の自律実行より停止を優先する"],
  ["INV-05", "必須の司法検証を行政 AI の自己評価で代替できない"],
  ["INV-06", "承認は対象・範囲・法律の版に結び付く"],
  ["INV-07", "自動の再試行には有限の上限がある"],
  ["INV-08", "モデルの性能向上で利用権限が自動で広がらない"],
  ["INV-09", "モデルの切り戻しを成果物の復旧と同一視しない"],
  ["INV-10", "重大な仕様変更は正規の立法・承認の手続きを経る"],
  ["INV-11", "検証・是正・承認・委任・モデル切替を監査できる"],
  ["INV-12", "独立した作業は他の承認待ちだけで止まらない"],
]);

const STATUS_LABELS: Record<KernelInvariantsData["invariants"][number]["status"], string> = {
  enforced: "強制",
  partial: "一部",
  not_applicable: "対象外",
};

const PENDING_LABELS: Record<KernelInvariantsData["pending_approvals"][number]["status"], string> = {
  ready: "準備",
  in_progress: "作業中",
  review: "申請中",
  blocked: "止まっている",
};

function VerifiedCell({ verified }: { verified: boolean | null }) {
  if (verified === null) return <>—</>;
  return verified ? (
    <span className="text-emerald-700 dark:text-emerald-400">合格</span>
  ) : (
    <span className="text-red-700 dark:text-red-400">不合格</span>
  );
}

export default function KernelInvariants() {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  // マウントごとに1回だけ取る。unmount で中断し、中断の後は state を更新しない
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      try {
        const r = await fetch("/api/governance/kernel/invariants", { cache: "no-store", signal });
        if (signal.aborted) return;
        if (!r.ok) {
          setLoad({ kind: "error" });
          return;
        }
        const body: unknown = await r.json();
        if (signal.aborted) return;
        if (typeof body !== "object" || body === null || !("invariants" in body)) {
          setLoad({ kind: "error" });
          return;
        }
        const raw = (body as { invariants: unknown }).invariants;
        if (raw === null) {
          setLoad({ kind: "none" });
          return;
        }
        const data = pickKernelInvariants(raw);
        setLoad(data === null ? { kind: "error" } : { kind: "ok", data });
      } catch {
        if (!signal.aborted) setLoad({ kind: "error" });
      }
    })();
    return () => controller.abort();
  }, []);

  if (load.kind === "loading") {
    return <section aria-label="不変条件と承認待ち" aria-busy="true" />;
  }
  if (load.kind === "none") {
    return (
      <section aria-label="不変条件と承認待ち">
        <p className="text-sm text-zinc-500">
          不変条件の書き出しがありません（裁判所が p0.4.4 より前か、この環境では公開していません）
        </p>
      </section>
    );
  }
  if (load.kind === "error") {
    return (
      <section aria-label="不変条件と承認待ち">
        <p className="text-sm text-zinc-500">不変条件を読めませんでした</p>
      </section>
    );
  }

  const { data } = load;
  const s = summarizeInvariants(data);

  return (
    <section
      aria-label="不変条件と承認待ち"
      className="flex flex-col gap-4 rounded border border-zinc-200 p-4 dark:border-zinc-700"
    >
      {/* 0. 書き出し日時 */}
      <p className="text-xs text-zinc-500">
        書き出し：{formatJst(data.generated_at)}（取得した時点の写し。最新は読み込み直す）
      </p>

      {/* 1. 見出しと要約 */}
      <div>
        <h2 className="text-sm font-medium text-zinc-500">不変条件（INV-01〜12）</h2>
        <p className="mt-1 text-sm tabular-nums">
          強制 {s.enforced}・一部 {s.partial}・対象外 {s.notApplicable}。最後の適合性テストで合格 {s.passed}・不合格 {s.failed}
        </p>
      </div>

      {/* 2. 表（invariants の順のまま） */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-zinc-500">
            <tr>
              <th className="py-1 pr-3 font-medium">ID</th>
              <th className="py-1 pr-3 font-medium">不変条件</th>
              <th className="py-1 pr-3 font-medium">状態</th>
              <th className="py-1 pr-3 font-medium">判例</th>
              <th className="py-1 font-medium">結果</th>
            </tr>
          </thead>
          <tbody>
            {data.invariants.map((row, i) => (
              <tr key={`${row.id}-${i}`} className="border-t border-zinc-200 align-top dark:border-zinc-700">
                <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{row.id}</td>
                <td className="py-1.5 pr-3 text-zinc-600 dark:text-zinc-300">{INVARIANT_TEXTS.get(row.id) ?? "—"}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{STATUS_LABELS[row.status]}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">{row.tests} 件</td>
                <td className="py-1.5 whitespace-nowrap">
                  <VerifiedCell verified={row.verified} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-zinc-500">
        {data.verified_by
          ? `結果は稼働中の Kernel（${data.verified_by.kernel_version}、${formatJst(data.verified_by.at)}）の適合性テスト`
          : "稼働中の Kernel の今の版の適合性テストの記録がない"}
      </p>

      {/* 3. 注意 */}
      <p className="text-xs text-zinc-500">「強制」は判例で確かめたものだけ。一部と対象外の理由は docs/kernel.md §4b</p>

      {/* 4. 承認待ちの票。見出しの直下の1行は A0 の画面の文で、0件のときも出す */}
      <div>
        <h2 className="mb-1 text-sm font-medium text-zinc-500">承認待ちの票</h2>
        <p className="mb-1 text-xs text-zinc-500">この一覧は表示用で、承認の効力を与えない（承認はオーナーの approve-spec.sh）</p>
        {data.pending_approvals.length === 0 ? (
          <p className="text-sm text-zinc-500">承認待ちの票はありません</p>
        ) : (
          <ul className="text-sm">
            {data.pending_approvals.map((p, i) => (
              <li key={`${p.task}-${i}`}>
                {p.task}・{PENDING_LABELS[p.status]}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
