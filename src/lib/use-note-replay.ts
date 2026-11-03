// T-003 が中身を書く差し込み口。props／引数の名前と型は T-003 の票が前提にしているので変えない。
// 整理の待ち時間に、左のメモを順に強調する演出のためのフック。強調中のメモ番号（1始まりの #番号）を返す予定。
// 今は何もしない（常に null）。

export function useNoteReplay(count: number, active: boolean): number | null {
  void count;
  void active;
  return null;
}
