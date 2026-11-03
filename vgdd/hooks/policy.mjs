#!/usr/bin/env node
// VGDD Phase 1 — Policy Engine（PreToolUse フック）
//
// 役割：Claude Code のすべてのツール呼び出しの直前に動き、
//   1. 保護パス（Z3・.claude・CLAUDE.md・.github・準備資料・作業記録）への操作を拒否し、
//   2. すべての呼び出しを証拠ストア（追記専用の JSONL、ハッシュチェーン付き）に1行ずつ記録する。
//      各行に session_id・run_id（夜間実行）・git のブランチ名と HEAD を含め、
//      朝のレビューで差分・コミットと突き合わせられるようにする（D-37）。
//
// 置き場所：原本はリポジトリの vgdd/hooks/policy.mjs（審査員向けの参照用）。
//   実際に動かすのは作業フォルダの外 ~/tsubuyaki-z3/hooks/policy.mjs（オーナーがコピー）。
//   開発エージェントは z3 を読めない・書けない（settings.json の deny と sandbox）。
//
// 呼び出し：.claude/settings.json の hooks.PreToolUse（matcher "*"、onFailure "block"、timeout 10）
//   { "type": "command", "command": "node ~/tsubuyaki-z3/hooks/policy.mjs" }
//
// 判定の返し方（公式ドキュメント hooks）：
//   終了コード 0 ＝ 通常の権限フローに任せる（ここでは「許可」）
//   終了コード 2 ＝ 拒否。stderr の文字列が理由として Claude に返る
//   例外・ログ書き込み失敗 ＝ 終了コード 2（fail-closed。仕様 §4「応答しないときは書き込みを拒否」）
//
// 保証できないこと（README に明記する）：
//   - Bash の判定は文字列照合。sh -c・変数展開・別名による回避は完全には防げない。
//     Bash 経由の書き込みは sandbox の denyWrite（OS レベル）で補う。
//   - 人が承認画面で「許可」を押した操作は止められない（記録は残る）。
//   - このスクリプト自体を人が書き換えれば統制は外れる（z3 はオーナーだけが書ける）。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const POLICY_VERSION = 'p0.1.2'; // p0.1.1: OBS-004 の差し戻し／p0.1.2: ホームのリポジトリ保護と ~/.claude.json
const HOME = os.homedir();
const Z3 = process.env.VGDD_Z3_DIR || path.join(HOME, 'tsubuyaki-z3');
const EVIDENCE = process.env.VGDD_EVIDENCE_PATH || path.join(Z3, 'evidence', 'tool_calls.jsonl');
const GENESIS = 'sha256:genesis';

// ---- 入力 -----------------------------------------------------------------

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

// ---- 保護パス -------------------------------------------------------------

function protectedPaths(projectDir) {
  const p = (...xs) => path.resolve(...xs);
  return [
    // 読み取りも書き込みも拒否（Z3：評価用テスト・正解ラベル・フック・証拠ストア）
    { dir: p(Z3), noRead: true, label: 'Z3 保護領域' },
    // 書き込みだけ拒否
    { dir: p(projectDir, '.claude'), noRead: false, label: '.claude（権限ルール・フック登録）' },
    // ユーザー設定（disableAllHooks やユーザー側のフックで統制を外す経路を塞ぐ。OBS-004）
    { file: p(HOME, '.claude', 'settings.json'), noRead: false, label: 'ユーザー設定 ~/.claude/settings.json' },
    { file: p(HOME, '.claude', 'settings.local.json'), noRead: false, label: 'ユーザー設定 ~/.claude/settings.local.json' },
    { dir: p(HOME, '.claude', 'hooks'), noRead: false, label: 'ユーザーのフック ~/.claude/hooks' },
    { file: p(HOME, '.claude.json'), noRead: false, label: 'ユーザー設定 ~/.claude.json（MCP・信頼済みフォルダ）' },
    { file: p(projectDir, 'CLAUDE.md'), noRead: false, label: 'CLAUDE.md（開発エージェントの入口）' },
    { dir: p(projectDir, '.github'), noRead: false, label: '.github（CI 定義）' },
    { dir: p(projectDir, '..', 'preparation'), noRead: false, label: '準備資料（リポジトリの外・読み取り専用）' },
    { dir: p(projectDir, '..', 'event_records'), noRead: false, label: '作業記録（リポジトリの外・読み取り専用）' },
  ];
}

