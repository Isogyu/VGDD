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
// 幅 1024px 未満は要素の順に縦に並ぶ（content-start で、行を伸ばして見出しの下に空きを作らない）。
// 1024px 以上は、見出しを中身の高さ、再生を 16rem、主役と選んだ票を残りの高さにし、中央を 2:1 に分ける（T-034 A4）。
export default function TheaterShell({ header, stage, side, controls }: TheaterShellProps) {
  return (
    <div
      className={`${theaterTokens.page.background} ${theaterTokens.page.text} grid min-h-dvh w-full grid-cols-1 content-start gap-4 overflow-x-clip p-4 lg:h-dvh lg:grid-cols-3 lg:grid-rows-[auto_minmax(0,1fr)_16rem]`}
    >
      <header className="px-2 py-1 lg:col-span-3">{header}</header>
      {/* 主役の図の区画だけ、背景と枠を強くする */}
      <section aria-label="統治図" className="min-h-0 rounded-lg border border-slate-600 bg-slate-900 p-4 lg:col-span-2">
        {stage}
      </section>
      <aside aria-label="選んだ票" className="min-h-0 overflow-y-auto rounded-lg border border-slate-800 p-4">
        {side}
      </aside>
      <footer aria-label="再生の操作" className="min-h-0 rounded-lg border border-slate-800 p-4 lg:col-span-3">
        {controls}
      </footer>
    </div>
  );
}
