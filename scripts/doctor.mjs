#!/usr/bin/env node
// 読み取りだけの導入診断（T-044）。
// 使い方：node scripts/doctor.mjs [--repo <パス>] [--z3 <パス>] [--json]
//
// 約束（票 T-044 §2）：
// - 子プロセスと shell を一切起動しない。外部のコマンドは実行しない（PATH の上に「ある」かを調べるだけ）。
// - ファイルを書かない・消さない・動かさない。ネットワークに出ない。
// - 出すのは、固定の項目の ID・状態・固定の文と、A1-7 の許可リストのファイル名だけ。
//   環境変数の値・ファイルの中身・パス・CLI の引数・例外の message と stack・SHA-256 の値は出さない。
// - .env.local は lstat で有無だけを見る（開かない・読まない・ハッシュしない）。
// - 内容を読むのはサイズの上限つきの通常のファイルだけ。記号リンクと特殊なファイルはたどらない。
//   末尾のファイルだけでなく、指定された --repo・--z3 そのものと、そこから末尾までの間の各要素
//   （.claude・vgdd・bin など）も lstat で確かめ、記号リンクかフォルダでなければ、中身を読まずに固定の結果にする。
//   （--repo・--z3 より上の要素、たとえば OS の /var → /private/var は確かめない）
// - --repo そのものは最初に1回 lstat で確かめる。記号リンク・フォルダでない・ない・読めないのどれかなら、
//   その下を読む項目（4・5・7・8）をすべて fail「リポジトリの場所を読めない」にする（7 は --z3 がフォルダのときだけ）。
// - PATH の上のコマンドと sandbox-exec も lstat で見る。記号リンクはたどらず「実行できる通常のファイルとしてない」にする。
// - import しただけでは何も起きない（直接実行されたときだけ main が動く）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// ---- 固定の値 ----

export const STATUSES = Object.freeze(["ok", "warn", "fail", "skip"]);

/** A1-2：PATH の上に要るコマンド（sha256sum は shasum の代わりにしない） */
export const REQUIRED_COMMANDS = Object.freeze(["git", "jq", "shasum", "npm", "python3"]);

/** A1-7：許可リスト。原本（--repo からの相対）と、写し（--z3 からの相対） */
export const COPY_ALLOWLIST = Object.freeze([
  { name: "gate-runner.sh", src: ["vgdd", "scripts"], dst: "bin" },
  { name: "judge.sh", src: ["vgdd", "scripts"], dst: "bin" },
  { name: "judge-codex.sh", src: ["vgdd", "scripts"], dst: "bin" },
  { name: "release.sh", src: ["vgdd", "scripts"], dst: "bin" },
  { name: "night-runner.sh", src: ["vgdd", "scripts"], dst: "bin" },
  { name: "sandboxed-run.sh", src: ["vgdd", "scripts"], dst: "bin" },
  { name: "kernel-state.mjs", src: ["vgdd", "scripts"], dst: "bin" },
  { name: "spec-digest.mjs", src: ["vgdd", "scripts"], dst: "bin" },
  { name: "approve-spec.sh", src: ["vgdd", "scripts"], dst: "bin" },
  { name: "policy.mjs", src: ["vgdd", "hooks"], dst: "hooks" },
]);

export const Z3_SUBDIRS = Object.freeze(["bin", "hooks", "evidence"]);

export const LIMIT_SETTINGS_BYTES = 1024 * 1024; // 設定の JSON：1MiB
export const LIMIT_COMPARE_BYTES = 10 * 1024 * 1024; // 比べるファイル：10MiB

export const DEFAULT_SANDBOX_EXEC = "/usr/bin/sandbox-exec";

export const DISCLAIMER = "この診断は導入の完了や実稼働の安全を保証しない";

