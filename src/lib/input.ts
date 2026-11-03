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

/**
 * 送信に失敗したときに、送信した文字を入力欄に戻す。
 * 送信直後に入力欄は空にしてある（下の方針）ので、その後に打たれた文字の前に戻す。
 */
export function restoreSubmitted(current: string, submitted: string): string {
  if (!submitted) return current;
  if (!current) return submitted;
  return `${submitted} ${current.replace(/^\s+/, "")}`;
}

/*
 * 方針（2026-11-03 の不具合「2件のメモが1件に結合される」を受けて）：
 *   送信した瞬間に入力欄から送信分を消す（optimistic）。保存の完了を待たない。
 *   こうすると、1件目の保存が終わる前に2件目を打って送信しても、入力欄に1件目の文字が残っていないので結合しない。
 *   失敗したときだけ restoreSubmitted で戻す。
 */
