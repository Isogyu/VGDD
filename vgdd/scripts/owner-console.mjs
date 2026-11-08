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
import { execFile, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i === -1 ? null : args[i + 1]; };
const repoArg = opt('--repo');
if (!repoArg) { console.error('--repo が必要'); process.exit(64); }
const REPO = fs.realpathSync(repoArg);
const Z3 = fs.realpathSync(opt('--z3') || process.env.VGDD_Z3_DIR || path.join(os.homedir(), 'tsubuyaki-z3'));
const PORT_ARG = Number(opt('--port') || '0');
// p0.4.14：画面の上部の案件名と、公開のアプリ（要件・統治の記録）へのリンク。アプリの URL は 127.0.0.1・localhost の http だけを受け付ける
const PROJECT = String(opt('--project') || path.basename(REPO)).slice(0, 60);
const APP_URL = /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(opt('--app-url') || '') ? opt('--app-url') : null;
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
    // p0.4.13：受け入れの前に出す確かめ方（§3）と、§6 の「確かめていない」の行（票は公開のリポジトリの文。長さを限る）
    const sec3all = ((body.match(/^## 3\.[^\n]*\n([\s\S]*?)(?=^## \d|(?![\s\S]))/m) || [])[1] || '').trim();
    const sec3 = sec3all.length > 800 ? `${sec3all.slice(0, 800)}…（以下省略。票の §3 を見る）` : sec3all;
    const sec6 = ((body.match(/^## 6\.[^\n]*\n([\s\S]*)$/m) || [])[1] || '');
    const unverified = sec6.split('\n').filter((l) => /確かめていない|未確認|確かめきれていない/.test(l)).slice(-3).map((l) => { const t = l.replace(/^[-\s]+/, ''); return t.length > 300 ? `${t.slice(0, 300)}…（省略）` : t; });
    // p0.4.14：中央の「承認した条件」（目的・受け入れ条件の見出し・対象・対象外）
    const sec1 = ((body.match(/^## 1\.[^\n]*\n([\s\S]*?)(?=^## \d|(?![\s\S]))/m) || [])[1] || '').trim();
    const sec2 = ((body.match(/^## 2\.[^\n]*\n([\s\S]*?)(?=^## \d|(?![\s\S]))/m) || [])[1] || '');
    const criteria = sec2.split('\n').map((l) => l.match(/^- (A\d+)\. ?(.*)$/)).filter(Boolean).slice(0, 15).map((m) => ({ id: m[1], text: m[2].replace(/\*\*/g, '').slice(0, 90) }));
    const fm = (body.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
    const list = (k) => { const m = fm.match(new RegExp(`^${k}:\\s*\\n((?:\\s+-.*\\n?)*)`, 'm')); return m ? m[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '').replace(/\s+#.*$/, '').trim()).filter(Boolean).slice(0, 30) : []; };
    out.push({ id, rel, title: front(body, 'title').slice(0, 80), status: front(body, 'status'), deps, sec3, unverified, sec1: sec1.length > 400 ? `${sec1.slice(0, 400)}…（以下省略）` : sec1, criteria, allowed: list('files_allowed'), forbidden: list('files_forbidden'), security: front(body, 'security_review') === 'true' });
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
  const r = git('log', 'main', '--format=%H%x09%an%x09%ct%x09%s');
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
// p0.4.13（OBS-064 ②）：窓口（night-runner --launch）が自動修正を止めて人へ戻した票。最後の「人へ戻す」の記録より後に仕様の承認がなければ、
//   開始できない「判断待ち」とする（同じ指摘で差し戻され続けた票を、§2 を直さずに起こし直さない）
const isoNorm = (v) => String(v || '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
function returnedAt(task) {
  let at = null;
  try {
    for (const l of fs.readFileSync(path.join(Z3, 'launch', `${task}.log`), 'utf8').split('\n')) {
      const m = l.match(/^\[([^\]]+)\] .*人へ戻す/); if (m) { const t = Date.parse(isoNorm(m[1])); if (!Number.isNaN(t)) at = t; }
    }
  } catch { /* 記録なし */ }
  if (at === null) return null;
  const approvedAfter = jsonl(path.join(EV, 'spec_approvals.jsonl')).some((a) => a.task === task && Date.parse(isoNorm(a.ts)) > at);
  return approvedAfter ? null : at;
}
function activeRuns(b) { return b ? (b.runs?.launching ?? 0) + (b.runs?.started ?? 0) : null; }

// p0.4.14：この票の裁判所の出来事（種類と時刻だけ。理由の本文は出さない）と、最新の候補の判定の結論
const gateEvents = () => jsonl(path.join(EV, 'gate_events.jsonl'));
const EVENT_LABEL = { candidate: '審査を始めた', held: '審査に合格（統合待ち）', disagreement: '判定が分かれた', rejected: '差し戻し', judiciary_unavailable: '審査が使えなかった（判定ではない）', judiciary_blocked: '審査が続けて使えず止まった', merged: '統合した', spec_approved: '仕様を承認した', ticket_dirty_wait: '書きかけを待った' };
function taskEvents(evs, task) { return evs.filter((e) => e.task === task && EVENT_LABEL[e.type]); }
function verdictOf(file, flag) {
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (d[flag] !== true) return '使えなかった'; return d.final_verdict === 'APPROVED' ? '合格' : d.final_verdict === 'CHANGES_REQUIRED' ? '差し戻し' : '不明'; } catch { return null; }
}
function verdictsFor(evs) {
  const c = [...evs].reverse().find((e) => e.type === 'candidate' || e.type === 'held');
  if (!c || !/^[0-9a-f]{12}/.test(c.candidate || '')) return null;
  const c12 = c.candidate.slice(0, 12); const V = path.join(EV, 'verdicts');
  return { judge: verdictOf(path.join(V, `${c.task}-${c12}.json`), 'judge_parse_ok'), codex: verdictOf(path.join(V, `${c.task}-${c12}-codex-judge.json`), 'parse_ok'), security: verdictOf(path.join(V, `${c.task}-${c12}-codex-security.json`), 'parse_ok'), request: c.request };
}
function fullSha(prefix) { if (!/^[0-9a-f]{7,40}$/.test(prefix || '')) return null; const r = git('rev-parse', '--verify', '--quiet', `${prefix}^{commit}`); const v = (r.stdout || '').trim(); return SHA_RE.test(v) ? v : null; }

// 票ごとの工程・次の担当・操作できるか（できなければ理由）
function view() {
  const ts = tickets(); const byId = new Map(ts.map((t) => [t.id, t]));
  const ls = launchStates(); const b = budget(); const stop = stopped(); const evs = gateEvents();
  const rows = [];
  for (const t of ts) {
    const r = { ...t, stage: '', next: '', actions: [] };
    const tev = taskEvents(evs, t.id); r.events = tev.slice(-6).reverse(); r.verdicts = verdictsFor(tev);
    const lastJ = [...tev].reverse().find((e) => ['held', 'disagreement', 'rejected', 'judiciary_blocked', 'merged'].includes(e.type));
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
    } else if (t.status === 'blocked' && lastJ?.type === 'judiciary_blocked') {
      r.stage = '判断待ち（審査が使えない）'; r.next = 'オーナー';
      r.note = '判定ではない。審査の環境（予算・Codex・認証）を確かめ、行政の長が申請し直す';
    } else if (t.status === 'blocked' && (lastJ?.type === 'disagreement' || (lastJ?.type === 'rejected' && /分かれた/.test(lastJ.reason || '')))) {
      // p0.4.14：重大な不一致。裁定は申請の SHA に結び付き、裁定だけでは統合しない（再申請 → 審査の記録の照合 → 統合待ち → 統合の操作）
      const req = fullSha(r.verdicts?.request);
      const ruled = req && jsonl(path.join(EV, 'rulings.jsonl')).some((x) => x.task === t.id && x.sha === req && x.decision === 'merge');
      if (ruled) { r.stage = '裁定済み（行政の長の再申請待ち）'; r.next = '行政の長'; r.note = '同じ申請を出し直すと、裁判所が審査の記録を照合して統合待ちにする。裁定だけでは統合しない'; }
      else {
      r.stage = '判断待ち（重大な不一致）'; r.next = 'オーナー';
      r.decision = true;
      r.actions.push({ action: 'rule', label: `${t.id} は統合してよいと裁定する（申請 ${req ? req.slice(0, 7) : '—'}。裁定だけでは統合しない）`, target: req, why: req ? null : '申請の SHA を確かめられない' });
      }
    } else if (t.status === 'blocked') { r.stage = '判断待ち（止まった票）'; r.next = 'オーナー'; }
    else if (launchBusy(st)) { r.stage = '実装中（作業員）'; r.next = 'AI'; }
    else if (t.status === 'review') { r.stage = '審査中'; r.next = 'AI（司法）'; }
    else if (['ready', 'in_progress'].includes(t.status) && returnedAt(t.id) !== null) {
      r.stage = '判断待ち（自動修正を止めて人へ戻した）'; r.next = 'オーナー';
      r.note = '同じ重い指摘で続けて差し戻された。票の §2 を直して仕様を承認し直すと、開始できる';
    } else if (['ready', 'in_progress'].includes(t.status)) {
      r.stage = '開始待ち'; r.next = 'オーナー';
      const notMerged = t.deps.filter((d) => byId.get(d)?.status !== 'merged');
      let why = null;
      if (notMerged.length) why = `依存の票が未統合：${notMerged.join('・')}`;
      else if (!b) why = '予算の台帳を読めない';
      else if (b.until && Date.now() >= Date.parse(b.until)) why = '予算の期間が終わった';
      else if (b.overrun) why = '予算の超過あり（期間を変えるまで、作業員も司法も起動しない）';
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
// 子は非同期で動かす（統合の実行中も画面と停止を使える。Codex の監査 major）。リポジトリの場所は VGDD_REPO で固定して渡す（同 critical：
//   既存のスクリプトは cwd ではなく VGDD_REPO か既定の場所を使うため、渡さないと別のリポジトリの票を扱いうる）
function run(file, argv, timeoutMs) {
  return new Promise((resolve) => {
    execFile(path.join(HERE, file), argv, { cwd: REPO, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, VGDD_Z3_DIR: Z3, VGDD_REPO: REPO } }, (e, out, err) => {
      if (!e) return resolve({ ok: true, rc: 0, msg: short(out) });
      resolve({ ok: false, rc: Number.isInteger(e.code) ? e.code : null, msg: e.killed || e.signal ? `時間切れ・中断（${e.signal || 'timeout'}）` : short(`${out || ''}\n${err || ''}`) });
    });
  });
}
// ロック：停止はほかの操作と別のロック（統合の実行中でも止められる）。ロックには自分の pid を書く。取れないとき、持ち主の pid が
//   生きていなければ「取り残し」と出し、自動では消さない（オーナーが確かめて退ける。Codex の監査 major）
const lockDir = (kind) => path.join(CONSOLE_DIR, kind === 'stop' ? '.stop.lock' : '.action.lock');
function lock(kind) {
  const d = lockDir(kind);
  try { fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'pid'), `${process.pid}\n`); return null; } catch (e) {
    if (e.code !== 'EEXIST') return `ロックを取れない（${e.code}）`;
    const pid = Number((() => { try { return fs.readFileSync(path.join(d, 'pid'), 'utf8').trim(); } catch { return ''; } })());
    if (pid === process.pid) return 'ほかの操作を実行中。終わってから操作する';
    return alive(pid) ? 'ほかの窓口の操作を実行中。終わってから操作する' : `前の操作のロックが残っている（持ち主の pid ${pid || '不明'} は動いていない）。端末で確かめてから ${d.replace(os.homedir(), '~')} を退ける`;
  }
}
function unlock(kind) { const d = lockDir(kind); try { fs.rmSync(path.join(d, 'pid'), { force: true }); fs.rmdirSync(d); } catch { /* なし */ } }

async function perform(f) {
  const { action, task, target, action_id: aid } = f;
  if (!AID_RE.test(aid || '')) return { ok: false, msg: '操作の ID の形が違う' };
  if (!['approve', 'start', 'release', 'stop', 'resume', 'accept', 'rule'].includes(action)) return { ok: false, msg: '知らない操作' };
  const needsTask = !['stop', 'resume'].includes(action);
  if (needsTask && !TASK_RE.test(task || '')) return { ok: false, msg: '票の ID の形が違う' };
  const kind = action === 'stop' ? 'stop' : 'action';
  const lk = lock(kind); if (lk) return { ok: false, msg: lk };
  try {
    // 重複の照合はロックの中で（複数の窓口のプロセスでも、古い履歴のまま実行しない。Codex の監査 major）
    const prev = actionLog().filter((a) => a.action_id === aid);
    if (prev.length && prev.some((a) => a.phase === 'received' && (a.action !== action || (a.task || null) !== (needsTask ? task : null)))) return { ok: false, msg: '同じ操作の ID で別の操作が記録されている。実行しない', dup: true };
    if (prev.some((a) => a.phase === 'done')) { const d = prev.find((a) => a.phase === 'done'); return { ok: d.ok, msg: `同じ操作はすでに実行した（前の結果：${d.ok ? '成功' : '失敗'}。${d.msg || ''}）`, dup: true }; }
    if (prev.length) return { ok: false, msg: 'この操作は受け付けた後に結果が記録されていない（結果が不明）。状態を見てから、新しく操作する', dup: true };
    // 停止は全件の照合（view）を待たない。STOP の有無だけを見る（Codex の2回目の監査 major：停止を一覧の照合に待たせない）
    if (action === 'stop') {
      if (stopped()) return { ok: false, msg: 'すでに停止中' };
      appendAction({ action_id: aid, phase: 'received', action, task: null, target: null });
      const rs = await run('kernel-stop.sh', [`Owner Console から停止（${aid.slice(0, 8)}）`], 30000);
      if (rs.ok) rs.msg = '停止を要求した（STOP を置いた）。新しい作業・審査・統合は止まる。動いている処理の終了は「停止と再開」の欄で確かめる';
      appendAction({ action_id: aid, phase: 'done', ok: rs.ok, rc: rs.rc, msg: rs.msg });
      return rs;
    }
    // 実行の直前に、今の状態で確かめ直す（画面を出した後の変化）。承認と統合は、子のスクリプトにも対象を渡して、子の中でも照合させる
    const v = view(); const row = needsTask ? v.rows.find((r) => r.id === task) : null;
    if (needsTask && !row) return { ok: false, msg: '票が main にない' };
    let pre = null;
    if (needsTask) {
      const a = row.actions.find((x) => x.action === action);
      if (!a) pre = `いまの工程（${row.stage}）ではこの操作はできない`;
      else if (a.why) pre = a.why;
      else if (!a.target || a.target !== target) pre = '画面を出した後に対象が変わった。画面を開き直して確かめる';
    } else if (action === 'resume' && !v.stop) pre = '停止していない';
    if (pre) return { ok: false, msg: pre };
    appendAction({ action_id: aid, phase: 'received', action, task: needsTask ? task : null, target: needsTask ? target : null });
    let res;
    if (action === 'approve') res = await run('approve-spec.sh', [task, '--yes', '--expect', target, '--note', `owner-console ${aid}`], 60000);
    // 統合は時間で打ち切らない（Codex の2回目の監査 major：release.sh は main に組み合わせてから検査するので、途中で止めると検査していない統合が残りうる。
    //   release.sh 自身の取り消し（undo）と錠に任せ、窓口は終わるのを待つ）
    else if (action === 'release') res = await run('release.sh', ['--expect-request', target, task], 0);
    // p0.4.14：裁定（重大な不一致の申請を統合してよいと決める）。rule.sh に申請の SHA を固定して渡す。裁定だけでは統合しない
    else if (action === 'rule') {
      res = await run('rule.sh', [task, target, 'merge', `Owner Console の裁定（${aid.slice(0, 8)}）`], 30000);
      if (res.ok) res.msg = '裁定を記録した。行政の長が同じ申請を出し直すと、裁判所が審査の記録を照合して統合待ちにする（統合は統合の操作で）';
    }
    // 再開は点検だけ。停止の後に main に入ったコミットの受け入れ（--accept-main）は、対象の一覧を固定できないので窓口では行わない（端末で。Codex の監査 major）
    else if (action === 'resume') {
      res = await run('kernel-resume.sh', [`Owner Console から再開（${aid.slice(0, 8)}）`], 120000);
      if (!res.ok && /accept-main/.test(res.msg)) res.msg = `${res.msg}（停止の後に main が進んだ。コミットを確かめて、端末で kernel-resume.sh … --accept-main を使う）`;
    } else if (action === 'start') {
      // 開始は票の ID だけを置く。窓口（launcher）は起動の時点の承認を確かめ直すので、画面の後に仕様が変わっても、承認のない仕様では起動しない
      try {
        const dir = path.join(REPO, 'merge-requests', 'launch');
        for (const d of [path.join(REPO, 'merge-requests'), dir]) { const st = fs.lstatSync(d); if (!st.isDirectory()) throw new Error('申請の場所がフォルダでない（記号リンクを含む）'); }
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
  } finally { unlock(kind); }
}

// ---------- HTTP ----------
const TOKEN = crypto.randomBytes(32).toString('hex');
let tokenUsed = false;
const sessions = new Map();   // sid → { csrf, exp }
const SESSION_MS = 12 * 3600e3;
let BASE = '';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const eq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
// p0.4.12a：Referrer-Policy は same-origin（no-referrer にすると、ブラウザはフォームの送信の Origin を null にし、正しい操作がすべて「許されない Origin」になった。
//   同じ窓口の中の送信だけ Origin が付き、ほかのサイトへの遷移には送り元を出さない）
const HEAD = { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' };
function send(res, code, body, extra = {}) { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', ...HEAD, ...extra }); res.end(body); }
function sessionOf(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)vgdd_console=([0-9a-f]{64})/);
  if (!m) return null; const s = sessions.get(m[1]);
  if (!s || s.exp < Date.now()) { sessions.delete(m[1]); return null; }
  return s;
}
const jst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(11, 19);
// ---------- 画面（p0.4.14：編集室の構成。濃紺の左ナビ・明るい背景・細い区切り線。中央に作るもの、右に本人の対応、上に工程、下に直近の出来事） ----------
const CSS = `
*{box-sizing:border-box}body{margin:0;font:15px/1.7 "Hiragino Sans","Noto Sans JP",system-ui,sans-serif;color:#1d232b;background:#f5f2ec}
a{color:#22427a}a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #c98a1a;outline-offset:2px}
.app{display:grid;grid-template-columns:232px 1fr;min-height:100vh}
nav{background:#1b2a43;color:#e8ebf0;padding:20px 0;display:flex;flex-direction:column}
nav .brand{padding:0 20px 18px;border-bottom:1px solid #2f4060}nav .brand b{display:block;font-size:20px;letter-spacing:.04em}nav .brand small{color:#aab4c4}
nav ul{list-style:none;margin:16px 0;padding:0}nav li a,nav li span{display:flex;justify-content:space-between;padding:10px 20px;color:#e8ebf0;text-decoration:none;border-left:3px solid transparent}
nav li a[aria-current=page]{background:#253758;border-left-color:#e8ebf0;font-weight:600}nav li span{color:#8794a8}nav .count{background:#8a6a1f;color:#fff;border-radius:10px;padding:0 8px;font-size:13px}
nav .foot{margin-top:auto;padding:16px 20px;border-top:1px solid #2f4060;font-size:13px;color:#aab4c4}
header{display:flex;justify-content:space-between;align-items:center;padding:18px 32px;border-bottom:1px solid #ddd6ca;background:#faf8f4}
header h1{margin:0;font-size:24px}header .meta{display:flex;gap:20px;align-items:center;font-size:13px;color:#4b5563}
main{padding:20px 32px 40px}.crumb{display:flex;justify-content:space-between;font-size:13px;color:#4b5563;margin-bottom:12px}
.flow{border:1px solid #ddd6ca;border-top:3px solid #22427a;background:#fbfaf7;margin-bottom:20px}.flow.alert{border-top-color:#9b2c2c}
.flow .row{display:flex;flex-wrap:wrap;align-items:center;gap:16px;padding:14px 20px}.flow .now small{display:block;color:#6b7280;font-size:12px}
.steps{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:0;padding:0;flex:1}.steps li{display:flex;align-items:center;gap:6px;color:#6b7280}.steps li+li:before{content:"—";color:#c9c2b6;margin-right:4px}
.steps .n{display:inline-flex;width:24px;height:24px;border-radius:50%;border:1px solid #b9b2a6;align-items:center;justify-content:center;font-size:12px}
.steps .done{color:#1d5b3a}.steps .done .n{background:#2f6b4a;border-color:#2f6b4a;color:#fff}.steps .cur{color:#1d232b;font-weight:700}.steps .cur .n{background:#22427a;border-color:#22427a;color:#fff}
.flow.alert .steps .cur .n{background:#9b2c2c;border-color:#9b2c2c}.flow .who{border-top:1px solid #e6e0d5;padding:10px 20px;font-size:14px}.flow .who b{color:#22427a;margin-right:12px}.flow.alert .who b{color:#9b2c2c}
.kernel{font-size:12px;color:#6b7280;padding:0 20px 10px}
.cols{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:32px}.side{border-left:1px solid #ddd6ca;padding-left:28px}
@media (max-width:1100px){.cols{grid-template-columns:1fr}.side{border-left:0;border-top:1px solid #ddd6ca;padding-left:0;padding-top:20px}}
@media (max-width:760px){.app{grid-template-columns:1fr}nav{flex-direction:row;flex-wrap:wrap;padding:8px}nav ul{display:flex;flex-wrap:wrap;margin:0}nav .brand,nav .foot{border:0;padding:8px}header,main{padding-left:16px;padding-right:16px}}
h2{font-size:22px;margin:4px 0 6px}h3{font-size:15px;margin:22px 0 6px;padding-top:10px;border-top:1px solid #ddd6ca}.lab{font-size:13px;color:#6b7280;font-weight:600}
.verdicts{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #ddd6ca;margin:12px 0}.verdicts div{padding:12px 16px}.verdicts div+div{border-left:1px solid #ddd6ca}.verdicts b{display:block;font-size:20px}
.ok{color:#1d5b3a}.ng{color:#9b2c2c}.unk{color:#8a6a1f}
.pending{background:#2a2f36;color:#fff;padding:10px 16px;margin:10px 0;font-size:14px}
dl.kv{display:grid;grid-template-columns:7em 1fr;gap:4px 12px;margin:6px 0}dl.kv dt{color:#6b7280}dl.kv dd{margin:0}
.side .big{font-size:24px;line-height:1.4;margin:6px 0}.side .need{color:#9b2c2c;font-weight:700;font-size:13px}
button{font:inherit;padding:10px 14px;border:1px solid #22427a;background:#22427a;color:#fff;cursor:pointer;width:100%;text-align:left;margin:4px 0}button[disabled]{background:#e8e4dc;color:#6b7280;border-color:#d4cec3;cursor:not-allowed}
button.sub{background:transparent;color:#22427a}button.danger{background:#fff;color:#9b2c2c;border-color:#c98b8b;width:auto}
.why{font-size:13px;color:#6b7280;margin:0 0 8px}.flash{border:1px solid #9aa4b2;background:#fff;padding:10px 14px;margin-bottom:16px}
table{border-collapse:collapse;width:100%}td,th{border-top:1px solid #e1dbd0;padding:8px 6px;text-align:left;vertical-align:top}th{font-size:13px;color:#6b7280;font-weight:600}
ol.tl{list-style:none;padding:0;margin:0}ol.tl li{display:grid;grid-template-columns:5em 1fr;gap:12px;padding:6px 0;border-top:1px solid #ece6db}ol.tl time{font-family:ui-monospace,monospace;color:#4b5563}
pre{white-space:pre-wrap;font:inherit;margin:4px 0}.note{font-size:13px;color:#4b5563}.check{border-left:3px solid #b9b2a6;padding-left:10px;margin:6px 0}
`;
const STEP_NAMES = ['条件の承認', '実装', '独立検証', '統合', '利用者確認'];
function stepOf(r) {
  const st = r.stage;
  if (st.startsWith('受け入れ済み')) return 6;
  if (st.startsWith('統合済み')) return 5;
  if (st === '判断待ち（統合）') return 4;
  if (st === '審査中' || /重大な不一致|審査が使えない|止まった票|裁定済み/.test(st)) return 3;
  if (st.startsWith('下書き')) return 1;
  if (st === '取り下げ') return 0;
  return 2;
}
function whoOf(r) {
  const m = { '下書き（仕様の承認待ち）': 'オーナーが、票の受け入れ条件を確かめて承認する', '開始待ち': 'オーナーが開始すると、窓口が作業員（Claude Code）を起こす', '実装中（作業員）': '作業員（Claude Code）が、承認した条件の範囲で実装している。終わると Claude judge と Codex が別々に審査する', '審査中': 'Claude judge と Codex が、差分と受け入れ条件だけを見て、別々に審査している', '判断待ち（統合）': 'オーナーが統合する（審査は合格。統合の条件を Kernel が確かめ直す）', '判断待ち（重大な不一致）': 'Claude judge と Codex の判定が重大な指摘で分かれた。オーナーの判断を待っている', '判断待ち（審査が使えない）': '審査が続けて使えなかった（判定ではない）。オーナーが環境を確かめる', '判断待ち（自動修正を止めて人へ戻した）': '同じ重い指摘で続けて差し戻された。§2 の見直しを待っている', '統合済み（動作の確認待ち）': 'オーナーが成果物を確かめて受け入れる', '裁定済み（行政の長の再申請待ち）': '裁定を記録した。行政の長が同じ申請を出し直すと、裁判所が審査の記録を照合して統合待ちにする', '停止中': 'Kernel の停止中。新しい作業・審査・統合は止まっている' };
  return m[r.stage] || (r.next === 'AI' ? 'AI が進めている' : '—');
}
function pageShell(s, active, title, body, flash, v) {
  const waitN = v.rows.filter((r) => r.next === 'オーナー').length;
  const link = (href, label, key, extra = '') => `<li><a href="${href}"${active === key ? ' aria-current="page"' : ''}>${esc(label)}${extra}</a></li>`;
  const ext = (p, label) => (APP_URL ? `<li><a href="${esc(APP_URL + p)}" rel="noopener">${esc(label)}</a></li>` : `<li><span title="--app-url が未設定">${esc(label)}（アプリの URL が未設定）</span></li>`);
  const stopBtn = v.stop ? '<span class="ng">停止中</span>' : `<form method="post" action="/action" style="margin:0">${hidden(s, { action: 'stop', task: '', target: '' })}<input type="hidden" name="back" value="${esc(active === 'task' ? '/' : '/')}"><button class="danger">開発を止める</button></form>`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>${esc(title)} — VGDD オーナーの操作</title><style>${CSS}</style></head><body>
<div class="app"><nav aria-label="主な場所"><div class="brand"><b>VGDD</b><small>Governance Kernel</small></div><ul>
${link('/', '開発', ['dev', 'task'].includes(active) ? active : 'dev')}${ext('/requirements', '要件')}${link('/inbox', '判断待ち', 'inbox', waitN ? ` <span class="count">${waitN}</span>` : '')}${ext('/governance', '統治の記録')}${link('/env', '環境・接続', 'env')}
</ul><div class="foot">実際の稼働を表示中<br>取得 ${esc(jst(v.at))}（30 秒ごと）<br>この画面はオーナーだけのもの</div></nav>
<div><header><h1>${esc(PROJECT)}</h1><div class="meta"><span>操作権限：オーナー（この窓口のセッション）</span>${stopBtn}</div></header>
<main>${flash ? `<div class="flash" role="status">${esc(flash)}</div>` : ''}${body}</main></div></div></body></html>`;
}
const hidden = (s, a) => `<input type="hidden" name="csrf" value="${esc(s.csrf)}"><input type="hidden" name="action_id" value="${crypto.randomBytes(16).toString('hex')}"><input type="hidden" name="action" value="${esc(a.action)}"><input type="hidden" name="task" value="${esc(a.task || '')}"><input type="hidden" name="target" value="${esc(a.target || '')}">`;
function formFor(s, a, task, back, cls = '') {
  return `<form method="post" action="/action">${hidden(s, { ...a, task })}<input type="hidden" name="back" value="${esc(back)}"><button ${cls ? `class="${cls}" ` : ''}${a.why ? 'disabled' : ''}>${esc(a.label)}</button>${a.why ? `<p class="why">できない理由：${esc(a.why)}</p>` : ''}</form>`;
}
function checkBlock(r) {
  return `<div class="check"><span class="lab">確かめ方（票の §3）</span><pre>${esc(r.sec3 || '（票に §3 がない）')}</pre>${r.unverified?.length ? `<span class="lab">まだ確かめていない範囲（票の §6）</span><ul>${r.unverified.map((u) => `<li class="note">${esc(u)}</li>`).join('')}</ul>` : '<p class="note">§6 に「確かめていない」の記録はない</p>'}<p class="note">画面の確認は、アプリを開いて行う。受け入れは「確かめた」という記録で、確かめた中身は保証しない</p></div>`;
}
function budgetBlock(b) {
  const usage = (u, l) => (l === null || l === undefined ? `${u}（上限なし）` : `${u} ／ ${l}`);
  if (!b) return '<p class="ng"><b>予算の台帳を読めない</b>（開始はできない。0 とは扱わない）</p>';
  return `${b.overrun ? '<p class="ng"><b>予算の超過あり</b>：1回の予約を超えた実行がある。期間を変える（budget-set.sh）まで、作業員も司法も起動しない</p>' : ''}<dl class="kv"><dt>期間</dt><dd>${esc(b.period_id ?? '—')}（${esc(b.until ?? '—')} まで）</dd><dt>トークン</dt><dd>${esc(usage(b.tokens.settled + b.tokens.reserved, b.tokens.limit))}（精算済み＋予約中。読めなかった ${esc(b.tokens.unknown_runs)} 件は予約の全量で数えている）</dd><dt>審査の呼び出し</dt><dd>${esc(usage(b.judge_calls.used, b.judge_calls.limit))}</dd><dt>作業員（同時）</dt><dd>${esc(usage(b.workers.active, b.workers.limit))}</dd></dl><p class="note">数えるのは Kernel の窓口を通った呼び出しだけ。契約の利用枠の残りは読めない。推定費用は出さない</p>`;
}
function stopBlock(s, v, back) {
  return v.stop
    ? `<p><b>停止中</b>（STOP を置いた）。動いている作業員・司法：${v.active === null ? '確かめられない' : v.active === 0 ? '0（止まったのを確かめた）' : `${v.active}（まだ動いている。終わるまで待つ）`}</p>${formFor(s, { action: 'resume', label: '点検して再開する（証拠・設定・main を確かめ、合わなければ再開しない。停止の後に main が進んだときの受け入れは端末で）', target: '' }, '', back)}`
    : `<p>動いている（停止していない）。動いている作業員・司法：${v.active ?? '確かめられない'}</p>${formFor(s, { action: 'stop', label: '全体を止める（新しい作業・審査・統合を止める。動いている処理は終わるまで残る）', target: '' }, '', back, 'sub')}`;
}
// 開発（/）：判断待ち（操作つき）、票の一覧、停止、予算
function page(s, flash) {
  const v = view();
  const waiting = v.rows.filter((r) => r.next === 'オーナー');
  const body = `<div class="crumb"><span>開発 / 全体</span><span>データ時点 ${esc(jst(v.at))}</span></div>
<div class="cols"><section><h2>判断待ち（${waiting.length} 件）</h2>
<ul>${waiting.map((r) => `<li>${esc(r.id)}：${esc(r.stage)} — <a href="/t/${esc(r.id)}">${esc(r.title)}</a>${r.note ? `<br><span class="note">${esc(r.note)}</span>` : ''}${r.actions.some((a) => a.action === 'accept') ? checkBlock(r) : ''}${r.actions.map((a) => formFor(s, a, r.id, '/')).join('')}</li>`).join('') || '<li>なし（対応は不要です）</li>'}</ul>
<h3>票</h3><table><thead><tr><th>票</th><th>工程</th><th>次の担当</th><th>題</th></tr></thead><tbody>
${v.rows.filter((r) => r.stage !== '受け入れ済み' && !r.stage.includes('受け入れの記録を始める前') && r.stage !== '取り下げ').map((r) => `<tr><td><a href="/t/${esc(r.id)}">${esc(r.id)}</a></td><td>${esc(r.stage)}</td><td>${esc(r.next)}</td><td>${esc(r.title)}</td></tr>`).join('')}
</tbody></table><p class="note">受け入れ済み・受け入れの記録を始める前に統合した票は一覧から外している。過去の記録（判定・判例・再生）は「統治の記録」で見る</p></section>
<aside class="side"><span class="lab">停止と再開</span>${stopBlock(s, v, '/')}<h3>予算</h3>${budgetBlock(v.b)}</aside></div>`;
  return pageShell(s, 'dev', '開発', body, flash, v);
}
function inboxPage(s, flash) {
  const v = view(); const waiting = v.rows.filter((r) => r.next === 'オーナー');
  const body = `<div class="crumb"><span>判断待ち</span><span>データ時点 ${esc(jst(v.at))}</span></div><h2>判断待ち（${waiting.length} 件）</h2>
<table><thead><tr><th>票</th><th>決めること</th><th>題</th></tr></thead><tbody>${waiting.map((r) => `<tr><td><a href="/t/${esc(r.id)}">${esc(r.id)}</a></td><td>${esc(r.stage)}</td><td>${esc(r.title)}</td></tr>`).join('') || '<tr><td colspan="3">なし（対応は不要です）</td></tr>'}</tbody></table>`;
  return pageShell(s, 'inbox', '判断待ち', body, flash, v);
}
function envPage(s, flash) {
  const v = view();
  const alive = (pat) => { const r = spawnSync('pgrep', ['-f', pat], { encoding: 'utf8' }); return r.status === 0 ? (r.stdout.trim().split('\n').length) : 0; };
  const gr = alive(path.join(HERE, 'gate-runner.sh')); const ln = alive(path.join(HERE, 'launcher.sh'));
  const lastJu = [...gateEvents()].reverse().find((e) => e.type === 'judiciary_unavailable' || e.type === 'judiciary_blocked');
  const body = `<div class="crumb"><span>環境・接続</span><span>データ時点 ${esc(jst(v.at))}</span></div><div class="cols"><section><h2>環境・接続</h2>
<dl class="kv"><dt>裁判所</dt><dd>${gr === 1 ? '<span class="ok">動いている（1つ）</span>' : gr === 0 ? '<span class="ng">動いていない</span>（審査と統合が進まない）' : `<span class="ng">${gr} つ動いている</span>（二重。古いほうを止める）`}</dd>
<dt>起動の窓口</dt><dd>${ln >= 1 ? '<span class="ok">動いている</span>' : '<span class="ng">動いていない</span>（開始しても作業員が起きない）'}</dd>
<dt>司法</dt><dd>Claude judge（Claude Code）と Codex（別系統）。最後に審査が使えなかった記録：${lastJu ? esc(String(lastJu.ts).slice(0, 16)) + '（判定ではない）' : 'なし'}</dd>
<dt>停止</dt><dd>${v.stop ? '<span class="ng">停止中</span>' : '停止していない'}</dd>
<dt>ローカル LLM</dt><dd>任意の補助。未導入でも主要な機能は動く（この窓口では確かめていない）</dd>
<dt>公開のアプリ</dt><dd>${APP_URL ? esc(APP_URL) : '未設定（起動の引数 --app-url で、要件と統治の記録へのリンクが有効になる）'}</dd></dl>
<p class="note">導入の診断は、端末で node scripts/doctor.mjs（読み取りだけ）</p></section><aside class="side"><span class="lab">予算</span>${budgetBlock(v.b)}</aside></div>`;
  return pageShell(s, 'env', '環境・接続', body, flash, v);
}
// 票の作業の画面（/t/T-NNN）：上に工程、中央に承認した条件と判定、右に本人の対応、下に直近の出来事
function taskPage(s, id, flash) {
  const v = view(); const r = v.rows.find((x) => x.id === id);
  if (!r) return null;
  const step = stepOf(r); const alert = r.next === 'オーナー' && /重大な不一致|審査が使えない|止まった票|人へ戻した/.test(r.stage);
  const steps = STEP_NAMES.map((n, i) => { const k = i + 1; const cls = step > k ? 'done' : step === k ? 'cur' : ''; return `<li class="${cls}"${step === k ? ' aria-current="step"' : ''}><span class="n">${step > k ? '✓' : k}</span>${esc(n)}</li>`; }).join('');
  const vd = r.verdicts; const cls = (x) => (x === '合格' ? 'ok' : x === '差し戻し' ? 'ng' : 'unk');
  const vbox = (name, x) => `<div><span class="lab">${name}</span><b class="${cls(x)}">${esc(x ?? 'まだない')}</b></div>`;
  const decided = r.actions.length ? r.actions.map((a) => formFor(s, a, r.id, `/t/${r.id}`)).join('') : '';
  const sideHead = r.next === 'オーナー' ? `<p class="need">あなたの判断が必要です</p><p class="big">${esc(r.stage.replace(/^判断待ち（|）$/g, ''))}</p>` : `<p class="big">対応は不要です</p><p class="note">${esc(whoOf(r))}</p>`;
  const disagree = r.stage === '判断待ち（重大な不一致）' ? `<p class="note"><b>選べる進め方（既存の規則に対応）</b></p><ul class="note"><li><b>統合してよいと裁定する</b>（上のボタン）：申請の SHA に結び付けて記録する。裁定だけでは統合しない。行政の長が同じ申請を出し直すと、裁判所が審査の記録を照合して統合待ちにし、そのあと統合の操作が要る</li><li><b>修正して再審査</b>：行政の長が票を作業中に戻して作業員を起こし直す（窓口からは票を書き換えない）</li><li><b>仕様を見直す</b>：立法補佐が票の §2 を直すと、ここに「仕様を承認する」が出る</li><li><b>今回は中止</b>：取り下げの仕組みがまだないので、この窓口ではできない</li></ul>` : '';
  const product = r.stage.startsWith('受け入れ済み') ? '<p class="ok">利用者が確かめた（受け入れの記録あり）</p>' : r.stage.startsWith('統合済み') ? `<p>統合済み（動作の確認待ち）</p>${checkBlock(r)}` : '<p>準備中（審査を通り、統合されてから確かめられる）</p>';
  const pendingBar = ['審査中', '判断待ち（統合）', '判断待ち（重大な不一致）', '判断待ち（審査が使えない）'].includes(r.stage) ? '<div class="pending" role="note">この変更は、まだ main に統合されていない。必要な裁定・再審査・承認など、統合の条件を満たすまで反映しない</div>' : '';
  const body = `<div class="crumb"><span>開発 / ${esc(r.id)} / ${esc(r.stage)}</span><span>データ時点 ${esc(jst(v.at))}</span></div>
<section class="flow${alert ? ' alert' : ''}" aria-label="工程"><div class="row"><div class="now"><small>現在の状態</small><b>${esc(r.stage)}</b></div><ol class="steps">${steps}</ol></div>
<div class="who"><b>現在の担当</b>${esc(whoOf(r))}</div><div class="kernel">Kernel（裁判所・フック・予算の台帳）は、どの工程でも承認した条件を強制する基盤で、担当ではない</div></section>
<div class="cols"><section><span class="lab">承認した条件</span><h2>${esc(r.title)}</h2>${pendingBar}
<span class="lab">目的（票の §1）</span><pre>${esc(r.sec1 || '（票に §1 がない）')}</pre>
<h3>受け入れ条件（票の §2）</h3><ul>${r.criteria.map((c) => `<li><b>${esc(c.id)}</b> ${esc(c.text)}</li>`).join('') || '<li>（読めない）</li>'}</ul>
<dl class="kv"><dt>対象</dt><dd>${r.allowed.length ? r.allowed.map(esc).join('、') : '—'}</dd><dt>対象外</dt><dd>${r.forbidden.length ? r.forbidden.map(esc).join('、') : '—'}</dd></dl>
<p class="note">画面案はこの票にない（作るものは受け入れ条件で決まる）</p>
<h3>審査の結論（最新の候補。理由の本文は出さない）</h3>${vd ? `<div class="verdicts">${vbox('Claude judge', vd.judge)}${vbox('Codex', vd.codex)}${r.security ? vbox('セキュリティ審査（Codex）', vd.security) : `<div><span class="lab">セキュリティ審査</span><b class="note">この票では行わない</b></div>`}</div>` : '<p class="note">まだ審査していない</p>'}
<h3>直近の出来事（裁判所の記録）</h3><ol class="tl">${r.events.map((e) => `<li><time>${esc(String(e.ts || '').slice(11, 16))}</time><span>${esc(EVENT_LABEL[e.type])}</span></li>`).join('') || '<li><time>—</time><span>まだない</span></li>'}</ol></section>
<aside class="side">${sideHead}${decided}${r.note ? `<p class="note">${esc(r.note)}</p>` : ''}${disagree}<h3>成果物</h3>${product}<h3>予算</h3>${budgetBlock(v.b)}</aside></div>`;
  return pageShell(s, 'task', r.id, body, flash, v);
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
    if (req.method === 'GET' && u.pathname === '/inbox') return send(res, 200, inboxPage(s, u.searchParams.get('m')));
    if (req.method === 'GET' && u.pathname === '/env') return send(res, 200, envPage(s, u.searchParams.get('m')));
    const tm = u.pathname.match(/^\/t\/(T-\d{3,4})$/);
    if (req.method === 'GET' && tm) { const h = taskPage(s, tm[1], u.searchParams.get('m')); return h ? send(res, 200, h) : send(res, 404, '票がない'); }
    if (req.method === 'POST' && u.pathname === '/action') {
      if (req.headers.origin !== BASE) return send(res, 403, '許されない Origin');
      if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return send(res, 403, '許されない要求の出どころ');
      if (!/^application\/x-www-form-urlencoded\b/.test(req.headers['content-type'] || '')) return send(res, 415, '形が違う');
      const body = await readBody(req, 8192); if (body === null) return send(res, 413, '大きすぎる');
      const f = Object.fromEntries(new URLSearchParams(body));
      if (!eq(f.csrf || '', s.csrf)) return send(res, 403, 'CSRF トークンが違う');
      const r = await perform(f);
      const back = /^\/(t\/T-\d{3,4}|inbox|env)?$/.test(f.back || '') ? f.back : '/';   // 戻り先は窓口の中の決まった場所だけ
      return send(res, 303, '', { Location: `${back}?m=${encodeURIComponent(`${f.action || ''} ${f.task || ''}：${r.ok ? '成功' : '失敗・未実行'}。${r.msg}`)}` });
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
