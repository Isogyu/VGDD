"use client";

// 要件確認の画面（/requirements、T-043）。業務の言葉で困りごとを書き、固定の質問に答えると、未解決の事項が整理され、票の下書きの文ができる。
// データは LLM から独立している。この画面から AI は呼ばない（AI の提案は、オーナーが端末で動かした別の道具の結果を貼って取り込むだけ）。
// 取る先は自分の /api/requirements* と、承認の状態の表示のための GET /api/governance/kernel だけ。
// 承認の操作はこの画面にない（承認はオーナーが端末の approve-spec で行う）。承認の状態は表示だけで、効力の判断には使わない。

import { useCallback, useEffect, useState } from "react";
import CopyButton from "@/components/CopyButton";
import { QUESTIONS, STAGES, type Question } from "@/lib/requirements/questions";
import {
  ANSWER_MAX_CHARS,
  STALE_COPY_LABEL,
  TITLE_MAX_CHARS,
  approvalStatus,
  assistMaterial,
  completeness,
  completenessLabel,
  decisionLabel,
  draftTicketText,
  isTicketId,
  parseAnswers,
  questionText,
  sameAnswers,
  suggestionKindLabel,
  unresolved,
  type Answer,
  type Answers,
  type ApprovalView,
  type Decision,
  type RecordListItem,
  type RequirementRecord,
} from "@/lib/requirements/model";

// ---------- 通信 ----------

const ERROR_TEXT: Record<string, string> = {
  version_conflict: "ほかの画面で先に更新されました。「読み込み直す」を押してから、もう一度保存してください",
  record_not_found: "記録が見つかりません",
  invalid_body: "入力の形が合いません（AI の提案の JSON なら、記録の ID と回答の版が今の記録と合うかを確かめてください）",
  payload_too_large: "大きすぎます（32KB まで）",
  forbidden_host: "この画面はローカル（localhost）でだけ使えます",
  forbidden_origin: "この画面はローカル（localhost）でだけ使えます",
  unsupported_media_type: "送り方が合いません",
  store_unavailable: "保存先を開けません（DB の指定を確かめてください）",
};

function errorText(code: string | null): string {
  return (code !== null && ERROR_TEXT[code]) || "うまくいきませんでした";
}

type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string | null };

