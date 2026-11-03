"use client";

// 文字列をクリップボードにコピーするボタン（T-002。M10-2 の質問文の下書きでも使う予定）。
// 成功したら2秒間「コピーしました」と表示して元の label に戻る。失敗したら「コピーできませんでした」と表示する。

import { useEffect, useRef, useState } from "react";

export interface CopyButtonProps {
  text: string;
  label: string;
}

const RESET_MS = 2000;

export default function CopyButton({ text, label }: CopyButtonProps) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // unmount 時にタイマーを止める
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function handleClick() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) throw new Error("clipboard がない");
      await navigator.clipboard.writeText(text);
      setMessage("コピーしました");
      timer.current = setTimeout(() => {
        setMessage(null);
        timer.current = null;
      }, RESET_MS);
    } catch {
      setMessage("コピーできませんでした");
    }
  }

  return (
    <button type="button" onClick={handleClick} aria-live="polite">
      {message ?? label}
    </button>
  );
}
