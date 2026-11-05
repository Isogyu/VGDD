"use client";

// S-4 チームの知恵の画面（T-015、M5・C2）。本人が承認した共有だけを作業名ごとに表示し、
// 作業名ごとに手順書の原案と判断のポイント（POST /api/procedures、T-012）を作って根拠つきで見せる。
// 共有の本文と原案は React の文字列としてだけ描画する。console・localStorage などには書かない。

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
// 型だけを読む（procedure.ts・team-knowledge.ts は DB・AI を読むので、値は読み込まない）
import type { Procedure, ProcedureEvidence } from "@/lib/procedure";
import type { TeamKnowledgeGroup } from "@/lib/team-knowledge";
import { toJstIso } from "@/lib/time";

/** 応答に notice が無いときに出す注意（M5-4。常に表示する） */
const FALLBACK_NOTICE = "原案。利用前に本人・先輩の確認が必要";
const GENERIC_FAILURE = "原案を作れませんでした";

type Draft = { procedure: Procedure; model: string; notice: string };

/** JST の ISO 文字列（例 2026-11-03T13:05:00+09:00）を「11/03 13:05」にする。保存された時刻のまま */
function formatMmDdHm(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)} ${iso.slice(11, 16)}`;
}

/** 失敗の応答から画面に出す文を決める（A5） */
function failureMessage(body: unknown): string {
  const b = (body && typeof body === "object" ? body : {}) as { error?: unknown; message?: unknown };
  const message = typeof b.message === "string" && b.message ? b.message : null;
  switch (b.error) {
    case "insufficient_records":
    case "provider_unavailable":
    case "sources_changed":
      return message ?? GENERIC_FAILURE;
    case "too_large":
      return "共有が多すぎるため作れません";
    case "schema_violation":
      return "AI の出力を整理できませんでした。もう一度試してください";
    default:
      return GENERIC_FAILURE;
  }
}

/** 成功の応答の形を確かめる（崩れていれば null） */
function parseDraft(body: unknown): Draft | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { procedure?: unknown; model?: unknown; notice?: unknown };
  const p = b.procedure as Procedure | undefined;
  if (!p || typeof p !== "object" || !Array.isArray(p.steps) || !Array.isArray(p.decision_points)) return null;
  return {
    procedure: p,
    model: typeof b.model === "string" ? b.model : "",
    notice: typeof b.notice === "string" && b.notice ? b.notice : FALLBACK_NOTICE,
  };
}

/** 元の Map を変えず、k に v を入れた新しい Map を返す（state の更新用） */
function mapWith<V>(m: Map<string, V>, k: string, v: V): Map<string, V> {
  const next = new Map(m);
  next.set(k, v);
  return next;
}

/** 元の Map を変えず、k を除いた新しい Map を返す（state の更新用） */
function mapWithout<V>(m: Map<string, V>, k: string): Map<string, V> {
  const next = new Map(m);
  next.delete(k);
  return next;
}

function InferredBadge() {
  return (
    <span className="rounded bg-violet-100 px-1 text-xs text-violet-900 dark:bg-violet-900 dark:text-violet-100">AI の推測</span>
  );
}

/** 根拠：表示名・MM/DD HH:MM。inferred なら「AI の推測」のバッジ */
function Evidence({ evidence, inferred }: { evidence: ProcedureEvidence[]; inferred: boolean }) {
  if (inferred || evidence.length === 0) return <InferredBadge />;
  return (
    <span className="text-xs text-zinc-500">
      根拠：{evidence.map((e) => `${e.display_name}・${formatMmDdHm(e.approved_at)}`).join("、")}
    </span>
  );
}

function DraftView({ draft }: { draft: Draft }) {
  const { procedure, model, notice } = draft;
  return (
    <div className="mt-3 flex flex-col gap-3 rounded border border-zinc-200 p-3 dark:border-zinc-700">
      <p role="note" className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
        {notice}
      </p>
      <div>
        <h4 className="text-sm font-medium">手順</h4>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
          {procedure.steps.map((s, i) => (
            <li key={i}>
              <span className="break-words">{s.text}</span> <Evidence evidence={s.evidence} inferred={s.inferred} />
            </li>
          ))}
        </ol>
      </div>
      <div>
        <h4 className="text-sm font-medium">判断のポイント</h4>
        {procedure.decision_points.length === 0 ? (
          <p className="mt-1 text-sm text-zinc-500">判断のポイントは見つかりませんでした</p>
        ) : (
          <ul className="mt-1 list-disc space-y-2 pl-5 text-sm">
            {procedure.decision_points.map((d, i) => (
              <li key={i}>
                <div className="break-words">{d.text}</div>
                <div className="break-words text-zinc-600 dark:text-zinc-300">なぜ：{d.reason}</div>
                <Evidence evidence={d.evidence} inferred={d.inferred} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-zinc-500">（{model}）で作成</p>
    </div>
  );
}

export default function TeamKnowledge() {
  const [groups, setGroups] = useState<TeamKnowledgeGroup[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  // 作業名をキーにする辞書は Map で持つ。普通のオブジェクトだと作業名が constructor・__proto__ などのとき
  // Object.prototype から継承したプロパティを拾うため（差し戻し A4）。読むのは .get だけ
  const [drafts, setDrafts] = useState<Map<string, Draft>>(() => new Map());
  const [busy, setBusy] = useState<Map<string, boolean>>(() => new Map());
  const [errors, setErrors] = useState<Map<string, string>>(() => new Map());
  // 読み直しの世代。読み直しより前に出した原案の依頼の結果は捨てる
  const generation = useRef(0);

  const load = useCallback(async () => {
    generation.current += 1;
    // 読み直したら、作ってあった原案（と原案の失敗の表示）はすべて消す
    setDrafts(new Map());
    setErrors(new Map());
    setBusy(new Map());
    setLoading(true);
    const gen = generation.current;
    try {
      const r = await fetch("/api/knowledge/team", { cache: "no-store" });
      if (gen !== generation.current) return;
      if (!r.ok) throw new Error("status");
      const d = (await r.json()) as { groups?: unknown };
      if (gen !== generation.current) return;
      if (!Array.isArray(d.groups)) throw new Error("shape");
      setGroups(d.groups as TeamKnowledgeGroup[]);
      setFetchedAt(toJstIso(new Date()).slice(11, 16));
      setLoadError(false);
    } catch {
      if (gen !== generation.current) return;
      setGroups(null);
      setFetchedAt(null);
      setLoadError(true);
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 開いたときに1回取る（state の更新は fetch の後、非同期で起きる）
    const t = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  async function createDraft(taskName: string) {
    const gen = generation.current;
    setBusy((b) => mapWith(b, taskName, true));
    setErrors((e) => mapWithout(e, taskName));
    let draft: Draft | null = null;
    let error: string | null = null;
    let clearDraft = false;
    try {
      const r = await fetch("/api/procedures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskName }),
      });
      const body: unknown = await r.json().catch(() => null);
      if (r.ok) {
        draft = parseDraft(body);
        if (!draft) error = GENERIC_FAILURE;
      } else {
        error = failureMessage(body);
        clearDraft = !!body && typeof body === "object" && (body as { error?: unknown }).error === "sources_changed";
      }
    } catch {
      error = GENERIC_FAILURE;
    }
    // 読み直しの後に届いた結果は捨てる（読み直しで busy も消えている）
    if (gen !== generation.current) return;
    if (draft) {
      const d = draft;
      setDrafts((m) => mapWith(m, taskName, d));
    } else if (clearDraft) {
      setDrafts((m) => mapWithout(m, taskName));
    }
    if (error) {
      const msg = error;
      setErrors((m) => mapWith(m, taskName, msg));
    }
    setBusy((b) => mapWith(b, taskName, false));
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 p-4 sm:p-6">
      <header>
        <Link href="/" className="text-sm text-zinc-500 underline">← 作業画面へ</Link>
        <h1 className="mt-1 text-xl font-semibold">チームの知恵</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">本人が承認した共有だけを表示しています（原文のメモは表示しません）</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:hover:bg-zinc-800"
          >
            最新の状態に読み直す
          </button>
          {fetchedAt && <span className="text-xs text-zinc-500">{fetchedAt} 時点</span>}
        </div>
      </header>

      {loadError ? (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">チームの知恵を読めませんでした</p>
      ) : groups === null ? (
        <p className="text-sm text-zinc-500">読み込み中…</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-zinc-500">まだ承認された共有はありません</p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => {
            const isBusy = busy.get(g.task_name) === true;
            const error = errors.get(g.task_name);
            const draft = drafts.get(g.task_name);
            return (
            <section key={g.task_name} aria-label={g.task_name} className="rounded border border-zinc-200 p-3 dark:border-zinc-700">
              <h2 className="break-words text-base font-medium">{g.task_name}</h2>
              <ul className="mt-2 flex flex-col gap-2">
                {g.items.map((it) => (
                  <li key={it.id} className="rounded bg-zinc-50 p-2 text-sm dark:bg-zinc-900">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span className="font-medium text-zinc-700 dark:text-zinc-200">{it.display_name}</span>
                      {it.role === "senior" && (
                        <span className="rounded bg-zinc-200 px-1 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100">先輩</span>
                      )}
                      <span className="font-mono">{formatMmDdHm(it.approved_at)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words">{it.body}</p>
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => void createDraft(g.task_name)}
                  disabled={isBusy}
                  className="rounded bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {isBusy ? "作成中…" : "手順書の原案を作る"}
                </button>
                {error !== undefined && (
                  <p role="alert" className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-900">
                    {error}
                  </p>
                )}
                {draft !== undefined && <DraftView draft={draft} />}
              </div>
            </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