/** 出力に出してよい文はすべてここに置く（A3）。可変部分は許可リストのファイル名とコマンド名だけ */
export const MSG = Object.freeze({
  nodeOk: "Node.js の版は 24 以上",
  nodeWarn: "適合性テストだけ動く",
  nodeFail: "Node.js の版が 22 未満（24 以上が必要）",
  nodeUnknown: "Node.js の版を読み取れない",
  commandsOk: "必要なコマンドが PATH の上にそろっている",
  commandsMissing: (names) => `PATH の上に実行できるファイルとしてないコマンド：${names.join("、")}`,
  sandboxOk: "macOS で sandbox-exec がある",
  sandboxMissing: "macOS だが sandbox-exec が実行できる通常のファイルとしてない",
  sandboxOtherOs: "裁判所の監査の sandbox は macOS 専用。この OS では実稼働の安全制御は未検証",
  repoUnreadable: "リポジトリの場所を読めない",
  settingsOk: "Claude Code の設定（.claude/settings.json）で sandbox.enabled が true",
  settingsMissing: "Claude Code の設定（.claude/settings.json）がない",
  settingsNotRegular: "Claude Code の設定（.claude/settings.json）が通常のファイルでない（たどらない）",
  settingsTooLarge: "Claude Code の設定（.claude/settings.json）が大きすぎる（上限 1MiB）",
  settingsUnreadable: "Claude Code の設定（.claude/settings.json）が読めない",
  settingsBadJson: "Claude Code の設定（.claude/settings.json）が JSON として読めない",
  settingsNoSandbox: "Claude Code の設定（.claude/settings.json）で sandbox.enabled が true でない",
  sourceOk: "設定の原本（vgdd/settings.v2.json）がある",
  sourceMissing: "設定の原本（vgdd/settings.v2.json）がない",
  sourceNotRegular: "設定の原本（vgdd/settings.v2.json）が通常のファイルでない（たどらない）",
  sourceUnreadable: "設定の原本（vgdd/settings.v2.json）が読めない",
  z3Ok: "Kernel の保護領域に bin/・hooks/・evidence/ がある",
  z3Missing: "Kernel の保護領域がない。clone で試すだけなら不要",
  z3NotDir: "Kernel の保護領域がフォルダでない（記号リンクはたどらない）",
  z3Unreadable: "Kernel の保護領域が読めない",
  z3SubdirMissing: (names) => `Kernel の保護領域に足りないフォルダがある：${names.map((n) => `${n}/`).join("・")}`,
  copiesSkip: "Kernel の保護領域がないので写しを比べない",
  copiesOk: "配置済みの写しは原本と同じ",
  copyDiffers: (name) => `配置済みの写しが原本と違う：${name}`,
  copyUnreadable: (name) => `配置済みの写しが読めない：${name}`,
  originUnreadable: (name) => `原本が読めない：${name}`,
  envPresent: "API キーの設定ファイルがある（中身は読んでいない）",
  envAbsent: "API キーの設定ファイルはない（API なしで動く）",
  envUnknown: "API キーの設定ファイルの有無を確かめられない（中身は読まない）",
  argsBad: "引数が正しくない（使える引数：--repo <パス>、--z3 <パス>、--json）",
  unexpected: "診断の途中で予期しない誤りが起きた（詳細は出さない）",
});

// ---- 判定の純粋関数 ----

/** A1-1：版の文字列から状態を決める */
export function nodeVersionItem(version) {
  const m = /^v?(\d+)\./.exec(typeof version === "string" ? version : "");
  if (!m) return item("node", "fail", MSG.nodeUnknown);
  const major = Number(m[1]);
  if (major >= 24) return item("node", "ok", MSG.nodeOk);
  if (major >= 22) return item("node", "warn", MSG.nodeWarn);
  return item("node", "fail", MSG.nodeFail);
}

/** A1-2：見つからなかったコマンドの名前の並びから状態を決める */
export function commandsItem(missing) {
  if (missing.length === 0) return item("commands", "ok", MSG.commandsOk);
  return item("commands", "fail", MSG.commandsMissing(missing));
}

/** A1-3：OS と sandbox-exec の有無から状態を決める */
export function sandboxItem(platform, hasSandboxExec) {
  if (platform !== "darwin") return item("sandbox", "warn", MSG.sandboxOtherOs);
  return hasSandboxExec ? item("sandbox", "ok", MSG.sandboxOk) : item("sandbox", "fail", MSG.sandboxMissing);
}

/**
 * A1：--repo そのものの lstat の種類（lstatKind の戻り値）から、その下を読んでよいかを決める。
 * 記号リンクでないフォルダのときだけ true（記号リンク・フォルダでない・ない・読めないは false）
 */
export function repoReadable(repoKind) {
  return repoKind === "dir";
}

