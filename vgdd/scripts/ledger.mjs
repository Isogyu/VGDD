#!/usr/bin/env node
// VGDD Governance Kernel — 予算の台帳（法律 p0.4.9、D-66・D-67。SPEC §9）
//
// AI の呼び出し（作業員・司法・Codex の司法・憲法審査・要件の補助）を、起動の前に予約し、終わった後に精算する。
// 台帳 Z3/budget/ledger.jsonl が唯一の正本（追記だけ、ハッシュチェーン）。実行の状態は台帳から毎回作り直す。
// 上限は Z3/budget/limits.json（オーナーの操作 budget-set.sh だけが書く）。開発エージェントは Z3 を読み書きできない。
//
// 使い方（Kernel のスクリプト metered.sh・night-runner.sh から呼ぶ）:
//   node ledger.mjs begin --kind <worker|judge|codex|constitution|assist> --task <T-NNN|-> --req <要求の ID> --tokens <数|auto>
//        … 予約して実行の ID を標準出力に1行で返す（終了 0）。拒んだら終了 75、理由の符号を標準エラーに1行
//   node ledger.mjs started --run <実行の ID> --pid <数>
//   node ledger.mjs finish  --run <実行の ID> --code <終了コード> [--usage-file <ファイル>] [--format claude|none]
//   node ledger.mjs status [--json]
//   node ledger.mjs verify
//
// 守ること（SPEC §9、p0.4.9）:
//   - 追記は1つのロック（mkdir）の下で「台帳を読む → 鎖を確かめる → 遷移を確かめる → 追記 → fsync」を1回の処理にする
//   - 各出来事は event_id を持ち、同じ event_id の二度目は効かない（何度送っても一度だけ効く）
//   - 台帳の途中切れ・鎖の破損・上限の欠け・期間の外・停止中は、新しい予約をすべて拒む（fail-closed）
//   - 利用量が読めない呼び出しは、予約の全量を使ったものとして数える（0 にしない）
//   - 「起動中」（begin の後に started も finish もない）と、started の後に終わりを確かめられないものは、予約と枠を保つ
//   - 予約は起動の判断のための量で、1回の呼び出しが使える量の上限ではない。実際の消費が予約を超えたら超過を記録し、その票と全体の後続を止める

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const Z3 = process.env.VGDD_Z3_DIR || path.join(os.homedir(), 'tsubuyaki-z3');
const DIR = path.join(Z3, 'budget');
const LEDGER = path.join(DIR, 'ledger.jsonl');
const LIMITS = path.join(DIR, 'limits.json');
const LOCK = path.join(DIR, '.lock');
const HEAD = path.join(DIR, 'ledger.head');   // 最後の出来事の番号とハッシュ（行ごとの切り詰め・台帳の消失を見つける）
const KINDS = ['worker', 'judge', 'codex', 'constitution', 'assist'];
const JUDGE_KINDS = ['judge', 'codex'];
const TASK = /^T-[0-9]{3,4}$/;
const ID = /^[A-Za-z0-9._:-]{1,120}$/;
const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

export class Refused extends Error { constructor(code) { super(code); this.code = code; } }

