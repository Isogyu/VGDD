#!/usr/bin/env node
// VGDD Phase 1 — 証拠ストアの検証と集計（p0.2.0 対応）
//
// 使い方（オーナーが z3 の中で実行する。開発エージェントは z3 を読めない）：
//   node ~/tsubuyaki-z3/hooks/verify-chain.mjs [tool_calls.jsonl]            … 検証と人向けの集計
//   node ~/tsubuyaki-z3/hooks/verify-chain.mjs [tool_calls.jsonl] --summary-json … 件数だけの JSON（統治ダッシュボード用。理由・パスは含めない）
//
// 検証：各行の prev_hash が直前の行の SHA-256 と一致、seq が 1 から連番。
// 集計：ツール別・判定別、run_id／ブランチ／セッション別、agent_type 別、outcome（成功／失敗／分類器の拒否）、
//       「allow なのに outcome がない」件数（権限ルールの deny で止まった、または未完了。記録と実際のずれの指標）。
// 終了コード：0 ＝ 整合、1 ＝ 不整合または読めない。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const summaryJson = args.includes('--summary-json');
const file = args.find((a) => !a.startsWith('--')) || path.join(os.homedir(), 'tsubuyaki-z3', 'evidence', 'tool_calls.jsonl');
const sha256 = (s) => 'sha256:' + crypto.createHash('sha256').update(s, 'utf8').digest('hex');

if (!fs.existsSync(file)) {
  console.error(`ファイルがない: ${file}`);
  process.exit(1);
}

const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0);
let ok = true;
let prev = null;
const byTool = {};
const byDecision = { allow: 0, deny: 0 };
const byAgent = {}; // agent_type（本体は "(main)"）→ { calls, deny, outcomes }
const byRun = {};
const byOutcome = { success: 0, failure: 0, denied_by_classifier: 0 };
const denies = [];
const denyKinds = {};
const allowed = new Map(); // tool_use_id → tool_call(allow)
const outcomes = new Set();
let first = null;
let last = null;
const sessions = new Set();

function denyKind(reason) {
  if (!reason) return 'other';
  if (/Z3/.test(reason)) return 'z3';
  if (/git -C|GIT_|--git-dir|cd した|merge|main の参照|main 上|main に直接|push/.test(reason)) return 'git_scope';
  if (/\.claude|CLAUDE\.md|\.github|vgdd|_board|merge-requests|ユーザー設定/.test(reason)) return 'protected_path';
  if (/準備資料|作業記録/.test(reason)) return 'readonly_outside';
  if (/証拠ストア|JSON/.test(reason)) return 'hook_internal';
  return 'other';
}

// p0.3.0：チェックポイントとの照合（末尾の切り詰め・差し替えの検出。D-56③）
const cpFile = path.join(path.dirname(file), 'checkpoints.jsonl');
const cpProblems = [];
const cpRace = [];   // p0.4.5：競合の形の食い違い（失敗に数えない。注記として出す）
if (fs.existsSync(cpFile)) {
  const base = path.basename(file);
  for (const l of fs.readFileSync(cpFile, 'utf8').split('\n').filter(Boolean)) {
    let cp; try { cp = JSON.parse(l); } catch { cpProblems.push('チェックポイントの行を解釈できない'); continue; }
    if (cp.file !== base) continue;
    if (lines.length < cp.count) { cpProblems.push(`${cp.ts}: 件数 ${lines.length} がチェックポイントの ${cp.count} より少ない（切り詰めの疑い）`); continue; }
    const h = crypto.createHash('sha256').update(lines[cp.count - 1], 'utf8').digest('hex');
    if (h === cp.last_sha256) continue;
    // p0.4.5（OBS-055）：p0.4.2 までの裁判所は件数（wc）と末尾の行（tail）を別々に読んだため、その間にフックが1行足すと、
    //   「N 行・末尾は N+1 行目」のチェックポイントになった。この形（N+1 行目のハッシュと一致）は記録の取り方の競合で、改ざんでは生じない
    //   （N 行目を書き換えれば N+1 行目の prev_hash が合わず、下のハッシュチェーンの検証で必ず失敗する）。注記にとどめ、失敗に数えない
    const next = lines[cp.count] !== undefined ? crypto.createHash('sha256').update(lines[cp.count], 'utf8').digest('hex') : null;
    if (next === cp.last_sha256) { cpRace.push(`${cp.ts}: ${cp.count} 行目でなく ${cp.count + 1} 行目のハッシュと一致（記録の取り方の競合。OBS-055）`); continue; }
    cpProblems.push(`${cp.ts}: ${cp.count} 行目のハッシュがチェックポイントと違う（差し替えの疑い）`);
  }
}
lines.forEach((line, i) => {
  let rec;
  try {
    rec = JSON.parse(line);
  } catch {
    console.error(`行 ${i + 1}: JSON を解釈できない`);
    ok = false;
    return;
  }
  const expected = prev === null ? 'sha256:genesis' : sha256(prev);
  if (rec.prev_hash !== expected) {
    console.error(`行 ${i + 1} (${rec.event_id}): prev_hash が一致しない。改ざんまたは欠落の疑い`);
    ok = false;
  }
  if (rec.seq !== i + 1) {
    console.error(`行 ${i + 1}: seq=${rec.seq}（期待 ${i + 1}）`);
    ok = false;
  }
  prev = line;
  if (!first) first = rec.timestamp;
  last = rec.timestamp;
  if (rec.session_id) sessions.add(rec.session_id);
  const agent = rec.agent_type || '(main)';
  byAgent[agent] ??= { calls: 0, deny: 0, outcomes: 0 };

  if (rec.type === 'outcome') {
    byOutcome[rec.result] = (byOutcome[rec.result] || 0) + 1;
    byAgent[agent].outcomes += 1;
    if (rec.tool_use_id) outcomes.add(rec.tool_use_id);
    return;
  }
  // tool_call（p0.1.x の行は hook_event なし）
  byTool[rec.operation] = (byTool[rec.operation] || 0) + 1;
  if (rec.decision in byDecision) byDecision[rec.decision] += 1;
  byAgent[agent].calls += 1;
  const runKey = `${rec.run_id || '(manual)'} ${rec.git_branch || '?'}@${rec.git_head || '?'} ${rec.session_id ? rec.session_id.slice(0, 8) : '?'}`;
  byRun[runKey] = (byRun[runKey] || 0) + 1;
  if (rec.decision === 'deny') {
    byAgent[agent].deny += 1;
    const k = denyKind(rec.reason);
    denyKinds[k] = (denyKinds[k] || 0) + 1;
    denies.push({ event_id: rec.event_id, timestamp: rec.timestamp, agent, operation: rec.operation, reason: rec.reason });
  } else if (rec.tool_use_id && rec.hook_event) {
    allowed.set(rec.tool_use_id, rec);
  }
});