/** A1：--repo の場所を読めないときの、その下を読む項目（4・5・7・8）の固定の結果 */
export function repoUnreadableItem(id) {
  return item(id, "fail", MSG.repoUnreadable);
}

/** A1-4：settings.json の読み取り結果（readLimited の戻り値）から状態を決める。値の中身は出さない */
export function settingsItem(read) {
  const id = "settings";
  switch (read.kind) {
    case "missing":
      return item(id, "fail", MSG.settingsMissing);
    case "not-regular":
      return item(id, "fail", MSG.settingsNotRegular);
    case "too-large":
      return item(id, "fail", MSG.settingsTooLarge);
    case "unreadable":
      return item(id, "fail", MSG.settingsUnreadable);
    case "ok": {
      let parsed;
      try {
        parsed = JSON.parse(read.data.toString("utf8"));
      } catch {
        return item(id, "fail", MSG.settingsBadJson);
      }
      const enabled =
        parsed !== null &&
        typeof parsed === "object" &&
        parsed.sandbox !== null &&
        typeof parsed.sandbox === "object" &&
        parsed.sandbox.enabled === true;
      return enabled ? item(id, "ok", MSG.settingsOk) : item(id, "fail", MSG.settingsNoSandbox);
    }
    default:
      return item(id, "fail", MSG.settingsUnreadable);
  }
}

/** A1-5：設定の原本の有無（probeRegular の戻り値）から状態を決める */
export function sourceItem(kind) {
  const id = "settings-source";
  if (kind === "ok") return item(id, "ok", MSG.sourceOk);
  if (kind === "missing") return item(id, "fail", MSG.sourceMissing);
  if (kind === "not-regular") return item(id, "fail", MSG.sourceNotRegular);
  return item(id, "fail", MSG.sourceUnreadable);
}

/** A1-6：保護領域の状態。z3Kind は "dir"・"missing"・"not-dir"・"unreadable"。missingSubdirs は名前の並び */
export function z3Item(z3Kind, missingSubdirs) {
  const id = "z3";
  if (z3Kind === "missing") return item(id, "warn", MSG.z3Missing);
  if (z3Kind === "not-dir") return item(id, "warn", MSG.z3NotDir);
  if (z3Kind === "unreadable") return item(id, "fail", MSG.z3Unreadable);
  if (missingSubdirs.length > 0) return item(id, "warn", MSG.z3SubdirMissing(missingSubdirs));
  return item(id, "ok", MSG.z3Ok);
}

/**
 * A1-7：写し1つの比べた結果から項目を決める（同じなら null）。
 * origin・copy は readLimitedUnder の戻り値。ハッシュの値は返さない（同じかどうかだけ）。
 * 原本・写しの両側で：ない（途中のフォルダがないときも含む）・記号リンク・特殊なファイル・大きすぎる → warn「違う」、
 * 読めない（権限など）→ fail。
 */
export function copyCompareItem(name, origin, copy) {
  const id = "z3-copies";
  // 読めない対象（権限など）は fail（A1「読めない対象のファイルは fail」）
  if (origin.kind === "unreadable") return item(id, "fail", MSG.originUnreadable(name));
  if (copy.kind === "unreadable") return item(id, "fail", MSG.copyUnreadable(name));
  // 原本・写しのどちらかが、ない・記号リンク・特殊なファイル・大きすぎる は、
  // どれも A1-7 の「違う・ない」として warn「配置済みの写しが原本と違う」にそろえる（たどらない）
  if (origin.kind !== "ok" || copy.kind !== "ok") return item(id, "warn", MSG.copyDiffers(name));
  return sameSha256(origin.data, copy.data) ? null : item(id, "warn", MSG.copyDiffers(name));
}

/** A1-8：.env.local の lstat の結果（"present"・"absent"・"unknown"）から状態を決める */
export function envLocalItem(kind) {
  if (kind === "present") return item("env-local", "ok", MSG.envPresent);
  if (kind === "absent") return item("env-local", "ok", MSG.envAbsent);
  return item("env-local", "fail", MSG.envUnknown);
}

/** A2：fail が1つでもあれば 1、それ以外は 0 */
export function exitCodeOf(items) {
  return items.some((it) => it.status === "fail") ? 1 : 0;
}

