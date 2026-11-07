#!/usr/bin/env node
// VGDD Governance Kernel — 適合性テスト（判例集。ADR-012・ADR-025、成立条件①〜⑤）
//
// Kernel の実装（フック・裁判所・承認・停止・証拠ストア）が、規範（vgdd/kernel/SPEC.md・capabilities.json）どおりに
// 「止めるべきものを止め、通すべきものを通す」ことを、使い捨ての写しのリポジトリと偽の Z3 の上で実際に動かして確かめる。
// 本物の Z3・main には触れない。LLM は呼ばない（司法は代わりのスクリプト。判定の中身ではなく、判定の扱いを試す）。
//
// 使い方（オーナーか立法補佐が sandbox の外で実行する。依存なし、Node 22 以上）:
//   node vgdd/conformance/run.mjs                 … リポジトリの原本（vgdd/）を試す
//   node vgdd/conformance/run.mjs --impl z3       … 実際に動いている Z3 の写し（~/tsubuyaki-z3/hooks・bin）を試す
//   node vgdd/conformance/run.mjs --impl z3 --record … 結果の1行を Z3 の evidence/conformance.jsonl に残す（p0.4.3。Kernel の状態の写しに出る。オーナーが実行）
//   node vgdd/conformance/run.mjs --json out.json … 結果を JSON にも書く
//   node vgdd/conformance/run.mjs --observe <repo> … 加えて、実際のリポジトリの票の status の変更を作者ごとに数える（観測。合否なし）
// 終了コード：0 ＝ すべて合格、1 ＝ 不合格あり、2 ＝ 試験の準備に失敗
//
// 試験の群：
//   C1 役割分離と権限（capabilities.json の probes を役割ごとにフックへ入力し、expect と比べる）       … 成立条件①④
//   C2 仕様の統治（仕様の指紋が統治の項目・受け入れ条件の変更で変わり、運用の項目では変わらない。承認の照合） … 成立条件②
//   C3 独立司法（司法の入力に行政の説明が入らない、main の §2 だけを使う、司法がツールを持たない）           … 成立条件③
//   G  裁判所の場面（本物の gate-runner に代わりの司法をつなぎ、承認・判定・停止・保護パスの組み合わせで動かす） … 成立条件②④
//   K  停止と再開（STOP 中のフック、再開の前の安全確認）                                                   … ADR-010・ADR-027
//   A  証跡（全判定の記録、スキーマ、改ざん・切り詰めの検出）                                               … 成立条件⑤
//   B  予算の台帳（予約・精算・不明の扱い・同時の予約・重複・停止・期間・破損・超過。p0.4.9）               … SPEC §9

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i === -1 ? null : args[i + 1]; };
const impl = opt('--impl') || 'repo';
const VG = path.resolve(HERE, '..');
// p0.4.8：--impl z3 で試す写しの場所も、--record の書き先と同じく VGDD_Z3_DIR を優先する（既定と違う場所の導入で、別の写しを試さない）
const Z3REAL = process.env.VGDD_Z3_DIR || path.join(os.homedir(), 'tsubuyaki-z3');
// p0.4.8：配置済みの定義と設定を読むリポジトリを1か所で決める（--repo、なければ z3 では既定の本番の場所、repo では原本のリポジトリ）
const DEPLOYED_REPO = opt('--repo') || (impl === 'z3' ? path.join(os.homedir(), 'tsubuyaki-worklog/app') : path.resolve(VG, '..'));
const IMPL = impl === 'z3'
  ? { policy: path.join(Z3REAL, 'hooks/policy.mjs'), verify: path.join(Z3REAL, 'hooks/verify-chain.mjs'), bin: path.join(Z3REAL, 'bin'),
      agents: path.join(DEPLOYED_REPO, '.claude/agents') } // 起動で実際に使う定義
  : { policy: path.join(VG, 'hooks/policy.mjs'), verify: path.join(VG, 'hooks/verify-chain.mjs'), bin: path.join(VG, 'scripts'), agents: path.join(VG, 'agents') };
// p0.4.8：試す実装の場所だけを出して終わる（ST17 が使う。中身は場所だけ）
if (args.includes('--print-impl')) { console.log(JSON.stringify({ impl, ...IMPL })); process.exit(0); }
const CAPS = JSON.parse(fs.readFileSync(path.join(VG, 'kernel/capabilities.json'), 'utf8'));
const DECISION_SCHEMA = JSON.parse(fs.readFileSync(path.join(VG, 'schemas/kernel-decision.schema.json'), 'utf8'));
const UTF8 = { LC_ALL: 'ja_JP.UTF-8', LANG: 'ja_JP.UTF-8' }; // OBS-043：本番と同じロケールで動かす

const results = [];
function record(group, id, title, ok, detail = '', key = null) {
  results.push({ group, id, title, ok, detail, key });   // key：C1 の「役割#probe の番号」（不変条件の自己検査が期待の組み合わせと照合する）
  console.log(`${ok ? '✓' : '✗'} ${group} ${id} ${title}${detail ? `  — ${detail}` : ''}`);
}

// ---- 道具 -------------------------------------------------------------------------------
const sh = (cmd, argv, o = {}) => spawnSync(cmd, argv, { encoding: 'utf8', ...o });
const git = (cwd, ...a) => {
  const r = sh('git', ['-c', 'core.hooksPath=/dev/null', ...a], { cwd });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')} @${cwd}: ${r.stderr}`);
  return r.stdout.trim();
};
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const touch = (p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, ''); };

const TICKET = (id, { section2 = '- A1. `src/lib/a.ts` の `v` が 2 になる', files = ['src/lib/a.ts'], status = 'review', source = 'ticket', reqs = '[A1]', log = '', security = null } = {}) => `---
id: ${id}
title: 適合性テストの票
status: ${status}
requirements: ${reqs}
requirements_source: ${source}${security === null ? '' : `\nsecurity_review: ${security}`}
unattended: true
branch: task/${id}
worker: null
files_allowed:
${files.map((f) => `  - ${f}`).join('\n')}
files_forbidden:
  - vgdd/**
depends_on: []
---

## 1. 目的

試験。

## 2. 受け入れ条件

${section2}

## 4. 手順の案

行政の長の設計メモ NARRATIVE-PLAN-2b9

## 6. 記録
${log}
`;

/** 写しのリポジトリ（main の checkout と作業員の worktree）と偽の Z3 を作る */
function fixture(name) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `vgdd-conf-${name}-`)));
  const main = path.join(base, 'app');
  const z3 = path.join(base, 'tsubuyaki-z3'); // 名前も本番と同じにする（フックの Bash の照合は名前で Z3 を見る）
  fs.mkdirSync(path.join(z3, 'evidence/verdicts'), { recursive: true });
  fs.mkdirSync(path.join(z3, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(z3, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(base, 'preparation'), { recursive: true });
  fs.mkdirSync(main, { recursive: true });
  git(main, 'init', '-q', '-b', 'main');
  git(main, 'config', 'user.name', 'owner'); git(main, 'config', 'user.email', 'owner@example.invalid');
  write(path.join(main, 'src/lib/a.ts'), 'export const v = 1;\n');
  write(path.join(main, 'docs/requirements.md'), '| M1-1 | 試験の要件 | 確かめ方 |\n');
  write(path.join(main, 'docs/tasks/T-900-probe.md'), TICKET('T-900'));
  write(path.join(main, 'CLAUDE.md'), '# 憲法（試験用）\n');
  write(path.join(main, 'vgdd/README.md'), '法律（試験用）\n');
  write(path.join(main, '.claude/settings.json'), '{}\n');
  write(path.join(main, '.gitignore'), 'merge-requests/\n.claude/worktrees/\ndocs/governance/kernel-state.json*\ndocs/governance/kernel-invariants.json*\n');
  git(main, 'add', '-A'); git(main, 'commit', '-q', '-m', 'init');
  fs.mkdirSync(path.join(main, 'merge-requests/done'), { recursive: true });
  const wt = path.join(main, '.claude/worktrees/w1');
  git(main, 'worktree', 'add', '-q', '-b', 'night/T-900', wt);
  const baseline = sha256hex(fs.readFileSync(path.join(main, '.git/config')));
  write(path.join(z3, 'evidence/git-config.baseline'), baseline + '\n');
  // p0.4.9：偽の Z3 にも予算の上限を置く（十分に大きな値。予算の試験は群 B が自分の値で行う）。本物の Z3 の台帳には触れない
  write(path.join(z3, 'budget/limits.json'), JSON.stringify(LIMITS_WIDE) + '\n');
  return { base, main, wt, z3, evidence: path.join(z3, 'evidence/tool_calls.jsonl') };
}

const LIMITS_WIDE = { schema: 'vgdd.budget-limits.v1', period_id: 'conformance', until: '2099-01-01T00:00:00+09:00', tokens_total: 1e12, tokens_per_ticket: 1e12, tokens_per_run: 1e6, judge_calls: 1e6, workers: 100, attempts_per_ticket: 100, set_at: '2026-11-08T00:00:00+09:00' };

let seq = 0;
/** フックに1回入力する。返り値 { decision, reason, code } */
function hook(fx, { tool, input, agent_type = null, cwd }) {
  const payload = { hook_event_name: 'PreToolUse', session_id: 'conformance', tool_use_id: `toolu_conf_${++seq}`, tool_name: tool, tool_input: input, cwd, agent_type };
  const r = sh('node', [IMPL.policy], { input: JSON.stringify(payload), env: { ...process.env, VGDD_Z3_DIR: fx.z3, VGDD_EVIDENCE_PATH: fx.evidence, CLAUDE_PROJECT_DIR: fx.main } });
  const decision = r.status === 0 ? 'allow' : r.status === 2 ? 'deny' : `error(${r.status})`;
  return { decision, reason: (r.stderr || '').trim().slice(0, 160), code: r.status };
}

function expand(s, fx, self) {
  return s.replaceAll('{self}', self).replaceAll('{main}', fx.main).replaceAll('{wt}', fx.wt).replaceAll('{z3}', fx.z3);
}
function probeInput(p, fx, self) {
  const o = {};
  for (const [k, v] of Object.entries(p)) if (!['tool', 'expect', 'cwd', 'branch'].includes(k)) o[k] = typeof v === 'string' ? expand(v, fx, self) : v;
  if (p.tool === 'Write' && o.content === undefined) o.content = 'x';
  if (p.tool === 'Edit' && o.old_string === undefined) { o.old_string = 'a'; o.new_string = 'b'; }
  return o;
}

// ---- C1 役割分離と権限 ------------------------------------------------------------------
function groupC1(fx) {
  let probes = 0;
  for (const cap of CAPS.capabilities) {
    if (!cap.probes) continue;
    for (const [role, exp] of Object.entries(cap.expect || {})) {
      const r0 = CAPS.roles[role];
      if (!r0?.hook_input) continue;
      const self = r0.hook_input.cwd === '{main}' ? fx.main : fx.wt;
      for (const [pi, p] of cap.probes.entries()) {
        const want = p.expect?.[role] ?? exp;
        const cwd = p.cwd ? expand(p.cwd, fx, self) : self;
        const input = probeInput(p, fx, self);
        const got = hook(fx, { tool: p.tool, input, agent_type: r0.hook_input.agent_type, cwd });
        probes++;
        const label = p.tool === 'Bash' ? input.command : `${p.tool} ${(input.file_path || input.path || '').replace(fx.base, '…')}`;
        record('C1', cap.id, `${role}: ${label.replace(fx.base, '…')} → ${want}`, got.decision === want, got.decision === want ? '' : `実際は ${got.decision}：${got.reason}`, `${role}#${pi}`);
      }
    }
  }
  return probes;
}

// ---- C2 仕様の統治 ------------------------------------------------------------------------
function digest(fx, ref, ticket, extra = []) {
  const r = sh('node', [path.join(IMPL.bin, 'spec-digest.mjs'), '--repo', fx.main, '--ref', ref, '--ticket', ticket, ...extra]);
  return { out: r.stdout.trim(), code: r.status };
}
function commitTicket(fx, id, opts) {
  write(path.join(fx.main, `docs/tasks/${id}-probe.md`), TICKET(id, opts));
  git(fx.main, 'add', '-A'); git(fx.main, 'commit', '-q', '-m', `${id} 更新`);
  return git(fx.main, 'rev-parse', 'HEAD');
}
function groupC2() {
  const fx = fixture('c2');
  const tk = 'docs/tasks/T-910-probe.md';
  const r0 = commitTicket(fx, 'T-910', {});
  const d0 = digest(fx, r0, tk).out;
  record('C2', 'S1', '仕様の指紋が取れる（sha256）', /^sha256:[0-9a-f]{64}$/.test(d0), d0);
  const r1 = commitTicket(fx, 'T-910', { status: 'in_progress', log: '- 作業員の報告：完了しました NARRATIVE-REPORT-9c1' });
  record('C2', 'S2', 'status と §6 の記録を変えても指紋は変わらない（運用の項目は仕様ではない）', digest(fx, r1, tk).out === d0);
  const r2 = commitTicket(fx, 'T-910', { section2: '- A1. `src/lib/a.ts` の `v` が 3 になる' });
  const okd = (x) => x.code === 0 && /^sha256:[0-9a-f]{64}$/.test(x.out);
  const x2 = digest(fx, r2, tk);
  record('C2', 'S3', '受け入れ条件（§2）を1文字変えると指紋が変わる', okd(x2) && x2.out !== d0);
  const r3 = commitTicket(fx, 'T-910', { files: ['src/lib/a.ts', 'src/lib/b.ts'] });
  const x3 = digest(fx, r3, tk);
  record('C2', 'S4', 'files_allowed を広げると指紋が変わる（作業員の権限は仕様の一部）', okd(x3) && x3.out !== d0);
  // 重複キー：front matter の後ろに2つ目の files_allowed の塊を足す（裁判所の awk は同じキーの塊をすべて足して読む）
  const tp = path.join(fx.main, 'docs/tasks/T-910-probe.md');
  commitTicket(fx, 'T-910', {});
  fs.writeFileSync(tp, fs.readFileSync(tp, 'utf8').replace('depends_on: []', 'depends_on: []\nfiles_allowed:\n  - src/**'));
  git(fx.main, 'add', '-A'); git(fx.main, 'commit', '-q', '-m', '重複キー');
  const x11 = digest(fx, 'HEAD', tk);
  record('C2', 'S11', 'front matter に2つ目の files_allowed の塊を足すと指紋が変わる（重複キーで範囲を広げられない）', okd(x11) && x11.out !== d0);
  // Codex の再現例：リストの途中のコメントの後ろに項目を足す、カンマを含む1項目と2項目
  commitTicket(fx, 'T-910', {});
  const base12 = digest(fx, 'HEAD', tk);
  fs.writeFileSync(tp, fs.readFileSync(tp, 'utf8').replace('  - src/lib/a.ts', '  - src/lib/a.ts\n  # 補足\n  - src/lib/b.ts'));
  git(fx.main, 'add', '-A'); git(fx.main, 'commit', '-q', '-m', 'コメントの後ろ');
  const x12 = digest(fx, 'HEAD', tk);
  record('C2', 'S12', 'リストの途中のコメントの後ろに項目を足すと指紋が変わる', okd(x12) && x12.out !== base12.out);
  const t13a = commitTicket(fx, 'T-910', { files: ['src/lib/a.ts,src/lib/b.ts'] });
  const t13b = commitTicket(fx, 'T-910', { files: ['src/lib/a.ts', 'src/lib/b.ts'] });
  const ya = digest(fx, t13a, tk), yb = digest(fx, t13b, tk);
  record('C2', 'S13', 'カンマを含む1項目と、2項目の並びは別の指紋になる（符号化の衝突がない）', okd(ya) && okd(yb) && ya.out !== yb.out);
  const r4 = commitTicket(fx, 'T-910', { source: 'docs/requirements.md', reqs: '[M1-1]' });
  const d4 = digest(fx, r4, tk).out;
  write(path.join(fx.main, 'docs/requirements.md'), '| M1-1 | 試験の要件（書き換え） | 確かめ方 |\n');
  git(fx.main, 'add', '-A'); git(fx.main, 'commit', '-q', '-m', 'requirements 変更');
  const x5 = digest(fx, 'HEAD', tk);
  record('C2', 'S5', 'requirements.md の該当の行を変えると、それを使う票の指紋が変わる', okd(x5) && x5.out !== d4);
  const ledger = path.join(fx.z3, 'evidence/spec_approvals.jsonl');
  const head = git(fx.main, 'rev-parse', 'HEAD');
  const dh = digest(fx, head, tk).out;
  record('C2', 'S6', '承認の記録がなければ照合は不合格（exit 3）', digest(fx, head, tk, ['--check', ledger]).code === 3);
  write(ledger, JSON.stringify({ task: 'T-910', digest: dh, approved_by: 'worker' }) + '\n');
  record('C2', 'S7', 'approved_by が owner でない記録は承認として数えない', digest(fx, head, tk, ['--check', ledger]).code === 3);
  fs.appendFileSync(ledger, JSON.stringify({ task: 'T-910', digest: d0, approved_by: 'owner' }) + '\n');
  record('C2', 'S8', '古い仕様への承認は、変わった仕様には効かない', digest(fx, head, tk, ['--check', ledger]).code === 3);
  fs.appendFileSync(ledger, JSON.stringify({ task: 'T-910', digest: dh, approved_by: 'owner' }) + '\n');
  record('C2', 'S9', '今の仕様の指紋へのオーナーの承認があれば合格（exit 0）', digest(fx, head, tk, ['--check', ledger]).code === 0);
  record('C2', 'S10', '票が ref にないときは exit 66（fail-closed）', digest(fx, head, 'docs/tasks/T-999-none.md').code === 66);

  // オーナーの承認の手続き（approve-spec.sh）を実際に動かす
  const fx2 = fixture('c2b');
  commitTicket(fx2, 'T-911', {});
  const env = { ...process.env, ...UTF8, VGDD_Z3_DIR: fx2.z3, VGDD_REPO: fx2.main };
  const ledger2 = path.join(fx2.z3, 'evidence/spec_approvals.jsonl');
  const ap = (...a) => sh('bash', [path.join(IMPL.bin, 'approve-spec.sh'), 'T-911', ...a], { env, input: 'n\n' });
  let r = ap();
  record('C2', 'P1', 'approve-spec.sh は仕様を表示し、オーナーが y と答えなければ記録しない', r.status === 1 && /受け入れ条件/.test(r.stdout) && !fs.existsSync(ledger2), `exit ${r.status}`);
  write(path.join(fx2.z3, 'STOP'), '試験\n');
  r = ap('--yes');
  record('C2', 'P2', 'Kernel の停止中は承認しない', r.status === 70 && !fs.existsSync(ledger2), `exit ${r.status}`);
  fs.renameSync(path.join(fx2.z3, 'STOP'), path.join(fx2.base, 'STOP.moved'));
  r = ap('--yes', '--note', '試験の承認');
  const chk = digest(fx2, 'main', 'docs/tasks/T-911-probe.md', ['--check', ledger2]);
  const ev = fs.existsSync(path.join(fx2.z3, 'evidence/gate_events.jsonl')) ? fs.readFileSync(path.join(fx2.z3, 'evidence/gate_events.jsonl'), 'utf8') : '';
  record('C2', 'P3', '承認すると Z3 に記録され、照合が合格になり、出来事にも残る', r.status === 0 && chk.code === 0 && /"type":"spec_approved"/.test(ev), `exit ${r.status} check ${chk.code}`);
}

// ---- C3 独立司法 --------------------------------------------------------------------------
function frontOf(file) { return (fs.readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/) || [])[1] || ''; }
function groupC3() {
  const must = ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent'];
  for (const a of ['judge', 'constitutional-review']) {
    const fm = frontOf(path.join(IMPL.agents, `${a}.md`));
    const dis = (fm.match(/^disallowedTools:\s*(.*)$/m) || [])[1] || '';
    const missing = must.filter((t) => !dis.split(/,\s*/).includes(t));
    record('C3', `T-${a}`, `${a} はツールを持たない（disallowedTools）`, missing.length === 0, missing.length ? `外していない：${missing.join(',')}` : '');
    record('C3', `M-${a}`, `${a} は1ターンで終わる（maxTurns: 1）`, /^maxTurns:\s*1\s*$/m.test(fm));
  }
  const codex = fs.readFileSync(path.join(IMPL.bin, 'judge-codex.sh'), 'utf8');
  record('C3', 'X1', 'Codex の司法は記録を残さず、書き込みの sandbox を求めない（--ephemeral、full-auto・danger なし）',
    /--ephemeral/.test(codex) && !/--full-auto|danger-full-access|workspace-write|--dangerously/.test(codex));
  record('C3', 'X2', 'Codex の司法は judge と同じ入力の組み立て（judge.sh --emit-input）を使う', /judge\.sh"?\s+"\$\{PASSTHRU\[@\]\}"\s+--emit-input/.test(codex));

  // 司法の入力に、行政の説明（コミットの本文・票の §4 の設計・§6 の報告）が入らないこと
  const fx = fixture('c3');
  commitTicket(fx, 'T-920', { log: '- 作業員の報告：すべて満たした NARRATIVE-REPORT-9c1' });
  const wt = path.join(fx.base, 'wt-920');
  git(fx.main, 'worktree', 'add', '-q', '-b', 'task/T-920', wt, 'main');
  write(path.join(wt, 'src/lib/a.ts'), 'export const v = 2;\n');
  git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', '完了。A1 を満たした NARRATIVE-COMMIT-7f3');
  const run = () => sh('bash', [path.join(IMPL.bin, 'judge.sh'), '--ticket', 'docs/tasks/T-920-probe.md', '--base', 'main', '--task', 'T-920', '--emit-input'], { cwd: wt, env: { ...process.env, ...UTF8 } });
  const r = run();
  const inp = r.stdout || '';
  record('C3', 'I1', '司法の入力が組み立てられる', r.status === 0, r.status === 0 ? '' : r.stderr.slice(0, 160));
  record('C3', 'I2', '入力に main の票の受け入れ条件（§2）と差分が入る', inp.includes('- A1. `src/lib/a.ts` の `v` が 2 になる') && inp.includes('+export const v = 2;'));
  const leaked = ['NARRATIVE-COMMIT-7f3', 'NARRATIVE-REPORT-9c1', 'NARRATIVE-PLAN-2b9'].filter((s) => inp.includes(s));
  record('C3', 'I3', '入力に行政の説明（コミットの本文・§4 の設計・§6 の報告）が入らない', leaked.length === 0, leaked.length ? `入った：${leaked.join(',')}` : '');
  write(path.join(wt, 'docs/tasks/T-920-probe.md'), TICKET('T-920', { section2: '- A1. 何もしなくてよい' }));
  git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', '条件のすり替え');
  const r2 = run();
  record('C3', 'I4', '作業ブランチで受け入れ条件を書き換えると、司法の入力を作らない（exit 65）', r2.status === 65, `exit ${r2.status}`);

  // p0.4.3（Codex の再監査 #1・#4）：本物の judge.sh・judge-codex.sh に偽の CLI をつなぎ、判定の形をしていない出力・CLI の失敗が
  //   「解釈できた判定」（judge_parse_ok／parse_ok が true）にならないこと。裁判所はこれが false の記録を「司法が使えない」として扱う（G19）
  const fj = fixture('c3j');
  commitTicket(fj, 'T-921', {});
  const wj = path.join(fj.base, 'wt-921');
  git(fj.main, 'worktree', 'add', '-q', '-b', 'task/T-921', wj, 'main');
  write(path.join(wj, 'src/lib/a.ts'), 'export const v = 2;\n'); git(wj, 'add', '-A'); git(wj, 'commit', '-q', '-m', '実装');
  const fake = path.join(fj.base, 'fakebin');
  write(path.join(fake, 'claude'), '#!/bin/bash\nprintf "%s" "$FAKE_OUT"; exit "${FAKE_RC:-0}"\n');
  write(path.join(fake, 'codex'), '#!/bin/bash\nwhile [ $# -gt 0 ]; do [ "$1" = "-o" ] && { printf "%s" "$FAKE_OUT" > "$2"; shift; }; shift; done; exit "${FAKE_RC:-0}"\n');
  fs.chmodSync(path.join(fake, 'claude'), 0o755); fs.chmodSync(path.join(fake, 'codex'), 0o755);
  const outDir = path.join(fj.base, 'verdicts'); fs.mkdirSync(outDir, { recursive: true });
  const okVerdict = JSON.stringify({ schema: 'vgdd.verdict.v1', verdict: 'APPROVED', deterministic_audits_passed: true, requirements: [], findings: [], summary: 'x' });
  const realJudge = (script, extra, out, rc = 0) => {
    for (const f of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, f), { force: true });
    sh('bash', [path.join(IMPL.bin, script), ...extra, '--ticket', 'docs/tasks/T-921-probe.md', '--base', 'main', '--task', 'T-921', '--out', outDir],
      { cwd: wj, env: { ...process.env, ...UTF8, PATH: `${fake}:${process.env.PATH}`, FAKE_OUT: out, FAKE_RC: String(rc), VGDD_AUDIT_WRAP: '', VGDD_Z3_DIR: fj.z3 }, timeout: 120000 }); // p0.4.9：台帳は偽の Z3 に書く（本物の Z3 に触れない）
    const f = fs.readdirSync(outDir).find((x) => x.endsWith('.json'));
    try { return JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')); } catch { return null; }
  };
  const wrap = (t) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: t }); // 本物の claude -p --output-format json の成功の形
  const cases = [
    ['J1', '空の JSON {}', wrap('{}'), 0],
    ['J2', 'エラーの JSON（{"error":"unauthorized"}）', wrap('{"error":"unauthorized"}'), 0],
    ['J3', '不正な verdict（INVALID）', wrap('{"verdict":"INVALID","findings":[]}'), 0],
    ['J4', 'findings が配列でない', wrap('{"verdict":"APPROVED","findings":"なし"}'), 0],
    ['J5', 'CLI が非0で終わる（中身は正しい判定）', wrap(okVerdict), 1],
    ['J6', 'CLI の応答が is_error', JSON.stringify({ type: 'result', is_error: true, result: okVerdict }), 0],
    // Codex の3回目の監査 #1：スキーマの必須の欠け・配列・末尾の壊れ・スキーマにない重さ
    ['J8', '必須の項目が欠けた判定（{"verdict":"APPROVED","findings":[]}）', wrap('{"verdict":"APPROVED","findings":[]}'), 0],
    ['J9', '正しい判定を1件含む配列', wrap(`[${okVerdict}]`), 0],
    ['J10', '正しい判定の末尾に壊れた文字', wrap(`${okVerdict} broken`), 0],
    // Codex の4回目の監査 #1：外側の応答がエラーの形なら、本文が正しくても成り立たない
    ['J13', '外側がエラーの形（type: error）で本文は正しい判定', JSON.stringify({ type: 'error', error: 'unauthorized', result: okVerdict }), 0],
    ['J14', '外側の is_error が文字列の "true"', JSON.stringify({ type: 'result', subtype: 'success', is_error: 'true', result: okVerdict }), 0],
    ['J15', '外側の subtype が error_max_turns', JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: false, result: okVerdict }), 0],
    ['J11', 'スキーマにない重さ（info）と理由の欠けた指摘', wrap(JSON.stringify({ ...JSON.parse(okVerdict), findings: [{ severity: 'info', category: 'test', file: null, line: null, requirement_id: null }] })), 0],
  ];
  for (const [id, label, out, rc] of cases) {
    const rec = realJudge('judge.sh', [], out, rc);
    record('C3', id, `本物の judge.sh：${label} は判定として成り立たない（judge_parse_ok: false）`, !!rec && rec.judge_parse_ok === false, rec ? `parse_ok=${rec.judge_parse_ok} final=${rec.final_verdict}` : '記録がない');
  }
  const good = realJudge('judge.sh', [], wrap(okVerdict), 0);
  record('C3', 'J7', '本物の judge.sh：形の正しい判定は成り立つ（judge_parse_ok: true。陽性の対照）', !!good && good.judge_parse_ok === true, good ? `final=${good.final_verdict}` : '記録がない');
  for (const [id, label, out, rc] of [['X3', '空の JSON {}', '{}', 0], ['X4', '不正な verdict', '{"verdict":"INVALID","findings":[]}', 0], ['X5', 'CLI が非0で終わる', okVerdict, 1],
    ['X7', '必須の項目が欠けた判定', '{"verdict":"APPROVED","findings":[]}', 0], ['X8', '正しい判定を1件含む配列', `[${okVerdict}]`, 0], ['X9', '正しい判定の末尾に壊れた文字', `${okVerdict} broken`, 0]]) {
    const rec = realJudge('judge-codex.sh', [], out, rc);
    record('C3', id, `本物の judge-codex.sh：${label} は判定として成り立たない（parse_ok: false）`, !!rec && rec.parse_ok === false, rec ? `parse_ok=${rec.parse_ok}` : '記録がない');
  }
  const fenced = realJudge('judge.sh', [], wrap('```json\n' + okVerdict + '\n```'), 0);
  record('C3', 'J12', '本物の judge.sh：全体を ```json で囲んだだけの正しい判定は成り立つ（陽性の対照）', !!fenced && fenced.judge_parse_ok === true, fenced ? '' : '記録がない');
  const goodC = realJudge('judge-codex.sh', [], okVerdict, 0);
  record('C3', 'X6', '本物の judge-codex.sh：形の正しい判定は成り立つ（陽性の対照）', !!goodC && goodC.parse_ok === true, goodC ? '' : '記録がない');
}

