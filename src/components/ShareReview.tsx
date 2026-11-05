"use client";

// S-3 共有候補の確認の画面（T-014、M9-1・M9-2・M9-4・M6-3・M6-4）。
// 作業の整理結果から作った共有候補を本人が確かめ、機密の検出箇所は抽象化の案を選んで置き換え、
// 「このまま承認」「編集して承認」「却下」を選ぶ。裏側は /api/sessions/[id]/share と /api/shares（T-010）。
// 本文・検出語・理由は React の文字列としてだけ描画する。console・localStorage などには書かない
// （localStorage は tsubuyaki.userId を読むだけ）。

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
// 型だけを読む（sharing.ts は DB を読むので、値は読み込まない）
import type { ShareCandidate } from "@/lib/sharing";
import { describeFlags, detectSensitive, type Flag } from "@/lib/sensitive";
import { applyAbstractions, previewAbstraction, proposeAbstractions } from "@/lib/abstraction";

const USER_KEY = "tsubuyaki.userId";
/** 本文と理由の長さの上限（サーバー側の上限と同じ。送る前に画面で確かめる） */
const MAX_BODY_LENGTH = 2000;
const MAX_REASON_LENGTH = 500;

const STALE_MESSAGE = "整理をやり直したため、この候補は古くなりました。画面を開き直してください";
export const SEND_FAILURE = "送信できませんでした。もう一度試してください";

type DecideAction = "approve" | "edit_approve" | "reject";

/** POST /api/shares/<id> に送る内容（userId を除く） */
type DecidePayload = { action: DecideAction; body?: string; reason?: string };

/** flagged_body を受けた送信。確認ボタンはこの組をそのまま confirmFlagged: true で送り直す */
type PendingConfirm = { candidateId: number; payload: DecidePayload; textAtSend: string; flags: Flag[] };

