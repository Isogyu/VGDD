"use client";

// S-2 整理結果の画面（M4）。終了した作業のメモと、AI 整理の結果（8項目・根拠・推測）・追加の質問を表示する。
// 終了直後にここへ来て、整理結果がなければ自動で整理を始める（M3-2）。要確認のメモがあれば送る前に確認する（M6-1）。

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { WorkSession, Note, HistoryItem } from "@/lib/sessions";
import { SUMMARY_KEYS, SUMMARY_LABELS, itemStatus, type Summary, type SummaryKey } from "@/lib/summary-schema";
import { formatHm, formatMdHm, formatDuration, formatDelta } from "@/lib/time";
import { useNoteReplay } from "@/lib/use-note-replay";
import PreviousSummary from "@/components/PreviousSummary";
import SummaryActions from "@/components/SummaryActions";

const USER_KEY = "tsubuyaki.userId";

interface SessionResponse {
  session: WorkSession;
  notes: Note[];
  history: HistoryItem | null;
  summary: { id: number; summary: Summary; model: string | null; created_at: string } | null;
  flaggedNoteIds: number[];
  rerunsLeft: number;
  provider: "claude" | "demo";
}

export default function SessionView({ sessionId }: { sessionId: number }) {
  // 選択中のユーザー（S-1 と同じ localStorage のキー）。描画には使わないので ref で持つ
  const userIdRef = useRef<string>("newcomer_a");
  const [data, setData] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const autoTriedRef = useRef(false);
  const [confirmFlagged, setConfirmFlagged] = useState<Note[] | null>(null);
  const [excluded, setExcluded] = useState<number[]>([]);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // 追加の質問（1問ずつ。D-40⑤）
  const [qIndex, setQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answerText, setAnswerText] = useState("");
  // 整理の待ち時間にメモを順に強調する口（T-003）。強調中のメモの #番号、なければ null
  const replayIndex = useNoteReplay(data?.notes.length ?? 0, summarizing);

  useEffect(() => {
    userIdRef.current = window.localStorage.getItem(USER_KEY) ?? "newcomer_a";
    const userId = userIdRef.current;
    let cancelled = false;
    (async () => {
      const r = await fetch(`/api/sessions/${sessionId}?userId=${encodeURIComponent(userId)}`);
      if (cancelled) return;
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error === "not_your_session" ? "この作業は別のユーザーのものです。画面上部のユーザーを切り替えてください" : `読み込めませんでした（${d.error ?? r.status}）`);
        return;
      }
      setData((await r.json()) as SessionResponse);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, reloadKey]);

  async function summarize(opts: { excludeNoteIds?: number[]; confirmFlagged?: boolean }) {
    setSummarizing(true);
    setError(null);
    try {
      const r = await fetch(`/api/sessions/${sessionId}/summarize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: userIdRef.current, ...opts }),
      });
      const d = await r.json();
      if (r.status === 409 && d.error === "flagged_notes") {
        setConfirmFlagged(d.flagged as Note[]);
        return;
      }
      if (!r.ok) {
        setError(d.message ?? `整理できませんでした（${d.error ?? r.status}）`);
        return;
      }
      setConfirmFlagged(null);
      setQIndex(0);
      setAnswers({});
      setAnswerText("");
      setReloadKey((k) => k + 1);
    } finally {
      setSummarizing(false);
    }
  }

  // 終了直後：整理結果がなければ自動で開始（M3-2）。1回だけ。描画中に状態を変えないため、次のティックで呼ぶ
  useEffect(() => {
    if (!data || autoTriedRef.current || summarizing) return;
    if (data.session.status !== "ended" || data.summary) return;
    autoTriedRef.current = true;
    const t = setTimeout(() => void summarize({}), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, summarizing]);

  async function submitAnswers(all: Record<string, string>) {
    const list = Object.entries(all)
      .filter(([, t]) => t.trim())
      .map(([questionId, text]) => ({ questionId, text }));
    if (list.length === 0) return;
    setSummarizing(true);
    setError(null);
    try {
      const r = await fetch(`/api/sessions/${sessionId}/answers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: userIdRef.current, answers: list, excludeNoteIds: excluded }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.message ?? `反映できませんでした（${d.error ?? r.status}）`);
        return;
      }
      setQIndex(0);
      setAnswers({});
      setAnswerText("");
      setReloadKey((k) => k + 1);
    } finally {
      setSummarizing(false);
    }
  }

  if (error && !data) {
    return (
      <div className="mx-auto w-full max-w-5xl p-6">
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</p>
        <Link href="/" className="mt-3 inline-block text-sm underline">← 作業画面へ</Link>
      </div>
    );
  }
  if (!data) return <div className="p-6 text-sm text-zinc-500">読み込み中…</div>;

  const { session, notes, history } = data;
  const summary = data.summary?.summary ?? null;
  const indexOf = new Map(notes.map((n, i) => [n.id, i + 1]));
  const sourceIds = new Set(summary?.source_note_ids ?? []);
  const questions = summary?.questions ?? [];
  const canAnswer = questions.length > 0 && data.rerunsLeft > 0 && session.status === "ended";
  const currentQ = canAnswer ? questions[qIndex] : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Link href="/" className="text-sm text-zinc-500 underline">← 作業画面へ</Link>
          <h1 className="text-xl font-semibold">{session.task_name}</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            {formatMdHm(session.started_at)} 開始
            {session.status === "ended" ? ` ・ 所要 ${formatDuration(session.duration_min)}` : " ・ 進行中"}
            {history?.delta_min != null && <span className="ml-2 rounded bg-emerald-100 px-1 text-xs text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">{formatDelta(history.delta_min)}</span>}
            {" ・ "}メモ {notes.length} 件
          </p>
        </div>
        <div className="text-xs text-zinc-500">
          {data.provider === "demo" ? "デモモード：保存した AI 出力を表示しています（API キーなし）" : "AI：Claude（Sonnet 5.5）"}
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">
          {error}
          {session.status === "ended" && (
            <button type="button" className="ml-2 underline" onClick={() => summarize({ excludeNoteIds: excluded, confirmFlagged: true })} disabled={summarizing}>
              もう一度整理する
            </button>
          )}
        </p>
      )}

      {confirmFlagged && (
        <div role="dialog" aria-label="AI に送る前の確認" className="rounded border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950">
          <p className="font-medium">機密情報らしい文字列を含むメモが {confirmFlagged.length} 件あります。AI（Claude API）に送る前に確認してください。</p>
          <ul className="mt-2 list-disc pl-5">
            {confirmFlagged.map((n) => (
              <li key={n.id}>
                <span className="font-mono text-zinc-500">#{indexOf.get(n.id)}</span> {n.body}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">パターンで取りこぼす情報もあります。完全な匿名化はできません。</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="rounded bg-zinc-800 px-3 py-1 text-white dark:bg-zinc-200 dark:text-black" disabled={summarizing} onClick={() => summarize({ excludeNoteIds: excluded, confirmFlagged: true })}>
              このまま送る
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1"
              disabled={summarizing}
              onClick={() => {
                const ex = Array.from(new Set([...excluded, ...confirmFlagged.map((n) => n.id)]));
                setExcluded(ex);
                void summarize({ excludeNoteIds: ex, confirmFlagged: true });
              }}
            >
              該当メモを除いて送る
            </button>
            <button type="button" className="rounded border px-3 py-1" onClick={() => setConfirmFlagged(null)}>
              やめる
            </button>
          </div>
        </div>
      )}

      <div className="grid flex-1 gap-4 md:grid-cols-[1fr_1.2fr]">
        {/* 左：メモ */}
        <section>
          <h2 className="mb-2 text-sm font-medium text-zinc-500">メモ（元の記録）</h2>
          <ol className="flex flex-col gap-1 text-sm">
            {notes.map((n) => {
              const idx = indexOf.get(n.id)!;
              const excludedNote = summary ? !sourceIds.has(n.id) : excluded.includes(n.id);
              return (
                <li
                  key={n.id}
                  id={`note-${n.id}`}
                  className={`flex gap-2 rounded px-1 ${highlight === n.id ? "bg-yellow-100 dark:bg-yellow-900" : replayIndex === idx ? "bg-sky-100 dark:bg-sky-900" : ""} ${excludedNote ? "opacity-50" : ""}`}
                >
                  <span className="shrink-0 font-mono text-zinc-500">#{idx}</span>
                  <span className="shrink-0 font-mono text-zinc-500">{formatHm(n.created_at)}</span>
                  <span className="shrink-0 rounded bg-zinc-100 px-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {n.kind === "known" ? "分かっている" : n.kind === "unknown" ? "分からない" : n.kind === "answer" ? "答え" : "メモ"}
                  </span>
                  <span className="whitespace-pre-wrap">{n.body}</span>
                  {n.flags_json && <span className="shrink-0 rounded bg-amber-100 px-1 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">要確認</span>}
                  {excludedNote && <span className="shrink-0 text-xs text-zinc-500">（AI に送っていない）</span>}
                </li>
              );
            })}
          </ol>
        </section>

        {/* 右：整理結果 */}
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-zinc-500">
            AI 整理（原案）{data.summary?.model && <span className="ml-1 text-xs">・{data.summary.model}</span>}
          </h2>
          {/* 前回との比較の口（T-001）。出すか出さないかは部品が決める */}
          <PreviousSummary sessionId={session.id} userId={session.user_id} taskName={session.task_name} />
          {summarizing && (
            <p role="status" className="rounded border border-sky-300 bg-sky-50 px-3 py-2 text-sm dark:bg-sky-950">
              整理しています…（10秒ほどかかります）
            </p>
          )}
          {!summary && !summarizing && !error && session.status === "ended" && !confirmFlagged && (
            <button type="button" className="self-start rounded bg-zinc-800 px-3 py-2 text-sm text-white dark:bg-zinc-200 dark:text-black" onClick={() => summarize({ excludeNoteIds: excluded })}>
              AI で整理する
            </button>
          )}
          {summary && (
            <>
              <p className="text-xs text-zinc-500">
                各項目の「#番号」は根拠になった元のメモです。根拠がないのに内容を述べている項目は{" "}
                <span className="rounded bg-violet-100 px-1 text-violet-900 dark:bg-violet-900 dark:text-violet-100">AI の推測</span>、メモに記録がない項目は{" "}
                <span className="rounded bg-zinc-100 px-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">記録なし</span> と表示します。これは原案で、利用前に本人・先輩の確認が必要です。
              </p>
              <dl className="grid gap-2 sm:grid-cols-2">
                {SUMMARY_KEYS.map((key: SummaryKey) => {
                  const item = summary[key];
                  const status = itemStatus(item);
                  return (
                    <div key={key} className={`rounded border border-zinc-200 p-2 dark:border-zinc-800 ${status === "none" ? "opacity-70" : ""}`}>
                      <dt className="flex items-center justify-between text-xs font-medium text-zinc-500">
                        {SUMMARY_LABELS[key]}
                        {status === "inferred" && <span className="rounded bg-violet-100 px-1 text-violet-900 dark:bg-violet-900 dark:text-violet-100">AI の推測</span>}
                        {status === "none" && <span className="rounded bg-zinc-100 px-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">記録なし</span>}
                      </dt>
                      <dd className={`mt-1 text-sm ${status === "none" ? "text-zinc-500" : ""}`}>{item.text}</dd>
                      {item.evidence_note_ids.length > 0 && (
                        <dd className="mt-1 flex flex-wrap gap-1">
                          {item.evidence_note_ids.map((id) => (
                            <button
                              key={id}
                              type="button"
                              className="rounded border border-zinc-300 px-1 font-mono text-xs hover:bg-yellow-100 dark:border-zinc-700"
                              onMouseEnter={() => setHighlight(id)}
                              onMouseLeave={() => setHighlight(null)}
                              onClick={() => {
                                setHighlight(id);
                                document.getElementById(`note-${id}`)?.scrollIntoView({ block: "nearest" });
                              }}
                              title="根拠のメモ"
                            >
                              #{indexOf.get(id) ?? "?"}
                            </button>
                          ))}
                        </dd>
                      )}
                    </div>
                  );
                })}
              </dl>

              {/* 整理結果の操作の口（T-002） */}
              <SummaryActions summary={summary} notes={notes} session={session} />

              {currentQ && (
                <div className="rounded border border-sky-300 bg-sky-50 p-3 text-sm dark:border-sky-800 dark:bg-sky-950">
                  <p className="text-xs text-zinc-500">AI からの追加の質問（{qIndex + 1}/{questions.length}）。情報が足りない項目を埋めるためのものです。答えなくても構いません。</p>
                  <p className="mt-1 font-medium">{currentQ.text}</p>
                  <textarea
                    className="mt-2 w-full rounded border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-zinc-900"
                    rows={2}
                    value={answerText}
                    onChange={(e) => setAnswerText(e.target.value)}
                    aria-label="答え"
                  />
                  <div className="mt-2 flex gap-2">
                    {qIndex + 1 < questions.length ? (
                      <button
                        type="button"
                        className="rounded border px-3 py-1"
                        onClick={() => {
                          setAnswers((a) => ({ ...a, [currentQ.id]: answerText }));
                          setAnswerText("");
                          setQIndex((i) => i + 1);
                        }}
                      >
                        次の質問へ
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="rounded bg-zinc-800 px-3 py-1 text-white dark:bg-zinc-200 dark:text-black"
                        disabled={summarizing}
                        onClick={() => void submitAnswers({ ...answers, [currentQ.id]: answerText })}
                      >
                        答えを反映して整理をやり直す
                      </button>
                    )}
                  </div>
                </div>
              )}
              {questions.length > 0 && data.rerunsLeft === 0 && (
                <p className="text-xs text-zinc-500">追加の質問への答えは反映済みです（やり直しは1回まで）。</p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
