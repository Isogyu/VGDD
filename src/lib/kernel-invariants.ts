// 前提：docs/governance/ は法律で保護パス（行政は書けない）なので、ディレクトリの敵対的な同時の差し替えは扱わない。
// 不変条件と承認待ちの写し（<root>/docs/governance/kernel-invariants.json）を読む。T-024。
// 読むのはこの1か所だけ。パスの組み立てに外からの入力は使わない。どの段階の失敗も null（例外の本文は使わない）。

import fs from "node:fs";
import path from "node:path";
import { pickKernelInvariants, type KernelInvariants } from "@/lib/kernel-invariants-schema";

const O_NOFOLLOW = fs.constants.O_NOFOLLOW ?? 0;
// FIFO に差し替えられても open で待ち続けない
const O_NONBLOCK = fs.constants.O_NONBLOCK ?? 0;

/** 読む大きさの上限（バイト）。ちょうどこの大きさは読む */
const MAX_BYTES = 1_048_576;

/** シンボリックリンクでない、実在のディレクトリか */
function isRealDir(p: string): boolean {
  const st = fs.lstatSync(p);
  return !st.isSymbolicLink() && st.isDirectory();
}

/** 不変条件と承認待ちの写しを読んで検証する。なければ・読めなければ・形が合わなければ null */
export function loadKernelInvariants(root: string = process.cwd()): KernelInvariants | null {
  try {
    // パスは root と固定の名前だけで組み立てる
    const docsDir = path.join(root, "docs");
    const governanceDir = path.join(docsDir, "governance");
    // (1) docs と docs/governance がリンクでない実在のディレクトリか
    if (!isRealDir(docsDir) || !isRealDir(governanceDir)) return null;

    // (2) リンクか通常ファイルでなければ読まない（FIFO やデバイスを読まない）
    const file = path.join(governanceDir, "kernel-invariants.json");
    const st = fs.lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile()) return null;

    // (3) lstat と open の間にリンクへ差し替えられても、O_NOFOLLOW で最後の要素のリンクはたどらない
    const fd = fs.openSync(file, fs.constants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
    let text: string;
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
      text = buf.toString("utf8", 0, total);
    } finally {
      fs.closeSync(fd);
    }

    // (6) JSON として読み、形を検証する
    return pickKernelInvariants(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}