// ---- G 裁判所の場面 ---------------------------------------------------------------------------
// p0.4.3：代わりの司法も本物と同じく、判定のファイルを候補の HEAD の先頭12桁で名付ける（p0.4.2 までの実装は「最新のファイル」を読むので、どちらでも読める）。
//   --preflight には STUB_*_PREFLIGHT_FAIL がなければ 0 を返す。STUB_*_NOFILE があればファイルを書かずに終わる（司法が使えない場面）
const STUB_JUDGE = `#!/bin/bash
case " $* " in *" --preflight "*) [ -z "\${STUB_JUDGE_PREFLIGHT_FAIL:-}" ] || exit 69; exit 0;; esac
out=""; task=""; while [ $# -gt 0 ]; do case "$1" in --out) out="$2"; shift 2;; --task) task="$2"; shift 2;; *) shift;; esac; done
echo called >> "$out/../judge-called.log"
[ -z "\${STUB_JUDGE_NOFILE:-}" ] || exit 1
[ -z "\${STUB_JUDGE_RAW:-}" ] || { printf '%s' "$STUB_JUDGE_RAW" > "$out/$task-$(git rev-parse HEAD | cut -c1-12).json"; exit 0; }
printf '{"final_verdict":"%s","judge_parse_ok":true,"judge":{"findings":[]}}\\n' "\${STUB_VERDICT:-CHANGES_REQUIRED}" > "$out/$task-$(git rev-parse HEAD | cut -c1-12).json"
`;
const STUB_CODEX = `#!/bin/bash
case " $* " in *" --preflight "*) [ -z "\${STUB_CODEX_PREFLIGHT_FAIL:-}" ] || exit 69; exit 0;; esac
out=""; task=""; mode=judge; while [ $# -gt 0 ]; do case "$1" in --out) out="$2"; shift 2;; --task) task="$2"; shift 2;; --security) mode=security; shift;; *) shift;; esac; done
if [ "$mode" = security ]; then [ -z "\${STUB_SECURITY_NOFILE:-}" ] || exit 69; else [ -z "\${STUB_CODEX_NOFILE:-}" ] || exit 69; fi
printf '{"final_verdict":"%s","parse_ok":true,"codex":{"findings":[]}}\\n' "\${STUB_CODEX_VERDICT:-\${STUB_VERDICT:-CHANGES_REQUIRED}}" > "$out/$task-$(git rev-parse HEAD | cut -c1-12)-codex-$mode.json"
`;
// 実装の指紋（kernel-state.mjs の implSha と同じ並び）。run.mjs --record が残し、状態の写しが稼働中の Z3 と照合する
const IMPL_FILES = ['gate-runner.sh', 'judge.sh', 'judge-codex.sh', 'release.sh', 'spec-digest.mjs', 'kernel-state.mjs', 'sandboxed-run.sh', 'ledger.mjs', 'metered.sh', 'budget-set.sh', 'night-runner.sh', 'review-constitution.sh', 'approve-spec.sh', 'kernel-stop.sh', 'kernel-resume.sh'];
const implShaFor = (bin, policy) => sha256hex(IMPL_FILES.map((f) => path.join(bin, f)).concat([policy, path.join(path.dirname(policy), 'verify-chain.mjs')]).map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return '<なし>'; } }).join('\n--\n'));
const POLICY_LINE = (/^(p\d+\.\d+)\./.exec(CAPS.kernel_version) || [])[1] || null;
function gateFixture(name, { approve = true, change = { 'src/lib/a.ts': 'export const v = 2;\n' }, stop = false, afterApprove = null, ticket = {}, approveExtra = { policy_line: POLICY_LINE } } = {}) {
  const fx = fixture(name);
  const id = 'T-930';
  commitTicket(fx, id, ticket);
  const wt = path.join(fx.base, 'wt-930');
  git(fx.main, 'worktree', 'add', '-q', '-b', `task/${id}`, wt, 'main');
  for (const [f, s] of Object.entries(change)) write(path.join(wt, f), s);
  git(wt, 'add', '-A'); git(wt, 'add', '-f', '--', ...Object.keys(change)); git(wt, 'commit', '-q', '-m', '作業員の実装'); // -f：.gitignore の対象（状態の写し）を差分に入れる場面（ST7）
  const head = git(wt, 'rev-parse', 'HEAD');
  // 実装に spec-digest.mjs がなければ写さない（p0.4.0 より前の実装を試すと、承認の試験が不合格になる。それが正しい結果）
  if (fs.existsSync(path.join(IMPL.bin, 'spec-digest.mjs'))) fs.copyFileSync(path.join(IMPL.bin, 'spec-digest.mjs'), path.join(fx.z3, 'bin/spec-digest.mjs'));
  // p0.4.3：状態の書き出し（実装になければ写さない。p0.4.2 では ST が落ちる。それが正しい結果）
  if (fs.existsSync(path.join(IMPL.bin, 'kernel-state.mjs'))) fs.copyFileSync(path.join(IMPL.bin, 'kernel-state.mjs'), path.join(fx.z3, 'bin/kernel-state.mjs'));
  write(path.join(fx.z3, 'bin/judge.sh'), STUB_JUDGE); write(path.join(fx.z3, 'bin/judge-codex.sh'), STUB_CODEX);
  write(path.join(fx.z3, 'bin/sandboxed-run.sh'), '#!/bin/bash\n[ "$1" = "--preflight" ] || printf "%s\\n" "${VGDD_REPO:-}" >> "$(dirname "$0")/../sbx-repo.log"\nexit 0\n');
  for (const f of ['judge.sh', 'judge-codex.sh', 'sandboxed-run.sh']) fs.chmodSync(path.join(fx.z3, 'bin', f), 0o755);
  if (approve) {
    const d = digest(fx, 'main', `docs/tasks/${id}-probe.md`).out || 'sha256:unavailable';
    write(path.join(fx.z3, 'evidence/spec_approvals.jsonl'), JSON.stringify({ schema: 'vgdd.spec-approval.v1', task: id, digest: d, approved_by: 'owner', ...approveExtra }) + '\n');
  }
  if (afterApprove) afterApprove(fx, id);
  // 票を review にする（行政の長の申請の前の作業。§6 の記録は仕様ではない）
  const tp = path.join(fx.main, `docs/tasks/${id}-probe.md`);
  fs.writeFileSync(tp, fs.readFileSync(tp, 'utf8').replace(/^status: .*/m, 'status: review'));
  git(fx.main, 'add', '-A'); git(fx.main, 'commit', '-q', '--allow-empty', '-m', `${id} を review に`);
  write(path.join(fx.main, `merge-requests/${id}.json`), JSON.stringify({ task: id, branch: `task/${id}`, head }) + '\n');
  if (stop) write(path.join(fx.z3, 'STOP'), '試験の停止\n');
  return { ...fx, id, head, mainBefore: git(fx.main, 'rev-parse', 'main') };
}
function runGate(fx, verdict, extra = [], env = {}) {
  const r = sh('bash', [path.join(IMPL.bin, 'gate-runner.sh'), '--repo', fx.main, '--once', '--interval', '1', ...extra],
    { cwd: fx.main, env: { ...process.env, ...UTF8, VGDD_Z3_DIR: fx.z3, STUB_VERDICT: verdict, ...env }, timeout: 120000 });
  const evf = path.join(fx.z3, 'evidence/gate_events.jsonl');
  // 読めない行は飛ばす（G23g は壊れた行を置いて裁判所の fail-closed を試す）
  const events = fs.existsSync(evf) ? fs.readFileSync(evf, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : [];
  const inMain = sh('git', ['-C', fx.main, 'merge-base', '--is-ancestor', fx.head, 'main']).status === 0;
  const judged = fs.existsSync(path.join(fx.z3, 'evidence/judge-called.log'));
  const pending = fs.existsSync(path.join(fx.main, `merge-requests/${fx.id}.json`));
  const status = (fs.readFileSync(path.join(fx.main, `docs/tasks/${fx.id}-probe.md`), 'utf8').match(/^status: (.*)$/m) || [])[1];
  const ksf = path.join(fx.main, 'docs/governance/kernel-state.json');
  const kstate = fs.existsSync(ksf) ? fs.readFileSync(ksf, 'utf8') : null;
  return { code: r.status, out: (r.stdout + r.stderr).slice(-400), events, inMain, judged, pending, status, kstate };
}
function groupG() {
  let g = runGate(gateFixture('g1', { approve: false }), 'APPROVED');
  record('G', 'G1', '仕様が未承認なら、司法を呼ぶ前に blocked。司法が APPROVED でも main に入らない',
    !g.inMain && !g.judged && g.status === 'blocked' && g.events.some((e) => e.type === 'rejected' && /承認されていない/.test(e.reason || '')), `status=${g.status} judged=${g.judged} inMain=${g.inMain} exit=${g.code}`);
  g = runGate(gateFixture('g2'), 'CHANGES_REQUIRED');
  record('G', 'G2', '仕様が承認済みでも、司法が差し戻せば main に入らない', !g.inMain && g.judged && g.status === 'in_progress', `status=${g.status} inMain=${g.inMain}`);
  g = runGate(gateFixture('g3'), 'APPROVED');
  record('G', 'G3', '仕様が承認済みで、監査と司法が合格なら統合される（陽性の対照）', g.inMain && g.status === 'merged' && g.events.some((e) => e.type === 'merged'), `status=${g.status} inMain=${g.inMain} ${g.code ? g.out : ''}`);
  g = runGate(gateFixture('g4', { afterApprove: (fx, id) => commitTicket(fx, id, { section2: '- A1. `src/lib/a.ts` の `v` が 2 か 3 になる' }) }), 'APPROVED');
  record('G', 'G4', '承認の後に main で受け入れ条件を変えると、承認が外れて blocked', !g.inMain && !g.judged && g.status === 'blocked' && g.events.some((e) => /承認されていない/.test(e.reason || '')), `status=${g.status} judged=${g.judged}`);
  g = runGate(gateFixture('g5', { stop: true }), 'APPROVED');
  record('G', 'G5', 'Kernel の停止中は申請を処理しない（申請は残り、main に入らない）', !g.inMain && !g.judged && g.pending && g.status === 'review', `pending=${g.pending} status=${g.status}`);
  g = runGate(gateFixture('g6', { change: { 'src/lib/a.ts': 'export const v = 2;\n', 'vgdd/x.sh': 'echo 法律の書き換え\n' } }), 'APPROVED');
  record('G', 'G6', '差分が保護パス（vgdd/）に及べば、司法が APPROVED でも blocked', !g.inMain && !g.judged && g.status === 'blocked' && g.events.some((e) => /保護パス/.test(e.reason || '')), `status=${g.status} judged=${g.judged}`);
  g = runGate(gateFixture('g7', { change: { 'src/lib/b.ts': 'export const w = 1;\n' } }), 'APPROVED');
  record('G', 'G7', '差分が files_allowed の外に及べば、その理由で差し戻し、main に入らない', !g.inMain && !g.judged && g.events.some((e) => e.type === 'rejected' && /files_allowed の外/.test(e.reason || '')), `status=${g.status}`);
  const g9 = gateFixture('g9', { change: { 'src/lib/b.ts': 'export const w = 1;\n' } });
  const t9 = path.join(g9.main, `docs/tasks/${g9.id}-probe.md`);
  fs.writeFileSync(t9, fs.readFileSync(t9, 'utf8').replace('  - src/lib/a.ts', '  - src/lib/a.ts\n  - src/lib/b.ts')); // コミットしない
  g = runGate(g9, 'APPROVED');
  // p0.4.2：書きかけのある票の申請は処理されない（ticket_dirty_wait）。p0.4.1 までは main の票の files_allowed で差し戻された。どちらでも main に入らない
  record('G', 'G9', 'main の checkout の作業ツリーで、コミットせずに files_allowed を広げても効かない（p0.4.2：書きかけのある票の申請として処理されず、司法も呼ばれない。p0.4.1 までは main の票の files_allowed で差し戻していた）',
    !g.inMain && !g.judged && g.events.some((e) => e.type === 'ticket_dirty_wait'), `status=${g.status} inMain=${g.inMain}`);
  // OBS-044：裁判所の記録のコミットに、ほかの誰かのコミットしていない変更が混ざらない
  const g10 = gateFixture('g10');
  write(path.join(g10.main, 'docs/tasks/README.md'), '誰かの書きかけ\n');
  write(path.join(g10.main, 'docs/tasks/T-900-probe.md'), TICKET('T-900', { section2: '- A1. 書きかけの別の票' }));
  g = runGate(g10, 'APPROVED');
  const dirty = sh('git', ['-C', g10.main, 'status', '--porcelain', '--', 'docs/tasks/README.md', 'docs/tasks/T-900-probe.md']).stdout;
  const byGate = sh('git', ['-C', g10.main, 'log', '--author=gate-runner', '--name-only', '--format=']).stdout;
  record('G', 'G10', '裁判所の記録のコミットには、自分が書き換えた票だけが入る（ほかの書きかけは gate-runner の名前で main に入らない）',
    g.status === 'merged' && /README\.md/.test(dirty) && /T-900-probe\.md/.test(dirty) && !/README\.md|T-900-probe\.md/.test(byGate), `dirty=${dirty.trim().replace(/\n/g, ',')}`);
  // OBS-050（p0.4.2）：申請中の票そのものに、ほかの誰かのコミットしていない変更がある。裁判所はその申請を処理しない（判定も記録も統合もしない）
  const g11 = gateFixture('g11');
  const t11 = path.join(g11.main, `docs/tasks/${g11.id}-probe.md`);
  fs.writeFileSync(t11, fs.readFileSync(t11, 'utf8') + '\n立法補佐の書きかけ G11\n'); // コミットしない
  const before11 = fs.readFileSync(t11);
  g = runGate(g11, 'APPROVED');
  const byGate11 = sh('git', ['-C', g11.main, 'log', '--author=gate-runner', '-p', '--format=']).stdout;
  const wait11 = g.events.find((e) => e.type === 'ticket_dirty_wait');
  record('G', 'G11', '申請中の票にほかの書きかけがあれば、裁判所はその申請を処理しない（司法を呼ばず、main に入れず、票を1バイトも変えず、申請を残す。書きかけは gate-runner の名前で main に入らない）',
    !g.inMain && !g.judged && g.pending && Buffer.compare(before11, fs.readFileSync(t11)) === 0 && !/書きかけ G11/.test(byGate11)
      && !!wait11 && wait11.task === '-' && !g.events.some((e) => e.type === 'rejected'),
    `inMain=${g.inMain} judged=${g.judged} pending=${g.pending} wait=${JSON.stringify(wait11 || null)}`);
  // 書きかけの持ち主がコミットした後の周回では、普通に処理されて統合され、裁判所の記録は1回だけ入る（陽性の対照）
  git(g11.main, 'add', '-A'); git(g11.main, 'commit', '-q', '--allow-empty', '-m', '立法補佐の書きかけをコミット'); // 前の版では書きかけが裁判所のコミットに入っており、空になりうる
  g = runGate(g11, 'APPROVED');
  const main11 = sh('git', ['-C', g11.main, 'show', `main:docs/tasks/${g11.id}-probe.md`]).stdout;
  const byGate11b = sh('git', ['-C', g11.main, 'log', '--author=gate-runner', '-p', '--format=']).stdout;
  record('G', 'G12', '書きかけがコミットされた後の周回では、申請が普通に処理されて統合され、裁判所の記録（status → merged）は main の票に1回だけ入る（陽性の対照）',
    g.inMain && g.judged && !g.pending && /^status: merged$/m.test(main11) && (main11.match(/gate-runner: status → merged/g) || []).length === 1
      && /書きかけ G11/.test(main11) && !/^\+立法補佐の書きかけ G11/m.test(byGate11b)
      && sh('git', ['-C', g11.main, 'status', '--porcelain', '--', `docs/tasks/${g11.id}-probe.md`]).stdout.trim() === '',
    `inMain=${g.inMain} status=${g.status} pending=${g.pending}`);
  // 未追跡の票（main にない票）の申請：裁判所はその票に書かず、gate-runner の名前で main に入れない（Codex の指摘 p0.4.2c #1）
  const g13 = gateFixture('g13');
  write(path.join(g13.main, 'docs/tasks/T-901-probe.md'), TICKET('T-901', { section2: '- A1. 未追跡の票 G13' }).replace(/^status: .*/m, 'status: review'));
  write(path.join(g13.main, 'merge-requests/T-901.json'), JSON.stringify({ task: 'T-901', branch: `task/${g13.id}`, head: g13.head }) + '\n');
  const before13 = fs.readFileSync(path.join(g13.main, 'docs/tasks/T-901-probe.md'));
  g = runGate(g13, 'APPROVED');
  const byGate13 = sh('git', ['-C', g13.main, 'log', '--author=gate-runner', '--name-only', '--format=']).stdout;
  record('G', 'G13', '未追跡の票の申請は書きかけとして処理しない（票を1バイトも変えず、gate-runner の名前で main に入れず、申請を残す）',
    Buffer.compare(before13, fs.readFileSync(path.join(g13.main, 'docs/tasks/T-901-probe.md'))) === 0 && !/T-901-probe\.md/.test(byGate13)
      && fs.existsSync(path.join(g13.main, 'merge-requests/T-901.json')) && g.events.some((e) => e.type === 'ticket_dirty_wait' && /T-901/.test(e.ticket || '')),
    `byGate=${byGate13.trim().replace(/\n/g, ',')}`);
  // ---- p0.4.3（OBS-053）：司法が使えないことは判定ではない ----
  const g14 = gateFixture('g14');
  g = runGate(g14, 'APPROVED', [], { STUB_CODEX_PREFLIGHT_FAIL: '1' });
  record('G', 'G14', '起動時の点検で司法（Codex）が動かなければ裁判所は起動しない（司法を呼ばず、票も申請も触らず、preflight_failed を残す）',
    g.code !== 0 && !g.judged && g.pending && g.status === 'review' && !g.inMain && g.events.some((e) => e.type === 'preflight_failed'), `exit=${g.code} status=${g.status} judged=${g.judged}`);
  const g15 = gateFixture('g15');
  g = runGate(g15, 'APPROVED', [], { STUB_CODEX_NOFILE: '1' });
  record('G', 'G15', 'Codex が判定のファイルを書かずに終われば、judge が APPROVED でも統合しない（p0.4.2 までは SKIPPED とみなし minor の不一致として統合していた）。差し戻しに数えず、票を変えず、申請を残す',
    !g.inMain && g.pending && g.status === 'review' && !g.events.some((e) => e.type === 'rejected' || e.type === 'merged')
      && g.events.some((e) => e.type === 'judiciary_unavailable' && e.which === 'codex'), `inMain=${g.inMain} status=${g.status} pending=${g.pending}`);
  runGate(g15, 'APPROVED', [], { STUB_CODEX_NOFILE: '1' });
  g = runGate(g15, 'APPROVED', [], { STUB_CODEX_NOFILE: '1' });
  record('G', 'G16', '同じ申請で司法が3回使えなければ blocked にしてオーナーの判断へ（行政が司法を壊す入力で裁判所を待たせ続けない）',
    !g.inMain && !g.pending && g.status === 'blocked' && g.events.filter((e) => e.type === 'judiciary_unavailable').length === 3
      && g.events.some((e) => e.type === 'judiciary_blocked') && !g.events.some((e) => e.type === 'rejected'), `status=${g.status} n=${g.events.filter((e) => e.type === 'judiciary_unavailable').length}`);
  const g17 = gateFixture('g17');
  // 前の申請の judge の APPROVED の記録が残っている（別の SHA）。今回の judge はファイルを書かずに終わる
  write(path.join(g17.z3, `evidence/verdicts/${g17.id}-0123456789ab.json`), JSON.stringify({ final_verdict: 'APPROVED', judge: { findings: [] } }) + '\n');
  g = runGate(g17, 'APPROVED', [], { STUB_JUDGE_NOFILE: '1' });
  record('G', 'G17', '判定のファイルは候補の SHA のものだけを読む（前の申請の APPROVED を使わない。judge が書かなければ統合しない）',
    !g.inMain && g.pending && g.status === 'review' && g.events.some((e) => e.type === 'judiciary_unavailable' && e.which === 'judge'), `inMain=${g.inMain} status=${g.status}`);
  // 司法が戻れば、同じ申請が次の周回で普通に判定されて統合される（陽性の対照）
  g = runGate(g17, 'APPROVED');
  record('G', 'G18', '司法が戻った周回では、残っていた申請が普通に判定されて統合される（陽性の対照）', g.inMain && g.status === 'merged', `inMain=${g.inMain} status=${g.status}`);
  // Codex の監査 p0.4.3 #1・#2・#9：司法の出力を解釈できない記録、壊れた記録、セキュリティ審査の欠落
  g = runGate(gateFixture('g19'), 'APPROVED', [], { STUB_JUDGE_RAW: '{"final_verdict":"CHANGES_REQUIRED","judge_parse_ok":false,"judge":null}' });
  record('G', 'G19', 'judge の出力を解釈できなかった記録（CLI の空の応答・認証切れ。judge_parse_ok: false）は判定ではない。Codex が APPROVED でも minor の不一致として統合しない',
    !g.inMain && g.pending && g.status === 'review' && g.events.some((e) => e.type === 'judiciary_unavailable' && e.which === 'judge'), `inMain=${g.inMain} status=${g.status}`);
  g = runGate(gateFixture('g20'), 'APPROVED', [], { STUB_JUDGE_RAW: '{"final_verdict":"APPROVED"}broken' });
  record('G', 'G20', 'ファイル全体が1つの JSON でない判定の記録は、途中に APPROVED があっても使わない', !g.inMain && g.pending && g.events.some((e) => e.type === 'judiciary_unavailable'), `inMain=${g.inMain} status=${g.status}`);
  g = runGate(gateFixture('g21', { ticket: { security: true } }), 'APPROVED', [], { STUB_SECURITY_NOFILE: '1' });
  record('G', 'G21', 'security_review の票でセキュリティ審査の記録がなければ統合しない（差し戻しにも数えない）',
    !g.inMain && g.pending && g.status === 'review' && g.events.some((e) => e.type === 'judiciary_unavailable' && e.which === 'security') && !g.events.some((e) => e.type === 'rejected'), `inMain=${g.inMain} status=${g.status}`);
  g = runGate(gateFixture('g22', { ticket: { security: true } }), 'APPROVED');
  record('G', 'G22', 'security_review の票で3つの司法が APPROVED なら統合される（陽性の対照）', g.inMain && g.status === 'merged', `inMain=${g.inMain} status=${g.status} ${g.code ? g.out : ''}`);
  g = runGate(gateFixture('g8'), 'APPROVED', ['--hold']);
  record('G', 'G8', '夜間（--hold）は合格しても統合せず、held として朝の承認を待つ', !g.inMain && g.events.some((e) => e.type === 'held'), `inMain=${g.inMain}`);
  // ---- p0.4.7（INV-07）：差し戻しの上限。実運用では T-002・T-003 が上限で blocked になった（11/3〜11/4） ----
  // 票の §6 に裁判所の差し戻しの記録の行を n 行足す（§6 は仕様の指紋に入らないので、承認は外れない）
  const withReturns = (n) => (fx, id) => {
    const tp = path.join(fx.main, `docs/tasks/${id}-probe.md`);
    const lines = Array.from({ length: n }, (_, i) => `- 2026-11-03T20:0${i}:00+0900 gate-runner: status → in_progress（files_allowed の外を変更している: src/x${i}.ts）`);
    fs.appendFileSync(tp, `\n## 6. 記録\n\n${lines.join('\n')}\n`);
    git(fx.main, 'add', '-A'); git(fx.main, 'commit', '-q', '-m', `${id} の差し戻し ${n} 回`);
  };
  g = runGate(gateFixture('g23', { afterApprove: withReturns(3) }), 'APPROVED');
  record('G', 'G23', '差し戻しが3回に達した票の申請は、司法を呼ばずに blocked にしてオーナーの判断へ（司法が APPROVED でも統合しない。自動の再試行を有限にする）',
    g.code === 0 && !g.inMain && !g.judged && !g.pending && g.status === 'blocked' && g.events.some((e) => e.type === 'rejected' && /差し戻しが 3 回に達した/.test(e.reason || '')),
    `exit=${g.code} status=${g.status} judged=${g.judged} pending=${g.pending} inMain=${g.inMain}`);
  g = runGate(gateFixture('g23b', { afterApprove: withReturns(2) }), 'APPROVED');
  record('G', 'G23b', '差し戻しが2回なら上限の前なので、普通に審査して統合される（陽性の対照）', g.code === 0 && g.inMain && g.judged && g.status === 'merged', `exit=${g.code} status=${g.status} inMain=${g.inMain} ${g.code ? g.out : ''}`);
  // 取り消しの記録は JSON として読む：空白を入れた表記でも数える（p0.4.6 までは "task":"T-930" の文字列を数えていたので見逃した。Codex の監査 p0.4.7 #1）
  const g23c = gateFixture('g23c', { afterApprove: withReturns(3) });
  write(path.join(g23c.z3, 'evidence/annulments.jsonl'), JSON.stringify({ ts: '2026-11-03T21:00:00+0900', task: g23c.id, reason: '法律の不具合による差し戻しの取り消し G23c' }, null, 1).replace(/\n/g, ' ') + '\nこれは JSON でない行\n');
  g = runGate(g23c, 'APPROVED');
  record('G', 'G23c', 'オーナーが取り消した差し戻しは上限に数えない（3回のうち1回を取り消せば、審査して統合される）。取り消しの記録は JSON として読み、空白の有無で数が変わらず、読めない行は数えない',
    g.code === 0 && g.inMain && g.status === 'merged', `exit=${g.code} status=${g.status} inMain=${g.inMain} ${g.code ? g.out : ''}`);
  // 票の §6 の行を消しても回数は減らない：Z3 の裁判所の出来事（rejected・in_progress）が3件あれば、§6 に行がなくても blocked（オーナーの指摘、p0.4.7）
  const g23f = gateFixture('g23f');
  write(path.join(g23f.z3, 'evidence/gate_events.jsonl'), [0, 1, 2].map((i) => JSON.stringify({ ts: `2026-11-03T20:0${i}:00+0900`, type: 'rejected', task: g23f.id, reason: '差し戻し G23f', status: 'in_progress' })).join('\n') + '\n');
  g = runGate(g23f, 'APPROVED');
  record('G', 'G23f', '票の §6 から差し戻しの行を消しても回数は減らない（Z3 の裁判所の出来事に差し戻しが3件あれば、§6 に行がなくても司法を呼ばずに blocked。行政は §6 を書けるが Z3 は書けない）',
    g.code === 0 && !g.inMain && !g.judged && g.status === 'blocked', `exit=${g.code} status=${g.status} judged=${g.judged}`);
  // 多い方を使う（足し算ではない）・取り消しは1回だけ引く・別の票／blocked／別の種類は数えない（Codex の監査 p0.4.7c）
  const rejEv = (id, n, extra = {}) => Array.from({ length: n }, (_, i) => JSON.stringify({ ts: `2026-11-03T20:1${i}:00+0900`, type: 'rejected', task: id, reason: '差し戻し', status: 'in_progress', ...extra }));
  const g23f2 = gateFixture('g23f2', { afterApprove: withReturns(2) });
  write(path.join(g23f2.z3, 'evidence/gate_events.jsonl'), rejEv(g23f2.id, 2).join('\n') + '\n');
  g = runGate(g23f2, 'APPROVED');
  record('G', 'G23f2', '§6 と Z3 の記録がどちらも2回なら、足さずに多い方（2回）を使い、審査して統合される',
    g.code === 0 && g.inMain && g.status === 'merged', `exit=${g.code} status=${g.status} inMain=${g.inMain} ${g.code ? g.out : ''}`);
  const g23f3 = gateFixture('g23f3', { afterApprove: withReturns(3) });
  write(path.join(g23f3.z3, 'evidence/gate_events.jsonl'), rejEv(g23f3.id, 3).join('\n') + '\n');
  write(path.join(g23f3.z3, 'evidence/annulments.jsonl'), JSON.stringify({ ts: '2026-11-03T21:00:00+0900', task: g23f3.id, reason: 'G23f3' }) + '\n');
  g = runGate(g23f3, 'APPROVED');
  record('G', 'G23f3', '§6 と Z3 の記録がどちらも3回で、取り消しが1回なら、残り2回で審査して統合される（取り消しは1回だけ引く）',
    g.code === 0 && g.inMain && g.status === 'merged', `exit=${g.code} status=${g.status} inMain=${g.inMain} ${g.code ? g.out : ''}`);
  const g23f5 = gateFixture('g23f5', { afterApprove: withReturns(4) });
  write(path.join(g23f5.z3, 'evidence/gate_events.jsonl'), rejEv(g23f5.id, 4).join('\n') + '\n');
  write(path.join(g23f5.z3, 'evidence/annulments.jsonl'), JSON.stringify({ ts: '2026-11-03T21:00:00+0900', task: g23f5.id, reason: 'G23f5' }) + '\n');
  g = runGate(g23f5, 'APPROVED');
  record('G', 'G23f5', '§6 と Z3 の記録がどちらも4回で、取り消しが1回なら、残り3回で blocked（取り消しを二重に引かない。Codex の監査 p0.4.7d）',
    g.code === 0 && !g.inMain && !g.judged && g.status === 'blocked', `exit=${g.code} status=${g.status} judged=${g.judged}`);
  const g23f4 = gateFixture('g23f4');
  write(path.join(g23f4.z3, 'evidence/gate_events.jsonl'), [...rejEv('T-999', 3), ...rejEv(g23f4.id, 3, { status: 'blocked' }), ...rejEv(g23f4.id, 3, { type: 'disagreement' })].join('\n') + '\n');
  g = runGate(g23f4, 'APPROVED');
  record('G', 'G23f4', '別の票の差し戻し・blocked の記録・別の種類の出来事は数えない（それぞれ3件あっても審査して統合される）',
    g.code === 0 && g.inMain && g.status === 'merged', `exit=${g.code} status=${g.status} inMain=${g.inMain} ${g.code ? g.out : ''}`);
  // Z3 の記録を数えられなければ 0 とみなさず、申請を残して処理しない（fail-closed）
  const g23g = gateFixture('g23g');
  write(path.join(g23g.z3, 'evidence/gate_events.jsonl'), rejEv(g23g.id, 1).join('\n') + '\n{"type":"rejected", 壊れた行\n');
  g = runGate(g23g, 'APPROVED');
  record('G', 'G23g', 'Z3 の裁判所の出来事に読めない行があれば、差し戻しの回数を 0 とみなさず、司法を呼ばずに申請を残して returns_uncountable を記録する（fail-closed）',
    g.code === 0 && !g.inMain && !g.judged && g.pending && g.status === 'review' && g.events.some((e) => e.type === 'returns_uncountable' && e.task === g23g.id),
    `exit=${g.code} status=${g.status} judged=${g.judged} pending=${g.pending}`);
  // 読めない取り消しの行は数えない：差し戻し4回・正しい取り消し1行・JSON でない行1行なら、残りは3回で blocked（Codex の監査 p0.4.7b）
  const g23e = gateFixture('g23e', { afterApprove: withReturns(4) });
  write(path.join(g23e.z3, 'evidence/annulments.jsonl'), JSON.stringify({ ts: '2026-11-03T21:00:00+0900', task: g23e.id, reason: 'G23e' }) + '\n{"task":"' + g23e.id + '", 壊れた行\n');
  g = runGate(g23e, 'APPROVED');
  record('G', 'G23e', '読めない取り消しの行は数えない（差し戻し4回・正しい取り消し1行・JSON でない行1行なら、残り3回で blocked）',
    g.code === 0 && !g.inMain && !g.judged && g.status === 'blocked', `exit=${g.code} status=${g.status} judged=${g.judged}`);
  // 数えるのは §6 の後ろの、裁判所の記録の行の形だけ（票の説明や引用の中の同じ文字列は数えない。Codex の監査 p0.4.7 #2）
  const g23d = gateFixture('g23d', { afterApprove: (fx, id) => {
    const tp = path.join(fx.main, `docs/tasks/${id}-probe.md`);
    const quote = ['- 2026-11-02T10:00:00+0900 gate-runner: status → in_progress（§6 の前に写した例 1）', '- 2026-11-02T10:01:00+0900 gate-runner: status → in_progress（§6 の前に写した例 2）', 'gate-runner: status → in_progress（説明 1）', '> gate-runner: status → in_progress（引用 2）', '- 立法補佐の記録：gate-runner: status → in_progress が3回あった'].join('\n');
    // 雛形の「## 6. 記録」の前に補足の節を差し込み、§6 の後ろには裁判所の行1つと人の記録を足す
    const body = fs.readFileSync(tp, 'utf8').replace(/\n## 6\. 記録\n/, `\n## 5b. 補足\n\n${quote}\n\n## 6. 記録\n`);
    fs.writeFileSync(tp, body + '\n- 2026-11-03T20:00:00+0900 gate-runner: status → in_progress（files_allowed の外を変更している: src/x.ts）\n- 11:00 行政の長：gate-runner: status → in_progress の後に直した\n');
    git(fx.main, 'add', '-A'); git(fx.main, 'commit', '-q', '-m', `${id} の説明と引用`);
  } });
  g = runGate(g23d, 'APPROVED');
  record('G', 'G23d', '差し戻しの回数は §6 の後ろの裁判所の記録の行（- <時刻> gate-runner: status → in_progress）だけを数え、説明・引用・人の記録の中の同じ文字列は数えない（1回なので審査して統合される）',
    g.code === 0 && g.inMain && g.status === 'merged', `exit=${g.code} status=${g.status} inMain=${g.inMain} ${g.code ? g.out : ''}`);
  // ---- p0.4.7（OBS-060）：共有の .git/config が基準値と違えば止まる。止まる前に証拠ストアに記録を残す ----
  // 記録の行は種類だけ：ts・type・task・kind の4つで、kind は決めた値。設定の本文・ハッシュを含まない（Codex の監査 p0.4.7 #3）
  const cfgEventOk = (events, kind) => {
    const es = events.filter((e) => e.type === 'git_config_changed');
    return es.length === 1 && es[0].kind === kind && Object.keys(es[0]).sort().join(',') === 'kind,task,ts,type' && !/[0-9a-f]{40,64}|vscode|origin/.test(JSON.stringify(es[0]));
  };
  const g24 = gateFixture('g24');
  git(g24.main, 'config', 'branch.main.vscode-merge-base', 'origin/main');
  g = runGate(g24, 'APPROVED');
  record('G', 'G24', '共有の .git/config が基準値と違えば、申請を処理せずに終了コード 70 で止まり、止まる前に git_config_changed（kind: mismatch。種類だけ）を証拠ストアに残す（黙って終わらない。OBS-060）',
    g.code === 70 && !g.judged && g.pending && g.status === 'review' && !g.inMain && cfgEventOk(g.events, 'mismatch'),
    `exit=${g.code} judged=${g.judged} pending=${g.pending} events=${g.events.map((e) => e.type).join(',')}`);
  const g24b = gateFixture('g24b');
  fs.rmSync(path.join(g24b.z3, 'evidence/git-config.baseline'));
  g = runGate(g24b, 'APPROVED');
  record('G', 'G24b', 'git の設定の基準値がなければ、申請を処理せずに終了コード 70 で止まり、止まる前に git_config_changed（kind: baseline_missing）を残す',
    g.code === 70 && !g.judged && g.pending && g.status === 'review' && !g.inMain && cfgEventOk(g.events, 'baseline_missing'),
    `exit=${g.code} judged=${g.judged} pending=${g.pending} events=${g.events.map((e) => e.type).join(',')}`);
}

// ---- INV 不変条件（p0.4.4。ADR-034〜046 の総括の INV-01〜12） ------------------------------------------
const withCaps = (fx) => { write(path.join(fx.main, 'vgdd/kernel/capabilities.json'), JSON.stringify({ kernel_version: CAPS.kernel_version }) + '\n'); git(fx.main, 'add', '-A'); git(fx.main, 'commit', '-q', '-m', '権限の表（試験用）'); };
function groupINV() {
  // INV-06：承認は法律の系統に結び付く。権限の表のある main では、系統の記録のない承認・違う系統の承認は効かない
  let g = runGate(gateFixture('inv06a', { approveExtra: {}, afterApprove: withCaps }), 'APPROVED');
  record('INV', 'INV06a', '法律の系統（policy_line）の記録のない承認は、権限の表のある main では効かない（司法を呼ばず blocked）',
    !g.inMain && !g.judged && g.status === 'blocked' && g.events.some((e) => /承認されていない/.test(e.reason || '')), `status=${g.status} judged=${g.judged}`);
  g = runGate(gateFixture('inv06b', { approveExtra: { policy_line: 'p0.3' }, afterApprove: withCaps }), 'APPROVED');
  record('INV', 'INV06b', '前の法律の系統（p0.3）の承認は、今の系統の main では効かない（法律が変われば承認し直す）', !g.inMain && !g.judged && g.status === 'blocked', `status=${g.status}`);
  const badCaps = (fx) => { write(path.join(fx.main, 'vgdd/kernel/capabilities.json'), JSON.stringify({ kernel_version: 'x' }) + '\n'); git(fx.main, 'add', '-A'); git(fx.main, 'commit', '-q', '-m', '壊れた権限の表（試験用）'); };
  g = runGate(gateFixture('inv06d', { afterApprove: badCaps }), 'APPROVED');
  record('INV', 'INV06d', '権限の表はあるが版の形が違う（読めない）main では、どの承認も効かない（fail-closed。照合を飛ばさない）', !g.inMain && !g.judged && g.status === 'blocked', `status=${g.status}`);
  const jsonBroken = (fx) => { write(path.join(fx.main, 'vgdd/kernel/capabilities.json'), '{ 壊れた JSON\n'); git(fx.main, 'add', '-A'); git(fx.main, 'commit', '-q', '-m', '壊れた権限の表（試験用）'); };
  g = runGate(gateFixture('inv06e', { afterApprove: jsonBroken }), 'APPROVED');
  record('INV', 'INV06e', '権限の表が JSON として読めない main では、どの承認も効かない', !g.inMain && !g.judged && g.status === 'blocked', `status=${g.status}`);
  g = runGate(gateFixture('inv06c', { afterApprove: withCaps }), 'APPROVED');
  record('INV', 'INV06c', '今の法律の系統の承認なら統合される（陽性の対照）', g.inMain && g.status === 'merged', `status=${g.status} ${g.code ? g.out : ''}`);
  // INV-12：独立した作業は、ほかの票の承認待ちだけを理由に止まらない（同じ周回で、未承認の票は blocked、承認済みの票は統合）
  // 未承認の票を、承認済みの票の前（T-901、処理の順が先）と後（T-931）の両方に置く。どれも別のファイルを変える（独立した作業）
  const fx = gateFixture('inv12');
  const addUnapproved = (id, file) => {
    commitTicket(fx, id, { status: 'review', files: [file] });
    const w = path.join(fx.base, `wt-${id}`);
    git(fx.main, 'worktree', 'add', '-q', '-b', `task/${id}`, w, 'main');
    write(path.join(w, file), 'export const u = 1;\n'); git(w, 'add', '-A'); git(w, 'commit', '-q', '-m', '未承認の票の実装');
    write(path.join(fx.main, `merge-requests/${id}.json`), JSON.stringify({ task: id, branch: `task/${id}`, head: git(w, 'rev-parse', 'HEAD') }) + '\n');
  };
  addUnapproved('T-901', 'src/lib/b.ts'); addUnapproved('T-931', 'src/lib/c.ts');
  g = runGate(fx, 'APPROVED');
  const stOf = (id) => (fs.readFileSync(path.join(fx.main, `docs/tasks/${id}-probe.md`), 'utf8').match(/^status: (.*)$/m) || [])[1];
  record('INV', 'INV12', '同じ周回で、承認済みの票（T-930）の前（T-901）と後（T-931）にある未承認の票は blocked、独立した T-930 は統合される（承認待ちで周回も全体も止まらない）',
    g.inMain && g.status === 'merged' && stOf('T-901') === 'blocked' && stOf('T-931') === 'blocked', `T-901=${stOf('T-901')} T-930=${g.status} T-931=${stOf('T-931')}`);
  // INV-08：役割ごとのモデルは定義で固定（行政は定義を書き換えられない＝CAP-LAW-WRITE の .claude/agents の probe）
  const defs = ['worker', 'judge', 'constitutional-review'].map((a) => [a, (frontOf(path.join(IMPL.agents, `${a}.md`)).match(/^model:\s*(\S+)/m) || [])[1]]);
  record('INV', 'INV08', '役割の定義（worker・judge・憲法審査）に model が空でなく書かれている（期待するモデルの照合と起動の観測はしない）', defs.every(([, m]) => !!m), defs.map(([a, m]) => `${a}=${m || 'なし'}`).join(' '));
}
// C1 の権限 id の結果 rs が、権限の表から期待される「役割#probe の番号」の集合とちょうど一致するか（欠け・重複・余分を拒否）
function c1Complete(id, rs) {
  const cap = CAPS.capabilities.find((c) => c.id === id);
  const roles = Object.keys(cap?.expect || {}).filter((r) => CAPS.roles[r]?.hook_input);
  const want = new Set(roles.flatMap((r) => (cap?.probes || []).map((_, i) => `${r}#${i}`)));
  const keys = rs.map((x) => x.key);
  return !!cap && want.size > 0 && keys.length === want.size && new Set(keys).size === keys.length && keys.every((k) => want.has(k));
}
// 不変条件の自己検査：権限の表の invariants の各項目に、強制なら合格した判例があり、対象外なら理由がある
function groupInvMeta() {
  for (const inv of CAPS.invariants || []) {
    if (inv.status === 'not_applicable') { record('INV', `${inv.id}:meta`, `${inv.id} は対象外（理由：${inv.reason || 'なし'}）`, !!inv.reason); continue; }
    // 判例は「群:ID」で参照する（C1 の probe と M の自己検査が同じ CAP-* の ID を使うため。Codex の監査 p0.4.4 #2）
    const missing = []; const failed = [];
    for (const t of inv.tests || []) {
      const [grp, id] = String(t).includes(':') ? String(t).split(':') : [null, t];
      const rs = results.filter((x) => x.group === grp && x.id === id);
      // C1 の権限は、権限の表から期待される役割 × probe の数だけ結果がそろっていること（一部が欠けても合格しない。Codex の再監査 #2）
      //   件数でなく「役割#probe の番号」の集合で照合する（重複で数を満たしても合格しない。Codex の3回目の監査 #2）
      const complete = grp === 'C1' ? c1Complete(id, rs) : rs.length > 0;
      if (!grp || !complete) missing.push(`${t}(${rs.length})`); else if (!rs.every((x) => x.ok)) failed.push(t);
    }
    record('INV', `${inv.id}:meta`, `${inv.id}（${inv.status}）の判例 ${(inv.tests || []).length} 件がすべて実行され合格している`,
      (inv.tests || []).length > 0 && !missing.length && !failed.length && (inv.status === 'enforced' || (inv.gaps || []).length > 0),
      [missing.length ? `ない：${missing.join(',')}` : '', failed.length ? `不合格：${failed.join(',')}` : '', inv.status !== 'enforced' && !(inv.gaps || []).length ? '一部なのに gaps がない' : ''].filter(Boolean).join(' '));
  }
  // 自己検査そのものの陰性の対照：C1 の結果が1つ欠ける・1つが重複して数を満たす・余分の key があるときは完全とみなさない
  const full = results.filter((x) => x.group === 'C1' && x.id === 'CAP-LAW-WRITE');
  const dup = full.slice(0, -1).concat([full[0]]);
  record('INV', 'INV-META', '不変条件の自己検査は、C1 の結果の欠け・重複・余分を見逃さない（陽性：そろった結果は完全）',
    c1Complete('CAP-LAW-WRITE', full) && !c1Complete('CAP-LAW-WRITE', full.slice(1)) && !c1Complete('CAP-LAW-WRITE', dup) && !c1Complete('CAP-LAW-WRITE', full.slice(1).concat([{ ...full[0], key: 'owner#99' }])), `結果 ${full.length} 件`);
  const invs = CAPS.invariants || [];
  record('INV', 'INV-ALL', '不変条件 INV-01〜12 がちょうど1回ずつ権限の表にあり、状態は3つのどれか、判例は文字列の配列',
    invs.length === 12 && ['01','02','03','04','05','06','07','08','09','10','11','12'].every((n) => invs.filter((i) => i.id === `INV-${n}`).length === 1)
      && invs.every((i) => ['enforced', 'partial', 'not_applicable'].includes(i.status) && (i.tests === undefined || (Array.isArray(i.tests) && i.tests.every((t) => typeof t === 'string')))
        && (i.status !== 'not_applicable' || (typeof i.reason === 'string' && i.reason.length > 0))
        && (i.status !== 'partial' || (Array.isArray(i.gaps) && i.gaps.length > 0 && i.gaps.every((x) => typeof x === 'string' && x.length > 0)))));
}

// ---- ST Kernel の状態の書き出し（p0.4.3） ------------------------------------------------------------
function groupST() {
  const fx = gateFixture('st1');
  write(path.join(fx.main, 'vgdd/kernel/capabilities.json'), JSON.stringify({ kernel_version: CAPS.kernel_version }) + '\n'); // 法律の版は main の権限の表から読む
  git(fx.main, 'add', '-A'); git(fx.main, 'commit', '-q', '-m', '権限の表（試験用）');
  write(path.join(fx.z3, 'evidence/rulings.jsonl'), JSON.stringify({ ts: '2026-11-06T01:39:00+0900', task: 'T-930', sha: 'f'.repeat(40), decision: 'merge', reason: '裁定の理由の本文 ST' }) + '\n');
  write(path.join(fx.z3, 'evidence/annulments.jsonl'), JSON.stringify({ ts: '2026-11-06T01:40:00+0900', task: 'T-930', reason: '取り消しの理由の本文 ST' }) + '\n');
  let g = runGate(fx, 'APPROVED');
  let st = null; try { st = JSON.parse(g.kstate); } catch { /* なし */ }
  record('ST', 'ST1', '裁判所が周回の終わりに状態の写しを書き、中身は公開してよい集計だけ（パス・ハッシュ・理由の本文・セッション ID を含まない）',
    !!st && st.schema === 'vgdd.kernel-state.v1' && st.kernel_version === CAPS.kernel_version && st.stopped?.active === false
      && st.approvals?.some((a) => a.task === 'T-930' && a.current === true) && st.rulings?.count === 1 && st.annulments?.count === 1 && st.verdicts?.by_task?.['T-930']?.judge === 'APPROVED'
      && !/\/Users\/|tsubuyaki-z3|vgdd-conf|[0-9a-f]{8,}|session|tool_use|reason|findings|理由の本文/.test(g.kstate) && !('tickets' in st),
    st ? '' : `書き出しがない ${g.out}`);
  record('ST', 'ST2', '状態の写しは git で追跡されない（裁判所の記録のコミットに入らず、作業ツリーを汚さない）',
    !!st && sh('git', ['-C', fx.main, 'status', '--porcelain', '--', 'docs/governance']).stdout.trim() === ''
      && !/kernel-state/.test(sh('git', ['-C', fx.main, 'log', '--all', '--name-only', '--format=']).stdout));
  const gen = st?.generated_at;
  sh('sleep', ['1.2']); // generated_at は秒の単位
  g = runGate(fx, 'APPROVED');
  let st2 = null; try { st2 = JSON.parse(g.kstate); } catch { /* なし */ }
  record('ST', 'ST3', '申請のない周回でも書き直し、generated_at が進む（裁判所の生存の合図。画面はこれで古い写しを見分ける）。ほかの項目は変わらない',
    !!st2 && !!gen && st2.generated_at > gen && JSON.stringify({ ...st2, generated_at: 0, evidence: 0 }) === JSON.stringify({ ...st, generated_at: 0, evidence: 0 }), `${gen} → ${st2?.generated_at}`);
  write(path.join(fx.z3, 'STOP'), '理由の本文 ST（2026-11-06T04:00:00+0900）\n');
  fs.appendFileSync(path.join(fx.z3, 'evidence/gate_events.jsonl'), JSON.stringify({ ts: '2026-11-06T04:00:00+0900', type: 'kernel_stop', task: '-', stop_id: 'stop-12345' }) + '\n');
  g = runGate(fx, 'APPROVED');
  let st3 = null; try { st3 = JSON.parse(g.kstate); } catch { /* なし */ }
  record('ST', 'ST4', '停止中は「停止中」と時刻を書き出し、停止の理由の本文と stop_id は出さない',
    !!st3 && st3.stopped?.active === true && st3.stopped?.since === '2026-11-06T04:00:00+09:00' && !/理由の本文|stop-12345/.test(g.kstate), JSON.stringify(st3?.stopped || null));
  fs.rmSync(path.join(fx.z3, 'STOP'));
  g = runGate(fx, 'APPROVED');
  let st5 = null; try { st5 = JSON.parse(g.kstate); } catch { /* なし */ }
  record('ST', 'ST5', '停止が解けた周回では active が false に戻る', !!st5 && st5.stopped?.active === false);
  // 承認の後に main の票の §2 を変えると current が false
  const f6 = gateFixture('st6', { afterApprove: (x, id) => commitTicket(x, id, { section2: '- A1. `src/lib/a.ts` の `v` が 2 か 3 になる' }) });
  g = runGate(f6, 'APPROVED');
  let st6 = null; try { st6 = JSON.parse(g.kstate); } catch { /* なし */ }
  record('ST', 'ST6', '承認の後に受け入れ条件を変えた票は approvals[].current が false（承認の有無を行政の長が読める。OBS-051）',
    !!st6 && st6.approvals?.some((a) => a.task === 'T-930' && a.current === false), JSON.stringify(st6?.approvals || null));
  // 判断の根拠にしない：裁判所・夜間の代行・release・再開はこのファイルを読まない（書き出しの --out と保護パスの照合だけ）
  const readers = ['gate-runner.sh', 'night-runner.sh', 'release.sh', 'kernel-resume.sh', 'rule.sh', 'approve-spec.sh'].map((f) => {
    const p = path.join(IMPL.bin, f); if (!fs.existsSync(p)) return [];
    return fs.readFileSync(p, 'utf8').split('\n').filter((l) => /kernel-state\.json/.test(l) && !/^\s*#/.test(l) && !/PROTECTED_RE=|KSTATE_OUT="\$REPO\/docs\/governance\/kernel-state\.json"/.test(l)).map((l) => `${f}: ${l.trim()}`);
  }).flat();
  record('ST', 'ST9', '裁判所・夜間の代行・release・再開は状態の写しを読まない（表示用で、判断の根拠にしない）',
    fs.existsSync(path.join(IMPL.bin, 'kernel-state.mjs')) && readers.length === 0, readers.join(' / ').slice(0, 200));
  // Codex の監査 p0.4.3 #8：入力の記録に紛れ込んだ SHA・セッション ID・パス・理由の本文の形は、時刻・版の欄を通っても出ない
  const f8 = gateFixture('st8');
  write(path.join(f8.z3, 'evidence/conformance.jsonl'), JSON.stringify({ at: 'session-abcdef0123456789', impl: '/Users/x/理由の本文', kernel_version: 'e'.repeat(40), passed: 1, total: 1 }) + '\n');
  write(path.join(f8.z3, 'evidence/tool_calls.jsonl'), JSON.stringify({ policy_version: 'toolu_0123456789abcdef' }) + '\n');
  fs.appendFileSync(path.join(f8.z3, 'evidence/spec_approvals.jsonl'), JSON.stringify({ task: 'T-931', ts: 'c'.repeat(40), digest: 'sha256:x', approved_by: 'owner' }) + '\n');
  g = runGate(f8, 'APPROVED');
  let st8 = null; try { st8 = JSON.parse(g.kstate); } catch { /* なし */ }
  record('ST', 'ST8', '入力の記録に紛れ込んだ SHA・セッション ID・パス・理由の本文の形は、時刻・版・実装の欄を通っても書き出されない（欄ごとの形で検査）',
    !!st8 && st8.conformance?.at === null && st8.conformance?.impl === null && st8.conformance?.kernel_version === null && st8.policy_version === null
      && st8.approvals?.some((a) => a.task === 'T-931' && a.approved_at === null) && !/session-|toolu_|\/Users\/|理由の本文|eeeeeeee|cccccccc/.test(g.kstate), g.kstate ? '' : g.out);
  // p0.4.4：不変条件と承認待ちの写し（kernel-invariants.json）
  const f10 = gateFixture('st10');
  write(path.join(f10.main, 'vgdd/kernel/capabilities.json'), JSON.stringify({ kernel_version: CAPS.kernel_version, invariants: CAPS.invariants }) + '\n');
  commitTicket(f10, 'T-932', { status: 'ready', section2: '- A1. /Users/someone/secret 0123456789abcdef 秘密の本文 ST10' });   // 未承認の ready の票（題名・本文に漏れてはいけない形）
  git(f10.main, 'add', '-A'); git(f10.main, 'commit', '-q', '--allow-empty', '-m', '権限の表と未承認の票（試験用）');
  write(path.join(f10.z3, 'evidence/conformance.jsonl'), JSON.stringify({ at: '2026-11-06T08:00:00+09:00', impl: 'repo', kernel_version: CAPS.kernel_version, passed: 1, total: 1, invariants: { 'INV-01': 'pass', 'INV-07': 'fail', 'INV-09': 'n/a' } }) + '\n');
  runGate(f10, 'APPROVED');
  const ivRepo = (() => { try { return JSON.parse(fs.readFileSync(path.join(f10.main, 'docs/governance/kernel-invariants.json'), 'utf8')); } catch { return null; } })();
  let iv = null; const ivf = path.join(f10.main, 'docs/governance/kernel-invariants.json'); const ivs = fs.existsSync(ivf) ? fs.readFileSync(ivf, 'utf8') : '';
  try { iv = JSON.parse(ivs); } catch { /* なし */ }
  const byId = Object.fromEntries((iv?.invariants || []).map((i) => [i.id, i]));
  record('ST', 'ST10', '不変条件の写し：INV-01〜12 が状態（強制・一部・対象外）と最後の適合性テストの結果つきで出る。未承認の ready の票が承認待ちに出て、承認済みの票は出ない。git で追跡しない',
    !!iv && iv.schema === 'vgdd.kernel-invariants.v1' && (iv.invariants || []).length === 12
      && Object.values(byId).every((i) => i.verified === null) && iv.verified_by === null   // 原本（impl: repo）の記録は、稼働中の検証済みとして出さない
      && byId['INV-09']?.status === 'not_applicable' && iv.invariants.every((i) => !('title' in i))
      && iv.pending_approvals?.some((p) => p.task === 'T-932') && !iv.pending_approvals?.some((p) => p.task === 'T-930') && iv.pending_approvals.every((p) => !('title' in p))
      && !/\/Users\/|tsubuyaki-z3|vgdd-conf|[0-9a-f]{8,}|秘密の本文|適合性テストの票/.test(ivs) && sh('git', ['-C', f10.main, 'status', '--porcelain', '--', 'docs/governance']).stdout.trim() === '',
    iv ? JSON.stringify(iv.pending_approvals).slice(0, 120) : 'ない');
  void ivRepo;
  // 稼働中の実装（z3）で今の版を試した記録なら、不変条件ごとの結果と対象（版・実装・日時）が出る
  const zsha = implShaFor(path.join(f10.z3, 'bin'), path.join(f10.z3, 'hooks/policy.mjs'));
  write(path.join(f10.z3, 'evidence/conformance.jsonl'), JSON.stringify({ at: '2026-11-06T08:05:00+09:00', impl: 'z3', kernel_version: CAPS.kernel_version, impl_sha256: 'f'.repeat(64), passed: 1, total: 1, invariants: { 'INV-01': 'pass' } }) + '\n');
  runGate(f10, 'APPROVED');
  let ivx = null; try { ivx = JSON.parse(fs.readFileSync(ivf, 'utf8')); } catch { /* なし */ }
  record('ST', 'ST11b', '同じ版名でも、稼働中の Z3 の実装と指紋の違う記録は検証済みにしない', !!ivx && ivx.verified_by === null && (ivx.invariants || []).every((i) => i.verified === null));
  write(path.join(f10.z3, 'evidence/conformance.jsonl'), JSON.stringify({ at: '2026-11-06T08:10:00+09:00', impl: 'z3', kernel_version: CAPS.kernel_version, impl_sha256: zsha, passed: 1, total: 1, invariants: { 'INV-01': 'pass', 'INV-07': 'fail', 'INV-09': 'n/a' } }) + '\n');
  runGate(f10, 'APPROVED');
  let iv2 = null; try { iv2 = JSON.parse(fs.readFileSync(ivf, 'utf8')); } catch { /* なし */ }
  const by2 = Object.fromEntries((iv2?.invariants || []).map((i) => [i.id, i]));
  record('ST', 'ST11', '稼働中の実装（z3）で今の法律の版を試した記録だけが、不変条件ごとの結果（合格・不合格・対象外は —）と対象（版・実装・日時）として出る',
    !!iv2 && by2['INV-01']?.verified === true && by2['INV-07']?.verified === false && by2['INV-09']?.verified === null && iv2.verified_by?.impl === 'z3' && iv2.verified_by?.kernel_version === CAPS.kernel_version, JSON.stringify(iv2?.verified_by || null));
  // 未承認の申請を裁判所が blocked にした票も、承認待ちに残る（#4）
  const f12 = gateFixture('st12', { approve: false });
  runGate(f12, 'APPROVED');
  let iv3 = null; try { iv3 = JSON.parse(fs.readFileSync(path.join(f12.main, 'docs/governance/kernel-invariants.json'), 'utf8')); } catch { /* なし */ }
  record('ST', 'ST12', '未承認の申請を裁判所が blocked にした票は、承認待ちに status: blocked で残る', !!iv3 && iv3.pending_approvals?.some((p) => p.task === 'T-930' && p.status === 'blocked'), JSON.stringify(iv3?.pending_approvals || null));
  // p0.4.5：フックは docs/governance.md（文書）を docs/governance/（状態の写し）と取り違えない。写しへの書き込みは今までどおり拒否
  const hx = { agent_type: null, cwd: fx.main };
  const okMd = hook(fx, { tool: 'Bash', input: { command: 'git add docs/governance.md' }, ...hx });
  const ngDir = hook(fx, { tool: 'Bash', input: { command: "echo '{}' > docs/governance/kernel-state.json" }, ...hx });
  const ngInv = hook(fx, { tool: 'Bash', input: { command: 'cp /tmp/x docs/governance/kernel-invariants.json' }, ...hx });
  record('ST', 'ST13', '行政の長の Bash：docs/governance.md を扱うコマンドは通り、docs/governance/ の写しへの書き込みは拒否される', okMd.decision === 'allow' && ngDir.decision === 'deny' && ngInv.decision === 'deny', `md=${okMd.decision} dir=${ngDir.decision} inv=${ngInv.decision}`);
  // p0.4.6：裁判所は --repo の値を監査の sandbox に VGDD_REPO として渡す（.env.local を読ませない対象が、検査するリポジトリになる）
  const sbxLog = path.join(fx.z3, 'sbx-repo.log');
  const seen = fs.existsSync(sbxLog) ? fs.readFileSync(sbxLog, 'utf8').split('\n').filter(Boolean) : [];
  record('ST', 'ST14', '裁判所は --repo の値を、監査の sandbox に VGDD_REPO として渡す（既定と違う場所でも、検査するリポジトリの .env.local を読ませない）',
    seen.length > 0 && seen.every((r) => fs.realpathSync(r) === fs.realpathSync(fx.main)), seen.slice(0, 2).join(','));
  // 相対パスの --repo でも、起動の時点の場所で解決した絶対パスが渡る
  const fr = gateFixture('st14r');
  fs.rmSync(path.join(fr.z3, 'sbx-repo.log'), { force: true });
  sh('bash', [path.join(IMPL.bin, 'gate-runner.sh'), '--repo', 'app', '--once', '--interval', '1'], { cwd: fr.base, env: { ...process.env, ...UTF8, VGDD_Z3_DIR: fr.z3, STUB_VERDICT: 'APPROVED' }, timeout: 120000 });
  const seenR = fs.existsSync(path.join(fr.z3, 'sbx-repo.log')) ? fs.readFileSync(path.join(fr.z3, 'sbx-repo.log'), 'utf8').split('\n').filter(Boolean) : [];
  record('ST', 'ST14b', '--repo を相対パス（app）で渡しても、監査の sandbox には起動の場所で解決した絶対パスが渡る',
    seenR.length > 0 && seenR.every((r) => path.isAbsolute(r) && fs.realpathSync(r) === fs.realpathSync(fr.main)), seenR.slice(0, 1).join(','));
  // 本物の sandboxed-run.sh：VGDD_REPO の .env.local は読めず、同じ場所の通常のファイルは読める（sandbox-exec がなければ省く）
  if (sh('bash', ['-c', 'command -v sandbox-exec']).status === 0) {
    const sb = path.join(fx.base, 'sbx-real'); fs.mkdirSync(sb, { recursive: true });
    write(path.join(sb, '.env.local'), 'SECRET=x\n'); write(path.join(sb, 'plain.txt'), 'ok\n');
    const wtd = fs.mkdtempSync(path.join(os.tmpdir(), 'vgdd-sbx-wt-'));
    const run = (f) => sh('bash', [path.join(IMPL.bin, 'sandboxed-run.sh'), '--dir', wtd, '--', 'cat', path.join(sb, f)], { env: { ...process.env, VGDD_Z3_DIR: fx.z3, VGDD_REPO: sb } });
    record('ST', 'ST14c', '本物の監査の sandbox では、VGDD_REPO の .env.local は読めず、同じ場所の通常のファイルは読める', run('.env.local').status !== 0 && run('plain.txt').status === 0);
  } else {
    // 省いたことを結果に残す（合格に数えない。Codex の再監査 p0.4.6）
    record('ST', 'ST14c', '本物の監査の sandbox の判例は、この環境に sandbox-exec がないため実行していない（macOS で実行する）', false, '未実行');
  }
  // CDPATH を継承していても、--repo の相対パスは起動の場所で解決する
  const fc = gateFixture('st14d');
  fs.rmSync(path.join(fc.z3, 'sbx-repo.log'), { force: true });
  fs.mkdirSync(path.join(fc.base, 'decoy', 'app'), { recursive: true });
  sh('bash', [path.join(IMPL.bin, 'gate-runner.sh'), '--repo', 'app', '--once', '--interval', '1'], { cwd: fc.base, env: { ...process.env, ...UTF8, VGDD_Z3_DIR: fc.z3, STUB_VERDICT: 'APPROVED', CDPATH: path.join(fc.base, 'decoy') }, timeout: 120000 });
  const seenC = fs.existsSync(path.join(fc.z3, 'sbx-repo.log')) ? fs.readFileSync(path.join(fc.z3, 'sbx-repo.log'), 'utf8').split('\n').filter(Boolean) : [];
  record('ST', 'ST14d', 'CDPATH を継承していても、--repo の相対パスは起動の場所で解決する（別の場所の同名のフォルダに移らない）',
    seenC.length > 0 && seenC.every((r) => fs.realpathSync(r) === fs.realpathSync(fc.main)), seenC.slice(0, 1).join(','));
  const v2 = JSON.parse(fs.readFileSync(path.join(VG, 'settings.v2.json'), 'utf8'));
  record('ST', 'ST15', '設定の原本 vgdd/settings.v2.json も docs/governance を保護する（Edit・Write の拒否4つと sandbox の denyWrite）',
    ['Edit(docs/governance/**)', 'Write(docs/governance/**)', 'Edit(**/docs/governance/**)', 'Write(**/docs/governance/**)'].every((x) => (v2.permissions?.deny || []).includes(x)) && (v2.sandbox?.filesystem?.denyWrite || []).includes('docs/governance'));
  // p0.4.8：配置済みの設定（リポジトリの .claude/settings.json）は、原本の保護をすべて持つ（拒否の規則・sandbox の書き込みと読み取りの禁止・フック）。
  //   11/7 まで、原本にある docs/governance の Edit・Write の拒否4つが、配置済みに欠けていた（フックと denyWrite では防いでいた）
  const deployedPath = path.join(DEPLOYED_REPO, '.claude/settings.json');
  const dep = fs.existsSync(deployedPath) ? JSON.parse(fs.readFileSync(deployedPath, 'utf8')) : null;
  const lack = (sel) => (sel(v2) || []).filter((x) => !(sel(dep || {}) || []).includes(x));
  // sandbox の有効化・失敗時の扱い・sandbox の外での実行の許可も、原本と同じ値でなければならない（Codex の監査 p0.4.8 #2）
  const flags = ['enabled', 'failIfUnavailable', 'allowUnsandboxedCommands'].filter((k) => (v2.sandbox || {})[k] !== (dep?.sandbox || {})[k]).map((k) => `sandbox.${k}`);
  const lacks = dep ? [...lack((s) => s.permissions?.deny), ...lack((s) => s.sandbox?.filesystem?.denyWrite), ...lack((s) => s.sandbox?.filesystem?.denyRead), ...flags] : ['配置済みの設定がない'];
  // フックはキーの順によらず構造で比べる（配列の順は保つ。Codex の監査 p0.4.8 #4）
  const canon = (x) => Array.isArray(x) ? x.map(canon) : (x && typeof x === 'object') ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])])) : x;
  const hooksSame = !!dep && JSON.stringify(canon(dep.hooks)) === JSON.stringify(canon(v2.hooks));
  record('ST', 'ST16', '配置済みの設定（.claude/settings.json）は、原本 vgdd/settings.v2.json の拒否の規則・sandbox の書き込みと読み取りの禁止の一覧をすべて含み、sandbox の enabled・failIfUnavailable・allowUnsandboxedCommands は同じ値、フックは同じ構造',
    lacks.length === 0 && hooksSame, `対象=${opt('--repo') ? '--repo' : impl === 'z3' ? '既定の本番のリポジトリ' : '原本のリポジトリ'} 欠け=${lacks.slice(0, 4).join(',') || 'なし'} hooks=${hooksSame ? '同じ' : '違う'}`);
  // p0.4.8：--impl z3 は VGDD_Z3_DIR の場所の写しを試す（--record の書き先と同じ場所）
  const pz = path.join(os.tmpdir(), 'vgdd-st17-z3');
  const pr = sh('node', [path.join(HERE, 'run.mjs'), '--impl', 'z3', '--print-impl'], { env: { ...process.env, VGDD_Z3_DIR: pz } });
  let pj = null; try { pj = JSON.parse(pr.stdout); } catch { pj = null; }
  record('ST', 'ST17', '適合性テストの --impl z3 は、VGDD_Z3_DIR の場所の写し（hooks・bin）を試す（--record の書き先と同じ。既定と違う場所の導入で別の写しを試さない）',
    pj !== null && pj.bin === path.join(pz, 'bin') && pj.policy === path.join(pz, 'hooks/policy.mjs'), pj ? `bin=${pj.bin === path.join(pz, 'bin') ? 'VGDD_Z3_DIR' : '別の場所'}` : `exit=${pr.status}`);
  // 作業員が差分に状態の写しを入れて申請すれば、保護パスとして司法の前に blocked
  g = runGate(gateFixture('st7', { change: { 'src/lib/a.ts': 'export const v = 2;\n', 'docs/governance/kernel-state.json': '{"approvals":[]}\n' } }), 'APPROVED');
  record('ST', 'ST7', '作業員の差分に状態の写しが含まれれば、司法の前に保護パスとして blocked',
    !g.inMain && !g.judged && g.status === 'blocked' && g.events.some((e) => /保護パス/.test(e.reason || '')), `status=${g.status} judged=${g.judged}`);
}

