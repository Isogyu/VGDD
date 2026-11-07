// 票1枚の再生（T-032）の、表示の文・時刻・再生の状態の純粋関数。
// クライアントの部品から読むので node:fs を使わない。

import type { Replay } from "./governance-replay-schema";

type ReplayEvent = Replay["tickets"][number]["events"][number];

export type EventTone = "waiting" | "human" | "merged" | "unknown" | "normal";

// 出来事の分類。kind と reason の組がどれにも当たらないものは「記録の分類の外」として扱う。
export type EventClass = { kind: string; reason: string | null };

const OUTSIDE_LABEL = "記録の分類の外の出来事";

// reason が null の行は、reason が null のときだけ当てる。
const EVENT_ROWS: readonly { kind: string; reason: string | null; label: string; tone: EventTone }[] = [
  { kind: "returned", reason: "scope", label: "許された範囲の外のファイルの変更として差し戻された", tone: "normal" },
  { kind: "returned", reason: "rebase", label: "最新の main を含まないとして差し戻された", tone: "normal" },
  { kind: "returned", reason: "security", label: "セキュリティ審査で差し戻された", tone: "normal" },
  { kind: "returned", reason: "judiciary", label: "司法の2系統がともに差し戻した", tone: "normal" },
  { kind: "returned", reason: "other", label: "差し戻された", tone: "normal" },
  {
    kind: "blocked",
    reason: "disagreement",
    label: "司法の2系統が重大な指摘で分かれたため止めた。人の裁定へ",
    tone: "waiting",
  },
  { kind: "blocked", reason: "return_limit", label: "差し戻しが3回に達したとの記録で止めた。人の判断へ", tone: "waiting" },
  { kind: "blocked", reason: "spec_unapproved", label: "仕様が人に承認されていないため止めた", tone: "waiting" },
  { kind: "blocked", reason: "other", label: "止めた（理由は記録の分類の外）", tone: "unknown" },
  { kind: "held", reason: null, label: "合格。夜間のため統合を保留し、人の承認を待つ", tone: "waiting" },
  { kind: "merged", reason: null, label: "統合した（裁判所）", tone: "merged" },
  { kind: "released", reason: null, label: "統合した（人が承認）", tone: "human" },
  { kind: "ruling", reason: null, label: "人が裁定した", tone: "human" },
  {
    kind: "minor_disagreement",
    reason: null,
    label: "司法が軽微な指摘で分かれた。厳しい側の指摘を残して進めた",
    tone: "normal",
  },
  { kind: "resubmitted", reason: null, label: "作業員の実装を前検査で確認し、申請し直した", tone: "normal" },
  { kind: "other", reason: null, label: OUTSIDE_LABEL, tone: "normal" },
];

function findRow({ kind, reason }: EventClass) {
  return EVENT_ROWS.find((row) => row.kind === kind && row.reason === reason);
}

/** 出来事の表示の文（A1）。表にない組み合わせは「記録の分類の外の出来事」 */
export function labelFor(event: EventClass): string {
  return findRow(event)?.label ?? OUTSIDE_LABEL;
}

/** 出来事の見た目の種類（A2）。表にない組み合わせは unknown */
export function toneFor(event: EventClass): EventTone {
  return findRow(event)?.tone ?? "unknown";
}

const UNREADABLE_TIME = "時刻を確認できません";
const TS_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-])(\d{2})(\d{2})$/;
const MINUTE_MS = 60_000;
// Asia/Tokyo の時差。夏時間がないので固定の値で足り、実行環境のタイムゾーンとロケールの影響を受けない。
const JST_OFFSET_MS = 9 * 60 * MINUTE_MS;

