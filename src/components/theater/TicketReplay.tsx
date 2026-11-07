"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { Replay } from "@/lib/governance-replay-schema";
import {
  elapsedLabel,
  formatJst,
  INITIAL_REPLAY,
  intervalMs,
  labelFor,
  pickFeatured,
  REPLAY_SPEEDS,
  replayReducer,
  ticketSignature,
  toneFor,
  verdictLabels,
  type EventClass,
  type ReplayAction,
} from "@/lib/theater-replay";
import { theaterTokens } from "./tokens";

type ReplayTicket = Replay["tickets"][number];
type ReplayEvent = ReplayTicket["events"][number];

type TicketReplayProps = {
  tickets: Replay["tickets"];
  onEventChange: (event: ReplayEvent | null) => void;
};

const TONE_TOKENS = {
  waiting: theaterTokens.states.waiting,
  human: theaterTokens.roles.human,
  merged: theaterTokens.roles.merged,
  unknown: theaterTokens.states.unknown,
  normal: null,
};

const BEFORE_START = "再生を押すと、この票の記録を順に追います";

const BUTTON_CLASS =
  "rounded border border-slate-600 bg-slate-800 px-2 py-1 text-sm text-slate-100 hover:bg-slate-700 aria-disabled:cursor-not-allowed aria-disabled:border-slate-800 aria-disabled:bg-slate-900 aria-disabled:text-slate-400";

// 種類のラベルと形の印。normal には何も付けない
function ToneBadge({ event }: { event: EventClass }) {
  const token = TONE_TOKENS[toneFor(event)];
  if (!token) return null;
  return (
    <span className={`inline-block shrink-0 rounded px-1.5 text-xs ${token.text} ${token.border} ${token.background}`}>
      <span aria-hidden="true">{token.mark}</span> {token.label}
    </span>
  );
}

// 統治シアターの下の区画に置く、票1枚の再生（T-032）。データは取りに行かず、props の出来事だけを出す。
export default function TicketReplay({ tickets, onEventChange }: TicketReplayProps) {
  const options = pickFeatured(tickets);
  const [selectedId, setSelectedId] = useState(options[0]?.id ?? null);
  const [replay, dispatch] = useReducer(replayReducer, INITIAL_REPLAY);

  // 選んだ票がなくなったら、並びの先頭に移る
  const ticket: ReplayTicket | null = options.find((option) => option.id === selectedId) ?? options[0] ?? null;
  const ticketId = ticket?.id ?? null;
  if (ticketId !== selectedId) setSelectedId(ticketId);

  const events = ticket?.events ?? [];
  const count = events.length;

  // 票か、出来事の数か、seq の並びが変わったら最初に戻す。
  // 描画の中で直すので、古い位置のままの画面は確定しない。票が同じなら tickets の参照が変わっても戻さない。
  const signature = ticketSignature(ticket);
  const [appliedSignature, setAppliedSignature] = useState(signature);
  if (appliedSignature !== signature) {
    setAppliedSignature(signature);
    dispatch({ type: "reset", count });
  }

  const currentEvent = events[replay.index] ?? null;

  // 再生中だけタイマーを動かす。再開・速さの変更では作り直すので、新しい間隔を最初から数える。
  // 一時停止・票の変更（どちらも playing が false になる）・速さの変更・部品が外れるときは片付けで止まる。
  const { playing, speed } = replay;
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => dispatch({ type: "tick", count }), intervalMs(speed));
    return () => clearInterval(timer);
  }, [playing, speed, count]);

  // 親への通知は確定の後に、票か index が変わったときだけ行う。
  // 関数と出来事は最新の値を ref で読み、参照が変わっただけでは通知しない。
  const latest = useRef({ onEventChange, currentEvent });
  useEffect(() => {
    latest.current = { onEventChange, currentEvent };
  });
  const notifyKey = `${signature}#${replay.index}`;
  const notifiedKey = useRef(notifyKey);
  useEffect(() => {
    if (notifiedKey.current === notifyKey) return;
    notifiedKey.current = notifyKey;
    latest.current.onEventChange(latest.current.currentEvent);
  }, [notifyKey]);

  if (!ticket) {
    return (
      <div className="h-full min-h-0">
        <p>再生できる票がありません</p>
      </div>
    );
  }

  const send = (type: Exclude<ReplayAction["type"], "setSpeed">) => dispatch({ type, count });
  const atLast = replay.index >= count - 1;
  // 押せないボタンも disabled にしない（押した直後にキーボードの位置が失われないように）。押しても状態は変わらない
  const controls = [
    { name: "再生", type: "play", inactive: replay.playing || atLast },
    { name: "一時停止", type: "pause", inactive: !replay.playing },
    { name: "1つ戻す", type: "prev", inactive: replay.index < 0 },
    { name: "1つ送る", type: "next", inactive: atLast },
    { name: "最初から", type: "reset", inactive: replay.index < 0 && !replay.playing },
  ] as const;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex min-w-0 items-center gap-2 text-sm">
          <span className="shrink-0">票を選ぶ</span>
          <select
            value={ticket.id}
            onChange={(e) => setSelectedId(e.target.value)}
            className="min-w-0 max-w-full truncate rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100"
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.id} {option.title}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-1">
          {controls.map(({ name, type, inactive }) => (
            <button
              key={type}
              type="button"
              aria-disabled={inactive}
              onClick={() => send(type)}
              className={BUTTON_CLASS}
            >
              {name}
            </button>
          ))}
        </div>
        <div role="group" aria-label="速さ" className="flex gap-1">
          {REPLAY_SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={replay.speed === value}
              onClick={() => dispatch({ type: "setSpeed", speed: value, count })}
              className={`${BUTTON_CLASS} aria-pressed:border-slate-300 aria-pressed:font-semibold`}
            >
              {value}倍
            </button>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 rounded border border-slate-700 bg-slate-900 px-3 py-2">
        {currentEvent && <ToneBadge event={currentEvent} />}
        <p aria-live="polite" className="min-w-0 flex-1 font-medium">
          {currentEvent ? labelFor(currentEvent) : BEFORE_START}
        </p>
        <p className="shrink-0 text-xs text-slate-300">
          {elapsedLabel(events[0]?.ts ?? null, currentEvent?.ts ?? null)}
          <span className="ml-3">再生では時間を圧縮しています</span>
        </p>
      </div>

      <ol aria-label="この票の出来事" tabIndex={0} className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {events.map((event, i) => {
          const isCurrent = i === replay.index;
          return (
            <li
              key={`${event.seq}-${i}`}
              aria-current={isCurrent ? "step" : undefined}
              className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded border-l-4 px-2 py-1 text-sm motion-safe:transition-colors ${
                isCurrent ? "border-slate-100 bg-slate-700 font-semibold" : "border-transparent"
              }`}
            >
              <span className="shrink-0 tabular-nums text-slate-300">{formatJst(event.ts)}</span>
              <span className="min-w-0">{labelFor(event)}</span>
              <ToneBadge event={event} />
              {verdictLabels(event).map((verdict) => (
                <span key={verdict} className="shrink-0 text-xs text-slate-300">
                  {verdict}
                </span>
              ))}
            </li>
          );
        })}
      </ol>
      <p className="shrink-0 text-xs text-slate-300">記録の当時の分類です。後の訂正や取り消しは含みません</p>
    </div>
  );
}
