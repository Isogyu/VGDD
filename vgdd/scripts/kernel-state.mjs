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
import crypto from 'node:crypto';
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
const ver = (v) => (typeof v === 'string' && v.length <= 40 && VER_RE.test(v) ? v : null);   // 法律・フックの版
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

// p0.4.4：不変条件（INV-01〜12）と承認待ちの票は、別のファイル kernel-invariants.json に書く（vgdd.kernel-invariants.v1）。
//   kernel-state.json の形（v1）は変えない（Kernel の区画 T-022 は strict で検証するので、項目を足すと全体が捨てられる）
//   自由な文（不変条件や票の題名）は出さない。ID・状態・件数・真偽だけ（Codex の監査 p0.4.4 #3。題名は画面が固定の文で持つ）
const INV_STATUS = new Set(['enforced', 'partial', 'not_applicable']);
let capsInv = []; try { capsInv = JSON.parse(capsSrc.stdout).invariants || []; } catch { /* なし */ }
// 不変条件ごとの結果は、今の法律の版を稼働中の実装（z3）で試した記録のときだけ使う（別の版・原本の結果を今の検証済みに見せない。#7）
const implSha = (() => {   // run.mjs --record と同じ並びで、稼働中の Z3 の実装の指紋を作る（照合にだけ使い、出さない）
  const files = ['gate-runner.sh', 'judge.sh', 'judge-codex.sh', 'release.sh', 'spec-digest.mjs', 'kernel-state.mjs', 'sandboxed-run.sh', 'ledger.mjs', 'metered.sh', 'budget-set.sh', 'night-runner.sh', 'review-constitution.sh', 'approve-spec.sh', 'kernel-stop.sh', 'kernel-resume.sh', 'launcher.sh', 'prior-record.mjs', 'launch-intake.mjs', 'owner-console.mjs'].map((f) => path.join(Z3, 'bin', f)).concat([path.join(Z3, 'hooks/policy.mjs'), path.join(Z3, 'hooks/verify-chain.mjs')]);
  return crypto.createHash('sha256').update(files.map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return '<なし>'; } }).join('\n--\n'), 'utf8').digest('hex');
})();
const confCurrent = !!conf && conf.impl === 'z3' && ver(conf.kernel_version) !== null && conf.kernel_version === kernel_version && conf.impl_sha256 === implSha;
const invariants = capsInv.filter((i) => /^INV-\d{2}$/.test(i.id || '') && INV_STATUS.has(i.status)).slice(0, 50).map((i) => {
  const r = confCurrent ? conf.invariants?.[i.id] : undefined;
  return { id: i.id, status: i.status, tests: Array.isArray(i.tests) ? cnt(i.tests.length) : 0, verified: r === 'pass' ? true : r === 'fail' ? false : null };
});
const verified_by = confCurrent ? { kernel_version: ver(conf.kernel_version), impl: 'z3', at: str(conf.at) } : null;
// 承認待ち（ADR-039 の最小形）：main の票のうち status が ready・in_progress・review・blocked で、今の仕様と法律の系統の承認がないもの
//   （未承認の申請を裁判所が blocked にした票も残す。#4）
const pending_approvals = [];
for (const rel of tree.filter((f) => /^docs\/tasks\/T-\d{3,4}-[^/]*\.md$/.test(f))) {
  const body = git('show', `main:${rel}`).stdout || '';
  const fm = (body.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
  const get = (k) => ((fm.match(new RegExp(`^${k}: *(.*)$`, 'm')) || [])[1] || '').replace(/ *#.*$/, '').trim();
  if (!['ready', 'in_progress', 'review', 'blocked'].includes(get('status'))) continue;
  const task = get('id'); if (!TASK_RE.test(task)) continue;
  const ok = digestBin && spawnSync('node', [digestBin, '--repo', REPO, '--ref', 'main', '--ticket', rel, '--check', path.join(EV, 'spec_approvals.jsonl')], { encoding: 'utf8' }).status === 0;
  if (!ok) pending_approvals.push({ task, status: get('status') });
  if (pending_approvals.length >= MAX_ITEMS) break;
}
const invState = { schema: 'vgdd.kernel-invariants.v1', generated_at: null, kernel_version, verified_by, invariants, pending_approvals };

// p0.4.11（L3 の一部、D-66・D-67、T-042 の形）：予算の台帳の集計（budget・runs）を写しに足す。数と期間の名前と終わりの時刻だけで、
//   実行の ID・票ごとの内訳・pid・理由は出さない。台帳は同じ場所（Z3 の bin）の ledger.mjs で読む（表示用。判断の根拠にしない）。
//   台帳・上限が読めない、形が合わない数があれば、その項目を**出さない**（0 を作り足さない）。受け入れ（acceptance）は p0.4.12 から下で出す。
//   台帳の実行の状態との対応：reserved＝予約して起動の前（launching）、started＝起動して生きている、exited・settled＝終了と精算の記録がある
//   （この台帳では終了の記録が精算を兼ねる）、liveness_unknown＝起動の後に終了の記録がないまま子がいない、usage_unknown＝利用量を読めず予約の全量で数えた。
//   attempts は今の期間の作業員の試行の数（取り消しを除く）。上限は票ごと（attempts_per_ticket）なので、全体の上限は null。
//   台帳のロックを周回ごとに1回、読み取りの間だけ取る（起動・精算の begin・finish と同じロック。待ちの上限は ledger.mjs の withLock）
const SAFE = (n) => Number.isInteger(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
const LIM = (n) => (n === null || SAFE(n));
// 終わりの時刻は画面の検証（T-042）と同じ形と暦の検証（Codex の監査 major 1：2月30日・24時などを出すと画面が写し全体を拒む）
const UNTIL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const untilValid = (v) => {
  if (typeof v !== 'string' || v.length > 40) return false;
  const m = UNTIL_RE.exec(v); if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
  if (mo < 1 || mo > 12) return false;
  const last = new Date(0); last.setUTCFullYear(y, mo, 0);
  if (d < 1 || d > last.getUTCDate() || h > 23 || mi > 59 || se > 59) return false;
  if (m[7] !== undefined && (Number(m[8]) > 23 || Number(m[9]) > 59)) return false;
  return !Number.isNaN(Date.parse(v));
};
let budget; let runs;
try {
  const ledgerFile = path.join(HERE, 'ledger.mjs');
  if (fs.existsSync(ledgerFile)) {
    process.env.VGDD_Z3_DIR = Z3;   // ledger.mjs は読み込みの時点で Z3 の場所を決める
    const L = await import(ledgerFile);
    // 予算と実行の件数は、台帳の同じ読み取り（ロックの下で1回）から作る（Codex の監査 major 2：別の時点の集計を混ぜない）
    const { limits, runs: allRuns } = L.snapshot();
    const pid = limits?.period_id ?? null;
    const s = L.summarize(allRuns, limits);
    const all = allRuns.filter((r) => r.period === pid);
    const n = (pred) => all.filter(pred).length;
    // 作業員の数は今の期間の実行だけ（Codex の監査 major 3。T-042 は集計の対象を period_id の期間と決めている）。
    //   起動の判断（ledger.mjs の summarize）は、期間をまたいで動いている作業員も数える（ここは表示だけ）
    const workersActive = n((r) => r.kind === 'worker' && (r.state === 'launching' || r.state === 'started'));
    const b = { period_id: pid, until: limits?.until ?? null,
      tokens: { settled: s.settled, reserved: s.reserved, unknown_runs: s.unknown_runs, limit: limits?.tokens_total ?? null },
      judge_calls: { used: s.judge_used, limit: limits?.judge_calls ?? null },
      attempts: { used: n((r) => r.kind === 'worker' && r.state !== 'cancelled'), limit: null },
      workers: { active: workersActive, limit: limits?.workers ?? null } };
    const okB = typeof pid === 'string' && pid.length >= 1 && pid.length <= 40 && (b.until === null || untilValid(b.until))
      && [b.tokens.settled, b.tokens.reserved, b.tokens.unknown_runs, b.judge_calls.used, b.attempts.used, b.workers.active].every(SAFE)
      && [b.tokens.limit, b.judge_calls.limit, b.workers.limit].every(LIM);
    const fin = n((r) => r.state === 'finished');
    const r = { requested: all.length, reserved: n((x) => x.state === 'launching'), started: n((x) => x.state === 'started'), exited: fin, settled: fin,
      cancelled: n((x) => x.state === 'cancelled'), liveness_unknown: n((x) => x.state === 'ended_unrecorded'), usage_unknown: s.unknown_runs };
    if (okB) { budget = b; if (Object.values(r).every(SAFE)) runs = r; }
  }
} catch { budget = undefined; runs = undefined; }   // 台帳の破損・ロックの取り残し・上限なし：出さない

// p0.4.12（D-68）：受け入れ（acceptance）。オーナーの操作の窓口（owner-console.mjs）が Z3 の evidence/acceptance.jsonl に記録した、
//   票の ID と統合のコミット。数え始めの時刻（console/acceptance_since）より後に裁判所の名で統合した票だけを対象にし、
//   最新の統合のコミットに受け入れがあれば accepted、なければ pending。写しに出すのは票の ID と件数だけ（SHA は出さない）。
//   数え始めの時刻がなければ（窓口を一度も起動していない）出さない
let acceptance;
try {
  const sinceTxt = fs.readFileSync(path.join(Z3, 'console/acceptance_since'), 'utf8').trim();
  const since = /^\d{1,12}$/.test(sinceTxt) ? Number(sinceTxt) : NaN;
  if (Number.isSafeInteger(since)) {
    const merges = new Map();   // 票 → 最新の統合 { sha, at }
    for (const line of (git('log', 'main', '--format=%H%x09%an%x09%ct%x09%s').stdout || '').split('\n')) {
      const [sha, an, ct, subj] = line.split('\t');
      const m = (subj || '').match(/^gate-runner: (T-\d{3,4}) を統合/);
      if (an === 'gate-runner' && m && /^[0-9a-f]{40}$/.test(sha || '') && !merges.has(m[1])) merges.set(m[1], { sha, at: Number(ct) });
    }
    const acc = new Map();
    for (const a of lines(path.join(EV, 'acceptance.jsonl'))) if (TASK_RE.test(a.task) && /^[0-9a-f]{40}$/.test(a.merge || '')) acc.set(a.task, a.merge);
    const accepted = []; const pending = [];
    for (const [task, m] of [...merges.entries()].sort()) {
      if (!(m.at >= since)) continue;
      if (acc.get(task) === m.sha) accepted.push(task); else pending.push(task);
    }
    acceptance = { accepted_count: accepted.length, pending_count: pending.length, accepted: accepted.slice(-500), pending: pending.slice(-500) };
  }
} catch { acceptance = undefined; }

const state = { schema: 'vgdd.kernel-state.v1', generated_at: null, kernel_version, policy_version, stopped, judiciary, approvals, held, rulings, annulments, verdicts: { count: cnt(vcount), by_task: Object.fromEntries(Object.entries(by_task).sort().slice(-MAX_ITEMS)) }, disagreements, evidence, conformance, ...(budget ? { budget } : {}), ...(runs ? { runs } : {}), ...(acceptance ? { acceptance } : {}) };

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
  state.generated_at = invState.generated_at = jst(Date.now());
  const put = (obj, out) => {
    const tdir = fs.mkdtempSync(path.join(dir, `.${path.basename(out)}.tmp-`));
    const tmp = path.join(tdir, path.basename(out));
    try {
      fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { flag: 'wx', mode: 0o644 });
      fs.renameSync(tmp, out);
    } finally { fs.rmSync(tdir, { recursive: true, force: true }); }
  };
  put(state, OUT);
  put(invState, path.join(dir, 'kernel-invariants.json'));
} catch (e) { console.error(`書き出しに失敗：${e.code || e.message}`); process.exit(1); }