// ---- K 停止と再開 -------------------------------------------------------------------------------
function groupK() {
  const fx = fixture('k');
  const w = { agent_type: 'worker', cwd: fx.wt };
  const h = { agent_type: null, cwd: fx.main };
  const before = hook(fx, { tool: 'Write', input: { file_path: path.join(fx.wt, 'src/lib/a.ts'), content: 'x' }, ...w });
  const ks = sh('bash', [path.join(IMPL.bin, 'kernel-stop.sh'), '不審な操作を調べる（試験）'], { env: { ...process.env, ...UTF8, VGDD_Z3_DIR: fx.z3, VGDD_REPO: fx.main } });
  const stopped = [
    ['K1', '停止中は作業員の Write を拒否', hook(fx, { tool: 'Write', input: { file_path: path.join(fx.wt, 'src/lib/a.ts'), content: 'x' }, ...w }), 'deny'],
    ['K2', '停止中も Read は通す（調べられる）', hook(fx, { tool: 'Read', input: { file_path: path.join(fx.main, 'src/lib/a.ts') }, ...h }), 'allow'],
    ['K3', '停止中は読み取り専用に見える Bash（git status）も拒否（文字列では書き込みを見分けきれない）', hook(fx, { tool: 'Bash', input: { command: 'git status --short' }, ...h }), 'deny'],
    ['K3b', '停止中は sort -o（読み取りに見えて書き込む）を拒否', hook(fx, { tool: 'Bash', input: { command: 'sort -o src/lib/a.ts src/lib/a.ts' }, ...h }), 'deny'],
    ['K3c', '停止中も Grep は通す', hook(fx, { tool: 'Grep', input: { pattern: 'v', path: path.join(fx.main, 'src') }, ...h }), 'allow'],
    ['K4', '停止中は書き込みを含む Bash を拒否', hook(fx, { tool: 'Bash', input: { command: 'cat src/lib/a.ts > src/lib/b.ts' }, ...h }), 'deny'],
    ['K5', '停止中はテストの実行（npm test）も拒否', hook(fx, { tool: 'Bash', input: { command: 'npm test' }, ...h }), 'deny'],
    ['K6', '停止中はサブエージェントの起動（Agent）も拒否', hook(fx, { tool: 'Agent', input: { prompt: 'x' }, ...h }), 'deny'],
    ['K7', '停止中も Z3 の読み取りは通常どおり拒否', hook(fx, { tool: 'Read', input: { file_path: path.join(fx.z3, 'STOP') }, ...h }), 'deny'],
  ];
  record('K', 'K0', '停止の前は作業員の Write が通る（陽性の対照）', before.decision === 'allow');
  const evStop = fs.existsSync(path.join(fx.z3, 'evidence/gate_events.jsonl')) ? fs.readFileSync(path.join(fx.z3, 'evidence/gate_events.jsonl'), 'utf8') : '';
  record('K', 'KS', 'kernel-stop.sh が Z3 に STOP を置き、停止を出来事に記録する', ks.status === 0 && fs.existsSync(path.join(fx.z3, 'STOP')) && /"type":"kernel_stop"/.test(evStop), `exit ${ks.status}`);
  for (const [id, title, got, want] of stopped) record('K', id, title, got.decision === want, got.decision === want ? '' : `実際は ${got.decision}`);
  const k1 = stopped[0][2];
  record('K', 'K8', '拒否の理由に停止の理由が入る', /停止中/.test(k1.reason) && /不審な操作/.test(k1.reason));

  // 再開の前の安全確認（kernel-resume.sh。verify-chain は Z3 の hooks から呼ばれる）
  fs.copyFileSync(IMPL.verify, path.join(fx.z3, 'hooks/verify-chain.mjs'));
  const evf = path.join(fx.z3, 'evidence/gate_events.jsonl');
  const resume = (...a) => sh('bash', [path.join(IMPL.bin, 'kernel-resume.sh'), '再開の試験', ...a], { env: { ...process.env, ...UTF8, VGDD_Z3_DIR: fx.z3, VGDD_REPO: fx.main } });
  const ev = fs.readFileSync(fx.evidence, 'utf8');
  const lines = ev.trimEnd().split('\n');
  lines[1] = lines[1].replace(/"decision":"(allow|deny)"/, (m, d) => `"decision":"${d === 'allow' ? 'deny' : 'allow'}"`);
  fs.writeFileSync(fx.evidence, lines.join('\n') + '\n');
  let r = resume();
  record('K', 'R1', '証拠ストアが改ざんされていれば再開しない（STOP は残る）', r.status === 70 && /証拠ストアの検証に失敗/.test(r.stderr) && fs.existsSync(path.join(fx.z3, 'STOP')), `exit ${r.status} ${r.stderr.trim().slice(0, 80)}`);
  fs.writeFileSync(fx.evidence, ev);
  // 停止中の main への直接コミット。日付を停止より前に偽っても、停止の時点の SHA からの範囲で見つける
  const r2 = sh('git', ['-C', fx.main, '-c', 'user.name=intruder', '-c', 'user.email=i@example.invalid', 'commit', '-q', '--allow-empty', '-m', '停止中の main への直接コミット'],
    { env: { ...process.env, GIT_AUTHOR_DATE: '2020-01-01T00:00:00+0900', GIT_COMMITTER_DATE: '2020-01-01T00:00:00+0900' } });
  if (r2.status !== 0) throw new Error('侵入のコミットを作れない');
  r = resume();
  record('K', 'R2', '停止の後に main が進んでいれば、日付を偽っても再開しない', r.status === 70 && /main が進んでいる/.test(r.stderr) && /intruder/.test(r.stderr), `exit ${r.status} ${r.stderr.trim().slice(0, 80)}`);
  r = resume('--accept-main');
  const stopsDir = path.join(fx.z3, 'evidence/stops');
  const resumed = (fs.existsSync(evf) ? fs.readFileSync(evf, 'utf8') : '').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.type === 'kernel_resume');
  record('K', 'R3', 'オーナーが確かめて --accept-main で再開すると、STOP を消さずに移し、確かめた結果を記録する',
    r.status === 0 && !fs.existsSync(path.join(fx.z3, 'STOP')) && fs.existsSync(path.join(fx.z3, 'evidence/stops')) && fs.readdirSync(path.join(fx.z3, 'evidence/stops')).length === 1 && resumed?.checks?.accepted_main === true, `exit ${r.status} ${r.stderr.slice(0, 120)}`);
  const after = hook(fx, { tool: 'Write', input: { file_path: path.join(fx.wt, 'src/lib/a.ts'), content: 'x' }, ...w });
  record('K', 'R4', '再開の後は作業員の Write がまた通る', after.decision === 'allow');
}

