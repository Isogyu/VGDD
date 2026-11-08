// scripts/doctor.mjs の試験（T-044）。node --test scripts/doctor.test.mjs で動かす（vitest の対象外）。
// - 子プロセスは使わない。本体は runDoctor（出力の文字列を返す関数）を呼んで確かめる。
// - 試験が自分で作った一時フォルダの中だけで、合成の --repo・--z3・PATH を作る。
// - 本物の Z3 と本物の .env.local は使わない（読みもしない）。

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** @type {typeof import("./doctor.mjs")} */
let D;
let root; // この試験が作った一時フォルダ（後片付けはこれだけ）
let realRoot;
let importSideEffects;

const SECRET = "SYNTHETIC-SECRET-do-not-print-7f3a9c";
const FAKE_HOME_NAME = "home-of-fictional-user";

before(async () => {
  // 1つめの試験の前に import する。import だけでは出力も終了も起きないことを確かめる
  const written = [];
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const origExit = process.exit;
  const origCode = process.exitCode;
  let exited = false;
  process.stdout.write = (chunk, ...rest) => {
    written.push(String(chunk));
    return origOut.call(process.stdout, chunk, ...rest);
  };
  process.stderr.write = (chunk, ...rest) => {
    written.push(String(chunk));
    return origErr.call(process.stderr, chunk, ...rest);
  };
  process.exit = () => {
    exited = true;
    throw new Error("process.exit が呼ばれた");
  };
  try {
    D = await import("./doctor.mjs");
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    process.exit = origExit;
  }
  importSideEffects = { written, exited, codeChanged: process.exitCode !== origCode };

  root = fs.mkdtempSync(path.join(os.tmpdir(), "vgdd-doctor-test-"));
  realRoot = fs.realpathSync(root);
});

