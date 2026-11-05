#!/usr/bin/env node
// VGDD Governance Kernel — 仕様の指紋（spec digest）と承認の照合（p0.4.0、ADR-005・成立条件②）
//
// 票の「仕様」＝ 司法が判定に使い、作業員の権限を決める部分を、決まった形の文字列にして SHA-256 を取る。
//   ・front matter の全行。ただし運用の項目（status・branch・worker）の行を除く（vgdd.spec.v2）
//   ・本文の「## N. 受け入れ条件（または完了条件）」の節（judge.sh の section_of と同じ切り出し）
//   ・requirements_source が ticket でなければ、docs/requirements.md の該当 ID の行（同じ ref のもの）
// status・branch・worker・§6 の記録などの運用の項目は含めない（運用で変わっても承認は失われない）。
// 仕様が1文字でも変われば指紋が変わり、オーナーの承認の記録（Z3 の spec_approvals.jsonl）と合わなくなる。
//
// 使い方（票は git の ref から読む。作業ツリーは見ない）:
//   node spec-digest.mjs --repo <repo> --ref main --ticket docs/tasks/T-009-xxx.md            … 指紋を1行で出す
//   node spec-digest.mjs ... --show                                                         … 正規化した仕様の本文と指紋を出す（承認の前に人が読む）
//   node spec-digest.mjs ... --check <spec_approvals.jsonl>                                 … 承認済みなら exit 0、未承認は exit 3
// 終了コード：0 ＝ 成功（--check なら承認済み）、3 ＝ 未承認・承認と違う、65 ＝ 票の形が不正、66 ＝ 票が ref にない、64 ＝ 引数

import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i === -1 ? null : args[i + 1]; };
const repo = opt('--repo');
const ref = opt('--ref') || 'main';
const ticket = opt('--ticket');
const check = opt('--check');
const show = args.includes('--show');
if (!repo || !ticket) { console.error('使い方: spec-digest.mjs --repo <repo> --ref main --ticket docs/tasks/T-NNN-*.md [--show | --check <jsonl>]'); process.exit(64); }

// 裁判所と同じく、リポジトリのフックと fsmonitor を読まない（OBS-033）
const git = (...a) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const rel = 'docs/tasks/' + ticket.split('/').pop();
let text;
try { text = git('show', `${ref}:${rel}`); } catch { console.error(`票が ${ref} にない: ${rel}`); process.exit(66); }

const fm = (text.match(/^---\n([\s\S]*?)\n---/) || [])[1];
if (fm === undefined) { console.error(`front matter がない: ${rel}`); process.exit(65); }
const fmLines = fm.split('\n');
const scalar = (k) => {
  const l = fmLines.find((x) => x.startsWith(k + ':'));
  return l === undefined ? null : l.slice(k.length + 1).replace(/\s+#.*$/, '').trim();
};
const list = (k) => {
  const i = fmLines.findIndex((x) => x.startsWith(k + ':'));
  if (i === -1) return [];
  const inline = fmLines[i].slice(k.length + 1).replace(/\s+#.*$/, '').trim();
  if (inline.startsWith('[')) return inline.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (let j = i + 1; j < fmLines.length && /^ {2}- /.test(fmLines[j]); j++) out.push(fmLines[j].replace(/^ {2}- /, '').replace(/\s+#.*$/, '').trim());
  return out;
};

// judge.sh の section_of と同じ：「## N. 受け入れ条件|完了条件」の見出しから、次の「## 」の前まで
const section = [];
let on = false;
for (const l of text.split('\n')) {
  if (/^## [0-9]+\. (受け入れ条件|完了条件)/.test(l)) { on = true; section.push(l); continue; }
  if (/^## /.test(l)) on = false;
  else if (on) section.push(l);
}

const id = scalar('id');
if (!id) { console.error(`id がない: ${rel}`); process.exit(65); }
const source = scalar('requirements_source') || 'docs/requirements.md';
const reqs = list('requirements');
if (source === 'ticket' && section.length === 0) { console.error(`受け入れ条件の節がない: ${rel}`); process.exit(65); }

let reqLines = [];
if (source !== 'ticket') {
  let rtext = '';
  try { rtext = git('show', `${ref}:docs/requirements.md`); } catch { /* なければ「見つからない」として指紋に入る */ }
  reqLines = reqs.map((r) => rtext.split('\n').find((l) => new RegExp(`^\\| ${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |\\*)`).test(l)) || `| ${r} | （docs/requirements.md に見つからない） |`);
}

// front matter は、運用の項目（status・branch・worker）の行を除いて、そのまま全部を指紋に入れる。
//   項目を選んで正規化すると、選ばなかった書き方（重複キー、別の行に足した files_allowed の塊など）が
//   指紋を変えずに裁判所の読み取り（awk の front_list は同じキーの塊をすべて足す）だけを変える穴になる。
//   運用の項目は gate-runner・night-runner が書き換えるため除く。それ以外の1文字の変更は承認し直す
const OPERATIONAL = /^(status|branch|worker):/;
const frontLines = fmLines.filter((l) => !OPERATIONAL.test(l));
const canonical = [
  'vgdd.spec.v2',
  `id: ${id}`,
  `requirements_source: ${source}`,
  `requirements: ${reqs.join(',')}`,
  '--- front matter（運用の項目を除く）',
  ...frontLines,
  '--- acceptance',
  ...section,
  '--- requirements.md',
  ...reqLines,
].join('\n');
const digest = 'sha256:' + crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');

if (check) {
  const lines = fs.existsSync(check) ? fs.readFileSync(check, 'utf8').split('\n').filter(Boolean) : [];
  const ok = lines.some((l) => { try { const r = JSON.parse(l); return r.task === id && r.digest === digest && r.approved_by === 'owner'; } catch { return false; } });
  console.log(ok ? `承認済み ${id} ${digest}` : `未承認 ${id} ${digest}（この仕様はオーナーの承認の記録と合わない）`);
  process.exit(ok ? 0 : 3);
}
if (show) console.log(canonical + '\n');
console.log(show ? `digest: ${digest}  task: ${id}  ref: ${ref}` : digest);