function groupK2() {
  const mk = (name) => {
    const fx = fixture(name);
    fs.copyFileSync(IMPL.verify, path.join(fx.z3, 'hooks/verify-chain.mjs'));
    hook(fx, { tool: 'Read', input: { file_path: path.join(fx.main, 'CLAUDE.md') }, cwd: fx.main }); // 証拠ストアに1行（本番と同じく空ではない状態にする）
    const env = { ...process.env, ...UTF8, VGDD_Z3_DIR: fx.z3, VGDD_REPO: fx.main };
    return { fx, env, stop: () => sh('bash', [path.join(IMPL.bin, 'kernel-stop.sh'), '試験'], { env }),
      resume: (...a) => sh('bash', [path.join(IMPL.bin, 'kernel-resume.sh'), '試験', ...a], { env }) };
  };
  // 作者名を gate-runner と偽ったコミット
  let k = mk('k2a'); k.stop();
  git(k.fx.main, '-c', 'user.name=gate-runner', 'commit', '-q', '--allow-empty', '-m', '裁判所を名乗るコミット');
  let r = k.resume();
  record('K', 'R5', '作者名を gate-runner と偽ったコミットも、停止の後の前進として再開を止める', r.status === 70 && /main が進んでいる/.test(r.stderr), `exit ${r.status}`);
  // 巻き戻し
  k = mk('k2b');
  git(k.fx.main, 'commit', '-q', '--allow-empty', '-m', '停止の前の最後のコミット');
  k.stop();
  git(k.fx.main, 'reset', '-q', '--hard', 'HEAD~1');
  r = k.resume('--accept-main');
  record('K', 'R6', '停止の後に main が巻き戻されていれば、--accept-main でも再開しない', r.status === 70 && /祖先ではない/.test(r.stderr), `exit ${r.status} ${r.stderr.trim().slice(0, 60)}`);
  // 未追跡のファイル
  k = mk('k2c'); k.stop();
  write(path.join(k.fx.main, 'src/lib/planted.ts'), 'export {}\n');
  r = k.resume();
  record('K', 'R7', 'main の checkout に未追跡のファイルがあれば再開しない', r.status === 70 && /未追跡/.test(r.stderr), `exit ${r.status}`);
  // 錠：停止・再開が同時に動かない
  k = mk('k2d'); fs.mkdirSync(path.join(k.fx.z3, '.kernel.lock'));
  r = k.stop();
  record('K', 'R8', '停止と再開は錠で直列化される（錠があれば待たずに断る）', r.status === 75 && !fs.existsSync(path.join(k.fx.z3, 'STOP')), `exit ${r.status}`);
  // release は停止中に統合しない
  k = mk('k2e'); k.stop();
  r = sh('bash', [path.join(IMPL.bin, 'release.sh'), 'T-900'], { env: k.env });
  record('K', 'R9', '停止中は release.sh（朝の統合）が動かない', r.status === 70 && /停止/.test(r.stderr), `exit ${r.status}`);
}

