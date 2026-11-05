#!/usr/bin/env node
// VGDD Governance Kernel — 状態の書き出し（p0.4.3。Kernel の UI の前提、OBS-051）
//
// 置き場所：原本は vgdd/scripts/kernel-state.mjs。実行用は ~/tsubuyaki-z3/bin/kernel-state.mjs（オーナーがコピー）。
// 呼ぶのは裁判所（gate-runner）だけ。周回の終わりと停止中の周回に1回。
//   node kernel-state.mjs --repo <main の checkout> --z3 <Z3> --out <docs/governance/kernel-state.json>
//
// 位置づけ：**表示用の写し**。判断の根拠にしない（MUST NOT）。仕様の承認の効力は Z3 の spec_approvals.jsonl だけが与える。
//   裁判所・夜間の代行・release はこのファイルを読まない（判例 ST9）。
// 出すのは公開してよい集計だけ。出さない（MUST NOT）：判定・裁定・停止の理由の本文、証拠ストアの各行、パス、セッション ID、
//   tool_use_id、作業員の報告、コミットの本文、ハッシュ（指紋・SHA・チェーン）の全桁も一部も（判例 ST1）。
// 周回ごとに必ず書き直す（generated_at が裁判所の生存の合図。画面は 10 分以上古ければ「古い写し」と出す）。
//   一時ファイルに書いてから rename（読み手が途中を読まない）。git で追跡しないので、書き直しはコミットの雑音にならない。
// 終了コード：0 書いた、1 失敗（裁判所は kernel_state_unwritten を記録して周回を続ける）
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i === -1 ? null : args[i + 1]; };
const REPO = opt('--repo'); const Z3 = opt('--z3'); const OUT = opt('--out');
if (!REPO || !Z3 || !OUT) { console.error('--repo・--z3・--out が必要'); process.exit(64); }
const EV = path.join(Z3, 'evidence');

