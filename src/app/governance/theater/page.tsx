import type { Metadata } from "next";
import TheaterShell from "@/components/theater/TheaterShell";

export const metadata: Metadata = {
  title: "統治シアター（試作）— VGDD Governance Kernel",
};

// 統治シアターの骨格を見るための入口（T-029 A3）。区画の中身は後の票が差し込む。
function Placeholder({ name }: { name: string }) {
  return <p className="text-sm text-slate-300">{name}（後の票で中身を入れる）</p>;
}

export default function TheaterPage() {
  return (
    <TheaterShell
      header={
        <>
          <h1 className="text-2xl font-bold">VGDD Governance Kernel</h1>
          <p className="mt-1 text-sm text-slate-300">
            AI が作る。別系統の AI が独立して確かめる。統合の条件は Kernel が強制し、承認と停止は人が持つ。
          </p>
        </>
      }
      stage={<Placeholder name="統治図" />}
      side={<Placeholder name="選んだ票" />}
      controls={<Placeholder name="再生の操作" />}
    />
  );
}
