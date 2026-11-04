"use client";

// 先輩への質問文の下書き（T-006、M10-2・M10-3）。
// ボタンで開閉し、下書きを読み取り専用で表示してコピーできるようにする。送信はしない。
// 下書きにも機密検査（M6-1）をかけ、該当があれば警告する。本文は自動で置き換えない。

import { useMemo, useState } from "react";
import CopyButton from "@/components/CopyButton";
import { buildQuestionDraft } from "@/lib/question-draft";
import { describeFlags, detectSensitive } from "@/lib/sensitive";
import type { Note, WorkSession } from "@/lib/sessions";
import type { Summary } from "@/lib/summary-schema";

export interface QuestionDraftProps {
  summary: Summary;
  notes: Note[];
  session: WorkSession;
}

export default function QuestionDraft({ summary, notes, session }: QuestionDraftProps) {
  const [open, setOpen] = useState<boolean>(false);
  const draft = useMemo(
    () => buildQuestionDraft({ taskName: session.task_name, summary, notes }),
    [session.task_name, summary, notes],
  );
  // 表示するときに下書き全体を検査する（閉じているときは検査しない）
  const flags = useMemo(() => (open ? detectSensitive(draft) : []), [open, draft]);

  return (
    <>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "下書きを閉じる" : "先輩への質問文を下書き"}
      </button>
      {open && (
        <div className="flex w-full flex-col gap-2">
          {flags.length > 0 && (
            <p
              role="alert"
              className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
            >
              注意：{describeFlags(flags)}。送る前に伏せてください。パターンで取りこぼす情報もあります
            </p>
          )}
          <textarea
            readOnly
            aria-label="質問文の下書き"
            value={draft}
            rows={Math.min(24, draft.split("\n").length + 1)}
            className="w-full rounded border px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={draft} label="質問文をコピー" />
            <span className="text-xs text-gray-600 dark:text-gray-400">送信はしません。コピーしてチャットなどに貼ってください</span>
          </div>
        </div>
      )}
    </>
  );
}