// +0900 の形は実行環境によって Date.parse が読めないので、自分で読む。
// 2月31日のような存在しない日時は、繰り上げずに読めないものとして扱う。
function parseTs(ts: string): number | null {
  const match = typeof ts === "string" ? TS_PATTERN.exec(ts) : null;
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const offsetHour = Number(match[8]);
  const offsetMinute = Number(match[9]);
  if (offsetHour > 23 || offsetMinute > 59) return null;

  const wall = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const isRealTime =
    wall.getUTCFullYear() === year &&
    wall.getUTCMonth() === month - 1 &&
    wall.getUTCDate() === day &&
    wall.getUTCHours() === hour &&
    wall.getUTCMinutes() === minute &&
    wall.getUTCSeconds() === second;
  if (!isRealTime) return null;

  const offsetMs = (offsetHour * 60 + offsetMinute) * MINUTE_MS;
  return wall.getTime() - (match[7] === "+" ? offsetMs : -offsetMs);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 記録の時刻を Asia/Tokyo の MM/DD HH:mm にする。読めなければ決まった文を返す */
export function formatJst(ts: string): string {
  const epochMs = parseTs(ts);
  if (epochMs === null) return UNREADABLE_TIME;
  const jst = new Date(epochMs + JST_OFFSET_MS);
  return `${pad2(jst.getUTCMonth() + 1)}/${pad2(jst.getUTCDate())} ${pad2(jst.getUTCHours())}:${pad2(jst.getUTCMinutes())}`;
}

/** 最初の出来事からの実際の経過を、分に切り捨てて示す */
export function elapsedLabel(firstTs: string | null, currentTs: string | null): string {
  if (firstTs === null || currentTs === null) return "実際の経過：—";
  const first = parseTs(firstTs);
  const current = parseTs(currentTs);
  if (first === null || current === null || current < first) return UNREADABLE_TIME;
  const totalMinutes = Math.floor((current - first) / MINUTE_MS);
  return `実際の経過：最初の出来事から ${Math.floor(totalMinutes / 60)} 時間 ${totalMinutes % 60} 分`;
}

export type ReplaySpeed = 0.5 | 1 | 2;

export type ReplayState = { index: number; playing: boolean; speed: ReplaySpeed };

export type ReplayAction =
  | { type: "play" | "tick" | "pause" | "next" | "prev" | "reset"; count: number }
  | { type: "setSpeed"; speed: ReplaySpeed; count: number };

export const INITIAL_REPLAY: ReplayState = { index: -1, playing: false, speed: 1 };

export const REPLAY_SPEEDS: readonly ReplaySpeed[] = [0.5, 1, 2];

// 変わらないときは同じオブジェクトを返す。部品の再描画とタイマーの数え直しを起こさないため。
function withChanges(state: ReplayState, index: number, playing: boolean, speed = state.speed): ReplayState {
  if (state.index === index && state.playing === playing && state.speed === speed) return state;
  return { index, playing, speed };
}

/** 再生の状態を進める。出来事の数は action の count で受ける */
export function replayReducer(state: ReplayState, action: ReplayAction): ReplayState {
  const speed = action.type === "setSpeed" && REPLAY_SPEEDS.includes(action.speed) ? action.speed : state.speed;
  // 出来事がなければ、位置と再生中だけを初期に戻す（速さの指定は保つ）
  if (action.count <= 0) return withChanges(state, -1, false, speed);

  const last = action.count - 1;
  switch (action.type) {
    case "play":
      return state.index >= last ? state : withChanges(state, state.index, true);
    case "tick": {
      if (!state.playing) return state;
      const index = Math.min(state.index + 1, last);
      return withChanges(state, index, index < last);
    }
    case "pause":
      return withChanges(state, state.index, false);
    case "next":
      return withChanges(state, Math.min(state.index + 1, last), false);
    case "prev":
      return withChanges(state, Math.max(state.index - 1, -1), false);
    case "reset":
      return withChanges(state, -1, false);
    case "setSpeed":
      return withChanges(state, state.index, state.playing, speed);
  }
}

/** 次の tick までの間隔（ミリ秒）。1倍で 1500 */
export function intervalMs(speed: ReplaySpeed): number {
  return 1500 / speed;
}

export const FEATURED_TICKETS = ["T-014", "T-026", "T-013"] as const;

/** 例の票のうち、入力にあるものを FEATURED_TICKETS の順で返す */
export function pickFeatured<T extends { id: string }>(tickets: readonly T[]): T[] {
  return FEATURED_TICKETS.flatMap((id) => tickets.find((ticket) => ticket.id === id) ?? []);
}

// 全票の索引（T-040）。印は公開用の出来事の分類（T-028）に出てきた数だけで数える。
// 生の §6・判定の結論・今の状態から推し量らず、後の訂正や取り消しで引かない。released は裁定に入れない。

export type TicketMarks = { returned: number; disagreement: number; ruling: number };

/** 票ごとの印の数（差し戻し・判定の不一致・人の裁定） */
export function ticketMarks(ticket: { events: readonly EventClass[] }): TicketMarks {
  const marks: TicketMarks = { returned: 0, disagreement: 0, ruling: 0 };
  for (const { kind, reason } of ticket.events) {
    if (kind === "returned") marks.returned += 1;
    else if (kind === "minor_disagreement" || (kind === "blocked" && reason === "disagreement")) marks.disagreement += 1;
    else if (kind === "ruling") marks.ruling += 1;
  }
  return marks;
}

export type ReplayFilter = "all" | keyof TicketMarks;

export const REPLAY_FILTERS: readonly { value: ReplayFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "disagreement", label: "不一致あり" },
  { value: "ruling", label: "裁定あり" },
  { value: "returned", label: "差し戻しあり" },
];

