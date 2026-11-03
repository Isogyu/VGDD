// 入力欄の状態の扱い（純粋関数。画面から呼ぶ）

/**
 * 送信が完了したときに入力欄から「送信した文字だけ」を消す。
 * 送信後に打たれた文字は残す（入力欄は送信中も編集できる）。
 * - 送信時の文字列がそのまま先頭に残っていれば、その部分だけ取り除く
 * - 送信後に本人が先頭を書き換えていたら、何も消さない（本人の編集を失わないため）
 */
export function removeSubmittedPrefix(current: string, submitted: string): string {
  if (!submitted) return current;
  if (current === submitted) return "";
  if (current.startsWith(submitted)) return current.slice(submitted.length).replace(/^\s+/, "");
  return current;
}
