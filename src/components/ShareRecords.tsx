"use client";

// 本人の共有の記録と取り下げの画面（T-014、M9-5）。GET /api/shares の records を新しい順に表で見せ、
// 承認済みの行は取り下げられる（POST /api/shares/<id> に action: "withdraw"）。
// 本文・理由は React の文字列としてだけ描画する。console・localStorage などには書かない
// （localStorage は tsubuyaki.userId を読むだけ）。

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
// 型だけを読む（sharing.ts は DB を読むので、値は読み込まない）
import type { ShareCandidate } from "@/lib/sharing";
import { SEND_FAILURE, decideFailureMessage, decisionBody, decisionName, decisionTime, errorName, formatDateTime } from "@/components/ShareReview";

const USER_KEY = "tsubuyaki.userId";

/** 取り下げに固有の失敗（A5）。status と error の組が合うときだけこの文 */
const WITHDRAW_FAILURES: ReadonlyMap<string, { status: number; message: string }> = new Map([
  ["not_approved", { status: 409, message: "この共有はすでに取り下げ済みか、承認されていません" }],
]);

/** 状態の列（A5） */
function statusLabel(c: ShareCandidate): string {
  switch (c.status) {
    case "pending":
      return "未決定";
    case "approved":
      return decisionName(c);
    case "rejected":
      return "却下";
    case "withdrawn":
      return "取り下げ";
    default:
      return "";
  }
}

export default function ShareRecords() {
  const userIdRef = useRef("newcomer_a");
  const [records, setRecords] = useState<ShareCandidate[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // 読み直しの世代。古い読み込みの結果は捨てる
  const generation = useRef(0);

  const load = useCallback(async () => {
    generation.current += 1;
    const gen = generation.current;
    try {
      const r = await fetch(`/api/shares?userId=${encodeURIComponent(userIdRef.current)}`, { cache: "no-store" });
      const d: unknown = await r.json().catch(() => null);
      if (gen !== generation.current) return;
      const list = d && typeof d === "object" ? (d as { records?: unknown }).records : undefined;
      if (!r.ok || !Array.isArray(list)) throw new Error("shape");
      // 新しい順（id の降順）に並べる。元の配列は変えない
      setRecords([...(list as ShareCandidate[])].sort((a, b) => b.id - a.id));
      setLoadError(false);
    } catch {
      if (gen !== generation.current) return;
      setRecords(null);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    // ユーザーは描画の後に読む（既存の画面と同じ）。state の更新は fetch の後、非同期で起きる
    userIdRef.current = window.localStorage.getItem(USER_KEY) ?? "newcomer_a";
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function withdraw(id: number) {
    if (!window.confirm("この共有を取り下げますか？チームの知恵から外れます。")) return;
    setBusyId(id);
    setActionError(null);
    try {
      const r = await fetch(`/api/shares/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userIdRef.current, action: "withdraw" }),
      });
      const d: unknown = await r.json().catch(() => null);
      if (r.ok) {
        await load();
      } else {
        setActionError(decideFailureMessage(r.status, errorName(d), WITHDRAW_FAILURES));
      }
    } catch {
      setActionError(SEND_FAILURE);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4 sm:p-6">
      <header>
        <Link href="/" className="text-sm text-zinc-500 underline">← 作業画面へ</Link>
        <h1 className="mt-1 text-xl font-semibold">共有の記録</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">自分が共有の確認をした記録です。承認した共有は取り下げられます</p>
      </header>

      {actionError && <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-900">{actionError}</p>}

      {loadError ? (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">共有の記録を読めませんでした</p>
      ) : records === null ? (
        <p className="text-sm text-zinc-500">読み込み中…</p>
      ) : records.length === 0 ? (
        <p className="text-sm text-zinc-500">まだ共有の記録はありません</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-xs text-zinc-500 dark:border-zinc-600">
                <th className="p-2">作業名</th>
                <th className="p-2">作成日時</th>
                <th className="p-2">状態</th>
                <th className="p-2">日時</th>
                <th className="p-2">本文</th>
                <th className="p-2">却下の理由</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {records.map((c) => (
                <tr key={c.id} className="border-b border-zinc-200 align-top dark:border-zinc-700">
                  <td className="break-words p-2">{c.task_name}</td>
                  <td className="whitespace-nowrap p-2 font-mono text-xs">{formatDateTime(c.created_at)}</td>
                  <td className="whitespace-nowrap p-2">{statusLabel(c)}</td>
                  <td className="whitespace-nowrap p-2 font-mono text-xs">{c.status === "pending" ? "" : formatDateTime(decisionTime(c))}</td>
                  <td className="whitespace-pre-wrap break-words p-2">{decisionBody(c)}</td>
                  <td className="break-words p-2">{c.reject_reason ?? ""}</td>
                  <td className="p-2">
                    {c.status === "approved" && (
                      <button
                        type="button"
                        onClick={() => void withdraw(c.id)}
                        disabled={busyId !== null}
                        className="whitespace-nowrap rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
                      >
                        {busyId === c.id ? "送信中…" : "取り下げる"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