after(() => {
  // 自分で作った一時フォルダだけを片付ける
  if (root && path.basename(root).startsWith("vgdd-doctor-test-")) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- 合成の環境を作る道具 ----

let seq = 0;
function freshDir(label) {
  const d = path.join(root, `${label}-${seq++}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function writeFile(p, content, mode = 0o644) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, { mode });
}

/** 中身は実行しない合成の「コマンド」を並べた PATH 用フォルダ */
function makeBinDir(names) {
  const d = freshDir("pathbin");
  for (const n of names) writeFile(path.join(d, n), "# 合成の空ファイル。実行しない\n", 0o755);
  return d;
}

/** 合成の --repo。sandbox.enabled の値と、許可リストの原本を置く */
function makeRepo({ settings = JSON.stringify({ sandbox: { enabled: true } }), source = true, base } = {}) {
  const repo = base ?? freshDir("repo");
  fs.mkdirSync(repo, { recursive: true });
  if (settings !== null) writeFile(path.join(repo, ".claude", "settings.json"), settings);
  if (source) writeFile(path.join(repo, "vgdd", "settings.v2.json"), "{}\n");
  for (const f of D.COPY_ALLOWLIST) {
    writeFile(path.join(repo, ...f.src, f.name), `# 合成の原本 ${f.name}\n`);
  }
  return repo;
}

/** 合成の --z3。repo の原本をそのまま写す */
function makeZ3(repo, { subdirs = D.Z3_SUBDIRS } = {}) {
  const z3 = freshDir("z3");
  for (const s of subdirs) fs.mkdirSync(path.join(z3, s), { recursive: true });
  if (subdirs.includes("bin") && subdirs.includes("hooks")) {
    for (const f of D.COPY_ALLOWLIST) {
      fs.copyFileSync(path.join(repo, ...f.src, f.name), path.join(z3, f.dst, f.name));
    }
  }
  return z3;
}

function makeSandboxExec() {
  const p = path.join(freshDir("usrbin"), "sandbox-exec");
  writeFile(p, "# 合成の空ファイル。実行しない\n", 0o755);
  return p;
}

function ctxFor({ repo, z3, json = false, extraArgs = [], env = {}, platform = "darwin", nodeVersion = "24.1.0" }) {
  const argv = ["--repo", repo, "--z3", z3, ...extraArgs];
  if (json) argv.push("--json");
  return {
    argv,
    cwd: root,
    env: { PATH: makeBinDir(D.REQUIRED_COMMANDS), ...env },
    homedir: path.join(root, FAKE_HOME_NAME),
    platform,
    nodeVersion,
    sandboxExecPath: makeSandboxExec(),
  };
}

function itemsOf(ctx) {
  const r = D.runDoctor({ ...ctx, argv: [...ctx.argv.filter((a) => a !== "--json"), "--json"] });
  return JSON.parse(r.output).items;
}

function find(items, id) {
  return items.filter((it) => it.id === id);
}

function isRoot() {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

// ---- import の副作用 ----

test("import しただけでは診断・出力・process.exit が起きない", () => {
  assert.deepEqual(importSideEffects.written, []);
  assert.equal(importSideEffects.exited, false);
  assert.equal(importSideEffects.codeChanged, false);
});

// ---- 判定の純粋関数 ----

test("A1-1 Node.js の版：24 以上は ok、22〜23 は warn、22 未満と読めない版は fail", () => {
  assert.equal(D.nodeVersionItem("24.0.0").status, "ok");
  assert.equal(D.nodeVersionItem("30.2.1").status, "ok");
  assert.equal(D.nodeVersionItem("23.11.0").status, "warn");
  assert.equal(D.nodeVersionItem("22.0.0").status, "warn");
  assert.equal(D.nodeVersionItem("22.0.0").message, "適合性テストだけ動く");
  assert.equal(D.nodeVersionItem("21.9.9").status, "fail");
  assert.equal(D.nodeVersionItem("18.0.0").status, "fail");
  assert.equal(D.nodeVersionItem("").status, "fail");
  assert.equal(D.nodeVersionItem(undefined).status, "fail");
});

test("A1-2 コマンド：1つでもなければ fail", () => {
  assert.equal(D.commandsItem([]).status, "ok");
  const r = D.commandsItem(["jq", "python3"]);
  assert.equal(r.status, "fail");
  assert.ok(r.message.includes("jq") && r.message.includes("python3"));
});

test("A1-2 PATH の探索：実行できる通常のファイルだけを数え、sha256sum は shasum の代わりにしない", () => {
  const a = freshDir("path-a");
  writeFile(path.join(a, "git"), "", 0o755); // 実行できる通常のファイル
  writeFile(path.join(a, "jq"), "", 0o644); // 実行できない
  fs.mkdirSync(path.join(a, "npm")); // フォルダ
  writeFile(path.join(a, "sha256sum"), "", 0o755); // 代わりにしない
  const emptyCwd = freshDir("path-cwd-empty");
  const pathValue = ["", "relative/dir", a].join(path.delimiter);
  assert.equal(D.findOnPath("git", pathValue, emptyCwd), true);
  assert.equal(D.findOnPath("jq", pathValue, emptyCwd), false);
  assert.equal(D.findOnPath("npm", pathValue, emptyCwd), false);
  assert.equal(D.findOnPath("shasum", pathValue, emptyCwd), false);
  assert.equal(D.findOnPath("git", "", emptyCwd), false);
  assert.equal(D.findOnPath("git", undefined, emptyCwd), false);

  const repo = makeRepo();
  const ctx = ctxFor({ repo, z3: makeZ3(repo) });
  ctx.env.PATH = pathValue;
  const [c] = find(itemsOf(ctx), "commands");
  assert.equal(c.status, "fail");
  for (const n of ["jq", "shasum", "npm", "python3"]) assert.ok(c.message.includes(n), n);
});

test("A1-2 PATH の探索：空の要素は今のフォルダ、相対のフォルダは今のフォルダから解く（shell と同じ）", () => {
  const cwd = freshDir("path-cwd");
  writeFile(path.join(cwd, "jq"), "", 0o755); // 空の要素（今のフォルダ）で見つかる
  writeFile(path.join(cwd, "rel", "bin", "python3"), "", 0o755); // 相対のフォルダで見つかる
  writeFile(path.join(cwd, "rel", "bin", "plain"), "", 0o644); // 実行できないものは数えない
  const other = freshDir("path-other");
  // 空の要素：先頭・途中・末尾、PATH そのものが空
  for (const pv of ["", `${path.delimiter}${other}`, `${other}${path.delimiter}${path.delimiter}${other}`, `${other}${path.delimiter}`]) {
    assert.equal(D.findOnPath("jq", pv, cwd), true, "空の要素");
  }
  assert.equal(D.findOnPath("jq", other, cwd), false);
  // 相対のフォルダ
  for (const rel of ["rel/bin", "./rel/bin", path.join("rel", "..", "rel", "bin")]) {
    assert.equal(D.findOnPath("python3", [other, rel].join(path.delimiter), cwd), true, "相対のフォルダ");
  }
  assert.equal(D.findOnPath("python3", "rel/bin", other), false); // cwd が違えば見つからない
  assert.equal(D.findOnPath("plain", "rel/bin", cwd), false);

  // 本体でも ctx.cwd から解く。見つかっても、出力にパスは出ない
  const repo = makeRepo();
  const ctx = ctxFor({ repo, z3: makeZ3(repo) });
  const binAbs = ctx.env.PATH;
  ctx.cwd = path.dirname(binAbs);
  ctx.env.PATH = ["", path.basename(binAbs)].join(path.delimiter);
  const [c] = find(itemsOf(ctx), "commands");
  assert.equal(c.status, "ok");
  const r = D.runDoctor(ctx);
  assert.ok(!r.output.includes(root) && !r.output.includes(realRoot));
});

test("A1-3 OS と sandbox-exec", () => {
  assert.equal(D.sandboxItem("darwin", true).status, "ok");
  assert.equal(D.sandboxItem("darwin", false).status, "fail");
  for (const p of ["linux", "win32", "freebsd"]) {
    const r = D.sandboxItem(p, true);
    assert.equal(r.status, "warn");
    assert.equal(r.message, "裁判所の監査の sandbox は macOS 専用。この OS では実稼働の安全制御は未検証");
  }
  const repo = makeRepo();
  const ctx = ctxFor({ repo, z3: makeZ3(repo) });
  ctx.sandboxExecPath = path.join(root, "no-such-sandbox-exec");
  assert.equal(find(itemsOf(ctx), "sandbox")[0].status, "fail");
  assert.equal(D.runDoctor(ctx).code, 1);
  // macOS 以外は sandbox-exec の有無によらず warn で、それだけでは終了コード 1 にしない
  for (const p of ["linux", "win32"]) {
    const other = ctxFor({ repo, z3: makeZ3(repo), platform: p });
    other.sandboxExecPath = path.join(root, "no-such-sandbox-exec");
    const [s] = find(itemsOf(other), "sandbox");
    assert.equal(s.status, "warn", p);
    assert.equal(D.runDoctor(other).code, 0, p);
  }
});

test("--json は { items, note } だけ。note は固定の1行、items に notice はない。通常の形式の最後の行も固定の1行", () => {
  const repo = makeRepo();
  const ctx = ctxFor({ repo, z3: makeZ3(repo) });
  const parsed = JSON.parse(D.runDoctor({ ...ctx, argv: [...ctx.argv, "--json"] }).output);
  assert.deepEqual(Object.keys(parsed).sort(), ["items", "note"]);
  assert.equal(parsed.note, "この診断は導入の完了や実稼働の安全を保証しない");
  assert.ok(Array.isArray(parsed.items));
  assert.equal(find(parsed.items, "notice").length, 0);
  assert.ok(parsed.items.every((it) => it.message !== D.DISCLAIMER));
  const text = D.runDoctor(ctx).output;
  assert.ok(text.endsWith("\n"));
  assert.equal(text.trimEnd().split("\n").at(-1), "この診断は導入の完了や実稼働の安全を保証しない");
  // 引数の誤りのときも同じ形
  const bad = JSON.parse(D.runDoctor({ ...ctx, argv: ["--nope", "--json"] }).output);
  assert.deepEqual(Object.keys(bad).sort(), ["items", "note"]);
  assert.equal(bad.note, D.DISCLAIMER);
  assert.equal(D.runDoctor({ ...ctx, argv: ["--nope"] }).output.trimEnd().split("\n").at(-1), D.DISCLAIMER);
});

test("A2 終了コード：fail が1つでもあれば 1、それ以外は 0", () => {
  assert.equal(D.exitCodeOf([]), 0);
  assert.equal(D.exitCodeOf([{ status: "ok" }, { status: "warn" }, { status: "skip" }]), 0);
  assert.equal(D.exitCodeOf([{ status: "ok" }, { status: "fail" }]), 1);
});

test("A1 --repo の場所：記号リンクでないフォルダのときだけ下を読む（純粋関数）", () => {
  assert.equal(D.repoReadable("dir"), true);
  for (const k of ["symlink", "regular", "other", "missing", "unreadable"]) assert.equal(D.repoReadable(k), false, k);
  for (const id of ["settings", "settings-source", "z3-copies", "env-local"]) {
    assert.deepEqual(D.repoUnreadableItem(id), { id, status: "fail", message: "リポジトリの場所を読めない" });
  }
});

// ---- 合成の --repo・--z3 での本体 ----

test("全部そろった合成の環境：fail なし、終了コード 0、項目がすべて出る", () => {
  const repo = makeRepo();
  const ctx = ctxFor({ repo, z3: makeZ3(repo) });
  const r = D.runDoctor(ctx);
  assert.equal(r.code, 0);
  const items = itemsOf(ctx);
  const ids = items.map((it) => it.id);
  assert.deepEqual(ids, ["node", "commands", "sandbox", "settings", "settings-source", "z3", "z3-copies", "env-local"]);
  for (const it of items) assert.equal(it.status, "ok", it.id);
  assert.equal(find(items, "env-local")[0].message, "API キーの設定ファイルはない（API なしで動く）");
  // 通常の形式の最後の行は固定の1行
  const lines = r.output.trimEnd().split("\n");
  assert.equal(lines.at(-1), "この診断は導入の完了や実稼働の安全を保証しない");
});

test("A1-4 settings.json：ない・不正な JSON・sandbox.enabled が true でない・記号リンク・大きすぎる は fail", () => {
  const cases = [
    { settings: null },
    { settings: "{ これは JSON ではない" },
    { settings: JSON.stringify({ sandbox: { enabled: "true" } }) },
    { settings: JSON.stringify({ sandbox: false }) },
    { settings: "null" },
    { settings: JSON.stringify({}) },
  ];
  for (const c of cases) {
    const repo = makeRepo(c);
    const r = find(itemsOf(ctxFor({ repo, z3: makeZ3(repo) })), "settings")[0];
    assert.equal(r.status, "fail", String(c.settings));
  }
  // 記号リンクはたどらない（指す先が正しい JSON でも fail）
  const repo = makeRepo({ settings: null });
  const target = path.join(freshDir("elsewhere"), "settings.json");
  writeFile(target, JSON.stringify({ sandbox: { enabled: true } }));
  fs.mkdirSync(path.join(repo, ".claude"), { recursive: true });
  fs.symlinkSync(target, path.join(repo, ".claude", "settings.json"));
  const s = find(itemsOf(ctxFor({ repo, z3: makeZ3(repo) })), "settings")[0];
  assert.equal(s.status, "fail");
  assert.ok(s.message.includes("通常のファイルでない"));
  // 1MiB を超える
  const big = makeRepo({ settings: " ".repeat(D.LIMIT_SETTINGS_BYTES + 1) });
  const b = find(itemsOf(ctxFor({ repo: big, z3: makeZ3(big) })), "settings")[0];
  assert.equal(b.status, "fail");
  assert.ok(b.message.includes("大きすぎる"));
});

test("A1-4 settings.json が読めない（権限なし）は fail", () => {
  // 判定の純粋関数は、権限によらず確かめる
  assert.deepEqual(D.settingsItem({ kind: "unreadable" }), { id: "settings", status: "fail", message: D.MSG.settingsUnreadable });
  // root は権限で読めなくできないので、権限を外した本物のファイルでの確認は root 以外でだけ行う（試験は飛ばさない）
  if (isRoot()) return;
  const repo = makeRepo();
  const p = path.join(repo, ".claude", "settings.json");
  fs.chmodSync(p, 0o000);
  try {
    const r = find(itemsOf(ctxFor({ repo, z3: makeZ3(repo) })), "settings")[0];
    assert.equal(r.status, "fail");
    assert.ok(r.message.includes("読めない"));
  } finally {
    fs.chmodSync(p, 0o644);
  }
});

test("A1-5 設定の原本：なければ fail", () => {
  const repo = makeRepo({ source: false });
  assert.equal(find(itemsOf(ctxFor({ repo, z3: makeZ3(repo) })), "settings-source")[0].status, "fail");
});

test("A1-6 保護領域がなければ warn、A1-7 は skip。足りないフォルダは warn", () => {
  const repo = makeRepo();
  const items = itemsOf(ctxFor({ repo, z3: path.join(root, "no-such-z3") }));
  assert.deepEqual(find(items, "z3")[0], { id: "z3", status: "warn", message: "Kernel の保護領域がない。clone で試すだけなら不要" });
  assert.equal(find(items, "z3-copies")[0].status, "skip");

  const z3 = makeZ3(repo, { subdirs: ["bin", "hooks"] });
  const z = find(itemsOf(ctxFor({ repo, z3 })), "z3")[0];
  assert.equal(z.status, "warn");
  assert.ok(z.message.includes("evidence/"));

  // 保護領域が記号リンクならたどらない
  const link = path.join(freshDir("z3link"), "z3");
  fs.symlinkSync(makeZ3(repo), link);
  const items2 = itemsOf(ctxFor({ repo, z3: link }));
  assert.equal(find(items2, "z3")[0].status, "warn");
  assert.equal(find(items2, "z3-copies")[0].status, "skip");
});

test("A1-7 写し：同じなら ok、違う・ない・記号リンクは warn で許可リストのファイル名を出す", () => {
  const repo = makeRepo();
  const z3 = makeZ3(repo);
  assert.equal(find(itemsOf(ctxFor({ repo, z3 })), "z3-copies")[0].status, "ok");

  writeFile(path.join(z3, "bin", "judge.sh"), "# 書き換えた写し\n");
  fs.rmSync(path.join(z3, "hooks", "policy.mjs"));
  fs.rmSync(path.join(z3, "bin", "release.sh"));
  fs.symlinkSync(path.join(repo, "vgdd", "scripts", "release.sh"), path.join(z3, "bin", "release.sh"));
  const copies = find(itemsOf(ctxFor({ repo, z3 })), "z3-copies");
  assert.deepEqual(
    copies.map((c) => [c.status, c.message]),
    [
      ["warn", "配置済みの写しが原本と違う：judge.sh"],
      ["warn", "配置済みの写しが原本と違う：release.sh"],
      ["warn", "配置済みの写しが原本と違う：policy.mjs"],
    ],
  );
  // warn だけなら終了コードは 0
  assert.equal(D.runDoctor(ctxFor({ repo, z3 })).code, 0);
});

test("A1-7 原本がない・記号リンクは warn「配置済みの写しが原本と違う」（たどらない）", () => {
  const repo = makeRepo();
  const z3 = makeZ3(repo);
  fs.rmSync(path.join(repo, "vgdd", "scripts", "gate-runner.sh"));
  // 原本を記号リンクにする（指す先は写しと同じ中身でも、たどらない）
  const target = path.join(freshDir("origin-target"), "judge.sh");
  fs.copyFileSync(path.join(repo, "vgdd", "scripts", "judge.sh"), target);
  fs.rmSync(path.join(repo, "vgdd", "scripts", "judge.sh"));
  fs.symlinkSync(target, path.join(repo, "vgdd", "scripts", "judge.sh"));
  const items = find(itemsOf(ctxFor({ repo, z3 })), "z3-copies");
  assert.deepEqual(items, [
    { id: "z3-copies", status: "warn", message: "配置済みの写しが原本と違う：gate-runner.sh" },
    { id: "z3-copies", status: "warn", message: "配置済みの写しが原本と違う：judge.sh" },
  ]);
  // warn だけなので終了コードは 0
  assert.equal(D.runDoctor(ctxFor({ repo, z3 })).code, 0);
});

test("A1-7 原本の途中のフォルダがない：vgdd/scripts ごと・vgdd/hooks ごと・1ファイルだけない、はどれも warn で fail がない", () => {
  const expectWarnOnly = (repo, z3, names) => {
    const ctx = ctxFor({ repo, z3 });
    const items = itemsOf(ctx);
    assert.deepEqual(
      find(items, "z3-copies"),
      names.map((n) => ({ id: "z3-copies", status: "warn", message: D.MSG.copyDiffers(n) })),
    );
    assert.equal(items.filter((it) => it.status === "fail").length, 0);
    assert.equal(D.runDoctor(ctx).code, 0);
  };
  const scriptNames = D.COPY_ALLOWLIST.filter((f) => f.src.join("/") === "vgdd/scripts").map((f) => f.name);

  // vgdd/scripts ごとない
  const r1 = makeRepo();
  const z1 = makeZ3(r1);
  fs.rmSync(path.join(r1, "vgdd", "scripts"), { recursive: true });
  expectWarnOnly(r1, z1, scriptNames);

  // vgdd/hooks ごとない
  const r2 = makeRepo();
  const z2 = makeZ3(r2);
  fs.rmSync(path.join(r2, "vgdd", "hooks"), { recursive: true });
  expectWarnOnly(r2, z2, ["policy.mjs"]);

  // 1ファイルだけない
  const r3 = makeRepo();
  const z3 = makeZ3(r3);
  fs.rmSync(path.join(r3, "vgdd", "scripts", "spec-digest.mjs"));
  expectWarnOnly(r3, z3, ["spec-digest.mjs"]);

  // 写しの側でも、bin ごとない は warn（z3 は足りないフォルダの warn）
  const r4 = makeRepo();
  const z4 = makeZ3(r4);
  fs.rmSync(path.join(z4, "bin"), { recursive: true });
  expectWarnOnly(r4, z4, scriptNames);
});

test("A1-7 原本・写しの途中のフォルダが読めない（権限）は fail", () => {
  // 判定の純粋関数は、権限によらず確かめる（ない→warn、読めない→fail）
  const ok = { kind: "ok", data: Buffer.from("a") };
  assert.equal(D.copyCompareItem("judge.sh", { kind: "missing" }, ok).status, "warn");
  assert.equal(D.copyCompareItem("judge.sh", { kind: "unreadable" }, ok).status, "fail");
  if (isRoot()) return;
  // 原本の側：vgdd/scripts を検索できなくする
  const repo = makeRepo();
  const z3 = makeZ3(repo);
  const scripts = path.join(repo, "vgdd", "scripts");
  fs.chmodSync(scripts, 0o000);
  try {
    const copies = find(itemsOf(ctxFor({ repo, z3 })), "z3-copies");
    const scriptNames = D.COPY_ALLOWLIST.filter((f) => f.src.join("/") === "vgdd/scripts").map((f) => f.name);
    assert.deepEqual(
      copies,
      scriptNames.map((n) => ({ id: "z3-copies", status: "fail", message: D.MSG.originUnreadable(n) })),
    );
  } finally {
    fs.chmodSync(scripts, 0o755);
  }
  // 写しの側：z3/hooks を検索できなくする
  const hooks = path.join(z3, "hooks");
  fs.chmodSync(hooks, 0o000);
  try {
    const copies = find(itemsOf(ctxFor({ repo, z3 })), "z3-copies");
    assert.deepEqual(copies, [{ id: "z3-copies", status: "fail", message: D.MSG.copyUnreadable("policy.mjs") }]);
  } finally {
    fs.chmodSync(hooks, 0o755);
  }
});

// ---- 中間の要素（親のフォルダ）が記号リンクのとき、その先を読まない ----

/** dir を、中身をそのまま持つ別の場所へ移し、元の場所をそこへの記号リンクにする */
function replaceWithSymlink(dir, { secret = false } = {}) {
  const target = path.join(freshDir("link-target"), path.basename(dir));
  fs.cpSync(dir, target, { recursive: true });
  if (secret) {
    for (const name of fs.readdirSync(target)) {
      const p = path.join(target, name);
      if (fs.lstatSync(p).isFile()) fs.appendFileSync(p, `\n# ${SECRET}\n`);
    }
  }
  fs.rmSync(dir, { recursive: true });
  fs.symlinkSync(target, dir);
  return target;
}

function assertNoLeak(ctx) {
  for (const json of [false, true]) {
    const r = D.runDoctor({ ...ctx, argv: json ? [...ctx.argv, "--json"] : ctx.argv });
    for (const f of [SECRET, root, realRoot]) assert.ok(!r.output.includes(f), "出てはいけない文字列が出た");
  }
}

test("親の記号リンク：--repo の .claude が記号リンクなら、先が正しい設定でも秘密入りでも settings は fail", () => {
  for (const secret of [false, true]) {
    const repo = makeRepo({ settings: secret ? `{ "sandbox": { "enabled": true }, "k": "${SECRET}" }` : undefined });
    replaceWithSymlink(path.join(repo, ".claude"));
    const ctx = ctxFor({ repo, z3: makeZ3(repo) });
    const [s] = find(itemsOf(ctx), "settings");
    assert.deepEqual(s, { id: "settings", status: "fail", message: D.MSG.settingsNotRegular });
    assert.equal(D.runDoctor(ctx).code, 1);
    assertNoLeak(ctx);
  }
});

test("親の記号リンク：--repo の vgdd が記号リンクなら、設定の原本は fail、写しは「一致」にならない", () => {
  const repo = makeRepo();
  const z3 = makeZ3(repo); // 写しは原本と同じ中身
  replaceWithSymlink(path.join(repo, "vgdd"));
  const items = itemsOf(ctxFor({ repo, z3 }));
  assert.deepEqual(find(items, "settings-source")[0], { id: "settings-source", status: "fail", message: D.MSG.sourceNotRegular });
  const copies = find(items, "z3-copies");
  assert.deepEqual(
    copies,
    D.COPY_ALLOWLIST.map((f) => ({ id: "z3-copies", status: "warn", message: D.MSG.copyDiffers(f.name) })),
  );
});

test("親の記号リンク：--repo の vgdd/scripts が記号リンクなら、先が正しい中身でも秘密入りでも「一致」にならない（たどらない）", () => {
  for (const secret of [false, true]) {
    const repo = makeRepo();
    const z3 = makeZ3(repo); // 写しは原本と同じ中身
    replaceWithSymlink(path.join(repo, "vgdd", "scripts"), { secret });
    const ctx = ctxFor({ repo, z3 });
    const copies = find(itemsOf(ctx), "z3-copies");
    const expected = D.COPY_ALLOWLIST.filter((f) => f.src.join("/") === "vgdd/scripts").map((f) => ({
      id: "z3-copies",
      status: "warn",
      message: D.MSG.copyDiffers(f.name),
    }));
    assert.deepEqual(copies, expected); // hooks/policy.mjs は通常のフォルダなので一致（項目に出ない）
    assert.equal(D.runDoctor(ctx).code, 0); // ほかの項目は ok、写しは warn だけ
    assertNoLeak(ctx);
  }
});

test("親の記号リンク：--z3 の bin・hooks が記号リンクなら、先が正しい写しでも秘密入りでも「一致」にならない", () => {
  for (const secret of [false, true]) {
    const repo = makeRepo();
    const z3 = makeZ3(repo);
    replaceWithSymlink(path.join(z3, "bin"), { secret });
    replaceWithSymlink(path.join(z3, "hooks"), { secret });
    const ctx = ctxFor({ repo, z3 });
    const items = itemsOf(ctx);
    const copies = find(items, "z3-copies");
    assert.deepEqual(
      copies,
      D.COPY_ALLOWLIST.map((f) => ({ id: "z3-copies", status: "warn", message: D.MSG.copyDiffers(f.name) })),
    );
    // 記号リンクのフォルダはフォルダとして数えない
    const [z] = find(items, "z3");
    assert.equal(z.status, "warn");
    assert.ok(z.message.includes("bin/") && z.message.includes("hooks/"));
    assertNoLeak(ctx);
  }
});

// ---- --repo そのものが読めない場所（記号リンク・通常のファイル・存在しない） ----

const REPO_UNREADABLE = "リポジトリの場所を読めない";

test("--repo そのものが記号リンク・通常のファイル・存在しない：4・5・7・8 は fail「リポジトリの場所を読めない」、7 は1項目、終了コード 1", () => {
  const cases = [];
  for (const secret of [false, true]) {
    // 記号リンク（先が正しい中身でも秘密入りでも読まない）
    const real = makeRepo({ settings: secret ? `{ "sandbox": { "enabled": true }, "k": "${SECRET}" }` : undefined });
    if (secret) writeFile(path.join(real, ".env.local"), `ANTHROPIC_API_KEY=${SECRET}\n`, 0o600);
    const link = path.join(freshDir("repolink"), "repo");
    fs.symlinkSync(real, link);
    cases.push({ label: `記号リンク secret=${secret}`, repo: link, origin: real });
  }
  // 通常のファイル（中身に秘密を入れても読まない）
  const file = path.join(freshDir("repofile"), "repo");
  writeFile(file, `# ${SECRET}\n`);
  cases.push({ label: "通常のファイル", repo: file, origin: makeRepo() });
  // 存在しない
  cases.push({ label: "存在しない", repo: path.join(root, "no-such-repo"), origin: makeRepo() });

  for (const c of cases) {
    // --z3 がフォルダのとき：7 は1項目の fail
    const z3 = makeZ3(c.origin); // 写しは先の原本と同じ中身
    const ctx = ctxFor({ repo: c.repo, z3 });
    const items = itemsOf(ctx);
    for (const id of ["settings", "settings-source", "z3-copies", "env-local"]) {
      assert.deepEqual(find(items, id), [{ id, status: "fail", message: REPO_UNREADABLE }], `${c.label} ${id}`);
    }
    // 1〜3 と 6 は変わらない
    for (const id of ["node", "commands", "sandbox", "z3"]) assert.equal(find(items, id)[0].status, "ok", `${c.label} ${id}`);
    assert.equal(D.runDoctor(ctx).code, 1, c.label);
    assertNoLeak(ctx);

    // --z3 がないとき：7 は skip のまま、ほかの 4・5・8 は fail
    const ctxNoZ3 = ctxFor({ repo: c.repo, z3: path.join(root, "no-such-z3") });
    const items2 = itemsOf(ctxNoZ3);
    assert.deepEqual(find(items2, "z3-copies"), [{ id: "z3-copies", status: "skip", message: D.MSG.copiesSkip }], c.label);
    assert.equal(find(items2, "z3")[0].status, "warn", c.label);
    for (const id of ["settings", "settings-source", "env-local"]) {
      assert.deepEqual(find(items2, id), [{ id, status: "fail", message: REPO_UNREADABLE }], `${c.label} ${id}`);
    }
    assert.equal(D.runDoctor(ctxNoZ3).code, 1, c.label);
    assertNoLeak(ctxNoZ3);
  }
});

test("A1-2・A1-3 記号リンクはたどらない：PATH の上のコマンドと sandbox-exec が記号リンクなら、ないものとして扱う", () => {
  const realBin = makeBinDir(D.REQUIRED_COMMANDS);
  const linkBin = freshDir("pathbin-links");
  for (const n of D.REQUIRED_COMMANDS) fs.symlinkSync(path.join(realBin, n), path.join(linkBin, n));
  for (const n of D.REQUIRED_COMMANDS) {
    assert.equal(D.findOnPath(n, realBin, root), true, n);
    assert.equal(D.findOnPath(n, linkBin, root), false, n);
  }
  assert.equal(D.isExecutableFile(path.join(linkBin, "git")), false);
  assert.equal(D.isExecutableFile(path.join(realBin, "git")), true);

  const repo = makeRepo();
  const ctx = ctxFor({ repo, z3: makeZ3(repo) });
  ctx.env.PATH = linkBin;
  const [c] = find(itemsOf(ctx), "commands");
  assert.equal(c.status, "fail");
  for (const n of D.REQUIRED_COMMANDS) assert.ok(c.message.includes(n), n);

  // sandbox-exec が記号リンクなら、先が実行できる通常のファイルでも fail
  const ctx2 = ctxFor({ repo, z3: makeZ3(repo) });
  const sbLink = path.join(freshDir("usrbin-link"), "sandbox-exec");
  fs.symlinkSync(ctx2.sandboxExecPath, sbLink);
  ctx2.sandboxExecPath = sbLink;
  assert.deepEqual(find(itemsOf(ctx2), "sandbox")[0], { id: "sandbox", status: "fail", message: D.MSG.sandboxMissing });
  assert.equal(D.runDoctor(ctx2).code, 1);
  assertNoLeak(ctx2);
});

test("readLimitedUnder・probeRegularUnder：中間がファイル・記号リンク・ないとき", () => {
  const base = freshDir("under");
  writeFile(path.join(base, "d", "f"), "x");
  writeFile(path.join(base, "file"), "x");
  fs.symlinkSync(path.join(base, "d"), path.join(base, "ld"));
  assert.equal(D.readLimitedUnder(base, ["d", "f"], 16).kind, "ok");
  assert.equal(D.readLimitedUnder(base, ["ld", "f"], 16).kind, "not-regular");
  assert.equal(D.readLimitedUnder(base, ["file", "f"], 16).kind, "not-regular");
  assert.equal(D.readLimitedUnder(base, ["none", "f"], 16).kind, "missing");
  assert.equal(D.probeRegularUnder(base, ["d", "f"]), "ok");
  assert.equal(D.probeRegularUnder(base, ["ld", "f"]), "not-regular");
  assert.equal(D.probeRegularUnder(base, ["none", "f"]), "missing");
  // base そのものが記号リンクなら、先をたどらない（not-regular）。base がない・ファイルのときも中身を読まない
  const baseLink = path.join(freshDir("under-link"), "b");
  fs.symlinkSync(base, baseLink);
  assert.deepEqual(D.readLimitedUnder(baseLink, ["d", "f"], 16), { kind: "not-regular" });
  assert.equal(D.probeRegularUnder(baseLink, ["d", "f"]), "not-regular");
  assert.equal(D.checkParents(baseLink, ["f"]), "not-regular");
  assert.equal(D.readLimitedUnder(path.join(base, "file"), ["f"], 16).kind, "not-regular");
  assert.equal(D.readLimitedUnder(path.join(base, "none"), ["d", "f"], 16).kind, "missing");
  // 読んだ結果に dev・ino を混ぜない
  assert.deepEqual(Object.keys(D.readLimitedUnder(base, ["d", "f"], 16)).sort(), ["data", "kind"]);
});

test("A1-7 copyCompareItem：原本・写しの違う・ない・記号リンク・大きすぎるは warn「違う」、読めないは fail", () => {
  const ok = { kind: "ok", data: Buffer.from("a") };
  const differs = { id: "z3-copies", status: "warn", message: "配置済みの写しが原本と違う：judge.sh" };
  assert.equal(D.copyCompareItem("judge.sh", ok, ok), null);
  for (const kind of ["missing", "not-regular", "too-large"]) {
    assert.deepEqual(D.copyCompareItem("judge.sh", ok, { kind }), differs, `写し ${kind}`);
    assert.deepEqual(D.copyCompareItem("judge.sh", { kind }, ok), differs, `原本 ${kind}`);
    assert.deepEqual(D.copyCompareItem("judge.sh", { kind }, { kind: "missing" }), differs, `両方 ${kind}`);
  }
  assert.deepEqual(D.copyCompareItem("judge.sh", ok, { kind: "ok", data: Buffer.from("b") }), differs);
  assert.equal(D.copyCompareItem("judge.sh", ok, { kind: "unreadable" }).status, "fail");
  assert.equal(D.copyCompareItem("judge.sh", { kind: "unreadable" }, ok).status, "fail");
});

test("readLimited：上限ちょうどは読み、上限を超えると too-large、記号リンクと特殊なファイルは not-regular", () => {
  const d = freshDir("limited");
  writeFile(path.join(d, "eq"), "x".repeat(16));
  writeFile(path.join(d, "over"), "x".repeat(17));
  fs.symlinkSync(path.join(d, "eq"), path.join(d, "link"));
  assert.equal(D.readLimited(path.join(d, "eq"), 16).kind, "ok");
  assert.equal(D.readLimited(path.join(d, "over"), 16).kind, "too-large");
  assert.equal(D.readLimited(path.join(d, "link"), 16).kind, "not-regular");
  assert.equal(D.readLimited(d, 16).kind, "not-regular");
  assert.equal(D.readLimited(path.join(d, "none"), 16).kind, "missing");
});

test("A1-8 .env.local：有れば ok（中身は読まない）、なければ ok", () => {
  assert.deepEqual(D.envLocalItem("present"), { id: "env-local", status: "ok", message: "API キーの設定ファイルがある（中身は読んでいない）" });
  assert.deepEqual(D.envLocalItem("absent"), { id: "env-local", status: "ok", message: "API キーの設定ファイルはない（API なしで動く）" });
  const repo = makeRepo();
  writeFile(path.join(repo, ".env.local"), `ANTHROPIC_API_KEY=${SECRET}\n`, 0o600);
  const r = find(itemsOf(ctxFor({ repo, z3: makeZ3(repo) })), "env-local")[0];
  assert.equal(r.message, "API キーの設定ファイルがある（中身は読んでいない）");
});

test("引数の誤り：fail で終了コード 1、引数の値は出さない", () => {
  for (const json of [false, true]) {
    const argv = ["--unknown", SECRET, "--repo"];
    if (json) argv.push("--json");
    const r = D.runDoctor({ argv, cwd: root, env: {}, homedir: root, platform: "darwin", nodeVersion: "24.0.0" });
    assert.equal(r.code, 1);
    assert.ok(!r.output.includes(SECRET));
    if (json) assert.equal(JSON.parse(r.output).items[0].id, "args");
  }
});

test("既定の --z3：VGDD_Z3_DIR、なければ HOME の下（パスは返すだけで出力しない）", () => {
  const base = { cwd: root, homedir: path.join(root, FAKE_HOME_NAME) };
  assert.equal(D.parseArgs([], { ...base, env: { VGDD_Z3_DIR: path.join(root, "zz") } }).z3, path.join(root, "zz"));
  assert.equal(D.parseArgs([], { ...base, env: {} }).z3, path.join(root, FAKE_HOME_NAME, "tsubuyaki-z3"));
  assert.equal(D.parseArgs([], { ...base, env: {} }).repo, root);
});

// ---- A3：秘密を出さない ----

test("A3 秘密・一時フォルダの絶対パス・HOME・改行を含むファイル名が、通常の形式にも --json にも出ない", () => {
  // --repo 自体の名前に改行と秘密を入れる
  const base = path.join(freshDir("leak"), `repo\n${SECRET}`);
  const repo = makeRepo({ base, settings: `{ "sandbox": ${SECRET}` }); // 不正な JSON に秘密を入れる
  writeFile(path.join(repo, ".env.local"), `ANTHROPIC_API_KEY=${SECRET}\nOTHER=${SECRET}\n`, 0o600);
  // 改行を含むファイル名を、原本と写しの両方のフォルダに置く
  const nlName = `evil\n${SECRET}.sh`;
  writeFile(path.join(repo, "vgdd", "scripts", nlName), SECRET);
  const z3 = makeZ3(repo);
  writeFile(path.join(z3, "bin", nlName), SECRET);
  writeFile(path.join(z3, "bin", "judge.sh"), `# ${SECRET}\n`); // 違う写し（中身に秘密）

  const fakeHome = path.join(root, FAKE_HOME_NAME);
  const forbidden = [SECRET, root, realRoot, os.tmpdir(), fakeHome, os.homedir(), "evil"];
  if (process.env.HOME) forbidden.push(process.env.HOME);

  for (const json of [false, true]) {
    const ctx = ctxFor({ repo, z3, json, env: { ANTHROPIC_API_KEY: SECRET, HOME: fakeHome, VGDD_Z3_DIR: SECRET } });
    const r = D.runDoctor(ctx);
    for (const f of forbidden) assert.ok(!r.output.includes(f), `${json ? "json" : "text"} に出てはいけない文字列が出た`);
    // 改行は、行の区切りとしてだけ現れる（通常の形式は項目の数＋1行、JSON は1行）
    const lines = r.output.trimEnd().split("\n");
    if (json) {
      assert.equal(lines.length, 1);
      const parsed = JSON.parse(r.output);
      assert.deepEqual(Object.keys(parsed), ["items", "note"]);
      assert.equal(parsed.note, D.DISCLAIMER);
      assert.equal(find(parsed.items, "notice").length, 0);
      for (const it of parsed.items) assert.deepEqual(Object.keys(it).sort(), ["id", "message", "status"]);
      assertOnlyFixedMessages(parsed.items);
      // 合成の秘密を入れた設定は fail、違う写しは warn、.env.local は ok
      assert.equal(find(parsed.items, "settings")[0].status, "fail");
      assert.equal(find(parsed.items, "env-local")[0].status, "ok");
      assert.ok(find(parsed.items, "z3-copies").some((c) => c.message === "配置済みの写しが原本と違う：judge.sh"));
    } else {
      assert.equal(lines.at(-1), D.DISCLAIMER);
    }
    assert.equal(r.code, 1);
  }
});

/** 出力の文が、固定の文か、固定の文＋許可リストのファイル名・コマンド名・フォルダ名だけであること */
function assertOnlyFixedMessages(items) {
  const fixed = new Set(Object.values(D.MSG).filter((v) => typeof v === "string"));
  fixed.add(D.DISCLAIMER);
  const variants = new Set();
  for (const f of D.COPY_ALLOWLIST) {
    for (const k of ["copyDiffers", "copyUnreadable", "originUnreadable"]) {
      variants.add(D.MSG[k](f.name));
    }
  }
  for (const it of items) {
    assert.ok(D.STATUSES.includes(it.status));
    if (fixed.has(it.message) || variants.has(it.message)) continue;
    // コマンド・フォルダの並びは、固定の名前の並びとして作られる
    const okCommand = it.message.startsWith(D.MSG.commandsMissing([]));
    const okSubdir = it.message.startsWith(D.MSG.z3SubdirMissing([]));
    assert.ok(okCommand || okSubdir, "固定でない文が出た");
    const rest = it.message.slice((okCommand ? D.MSG.commandsMissing([]) : D.MSG.z3SubdirMissing([])).length);
    const allowed = okCommand ? D.REQUIRED_COMMANDS : D.Z3_SUBDIRS.map((s) => `${s}/`);
    for (const part of rest.split(okCommand ? "、" : "・")) assert.ok(allowed.includes(part), "固定でない名前が出た");
  }
}

// ---- A2：読み取りだけ ----

function snapshot(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      const st = fs.lstatSync(p);
      const rec = [path.relative(dir, p), st.mode, st.size, st.mtimeMs];
      if (st.isFile() && !name.endsWith(".env.local") && name !== ".env.local") rec.push(fs.readFileSync(p).toString("base64"));
      out.push(rec);
      if (st.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out;
}

test("A2 診断の前後で、合成の --repo・--z3 のファイルが変わらない（書かない・消さない・動かさない）", () => {
  const repo = makeRepo();
  const z3 = makeZ3(repo);
  writeFile(path.join(z3, "bin", "judge.sh"), "# 違う写し\n");
  const before1 = snapshot(repo);
  const before2 = snapshot(z3);
  D.runDoctor(ctxFor({ repo, z3 }));
  D.runDoctor(ctxFor({ repo, z3, json: true }));
  assert.deepEqual(snapshot(repo), before1);
  assert.deepEqual(snapshot(z3), before2);
});
