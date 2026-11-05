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
const str = (v) => (typeof v === 'string' && v.length <= 40 && !/[\n/]/.test(v) ? v : null); // 時刻・版などの短い値だけ通す
const uniq = (a) => [...new Set(a)].sort();

const events = lines(path.join(EV, 'gate_events.jsonl'));
const lastTs = (pred) => { const e = events.filter(pred).pop(); return e ? str(e.ts) : null; };

// 法律の版
const capsSrc = git('show', 'main:vgdd/kernel/capabilities.json');
let kernel_version = null; try { kernel_version = str(JSON.parse(capsSrc.stdout).kernel_version); } catch { /* なし */ }
const lastCall = lines(path.join(EV, 'tool_calls.jsonl')).pop();
const policy_version = lastCall ? str(lastCall.policy_version) : null;

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
});

// held：refs/vgdd/held/<task> が残っているもの（release が消す）。候補の SHA は出さない
const heldRefs = git('for-each-ref', '--format=%(refname:strip=3)', 'refs/vgdd/held/').stdout.split('\n').filter((t) => TASK_RE.test(t));
const held = heldRefs.sort().map((task) => ({ task, since: lastTs((e) => e.type === 'held' && e.task === task) }));

// 裁定・取り消し（理由の本文は出さない）
const rulingsLog = lines(path.join(EV, 'rulings.jsonl'));
const rulings = { count: rulingsLog.length, tasks: uniq(rulingsLog.map((r) => r.task).filter((t) => TASK_RE.test(t || ''))) };
const annulments = { count: lines(path.join(EV, 'annulments.jsonl')).length };

// 判定：ファイル名で分類し、票ごと・司法ごとに最新の結論だけ（findings は出さない。SKIPPED などは null）
const VF = /^(T-\d{3,4})-[0-9a-f]{7,40}(?:-stub)?(-codex-(judge|security))?\.json$/;
const by_task = {}; let vcount = 0;
let vfiles = []; try { vfiles = fs.readdirSync(path.join(EV, 'verdicts')); } catch { /* なし */ }
for (const f of vfiles) {
  const m = f.match(VF); if (!m) continue;
  vcount += 1;
  const kind = m[3] === 'judge' ? 'codex' : m[3] === 'security' ? 'security' : 'judge';
  const full = path.join(EV, 'verdicts', f);
  let v = null; try { v = JSON.parse(fs.readFileSync(full, 'utf8')).final_verdict; } catch { /* 壊れた記録 */ }
  const mtime = fs.statSync(full).mtimeMs;
  const t = (by_task[m[1]] ??= { judge: null, codex: null, security: null, at: null, _m: {} });
  if ((t._m[kind] ?? -1) < mtime) { t._m[kind] = mtime; t[kind] = v === 'APPROVED' || v === 'CHANGES_REQUIRED' ? v : null; }
  if (!t.at || mtime > Date.parse(t.at)) t.at = jst(mtime);
}
for (const t of Object.values(by_task)) delete t._m;

const dis = events.filter((e) => e.type === 'disagreement');
const disagreements = { count: dis.length, tasks: uniq(dis.map((e) => e.task).filter((t) => TASK_RE.test(t || ''))) };

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
  try { const s = JSON.parse(r.stdout); evidence = { records: Number(s.records) || 0, chain_ok: s.chain_ok === true, checkpoint_mismatches: mism, checkpoint_at: null, last_record_at: str(s.period?.last) }; } catch { evidence.chain_ok = false; }
}
evidence.checkpoint_at = str(lines(path.join(EV, 'checkpoints.jsonl')).pop()?.ts);

// 最後の適合性テスト（run.mjs --record がオーナーの権限で Z3 に残したもの）
const conf = lines(path.join(EV, 'conformance.jsonl')).pop();
const conformance = conf ? { passed: Number(conf.passed) || 0, total: Number(conf.total) || 0, impl: str(conf.impl), kernel_version: str(conf.kernel_version), at: str(conf.at) } : null;

const state = { schema: 'vgdd.kernel-state.v1', generated_at: null, kernel_version, policy_version, stopped, judiciary, approvals, held, rulings, annulments, verdicts: { count: vcount, by_task }, disagreements, evidence, conformance };

try {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  state.generated_at = jst(Date.now());
  const tmp = `${OUT}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmp, OUT);
} catch (e) { console.error(`書き出しに失敗：${e.code || e.message}`); process.exit(1); }
