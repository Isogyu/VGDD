// 時刻の扱い：保存も表示も JST（+09:00）の ISO 8601 文字列に固定する。
// ブラウザのタイムゾーンに依存させない（実装前の死角の確認より）。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

/** Date を JST の ISO 文字列（秒まで、+09:00 付き）にする */
export function toJstIso(d: Date): string {
  const t = new Date(d.getTime() + JST_OFFSET_MS);
  return (
    `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}` +
    `T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}+09:00`
  );
}

/** 現在時刻の JST ISO 文字列 */
export function nowJst(): string {
  return toJstIso(new Date());
}

/** JST ISO 文字列 2つの差を分で返す（切り捨て）。負にはしない */
export function diffMinutes(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.max(0, Math.floor(ms / 60000));
}

/** 所要時間の表示：1分未満 → 「1分未満」、60分未満 → 「45分」、それ以上 → 「4時間0分」 */
export function formatDuration(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "—";
  if (min < 1) return "1分未満";
  if (min < 60) return `${Math.floor(min)}分`;
  const h = Math.floor(min / 60);
  const m = Math.floor(min % 60);
  return `${h}時間${m}分`;
}

/** 前回との差の表示：−210 → 「前回より 3時間30分 短い」、+10 → 「前回より 10分 長い」、0 → 「前回と同じ」 */
export function formatDelta(deltaMin: number | null | undefined): string {
  if (deltaMin == null || !Number.isFinite(deltaMin)) return "";
  if (deltaMin === 0) return "前回と同じ";
  const abs = Math.abs(deltaMin);
  return `前回より ${abs < 1 ? "1分未満" : formatDuration(abs)} ${deltaMin < 0 ? "短い" : "長い"}`;
}

/** 画面表示用：「13:05」 */
export function formatHm(iso: string): string {
  return iso.slice(11, 16);
}

/** 画面表示用：「11/3 13:05」 */
export function formatMdHm(iso: string): string {
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return `${month}/${day} ${iso.slice(11, 16)}`;
}
