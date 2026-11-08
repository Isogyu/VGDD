#!/usr/bin/env node
// VGDD Governance Kernel — オーナーの操作の窓口（Owner Console。法律 p0.4.12、SPEC §10、D-68）
//
// 置き場所：原本は vgdd/scripts/owner-console.mjs。実行用は ~/tsubuyaki-z3/bin/owner-console.mjs（オーナーがコピー）。
// 起動するのはオーナー（sandbox の外、オーナーの端末）：
//   node ~/tsubuyaki-z3/bin/owner-console.mjs --repo <main の checkout> [--z3 <Z3>] [--port <番号。既定 0＝空いている番号>]
//
// 何をするか：オーナーが端末で動かしていた Kernel の操作（仕様の承認・作業員の開始・統合・停止・点検して再開・受け入れ）を、
//   画面のボタンから、決まった引数で、同じ場所（Z3 の bin）の Kernel のスクリプトに渡す。シェルは使わない（execFile）。
//   任意のコマンドは受け付けない。行政・作業員・公開の画面（Next.js）には権限を渡さない（別のプロセス・別のポート。Z3 は開発エージェントから読めない）。
//
// 本人確認（localhost であることだけには頼らない）：
//   ・起動ごとに 256 ビットの合言葉を作り、起動した端末にだけ URL（/login?t=…）を1回出す。最初の読み込みで HttpOnly・SameSite=Strict の
//     Cookie（セッション）に換え、合言葉はその場で無効にする（1回だけ使える）
//   ・すべての要求で Host が 127.0.0.1:<ポート> であることを確かめる（DNS の付け替えで別のサイトから届く要求を拒む）
//   ・操作（POST）は、Origin が同じであること、セッションの CSRF トークンが合うこと、形が application/x-www-form-urlencoded で 8KB までであることを確かめる
//   ・同じ利用者の権限で動くプロセス（端末の出力・ブラウザの記録を読めるもの）への完全な防御はしない（SPEC §12）
// 対象の固定：承認は仕様の指紋、開始は仕様の指紋、統合は held の申請の SHA、受け入れは統合のコミットを、画面に出した値として要求に入れ、
//   実行の直前に今の値と比べる。違えば実行しない（「画面を開き直して確かめる」）
// 重複の防止：ボタンごとに画面を作るたびに新しい操作の ID（action_id）を入れる。Z3 の console/owner_actions.jsonl に
//   「受け付けた」を書いてから実行し、「結果」を書く。同じ ID の二度目は実行せず前の結果を返す。「受け付けた」だけが残る（途中で窓口が終わった）ID は
//   「結果が不明」と返し、実行し直さない。実行管理の側の重複の防止（窓口の受け取り、release の錠、台帳）はそのまま
// 失敗：スクリプトの終了コードが 0 でない・時間切れは「失敗」。成功と表示しない。停止は「止めた（STOP を置いた）」と
//   「止まったのを確かめた（動いている作業員・司法がない）」を分けて出す
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i === -1 ? null : args[i + 1]; };
const repoArg = opt('--repo');
if (!repoArg) { console.error('--repo が必要'); process.exit(64); }
const REPO = fs.realpathSync(repoArg);
const Z3 = fs.realpathSync(opt('--z3') || process.env.VGDD_Z3_DIR || path.join(os.homedir(), 'tsubuyaki-z3'));
const PORT_ARG = Number(opt('--port') || '0');
if (!Number.isInteger(PORT_ARG) || PORT_ARG < 0 || PORT_ARG > 65535) { console.error('--port が不正'); process.exit(64); }
const EV = path.join(Z3, 'evidence');
const CONSOLE_DIR = path.join(Z3, 'console');
const ACTIONS = path.join(CONSOLE_DIR, 'owner_actions.jsonl');
const ACCEPTANCE = path.join(EV, 'acceptance.jsonl');
const TASK_RE = /^T-\d{3,4}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const AID_RE = /^[0-9a-f]{32}$/;
fs.mkdirSync(CONSOLE_DIR, { recursive: true });
// 受け入れを数え始めた時刻（最初の起動のときに1回だけ書く）。これより前に統合した票は「受け入れの記録の前」として、判断待ちに数えない
const SINCE_FILE = path.join(CONSOLE_DIR, 'acceptance_since');
try { fs.writeFileSync(SINCE_FILE, `${Math.floor(Date.now() / 1000)}\n`, { flag: 'wx', mode: 0o644 }); } catch { /* すでにある */ }
const SINCE = Number((fs.readFileSync(SINCE_FILE, 'utf8').trim()));

