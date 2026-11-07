// 統治シアターの「判断待ちと次の担当」の欄（T-033 A3）。props だけで描き、取得しない。
// 出すのは、票の ID、整形した時刻、source の表示名、不変条件の ID・状態・試験の件数・結果と、決まった文だけ。

import type { KernelInvariants } from "@/lib/kernel-invariants-schema";
import { formatJst, type KernelState } from "@/lib/kernel-state-schema";
import type { TheaterSection } from "@/lib/theater-data";
import { invariantTone, pendingDecisions, type InvariantTone } from "@/lib/theater-evidence";

type DecisionPanelProps = {
  /** 取得前は null */
  state: TheaterSection<KernelState> | null;
  /** 取得前は null */
  invariants: TheaterSection<KernelInvariants> | null;
  sourceLabel: string;
  generatedAt: string | null;
};

type InvariantRow = KernelInvariants["invariants"][number];

const STATUS_LABELS: Record<InvariantRow["status"], string> = {
  enforced: "強制",
  partial: "一部",
  not_applicable: "対象外",
};

function resultLabel(verified: InvariantRow["verified"]): string {
  if (verified === true) return "合格";
  if (verified === false) return "不合格";
  return "未確認";
}

// 緑は "ok" だけに使う。札には文が入っているので、色だけで意味を伝えない
const TONE_CLASSES: Record<InvariantTone, string> = {
  ok: "border border-emerald-500 bg-emerald-950 text-emerald-300",
  partial: "border border-amber-500 bg-amber-950 text-amber-300",
  failed: "border border-red-500 bg-red-950 text-red-300",
  unknown: "border border-dashed border-gray-500 bg-gray-900 text-gray-300",
};

const STATE_UNAVAILABLE = {
  missing: "Kernel の写しの書き出しがありません。判断待ちは決められません",
  failed: "Kernel の写しを取得できませんでした。判断待ちは決められません",
} as const;

function Decisions({
  state,
  invariants,
}: {
  state: DecisionPanelProps["state"];
  invariants: DecisionPanelProps["invariants"];
}) {
  if (state === null) return <p>読み込み中…</p>;
  if (state.kind !== "ok") return <p>{STATE_UNAVAILABLE[state.kind]}</p>;

  const invariantsOk = invariants !== null && invariants.kind === "ok";
  const rows = pendingDecisions(state.value, invariantsOk ? invariants.value : null);
  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 ? (
        <p>判断待ちはありません</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.key} className="min-w-0 rounded border border-amber-500 bg-amber-950 p-2 text-sm">
              <p className="break-words font-medium text-amber-100">{row.what}</p>
              <p className="break-words text-slate-200">{`次の担当：${row.next}`}</p>
              {row.since !== null && <p className="text-xs tabular-nums text-slate-300">{formatJst(row.since)}</p>}
            </li>
          ))}
        </ul>
      )}
      {!invariantsOk && <p className="text-xs text-slate-300">不変条件の写しがないため、仕様の承認待ちは含みません</p>}
    </div>
  );
}

export default function DecisionPanel({ state, invariants, sourceLabel, generatedAt }: DecisionPanelProps) {
  return (
    <section aria-label="判断待ちと次の担当" className="flex min-w-0 flex-col gap-3 rounded-lg border border-slate-800 p-4">
      <div>
        <h2 className="text-lg font-semibold">判断待ちと次の担当</h2>
        <p className="text-xs text-slate-300">{`${sourceLabel}・${formatJst(generatedAt)}の写しから`}</p>
      </div>
      <Decisions state={state} invariants={invariants} />
      {invariants !== null && invariants.kind === "ok" && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">不変条件</h3>
          <ul className="flex flex-wrap gap-1.5 text-xs">
            {invariants.value.invariants.map((row, i) => (
              <li key={`${row.id}-${i}`} className={`rounded px-1.5 py-0.5 tabular-nums ${TONE_CLASSES[invariantTone(row)]}`}>
                {`${row.id}・${STATUS_LABELS[row.status]}・試験 ${row.tests} 件・${resultLabel(row.verified)}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