/** SHA-256 を比べる。値は外に出さない */
export function sameSha256(a, b) {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return ha.length === hb.length && crypto.timingSafeEqual(ha, hb);
}

function item(id, status, message) {
  return { id, status, message };
}

// ---- 引数 ----

/**
 * 引数を読む。値は返すが、出力には決して出さない。
 * 戻り値：{ ok: true, repo, z3, json } か { ok: false, json }
 */
export function parseArgs(argv, { cwd, env, homedir }) {
  let repo = null;
  let z3 = null;
  let json = false;
  let ok = true;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") json = true;
    else if (a === "--repo" || a === "--z3") {
      const v = argv[i + 1];
      if (typeof v !== "string" || v === "" || v.startsWith("--")) {
        ok = false;
        continue;
      }
      if (a === "--repo") repo = v;
      else z3 = v;
      i++;
    } else ok = false;
  }
  if (!ok) return { ok: false, json };
  const envZ3 = typeof env.VGDD_Z3_DIR === "string" && env.VGDD_Z3_DIR !== "" ? env.VGDD_Z3_DIR : null;
  return {
    ok: true,
    json,
    repo: path.resolve(cwd, repo ?? "."),
    z3: path.resolve(cwd, z3 ?? envZ3 ?? path.join(homedir, "tsubuyaki-z3")),
  };
}

// ---- 読み取りだけの道具（書かない・たどらない） ----

/** lstat の結果の種類だけを返す。"regular"・"dir"・"symlink"・"other"・"missing"・"unreadable" */
export function lstatKind(p) {
  let st;
  try {
    st = fs.lstatSync(p);
  } catch (e) {
    return e && (e.code === "ENOENT" || e.code === "ENOTDIR") ? "missing" : "unreadable";
  }
  if (st.isSymbolicLink()) return "symlink";
  if (st.isFile()) return "regular";
  if (st.isDirectory()) return "dir";
  return "other";
}

/**
 * 指定されたルート base そのものと、そこから末尾のファイルの手前までの各要素（中間のフォルダ）を lstat で確かめる。
 * base より上の要素（OS の記号リンク。/var → /private/var など）は確かめない。
 * 戻り値："ok"（すべて記号リンクでないフォルダ）・"missing"・"not-regular"（記号リンクかフォルダでない）・"unreadable"
 */
export function checkParents(base, segments) {
  let cur = base;
  for (const seg of [null, ...segments.slice(0, -1)]) {
    if (seg !== null) cur = path.join(cur, seg);
    const k = lstatKind(cur);
    if (k === "dir") continue;
    if (k === "missing" || k === "unreadable") return k;
    return "not-regular";
  }
  return "ok";
}

/** 通常のファイルとして「ある・読める」かだけを見る（開かない）。"ok"・"missing"・"not-regular"・"unreadable" */
export function probeRegular(p) {
  const k = lstatKind(p);
  if (k === "missing" || k === "unreadable") return k;
  if (k !== "regular") return "not-regular";
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return "ok";
  } catch {
    return "unreadable";
  }
}

/** base の下の segments のファイルを、中間の要素を確かめてから probeRegular で見る */
export function probeRegularUnder(base, segments) {
  const parents = checkParents(base, segments);
  if (parents !== "ok") return parents;
  return probeRegular(path.join(base, ...segments));
}

/**
 * 上限つきで通常のファイルを読む。記号リンク・特殊なファイルはたどらない。
 * 戻り値：{ kind: "ok", data } か { kind: "missing" | "not-regular" | "too-large" | "unreadable" }
 */
export function readLimited(p, limit) {
  const k = lstatKind(p);
  if (k === "missing" || k === "unreadable") return { kind: k };
  if (k !== "regular") return { kind: "not-regular" };
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
  let fd;
  try {
    fd = fs.openSync(p, flags);
  } catch (e) {
    return e && e.code === "ENOENT" ? { kind: "missing" } : { kind: "unreadable" };
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { kind: "not-regular" };
    if (st.size > limit) return { kind: "too-large" };
    // 上限より1バイト多く読もうとして、途中で伸びたファイルも弾く
    const buf = Buffer.alloc(limit + 1);
    let total = 0;
    while (total < buf.length) {
      const n = fs.readSync(fd, buf, total, buf.length - total, total);
      if (n === 0) break;
      total += n;
    }
    if (total > limit) return { kind: "too-large" };
    return { kind: "ok", data: buf.subarray(0, total), dev: st.dev, ino: st.ino };
  } catch {
    return { kind: "unreadable" };
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // 閉じられなくても出力には何も出さない
    }
  }
}

