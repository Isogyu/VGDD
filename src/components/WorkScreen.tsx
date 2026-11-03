"use client";

// S-1 作業画面（M1：作業開始、現在の作業、M1-4 のヒント。M2・M3・M10 は後の繰り返しで足す）
// クライアント側で API を叩く。時刻の文字列はサーバー（JST）のものをそのまま表示する。

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseCommand, normalizeTaskName } from "@/lib/commands";
import { restoreSubmitted } from "@/lib/input";
import type { User } from "@/lib/db";
import type { WorkSession, Note, KnowledgeHints, HistoryItem } from "@/lib/sessions";
import { formatHm, formatMdHm, formatDuration, formatDelta } from "@/lib/time";

interface ActiveResponse {
  session: WorkSession | null;
  notes: Note[];
  elapsedMin: number;
  now: string;
}

type Pending = { taskName: string; known: string; unknown: string; active: WorkSession };

const USER_KEY = "tsubuyaki.userId";

export default function WorkScreen() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState<string>("");
  const [active, setActive] = useState<ActiveResponse | null>(null);
  const [hints, setHints] = useState<KnowledgeHints | null>(null);
  const [input, setInput] = useState("");
  const [showKnown, setShowKnown] = useState(false);
  const [known, setKnown] = useState("");
  const [unknown, setUnknown] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endUnknown, setEndUnknown] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  // ユーザー一覧と、前回選んだユーザー
  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then((d: { users: User[] }) => {
        setUsers(d.users);
        const saved = typeof window !== "undefined" ? window.localStorage.getItem(USER_KEY) : null;
        setUserId(saved && d.users.some((u) => u.id === saved) ? saved : d.users[0]?.id ?? "");
      })
      .catch(() => setMessage("ユーザー一覧を取得できませんでした"));
  }, []);

  // 進行中の作業の取得。userId の変更、reloadKey の更新（開始後・1分ごと）で取り直す
  const [reloadKey, setReloadKey] = useState(0);
  const reloadActive = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!userId) return;
    window.localStorage.setItem(USER_KEY, userId);
    let cancelled = false;
    (async () => {
      const [r, h] = await Promise.all([
        fetch(`/api/sessions/active?userId=${encodeURIComponent(userId)}`),
        fetch(`/api/sessions/history?userId=${encodeURIComponent(userId)}&limit=5`),
      ]);
      if (cancelled) return;
      if (r.ok) setActive((await r.json()) as ActiveResponse);
      if (h.ok) setHistory(((await h.json()) as { sessions: HistoryItem[] }).sessions);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, reloadKey]);

  /** ユーザー切替（セレクタのイベント）。前のユーザーの表示をその場で消し、読み込み中にする */
  function selectUser(id: string) {
    if (id === userId) return;
    setActive(null);
    setHistory([]);
    setConfirmEnd(false);
    setLoading(true);
    setHints(null);
    setPending(null);
    setMessage(null);
    setInput("");
    setUserId(id);
  }

  // 経過時間：サーバー（JST）が計算した elapsedMin を使い、1分ごとに取り直す（クライアントの時計に依存しない）
  useEffect(() => {
    const id = setInterval(reloadActive, 60_000);
    return () => clearInterval(id);
  }, [reloadActive]);
  const elapsedMin = active?.elapsedMin ?? 0;

  /**
   * 送信した瞬間に、送信分を入力欄から消す（保存の完了を待たない）。
   * 1件目の保存中に2件目を打って送信しても結合しないようにするため（2026-11-03 の不具合）。
   * 失敗したときは restoreSubmitted で戻す。
   */
  function takeInput(): string {
    const submitted = input;
    setInput("");
    return submitted;
  }
  function giveBack(submitted: string) {
    setInput((prev) => restoreSubmitted(prev, submitted));
  }

  async function start(taskName: string, force: boolean, submittedText: string) {
    setBusy(true);
    setMessage(null);
    let succeeded = false;
    try {
      const r = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, taskName, force, known: known || undefined, unknown: unknown || undefined }),
      });
      const d = await r.json();
      if (r.status === 409) {
        // 確認ダイアログへ。入力欄は空のまま（作業名は pending に保持）
        succeeded = true;
        setPending({ taskName, known, unknown, active: d.active as WorkSession });
        return;
      }
      if (!r.ok) {
        setMessage(`開始できませんでした（${d.error ?? r.status}）`);
        return;
      }
      succeeded = true;
      setHints(d.hints as KnowledgeHints);
      setKnown("");
      setUnknown("");
      setShowKnown(false);
      setPending(null);
      if (d.endedPrevious) {
        const p = d.endedPrevious as WorkSession;
        setMessage(`「${p.task_name}」を終了しました（所要 ${formatDuration(p.duration_min)}）。`);
      }
      reloadActive();
    } catch {
      setMessage("開始できませんでした（通信エラー）");
    } finally {
      if (!succeeded) giveBack(submittedText);
      setBusy(false);
    }
  }

  /** 作業中のメモを保存する（M2-1）。保存のたびに機密検査が走り、該当があれば警告を出す（M2-3） */
  async function addMemo(body: string, submittedText: string) {
    if (!session) {
      giveBack(submittedText);
      setMessage("先に作業を始めてください。例：「月次レポート改修の作業開始」");
      return;
    }
    setBusy(true);
    setMessage(null);
    let succeeded = false;
    try {
      const r = await fetch(`/api/sessions/${session.id}/notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, body }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMessage(`保存できませんでした（${d.error ?? r.status}）`);
        return;
      }
      succeeded = true;
      if (d.warning) {
        setMessage(`注意：${d.warning}。保存はしましたが、AI に送る前に確認を求めます。パターンで取りこぼす情報もあります`);
      }
      reloadActive();
    } catch {
      setMessage("保存できませんでした（通信エラー）");
    } finally {
      if (!succeeded) giveBack(submittedText);
      setBusy(false);
    }
  }

  /** 作業終了（M3-1）。所要時間を表示する。AI 整理（M4）はここに接続する予定 */
  async function endWork(submittedText: string) {
    if (!session) {
      giveBack(submittedText);
      return;
    }
    setBusy(true);
    setEnding(true);
    setMessage(null);
    let succeeded = false;
    try {
      const r = await fetch(`/api/sessions/${session.id}/end`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, unknown: endUnknown || undefined }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMessage(`終了できませんでした（${d.error ?? r.status}）`);
        return;
      }
      succeeded = true;
      const s = d.session as WorkSession;
      const h = d.history as HistoryItem | null;
      setConfirmEnd(false);
      setEndUnknown("");
      setHints(null);
      const delta = h?.delta_min != null ? `（${formatDelta(h.delta_min)}）` : "";
      setMessage(`「${s.task_name}」を終了しました。所要 ${formatDuration(s.duration_min)}${delta}、メモ ${d.noteCount} 件。AI 整理に移ります…`);
      reloadActive();
      // M3-2：終了後は整理結果の画面（S-2）へ移り、そこで自動で AI 整理を始める
      router.push(`/sessions/${s.id}`);
    } catch {
      setMessage("終了できませんでした（通信エラー）");
    } finally {
      if (!succeeded) giveBack(submittedText);
      setBusy(false);
      setEnding(false);
    }
  }

  /** 本人のメモを削除する（確認のあと）。誤って入れた機密を AI に送る前に消す用途 */
  async function removeNote(noteId: number) {
    setBusy(true);
    try {
      const r = await fetch(`/api/notes/${noteId}?userId=${encodeURIComponent(userId)}`, { method: "DELETE" });
      if (!r.ok) setMessage("削除できませんでした");
      setDeleting(null);
      reloadActive();
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return; // 保存中の二重送信は受け付けない（入力欄には打ち続けられる）
    const cmd = parseCommand(input);
    if (cmd.type === "empty") {
      setMessage(session ? "メモを入れてください" : "作業名を入れてください。例：「月次レポート改修の作業開始」");
      return;
    }
    if (cmd.type === "end" && !session) {
      setMessage("進行中の作業がありません");
      return;
    }
    const submitted = takeInput();
    if (cmd.type === "start") {
      void start(cmd.taskName, false, submitted);
      return;
    }
    if (cmd.type === "end") {
      void endWork(submitted);
      return;
    }
    void addMemo(cmd.body, submitted);
  }

  function onStartButton() {
    if (busy) return;
    const cmd = parseCommand(input);
    const taskName = cmd.type === "start" ? cmd.taskName : normalizeTaskName(input);
    if (!taskName) {
      setMessage("作業名を入れてから「開始」を押してください");
      return;
    }
    void start(taskName, false, takeInput());
  }

  const session = active?.session ?? null;
  const currentUser = users.find((u) => u.id === userId);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">つぶやき業務ログ</h1>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">ユーザー</span>
          <select
            className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            value={userId}
            onChange={(e) => selectUser(e.target.value)}
            aria-label="ユーザーを選ぶ"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name}（{u.role === "senior" ? "先輩" : "新人"}）
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="grid flex-1 gap-4 md:grid-cols-[1fr_320px]">
        {/* 左：入力とフィード */}
        <section className="flex flex-col gap-3">
          <form onSubmit={onSubmit} className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                className="flex-1 rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
                placeholder={session ? "作業中のつぶやきを書く（例：エラーの原因が分からない）" : "例：月次レポート改修の作業開始"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                aria-label="入力"
              />
              <button
                type="submit"
                className="rounded bg-zinc-800 px-3 py-2 text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-black"
                disabled={busy}
              >
                送信
              </button>
              {!session && (
                <button
                  type="button"
                  onClick={onStartButton}
                  className="rounded border border-zinc-400 px-3 py-2 disabled:opacity-50"
                  disabled={busy}
                  title="入力欄の文字列を作業名として開始する"
                >
                  開始
                </button>
              )}
            </div>

            {!session && !loading && (
              <div className="rounded border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/50">
                <button
                  type="button"
                  className="flex w-full items-center justify-between font-medium"
                  onClick={() => setShowKnown((v) => !v)}
                  aria-expanded={showKnown}
                  aria-controls="known-unknown-fields"
                >
                  <span>始める前に、いま分かっていること／分からないことを一言（任意）</span>
                  <span aria-hidden="true" className="text-zinc-500">
                    {showKnown ? "▲ 閉じる" : "▼ 開く"}
                  </span>
                </button>
                {showKnown && (
                  <div id="known-unknown-fields" className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label htmlFor="known-field" className="text-zinc-600 dark:text-zinc-300">
                        分かっていること
                      </label>
                      <textarea
                        id="known-field"
                        className="rounded border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-zinc-900"
                        rows={2}
                        value={known}
                        onChange={(e) => setKnown(e.target.value)}
                        placeholder="例：依頼者は経理部。出力は CSV"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label htmlFor="unknown-field" className="text-zinc-600 dark:text-zinc-300">
                        分からないこと
                      </label>
                      <textarea
                        id="unknown-field"
                        className="rounded border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-zinc-900"
                        rows={2}
                        value={unknown}
                        onChange={(e) => setUnknown(e.target.value)}
                        placeholder="例：既存のスクリプトがどこにあるか"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </form>

          {message && (
            <p role="status" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
              {message}
            </p>
          )}

          {pending && (
            <div role="dialog" aria-label="別の作業を始める確認" className="rounded border border-zinc-400 p-3 text-sm">
              <p>
                進行中の「{pending.active.task_name}」（{formatHm(pending.active.started_at)} 開始）があります。終了して「{pending.taskName}」を始めますか。
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded bg-zinc-800 px-3 py-1 text-white dark:bg-zinc-200 dark:text-black"
                  onClick={() => start(pending.taskName, true, "")}
                  disabled={busy}
                >
                  終了して始める
                </button>
                <button type="button" className="rounded border px-3 py-1" onClick={() => setPending(null)}>
                  取り消す
                </button>
              </div>
            </div>
          )}

          {hints && session && (
            <div className="rounded border border-sky-300 bg-sky-50 p-3 text-sm dark:border-sky-800 dark:bg-sky-950">
              <h2 className="font-medium">この作業の過去の記録とチームの知恵</h2>
              {hints.pastStruggles.length === 0 && hints.teamKnowledge.length === 0 ? (
                <p className="mt-1 text-zinc-600 dark:text-zinc-300">この作業名の記録はまだありません。初めての作業です。</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1">
                  {hints.pastStruggles.map((h) => (
                    <li key={`p${h.session_id}`}>
                      <span className="text-zinc-500">前回のつまずき（{formatMdHm(h.started_at)}）：</span>
                      {h.text}
                    </li>
                  ))}
                  {hints.teamKnowledge.map((k) => (
                    <li key={`k${k.id}`}>
                      <span className="text-zinc-500">チームの知識（{k.display_name}、{formatMdHm(k.approved_at)}）：</span>
                      {k.text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {session && active && active.notes.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {active.notes.map((n) => (
                <li key={n.id} className="flex gap-2">
                  <span className="shrink-0 font-mono text-zinc-500">{formatHm(n.created_at)}</span>
                  <span className="shrink-0 rounded bg-zinc-100 px-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {n.kind === "known" ? "分かっている" : n.kind === "unknown" ? "分からない" : n.kind === "answer" ? "答え" : "メモ"}
                  </span>
                  <span>{n.body}</span>
                  {n.flags_json && (
                    <span
                      className="shrink-0 rounded bg-amber-100 px-1 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100"
                      title="機密情報らしい文字列を検出。AI に送る前に確認します"
                    >
                      要確認
                    </span>
                  )}
                  {deleting === n.id ? (
                    <span className="ml-auto flex shrink-0 gap-1 text-xs">
                      <span className="text-zinc-500">削除しますか</span>
                      <button type="button" className="rounded bg-red-700 px-1 text-white" onClick={() => removeNote(n.id)} disabled={busy}>
                        削除
                      </button>
                      <button type="button" className="rounded border px-1" onClick={() => setDeleting(null)}>
                        取り消す
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="ml-auto shrink-0 text-xs text-zinc-400 hover:text-red-700"
                      onClick={() => setDeleting(n.id)}
                      aria-label={`メモ「${n.body.slice(0, 10)}」を削除`}
                      title="このメモを削除"
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 右：現在の作業 */}
        <aside className="flex flex-col gap-3 rounded border border-zinc-300 p-3 dark:border-zinc-700">
          <h2 className="text-sm font-medium text-zinc-500">現在の作業</h2>
          {loading ? (
            <p className="text-sm text-zinc-500" role="status">
              読み込み中…
            </p>
          ) : session ? (
            <>
              <p className="text-lg font-semibold">{session.task_name}</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-300">
                {formatMdHm(session.started_at)} 開始・経過 <span className="font-mono">{elapsedMin}</span> 分
              </p>
              <p className="text-xs text-zinc-500">{currentUser?.display_name} の作業</p>
              {ending ? (
                <p className="text-sm text-zinc-500" role="status">
                  終了しています…
                </p>
              ) : confirmEnd ? (
                <div className="flex flex-col gap-2 rounded border border-zinc-300 p-2 text-sm dark:border-zinc-700" role="dialog" aria-label="作業終了の確認">
                  <p>「{session.task_name}」を終了しますか（経過 {elapsedMin} 分）</p>
                  <label htmlFor="end-unknown" className="text-zinc-600 dark:text-zinc-300">
                    最後まで分からなかったこと（任意）
                  </label>
                  <textarea
                    id="end-unknown"
                    className="rounded border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-zinc-900"
                    rows={2}
                    value={endUnknown}
                    onChange={(e) => setEndUnknown(e.target.value)}
                    placeholder="例：出力形式の正式な条件"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded bg-zinc-800 px-3 py-1 text-white dark:bg-zinc-200 dark:text-black"
                      onClick={() => endWork("")}
                      disabled={busy}
                    >
                      終了する
                    </button>
                    <button type="button" className="rounded border px-3 py-1" onClick={() => setConfirmEnd(false)}>
                      取り消す
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="rounded border border-zinc-400 px-3 py-2 text-sm"
                  onClick={() => setConfirmEnd(true)}
                  disabled={busy}
                >
                  作業終了
                </button>
              )}
            </>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">作業を始めてください。「〇〇の作業開始」と入力するか、作業名を入れて「開始」を押します。</p>
          )}
          <button
            type="button"
            className="rounded border border-dashed border-zinc-400 px-3 py-2 text-sm text-zinc-400"
            disabled
            title="M10 で有効になります"
          >
            いまの理解を整理（M10 で有効）
          </button>

          <section className="mt-auto flex flex-col gap-1 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <h2 className="text-sm font-medium text-zinc-500">終了した作業（最新5件）</h2>
            {history.length === 0 ? (
              <p className="text-xs text-zinc-500">{loading ? "読み込み中…" : "まだありません"}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {history.map((s) => (
                  <li key={s.id} className="flex flex-col gap-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link href={`/sessions/${s.id}`} className="truncate underline-offset-2 hover:underline" title={`${s.task_name} の記録と AI 整理を見る`}>
                        {s.task_name}
                      </Link>
                      <span className="shrink-0 font-mono text-xs text-zinc-500">
                        {formatMdHm(s.started_at)} ・ {formatDuration(s.duration_min)}
                      </span>
                    </div>
                    {s.delta_min != null && (
                      <span
                        className={`self-end rounded px-1 text-xs ${
                          s.delta_min < 0
                            ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100"
                            : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        }`}
                        title="本人の同じ作業名の前回と比べた差。他の人とは比べません"
                      >
                        {formatDelta(s.delta_min)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