function nowIso() { return new Date(Date.now() + 9 * 3600e3).toISOString().replace(/\.\d+Z$/, '+09:00'); }
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---- ロック ----------------------------------------------------------------------------------------
function withLock(fn) {
  fs.mkdirSync(DIR, { recursive: true });
  const deadline = Date.now() + 10000;
  for (;;) {
    try { fs.mkdirSync(LOCK); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // 取り残しのロックは自動では外さない（外すのはオーナーの照合）。待っても取れなければ拒む
      if (Date.now() > deadline) throw new Refused('lock_busy');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try { return fn(); } finally { fs.rmSync(LOCK, { recursive: true, force: true }); }
}

// ---- 台帳の読み書き ------------------------------------------------------------------------------
/** 台帳を読み、鎖を確かめる。途中切れ・壊れた行・鎖の不一致は Refused('ledger_broken') */
export function readLedger() {
  let head = null;
  if (fs.existsSync(HEAD)) {
    try { head = JSON.parse(fs.readFileSync(HEAD, 'utf8')); } catch { throw new Refused('ledger_broken'); }
    if (!head || !Number.isSafeInteger(head.seq) || typeof head.hash !== 'string') throw new Refused('ledger_broken');
  }
  if (!fs.existsSync(LEDGER)) { if (head) throw new Refused('ledger_broken'); return []; }
  const st = fs.lstatSync(LEDGER);
  if (!st.isFile()) throw new Refused('ledger_broken');
  const text = fs.readFileSync(LEDGER, 'utf8');
  if (text.length > 0 && !text.endsWith('\n')) throw new Refused('ledger_broken');
  const out = []; let prev = 'genesis';
  for (const line of text.split('\n')) {
    if (!line) continue;
    let e; try { e = JSON.parse(line); } catch { throw new Refused('ledger_broken'); }
    const { hash, ...body } = e;
    if (body.prev !== prev || hash !== sha(JSON.stringify(body))) throw new Refused('ledger_broken');
    out.push(e); prev = hash;
  }
  // p0.4.9（Codex の監査 #5）：末尾の行を消した切り詰め・台帳の差し替えは、最後の番号とハッシュの記録と食い違う
  if (out.length && !head) throw new Refused('ledger_broken');
  if (head && (out.length !== head.seq || (out.length ? out[out.length - 1].hash : 'genesis') !== head.hash)) throw new Refused('ledger_broken');
  return out;
}

function append(events, body) {
  const prev = events.length ? events[events.length - 1].hash : 'genesis';
  const full = { ...body, seq: events.length + 1, at: nowIso(), prev };
  const hash = sha(JSON.stringify(full));
  const line = JSON.stringify({ ...full, hash }) + '\n';
  const fd = fs.openSync(LEDGER, 'a');
  try { fs.writeSync(fd, line); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const tmp = `${HEAD}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ seq: full.seq, hash }) + '\n'); fs.renameSync(tmp, HEAD);
  const e = { ...full, hash }; events.push(e); return e;
}

// ---- 上限 ----------------------------------------------------------------------------------------
const LIMIT_KEYS = ['schema', 'period_id', 'until', 'tokens_total', 'tokens_per_ticket', 'tokens_per_run', 'judge_calls', 'workers', 'attempts_per_ticket', 'set_at'];
export function readLimits() {
  let l;
  try {
    if (!fs.lstatSync(LIMITS).isFile()) throw new Error();
    l = JSON.parse(fs.readFileSync(LIMITS, 'utf8'));
  } catch { throw new Refused('limits_missing'); }
  const ok = l && typeof l === 'object' && !Array.isArray(l) && Object.keys(l).length === LIMIT_KEYS.length && LIMIT_KEYS.every((k) => k in l)
    && l.schema === 'vgdd.budget-limits.v1' && typeof l.period_id === 'string' && ID.test(l.period_id)
    && typeof l.until === 'string' && !Number.isNaN(Date.parse(l.until)) && /([+-]\d{2}:\d{2}|Z)$/.test(l.until)
    && ['tokens_total', 'tokens_per_ticket', 'tokens_per_run', 'judge_calls', 'workers', 'attempts_per_ticket'].every((k) => isCount(l[k]))
    && typeof l.set_at === 'string';
  if (!ok) throw new Refused('limits_invalid');
  return l;
}

// ---- 状態を作り直す ------------------------------------------------------------------------------
/** 起動の記録の pid はプロセス群の長（窓口が job control で動かす）。群に1つでも生きていれば生きているとみなす（Codex の再監査 ①） */
function alive(pid) {
  const probe = (target) => { try { process.kill(target, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  return probe(-pid) || probe(pid);
}

/**
 * 台帳から実行の記録を作り直す。period_id が与えられれば、その期間の begin だけを数える。
 * 状態：launching（begin だけ。生死が不明）・started（pid が生きている）・ended_unrecorded（pid が死んでいるのに finish がない。利用量は不明）・finished・cancelled
 */
export function deriveRuns(events) {
  const runs = new Map();
  for (const e of events) {
    if (e.type === 'begin') {
      runs.set(e.run_id, { run_id: e.run_id, req_id: e.req_id, kind: e.kind, task: e.task, period: e.period_id, reserve: e.reserve_tokens, state: 'launching', pid: null, tokens: null, usage_known: false, overrun: false });
    }
    const r = runs.get(e.run_id); if (!r) continue;
    if (e.type === 'started' && r.state === 'launching') { r.state = 'started'; r.pid = e.pid; }
    if (e.type === 'finish' && (r.state === 'launching' || r.state === 'started')) {
      r.state = 'finished'; r.usage_known = e.tokens_counted !== null;
      r.tokens = e.tokens_counted === null ? r.reserve : e.tokens_counted;
      r.overrun = r.tokens > r.reserve;
    }
    if (e.type === 'cancel' && r.state === 'launching') r.state = 'cancelled';
  }
  for (const r of runs.values()) if (r.state === 'started' && !alive(r.pid)) r.state = 'ended_unrecorded';
  return [...runs.values()];
}

/**
 * 期間の集計。消費・予約・司法の回数・試行の数は今の期間（limits.period_id）の実行だけで数える。
 * 作業員の同時の数・起動中（生死が不明）・同じ票の作業員の重複は、期間をまたいですべての実行で数える（期間を変えても、動いている作業員と予約は消えない。Codex の監査 #2）
 */
export function summarize(allRuns, limits) {
  const pid = limits?.period_id ?? null;
  const runs = allRuns.filter((r) => r.period === pid);
  const activeAll = (r) => r.state === 'launching' || r.state === 'started';
  const consumedOf = (r) => (r.state === 'finished' ? r.tokens : r.state === 'ended_unrecorded' ? r.reserve : 0);
  const reservedOf = (r) => (r.state === 'launching' || r.state === 'started' ? r.reserve : 0);
  const live = (r) => r.state !== 'cancelled';
  const sum = (f, pred = () => true) => runs.filter(pred).reduce((a, r) => a + f(r), 0);
  return {
    settled: sum(consumedOf), reserved: sum(reservedOf),
    unknown_runs: runs.filter((r) => r.state === 'ended_unrecorded' || (r.state === 'finished' && !r.usage_known)).length,
    overrun: runs.some((r) => r.overrun),
    judge_used: runs.filter((r) => live(r) && JUDGE_KINDS.includes(r.kind)).length,
    reserved_other_periods: allRuns.filter((r) => r.period !== pid && activeAll(r)).reduce((a, r) => a + r.reserve, 0),
    workers_active: allRuns.filter((r) => r.kind === 'worker' && activeAll(r)).length,
    liveness_unknown: allRuns.filter((r) => r.state === 'launching').length,
    ticket: (t) => ({
      used: sum((r) => consumedOf(r) + reservedOf(r), (r) => r.task === t),
      attempts: runs.filter((r) => live(r) && r.kind === 'worker' && r.task === t).length,
      // 前の期間で動いている実行の予約も、その票の使用量に入れる（Codex の再監査 ②）
      usedOther: allRuns.filter((r) => r.task === t && r.period !== pid && activeAll(r)).reduce((a, r) => a + r.reserve, 0),
      activeWorker: allRuns.some((r) => r.kind === 'worker' && r.task === t && activeAll(r)),
      overrun: runs.some((r) => r.task === t && r.overrun),
    }),
    limits,
  };
}

// ---- 利用量 --------------------------------------------------------------------------------------
/** claude -p --output-format json の出力から、数えるトークンを読む。読めなければ null（0 にしない） */
export function claudeTokens(text) {
  let o; try { o = JSON.parse(text); } catch { return null; }
  const u = o && typeof o === 'object' ? o.usage : null;
  if (!u || typeof u !== 'object' || Array.isArray(u)) return null;
  if (!isCount(u.input_tokens) || !isCount(u.output_tokens)) return null;
  const extra = ['cache_creation_input_tokens', 'cache_read_input_tokens'];
  for (const k of extra) if (k in u && !isCount(u[k])) return null;
  const total = u.input_tokens + u.output_tokens + extra.reduce((a, k) => a + (u[k] ?? 0), 0);
  return Number.isSafeInteger(total) ? total : null;
}

// ---- 操作 ----------------------------------------------------------------------------------------
export function begin({ kind, task, req, tokens }) {
  if (!KINDS.includes(kind)) throw new Refused('bad_args');
  if (task !== '-' && !TASK.test(task)) throw new Refused('bad_args');
  if (!ID.test(req)) throw new Refused('bad_args');
  return withLock(() => {
    const events = readLedger();
    if (fs.existsSync(path.join(Z3, 'STOP'))) throw new Refused('stopped');
    const limits = readLimits();
    if (Date.now() >= Date.parse(limits.until)) throw new Refused('period_over');
    // 同じ要求の二度目：前の実行を返さず拒む（再試行は別の要求の ID で）
    if (events.some((e) => e.type === 'begin' && e.req_id === req)) throw new Refused('duplicate_request');
    const s = summarize(deriveRuns(events), limits);
    if (s.overrun) throw new Refused('overrun');
    const want = tokens === 'auto' ? limits.tokens_per_run : Number(tokens);
    if (!isCount(want) || want === 0) throw new Refused('bad_args');
    // p0.4.9（Codex の監査 #6）：1回の予約は tokens_per_run を超えられない（数で指定しても同じ）
    if (want > limits.tokens_per_run) throw new Refused('tokens_run');
    // 前の期間で動いている実行の予約も、今の期間の残りから引く（期間を変えても予約は消えない）
    if (s.settled + s.reserved + s.reserved_other_periods + want > limits.tokens_total) throw new Refused('tokens_total');
    if (task !== '-') {
      const t = s.ticket(task);
      if (t.overrun) throw new Refused('overrun');
      if (t.used + t.usedOther + want > limits.tokens_per_ticket) throw new Refused('tokens_ticket');
      if (kind === 'worker') {
        if (t.activeWorker) throw new Refused('worker_running');
        if (t.attempts >= limits.attempts_per_ticket) throw new Refused('attempts');
      }
    }
    if (kind === 'worker' && s.workers_active >= limits.workers) throw new Refused('workers');
    if (JUDGE_KINDS.includes(kind) && s.judge_used >= limits.judge_calls) throw new Refused('judge_calls');
    const run_id = `${kind}-${task}-${crypto.randomBytes(6).toString('hex')}`;
    append(events, { type: 'begin', event_id: `begin:${req}`, run_id, req_id: req, kind, task: task === '-' ? null : task, period_id: limits.period_id, reserve_tokens: want });
    return run_id;
  });
}

function findRun(events, run) {
  const b = events.find((e) => e.type === 'begin' && e.run_id === run);
  if (!b) throw new Refused('unknown_run');
  return b;
}

export function started({ run, pid }) {
  if (!ID.test(run) || !Number.isSafeInteger(pid) || pid <= 0) throw new Refused('bad_args');
  return withLock(() => {
    const events = readLedger(); findRun(events, run);
    const id = `started:${run}`;
    if (events.some((e) => e.event_id === id)) return 'duplicate';
    if (events.some((e) => (e.type === 'finish' || e.type === 'cancel') && e.run_id === run)) throw new Refused('bad_transition');
    append(events, { type: 'started', event_id: id, run_id: run, pid });
    return 'ok';
  });
}

export function finish({ run, code, usageText, format }) {
  if (!ID.test(run) || !Number.isSafeInteger(code)) throw new Refused('bad_args');
  return withLock(() => {
    const events = readLedger(); findRun(events, run);
    const id = `finish:${run}`;
    if (events.some((e) => e.event_id === id)) return 'duplicate'; // 精算の二度目は効かない
    if (events.some((e) => e.type === 'cancel' && e.run_id === run)) throw new Refused('bad_transition');
    // p0.4.9（Codex の監査 #3）：起動の記録のプロセスがまだ生きていれば精算しない（終わりを確かめてから枠を解く）
    const st = events.find((e) => e.type === 'started' && e.run_id === run);
    if (st && alive(st.pid)) throw new Refused('still_running');
    const counted = format === 'claude' && usageText != null ? claudeTokens(usageText) : null;
    append(events, { type: 'finish', event_id: id, run_id: run, exit_code: code, tokens_counted: counted, usage_format: format === 'claude' ? 'claude' : 'none' });
    return counted === null ? 'usage_unknown' : 'ok';
  });
}

/** 起動の前に中断したときの取り消し（起動の記録がない実行だけ） */
export function cancel({ run }) {
  if (!ID.test(run)) throw new Refused('bad_args');
  return withLock(() => {
    const events = readLedger(); findRun(events, run);
    const id = `cancel:${run}`;
    if (events.some((e) => e.event_id === id)) return 'duplicate';
    if (events.some((e) => (e.type === 'started' || e.type === 'finish') && e.run_id === run)) throw new Refused('bad_transition');
    append(events, { type: 'cancel', event_id: id, run_id: run });
    return 'ok';
  });
}

export function status() {
  return withLock(() => statusUnlocked());   // 追記と同じロックで読む（古い head と新しい台帳を組み合わせて破損と誤報しない）
}
function statusUnlocked() {
  const events = readLedger();
  let limits = null; try { limits = readLimits(); } catch { /* 上限がなければ null */ }
  const runs = deriveRuns(events);
  const s = summarize(runs, limits);
  const count = (st) => runs.filter((r) => r.state === st).length;
  return {
    period_id: limits?.period_id ?? null, until: limits?.until ?? null,
    tokens: { settled: s.settled, reserved: s.reserved, reserved_other_periods: s.reserved_other_periods, unknown_runs: s.unknown_runs, limit: limits?.tokens_total ?? null },
    judge_calls: { used: s.judge_used, limit: limits?.judge_calls ?? null },
    workers: { active: s.workers_active, limit: limits?.workers ?? null },
    runs: { launching: count('launching'), started: count('started'), finished: count('finished'), ended_unrecorded: count('ended_unrecorded'), cancelled: count('cancelled') },
    overrun: s.overrun,
  };
}

// ---- CLI -----------------------------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (k) => { const i = rest.indexOf(k); return i === -1 ? null : rest[i + 1]; };
  try {
    if (cmd === 'begin') {
      console.log(begin({ kind: opt('--kind'), task: opt('--task') ?? '', req: opt('--req') ?? '', tokens: opt('--tokens') ?? '' }));
    } else if (cmd === 'started') {
      console.log(started({ run: opt('--run') ?? '', pid: Number(opt('--pid')) }));
    } else if (cmd === 'finish') {
      const f = opt('--usage-file');
      let text = null;
      if (f) { try { const st = fs.lstatSync(f); if (st.isFile() && st.size <= 32 * 1024 * 1024) text = fs.readFileSync(f, 'utf8'); } catch { text = null; } }
      console.log(finish({ run: opt('--run') ?? '', code: Number(opt('--code')), usageText: text, format: opt('--format') || 'none' }));
    } else if (cmd === 'cancel') {
      console.log(cancel({ run: opt('--run') ?? '' }));
    } else if (cmd === 'status') {
      const s = status();
      console.log(rest.includes('--json') ? JSON.stringify(s) : `期間 ${s.period_id ?? '—'}（${s.until ?? '—'} まで）：トークン 消費 ${s.tokens.settled}・予約 ${s.tokens.reserved}（前の期間から ${s.tokens.reserved_other_periods}）／${s.tokens.limit ?? '—'}（不明 ${s.tokens.unknown_runs} 件）、司法 ${s.judge_calls.used}／${s.judge_calls.limit ?? '—'}、作業員 ${s.workers.active}／${s.workers.limit ?? '—'}${s.overrun ? '、超過あり（後続を止める）' : ''}`);
    } else if (cmd === 'verify') {
      withLock(() => readLedger()); console.log('ok');
    } else { console.error('bad_args'); process.exit(64); }
  } catch (e) {
    if (e instanceof Refused) { console.error(e.code); process.exit(75); }
    console.error('internal_error'); process.exit(70);
  }
}