/**
 * base の下の segments のファイルを上限つきで読む。
 * 開く前に中間の要素を確かめ（記号リンク・フォルダでないものは、末尾が記号リンクのときと同じ not-regular）、
 * 読んだ後にもう一度確かめて、開いたファイルが同じ場所のものか（dev・ino）を比べる。
 * 途中で差し替えられたら、読んだ中身は捨てて not-regular にする。
 */
export function readLimitedUnder(base, segments, limit) {
  const before = checkParents(base, segments);
  if (before !== "ok") return { kind: before };
  const p = path.join(base, ...segments);
  const r = readLimited(p, limit);
  if (r.kind !== "ok") return { kind: r.kind };
  if (checkParents(base, segments) !== "ok") return { kind: "not-regular" };
  let st;
  try {
    st = fs.lstatSync(p);
  } catch {
    return { kind: "not-regular" };
  }
  if (!st.isFile() || st.dev !== r.dev || st.ino !== r.ino) return { kind: "not-regular" };
  return { kind: "ok", data: r.data };
}

/**
 * 実行できる通常のファイルか。lstat で見て、記号リンクはたどらずに false（固定の結果）にする。実行はしない。
 * 確かめた後に記号リンクへ差し替えられた場合に備え、X_OK の確認の後にもう一度 lstat して、同じファイル（dev・ino）か比べる。
 */
