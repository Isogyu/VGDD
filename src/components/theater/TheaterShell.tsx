import type { ReactNode } from "react";
import { theaterTokens } from "./tokens";

type TheaterShellProps = {
  /** 作品名・観測の状態 */
  header: ReactNode;
  /** 主役の図 */
  stage: ReactNode;
  /** 選んだ票の詳細 */
  side: ReactNode;
  /** 再生の操作と要点 */
  controls: ReactNode;
};

// 統治シアターの骨格（T-029 A2）。受け取った中身を区画に並べるだけで、データも状態も持たない。
// 幅 1024px 未満は要素の順に縦に並ぶ。1024px 以上は画面の高さを行で 15:65:20 に分け、中央を 2:1 に分ける。
// 長い中身の扱い（区画の中のスクロールなど）は、中身を渡す票で決める。
export default function TheaterShell({ header, stage, side, controls }: TheaterShellProps) {
  return (
    <div
      className={`${theaterTokens.page.background} ${theaterTokens.page.text} grid min-h-dvh w-full grid-cols-1 gap-4 overflow-x-clip p-4 lg:h-dvh lg:grid-cols-3 lg:grid-rows-[15fr_65fr_20fr]`}
    >
      <header className="px-2 py-1 lg:col-span-3">{header}</header>
      {/* 主役の図の区画だけ、背景と枠を強くする */}
      <section aria-label="統治図" className="rounded-lg border border-slate-600 bg-slate-900 p-4 lg:col-span-2">
        {stage}
      </section>
      <aside aria-label="選んだ票" className="rounded-lg border border-slate-800 p-4">
        {side}
      </aside>
      <footer aria-label="再生の操作" className="rounded-lg border border-slate-800 p-4 lg:col-span-3">
        {controls}
      </footer>
    </div>
  );
}