function isUnder(target, dir) {
  const rel = path.relative(dir, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function matchProtected(absPath, rules) {
  for (const r of rules) {
    if (r.file && path.resolve(absPath) === r.file) return r;
    if (r.dir && isUnder(path.resolve(absPath), r.dir)) return r;
  }
  return null;
}

// ---- Bash の判定 ----------------------------------------------------------

// 保護パスを指していそうな語（文字列照合。回避の余地は残る）
const BASH_PROTECTED_TOKENS = [
  { re: /tsubuyaki-z3/, noRead: true, label: 'Z3 保護領域' },
  // ~/tsub* のようなグロブによる回避を狭める（~/tsubuyaki-worklog は作業フォルダなので除く）。
  // それでも ~/t* のような広いグロブは通る。読み取りの最終防衛は sandbox.filesystem.denyRead（OBS-004）
  { re: /(~|\$HOME|\$\{HOME\}|\/Users\/[^/\s]+)\/tsub(?!uyaki-worklog\b)/, noRead: true, label: 'Z3 保護領域（グロブの疑い）' },
  { re: /(~|\$HOME|\$\{HOME\}|\/Users\/[^/\s]+)\/\.claude(\/|\b)/, noRead: false, label: 'ユーザー設定 ~/.claude' },
  { re: /(~|\$HOME|\$\{HOME\}|\/Users\/[^/\s]+)\/\.claude\.json/, noRead: false, label: 'ユーザー設定 ~/.claude.json' },
  { re: /(^|[\s"'`=/])\.claude(\/|\b)/, noRead: false, label: '.claude' },
  { re: /CLAUDE\.md/, noRead: false, label: 'CLAUDE.md' },
  { re: /(^|[\s"'`=/])\.github(\/|\b)/, noRead: false, label: '.github' },
  { re: /(^|[\s"'`=/])(\.\.\/)?preparation(\/|\b)/, noRead: false, label: '準備資料' },
  { re: /(^|[\s"'`=/])(\.\.\/)?event_records(\/|\b)/, noRead: false, label: '作業記録' },
];

// 読み取り専用と見なすコマンドの先頭（各セグメントの先頭に一致すること）
const READ_ONLY_HEAD = /^\s*(cat|ls|head|tail|wc|grep|rg|diff|stat|file|du|tree|find|jq|less|more|echo|printf|date|pwd|awk|cut|sort|uniq|tr|nl|column|sed\s+-n|git\s+(diff|status|log|show|ls-files|rev-parse|branch|remote|config\s+--get|config\s+user\.\w+)|python3?\s+-c\s+["'][^"']*json\.load)/;

// 書き込み・実行の気配があれば読み取り専用とは見なさない
const WRITE_HINT = /(\bfind\b[^;|&]*\s-(delete|exec|execdir|ok|okdir)\b|\bsed\b[^;|&]*(?:[\/;'"\s]w\s+\S|[\/;'"\s]W\s+\S)|>>?|\btee\b|\bcp\b|\bmv\b|\brm\b|\bmkdir\b|\btouch\b|\bchmod\b|\bchown\b|\bln\b|\binstall\b|\brsync\b|\btruncate\b|\bdd\b|\bsed\s+-i|\bperl\s+-[a-z]*i|\bpython3?\b|\bnode\b|\bperl\b|\bruby\b|\b(sh|bash|zsh)\s+-c|\beval\b|\bsource\b|\bxargs\b|\bgit\s+(add|commit|checkout|restore|reset|clean|stash|apply|am|mv|rm)\b|\bopen\b|\bosascript\b)/;

function splitSegments(cmd) {
  // ; && || | で分割（引用符の中は考慮しない：安全側に寄せる）
  return cmd.split(/\s*(?:;|&&|\|\||\|)\s*/).filter(Boolean);
}

// ホームディレクトリ（~）は別の Git リポジトリ。git の対象を作業フォルダの外に向ける形は拒否する（約束7）
function judgeGitScope(command) {
  if (/\bGIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE)=/.test(command)) {
    return 'git の環境変数（GIT_DIR / GIT_WORK_TREE 等）で対象リポジトリを切り替えている';
  }
  const segs = splitSegments(command);
  let leftProject = false;
  for (const seg of segs) {
    const cd = seg.match(/^\s*(cd|pushd)\s+(\S+)/);
    if (cd) {
      const dest = cd[2].replace(/^["']|["']$/g, '');
      // 相対で中に入るだけなら許す。.. や絶対パス・~ は外に出たとみなす
      if (/^(\.\.|\/|~|\$HOME|\$\{HOME\})/.test(dest) || dest === '-') leftProject = true;
    }
    if (/(^|[\s;&|(])git(\s|$)/.test(seg)) {
      if (leftProject) return `作業フォルダの外に cd したあとで git を実行している：「${seg.trim().slice(0, 60)}」`;
      if (/\s--git-dir(=|\s)|\s--work-tree(=|\s)/.test(seg)) return '--git-dir / --work-tree で対象リポジトリを切り替えている';
      const c = seg.match(/\s-C\s+(\S+)/) || seg.match(/\s-C(\S+)/);
      if (c) {
        const dir = c[1].replace(/^["']|["']$/g, '');
        if (!(dir === '.' || dir === './' || dir === '$PWD' || dir === '"$PWD"')) {
          return `git -C ${dir} で作業フォルダ以外のリポジトリを対象にしている（ホームの .git を守るため）`;
        }
      }
    }
  }
  return null;
}

function judgeBash(command) {
  const gitScope = judgeGitScope(command);
  if (gitScope) return { decision: 'deny', reason: `Bash: ${gitScope}。git はこのフォルダ（app/）の中でだけ使う` };
  const hits = BASH_PROTECTED_TOKENS.filter((t) => t.re.test(command));
  if (hits.length === 0) return { decision: 'allow', reason: '保護パスへの言及なし' };
  const labels = hits.map((h) => h.label).join('・');
  if (hits.some((h) => h.noRead)) {
    return { decision: 'deny', reason: `Bash が ${labels} を参照している（読み取りも禁止）` };
  }
  // 保護パスに触れる Bash は、全セグメントが読み取り専用の形のときだけ許可
  const segs = splitSegments(command);
  const bad = segs.find((s) => WRITE_HINT.test(s) || !READ_ONLY_HEAD.test(s));
  if (bad) {
    return {
      decision: 'deny',
      reason: `Bash が ${labels} に対して読み取り専用と判定できない操作を含む：「${bad.trim().slice(0, 80)}」。Edit/Write でも拒否される保護パスです`,
    };
  }
  return { decision: 'allow', reason: `保護パス（${labels}）への読み取り専用コマンド` };
}

// ---- ツールごとの判定 -----------------------------------------------------

function judge(input, rules) {
  const tool = input.tool_name || '';
  const ti = input.tool_input || {};
  const cwd = input.cwd || process.cwd();

  const expandHome = (p) => (p && (p === '~' || p.startsWith('~/')) ? path.join(HOME, p.slice(1)) : p);
  const abs = (p) => (p ? path.resolve(cwd, expandHome(p)) : null);
  // グロブ文字（* ? [ {）より前の部分だけをパスとして扱う
  const absFromPattern = (p) => {
    if (!p) return null;
    const q = expandHome(String(p));
    if (!(q.startsWith('/') || q.startsWith('~'))) return null;
    const cut = q.search(/[*?[{]/);
    return path.resolve(cut === -1 ? q : q.slice(0, cut));
  };

  switch (tool) {
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const target = abs(ti.file_path || ti.notebook_path);
      const hit = target ? matchProtected(target, rules) : null;
      if (hit) return { target, decision: 'deny', reason: `${tool} の対象が保護パス（${hit.label}）` };
      return { target, decision: 'allow', reason: '保護パス外への書き込み' };
    }
    case 'Read':
    case 'Glob':
    case 'Grep': {
      const candidates = [abs(ti.file_path || ti.path || cwd), absFromPattern(ti.pattern), absFromPattern(ti.glob)].filter(Boolean);
      for (const c of candidates) {
        const hit = matchProtected(c, rules);
        if (hit && hit.noRead) return { target: c, decision: 'deny', reason: `${tool} の対象が読み取り禁止の保護パス（${hit.label}）` };
      }
      return { target: candidates[0] || null, decision: 'allow', reason: '読み取り' };
    }
    case 'Bash': {
      const cmd = String(ti.command || '');
      const r = judgeBash(cmd);
      return { target: cmd.slice(0, 200), ...r };
    }
    default:
      return { target: null, decision: 'allow', reason: '判定対象外のツール（記録のみ）' };
  }
}

// ---- git の状態（朝のレビューで差分と突き合わせるため。D-37） --------------

// git を起動せず .git/HEAD を読む（フックは全ツール呼び出しで動くので軽くする）
function gitState(projectDir) {
  const out = { branch: null, head: null };
  try {
    let gitDir = path.join(projectDir, '.git');
    const st = fs.statSync(gitDir);
    if (st.isFile()) {
      // worktree の場合：「gitdir: <path>」
      const m = fs.readFileSync(gitDir, 'utf8').match(/^gitdir:\s*(.+)$/m);
      if (m) gitDir = path.resolve(projectDir, m[1].trim());
    }
    const headTxt = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = headTxt.match(/^ref:\s*(.+)$/);
    if (ref) {
      out.branch = ref[1].replace(/^refs\/heads\//, '');
      const refFile = path.join(gitDir, ref[1]);
      if (fs.existsSync(refFile)) {
        out.head = fs.readFileSync(refFile, 'utf8').trim().slice(0, 12);
      } else {
        // packed-refs を探す
        const packed = path.join(gitDir, 'packed-refs');
        if (fs.existsSync(packed)) {
          const line = fs.readFileSync(packed, 'utf8').split('\n').find((l) => l.endsWith(' ' + ref[1]));
          if (line) out.head = line.slice(0, 12);
        }
      }
    } else {
      out.branch = '(detached)';
      out.head = headTxt.slice(0, 12);
    }
  } catch { /* git がない・読めないときは null のまま */ }
  return out;
}

// ---- 証拠ストア（追記専用・ハッシュチェーン・簡易ロック） --------------------

function sha256(s) {
  return 'sha256:' + crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function lastLine(file) {
  if (!fs.existsSync(file)) return null;
  const size = fs.statSync(file).size;
  if (size === 0) return null;
  const fd = fs.openSync(file, 'r');
  try {
    const len = Math.min(size, 64 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const text = buf.toString('utf8').replace(/\n+$/, '');
    const lines = text.split('\n');
    return lines[lines.length - 1];
  } finally {
    fs.closeSync(fd);
  }
}

function withLock(lockPath, fn) {
  const deadline = Date.now() + 3000;
  for (;;) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        return fn();
      } finally {
        fs.closeSync(fd);
        try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
      }
    } catch (e) {
      if (e.code !== 'EEXIST' || Date.now() > deadline) throw e;
      // 作成から5秒を過ぎたロックは、途中で死んだフックの残骸とみなして消す（夜間の運転で全操作が止まらないように。OBS-004）
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > 5000) { fs.unlinkSync(lockPath); continue; }
      } catch { /* 消えていれば次の試行で取れる */ }
      // 他のフックが書き込み中。少し待つ（同期スリープ）
      const until = Date.now() + 25;
      while (Date.now() < until) { /* spin */ }
    }
  }
}

function jstTimestamp(d = new Date()) {
  const t = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return t.toISOString().replace('Z', '+09:00');
}

function appendRecord(rec) {
  const dir = path.dirname(EVIDENCE);
  if (!fs.existsSync(dir)) {
    throw new Error(`証拠ストアのディレクトリがない: ${dir}（オーナーが作成する。作成されるまで fail-closed で全操作を拒否）`);
  }
  return withLock(EVIDENCE + '.lock', () => {
    const prev = lastLine(EVIDENCE);
    const prevHash = prev ? sha256(prev) : GENESIS;
    const n = prev ? (JSON.parse(prev).seq || 0) + 1 : 1;
    const full = { event_id: `evt-${String(n).padStart(6, '0')}`, seq: n, prev_hash: prevHash, ...rec };
    fs.appendFileSync(EVIDENCE, JSON.stringify(full) + '\n', { mode: 0o600 });
    return full;
  });
}

// ---- main -----------------------------------------------------------------

function main() {
  let input;
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch (e) {
    process.stderr.write(`[VGDD] フック入力の JSON を解釈できない: ${e.message}\n`);
    process.exit(2);
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const rules = protectedPaths(projectDir);
  const verdict = judge(input, rules);
  const git = gitState(projectDir);

  const rec = {
    policy_version: POLICY_VERSION,
    type: 'tool_call',
    timestamp: jstTimestamp(),
    session_id: input.session_id || null,
    tool_use_id: input.tool_use_id || null,
    // 夜間の自律開発（D-37）：起動スクリプトが VGDD_RUN_ID を渡す。手動セッションでは null
    run_id: process.env.VGDD_RUN_ID || null,
    git_branch: git.branch,
    git_head: git.head,
    actor: { kind: 'agent', role: 'executive', model: process.env.VGDD_MODEL || 'unknown' },
    operation: input.tool_name || null,
    target: verdict.target,
    decision: verdict.decision,
    reason: verdict.reason,
    permission_mode: input.permission_mode || null,
    agent_type: input.agent_type || null,
  };

  try {
    appendRecord(rec);
  } catch (e) {
    process.stderr.write(`[VGDD] 証拠ストアに記録できないため操作を拒否（fail-closed）: ${e.message}\n`);
    process.exit(2);
  }

  if (verdict.decision === 'deny') {
    process.stderr.write(`[VGDD 拒否] ${verdict.reason}。この操作は Policy Engine（${POLICY_VERSION}）により止められ、証拠ストアに記録された。必要ならオーナーに依頼すること。\n`);
    process.exit(2);
  }
  process.exit(0);
}

try {
  main();
} catch (e) {
  process.stderr.write(`[VGDD] フック内部エラーのため操作を拒否（fail-closed）: ${e && e.stack ? e.stack : e}\n`);
  process.exit(2);
}