/** 出来事が1件以上ある票を、代表の票（pickFeatured の順）を先頭に、残りを id の昇順で並べ、絞り込みの印が 1 以上のものだけ残す */
export function replayOptions<T extends { id: string; events: readonly EventClass[] }>(
  tickets: readonly T[],
  filter: ReplayFilter,
): T[] {
  const withEvents = tickets.filter((ticket) => ticket.events.length > 0);
  const featured = pickFeatured(withEvents);
  // 同じ id の票は最初の1つだけ入れる
  const seen = new Set<string>(featured.map((ticket) => ticket.id));
  const rest: T[] = [];
  for (const ticket of withEvents) {
    if (seen.has(ticket.id)) continue;
    seen.add(ticket.id);
    rest.push(ticket);
  }
  // 文字列の昇順（ロケールに依らない比較）
  rest.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ordered = [...featured, ...rest];
  return filter === "all" ? ordered : ordered.filter((ticket) => ticketMarks(ticket)[filter] >= 1);
}

/** 0 でない印だけを「差し戻し」「不一致」「裁定」の順に「・」でつなぐ。すべて 0 なら空 */
export function marksLabel(marks: TicketMarks): string {
  const parts: string[] = [];
  if (marks.returned > 0) parts.push(`差し戻し ${marks.returned}`);
  if (marks.disagreement > 0) parts.push(`不一致 ${marks.disagreement}`);
  if (marks.ruling > 0) parts.push(`裁定 ${marks.ruling}`);
  return parts.join("・");
}

/** 票が変わったか、出来事の数か seq の並びが変わったかを比べるための文字列 */
export function ticketSignature(ticket: { id: string; events: readonly { seq: number }[] } | null): string {
  return ticket ? `${ticket.id}|${ticket.events.map((event) => event.seq).join(",")}` : "";
}

const VERDICT_LABELS = { APPROVED: "合格", CHANGES_REQUIRED: "差し戻し" } as const;

/** 判定の結論の表示。null の系統は出さない */
export function verdictLabels({ judge, codex }: Pick<ReplayEvent, "judge" | "codex">): string[] {
  const labels: string[] = [];
  if (judge !== null) labels.push(`Claude：${VERDICT_LABELS[judge]}`);
  if (codex !== null) labels.push(`Codex：${VERDICT_LABELS[codex]}`);
  return labels;
}
