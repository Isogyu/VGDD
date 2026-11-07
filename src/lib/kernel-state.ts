// 前提：docs/governance/ は保護パスなので、ディレクトリの敵対的な同時の差し替えまでは扱わない。
// Kernel の状態の写しを読む。T-022、T-030。
//   source が "live"（既定）：<root>/docs/governance/kernel-state.json（裁判所が書き出す稼働中の写し）
//   source が "submission"：<root>/docs/governance/snapshots/submission/kernel-state.json（提出記録）
// 読むのはこの2か所だけで、片方が読めなくてももう片方に切り替えない。
// パスの組み立てに外からの入力は使わない。どの段階の失敗も null（例外の本文は使わない）。
// isRealDir と通常ファイルの読み方は src/lib/governance.ts の形を写した（governance.ts は export していないため）。
// 1,048,576 バイトの上限はこのファイルで新しく足した。

import fs from "node:fs";
import path from "node:path";
import { pickKernelState, type KernelState } from "@/lib/kernel-state-schema";

const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
// FIFO に差し替えられても open で待ち続けない
const O_NONBLOCK = fs.constants.O_NONBLOCK ?? 0;

/** 読む大きさの上限（バイト）。ちょうどこの大きさは読む */
const MAX_BYTES = 1_048_576;

/** シンボリックリンクでない、実在のディレクトリか（lstat はパスの最後の要素にしか効かないので、親も1つずつ確かめる） */
function isRealDir(p: string): boolean {
  try {
    const st = fs.lstatSync(p);
    return !st.isSymbolicLink() && st.isDirectory();
  } catch {
    return false;
  }
}

/** シンボリックリンクでない通常のファイルを、上限までだけ読む。読めない・上限を超えるなら null */
function readRegularFileBounded(p: string): string | null {
  try {
    // (2) リンクか通常ファイルでなければ読まない（FIFO やデバイスを読まない）
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    // (3) lstat と open の間にリンクへ差し替えられても、O_NOFOLLOW で最後の要素のリンクはたどらない
    const fd = fs.openSync(p, fs.constants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    try {
      // (4) 開いたものが通常ファイルで、上限以下か
      const fst = fs.fstatSync(fd);
      if (!fst.isFile()) return null;
      if (fst.size > MAX_BYTES) return null;
      // (5) fstat の後に追記されても、上限＋1 バイトまでしか読まない
      const buf = Buffer.alloc(MAX_BYTES + 1);
      let total = 0;
      while (total < buf.length) {
        const n = fs.readSync(fd, buf, total, buf.length - total, null);
        if (n === 0) break;
        total += n;
      }
      if (total > MAX_BYTES) return null;
      return buf.toString("utf8", 0, total);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** Kernel の状態の写しを読んで検証する。なければ・読めなければ・形が合わなければ null */
export function loadKernelState(
  root: string = process.cwd(),
  source: "live" | "submission" = "live",
): KernelState | null {
  try {
    // パスは root と固定の名前だけで組み立てる
    const docsDir = path.join(root, "docs");
    const governanceDir = path.join(docsDir, "governance");
    // (1) docs と docs/governance がリンクでない実在のディレクトリか
    if (!isRealDir(docsDir) || !isRealDir(governanceDir)) return null;
    let dir = governanceDir;
    if (source === "submission") {
      // 提出記録は、snapshots と submission も同じように1つずつ確かめる
      const snapshotsDir = path.join(governanceDir, "snapshots");
      dir = path.join(snapshotsDir, "submission");
      if (!isRealDir(snapshotsDir) || !isRealDir(dir)) return null;
    }
    const text = readRegularFileBounded(path.join(dir, "kernel-state.json"));
    if (text === null) return null;
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      return null;
    }
    return pickKernelState(json);
  } catch {
    return null;
  }
}