// ---------- 読み取り（オーナーの画面。数・結論・票の ID・題。理由の本文・生ログ・秘密は出さない） ----------
const jsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const git = (...a) => spawnSync('git', ['-C', REPO, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...a], { encoding: 'utf8' });
const alive = (pid) => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const front = (body, k) => { const fm = (body.match(/^---\n([\s\S]*?)\n---/) || [])[1] || ''; return ((fm.match(new RegExp(`^${k}: *(.*)$`, 'm')) || [])[1] || '').replace(/ +#.*$/, '').trim(); };

function tickets() {
  const tree = git('ls-tree', '--name-only', 'main', 'docs/tasks/').stdout.split('\n');
  const out = [];
  for (const rel of tree.filter((f) => /^docs\/tasks\/T-\d{3,4}-[^/]*\.md$/.test(f))) {
    const body = git('show', `main:${rel}`).stdout || '';
    const id = front(body, 'id'); if (!TASK_RE.test(id)) continue;
    const deps = front(body, 'depends_on').replace(/[[\]\s]/g, '').split(',').filter((d) => TASK_RE.test(d));
    out.push({ id, rel, title: front(body, 'title').slice(0, 80), status: front(body, 'status'), deps });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
const digestBin = path.join(HERE, 'spec-digest.mjs');
function digestOf(rel) {
  const r = spawnSync('node', [digestBin, '--repo', REPO, '--ref', 'main', '--ticket', rel], { encoding: 'utf8' });
  const d = (r.stdout || '').trim().split('\n').pop();
  return r.status === 0 && DIGEST_RE.test(d) ? d : null;
}
function approved(rel) {
  return spawnSync('node', [digestBin, '--repo', REPO, '--ref', 'main', '--ticket', rel, '--check', path.join(EV, 'spec_approvals.jsonl')], { encoding: 'utf8' }).status === 0;
}
function launchStates() {
  const m = new Map();
  for (const o of jsonl(path.join(Z3, 'launch/state.jsonl'))) if (TASK_RE.test(o.task)) m.set(o.task, o);
  return m;
}
const launchBusy = (st) => !!st && (st.state === 'received' || (st.state === 'started' && alive(st.pid)));
function heldOf(task) {
  // held の記録のうち、この票の最新のもの（申請の SHA）
  const rows = jsonl(path.join(EV, 'held.jsonl')).filter((h) => h.task === task && SHA_RE.test(h.request || ''));
  return rows.length ? rows[rows.length - 1] : null;
}
function mergeCommitOf(task) {
  // 裁判所（gate-runner）の名で main に入った、この票の統合のコミット（最新）
  const r = git('log', 'main', '--format=%H%x09%an%x09%ct%x09%s', '-n', '2000');
  for (const line of (r.stdout || '').split('\n')) {
    const [sha, an, ct, subj] = line.split('\t');
    if (an === 'gate-runner' && SHA_RE.test(sha || '') && (subj || '').startsWith(`gate-runner: ${task} を統合`)) return { sha, at: Number(ct) };
  }
  return null;
}
function acceptedMerge(task) {
  const rows = jsonl(ACCEPTANCE).filter((a) => a.task === task && SHA_RE.test(a.merge || ''));
  return rows.length ? rows[rows.length - 1].merge : null;
}
function budget() {
  try {
    const r = spawnSync('node', [path.join(HERE, 'ledger.mjs'), 'status', '--json'], { encoding: 'utf8', env: { ...process.env, VGDD_Z3_DIR: Z3 }, timeout: 20000 });
    return r.status === 0 ? JSON.parse(r.stdout) : null;
  } catch { return null; }
}
const stopped = () => fs.existsSync(path.join(Z3, 'STOP'));
function activeRuns(b) { return b ? (b.runs?.launching ?? 0) + (b.runs?.started ?? 0) : null; }

// 票ごとの工程・次の担当・操作できるか（できなければ理由）
function view() {
  const ts = tickets(); const byId = new Map(ts.map((t) => [t.id, t]));
  const ls = launchStates(); const b = budget(); const stop = stopped();
  const rows = [];
  for (const t of ts) {
    const r = { ...t, stage: '', next: '', actions: [] };
    const appr = ['ready', 'in_progress', 'review', 'blocked'].includes(t.status) ? approved(t.rel) : null;
    const held = t.status !== 'merged' ? heldOf(t.id) : null;
    const st = ls.get(t.id);
    if (t.status === 'merged') {
      const mc = mergeCommitOf(t.id); const m = mc ? mc.sha : null; const acc = acceptedMerge(t.id);
      const before = !mc || mc.at < SINCE;
      if (m && acc === m) { r.stage = '受け入れ済み'; r.next = '—'; }
      else { r.stage = before ? '統合済み（受け入れの記録を始める前）' : '統合済み（動作の確認待ち）'; r.next = before ? '—' : 'オーナー'; }
      if (!(m && acc === m)) r.actions.push({ action: 'accept', label: `${t.id} の動作を確かめたので受け入れる（統合 ${m ? m.slice(0, 7) : '—'}）`, target: m, why: m ? null : '統合のコミットが見つからない' });
    } else if (t.status === 'rejected') { r.stage = '取り下げ'; r.next = '—'; }
    else if (stop) { r.stage = '停止中'; r.next = 'オーナー'; }
    else if (appr === false) {
      const d = digestOf(t.rel);
      r.stage = '下書き（仕様の承認待ち）'; r.next = 'オーナー';
      r.actions.push({ action: 'approve', label: `${t.id} の仕様を承認する（指紋 ${d ? d.slice(7, 19) : '—'}）`, target: d, why: d ? null : '仕様の指紋を計算できない' });
    } else if (held && t.status === 'review' && !launchBusy(st)) {
      r.stage = '判断待ち（統合）'; r.next = 'オーナー';
      r.actions.push({ action: 'release', label: `${t.id} を main に統合する（申請 ${held.request.slice(0, 7)}、判定 ${held.judge}・${held.codex}・${held.security}）`, target: held.request, why: null });
    } else if (t.status === 'blocked') { r.stage = '判断待ち（止まった票）'; r.next = 'オーナー'; }
    else if (launchBusy(st)) { r.stage = '実装中（作業員）'; r.next = 'AI'; }
    else if (t.status === 'review') { r.stage = '審査中'; r.next = 'AI（司法）'; }
    else if (['ready', 'in_progress'].includes(t.status)) {
      r.stage = '開始待ち'; r.next = 'オーナー';
      const notMerged = t.deps.filter((d) => byId.get(d)?.status !== 'merged');
      let why = null;
      if (notMerged.length) why = `依存の票が未統合：${notMerged.join('・')}`;
      else if (!b) why = '予算の台帳を読めない';
      else if (b.until && Date.now() >= Date.parse(b.until)) why = '予算の期間が終わった';
      else if (b.workers?.limit !== null && b.workers?.active >= b.workers?.limit) why = '作業員の同時の数が上限';
      else if (fs.existsSync(path.join(REPO, 'merge-requests/launch', `${t.id}.json`))) why = '起動の申請がすでにある（窓口の受け取り待ち）';
      r.actions.push({ action: 'start', label: `${t.id} を開始する（作業員を起こし、審査・自動修正まで進める）`, target: digestOf(t.rel), why });
    } else { r.stage = t.status || '—'; r.next = '—'; }
    rows.push(r);
  }
  return { rows, b, stop, active: activeRuns(b), at: new Date() };
}

// ---------- 操作 ----------
function actionLog() { return jsonl(ACTIONS); }
function appendAction(o) { fs.appendFileSync(ACTIONS, JSON.stringify({ ts: new Date().toISOString(), ...o }) + '\n', { mode: 0o600 }); }
const short = (s) => String(s || '').replaceAll(os.homedir(), '~').replace(/[^\S\n]+/g, ' ').trim().split('\n').slice(-4).join(' / ').slice(0, 400);
function run(file, argv, timeoutMs) {
  try {
    const out = execFileSync(path.join(HERE, file), argv, { cwd: REPO, encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, VGDD_Z3_DIR: Z3 } });
    return { ok: true, rc: 0, msg: short(out) };
  } catch (e) {
    return { ok: false, rc: Number.isInteger(e.status) ? e.status : null, msg: e.signal ? `時間切れ・中断（${e.signal}）` : short(`${e.stdout || ''}\n${e.stderr || ''}`) };
  }
}
function lock() { try { fs.mkdirSync(path.join(CONSOLE_DIR, '.action.lock')); return true; } catch { return false; } }
function unlock() { try { fs.rmdirSync(path.join(CONSOLE_DIR, '.action.lock')); } catch { /* なし */ } }

function perform(f) {
  const { action, task, target, action_id: aid } = f;
  if (!AID_RE.test(aid || '')) return { ok: false, msg: '操作の ID の形が違う' };
  const prev = actionLog().filter((a) => a.action_id === aid);
  if (prev.some((a) => a.phase === 'done')) { const d = prev.find((a) => a.phase === 'done'); return { ok: d.ok, msg: `同じ操作はすでに実行した（前の結果：${d.ok ? '成功' : '失敗'}。${d.msg || ''}）`, dup: true }; }
  if (prev.length) return { ok: false, msg: 'この操作は受け付けた後に結果が記録されていない（結果が不明）。状態を見てから、新しく操作する', dup: true };
  if (!['approve', 'start', 'release', 'stop', 'resume', 'accept'].includes(action)) return { ok: false, msg: '知らない操作' };
  const needsTask = !['stop', 'resume'].includes(action);
  if (needsTask && !TASK_RE.test(task || '')) return { ok: false, msg: '票の ID の形が違う' };
  if (!lock()) return { ok: false, msg: 'ほかの操作を実行中。終わってから操作する' };
  try {
    // 実行の直前に、今の状態で確かめ直す（画面を出した後の変化）
    const v = view(); const row = needsTask ? v.rows.find((r) => r.id === task) : null;
    if (needsTask && !row) return { ok: false, msg: '票が main にない' };
    let pre = null;
    if (needsTask) {
      const a = row.actions.find((x) => x.action === action);
      if (!a) pre = `いまの工程（${row.stage}）ではこの操作はできない`;
      else if (a.why) pre = a.why;
      else if (!a.target || a.target !== target) pre = '画面を出した後に対象が変わった。画面を開き直して確かめる';
    } else if (action === 'stop' && v.stop) pre = 'すでに停止中';
    else if (action === 'resume' && !v.stop) pre = '停止していない';
    if (pre) return { ok: false, msg: pre };
    appendAction({ action_id: aid, phase: 'received', action, task: task || null, target: target || null });
    let res;
    if (action === 'approve') res = run('approve-spec.sh', [task, '--yes', '--note', `owner-console ${aid}`], 60000);
    else if (action === 'release') res = run('release.sh', [task], 600000);
    else if (action === 'stop') res = run('kernel-stop.sh', [`Owner Console から停止（${aid.slice(0, 8)}）`], 30000);
    else if (action === 'resume') res = run('kernel-resume.sh', [`Owner Console から再開（${aid.slice(0, 8)}）`, ...(f.accept_main === 'yes' ? ['--accept-main'] : [])], 120000);
    else if (action === 'start') {
      try {
        const dir = path.join(REPO, 'merge-requests', 'launch');
        for (const d of [path.join(REPO, 'merge-requests'), dir]) { const s = fs.lstatSync(d); if (!s.isDirectory()) throw new Error('申請の場所がフォルダでない（記号リンクを含む）'); }
        fs.writeFileSync(path.join(dir, `${task}.json`), JSON.stringify({ task }) + '\n', { flag: 'wx', mode: 0o644 });
        res = { ok: true, rc: 0, msg: '起動の申請を置いた（窓口が受け取り、作業員を起こす）' };
      } catch (e) { res = { ok: false, rc: null, msg: e.code === 'EEXIST' ? '起動の申請がすでにある' : `申請を置けなかった（${e.code || e.message}）` }; }
    } else if (action === 'accept') {
      try {
        fs.appendFileSync(ACCEPTANCE, JSON.stringify({ ts: new Date().toISOString(), task, merge: target, action_id: aid }) + '\n', { mode: 0o644 });
        res = { ok: true, rc: 0, msg: `受け入れを記録した（統合 ${target.slice(0, 7)}）` };
      } catch (e) { res = { ok: false, rc: null, msg: `記録できなかった（${e.code || e.message}）` }; }
    }
    appendAction({ action_id: aid, phase: 'done', ok: res.ok, rc: res.rc, msg: res.msg });
    return res;
  } finally { unlock(); }
}

// ---------- HTTP ----------
const TOKEN = crypto.randomBytes(32).toString('hex');
let tokenUsed = false;
const sessions = new Map();   // sid → { csrf, exp }
const SESSION_MS = 12 * 3600e3;
let BASE = '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const eq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const HEAD = { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' };
function send(res, code, body, extra = {}) { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', ...HEAD, ...extra }); res.end(body); }
function sessionOf(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)vgdd_console=([0-9a-f]{64})/);
  if (!m) return null; const s = sessions.get(m[1]);
  if (!s || s.exp < Date.now()) { sessions.delete(m[1]); return null; }
  return s;
}
const jst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(11, 19);
function page(s, flash) {
  const v = view();
  const form = (a, task, extra = '') => `<form method="post" action="/action" style="display:inline"><input type="hidden" name="csrf" value="${esc(s.csrf)}"><input type="hidden" name="action_id" value="${crypto.randomBytes(16).toString('hex')}"><input type="hidden" name="action" value="${esc(a.action)}"><input type="hidden" name="task" value="${esc(task || '')}"><input type="hidden" name="target" value="${esc(a.target || '')}">${extra}<button ${a.why ? 'disabled' : ''}>${esc(a.label)}</button>${a.why ? ` <small>（できない理由：${esc(a.why)}）</small>` : ''}</form>`;
  const waiting = v.rows.filter((r) => r.next === 'オーナー');
  const b = v.b;
  const usage = (u, l) => (l === null || l === undefined ? `${u}（上限なし）` : `${u} ／ ${l}`);
  const stopLine = v.stop
    ? `<p><b>停止中</b>（STOP を置いた）。動いている作業員・司法：${v.active === null ? '確かめられない' : v.active === 0 ? '0（止まったのを確かめた）' : `${v.active}（まだ動いている）`}</p>${form({ action: 'resume', label: '点検して再開する（証拠・設定・main を確かめ、合わなければ再開しない）', target: '' }, '', '<label><input type="checkbox" name="accept_main" value="yes"> 停止の後の main のコミットを確かめた（--accept-main）</label> ')}`
    : `<p>動いている（停止していない）。動いている作業員・司法：${v.active ?? '—'}</p>${form({ action: 'stop', label: '全体を止める（新しい作業・審査・統合を止める。動いている処理は終わるまで残る）', target: '' }, '')}`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="refresh" content="30"><title>VGDD オーナーの操作</title>
<style>body{font:14px/1.6 system-ui,sans-serif;margin:16px;max-width:1100px}table{border-collapse:collapse;width:100%}td,th{border-top:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}button{margin:2px 0}.flash{padding:8px;border:1px solid #888;margin:8px 0}small{color:#555}</style></head><body>
<h1>VGDD オーナーの操作</h1>
<p><small>取得 ${esc(jst(v.at))}（30 秒ごとに取り直す）。この画面はオーナーだけのもの。公開の画面は /governance（読むだけ）</small></p>
${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}
<h2>判断待ち（${waiting.length} 件）</h2>
<ul>${waiting.map((r) => `<li>${esc(r.id)}：${esc(r.stage)} — ${esc(r.title)}<br>${r.actions.map((a) => form(a, r.id)).join(' ')}</li>`).join('') || '<li>なし</li>'}</ul>
<h2>停止と再開</h2>${stopLine}
<h2>予算（期間 ${esc(b?.period_id ?? '—')}、${esc(b?.until ?? '—')} まで）</h2>
${b ? `<p>トークン（精算済み＋予約中）：${esc(usage(b.tokens.settled + b.tokens.reserved, b.tokens.limit))}。利用量を読めなかった実行 ${esc(b.tokens.unknown_runs)} 件は予約の全量で数えている<br>司法の呼び出し：${esc(usage(b.judge_calls.used, b.judge_calls.limit))}　作業員（同時）：${esc(usage(b.workers.active, b.workers.limit))}</p>` : '<p><b>予算の台帳を読めない</b>（開始はできない）</p>'}
<p><small>契約の利用枠の残りは読めない。推定費用は出さない</small></p>
<h2>票</h2>
<table><thead><tr><th>票</th><th>工程</th><th>次の担当</th><th>題</th></tr></thead><tbody>
${v.rows.filter((r) => r.stage !== '受け入れ済み').map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.stage)}</td><td>${esc(r.next)}</td><td>${esc(r.title)}</td></tr>`).join('')}
</tbody></table>
<p><small>受け入れ済みの票は一覧から外している。詳しい記録（判定・判例・再生）は公開の /governance と統治シアターで見る</small></p>
</body></html>`;
}
function readBody(req, max) {
  return new Promise((resolve) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > max) { req.destroy(); resolve(null); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== BASE.slice('http://'.length)) return send(res, 403, '許されない Host');
    const u = new URL(req.url, BASE);
    if (req.method === 'GET' && u.pathname === '/login') {
      const t = u.searchParams.get('t') || '';
      if (tokenUsed || !eq(t, TOKEN)) return send(res, 403, '合言葉が違うか、すでに使われた。窓口を起動し直して、端末に出た URL から開く');
      tokenUsed = true;
      const sid = crypto.randomBytes(32).toString('hex');
      sessions.set(sid, { csrf: crypto.randomBytes(32).toString('hex'), exp: Date.now() + SESSION_MS });
      return send(res, 303, '', { Location: '/', 'Set-Cookie': `vgdd_console=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}` });
    }
    const s = sessionOf(req);
    if (!s) return send(res, 401, '窓口を起動した端末に出た URL から開く');
    if (req.method === 'GET' && u.pathname === '/') return send(res, 200, page(s, u.searchParams.get('m')));
    if (req.method === 'POST' && u.pathname === '/action') {
      if (req.headers.origin !== BASE) return send(res, 403, '許されない Origin');
      if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return send(res, 403, '許されない要求の出どころ');
      if (!/^application\/x-www-form-urlencoded\b/.test(req.headers['content-type'] || '')) return send(res, 415, '形が違う');
      const body = await readBody(req, 8192); if (body === null) return send(res, 413, '大きすぎる');
      const f = Object.fromEntries(new URLSearchParams(body));
      if (!eq(f.csrf || '', s.csrf)) return send(res, 403, 'CSRF トークンが違う');
      const r = perform(f);
      return send(res, 303, '', { Location: `/?m=${encodeURIComponent(`${f.action || ''} ${f.task || ''}：${r.ok ? '成功' : '失敗・未実行'}。${r.msg}`)}` });
    }
    return send(res, 404, 'ない');
  } catch { return send(res, 500, '窓口の内部の誤り'); }
});
server.listen(PORT_ARG, '127.0.0.1', () => {
  const { port } = server.address();
  BASE = `http://127.0.0.1:${port}`;
  // 合言葉の URL は、起動した端末にだけ1回出す（ファイルには書かない）
  process.stdout.write(`Owner Console: ${BASE}/login?t=${TOKEN}\n（この URL は1回だけ使える。ほかの人に見せない）\n`);
});
