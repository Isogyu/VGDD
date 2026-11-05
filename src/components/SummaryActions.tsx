"use client";

// T-002 が中身を書く差し込み口。props／引数の名前と型は T-002 の票が前提にしているので変えない。
// S-2 の整理結果（8項目）の直後に置く操作（Markdown でコピーなど）のための部品。

import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import QuestionDraft from "@/components/QuestionDraft";
import type { Note, WorkSession } from "@/lib/sessions";
import { summaryToMarkdown } from "@/lib/summary-markdown";
import type { Summary } from "@/lib/summary-schema";

export interface SummaryActionsProps {
  summary: Summary;
  notes: Note[];
  session: WorkSession;
}

export default function SummaryActions(props: SummaryActionsProps) {
  const text = summaryToMarkdown(props.summary, props.notes, props.session);
  // Markdown のコピーと質問文の下書き（T-006）を横に並べる。下書きの枠は折り返して下に広がる
  return (
    <div className="flex flex-wrap gap-2">
      <CopyButton text={text} label="Markdown でコピー" />
      <QuestionDraft summary={props.summary} notes={props.notes} session={props.session} />
      <Link href={`/sessions/${props.session.id}/share`} className="self-start rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800">チームに共有する</Link>
    </div>
  );
}