// ---- H 行政の長の main へのコミット（docs/ の下だけ） --------------------------------------------
function groupH() {
  const fx = fixture('h');
  const h = { agent_type: null, cwd: fx.main };
  const stageReset = () => git(fx.main, 'reset', '-q');
  const stage = (f, c) => { write(path.join(fx.main, f), c); git(fx.main, 'add', f); };
  const cases = [
    ['H1', '票（docs/）だけをステージして git commit -m', () => stage('docs/tasks/T-900-probe.md', TICKET('T-900', { status: 'ready' })), 'git commit -m "T-900 を起票"', 'allow'],
    ['H2', 'ソース（src/）をステージして git commit -m', () => stage('src/lib/a.ts', 'export const v = 9;\n'), 'git commit -m "直接の修正"', 'deny'],
    ['H3', '同じコマンドで src/ を git add してコミット', () => {}, 'git add src/lib/a.ts && git commit -m x', 'deny'],
    ['H4', '同じコマンドで docs/ を git add してヒアドキュメントの本文でコミット', () => {}, "git add docs/notes.md && git commit -m \"$(cat <<'EOF'\n記録\nEOF\n)\"", 'allow'],
    ['H5', 'git commit -a', () => {}, 'git commit -a -m x', 'deny'],
    ['H6', 'git commit --amend', () => {}, 'git commit --amend -m x', 'deny'],
    ['H7', 'git -c user.name=gate-runner commit（作者名を偽る）', () => {}, 'git -c user.name=gate-runner commit -m x', 'deny'],
    ['H8', 'git add -A してコミット', () => {}, 'git add -A && git commit -m x', 'deny'],
    ['H9', 'パスを指定したコミット（git commit src/…）', () => {}, 'git commit -m x src/lib/a.ts', 'deny'],
  ];
  for (const [id, title, prep, cmd, want] of cases) {
    stageReset(); prep();
    const got = hook(fx, { tool: 'Bash', input: { command: cmd }, ...h });
    record('H', id, `行政の長が main で：${title} → ${want}`, got.decision === want, got.decision === want ? '' : `実際は ${got.decision}：${got.reason.slice(0, 100)}`);
  }
  stageReset();
  // 作業員は作者名を変えても main にコミットできない（cwd が worktree の外）
  const w = hook(fx, { tool: 'Bash', input: { command: 'git -c user.name=x commit -m x' }, agent_type: 'worker', cwd: fx.main });
  record('H', 'H10', '作業員が main の checkout で git -c … commit → deny', w.decision === 'deny');
}

