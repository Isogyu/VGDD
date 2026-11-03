"use client";

// T-002 が中身を書く差し込み口。props／引数の名前と型は T-002 の票が前提にしているので変えない。
// S-2 の整理結果（8項目）の直後に置く操作（Markdown でコピーなど）のための部品。

import CopyButton from "@/components/CopyButton";
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
  return <CopyButton text={text} label="Markdown でコピー" />;
}