export function isExecutableFile(p) {
  try {
    const st = fs.lstatSync(p);
    if (!st.isFile()) return false; // 記号リンク・フォルダ・特殊なファイル
    fs.accessSync(p, fs.constants.X_OK);
    const again = fs.lstatSync(p);
    if (!again.isFile() || again.dev !== st.dev || again.ino !== st.ino) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * PATH の各フォルダに、その名前の実行できる通常のファイルがあるか（shell と同じ探し方）。
 * 空の要素は今のフォルダ、相対のフォルダは cwd から解く。存在を調べるだけで、実行しない。
 * PATH が設定されていない（文字列でない）ときは、見つからない扱い。
 */
export function findOnPath(name, pathValue, cwd = process.cwd()) {
  if (typeof pathValue !== "string") return false;
  for (const dir of pathValue.split(path.delimiter)) {
    const resolved = dir === "" ? path.resolve(cwd) : path.resolve(cwd, dir);
    if (isExecutableFile(path.join(resolved, name))) return true;
  }
  return false;
}

// ---- 診断の本体（出力の文字列を返すだけ。書き出さない・終了しない） ----

/** 項目の並びを作る。opts は { repo, z3, env, cwd, platform, nodeVersion, sandboxExecPath } */
export function collectItems(opts) {
  const { repo, z3, env, cwd = process.cwd(), platform, nodeVersion, sandboxExecPath = DEFAULT_SANDBOX_EXEC } = opts;
  const items = [];

  // --repo そのものを最初に1回だけ確かめる。記号リンク・フォルダでない・ない・読めないなら、その下は読まない
  const repoOk = repoReadable(lstatKind(repo));

  // 1. Node.js の版
  items.push(nodeVersionItem(nodeVersion));

  // 2. コマンド（存在を調べるだけ）
  const pathValue = typeof env.PATH === "string" ? env.PATH : typeof env.Path === "string" ? env.Path : undefined;
  items.push(commandsItem(REQUIRED_COMMANDS.filter((c) => !findOnPath(c, pathValue, cwd))));

  // 3. OS と sandbox-exec
  items.push(sandboxItem(platform, platform === "darwin" && isExecutableFile(sandboxExecPath)));

  // 4. .claude/settings.json（中間の .claude も確かめる）
  items.push(
    repoOk
      ? settingsItem(readLimitedUnder(repo, [".claude", "settings.json"], LIMIT_SETTINGS_BYTES))
      : repoUnreadableItem("settings"),
  );

  // 5. vgdd/settings.v2.json（中間の vgdd も確かめる）
  items.push(
    repoOk ? sourceItem(probeRegularUnder(repo, ["vgdd", "settings.v2.json"])) : repoUnreadableItem("settings-source"),
  );

  // 6. 保護領域
  const zk = lstatKind(z3);
  const z3Kind = zk === "dir" ? "dir" : zk === "missing" ? "missing" : zk === "unreadable" ? "unreadable" : "not-dir";
  const missingSubdirs = z3Kind === "dir" ? Z3_SUBDIRS.filter((d) => lstatKind(path.join(z3, d)) !== "dir") : [];
  items.push(z3Item(z3Kind, missingSubdirs));

  // 7. 写しの一致（保護領域がフォルダとしてあるときだけ。中間の vgdd・scripts・hooks・bin も確かめる）。
  //    --repo の場所を読めないときは、ファイルごとに並べず1項目の fail にする
  if (z3Kind !== "dir") {
    items.push(item("z3-copies", "skip", MSG.copiesSkip));
  } else if (!repoOk) {
    items.push(repoUnreadableItem("z3-copies"));
  } else {
    const diffs = [];
    for (const f of COPY_ALLOWLIST) {
      const origin = readLimitedUnder(repo, [...f.src, f.name], LIMIT_COMPARE_BYTES);
      const copy = readLimitedUnder(z3, [f.dst, f.name], LIMIT_COMPARE_BYTES);
      const r = copyCompareItem(f.name, origin, copy);
      if (r) diffs.push(r);
    }
    if (diffs.length === 0) items.push(item("z3-copies", "ok", MSG.copiesOk));
    else items.push(...diffs);
  }

  // 8. .env.local（lstat で有無だけ。開かない・読まない・ハッシュしない）
  if (!repoOk) {
    items.push(repoUnreadableItem("env-local"));
  } else {
    let envKind;
    try {
      fs.lstatSync(path.join(repo, ".env.local"));
      envKind = "present";
    } catch (e) {
      envKind = e && (e.code === "ENOENT" || e.code === "ENOTDIR") ? "absent" : "unknown";
    }
    items.push(envLocalItem(envKind));
  }

  return items;
}

/** 通常の形式。最後に固定の1行 */
export function formatText(items) {
  const lines = items.map((it) => `[${it.status}] ${it.id}: ${it.message}`);
  lines.push(DISCLAIMER);
  return lines.join("\n") + "\n";
}

/** --json の形式：{ items: [{ id, status, message }], note: 固定の1行 } だけ（A1・A3） */
export function formatJson(items) {
  const out = items.map((it) => ({ id: it.id, status: it.status, message: it.message }));
  return JSON.stringify({ items: out, note: DISCLAIMER }) + "\n";
}

/**
 * 診断して、出力の文字列と終了コードを返す。書き出さない・終了しない。
 * ctx は { argv, cwd, env, homedir, platform, nodeVersion, sandboxExecPath? }
 */
export function runDoctor(ctx) {
  const json = Array.isArray(ctx.argv) && ctx.argv.includes("--json");
  let items;
  try {
    const args = parseArgs(ctx.argv, ctx);
    if (!args.ok) {
      items = [item("args", "fail", MSG.argsBad)];
    } else {
      items = collectItems({
        repo: args.repo,
        z3: args.z3,
        env: ctx.env,
        cwd: ctx.cwd,
        platform: ctx.platform,
        nodeVersion: ctx.nodeVersion,
        sandboxExecPath: ctx.sandboxExecPath,
      });
    }
  } catch {
    // 例外の message と stack は出さない
    items = [item("doctor", "fail", MSG.unexpected)];
  }
  return { output: json ? formatJson(items) : formatText(items), code: exitCodeOf(items) };
}

// ---- 入口（直接実行されたときだけ） ----

function main() {
  let result;
  try {
    result = runDoctor({
      argv: process.argv.slice(2),
      cwd: process.cwd(),
      env: process.env,
      homedir: os.homedir(),
      platform: process.platform,
      nodeVersion: process.versions.node,
    });
  } catch {
    result = { output: formatText([item("doctor", "fail", MSG.unexpected)]), code: 1 };
  }
  process.stdout.write(result.output);
  process.exitCode = result.code;
}

function isDirectRun() {
  try {
    if (!process.argv[1]) return false;
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) main();
