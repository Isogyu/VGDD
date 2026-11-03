// 入力欄の文字列を「作業開始／作業終了／メモ」に振り分ける（M1-2・M3）。
// 決定論的な照合だけで判定し、LLM には頼らない。同じ入力は常に同じ結果になる。

export type Command =
  | { type: "start"; taskName: string }
  | { type: "end" }
  | { type: "memo"; body: string }
  | { type: "empty" };

/** 全角・半角の空白をまとめ、前後の空白と末尾の句点・感嘆符を落とす */
export function normalizeText(input: string): string {
  return input
    .replace(/[　\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .replace(/[。．.!！]+$/u, "")
    .trim();
}

/** 作業名の正規化（M1-4 の完全一致に使う）：空白をまとめ、前後を落とす */
export function normalizeTaskName(name: string): string {
  return normalizeText(name).replace(/\s+/g, " ");
}

// 「〇〇の作業開始」「〇〇の作業を開始」「〇〇 開始」「〇〇、作業開始」「作業開始：〇〇」「開始 〇〇」
const START_PATTERNS: RegExp[] = [
  /^(.+?)\s*[のを、,]?\s*作業(?:を)?(?:開始|始めます|はじめます|スタート)$/u,
  /^(.+?)\s*[、,]?\s*(?:開始|スタート|始めます|はじめます)$/u,
  /^(?:作業)?(?:開始|スタート)\s*[:：]\s*(.+)$/u,
  /^(?:作業)?(?:開始|スタート)\s+(.+)$/u,
];

// 「作業終了」「終了」「〇〇の作業終了」「作業を終わります」「おわり」
const END_PATTERNS: RegExp[] = [
  /^(?:.+?\s*[のを、,]?\s*)?作業(?:を)?(?:終了|終わり|終わります|おわり|完了)$/u,
  /^(?:終了|終わり|終わります|おわり|完了|作業終了)$/u,
];

/** 入力1件を解釈する */
export function parseCommand(input: string): Command {
  const text = normalizeText(input);
  if (!text) return { type: "empty" };

  for (const re of END_PATTERNS) {
    if (re.test(text)) return { type: "end" };
  }
  for (const re of START_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const taskName = normalizeTaskName(m[1]);
      // 「作業開始」だけ、または作業名が空なら、メモとして扱わず空にする（画面側で作業名を求める）
      if (!taskName || /^(作業|の)$/u.test(taskName)) return { type: "empty" };
      return { type: "start", taskName };
    }
  }
  return { type: "memo", body: text };
}