/** 保存された時刻（JST の ISO 文字列）を「11/3 13:05」にする。保存された時刻のまま */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))} ${iso.slice(11, 16)}`;
}

/** 承認の決定の名前（A4） */
function approvalName(action: ShareCandidate["action"]): string {
  if (action === "approve") return "このまま承認";
  if (action === "edit_approve") return "編集して承認";
  return "承認";
}

/** 決定の名前（A4 の表）。pending は「未決定」 */
export function decisionName(c: ShareCandidate): string {
  switch (c.status) {
    case "approved":
      return approvalName(c.action);
    case "rejected":
      return "却下";
    case "withdrawn":
      return `取り下げ済み（${approvalName(c.action)}）`;
    default:
      return "未決定";
  }
}

/** A4 の表の「日時」 */
export function decisionTime(c: ShareCandidate): string | null {
  if (c.status === "withdrawn") return c.withdrawn_at;
  if (c.status === "approved" || c.status === "rejected") return c.decided_at;
  return null;
}

/** A4 の表の「本文」 */
export function decisionBody(c: ShareCandidate): string {
  return c.status === "approved" || c.status === "withdrawn" ? (c.final_body ?? "") : c.draft_body;
}

/** A4 の表の「1行」 */
function decisionLine(c: ShareCandidate): string {
  if (c.status === "approved") return "チームの知恵に入りました";
  if (c.status === "rejected") return "チームの知恵には入りません";
  if (c.status === "withdrawn") return "チームの知恵から外しました";
  return "";
}

/** 応答の error（文字列でなければ null） */
export function errorName(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const e = (body as { error?: unknown }).error;
  return typeof e === "string" ? e : null;
}

/** 応答の candidate の形を確かめる（崩れていれば null） */
function parseCandidate(body: unknown): ShareCandidate | null {
  if (!body || typeof body !== "object") return null;
  const c = (body as { candidate?: unknown }).candidate as ShareCandidate | undefined;
  if (!c || typeof c !== "object" || typeof c.id !== "number" || typeof c.draft_body !== "string" || typeof c.status !== "string") {
    return null;
  }
  return c;
}

/** 候補の作成の失敗の文（A2） */
function createFailureMessage(error: string): string {
  switch (error) {
    case "session_active":
      return "作業が終わってから共有できます";
    case "no_summary":
      return "先に整理を実行してください";
    case "nothing_to_share":
      return "共有できる項目がありません（つまずき・解決・判断の理由・学びがすべて『なし』）";
    case "not_your_session":
      return "本人の作業だけを共有できます";
    default:
      return `共有候補を作れませんでした（${error}）`;
  }
}

/**
 * 決定の送信の失敗の文（A3 の 6。flagged_body・stale_candidate は呼び出し側で扱う）。
 * status と error の組が表のとおりのときだけ固有の文。それ以外は固定の文
 */
const DECIDE_FAILURES: ReadonlyMap<string, { status: number; message: string }> = new Map([
  ["already_decided", { status: 409, message: "この候補はすでに決定済みです" }],
  ["empty_body", { status: 400, message: "本文が空です" }],
  ["body_too_long", { status: 400, message: "本文が長すぎます（2000文字まで）" }],
  ["reason_too_long", { status: 400, message: "理由が長すぎます（500文字まで）" }],
  ["not_your_share", { status: 403, message: "本人の候補だけを決定できます" }],
]);

export function decideFailureMessage(status: number, error: string | null, extra?: ReadonlyMap<string, { status: number; message: string }>): string {
  if (error === null) return SEND_FAILURE;
  const known = DECIDE_FAILURES.get(error) ?? extra?.get(error);
  return known && known.status === status ? known.message : SEND_FAILURE;
}

function Notices() {
  return (
    <div className="flex flex-col gap-2">
      <p role="note" className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        共有した内容は人事評価に使いません。チームの次の人のための知恵として使います。
      </p>
      <p role="note" className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        機密の検査はパターンによるもので、取りこぼすことがあります。完全な匿名化はできません。
      </p>
    </div>
  );
}

/** 決定済みの表示（A4）。操作は出さない */
function DecidedView({ candidate }: { candidate: ShareCandidate }) {
  const ok = candidate.status === "approved";
  return (
    <section aria-label="決定" className="flex flex-col gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-700">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{decisionName(candidate)}</span>
        <span className="font-mono text-zinc-500">{formatDateTime(decisionTime(candidate))}</span>
      </div>
      {candidate.status === "rejected" && candidate.reject_reason && (
        <p className="break-words text-sm text-zinc-600 dark:text-zinc-300">理由：{candidate.reject_reason}</p>
      )}
      <p className="whitespace-pre-wrap break-words rounded bg-zinc-50 p-2 text-sm dark:bg-zinc-900">{decisionBody(candidate)}</p>
      <p
        className={
          ok
            ? "rounded border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100"
            : "rounded border border-zinc-300 bg-zinc-50 p-2 text-sm text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
        }
      >
        {decisionLine(candidate)}
      </p>
      <Link href="/shares" className="text-sm underline">共有の記録を見る</Link>
    </section>
  );
}

export default function ShareReview({ sessionId }: { sessionId: number }) {
  const userIdRef = useRef("newcomer_a");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<ShareCandidate | null>(null);
  const [body, setBody] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  useEffect(() => {
    // ユーザーは描画の後に読む（既存の画面と同じ。新しい保存先は作らない）
    userIdRef.current = window.localStorage.getItem(USER_KEY) ?? "newcomer_a";
    const userId = userIdRef.current;
    let cancelled = false;
    (async () => {
      // 1) この作業の承認済みの記録があれば、それを表示して POST は呼ばない（二重に承認しない）
      try {
        const r = await fetch(`/api/shares?userId=${encodeURIComponent(userId)}`, { cache: "no-store" });
        const d: unknown = await r.json().catch(() => null);
        if (cancelled) return;
        const records = d && typeof d === "object" ? (d as { records?: unknown }).records : undefined;
        if (!r.ok || !Array.isArray(records)) {
          setLoadError("共有の記録を読めませんでした");
          return;
        }
        let latestApproved: ShareCandidate | null = null;
        for (const rec of records as ShareCandidate[]) {
          if (rec && rec.session_id === sessionId && rec.status === "approved" && (latestApproved === null || rec.id > latestApproved.id)) {
            latestApproved = rec;
          }
        }
        if (latestApproved) {
          setCandidate(latestApproved);
          return;
        }
      } catch {
        if (!cancelled) setLoadError("共有の記録を読めませんでした");
        return;
      }
      // 2) 候補を作る（同じ版の未決定の候補があれば、それが返る）
      try {
        const r = await fetch(`/api/sessions/${sessionId}/share`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId }),
        });
        const d: unknown = await r.json().catch(() => null);
        if (cancelled) return;
        const c = r.ok ? parseCandidate(d) : null;
        if (!c) {
          setLoadError(createFailureMessage(errorName(d) ?? `HTTP ${r.status}`));
          return;
        }
        setCandidate(c);
        setBody(c.draft_body);
      } catch {
        if (!cancelled) setLoadError(createFailureMessage("通信の失敗"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // 抽象化の案は、textarea の今の本文から作る。プレビューと置き換えは、この同じ本文・同じ案・同じ選択を使う
  const proposals = useMemo(() => proposeAbstractions(body, detectSensitive(body)), [body]);
  const preview = useMemo(() => previewAbstraction(body, proposals, selected), [body, proposals, selected]);

  /** 本文が変わったとき：案は useMemo で作り直す。選択と確認待ちはすべて消す */
  function changeBody(next: string) {
    setBody(next);
    setSelected([]);
    setPendingConfirm(null);
    setSendError(null);
  }

  function toggle(id: string, on: boolean) {
    setSelected((s) => (on ? (s.includes(id) ? s : [...s, id]) : s.filter((x) => x !== id)));
  }

  function replaceSelected() {
    changeBody(applyAbstractions(body, proposals, selected));
  }

  async function send(candidateId: number, payload: DecidePayload, confirmFlagged: boolean) {
    const textAtSend = body;
    setSubmitting(true);
    setSendError(null);
    setPendingConfirm(null);
    try {
      const r = await fetch(`/api/shares/${candidateId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userIdRef.current, ...payload, ...(confirmFlagged ? { confirmFlagged: true } : {}) }),
      });
      const d: unknown = await r.json().catch(() => null);
      if (r.ok) {
        const c = parseCandidate(d);
        if (c) {
          setCandidate(c);
        } else {
          setSendError(SEND_FAILURE);
        }
        return;
      }
      const error = errorName(d);
      if (r.status === 409 && error === "flagged_body") {
        // 自動では送り直さない。この送信の組に結び付けた確認を出す
        const raw = (d as { flags?: unknown }).flags;
        setPendingConfirm({ candidateId, payload, textAtSend, flags: Array.isArray(raw) ? (raw as Flag[]) : [] });
        return;
      }
      if (r.status === 409 && error === "stale_candidate") {
        setCandidate((c) => (c && c.id === candidateId ? { ...c, stale: true } : c));
        setSendError(STALE_MESSAGE);
        return;
      }
      setSendError(decideFailureMessage(r.status, error));
    } catch {
      setSendError(SEND_FAILURE);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) {
    return (
      <Shell sessionId={sessionId}>
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">{loadError}</p>
      </Shell>
    );
  }
  if (!candidate) {
    return (
      <Shell sessionId={sessionId}>
        <p className="text-sm text-zinc-500">読み込み中…</p>
      </Shell>
    );
  }
  if (candidate.status !== "pending") {
    return (
      <Shell sessionId={sessionId}>
        <Notices />
        <DecidedView candidate={candidate} />
      </Shell>
    );
  }

  const c = candidate;

  // 古くなった候補（A3 の 3。開いたときの stale と、409 stale_candidate を受けたときの両方）：
  // 注意書き・共有される本文（編集不可）・「原文のメモは共有されません」と古くなった旨だけを出す。
  // 抽象化の案・プレビュー・置き換え・承認・却下・flagged_body の確認の操作は描画しない
  if (c.stale) {
    return (
      <Shell sessionId={sessionId}>
        <Notices />
        <section aria-label="共有される本文" className="flex flex-col gap-2">
          <h2 className="text-base font-medium">共有される本文</h2>
          <p className="text-xs text-zinc-500">原文のメモは共有されません</p>
          <textarea
            value={body}
            readOnly
            rows={8}
            className="w-full rounded border border-zinc-300 bg-zinc-50 p-2 text-sm text-zinc-600 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
          />
        </section>
        <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          {STALE_MESSAGE}
        </p>
      </Shell>
    );
  }

  const tooLong = body.length > MAX_BODY_LENGTH;
  const bodyOk = body.length > 0 && !tooLong;
  const reasonTooLong = reason.length > MAX_REASON_LENGTH;
  const canApprove = !submitting && bodyOk && body === c.draft_body;
  const canEditApprove = !submitting && bodyOk && body !== c.draft_body;
  const canReject = !submitting && !reasonTooLong;
  // 確認ボタンは、flagged_body を受けた送信と同じ候補・同じ本文のときだけ出す
  const confirm = pendingConfirm && pendingConfirm.candidateId === c.id && pendingConfirm.textAtSend === body ? pendingConfirm : null;

  return (
    <Shell sessionId={sessionId}>
      <Notices />

      <section aria-label="共有される本文" className="flex flex-col gap-2">
        <h2 className="text-base font-medium">共有される本文</h2>
        <p className="text-xs text-zinc-500">原文のメモは共有されません</p>
        <textarea
          value={body}
          onChange={(e) => changeBody(e.target.value)}
          disabled={submitting}
          rows={8}
          className="w-full rounded border border-zinc-300 p-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
        />
        <p className="text-xs text-zinc-500">{body.length} / {MAX_BODY_LENGTH} 文字</p>
        {tooLong && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">本文が長すぎます（2000文字まで）</p>
        )}
      </section>

      {proposals.length > 0 && (
        <section aria-label="抽象化の案" className="flex flex-col gap-2 rounded border border-amber-300 p-3 dark:border-amber-700">
          <h2 className="text-base font-medium">抽象化の案</h2>
          <p className="text-sm text-amber-900 dark:text-amber-100">{describeFlags(detectSensitive(body))}。置き換える案を選んでください（自動では置き換えません）</p>
          <ul className="flex flex-col gap-1 text-sm">
            {proposals.map((p) => (
              <li key={p.id}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    onChange={(e) => toggle(p.id, e.target.checked)}
                    disabled={submitting}
                  />
                  <span className="break-words font-mono">{p.original}</span>
                  <span aria-hidden>→</span>
                  <span className="break-words">{p.replacement}</span>
                </label>
              </li>
            ))}
          </ul>
          {selected.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <h3 className="text-xs font-medium text-zinc-500">置き換える前</h3>
                <p className="whitespace-pre-wrap break-words rounded bg-zinc-50 p-2 text-sm dark:bg-zinc-900">{preview.before}</p>
              </div>
              <div>
                <h3 className="text-xs font-medium text-zinc-500">置き換えた後</h3>
                <p className="whitespace-pre-wrap break-words rounded bg-zinc-50 p-2 text-sm dark:bg-zinc-900">{preview.after}</p>
              </div>
            </div>
          )}
          <div>
            <button
              type="button"
              onClick={replaceSelected}
              disabled={submitting || selected.length === 0}
              className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
            >
              選んだ案で置き換える
            </button>
          </div>
        </section>
      )}

      <section aria-label="決定" className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void send(c.id, { action: "approve" }, false)}
              disabled={!canApprove}
              className="rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              このまま承認
            </button>
            <button
              type="button"
              onClick={() => void send(c.id, { action: "edit_approve", body }, false)}
              disabled={!canEditApprove}
              className="rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              編集して承認
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
              placeholder="却下の理由（任意）"
              className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-900"
            />
            <button
              type="button"
              onClick={() => void send(c.id, { action: "reject", reason }, false)}
              disabled={!canReject}
              className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
            >
              却下
            </button>
          </div>
          {reasonTooLong && <p role="alert" className="text-sm text-red-700 dark:text-red-300">理由が長すぎます（500文字まで）</p>}
          {confirm && (
            <div role="alert" className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
              <p className="break-words">機密情報らしい文字列が残っています：{describeFlags(confirm.flags)}</p>
              <div>
                <button
                  type="button"
                  onClick={() => void send(confirm.candidateId, confirm.payload, true)}
                  disabled={submitting}
                  className="rounded border border-amber-400 bg-white px-3 py-1 text-sm text-amber-900 disabled:opacity-50 dark:bg-amber-900 dark:text-amber-50"
                >
                  このまま承認する
                </button>
              </div>
            </div>
          )}
          {sendError && <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-900">{sendError}</p>}
      </section>
    </Shell>
  );
}

function Shell({ sessionId, children }: { sessionId: number; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4 sm:p-6">
      <header>
        <Link href={`/sessions/${sessionId}`} className="text-sm text-zinc-500 underline">← 整理結果へ</Link>
        <h1 className="mt-1 text-xl font-semibold">チームに共有する</h1>
      </header>
      {children}
    </div>
  );
}