const jst = (ms) => new Date(ms + 9 * 3600e3).toISOString().replace(/\.\d+Z$/, '+09:00');
const lines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const git = (...a) => spawnSync('git', ['-C', REPO, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...a], { encoding: 'utf8' });
const TASK_RE = /^T-\d{3,4}$/;
// 値は項目ごとの形だけを通す（Codex の指摘 #8。長さの上限だけでは SHA・セッション ID・短い理由の本文が通る）
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?([+-]\d{2}:?\d{2}|Z)$/;
const VER_RE = /^p\d+\.\d+\.\d+[a-z]?$/;
// 時刻。+0900 の形（gate-runner の ts）は +09:00 にそろえる（画面の Date.parse が読める形に）
const str = (v) => (typeof v === 'string' && ISO_RE.test(v) ? v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2') : null);
const ver = (v) => (typeof v === 'string' && VER_RE.test(v) ? v : null);   // 法律・フックの版
const IMPLS = new Set(['repo', 'z3']);
// 範囲：配列は最大 500 件（新しいものを残す）、件数は 0〜1,000,000 の整数（画面の検証と同じ。範囲外で写し全体が捨てられないように。T-022 の点検 #6）
const MAX_ITEMS = 500; const MAX_COUNT = 1_000_000;
const cap = (a) => a.slice(-MAX_ITEMS);
const cnt = (n) => (Number.isInteger(n) && n >= 0 ? Math.min(n, MAX_COUNT) : 0);
const uniq = (a) => [...new Set(a)].sort();

const events = lines(path.join(EV, 'gate_events.jsonl'));
const lastTs = (pred) => { const e = events.filter(pred).pop(); return e ? str(e.ts) : null; };

// 法律の版
const capsSrc = git('show', 'main:vgdd/kernel/capabilities.json');
let kernel_version = null; try { kernel_version = ver(JSON.parse(capsSrc.stdout).kernel_version); } catch { /* なし */ }
const lastCall = lines(path.join(EV, 'tool_calls.jsonl')).pop();
const policy_version = lastCall ? ver(lastCall.policy_version) : null;

// 停止（理由の本文と stop_id は出さない。時刻は gate_events の kernel_stop から）
const stopActive = fs.existsSync(path.join(Z3, 'STOP'));
const stopped = { active: stopActive, since: stopActive ? lastTs((e) => e.type === 'kernel_stop') : null };

// 仕様の承認：main の票の今の指紋と一致するか（spec-digest.mjs --check。指紋そのものは出さない）
const approvalsLog = lines(path.join(EV, 'spec_approvals.jsonl')).filter((a) => TASK_RE.test(a.task || ''));
const tree = git('ls-tree', '--name-only', 'main', 'docs/tasks/').stdout.split('\n');
const digestBin = [path.join(Z3, 'bin/spec-digest.mjs'), path.join(HERE, 'spec-digest.mjs')].find((p) => fs.existsSync(p));
const approvals = uniq(approvalsLog.map((a) => a.task)).map((task) => {
  const rel = tree.find((f) => path.basename(f).startsWith(`${task}-`) && f.endsWith('.md'));
  let current = false;
  if (rel && digestBin) current = spawnSync('node', [digestBin, '--repo', REPO, '--ref', 'main', '--ticket', rel, '--check', path.join(EV, 'spec_approvals.jsonl')], { encoding: 'utf8' }).status === 0;
  const last = approvalsLog.filter((a) => a.task === task).pop();
  return { task, current, approved_at: str(last?.ts) };
}).slice(-MAX_ITEMS);

// held：refs/vgdd/held/<task> が残っているもの（release が消す）。候補の SHA は出さない
const heldRefs = git('for-each-ref', '--format=%(refname:strip=3)', 'refs/vgdd/held/').stdout.split('\n').filter((t) => TASK_RE.test(t));
const held = cap(heldRefs.sort()).map((task) => ({ task, since: lastTs((e) => e.type === 'held' && e.task === task) }));

// 裁定・取り消し（理由の本文は出さない）
const rulingsLog = lines(path.join(EV, 'rulings.jsonl'));
const rulings = { count: cnt(rulingsLog.length), tasks: cap(uniq(rulingsLog.map((r) => r.task).filter((t) => TASK_RE.test(t || '')))) };
const annulments = { count: cnt(lines(path.join(EV, 'annulments.jsonl')).length) };

// 判定：ファイル名で分類し、票ごと・司法ごとに最新の結論だけ（findings は出さない。SKIPPED などは null）
const VF = /^(T-\d{3,4})-[0-9a-f]{7,40}(?:-stub)?(-codex-(judge|security))?\.json$/;
const by_task = {}; let vcount = 0;
let vfiles = []; try { vfiles = fs.readdirSync(path.join(EV, 'verdicts')); } catch { /* なし */ }
for (const f of vfiles) {
  const m = f.match(VF); if (!m) continue;
  vcount += 1;
  const kind = m[3] === 'judge' ? 'codex' : m[3] === 'security' ? 'security' : 'judge';
  const full = path.join(EV, 'verdicts', f);
  // 裁判所と同じく、司法の出力を解釈できなかった記録（judge_parse_ok／parse_ok が false）は判定ではない → null（Codex の再監査 #6）
  let v = null; try { const o = JSON.parse(fs.readFileSync(full, 'utf8')); if ((kind === 'judge' ? o.judge_parse_ok : o.parse_ok) === true) v = o.final_verdict; } catch { /* 壊れた記録 */ }
  const mtime = fs.statSync(full).mtimeMs;
  const t = (by_task[m[1]] ??= { judge: null, codex: null, security: null, at: null, _m: {} });
  if ((t._m[kind] ?? -1) < mtime) { t._m[kind] = mtime; t[kind] = v === 'APPROVED' || v === 'CHANGES_REQUIRED' ? v : null; }
  if (!t.at || mtime > Date.parse(t.at)) t.at = jst(mtime);
}
for (const t of Object.values(by_task)) delete t._m;

const dis = events.filter((e) => e.type === 'disagreement');
const disagreements = { count: cnt(dis.length), tasks: cap(uniq(dis.map((e) => e.task).filter((t) => TASK_RE.test(t || '')))) };

// 司法の状態：最後の「司法が使えない」の後に判定が成り立った出来事がなければ unavailable（分類だけ。道具の名は出さない）
const JUD_BAD = new Set(['judiciary_unavailable', 'preflight_failed']);
const JUD_OK = new Set(['held', 'merged', 'disagreement', 'owner_ruling']);
const lastJud = events.filter((e) => JUD_BAD.has(e.type) || JUD_OK.has(e.type)).pop();
const judiciary = lastJud && JUD_BAD.has(lastJud.type)
  ? { status: 'unavailable', kind: lastJud.type, since: str(lastJud.ts) }
  : { status: 'ok', kind: null, since: null };

// 証拠ストア：件数とハッシュチェーンの検証の結果だけ
let evidence = { records: 0, chain_ok: null, checkpoint_mismatches: null, checkpoint_at: null, last_record_at: null };
const vc = path.join(Z3, 'hooks/verify-chain.mjs'); const calls = path.join(EV, 'tool_calls.jsonl');
if (fs.existsSync(vc) && fs.existsSync(calls)) {
  const r = spawnSync('node', [vc, calls, '--summary-json'], { encoding: 'utf8', timeout: 60000 });
  // chain_ok はハッシュチェーン（改ざん・欠落）、checkpoint_mismatches はチェックポイントとの食い違いの件数（末尾の切り詰め・差し替えの疑い）。
  //   2つを分ける：p0.4.2 の裁判所の競合（OBS-055）で生じた食い違いが、チェーンの不整合に見えないように
  const mism = (r.stderr || '').split('\n').filter((l) => /^チェックポイント: /.test(l) && !/^チェックポイント: OK/.test(l)).length;
  try { const s = JSON.parse(r.stdout); evidence = { records: cnt(Number(s.records)), chain_ok: s.chain_ok === true, checkpoint_mismatches: mism, checkpoint_at: null, last_record_at: str(s.period?.last) }; } catch { evidence.chain_ok = false; }
}
evidence.checkpoint_at = str(lines(path.join(EV, 'checkpoints.jsonl')).pop()?.ts);

// 最後の適合性テスト（run.mjs --record がオーナーの権限で Z3 に残したもの）
const conf = lines(path.join(EV, 'conformance.jsonl')).pop();
const cpass = cnt(conf?.passed); const ctotal = cnt(conf?.total);
const conformance = conf && cpass <= ctotal ? { passed: cpass, total: ctotal, impl: IMPLS.has(conf.impl) ? conf.impl : null, kernel_version: ver(conf.kernel_version), at: str(conf.at) } : null;

const state = { schema: 'vgdd.kernel-state.v1', generated_at: null, kernel_version, policy_version, stopped, judiciary, approvals, held, rulings, annulments, verdicts: { count: cnt(vcount), by_task: Object.fromEntries(Object.entries(by_task).sort().slice(-MAX_ITEMS)) }, disagreements, evidence, conformance };

// 書き出し（Codex の指摘 #7）：出力先の親と祖先（--repo の中）がシンボリックリンクでない実のディレクトリであることを確かめ、
//   同じディレクトリに推測できない名前の一時ディレクトリを排他的に作って（mkdtemp）、その中に排他的に書き（wx）、rename する。
//   公開先がシンボリックリンクなら書かない（rename はリンクを置き換えるが、リンクの先には書かない）
try {
  const dir = path.dirname(OUT);
  // 祖先を先に確かめてから作る（既存の祖先のリンクをたどって作らない。Codex の再監査 #3）。docs/governance/ は丸ごと保護パス
  for (let d = dir; d.startsWith(path.resolve(REPO)) && d !== path.resolve(REPO); d = path.dirname(d)) {
    let st = null; try { st = fs.lstatSync(d); } catch { continue; }   // まだない
    if (!st.isDirectory()) throw Object.assign(new Error('出力先の祖先がディレクトリでない（リンクを含む）'), { code: 'ENOTDIR_LINK' });
  }
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.lstatSync(dir).isDirectory()) throw Object.assign(new Error('出力先の親がディレクトリでない'), { code: 'ENOTDIR_LINK' });
  state.generated_at = jst(Date.now());
  const tdir = fs.mkdtempSync(path.join(dir, '.kernel-state.json.tmp-'));
  const tmp = path.join(tdir, 'kernel-state.json');
  try {
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
    fs.renameSync(tmp, OUT);
  } finally { fs.rmSync(tdir, { recursive: true, force: true }); }
} catch (e) { console.error(`書き出しに失敗：${e.code || e.message}`); process.exit(1); }