// ---- N 夜間の代行（dry-run） -------------------------------------------------------------------
function groupN() {
  const fx = fixture('n');
  commitTicket(fx, 'T-940', { status: 'ready' });
  commitTicket(fx, 'T-941', { status: 'ready' });
  if (fs.existsSync(path.join(IMPL.bin, 'spec-digest.mjs'))) fs.copyFileSync(path.join(IMPL.bin, 'spec-digest.mjs'), path.join(fx.z3, 'bin/spec-digest.mjs'));
  const d = digest(fx, 'main', 'docs/tasks/T-940-probe.md').out || 'sha256:unavailable';
  write(path.join(fx.z3, 'evidence/spec_approvals.jsonl'), JSON.stringify({ task: 'T-940', digest: d, approved_by: 'owner' }) + '\n');
  write(path.join(fx.z3, 'night/queue.json'), JSON.stringify({ tickets: ['T-941', 'T-940'], limits: { until: '23:59', max_tickets: 2 } }));
  touch(path.join(fx.z3, 'evidence/gate_events.jsonl'));
  // gate-runner が動いていることの代わり（night-runner は pgrep で gate-runner.sh を探す）
  const fake = path.join(fx.base, 'gate-runner.sh'); write(fake, '#!/bin/bash\nsleep 120\n'); fs.chmodSync(fake, 0o755);
  const bg = spawn('bash', [fake], { detached: true, stdio: 'ignore' });
  const run = () => sh('bash', [path.join(IMPL.bin, 'night-runner.sh'), '--repo', fx.main, '--dry-run'], { cwd: fx.main, env: { ...process.env, ...UTF8, VGDD_Z3_DIR: fx.z3 }, timeout: 120000 });
  try {
    let r = run();
    const out = r.stdout + r.stderr;
    record('N', 'N1', 'キューの until が効く（起動の記録が until=23:59）', /until=23:59/.test(out), (out.match(/until=\S*/) || ['until がない'])[0]);
    record('N', 'N2', '仕様が未承認の票（T-941）は作業員に渡さず飛ばす', /T-941: 仕様がオーナーに承認されていない/.test(out));
    record('N', 'N3', '承認済みの票（T-940）はレーンに割り当てる（陽性の対照）', /（dry-run）T-940 をレーンに割り当てる/.test(out));
    record('N', 'N4', '並行の既定は1（逐次）', /parallel=1 /.test(out));
    write(path.join(fx.z3, 'STOP'), '試験の停止\n');
    r = run();
    const out2 = r.stdout + r.stderr;
    record('N', 'N5', 'Kernel の停止中は票を取らない', /停止: Kernel の停止中/.test(out2) && !/（dry-run）T-940/.test(out2));
  } finally { try { process.kill(-bg.pid); } catch { /* 終わっている */ } }
}

// ---- L 朝の統合（release.sh） ------------------------------------------------------------------
function releaseFixture(name, { audit = 0, otherCandidate = false, heldExtra = {}, verdictFindings = [] } = {}) {
  const fx = fixture(name);
  const id = 'T-950';
  commitTicket(fx, id, {});
  const mainAt = git(fx.main, 'rev-parse', 'main');
  const mk = (br, file, body) => {
    const wt = path.join(fx.base, `wt-${br.replace(/\W/g, '')}`);
    git(fx.main, 'worktree', 'add', '-q', '-b', br, wt, 'main');
    write(path.join(wt, file), body); git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', `${br} の実装`);
    return git(wt, 'rev-parse', 'HEAD');
  };
  const req = mk(`task/${id}`, 'src/lib/a.ts', 'export const v = 2;\n');
  const cand = otherCandidate ? mk('task/other', 'src/lib/a.ts', 'export const v = 99;\n') : req;
  const held = { task: id, request: req, candidate: cand, main_at_check: mainAt, judge: 'APPROVED', codex: 'APPROVED', security: 'SKIPPED', no_codex: false, route: 'agreed', majors: '0/0', security_required: false, law: 'p0.4.3', ...heldExtra };
  write(path.join(fx.z3, 'evidence/held.jsonl'), JSON.stringify(held) + '\n');
  // p0.4.3：release は Z3 の判定の記録に照合し直すので、held と同じ結論の記録を置く（verdictFindings で重大な指摘を入れられる）
  const c12 = cand.slice(0, 12);
  write(path.join(fx.z3, `evidence/verdicts/${id}-${c12}.json`), JSON.stringify({ final_verdict: held.judge, judge_parse_ok: true, judge: { findings: verdictFindings } }) + '\n');
  write(path.join(fx.z3, `evidence/verdicts/${id}-${c12}-codex-judge.json`), JSON.stringify({ final_verdict: held.codex, parse_ok: true, codex: { findings: [] } }) + '\n');
  touch(path.join(fx.z3, 'evidence/gate_events.jsonl'));
  write(path.join(fx.z3, 'bin/sandboxed-run.sh'), `#!/bin/bash\nexit ${audit}\n`); fs.chmodSync(path.join(fx.z3, 'bin/sandboxed-run.sh'), 0o755);
  const env = { ...process.env, ...UTF8, VGDD_Z3_DIR: fx.z3, VGDD_REPO: fx.main };
  return { fx, id, req, before: git(fx.main, 'rev-parse', 'main'), run: () => sh('bash', [path.join(IMPL.bin, 'release.sh'), id], { env, cwd: fx.main, timeout: 120000 }) };
}
function groupL() {
  let L = releaseFixture('l1');
  let r = L.run();
  const inMain = sh('git', ['-C', L.fx.main, 'merge-base', '--is-ancestor', L.req, 'main']).status === 0;
  const st = (sh('git', ['-C', L.fx.main, 'show', `main:docs/tasks/${L.id}-probe.md`]).stdout.match(/^status: (.*)$/m) || [])[1];
  const ev = fs.readFileSync(path.join(L.fx.z3, 'evidence/gate_events.jsonl'), 'utf8');
  record('L', 'L1', '夜に判定した変更と同じなら統合し、票を merged にしてコミットし、merged（via release）を記録する（陽性の対照）',
    r.status === 0 && inMain && st === 'merged' && /"via":"release"/.test(ev) && !sh('git', ['-C', L.fx.main, 'status', '--porcelain']).stdout.trim(), `exit ${r.status} status=${st} ${r.stderr.trim().slice(0, 80)}`);
  const head1 = git(L.fx.main, 'rev-parse', 'main');
  r = L.run();
  record('L', 'L2', 'すでに統合済みの票をもう一度 release しても何もしない（取り消さない）', r.status === 0 && /統合済み/.test(r.stdout) && git(L.fx.main, 'rev-parse', 'main') === head1, `exit ${r.status}`);
  L = releaseFixture('l3', { otherCandidate: true });
  r = L.run();
  record('L', 'L3', '入る変更が夜に判定した候補と違えば統合せず、main を元に戻す', r.status === 1 && /判定した変更と違う/.test(r.stderr) && git(L.fx.main, 'rev-parse', 'main') === L.before, `exit ${r.status}`);
  L = releaseFixture('l4'); fs.mkdirSync(path.join(L.fx.z3, '.release.lock'));
  r = L.run();
  record('L', 'L4', 'release.sh は錠で直列化される（別の release が動いていれば断り、main に触れない）', r.status === 75 && git(L.fx.main, 'rev-parse', 'main') === L.before, `exit ${r.status}`);
  L = releaseFixture('l5', { audit: 1 });
  r = L.run();
  record('L', 'L5', '組み合わせた木の監査が不合格なら統合を取り消す', r.status === 1 && /監査が不合格/.test(r.stderr) && git(L.fx.main, 'rev-parse', 'main') === L.before, `exit ${r.status}`);
  // p0.4.3（Codex の監査 #3）：前の版の held（版の印がない）と、Codex の判定が欠けた held は統合しない
  L = releaseFixture('l6', { heldExtra: { law: undefined } });
  r = L.run();
  record('L', 'L6', '版の印のない（p0.4.2 以前の）夜間の合格の記録は統合しない（Codex の欠落を SKIPPED として合格にしえた）', r.status === 1 && /前の版/.test(r.stderr) && git(L.fx.main, 'rev-parse', 'main') === L.before, `exit ${r.status}`);
  L = releaseFixture('l7', { heldExtra: { codex: 'SKIPPED', no_codex: false } });
  r = L.run();
  record('L', 'L7', '--no-codex でないのに Codex が SKIPPED の夜間の合格の記録は統合しない', r.status === 1 && /成り立った司法の判定がない/.test(r.stderr) && git(L.fx.main, 'rev-parse', 'main') === L.before, `exit ${r.status}`);
  L = releaseFixture('l10', { heldExtra: { route: 'ruling', judge: 'CHANGES_REQUIRED', codex: 'APPROVED' } });
  r = L.run();
  record('L', 'L10', '裁定で通った夜間の合格の記録でも、この申請へのオーナーの裁定が Z3 になければ統合しない', r.status === 1 && /裁定が見つからない/.test(r.stderr) && git(L.fx.main, 'rev-parse', 'main') === L.before, `exit ${r.status}`);
  L = releaseFixture('l11', { heldExtra: { security_required: true, security: 'SKIPPED' } });
  r = L.run();
  record('L', 'L11', 'セキュリティ審査が必須の票で、その判定がない夜間の合格の記録は統合しない', r.status === 1 && /成り立った司法の判定がない/.test(r.stderr) && git(L.fx.main, 'rev-parse', 'main') === L.before, `exit ${r.status}`);
  // 一続き（Codex の3回目の監査 #3）：本物の裁判所が --hold で書いた held を、本物の release が読んで統合する
  const gl = gateFixture('l12', { ticket: { security: true } });
  const gh = runGate(gl, 'APPROVED', ['--hold']);
  const rl = sh('bash', [path.join(IMPL.bin, 'release.sh'), gl.id], { env: { ...process.env, ...UTF8, VGDD_Z3_DIR: gl.z3, VGDD_REPO: gl.main }, cwd: gl.main, timeout: 120000 });
  const heldRec = (fs.readFileSync(path.join(gl.z3, 'evidence/held.jsonl'), 'utf8').trim().split('\n').pop() || '');
  record('L', 'L12', '一続き：裁判所が夜間に書いた held（security 必須の票、3つの司法が APPROVED）を release が確かめて統合する（陽性の対照）',
    gh.events.some((e) => e.type === 'held') && rl.status === 0 && sh('git', ['-C', gl.main, 'merge-base', '--is-ancestor', gl.head, 'main']).status === 0
      && /"route":"agreed"/.test(heldRec) && /"security_required":true/.test(heldRec) && /"security":"APPROVED"/.test(heldRec), `held=${heldRec.slice(0, 120)} exit=${rl.status} ${rl.stderr.trim().slice(0, 100)}`);
  // 一続きの陰性：判定の記録を書き換えて held の security を SKIPPED にしても、release は統合しない
  const gl2 = gateFixture('l13', { ticket: { security: true } });
  runGate(gl2, 'APPROVED', ['--hold']);
  const hp = path.join(gl2.z3, 'evidence/held.jsonl');
  fs.writeFileSync(hp, fs.readFileSync(hp, 'utf8').replace('"security":"APPROVED"', '"security":"SKIPPED"'));
  const rl2 = sh('bash', [path.join(IMPL.bin, 'release.sh'), gl2.id], { env: { ...process.env, ...UTF8, VGDD_Z3_DIR: gl2.z3, VGDD_REPO: gl2.main }, cwd: gl2.main, timeout: 120000 });
  record('L', 'L13', '一続きの陰性：裁判所の held から security の合格を消すと、release は統合しない', rl2.status === 1 && sh('git', ['-C', gl2.main, 'merge-base', '--is-ancestor', gl2.head, 'main']).status !== 0, `exit ${rl2.status}`);
  L = releaseFixture('l14', { heldExtra: { judge: 'CHANGES_REQUIRED', codex: 'APPROVED', route: 'minor_disagreement' }, verdictFindings: [{ severity: 'major', category: 'correctness', file: null, line: null, requirement_id: null, reason: 'x' }] });
  r = L.run();
  record('L', 'L14', 'minor の不一致として held になった記録でも、判定の記録に重大な指摘があれば統合しない（held の自己申告を信用しない）', r.status === 1 && /重大な指摘/.test(r.stderr) && git(L.fx.main, 'rev-parse', 'main') === L.before, `exit ${r.status} ${r.stderr.trim().slice(0, 80)}`);
  L = releaseFixture('l15', { heldExtra: { judge: 'APPROVED' } });
  fs.writeFileSync(path.join(L.fx.z3, `evidence/verdicts/${L.id}-${L.req.slice(0, 12)}.json`), JSON.stringify({ final_verdict: 'CHANGES_REQUIRED', judge_parse_ok: true, judge: { findings: [] } }) + '\n');
  r = L.run();
  record('L', 'L15', 'held の結論が Z3 の判定の記録と違えば統合しない', r.status === 1 && /判定の記録が held と合わない/.test(r.stderr) && git(L.fx.main, 'rev-parse', 'main') === L.before, `exit ${r.status}`);
  L = releaseFixture('l8', { heldExtra: { law: 'unknown' } });
  r = L.run();
  record('L', 'L8', '未知の版の印の夜間の合格の記録は統合しない', r.status === 1 && /未知の版/.test(r.stderr) && git(L.fx.main, 'rev-parse', 'main') === L.before, `exit ${r.status}`);
  L = releaseFixture('l9', { heldExtra: { security: 'CHANGES_REQUIRED' } });
  r = L.run();
  record('L', 'L9', 'セキュリティ審査が合格でない夜間の合格の記録は統合しない', r.status === 1 && /成り立った司法の判定がない/.test(r.stderr) && git(L.fx.main, 'rev-parse', 'main') === L.before, `exit ${r.status}`);
}

