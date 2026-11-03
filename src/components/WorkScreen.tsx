"use client";

// S-1 作業画面（M1：作業開始、現在の作業、M1-4 のヒント。M2・M3・M10 は後の繰り返しで足す）
// クライアント側で API を叩く。時刻の文字列はサーバー（JST）のものをそのまま表示する。

import { useCallback, useEffect, useState } from "react";
import { parseCommand, normalizeTaskName } from "@/lib/commands";
import type { User } from "@/lib/db";
import type { WorkSession, Note, KnowledgeHints } from "@/lib/sessions";
import { formatHm, formatMdHm } from "@/lib/time";

interface ActiveResponse {
  session: WorkSession | null;
  notes: Note[];
  elapsedMin: number;
  now: string;
}

type Pending = { taskName: string; known: string; unknown: string; active: WorkSession };

const USER_KEY = "tsubuyaki.userId";

export default function WorkScreen() {
  const [users, setUsers] = useState<User[]>([]);
  const [userId, setUserId] = useState<string>("");
  const [active, setActive] = useState<ActiveResponse | null>(null);
  const [hints, setHints] = useState<KnowledgeHints | null>(null);
  const [input, setInput] = useState("");
  const [showKnown, setShowKnown] = useState(false);
  const [known, setKnown] = useState("");
  const [unknown, setUnknown] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
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
      const r = await fetch(`/api/sessions/active?userId=${encodeURIComponent(userId)}`);
      if (cancelled) return;
      if (r.ok) setActive((await r.json()) as ActiveResponse);
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

  async function start(taskName: string, force: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, taskName, force, known: known || undefined, unknown: unknown || undefined }),
      });
      const d = await r.json();
      if (r.status === 409) {
        setPending({ taskName, known, unknown, active: d.active as WorkSession });
        return;
      }
      if (!r.ok) {
        setMessage(`開始できませんでした（${d.error ?? r.status}）`);
        return;
      }
      setHints(d.hints as KnowledgeHints);
      setInput("");
      setKnown("");
      setUnknown("");
      setShowKnown(false);
      setPending(null);
      if (d.endedPrevious) {
        const p = d.endedPrevious as WorkSession;
        setMessage(`「${p.task_name}」を終了しました（${p.duration_min} 分）。`);
      }
      reloadActive();
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cmd = parseCommand(input);
    if (cmd.type === "start") {
      void start(cmd.taskName, false);
      return;
    }
    if (cmd.type === "empty") {
      setMessage("作業名を入れてください。例：「月次レポート改修の作業開始」");
      return;
    }
    // メモ（M2）と終了（M3）は次の繰り返しで保存できるようにする。いまは保存しない
    setMessage(
      cmd.type === "end"
        ? "作業終了はまだ保存されません（M3 で実装します）"
        : "作業中のメモはまだ保存されません（M2 で実装します）",
    );
  }

  function onStartButton() {
    const cmd = parseCommand(input);
    const taskName = cmd.type === "start" ? cmd.taskName : normalizeTaskName(input);
    if (!taskName) {
      setMessage("作業名を入れてから「開始」を押してください");
      return;
    }
    void start(taskName, false);
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
                placeholder={session ? "作業中のつぶやきを書く（M2 で保存できるようになります）" : "例：月次レポート改修の作業開始"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={busy}
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
                  onClick={() => start(pending.taskName, true)}
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
            </>
          ) : (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">作業を始めてください。「〇〇の作業開始」と入力するか、作業名を入れて「開始」を押します。</p>
          )}
          <button
            type="button"
            className="mt-auto rounded border border-dashed border-zinc-400 px-3 py-2 text-sm text-zinc-400"
            disabled
            title="M10 で有効になります"
          >
            いまの理解を整理（M10 で有効）
          </button>
        </aside>
      </div>
    </div>
  );
}
