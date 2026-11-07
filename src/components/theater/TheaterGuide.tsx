// 「はじめて見る」の案内の欄（T-037 A2）。表示だけで、状態を持たない。
// 手順の番号を受け、その手順の文と操作のボタンを出す。動きの演出は付けない。

import { GUIDE_NOTE, GUIDE_STEPS } from "@/lib/theater-guide";

type TheaterGuideProps = {
  /** 手順の番号（0 から 4） */
  step: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
};

const BUTTON =
  "rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50";

export default function TheaterGuide({ step, onPrev, onNext, onClose }: TheaterGuideProps) {
  const current = GUIDE_STEPS[step];
  const isFirst = step === 0;
  const isLast = step === GUIDE_STEPS.length - 1;

  return (
    <div role="region" aria-label="はじめて見る人への案内" className="flex flex-col gap-2">
      {/* 手順が変わったことを読み上げる */}
      <div aria-live="polite" className="flex flex-col gap-2">
        <p className="text-xs tabular-nums text-slate-300">
          {`${step + 1} / ${GUIDE_STEPS.length}`}
        </p>
        <h3 className="font-medium">{current.title}</h3>
        <p className="text-sm">{current.body}</p>
      </div>
      <div className="flex flex-wrap gap-1">
        <button type="button" onClick={onPrev} disabled={isFirst} className={BUTTON}>
          戻る
        </button>
        {isLast ? (
          <button type="button" onClick={onClose} className={BUTTON}>
            終える
          </button>
        ) : (
          <button type="button" onClick={onNext} className={BUTTON}>
            次へ
          </button>
        )}
        <button type="button" onClick={onClose} className={BUTTON}>
          案内を終える
        </button>
      </div>
      <p className="text-xs text-slate-300">{GUIDE_NOTE}</p>
    </div>
  );
}
