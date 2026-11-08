// 統治の画面の Kernel の区画に置く「予算と実行（台帳の集計）」。T-045。
// 受け取るのは KernelPanel が取って検証した状態だけ。取得も検証もし直さない。
// 読むのは budget・runs・acceptance の3項目だけ。項目がなければ値を作らず「写しにない」と出す。

import { formatJst, type KernelState } from "@/lib/kernel-state-schema";
import { budgetRows, fmt, pendingPreview, periodLabel, runsRows } from "@/lib/kernel-budget";

export const FIXED_NOTE =
  "契約の利用枠（サブスクリプション）の残りは読めない。推定費用は出さない。数えるのは Kernel の窓口を通った呼び出しだけで、行政の長・立法補佐・オーナーのメインの会話は含まない";

/** 割合に添える文字。色だけで示さない */
function percentMark(percent: number | null): string {
  if (percent === null) return "";
  if (percent >= 100) return "（上限に達した）";
  if (percent >= 80) return "（上限に近い）";
  return "";
}

const missing = "text-sm text-zinc-500";

export default function KernelBudget({ state }: { state: KernelState }) {
  const { budget, runs, acceptance } = state;

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-medium text-zinc-500">予算と実行（台帳の集計）</h3>

      {/* 予算 */}
      {budget === undefined ? (
        <p className={missing}>この写しには予算の集計がない</p>
      ) : (
        <div className="overflow-x-auto">
          <p className="mb-1 text-sm">
            {`期間 ${periodLabel(budget.period_id)}・${
              budget.until === null ? "終わりの指定なし" : `${formatJst(budget.until)} まで`
            }`}
          </p>
          <table className="w-full text-left text-sm">
            <caption className="mb-1 text-left text-xs text-zinc-500">予算の使用</caption>
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-1 pr-3 font-medium">項目</th>
                <th className="py-1 font-medium">使用 ／ 上限（割合）</th>
              </tr>
            </thead>
            <tbody>
              {budgetRows(budget).map(({ label, row }) => (
                <tr key={label} className="border-t border-zinc-200 dark:border-zinc-700">
                  <td className="py-1 pr-3 whitespace-nowrap">{label}</td>
                  <td className="py-1 tabular-nums">{`${row.text}${percentMark(row.percent)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {budget.tokens.unknown_runs >= 1 && (
            <p className="mt-1 text-xs text-zinc-500">
              {`利用量を読めなかった実行 ${fmt(budget.tokens.unknown_runs)} 件は、予約の全量を使ったものとして数えている`}
            </p>
          )}
        </div>
      )}

      {/* 実行の状態 */}
      {runs === undefined ? (
        <p className={missing}>この写しには実行の状態がない</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="mb-1 text-left text-xs text-zinc-500">実行の状態</caption>
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="py-1 pr-3 font-medium">状態</th>
                <th className="py-1 font-medium">件数</th>
              </tr>
            </thead>
            <tbody>
              {runsRows(runs).map(({ key, label, count }) => {
                const needsCheck = (key === "liveness_unknown" || key === "usage_unknown") && count >= 1;
                return (
                  <tr key={key} className="border-t border-zinc-200 dark:border-zinc-700">
                    <td className="py-1 pr-3 whitespace-nowrap">{label}</td>
                    <td className="py-1 tabular-nums">
                      {`${fmt(count)} 件${needsCheck ? "（オーナーの照合が要る）" : ""}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 受け入れ */}
      {acceptance === undefined ? (
        <p className={missing}>この写しには受け入れの記録がない</p>
      ) : (
        <AcceptanceView acceptance={acceptance} />
      )}

      <p className="text-xs text-zinc-500">{FIXED_NOTE}</p>
    </div>
  );
}

function AcceptanceView({ acceptance }: { acceptance: NonNullable<KernelState["acceptance"]> }) {
  const { ids, more } = pendingPreview(acceptance);
  return (
    <div className="text-sm">
      <p>{`受け入れ済み ${fmt(acceptance.accepted_count)} 件・受け入れ待ち ${fmt(acceptance.pending_count)} 件`}</p>
      {ids.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-2 text-xs" aria-label="受け入れ待ちの票">
          {ids.map((id, i) => (
            <li key={`${id}-${i}`} className="rounded border border-zinc-200 px-2 py-1 font-mono dark:border-zinc-700">
              {id}
            </li>
          ))}
        </ul>
      )}
      {more >= 1 && <p className="mt-1 text-xs text-zinc-500">{`ほか ${fmt(more)} 件`}</p>}
    </div>
  );
}