async function api<T>(url: string, method: "GET" | "POST" | "PUT", body?: unknown): Promise<ApiResult<T>> {
  try {
    const r = await fetch(url, {
      method,
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: unknown = await r.json().catch(() => null);
    if (!r.ok) {
      const code =
        typeof json === "object" && json !== null && typeof (json as { error?: unknown }).error === "string"
          ? (json as { error: string }).error
          : null;
      return { ok: false, error: code };
    }
    return { ok: true, value: json as T };
  } catch {
    return { ok: false, error: null };
  }
}

// ---------- 承認の表示の取り直し（純粋関数） ----------
// 承認の表示を空に戻す契機と、取り直す契機をそろえる。空に戻すたびに世代を1つ進め、
// 取り直しの useEffect は「票の ID と世代」を依存にして動く。同じ票の ID のままでも、空に戻せば必ず取り直す。

/** 承認の表示の state。generation は空に戻した回数（取り直しの世代） */
export type ApprovalSlot = { generation: number; view: ApprovalView | null };

export const INITIAL_APPROVAL_SLOT: ApprovalSlot = { generation: 0, view: null };

/** 承認の表示を空に戻す。世代を1つ進めるので、取り直しの useEffect がもう一度動く */
export function resetApprovalSlot(s: ApprovalSlot): ApprovalSlot {
  return { generation: s.generation + 1, view: null };
}

/** 取得の応答を反映する。取得を始めたときの世代が今の世代と違えば（古い応答なら）捨てる */
export function applyApprovalResponse(s: ApprovalSlot, requestGeneration: number, view: ApprovalView): ApprovalSlot {
  return requestGeneration === s.generation ? { generation: s.generation, view } : s;
}

// ---------- 表示の部品 ----------

const STATUS_NOTE = "承認の状態は表示だけ。承認はオーナーが端末の approve-spec で行い、この表示は効力の判断に使わない";

export function ApprovalLine({ ticketId, approval }: { ticketId: string | null; approval: ApprovalView | null }) {
  if (ticketId === null) {
    return <p className="text-sm text-zinc-500">票を結び付けると、Kernel の写しの上の承認の状態を出します</p>;
  }
  return (
    <div className="text-sm">
      <p>
        承認の状態（{ticketId}）：
        {approval === null ? (
          "読み込み中…"
        ) : (
          <>
            <span className="font-medium">{approval.label}</span>
            {approval.staleCopy ? <span className="ml-1 text-amber-700">（{STALE_COPY_LABEL}）</span> : null}
          </>
        )}
      </p>
      <p className="mt-1 text-xs text-zinc-500">{STATUS_NOTE}</p>
    </div>
  );
}

/** 右（狭い画面では下）の欄：完成度と未解決の一覧 */
export function StatusPanel({ record }: { record: Pick<RequirementRecord, "answers" | "suggestions" | "decisions"> }) {
  const c = completeness(record.answers);
  const items = unresolved(record);
  return (
    <section aria-label="未解決の事項" className="rounded border border-zinc-300 p-3">
      <h2 className="font-medium">いまの状態</h2>
      <p className={`mt-1 text-sm ${c.ready ? "text-emerald-700" : "text-amber-700"}`}>{completenessLabel(c)}</p>
      <h3 className="mt-3 text-sm font-medium">未解決の事項（{items.length} 件）</h3>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">なし</p>
      ) : (
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm break-words">
          {items.map((u, i) => (
            <li key={`${u.kind}-${u.question_id ?? ""}-${u.index ?? i}`}>{u.label}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function QuestionField({
  q,
  answer,
  onChange,
}: {
  q: Question;
  answer: Answer | undefined;
  onChange: (a: Answer) => void;
}) {
  const a = answer ?? { text: "", unknown: false };
  const fieldId = `q-${q.id}`;
  return (
    <div className="mt-3">
      <label htmlFor={fieldId} className="block text-sm">
        {q.text}
        {q.required ? <span className="ml-1 text-xs text-amber-700">（必須）</span> : null}
      </label>
      <textarea
        id={fieldId}
        className="mt-1 w-full rounded border border-zinc-300 p-2 text-sm"
        rows={2}
        maxLength={ANSWER_MAX_CHARS}
        value={a.text}
        onChange={(e) => onChange({ ...a, text: e.target.value })}
      />
      <label className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-600">
        <input type="checkbox" checked={a.unknown} onChange={(e) => onChange({ ...a, unknown: e.target.checked })} />
        わからない
      </label>
    </div>
  );
}

export interface RecordViewProps {
  record: RequirementRecord;
  draft: Answers;
  linked: string;
  dirty: boolean;
  busy: boolean;
  importText: string;
  approval: ApprovalView | null;
  onAnswer: (id: string, a: Answer) => void;
  onLinked: (v: string) => void;
  onSave: () => void;
  onReload: () => void;
  onImportText: (v: string) => void;
  onImport: () => void;
  onDecide: (index: number, d: Decision) => void;
}

/** 開いた記録の表示（質問・AI の提案・下書き・材料・承認の状態）。画面の状態は持たない */
export function RecordView(p: RecordViewProps) {
  const { record } = p;
  const live = { answers: parseAnswers(p.draft) ?? record.answers, suggestions: record.suggestions, decisions: record.decisions };
  const draftText = draftTicketText(live);
  const material = JSON.stringify(assistMaterial(record), null, 2);

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0">
        <h2 className="text-lg font-medium break-words">{record.title}</h2>
        <p className="text-xs text-zinc-500">
          回答の版 {record.answers_version}・作成 {record.created_at}
        </p>

        {STAGES.map((s) => (
          <fieldset key={s.id} className="mt-4 rounded border border-zinc-200 p-3">
            <legend className="px-1 text-sm font-medium">{s.label}</legend>
            {QUESTIONS.filter((q) => q.stage === s.id).map((q) => (
              <QuestionField key={q.id} q={q} answer={p.draft[q.id]} onChange={(a) => p.onAnswer(q.id, a)} />
            ))}
          </fieldset>
        ))}

        <div className="mt-3">
          <label htmlFor="linked-ticket" className="block text-sm">
            結び付ける票の ID（任意。T- と数字3〜4桁）
          </label>
          <input
            id="linked-ticket"
            className="mt-1 w-40 rounded border border-zinc-300 p-1 text-sm"
            value={p.linked}
            maxLength={6}
            onChange={(e) => p.onLinked(e.target.value)}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="rounded bg-zinc-800 px-3 py-1 text-sm text-white" disabled={p.busy} onClick={p.onSave}>
            回答を保存
          </button>
          <button type="button" className="rounded border border-zinc-300 px-3 py-1 text-sm" disabled={p.busy} onClick={p.onReload}>
            読み込み直す
          </button>
          {p.dirty ? <span className="self-center text-xs text-amber-700">保存していない変更があります</span> : null}
        </div>

        <section aria-label="AI の提案" className="mt-6">
          <h2 className="font-medium">AI の提案（本人の回答ではない）</h2>
          <p className="text-xs text-zinc-500">
            端末の別の道具の結果（JSON）を貼って取り込みます。「採る」を選んでも回答は書き換わりません。採る内容は、自分で回答に書き写してください
          </p>
          <textarea
            aria-label="AI の提案の JSON"
            className="mt-1 w-full rounded border border-zinc-300 p-2 font-mono text-xs"
            rows={3}
            value={p.importText}
            onChange={(e) => p.onImportText(e.target.value)}
          />
          <button type="button" className="mt-1 rounded border border-zinc-300 px-3 py-1 text-sm" disabled={p.busy} onClick={p.onImport}>
            AI の提案を取り込む
          </button>
          {record.suggestions.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">取り込んだ提案はありません</p>
          ) : (
            <ol className="mt-2 space-y-2">
              {record.suggestions.map((s, i) => {
                const d = record.decisions[i] ?? "pending";
                const target = questionText(s.target);
                return (
                  <li key={i} className="rounded border border-dashed border-zinc-300 p-2 text-sm">
                    <p className="text-xs text-zinc-500">
                      AI の提案 {i + 1}・{suggestionKindLabel(s.kind)}
                      {target !== null ? `・対象：${target}` : ""}・いまの採否：{decisionLabel(d)}
                    </p>
                    <p className="mt-1 break-words whitespace-pre-wrap">{s.text}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <button type="button" className="rounded border border-zinc-300 px-2 text-xs" disabled={p.busy || d === "accepted"} onClick={() => p.onDecide(i, "accepted")}>
                        採る
                      </button>
                      <button type="button" className="rounded border border-zinc-300 px-2 text-xs" disabled={p.busy || d === "rejected"} onClick={() => p.onDecide(i, "rejected")}>
                        採らない
                      </button>
                      <button type="button" className="rounded border border-zinc-300 px-2 text-xs" disabled={p.busy || d === "pending"} onClick={() => p.onDecide(i, "pending")}>
                        未決定に戻す
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section aria-label="票の下書き" className="mt-6">
          <h2 className="font-medium">票の下書き</h2>
          {draftText === null ? (
            <p className="text-sm text-amber-700">{completenessLabel(completeness(live.answers))}</p>
          ) : (
            <>
              <pre className="mt-1 max-w-full overflow-x-auto rounded bg-zinc-100 p-2 text-xs break-words whitespace-pre-wrap">{draftText}</pre>
              <CopyButton text={draftText} label="下書きをコピー" />
            </>
          )}
        </section>

        <section aria-label="AI の補助に渡す材料" className="mt-6">
          <h2 className="font-medium">AI の補助に渡す材料</h2>
          <p className="text-xs text-zinc-500">保存した回答から作ります。オーナーが端末の別の道具に渡します</p>
          <pre className="mt-1 max-h-48 max-w-full overflow-auto rounded bg-zinc-100 p-2 text-xs break-words whitespace-pre-wrap">{material}</pre>
          <CopyButton text={material} label="材料をコピー" />
        </section>
      </div>

      <aside className="min-w-0 space-y-3">
        <StatusPanel record={live} />
        <section aria-label="承認の状態" className="rounded border border-zinc-300 p-3">
          <ApprovalLine ticketId={record.linked_ticket_id} approval={p.approval} />
        </section>
      </aside>
    </div>
  );
}

// ---------- 画面 ----------

export default function RequirementsGuide() {
  const [list, setList] = useState<RecordListItem[] | null>(null);
  const [title, setTitle] = useState("");
  const [record, setRecord] = useState<RequirementRecord | null>(null);
  const [draft, setDraft] = useState<Answers>({});
  const [linked, setLinked] = useState("");
  const [importText, setImportText] = useState("");
  const [approvalSlot, setApprovalSlot] = useState<ApprovalSlot>(INITIAL_APPROVAL_SLOT);
  const approval = approvalSlot.view;
  /** 承認の表示を空に戻し、同じ契機で取り直す（世代を進める） */
  const resetApproval = () => setApprovalSlot(resetApprovalSlot);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    const r = await api<{ records: RecordListItem[] }>("/api/requirements", "GET");
    if (r.ok) setList(r.value.records);
    else setMessage(errorText(r.error));
  }, []);

  // マウントのときに一覧を取る。unmount の後は state を更新しない
  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await api<{ records: RecordListItem[] }>("/api/requirements", "GET");
      if (!alive) return;
      if (r.ok) setList(r.value.records);
      else setMessage(errorText(r.error));
    })();
    return () => {
      alive = false;
    };
  }, []);

  const show = useCallback((rec: RequirementRecord) => {
    setRecord(rec);
    setDraft(rec.answers);
    setLinked(rec.linked_ticket_id ?? "");
  }, []);

  // 結び付けた票があれば、Kernel の写しから承認の状態を読む（表示だけ）
  // 票の ID が変わったときと、承認の表示を空に戻したとき（世代が進んだとき）に取り直す
  const ticketId = record?.linked_ticket_id ?? null;
  const generation = approvalSlot.generation;
  useEffect(() => {
    if (ticketId === null) return;
    const controller = new AbortController();
    (async () => {
      let body: unknown = null;
      let failed = false;
      try {
        const r = await fetch("/api/governance/kernel", { cache: "no-store", signal: controller.signal });
        if (r.ok) body = await r.json();
        else failed = true;
      } catch {
        failed = true;
      }
      if (controller.signal.aborted) return;
      const view = approvalStatus(body, ticketId, new Date(), failed);
      setApprovalSlot((s) => applyApprovalResponse(s, generation, view));
    })();
    return () => controller.abort();
  }, [ticketId, generation]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  const create = () =>
    run(async () => {
      const t = title.trim();
      if (t === "") {
        setMessage("題を書いてください");
        return;
      }
      const r = await api<{ record: RequirementRecord }>("/api/requirements", "POST", { title: t });
      if (!r.ok) return setMessage(errorText(r.error));
      setTitle("");
      resetApproval();
      show(r.value.record);
      await loadList();
    });

  const open = (id: string) =>
    run(async () => {
      const r = await api<{ record: RequirementRecord }>(`/api/requirements/${encodeURIComponent(id)}`, "GET");
      if (!r.ok) return setMessage(errorText(r.error));
      resetApproval();
      show(r.value.record);
    });

  const reload = () => {
    if (record !== null) void open(record.id);
  };

  const save = () =>
    run(async () => {
      if (record === null) return;
      const answers = parseAnswers(draft);
      if (answers === null) return setMessage(errorText("invalid_body"));
      const l = linked.trim();
      if (l !== "" && !isTicketId(l)) return setMessage("票の ID は T- と数字3〜4桁で書いてください（例：T-043）");
      const r = await api<{ record: RequirementRecord }>(`/api/requirements/${encodeURIComponent(record.id)}`, "PUT", {
        answers_version: record.answers_version,
        answers,
        linked_ticket_id: l === "" ? null : l,
      });
      if (!r.ok) return setMessage(errorText(r.error));
      if (r.value.record.linked_ticket_id !== record.linked_ticket_id) resetApproval();
      show(r.value.record);
      setMessage("保存しました");
      await loadList();
    });

  const importSuggestions = () =>
    run(async () => {
      if (record === null) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(importText);
      } catch {
        return setMessage("JSON として読めません");
      }
      const r = await api<{ record: RequirementRecord }>(`/api/requirements/${encodeURIComponent(record.id)}`, "POST", {
        action: "import",
        suggestions: parsed,
      });
      if (!r.ok) return setMessage(errorText(r.error));
      setRecord(r.value.record);
      setImportText("");
      setMessage("AI の提案を取り込みました");
    });

  const decide = (index: number, decision: Decision) =>
    run(async () => {
      if (record === null) return;
      const r = await api<{ record: RequirementRecord }>(`/api/requirements/${encodeURIComponent(record.id)}`, "POST", {
        action: "decide",
        answers_version: record.answers_version,
        suggestions_version: record.suggestions_version,
        index,
        decision,
      });
      if (!r.ok) return setMessage(errorText(r.error));
      setRecord(r.value.record);
    });

  const normalized = parseAnswers(draft);
  const dirty =
    record !== null &&
    (normalized === null || !sameAnswers(normalized, record.answers) || linked.trim() !== (record.linked_ticket_id ?? ""));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <h1 className="text-xl font-semibold">要件の確認</h1>
      <p className="mt-1 text-sm text-zinc-600">
        業務の言葉で困りごとを書き、質問に答えていくと、未解決の事項が整理され、票の下書きの文ができます。AI がなくても使えます
      </p>
      <p className="mt-1 text-xs text-zinc-500">データはすべて合成（架空の会社・人物）で試してください</p>

      <section aria-label="記録の一覧" className="mt-4 rounded border border-zinc-300 p-3">
        <h2 className="font-medium">記録の一覧</h2>
        {list === null ? (
          <p className="text-sm text-zinc-500">読み込み中…</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-zinc-500">まだ記録はありません</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {list.map((it) => (
              <li key={it.id} className="flex flex-wrap items-center gap-2">
                <button type="button" className="text-left underline break-all" disabled={busy} onClick={() => void open(it.id)}>
                  {it.title}
                </button>
                <span className="text-xs text-zinc-500">
                  {it.created_at}・{it.ready ? "下書きにできる" : "下書きにできない"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            aria-label="新しい記録の題"
            className="min-w-0 flex-1 rounded border border-zinc-300 p-1 text-sm"
            placeholder="例：架空の会社の請求書の確認"
            maxLength={TITLE_MAX_CHARS}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <button type="button" className="rounded bg-zinc-800 px-3 py-1 text-sm text-white" disabled={busy} onClick={() => void create()}>
            新しく始める
          </button>
        </div>
      </section>

      {message !== null ? (
        <p role="status" className="mt-3 text-sm text-zinc-700">
          {message}
        </p>
      ) : null}

      {record !== null ? (
        <div className="mt-4">
          <RecordView
            record={record}
            draft={draft}
            linked={linked}
            dirty={dirty}
            busy={busy}
            importText={importText}
            approval={approval}
            onAnswer={(id, a) => setDraft((d) => ({ ...d, [id]: a }))}
            onLinked={setLinked}
            onSave={() => void save()}
            onReload={reload}
            onImportText={setImportText}
            onImport={() => void importSuggestions()}
            onDecide={(i, d) => void decide(i, d)}
          />
        </div>
      ) : null}
    </main>
  );
}
