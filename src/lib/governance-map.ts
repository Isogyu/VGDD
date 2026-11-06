// 統治の全体図（T-026。可視化 V1）の数字を組み立てる純粋関数。
// 入力は Kernel の状態の写し・票の盤・操作の集計の3つだけ。どれかがなければ、その数は「—」にする。
// 型だけを読む（governance.ts は node:fs を使うので、値は読み込まない）。

import type { GovernanceBoard, GovernanceSummary } from "@/lib/governance";
import type { KernelState } from "@/lib/kernel-state-schema";

export type GovernanceFigure = { label: string; value: string };

export type GovernanceBox = {
  title: string;
  role: string;
  figures: GovernanceFigure[];
};

export type GovernanceMap = {
  citizen: GovernanceBox;
  legislative: GovernanceBox;
  executive: GovernanceBox;
  judiciary: GovernanceBox;
  kernel: GovernanceBox;
};

const DASH = "—";

/** 数を文字列にする。取れないときは「—」（0 は「0」のまま） */
function count(n: number | undefined): string {
  return n === undefined ? DASH : String(n);
}

export function buildGovernanceMap(input: {
  state: KernelState | null;
  board: GovernanceBoard | null;
  summary: GovernanceSummary | null;
}): GovernanceMap {
  const { state, board, summary } = input;

  // by_agent に鍵がなければ undefined のまま「—」にする
  const agentCalls = (agent: string): string => {
    const entry: { calls: number } | undefined = summary?.by_agent[agent];
    return count(entry?.calls);
  };

  let kernelStatus = "確認できない";
  if (state) kernelStatus = state.stopped.active ? "停止中" : "稼働中";

  return {
    citizen: {
      title: "市民（オーナー）",
      role: "目的と制約を決め、仕様を承認し、裁定し、止める",
      figures: [
        { label: "承認済みの仕様", value: count(state?.approvals.filter((a) => a.current).length) },
        { label: "裁定", value: count(state?.rulings.tasks.length) },
        { label: "Kernel（取得した写し）", value: kernelStatus },
      ],
    },
    legislative: {
      title: "立法（立法補佐・憲法審査）",
      role: "憲法と法律を起草し、票の受け入れ条件を書く",
      figures: [
        { label: "法律の版", value: state?.kernel_version ?? DASH },
        { label: "憲法審査の呼び出し", value: agentCalls("constitutional-review") },
      ],
    },
    executive: {
      title: "行政（行政の長・作業員）",
      role: "票を読んで作業員を起こし、隔離した作業場所で実装する。自分では統合できない",
      figures: [
        { label: "行政の長の操作", value: agentCalls("(main)") },
        { label: "作業員の操作", value: agentCalls("worker") },
        { label: "補助のエージェントの操作", value: agentCalls("general-purpose") },
      ],
    },
    judiciary: {
      title: "司法（judge・Codex）",
      role: "差分と受け入れ条件だけを見て、2つの系統で判定する。ツールを持たない",
      figures: [
        { label: "判定した票の数", value: count(state?.verdicts.by_task.size) },
        { label: "judge と Codex が分かれた票の数", value: count(state?.disagreements.tasks.length) },
      ],
    },
    kernel: {
      title: "Kernel（裁判所・フック・証拠ストア）",
      role: "成立した規則を、権限・停止・統合・証跡として実行時に強制する。自分で合否を判断しない",
      figures: [
        { label: "票の数", value: count(board?.tickets) },
        { label: "統合の出来事の数", value: count(board?.merged) },
        { label: "held の票の数", value: count(state?.held.length) },
        { label: "拒否した操作の数", value: count(summary?.tool_calls.deny) },
        { label: "証拠の記録の数", value: count(state?.evidence.records) },
      ],
    },
  };
}