let allowWithoutOutcome = 0;
for (const id of allowed.keys()) if (!outcomes.has(id)) allowWithoutOutcome += 1;

if (summaryJson) {
  // 件数だけ。理由・対象パス・セッション ID は含めない（公開してよい集計）
  const out = {
    schema: 'vgdd.governance-summary.v1',
    generated_at: new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('Z', '+09:00'),
    source_file: path.basename(file),
    period: { first, last },
    chain_ok: ok,
    records: lines.length,
    sessions: sessions.size,
    tool_calls: { allow: byDecision.allow, deny: byDecision.deny },
    deny_kinds: denyKinds,
    by_tool: byTool,
    by_agent: Object.fromEntries(Object.entries(byAgent).map(([k, v]) => [k, { calls: v.calls, deny: v.deny, outcomes: v.outcomes }])),
    agents: Object.keys(byAgent).length,
    outcomes: byOutcome,
    allow_without_outcome: allowWithoutOutcome,
  };
  console.log(JSON.stringify(out, null, 2));
  if (cpProblems.length) { ok = false; for (const p of cpProblems) console.error('チェックポイント: ' + p); } else if (fs.existsSync(cpFile)) { console.error('チェックポイント: OK'); }
  for (const p of cpRace) console.error('チェックポイントの注記: ' + p);
process.exit(ok ? 0 : 1);
}

console.log(`ファイル: ${file}`);
console.log(`件数: ${lines.length}（tool_call 許可 ${byDecision.allow} / 拒否 ${byDecision.deny}、outcome 成功 ${byOutcome.success} / 失敗 ${byOutcome.failure} / 分類器の拒否 ${byOutcome.denied_by_classifier}）`);
console.log(`期間: ${first} 〜 ${last}  セッション: ${sessions.size}`);
console.log('ツール別:', JSON.stringify(byTool));
console.log('拒否の種類別:', JSON.stringify(denyKinds));
console.log('agent_type 別（calls / deny / outcomes）:');
for (const [k, v] of Object.entries(byAgent)) console.log(`  ${k}: ${v.calls} / ${v.deny} / ${v.outcomes}`);
console.log('run_id ブランチ@HEAD セッション ごとの件数:');
for (const [k, v] of Object.entries(byRun)) console.log(`  ${k}: ${v}`);
console.log(`allow なのに outcome がない呼び出し: ${allowWithoutOutcome}（権限ルールの deny で止まった、または未完了。p0.2.0 以降の行だけを数える）`);
if (denies.length) {
  console.log('拒否の一覧:');
  for (const d of denies) console.log(`  ${d.event_id} ${d.timestamp} [${d.agent}] ${d.operation}: ${d.reason}`);
}
console.log(ok ? 'ハッシュチェーン: OK（改ざん・欠落なし）' : 'ハッシュチェーン: NG');
if (cpProblems.length) { ok = false; for (const p of cpProblems) console.error('チェックポイント: ' + p); } else if (fs.existsSync(cpFile)) { console.error('チェックポイント: OK'); }
for (const p of cpRace) console.error('チェックポイントの注記: ' + p);
process.exit(ok ? 0 : 1);
