"use client";

// S-1 の「いまの理解を整理」（M10-1）。押したときだけ POST /api/sessions/[id]/checkin を呼び、
// 結果を「確認済みの事実／AI の推測／未確認／人に確認すべきこと」の4区分で見せる。作業は終了しない。
// 追加の質問は1問ずつ（D-40⑤）。答えるとメモとして保存され、整理をやり直す。
// useEffect・タイマーは使わない（自動実行しない）。

import { useState } from "react";
import QuestionDraft from "@/components/QuestionDraft";
import type { WorkSession, Note } from "@/lib/sessions";
import type { Summary } from "@/lib/summary-schema";

// T-004 の応答の型（T-004 と並行のため部品の中に書く。統合後に T-004 の型へ寄せる）
type UnderstandingItem = { key: string; label: string; text: string; evidence_note_ids: number[] };
type Understanding = {
  confirmed: UnderstandingItem[];
  inferred: UnderstandingItem[];
  unverified: UnderstandingItem[];
  ask_human: UnderstandingItem | null;
  questions: { id: string; text: string; target: string }[];
};
// summary は T-004 の応答に含まれる整理の結果そのもの。先輩への質問文の下書き（T-006）に渡す
type CheckinResponse = { understanding: Understanding; summary: Summary; model: string; savedNotes: Note[] };

type Answer = { question: string; text: string };

interface Props {
  session: WorkSession;
  userId: string;
  notes: Note[];
  onNotesChanged: () => void;
}

