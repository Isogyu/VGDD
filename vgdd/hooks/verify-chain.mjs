#!/usr/bin/env node
// VGDD Phase 1 — 証拠ストアの検証と集計
//
// 使い方（オーナーが z3 の中で実行する。開発エージェントは z3 を読めない）：
//   node ~/tsubuyaki-z3/hooks/verify-chain.mjs [~/tsubuyaki-z3/evidence/tool_calls.jsonl]
//
// 検証：各行の prev_hash が、直前の行（改行を除く全文）の SHA-256 と一致すること。
//       1行目の prev_hash は "sha256:genesis"。seq が 1 から連番であること。
// 出力：検証結果（OK／どの行で壊れたか）と、ツール別・判定別の件数。
//       README に載せるのは、人が中身を確認したうえでの集計だけ（生のログは公開しない）。
// 終了コード：0 ＝ 整合、1 ＝ 不整合または読めない。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const file = process.argv[2] || path.join(os.homedir(), 'tsubuyaki-z3', 'evidence', 'tool_calls.jsonl');
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
const denies = [];
const byRun = {}; // run_id / ブランチ / HEAD の組み合わせごとの件数（朝のレビュー用）

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
  byTool[rec.operation] = (byTool[rec.operation] || 0) + 1;
  if (rec.decision in byDecision) byDecision[rec.decision] += 1;
  const runKey = `${rec.run_id || '(manual)'} ${rec.git_branch || '?'}@${rec.git_head || '?'} ${rec.session_id ? rec.session_id.slice(0, 8) : '?'}`;
  byRun[runKey] = (byRun[runKey] || 0) + 1;
  if (rec.decision === 'deny') denies.push({ event_id: rec.event_id, timestamp: rec.timestamp, operation: rec.operation, reason: rec.reason });
  prev = line;
});

console.log(`ファイル: ${file}`);
console.log(`件数: ${lines.length}  許可: ${byDecision.allow}  拒否: ${byDecision.deny}`);
console.log('ツール別:', JSON.stringify(byTool));
console.log('run_id ブランチ@HEAD セッション ごとの件数:');
for (const [k, v] of Object.entries(byRun)) console.log(`  ${k}: ${v}`);
if (denies.length) {
  console.log('拒否の一覧:');
  for (const d of denies) console.log(`  ${d.event_id} ${d.timestamp} ${d.operation}: ${d.reason}`);
}
console.log(ok ? 'ハッシュチェーン: OK（改ざん・欠落なし）' : 'ハッシュチェーン: NG');
process.exit(ok ? 0 : 1);
