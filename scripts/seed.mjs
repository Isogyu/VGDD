#!/usr/bin/env node
// デモ用の合成データを入れる：開発サーバー（npm run dev）が動いている状態で `npm run seed`。
// 中身は src/lib/seed.ts（架空の会社・人物・作業だけ）。何度実行しても増えない。
// 開発サーバー経由にしている理由：Node 単体では TypeScript の拡張子なしの import を解決できないため。

const base = process.env.SEED_BASE_URL || "http://localhost:3000";
try {
  const r = await fetch(`${base}/api/dev/seed`, { method: "POST" });
  const d = await r.json();
  if (!r.ok) {
    console.error(`seed に失敗しました（${r.status}）: ${d.error ?? ""}`);
    process.exit(1);
  }
  console.log(d.message, `(session_id=${d.sessionId})`);
} catch {
  console.error(`開発サーバーに接続できません（${base}）。先に npm run dev を起動してください。`);
  process.exit(1);
}