export default function UnderstandingPanel({ session, userId, notes, onNotesChanged }: Props) {
  const [result, setResult] = useState<CheckinResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 409 flagged_notes の確認。送ろうとしていた答え（あれば）も一緒に持つ
  const [confirmFlagged, setConfirmFlagged] = useState<Note[] | null>(null);
  const [pendingAnswers, setPendingAnswers] = useState<Answer[] | undefined>(undefined);
  // 「該当メモを除いて送る」で除いたメモの ID。以後の呼び出しにも付ける
  const [excluded, setExcluded] = useState<number[]>([]);
  const [qIndex, setQIndex] = useState(0);
  const [answerText, setAnswerText] = useState("");

  const indexOf = new Map(notes.map((n, i) => [n.id, i + 1]));

  async function checkin(opts: { excludeNoteIds: number[]; confirmFlagged?: boolean; answers?: Answer[] }) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/sessions/${session.id}/checkin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, ...opts }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409 && d.error === "flagged_notes") {
        setConfirmFlagged((d.flagged ?? []) as Note[]);
        setPendingAnswers(opts.answers);
        return;
      }
      if (!r.ok) {
        if (r.status === 409 && d.error === "session_ended") {
          setError("作業は終了しています");
        } else {
          setError(d.message ?? d.error ?? `整理できませんでした（${r.status}）`);
        }
        return;
      }
      setConfirmFlagged(null);
      setPendingAnswers(undefined);
      setResult(d as CheckinResponse);
      setQIndex(0);
      setAnswerText("");
      if (opts.answers && opts.answers.length > 0) onNotesChanged();
    } catch {
      setError("整理できませんでした（通信エラー）");
    } finally {
      setBusy(false);
    }
  }

  const questions = result?.understanding.questions ?? [];
  const currentQ = qIndex < questions.length ? questions[qIndex] : null;

  function renderItem(item: UnderstandingItem, kind: "confirmed" | "inferred" | "unverified" | "ask_human") {
    const faint = kind === "unverified" && item.text.includes("まだメモにない");
    return (
      <li key={`${kind}-${item.key}`} className={faint ? "text-zinc-500" : ""}>
        {kind === "inferred" && (
          <span className="mr-1 rounded bg-violet-100 px-1 text-xs text-violet-900 dark:bg-violet-900 dark:text-violet-100">AI の推測</span>
        )}
        {item.label}：{item.text}
        {item.evidence_note_ids.length > 0 && (
          <span className="ml-1 font-mono text-xs text-zinc-500">
            {item.evidence_note_ids.map((id) => `#${indexOf.get(id) ?? "?"}`).join(" ")}
          </span>
        )}
      </li>
    );
  }

  function renderSection(title: string, items: UnderstandingItem[], kind: "confirmed" | "inferred" | "unverified" | "ask_human") {
    return (
      <div>
        <h3 className="text-xs font-medium text-zinc-500">{title}</h3>
        {items.length === 0 ? (
          <p className="text-zinc-500">なし</p>
        ) : (
          <ul className="mt-0.5 flex flex-col gap-0.5">{items.map((it) => renderItem(it, kind))}</ul>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-sky-300 bg-sky-50 p-3 text-sm dark:border-sky-800 dark:bg-sky-950">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">いまの理解</h2>
        <button
          type="button"
          className="rounded bg-zinc-800 px-3 py-1 text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-black"
          disabled={notes.length === 0 || busy}
          onClick={() => void checkin({ excludeNoteIds: excluded })}
          title={notes.length === 0 ? "メモを1件以上書いてから押してください" : "作業は終了せずに、いまのメモを AI で整理します"}
        >
          いまの理解を整理
        </button>
      </div>

      {busy && (
        <p role="status" className="text-zinc-600 dark:text-zinc-300">
          整理しています…（10秒ほどかかります）
        </p>
      )}

      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-2 py-1 text-red-900 dark:bg-red-950 dark:text-red-100">
          {error}
        </p>
      )}

      {confirmFlagged && (
        <div role="dialog" aria-label="AI に送る前の確認" className="rounded border border-amber-400 bg-amber-50 p-3 dark:bg-amber-950">
          <p className="font-medium">機密情報らしい文字列を含むメモが {confirmFlagged.length} 件あります。AI（Claude API）に送る前に確認してください。</p>
          <ul className="mt-2 list-disc pl-5">
            {confirmFlagged.map((n) => (
              <li key={n.id}>
                <span className="font-mono text-zinc-500">#{indexOf.get(n.id) ?? "?"}</span> {n.body}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">パターンで取りこぼす情報もあります。完全な匿名化はできません。</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded bg-zinc-800 px-3 py-1 text-white dark:bg-zinc-200 dark:text-black"
              disabled={busy}
              onClick={() => void checkin({ excludeNoteIds: excluded, confirmFlagged: true, answers: pendingAnswers })}
            >
              このまま送る
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1"
              disabled={busy}
              onClick={() => {
                const ex = Array.from(new Set([...excluded, ...confirmFlagged.map((n) => n.id)]));
                setExcluded(ex);
                void checkin({ excludeNoteIds: ex, answers: pendingAnswers });
              }}
            >
              該当メモを除いて送る
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1"
              onClick={() => {
                setConfirmFlagged(null);
                setPendingAnswers(undefined);
              }}
            >
              やめる
            </button>
          </div>
        </div>
      )}

      {result && (
        <>
          <div className="flex flex-col gap-2">
            {renderSection("確認済みの事実", result.understanding.confirmed, "confirmed")}
            {renderSection("AI の推測", result.understanding.inferred, "inferred")}
            {renderSection("未確認", result.understanding.unverified, "unverified")}
            {renderSection("人に確認すべきこと", result.understanding.ask_human ? [result.understanding.ask_human] : [], "ask_human")}
          </div>
          {/* 先輩への質問文の下書き（T-006 の部品、M10-2）。整理中は描かない */}
          {!busy && <QuestionDraft summary={result.summary} notes={notes} session={session} />}
          <p className="text-xs text-zinc-500">
            原案です。作業は続いています。この整理は保存されません
            <span className="ml-1">・{result.model}</span>
          </p>

          {currentQ && (
            <div className="rounded border border-sky-300 bg-white p-3 dark:border-sky-800 dark:bg-zinc-900">
              <p className="text-xs text-zinc-500">
                AI からの追加の質問（{qIndex + 1}/{questions.length}）
              </p>
              <p className="mt-1 font-medium">{currentQ.text}</p>
              <textarea
                className="mt-2 w-full rounded border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-zinc-900"
                rows={2}
                value={answerText}
                onChange={(e) => setAnswerText(e.target.value)}
                aria-label="答え"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded bg-zinc-800 px-3 py-1 text-white disabled:opacity-50 dark:bg-zinc-200 dark:text-black"
                  disabled={busy || !answerText.trim()}
                  onClick={() => {
                    const text = answerText.trim();
                    if (!text) return;
                    void checkin({ excludeNoteIds: excluded, answers: [{ question: currentQ.text, text }] });
                  }}
                >
                  答えて整理をやり直す
                </button>
                <button
                  type="button"
                  className="rounded border px-3 py-1"
                  disabled={busy}
                  onClick={() => {
                    setAnswerText("");
                    setQIndex((i) => i + 1);
                  }}
                >
                  答えない
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