// ---- B 予算の台帳（p0.4.9。SPEC §9、D-66・D-67） -------------------------------------------------
function groupB() {
  const ledger = path.join(IMPL.bin, 'ledger.mjs');
  const meter = path.join(IMPL.bin, 'metered.sh');
  if (!fs.existsSync(ledger) || !fs.existsSync(meter)) { record('B', 'B0', '予算の台帳（ledger.mjs・metered.sh）が実装にある', false, 'ない'); return; }
  record('B', 'B0', '予算の台帳（ledger.mjs・metered.sh）が実装にある', true);
  const mk = (limits = {}) => {
    const z3 = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vgdd-conf-b-')));
    write(path.join(z3, 'budget/limits.json'), JSON.stringify({ schema: 'vgdd.budget-limits.v1', period_id: 'pB', until: '2099-01-01T00:00:00+09:00', tokens_total: 1000, tokens_per_ticket: 600, tokens_per_run: 400, judge_calls: 2, workers: 1, attempts_per_ticket: 2, set_at: '2026-11-08T00:00:00+09:00', ...limits }) + '\n');
    return z3;
  };
  const env = (z3, extra = {}) => ({ ...process.env, ...UTF8, VGDD_Z3_DIR: z3, ...extra });
  const L = (z3, ...a) => sh('node', [ledger, ...a], { env: env(z3) });
  // 偽の CLI：呼ばれた回数をファイルに残し、引数1のファイルの中身を出し、引数2の終了コードで終わる
  const fakeCli = (z3) => { const f = path.join(z3, 'fake-cli.sh'); write(f, `#!/bin/bash\necho called >> '${path.join(z3, 'called.log')}'\nstdin="$(cat)"; [ -n "$stdin" ] && printf '%s' "$stdin" > '${path.join(z3, 'stdin.txt')}'\n[ -n "\${1:-}" ] && cat "$1"\nexit "\${2:-0}"\n`); fs.chmodSync(f, 0o755); return f; };
  const calls = (z3) => { try { return fs.readFileSync(path.join(z3, 'called.log'), 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
  const M = (z3, req, a, args = [], input = '') => sh('bash', [meter, ...a, '--', fakeCli(z3), ...args], { env: env(z3, req ? { VGDD_REQ_ID: req } : {}), input });
  const st = (z3) => { const r = L(z3, 'status', '--json'); try { return JSON.parse(r.stdout); } catch { return null; } };
  const usageFile = (z3, obj, name = 'u.json') => { const f = path.join(z3, name); write(f, typeof obj === 'string' ? obj : JSON.stringify(obj)); return f; };
  const begins = (z3) => { try { return fs.readFileSync(path.join(z3, 'budget/ledger.jsonl'), 'utf8').split('\n').filter((l) => l.includes('"type":"begin"')).length; } catch { return 0; } };

  // B1 上限の中の起動・利用量の精算・標準入力と終了コードの受け渡し（陽性の対照）
  let z = mk();
  let r = M(z, 'b1', ['worker', 'T-950', 'auto', 'claude'], [usageFile(z, { usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 } }), '3'], '標準入力の中身');
  let s = st(z);
  const stdinOk = (() => { try { return fs.readFileSync(path.join(z, 'stdin.txt'), 'utf8') === '標準入力の中身'; } catch { return false; } })();
  record('B', 'B1', '上限の中の起動は通り、読めた利用量（キャッシュの欄を含む）で精算する。標準入力と終了コードを受け渡す', r.status === 3 && calls(z) === 1 && stdinOk && s?.tokens.settled === 20 && s?.tokens.reserved === 0, `rc=${r.status} calls=${calls(z)} stdin=${stdinOk} settled=${s?.tokens.settled}`);

  // B2 全体の残りの不足（拒んだら CLI を起動しない）
  M(z, null, ['worker', 'T-951', 'auto', 'none']); M(z, null, ['worker', 'T-952', 'auto', 'none']); // 20＋400＋400＝820
  const before2 = calls(z);
  const r2 = M(z, null, ['worker', 'T-953', 'auto', 'none']);
  record('B', 'B2', '全体の残りが足りない起動は拒み、CLI を起動しない（終了 75、tokens_total）', r2.status === 75 && /tokens_total/.test(r2.stderr) && calls(z) === before2, `rc=${r2.status} ${r2.stderr.trim()} calls+${calls(z) - before2}`);

  // B3 利用量が読めない・不正な値は 0 にしない
  z = mk();
  M(z, null, ['judge', 'T-953', '100', 'claude'], [usageFile(z, 'not json', 'a.txt')]);
  M(z, null, ['judge', 'T-953', '100', 'claude'], [usageFile(z, { usage: { input_tokens: -1, output_tokens: 1 } }, 'b.json')]);
  s = st(z);
  record('B', 'B3', '利用量が読めない・負の数などの不正な値の呼び出しは、予約の全量を使ったものとして数える（0 にしない）', s?.tokens.settled === 200 && s?.tokens.unknown_runs === 2, `settled=${s?.tokens.settled} unknown=${s?.tokens.unknown_runs}`);

  // B4 同じ要求の二度目
  const z4a = mk();
  M(z4a, 'dup', ['judge', 'T-953', '100', 'none']);
  const rd = M(z4a, 'dup', ['judge', 'T-953', '100', 'none']);
  record('B', 'B4', '同じ要求の ID の二度目の起動は拒み、CLI を起動しない（duplicate_request）', rd.status === 75 && /duplicate_request/.test(rd.stderr) && calls(z4a) === 1, `rc=${rd.status} calls=${calls(z4a)}`);

  // B5 精算の二度目
  const z4 = mk();
  const run4 = L(z4, 'begin', '--kind', 'judge', '--task', 'T-954', '--req', 'q4', '--tokens', '100').stdout.trim();
  L(z4, 'finish', '--run', run4, '--code', '0', '--format', 'none');
  const again = L(z4, 'finish', '--run', run4, '--code', '0', '--usage-file', usageFile(z4, { usage: { input_tokens: 1, output_tokens: 1 } }), '--format', 'claude');
  s = st(z4);
  record('B', 'B5', '精算の二度目は効かない（数え直しで戻さない）', again.stdout.trim() === 'duplicate' && s?.tokens.settled === 100, `${again.stdout.trim()} settled=${s?.tokens.settled}`);

  // B6 同時の予約
  z = mk({ tokens_total: 100000, tokens_per_ticket: 100000 });
  const res6 = path.join(z, 'b6.txt');
  const cmds = ['T-955', 'T-956', 'T-957'].map((t) => `( VGDD_Z3_DIR='${z}' node '${ledger}' begin --kind worker --task ${t} --req c-${t} --tokens 100 >/dev/null 2>&1; echo $? >> '${res6}' ) & `).join('');
  sh('bash', ['-c', `${cmds} wait`], { env: env(z) });
  const codes = fs.readFileSync(res6, 'utf8').split('\n').filter(Boolean).sort();
  s = st(z);
  record('B', 'B6', '同時の予約でも作業員の枠（1）を超えない（3つ同時に申し込み、成功1・拒否2、台帳の予約も1件）', codes.join(',') === '0,75,75' && begins(z) === 1 && s?.workers.active === 1, `codes=${codes.join(',')} begins=${begins(z)}`);

  // B7 起動中のまま記録が止まった実行（生死が不明）は、枠と予約を保つ
  const r7 = L(z, 'begin', '--kind', 'worker', '--task', 'T-958', '--req', 'after-crash', '--tokens', '100');
  record('B', 'B7', '起動中のまま記録が止まった実行は、生死が不明として枠と予約を保つ', r7.status === 75 && /workers/.test(r7.stderr) && st(z)?.tokens.reserved === 100, `rc=${r7.status} ${r7.stderr.trim()}`);

  // B8 起動の記録の後：生きていれば枠を保ち精算させない。終わっていれば予約の全量を消費として数え、枠を解く
  z = mk({ tokens_total: 100000, tokens_per_ticket: 100000 });
  // 試験のプロセスの子にしない（子だと終わった後もゾンビとして残り、生きていると見える）。bash が終わると sleep は init に引き取られる
  const sleeperPid = Number(sh('bash', ['-c', 'sleep 30 >/dev/null 2>&1 & echo $!']).stdout.trim());
  const run8 = L(z, 'begin', '--kind', 'worker', '--task', 'T-959', '--req', 'alive', '--tokens', '100').stdout.trim();
  L(z, 'started', '--run', run8, '--pid', String(sleeperPid));
  const f8 = L(z, 'finish', '--run', run8, '--code', '0', '--format', 'none');
  const blocked8 = L(z, 'begin', '--kind', 'worker', '--task', 'T-960', '--req', 'next', '--tokens', '100');
  record('B', 'B8', '起動の記録のプロセスが生きている間は、精算を拒み（still_running）、作業員の枠を保つ', f8.status === 75 && /still_running/.test(f8.stderr) && blocked8.status === 75 && /workers/.test(blocked8.stderr), `${f8.stderr.trim()} / ${blocked8.stderr.trim()}`);
  try { process.kill(sleeperPid, 'SIGKILL'); } catch { /* 終わっている */ }
  sh('bash', ['-c', 'sleep 0.5']);
  s = st(z);
  const after8 = L(z, 'begin', '--kind', 'worker', '--task', 'T-960', '--req', 'next2', '--tokens', '100');
  record('B', 'B9', '起動の記録のプロセスが終わったのに精算がない実行は、予約の全量を消費として数え、枠を解く', s?.runs.ended_unrecorded === 1 && s?.tokens.settled === 100 && after8.status === 0, `ended=${s?.runs.ended_unrecorded} settled=${s?.tokens.settled} next=${after8.status}`);

  // B10 同じ票の作業員の重複と、試行の上限
  z = mk({ workers: 5, tokens_total: 100000, tokens_per_ticket: 100000 });
  const dupRun = L(z, 'begin', '--kind', 'worker', '--task', 'T-961', '--req', 'w1', '--tokens', '100');
  const dup2 = L(z, 'begin', '--kind', 'worker', '--task', 'T-961', '--req', 'w2', '--tokens', '100');
  record('B', 'B10', '同じ票の作業員が動いている間は、その票の次の作業員を起動しない（worker_running）', dupRun.status === 0 && dup2.status === 75 && /worker_running/.test(dup2.stderr), dup2.stderr.trim());
  const z11 = mk({ workers: 5, tokens_total: 100000, tokens_per_ticket: 100000 });
  for (const q of ['a1', 'a2']) M(z11, q, ['worker', 'T-962', '100', 'none']);
  const r11 = M(z11, 'a3', ['worker', 'T-962', '100', 'none']);
  record('B', 'B11', '同じ票の作業員の試行は上限（attempts_per_ticket）で止め、CLI を起動しない', r11.status === 75 && /attempts/.test(r11.stderr) && calls(z11) === 2, `rc=${r11.status} calls=${calls(z11)}`);

  // B12 司法の回数・1回の予約の上限・1票の上限
  z = mk();
  for (const q of ['j1', 'j2']) M(z, q, ['codex', 'T-963', '10', 'none']);
  const r12 = M(z, 'j3', ['judge', 'T-963', '10', 'claude']);
  record('B', 'B12', '司法の呼び出しは期間の上限（judge_calls）で止める（judge と Codex を合わせて数える）。CLI を起動しない', r12.status === 75 && /judge_calls/.test(r12.stderr) && calls(z) === 2, `rc=${r12.status} calls=${calls(z)}`);
  const zr = mk();
  const r13 = M(zr, null, ['judge', 'T-963', '401', 'none']);
  const zt = mk({ tokens_per_ticket: 500, workers: 5 });
  M(zt, null, ['judge', 'T-964', '400', 'none']);
  const r14 = M(zt, null, ['codex', 'T-964', '200', 'none']);
  record('B', 'B13', '1回の予約は tokens_per_run を超えられない（数で指定しても。tokens_run）', r13.status === 75 && /tokens_run/.test(r13.stderr) && calls(zr) === 0, r13.stderr.trim());
  record('B', 'B14', '1票の使用量と予約の合計は tokens_per_ticket を超えられない（tokens_ticket）', r14.status === 75 && /tokens_ticket/.test(r14.stderr), r14.stderr.trim());

  // B15〜B20 停止中・期間の外・上限の欠けと形の違い・台帳の改ざん・途中切れ・行の切り詰め（どれも CLI を起動しない）
  const refuse = (z3, re) => { const before = calls(z3); const x = M(z3, null, ['judge', 'T-965', '10', 'none']); return { ok: x.status === 75 && re.test(x.stderr) && calls(z3) === before, d: x.stderr.trim() }; };
  z = mk(); write(path.join(z, 'STOP'), '試験\n');
  let t = refuse(z, /stopped/); record('B', 'B15', '停止中は起動を拒む（stopped）', t.ok, t.d);
  t = refuse(mk({ until: '2000-01-01T00:00:00+09:00' }), /period_over/); record('B', 'B16', '期間の外は起動を拒む（period_over）', t.ok, t.d);
  const zc = mk(); fs.rmSync(path.join(zc, 'budget/limits.json'));
  const zi = mk({ tokens_total: -1 });
  const tc = refuse(zc, /limits_missing/); const ti = refuse(zi, /limits_invalid/);
  record('B', 'B17', '上限のファイルがない・形が違うときは起動を拒む（fail-closed）', tc.ok && ti.ok, `${tc.d} / ${ti.d}`);
  const zd = mk(); M(zd, 'x1', ['judge', 'T-965', '10', 'none']);
  const lf = path.join(zd, 'budget/ledger.jsonl');
  fs.writeFileSync(lf, fs.readFileSync(lf, 'utf8').replace('"reserve_tokens":10', '"reserve_tokens":1'));
  t = refuse(zd, /ledger_broken/); record('B', 'B18', '台帳の書き換え（鎖の不一致）を見つけたら起動を拒む', t.ok, t.d);
  const ze = mk(); M(ze, 'x2', ['judge', 'T-965', '10', 'none']);
  fs.appendFileSync(path.join(ze, 'budget/ledger.jsonl'), '{"broken"');
  t = refuse(ze, /ledger_broken/); record('B', 'B19', '台帳の途中切れ（改行のない行）を見つけたら起動を拒む', t.ok, t.d);
  const zf = mk(); M(zf, 'x3', ['judge', 'T-965', '10', 'none']); M(zf, 'x4', ['judge', 'T-966', '10', 'none']);
  const lines = fs.readFileSync(path.join(zf, 'budget/ledger.jsonl'), 'utf8').split('\n').filter(Boolean);
  fs.writeFileSync(path.join(zf, 'budget/ledger.jsonl'), lines.slice(0, -2).join('\n') + '\n');
  const tf = refuse(zf, /ledger_broken/);
  const zg = mk(); M(zg, 'x5', ['judge', 'T-965', '10', 'none']); fs.rmSync(path.join(zg, 'budget/ledger.jsonl'));
  const tg = refuse(zg, /ledger_broken/);
  record('B', 'B20', '行ごとの切り詰め・台帳の消失を、最後の番号とハッシュの記録で見つけて拒む', tf.ok && tg.ok, `${tf.d} / ${tg.d}`);

  // B21 実際の消費が予約を超えたら、後続を止める
  z = mk({ tokens_total: 100000, tokens_per_ticket: 100000, workers: 5, attempts_per_ticket: 5 });
  M(z, 'o1', ['judge', 'T-967', '10', 'claude'], [usageFile(z, { usage: { input_tokens: 50, output_tokens: 5 } })]);
  t = refuse(z, /overrun/); record('B', 'B21', '実際の消費が予約を超えたら超過として記録し、後続の起動を止める（overrun）', t.ok, t.d);

  // B22 期間を変えても、動いている作業員と予約は消えない
  z = mk({ workers: 1, tokens_total: 100000, tokens_per_ticket: 100000 });
  L(z, 'begin', '--kind', 'worker', '--task', 'T-968', '--req', 'p1', '--tokens', '100');
  write(path.join(z, 'budget/limits.json'), JSON.stringify({ schema: 'vgdd.budget-limits.v1', period_id: 'pB2', until: '2099-01-01T00:00:00+09:00', tokens_total: 100000, tokens_per_ticket: 100000, tokens_per_run: 400, judge_calls: 2, workers: 1, attempts_per_ticket: 2, set_at: '2026-11-08T01:00:00+09:00' }) + '\n');
  const r22 = L(z, 'begin', '--kind', 'worker', '--task', 'T-969', '--req', 'p2', '--tokens', '100');
  record('B', 'B22', '期間を変えても、前の期間の起動中の作業員の枠と予約は消えない', r22.status === 75 && /workers/.test(r22.stderr), r22.stderr.trim());

  // B23 窓口が時間切れ（ALRM）を受けたら、子をプロセス群ごと終わらせてから精算する
  z = mk({ workers: 2, tokens_total: 100000, tokens_per_ticket: 100000 });
  const longCli = path.join(z, 'long.sh'); write(longCli, `#!/bin/bash\n( sleep 60 ) &\necho $! > '${path.join(z, 'grandchild.pid')}'\nsleep 60\n`); fs.chmodSync(longCli, 0o755);
  const r23 = sh('perl', ['-e', 'alarm shift; exec @ARGV or exit 127', '2', 'bash', meter, 'worker', 'T-970', '100', 'none', '--', longCli], { env: env(z), timeout: 30000 });
  sh('bash', ['-c', 'sleep 0.5']);
  let gpid = 0; try { gpid = Number(fs.readFileSync(path.join(z, 'grandchild.pid'), 'utf8').trim()); } catch { /* ない */ }
  let gAlive = false; try { process.kill(gpid, 0); gAlive = true; } catch { gAlive = false; }
  s = st(z);
  record('B', 'B23', '窓口が時間切れ（ALRM）を受けたら、子と孫をプロセス群ごと終わらせ、終わりを確かめてから精算する（終了 75）', r23.status === 75 && gpid > 0 && !gAlive && s?.runs.finished === 1 && s?.workers.active === 0, `rc=${r23.status} grandchild_alive=${gAlive} finished=${s?.runs.finished}`);
  if (gAlive) { try { process.kill(gpid, 'SIGKILL'); } catch { /* 終わっている */ } }

  // B25 孫だけが TERM を無視して残る：親が先に終わっても、プロセス群が残る間は枠を解かない。KILL まで待って終わりを確かめる
  z = mk({ workers: 1, tokens_total: 100000, tokens_per_ticket: 100000 });
  const stubborn = path.join(z, 'stubborn.sh'); write(stubborn, `#!/bin/bash\n( trap '' TERM; sleep 60 ) &\necho $! > '${path.join(z, 'g2.pid')}'\nsleep 60\n`); fs.chmodSync(stubborn, 0o755);
  const bg25 = spawn('perl', ['-e', 'alarm shift; exec @ARGV or exit 127', '2', 'bash', meter, 'worker', 'T-972', '100', 'none', '--', stubborn], { env: env(z), stdio: 'ignore' });
  sh('bash', ['-c', 'sleep 3.5']);   // ALRM の後、TERM で親は終わり、孫は残っている時間
  const mid = L(z, 'begin', '--kind', 'worker', '--task', 'T-973', '--req', 'mid', '--tokens', '100');
  sh('bash', ['-c', 'sleep 6']);     // KILL の後
  let g2 = 0; try { g2 = Number(fs.readFileSync(path.join(z, 'g2.pid'), 'utf8').trim()); } catch { /* ない */ }
  let g2Alive = false; try { process.kill(g2, 0); g2Alive = true; } catch { g2Alive = false; }
  s = st(z);
  record('B', 'B25', '孫が TERM を無視して残る間は作業員の枠を解かず、KILL で終わりを確かめてから精算する', mid.status === 75 && /workers/.test(mid.stderr) && !g2Alive && s?.workers.active === 0 && s?.runs.finished === 1, `mid=${mid.stderr.trim()} g2_alive=${g2Alive} active=${s?.workers.active}`);
  if (g2Alive) { try { process.kill(g2, 'SIGKILL'); } catch { /* 終わっている */ } }
  try { bg25.kill('SIGKILL'); } catch { /* 終わっている */ }

  // B26 期間を変えた後も、前の期間の予約はその票の上限に入る
  z = mk({ workers: 5, tokens_total: 100000, tokens_per_ticket: 500 });
  L(z, 'begin', '--kind', 'worker', '--task', 'T-974', '--req', 'q26', '--tokens', '400');
  write(path.join(z, 'budget/limits.json'), JSON.stringify({ schema: 'vgdd.budget-limits.v1', period_id: 'pB3', until: '2099-01-01T00:00:00+09:00', tokens_total: 100000, tokens_per_ticket: 500, tokens_per_run: 400, judge_calls: 5, workers: 5, attempts_per_ticket: 5, set_at: '2026-11-08T01:00:00+09:00' }) + '\n');
  const r26 = L(z, 'begin', '--kind', 'judge', '--task', 'T-974', '--req', 'q26b', '--tokens', '200');
  record('B', 'B26', '期間を変えた後も、前の期間で動いている予約はその票の上限（tokens_per_ticket）に入る', r26.status === 75 && /tokens_ticket/.test(r26.stderr), r26.stderr.trim());

  // B27 本物の review-constitution.sh：形の合わない判定・CLI の失敗は採らない（VIOLATES）。形の合う判定は採る（陽性の対照）
  const fr = fixture('b27');
  const fk = path.join(fr.base, 'fakebin');
  const runRev = (body, rc = 0) => {
    write(path.join(fk, 'claude'), `#!/bin/bash\nprintf '%s' '${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: body })}'\nexit ${rc}\n`); fs.chmodSync(path.join(fk, 'claude'), 0o755);
    const od = path.join(fr.base, `rev-${crypto.randomBytes(3).toString('hex')}`);
    sh('bash', [path.join(IMPL.bin, 'review-constitution.sh'), '--reason', '試験', '--out', od], { cwd: fr.main, env: { ...process.env, ...UTF8, PATH: `${fk}:${process.env.PATH}`, VGDD_Z3_DIR: fr.z3 }, timeout: 60000 });
    const f = fs.existsSync(od) ? fs.readdirSync(od).find((x) => x.endsWith('.json')) : null;
    try { return JSON.parse(fs.readFileSync(path.join(od, f), 'utf8')); } catch { return null; }
  };
  const okBody = JSON.stringify({ schema: 'vgdd.constitutional.v1', verdict: 'CONSISTENT', violations: [], notes: '' });
  const outerErr = (() => { // 外側が is_error の応答で、本文は正しい判定
    write(path.join(fk, 'claude'), `#!/bin/bash\nprintf '%s' '${JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: okBody })}'\n`); fs.chmodSync(path.join(fk, 'claude'), 0o755);
    const od = path.join(fr.base, 'rev-outer'); sh('bash', [path.join(IMPL.bin, 'review-constitution.sh'), '--reason', '試験', '--out', od], { cwd: fr.main, env: { ...process.env, ...UTF8, PATH: `${fk}:${process.env.PATH}`, VGDD_Z3_DIR: fr.z3 }, timeout: 60000 });
    const f = fs.existsSync(od) ? fs.readdirSync(od).find((x) => x.endsWith('.json')) : null; try { return JSON.parse(fs.readFileSync(path.join(od, f), 'utf8')); } catch { return null; } })();
  const prose = runRev(`判定です。${okBody} 以上です`);
  const partial = runRev('{"verdict":"CONSISTENT"}');
  const failed = runRev(JSON.stringify({ schema: 'vgdd.constitutional.v1', verdict: 'CONSISTENT', violations: [], notes: '' }), 1);
  const goodRev = runRev(JSON.stringify({ schema: 'vgdd.constitutional.v1', verdict: 'CONSISTENT', violations: [], notes: '' }));
  record('B', 'B27', '本物の review-constitution.sh：形の欠けた判定・CLI の失敗・外側の失敗の応答・説明の文の付いた判定は採らず VIOLATES、形の合う判定は採る（陽性の対照）',
    partial?.verdict === 'VIOLATES' && partial?.parse_ok === false && failed?.verdict === 'VIOLATES' && failed?.unavailable === true && outerErr?.verdict === 'VIOLATES' && prose?.verdict === 'VIOLATES' && goodRev?.verdict === 'CONSISTENT',
    `partial=${partial?.verdict} failed=${failed?.verdict}/${failed?.unavailable} outer=${outerErr?.verdict} prose=${prose?.verdict} good=${goodRev?.verdict}`);

  // B24 本物の judge.sh：予算で拒まれたら CLI を起動せず判定は成り立たない。上限の中なら成り立つ（陽性の対照）
  const fx = fixture('b24'); commitTicket(fx, 'T-971', {});
  const wj = path.join(fx.base, 'wt-971'); git(fx.main, 'worktree', 'add', '-q', '-b', 'task/T-971', wj, 'main');
  write(path.join(wj, 'src/lib/a.ts'), 'export const v = 2;\n'); git(wj, 'add', '-A'); git(wj, 'commit', '-q', '-m', '実装');
  const fake = path.join(fx.base, 'fakebin');
  const okV = JSON.stringify({ schema: 'vgdd.verdict.v1', verdict: 'APPROVED', deterministic_audits_passed: true, requirements: [], findings: [], summary: 'x' });
  write(path.join(fake, 'claude'), `#!/bin/bash\necho called >> '${path.join(fx.base, 'claude-called.log')}'\nprintf '%s' '${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: okV, usage: { input_tokens: 5, output_tokens: 5 } })}'\n`); fs.chmodSync(path.join(fake, 'claude'), 0o755);
  const outDir = path.join(fx.base, 'verdicts'); fs.mkdirSync(outDir, { recursive: true });
  const runJudge = (limits) => {
    write(path.join(fx.z3, 'budget/limits.json'), JSON.stringify({ ...LIMITS_WIDE, ...limits }) + '\n');
    for (const f of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, f), { force: true });
    sh('bash', [path.join(IMPL.bin, 'judge.sh'), '--ticket', 'docs/tasks/T-971-probe.md', '--base', 'main', '--task', 'T-971', '--out', outDir],
      { cwd: wj, env: { ...process.env, ...UTF8, PATH: `${fake}:${process.env.PATH}`, VGDD_AUDIT_WRAP: '', VGDD_Z3_DIR: fx.z3 }, timeout: 120000 });
    const vf = fs.readdirSync(outDir).find((x) => x.endsWith('.json'));
    try { return JSON.parse(fs.readFileSync(path.join(outDir, vf), 'utf8')); } catch { return null; }
  };
  const denied = runJudge({ judge_calls: 0 });
  const calledDenied = fs.existsSync(path.join(fx.base, 'claude-called.log'));
  const allowed = runJudge({ judge_calls: 10 });
  const calledAllowed = fs.existsSync(path.join(fx.base, 'claude-called.log'));
  record('B', 'B24', '本物の judge.sh：司法の回数の上限で拒まれたら CLI を起動せず判定は成り立たない。上限の中なら起動して成り立つ（陽性の対照）',
    !!denied && denied.judge_parse_ok === false && !calledDenied && !!allowed && allowed.judge_parse_ok === true && calledAllowed,
    `denied=${denied?.judge_parse_ok} calledDenied=${calledDenied} allowed=${allowed?.judge_parse_ok}`);
}

// ---- 権限の表の自己検査（どの権限にも確かめ方がある） ------------------------------------------
function groupMeta() {
  const ids = new Set(results.map((r) => r.id));
  for (const cap of CAPS.capabilities) {
    const ways = [cap.probes && 'probes', cap.scenario_tests && 'scenario_tests', cap.verified_by && 'verified_by'].filter(Boolean);
    record('M', cap.id, `${cap.title} に確かめ方がある（${ways.join('・') || 'なし'}）`, ways.length > 0);
    for (const t of cap.scenario_tests || []) {
      const r = results.find((x) => x.id === t);
      record('M', `${cap.id}→${t}`, `参照している試験 ${t} が実行され、合格している`, !!r && r.ok, r ? '' : '試験がない');
    }
    for (const role of Object.keys(cap.expect || {})) if (!CAPS.roles[role]?.hook_input) record('M', `${cap.id}:${role}`, `expect の役割 ${role} にフックの入力の定義がある`, false);
  }
  void ids;
}

// ---- A 証跡 -------------------------------------------------------------------------------------
// JSON Schema の部分集合（type・required・properties・enum・const・pattern・minimum・minLength）の検証。依存を足さないため自前で持つ。
//   スキーマがこれ以外の語を使えば、検証できないとして不合格にする（黙って通さない）
const SUPPORTED = new Set(['$schema', '$id', 'title', 'description', 'type', 'required', 'properties', 'enum', 'const', 'pattern', 'minimum', 'minLength']);
function typeOk(v, t) {
  const ts = Array.isArray(t) ? t : [t];
  return ts.some((x) => x === 'null' ? v === null : x === 'integer' ? Number.isInteger(v) : x === 'object' ? v !== null && typeof v === 'object' && !Array.isArray(v) : x === 'array' ? Array.isArray(v) : typeof v === x);
}
function validate(v, sc, at = '$') {
  const errs = [];
  for (const k of Object.keys(sc)) if (!SUPPORTED.has(k)) errs.push(`${at}: 検証できない語 ${k}`);
  if (sc.type && !typeOk(v, sc.type)) return [...errs, `${at}: 型が ${JSON.stringify(sc.type)} ではない`];
  if ('const' in sc && v !== sc.const) errs.push(`${at}: ${JSON.stringify(sc.const)} ではない`);
  if (sc.enum && !sc.enum.includes(v)) errs.push(`${at}: ${sc.enum.join('|')} のどれでもない`);
  if (sc.pattern && typeof v === 'string' && !new RegExp(sc.pattern).test(v)) errs.push(`${at}: 形が ${sc.pattern} ではない`);
  if (typeof sc.minimum === 'number' && typeof v === 'number' && v < sc.minimum) errs.push(`${at}: ${sc.minimum} 未満`);
  if (typeof sc.minLength === 'number' && typeof v === 'string' && v.length < sc.minLength) errs.push(`${at}: 短すぎる`);
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of sc.required || []) if (!(k in v)) errs.push(`${at}.${k}: ない`);
    for (const [k, sub] of Object.entries(sc.properties || {})) if (k in v) errs.push(...validate(v[k], sub, `${at}.${k}`));
  }
  return errs;
}
const validateDecision = (rec) => validate(rec, DECISION_SCHEMA);
function groupA(fx, probes) {
  const lines = fs.readFileSync(fx.evidence, 'utf8').split('\n').filter(Boolean);
  const recs = lines.map((l) => JSON.parse(l)).filter((r) => r.type === 'tool_call');
  record('A', 'A1', 'フックへの入力1回につき、判定の記録が1行残る', recs.length === probes, `${recs.length}/${probes}`);
  const invalid = recs.map((r) => [r.event_id, validateDecision(r)]).filter(([, e]) => e.length);
  record('A', 'A2', 'すべての記録が判定のスキーマ（kernel-decision.schema.json）に沿う', invalid.length === 0, invalid.slice(0, 3).map(([id, e]) => `${id}:${e.join(',')}`).join(' '));
  const bads = [{ ...recs[0], actor: null }, { ...recs[0], seq: '1' }, { ...recs[0], event_id: 'x' }, { ...recs[0], hook_event: 'PostToolUse' }, { ...recs[0], decision: 'maybe' }, { ...recs[0], reason: '' }];
  record('A', 'A2n', 'スキーマに反する記録（actor が null・seq が文字列・event_id の形・hook_event・decision・空の理由）を検証が拒む（陰性の対照）', bads.every((b) => validateDecision(b).length > 0));
  const workerRecs = recs.filter((r) => r.cwd === fx.wt);
  record('A', 'A3', '作業員の記録に agent_type と worktree の cwd・ブランチが入る（誰が）', workerRecs.length > 0 && workerRecs.every((r) => r.agent_type && r.git_branch === 'night/T-900'));
  record('A', 'A4', '拒否の記録には理由が入る（なぜ）', recs.filter((r) => r.decision === 'deny').every((r) => r.reason.length > 4));
  const v = (f) => sh('node', [IMPL.verify, f]).status;
  record('A', 'A5', 'ハッシュチェーンの検証が通る', v(fx.evidence) === 0);
  const t1 = path.join(fx.base, 'tamper.jsonl');
  const tl = [...lines]; tl[2] = tl[2].replace(/"decision":"(allow|deny)"/, (m, d) => `"decision":"${d === 'allow' ? 'deny' : 'allow'}"`);
  fs.writeFileSync(t1, tl.join('\n') + '\n');
  record('A', 'A6', '途中の1行の判定を書き換えると検証が失敗する（改ざんの検知）', v(t1) === 1);
  const t2dir = path.join(fx.base, 'trunc'); fs.mkdirSync(t2dir);
  const t2 = path.join(t2dir, 'tool_calls.jsonl');
  fs.writeFileSync(t2, lines.join('\n') + '\n');
  fs.writeFileSync(path.join(t2dir, 'checkpoints.jsonl'), JSON.stringify({ ts: 'x', file: 'tool_calls.jsonl', count: lines.length, last_sha256: sha256hex(lines[lines.length - 1]) }) + '\n');
  const ok = v(t2);
  fs.writeFileSync(t2, lines.slice(0, -2).join('\n') + '\n');
  record('A', 'A7', '末尾を切り詰めると、チェックポイントとの照合で検証が失敗する', ok === 0 && v(t2) === 1);
  // p0.4.5（OBS-055）：件数と末尾の行を別々に読んだ競合の形（N 行・ハッシュは N+1 行目）は注記にとどめ、検証は通る。それ以外の食い違いは失敗
  const t3dir = path.join(fx.base, 'race'); fs.mkdirSync(t3dir);
  const t3 = path.join(t3dir, 'tool_calls.jsonl'); fs.writeFileSync(t3, lines.join('\n') + '\n');
  const cp3 = (sha) => fs.writeFileSync(path.join(t3dir, 'checkpoints.jsonl'), JSON.stringify({ ts: 'x', file: 'tool_calls.jsonl', count: lines.length - 1, last_sha256: sha }) + '\n');
  cp3(sha256hex(lines[lines.length - 1]));
  const r3 = sh('node', [IMPL.verify, t3]);
  record('A', 'A8', 'チェックポイントの件数 N に対してハッシュが N+1 行目と一致する（取り方の競合の形）なら、検証は通り、注記を出す', r3.status === 0 && /チェックポイントの注記/.test(r3.stderr), `exit ${r3.status}`);
  cp3('0'.repeat(64));
  const r4 = sh('node', [IMPL.verify, t3]);
  record('A', 'A9', 'ハッシュがどの行とも一致しない食い違いは、今までどおり検証が失敗する（陰性の対照）', r4.status === 1, `exit ${r4.status}`);
  const t5 = path.join(t3dir, 'tool_calls.jsonl'); const tl5 = [...lines]; tl5[lines.length - 2] = tl5[lines.length - 2].replace(/"decision":"(allow|deny)"/, (m, d) => `"decision":"${d === 'allow' ? 'deny' : 'allow'}"`);
  fs.writeFileSync(t5, tl5.join('\n') + '\n'); cp3(sha256hex(lines[lines.length - 1]));
  record('A', 'A10', '競合の形のチェックポイントがあっても、途中の行を書き換えればハッシュチェーンの検証で失敗する', sh('node', [IMPL.verify, t5]).status === 1);
  // Codex の監査 p0.4.5 #2：境界の判例。N = lines.length - 2（N+1 行目が存在し、N+2 行目も存在する長さで試す）
  const N = lines.length - 2;
  const sha = (s) => 'sha256:' + sha256hex(s);
  const rechain = (arr, from) => { const out = [...arr]; for (let i = from; i < out.length; i++) { const r = JSON.parse(out[i]); r.prev_hash = i === 0 ? 'sha256:genesis' : sha(out[i - 1]); out[i] = JSON.stringify(r); } return out; };
  const put = (arr, cps) => { fs.writeFileSync(t3, arr.join('\n') + '\n'); fs.writeFileSync(path.join(t3dir, 'checkpoints.jsonl'), cps.map((c) => JSON.stringify({ ts: 'x', file: 'tool_calls.jsonl', ...c })).join('\n') + '\n'); };
  const v3 = (extra = []) => sh('node', [IMPL.verify, t3, ...extra]);
  const raceCp = { count: N, last_sha256: sha256hex(lines[N]) };   // 件数 N、ハッシュは N+1 行目
  // 1 行目を書き換え、後ろのチェーンを計算し直す（チェーンは整合するが、N+1 行目のハッシュが変わる）
  const re1 = rechain(lines.map((l, i) => (i === 0 ? l.replace(/"decision":"(allow|deny)"/, (m, d) => `"decision":"${d === 'allow' ? 'deny' : 'allow'}"`) : l)), 1);
  put(re1, [raceCp]);
  record('A', 'A11', '競合の形のチェックポイントがあっても、前の行を書き換えて後ろのチェーンを計算し直せば検証は失敗する（N+1 行目まで拘束）', v3().status === 1);
  put(lines.slice(0, N), [raceCp]);
  record('A', 'A12', '競合の形のチェックポイントのとき、N 行までに切り詰めると検証は失敗する', v3().status === 1);
  const sub = [...lines]; sub[N] = sub[N].replace(/"decision":"(allow|deny)"/, (m, d) => `"decision":"${d === 'allow' ? 'deny' : 'allow'}"`);
  put(sub, [raceCp]);
  record('A', 'A13', '競合の形のチェックポイントのとき、N+1 行目を差し替えると検証は失敗する', v3().status === 1);
  put(lines, [{ count: N, last_sha256: sha256hex(lines[N + 1]) }]);
  record('A', 'A14', 'ハッシュが N+2 行目と一致する食い違いは競合とみなさず、検証は失敗する', v3().status === 1);
  put(lines, [raceCp, { count: N + 1, last_sha256: sha256hex(lines[N]) }, { count: 1, last_sha256: '0'.repeat(64) }]);
  const mix = v3(); const mixS = v3(['--summary-json']);
  record('A', 'A15', '正常・競合・不正のチェックポイントが混ざれば失敗（通常の出力と --summary-json の両方。注記は出す）。競合と正常だけなら --summary-json でも通る',
    mix.status === 1 && mixS.status === 1 && /チェックポイントの注記/.test(mix.stderr) && (put(lines, [raceCp, { count: N + 1, last_sha256: sha256hex(lines[N]) }]), v3(['--summary-json']).status === 0));
}

