"use client";

// T-001 が中身を書く差し込み口。props／引数の名前と型は T-001 の票が前提にしているので変えない。
// S-2 の右の列で、同じ作業の前回の整理結果と比べるための部品。出すか出さないかはこの部品が決める。
// 今は何も描かない（常に null）。

export interface PreviousSummaryProps {
  sessionId: number;
  userId: string;
  taskName: string;
}

export default function PreviousSummary(props: PreviousSummaryProps) {
  void props;
  return null;
}
