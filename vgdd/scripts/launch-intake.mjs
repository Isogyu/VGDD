#!/usr/bin/env node
// VGDD Governance Kernel — 起動の申請の受け取り（法律 p0.4.10、SPEC §5-4。launcher.sh から呼ぶ）
//
// 開発の側が触れる場所（merge-requests/launch/）の申請を、信じずに確かめて Z3 に取り込む。
//   - 申請のフォルダの親（merge-requests・launch）が記号リンクなら、何も読まずに止める
//   - 申請は O_NOFOLLOW で開き、開いた同じファイル記述子で「通常のファイル・256 バイトまで」を確かめ、上限つきで読む
//   - 中身は全体がちょうど1つの JSON のオブジェクト {"task":"T-NNN"}（名前と同じ ID）だけ
//   - 受け付けた申請は Z3 の状態（launch/state.jsonl、追記だけ）に「受け取った」を書いてから、元の申請を消す（受け取りが正本）
//   - 結果の控えは Z3 の launch/receipts/ に置く（開発の側の場所には書かない）
//   - 同じ票で「受け取った・動いている」の状態が残っていれば受け付けない（state.jsonl の最後の状態と、その pid の生死で見る）
//
// 使い方: node launch-intake.mjs --repo <repo> --z3 <z3>
//   標準出力に、起動してよい票の ID を1行ずつ。標準エラーに拒んだ申請の短い理由

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i === -1 ? null : args[i + 1]; };
const REPO = opt('--repo'); const Z3 = opt('--z3');
if (!REPO || !Z3) { console.error('bad_args'); process.exit(64); }
const NAME = /^T-[0-9]{3,4}\.json$/;
const STATE = path.join(Z3, 'launch', 'state.jsonl');
const RECEIPTS = path.join(Z3, 'launch', 'receipts');

const nowIso = () => new Date(Date.now() + 9 * 3600e3).toISOString().replace(/\.\d+Z$/, '+09:00');
function noLink(p) { try { return !fs.lstatSync(p).isSymbolicLink(); } catch { return true; } }
function appendState(o) {
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  const fd = fs.openSync(STATE, 'a'); try { fs.writeSync(fd, JSON.stringify({ ...o, at: nowIso() }) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function receipt(name, verdict, reason) {
  fs.mkdirSync(RECEIPTS, { recursive: true });
  const f = path.join(RECEIPTS, `${name.replace(/[^A-Za-z0-9.-]/g, '_')}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.${verdict}.json`);
  fs.writeFileSync(f, JSON.stringify({ file: name.slice(0, 80), verdict, reason, at: nowIso() }) + '\n', { flag: 'wx' });
}
function alive(pid) { try { process.kill(-pid, 0); return true; } catch { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } } }
/** 票ごとの最後の状態。received（まだ起動の記録がない）・started（pid）・ended */
function lastStates() {
  const m = new Map();
  let text = ''; try { text = fs.readFileSync(STATE, 'utf8'); } catch { return m; }
  for (const line of text.split('\n')) { if (!line) continue; try { const o = JSON.parse(line); if (o && typeof o.task === 'string') m.set(o.task, o); } catch { /* 壊れた行は飛ばす */ } }
  return m;
}
export function busy(st) {
  if (!st) return false;
  if (st.state === 'received') return true;                          // 受け取ったが起動の記録がない：launcher が起動する（ここでは受け付けない）
  if (st.state === 'started') return Number.isInteger(st.pid) && alive(st.pid);
  return false;
}

// 状態の操作（launcher.sh から）：--pending … 受け取ったまま起動の記録がない票、--started T --pid P、--sweep … 動いていない started を ended にする
if (args.includes('--pending')) { for (const [t, st] of lastStates()) if (st.state === 'received') console.log(t); process.exit(0); }
if (args.includes('--started')) {
  const t = opt('--started'); const pid = Number(opt('--pid'));
  if (!/^T-[0-9]{3,4}$/.test(t || '') || !Number.isSafeInteger(pid) || pid <= 0) { console.error('bad_args'); process.exit(64); }
  appendState({ task: t, state: 'started', pid }); process.exit(0);
}
if (args.includes('--sweep')) { for (const [t, st] of lastStates()) if (st.state === 'started' && !alive(st.pid)) appendState({ task: t, state: 'ended', pid: st.pid }); process.exit(0); }

const mr = path.join(REPO, 'merge-requests'); const dir = path.join(mr, 'launch');
if (!noLink(mr) || !noLink(dir)) { console.error('申請のフォルダが記号リンク。何も読まない'); process.exit(70); }
let names = []; try { names = fs.readdirSync(dir); } catch { process.exit(0); }
const states = lastStates();
for (const name of names) {
  if (name === 'done') continue;   // 旧い控えの場所（使わない）
  const p = path.join(dir, name);
  let fd = null;
  try {
    if (!NAME.test(name)) { receipt(name, 'rejected', '名前の形が違う'); fs.rmSync(p, { force: true, recursive: false }); console.error(`${name.slice(0, 40)}: 名前の形が違う`); continue; }
    try { fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); } catch { receipt(name, 'rejected', '開けない（記号リンクなど）'); fs.rmSync(p, { force: true }); console.error(`${name}: 開けない`); continue; }
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > 256) { receipt(name, 'rejected', '通常のファイルでない・大きすぎる'); fs.closeSync(fd); fd = null; fs.rmSync(p, { force: true }); console.error(`${name}: 形が違う`); continue; }
    const buf = Buffer.alloc(257); const n = fs.readSync(fd, buf, 0, 257, 0); fs.closeSync(fd); fd = null;
    const task = name.slice(0, -5);
    let o = null; try { o = n <= 256 ? JSON.parse(buf.subarray(0, n).toString('utf8')) : null; } catch { o = null; }   // JSON.parse は全体がちょうど1つの値でなければ投げる
    if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).length !== 1 || o.task !== task) { receipt(name, 'rejected', '中身の形が違う'); fs.rmSync(p, { force: true }); console.error(`${name}: 中身の形が違う`); continue; }
    if (busy(states.get(task))) { console.error(`${task}: 同じ票の作業がまだある。次の周回で見る`); continue; }   // 申請は置いたまま
    const id = `${task}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    appendState({ task, state: 'received', id });
    fs.rmSync(p, { force: true });
    receipt(name, 'accepted', `受け取った（${id}）`);
    console.log(task);
  } catch {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* 閉じている */ }
    console.error(`${name.slice(0, 40)}: 処理に失敗`);
  }
}