// ---- 観測（合否なし）：実際のリポジトリで、票の status を誰が変えたか ------------------------------------
function observe(repo) {
  const r = sh('git', ['-C', repo, 'log', '--format=@@%h%x09%an', '-p', '--unified=0', '--', 'docs/tasks/'], { maxBuffer: 64 * 1024 * 1024 });
  const counts = {};
  let author = null;
  for (const l of r.stdout.split('\n')) {
    if (l.startsWith('@@')) { author = l.split('\t')[1]; continue; }
    const m = l.match(/^\+status: (\w+)/);
    if (m) { const k = `${m[1]} ← ${author}`; counts[k] = (counts[k] || 0) + 1; }
  }
  console.log('\n観測：票の status をどの作者のコミットが書いたか（git の作者名。暗号的な本人確認ではない）');
  for (const [k, n] of Object.entries(counts).sort()) console.log(`  ${k}: ${n}`);
  return counts;
}

// ---- 本体 -----------------------------------------------------------------------------------------
console.log(`VGDD Governance Kernel 適合性テスト（実装：${impl}、Kernel ${CAPS.kernel_version}）`);
let observed = null;
try {
  const fx = fixture('c1');
  const probes = groupC1(fx);
  groupA(fx, probes);
  groupC2();
  groupC3();
  groupG();
  groupST();
  groupK();
  groupK2();
  groupH();
  groupN();
  groupL();
  groupB();
  groupINV();
  groupMeta();
  groupInvMeta();
  if (opt('--observe')) observed = observe(opt('--observe'));
} catch (e) {
  console.error(`試験の準備に失敗：${e.stack || e}`);
  process.exit(2);
}
const failed = results.filter((r) => !r.ok);
const byGroup = {};
for (const r of results) { byGroup[r.group] ??= { pass: 0, fail: 0 }; byGroup[r.group][r.ok ? 'pass' : 'fail']++; }
console.log(`\n合計 ${results.length} 件：合格 ${results.length - failed.length}、不合格 ${failed.length}　${Object.entries(byGroup).map(([g, c]) => `${g} ${c.pass}/${c.pass + c.fail}`).join('　')}`);
// p0.4.3：--record で結果の1行を Z3 の conformance.jsonl に残す（Kernel の状態の写しが「最後の適合性テスト」として出す）。
//   Z3 に書けるのはオーナーだけなので、実行するのもオーナー（sandbox の外）。件数と合否と実装と日時だけ
if (args.includes('--record')) {
  const z3 = process.env.VGDD_Z3_DIR || Z3REAL;
  // p0.4.4（Codex の再監査 #7）：試した実装の指紋（法律のスクリプトとフックの中身の SHA-256）を残す。状態の写しは、稼働中の Z3 の実装と同じ指紋の記録だけを検証済みとする（指紋そのものは写しに出さない）
  const implSha = implShaFor(IMPL.bin, IMPL.policy);
  fs.appendFileSync(path.join(z3, 'evidence/conformance.jsonl'), JSON.stringify({ schema: 'vgdd.conformance-record.v1', at: new Date(Date.now() + 9 * 3600e3).toISOString().replace(/\.\d+Z$/, '+09:00'), impl, kernel_version: CAPS.kernel_version, passed: results.length - failed.length, total: results.length,
    impl_sha256: implSha,
    invariants: Object.fromEntries((CAPS.invariants || []).map((i) => [i.id, i.status === 'not_applicable' ? 'n/a' : (results.find((x) => x.id === `${i.id}:meta`)?.ok ? 'pass' : 'fail')])) }) + '\n');
}
if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify({ schema: 'vgdd.conformance-report.v1', impl, kernel_version: CAPS.kernel_version, at: new Date().toISOString(), totals: byGroup, results, observed }, null, 2) + '\n');
process.exit(failed.length ? 1 : 0);
