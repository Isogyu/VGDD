#!/usr/bin/env node
// デモ用の合成データを入れる：開発サーバー（npm run dev）が動いている状態で `npm run seed`。
// 中身は src/lib/seed.ts（架空の会社・人物・作業だけ）。何度実行しても増えない。
// 開発サーバー経由にしている理由：Node 単体では TypeScript の拡張子なしの import を解決できないため。

// --reset：デモ用テーブルの全行（セッション・メモ・整理結果・承認済み知識）を消してから入れ直す。
//          デモの通し練習や録画の前に初期状態へ戻す用。users は残る。
const base = process.env.SEED_BASE_URL || "http://localhost:3000";
const reset = process.argv.includes("--reset");
try {
  const r = await fetch(`${base}/api/dev/seed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reset }),
  });
  const d = await r.json();
  if (!r.ok) {
    console.error(`seed に失敗しました（${r.status}）: ${d.error ?? ""}`);
    process.exit(1);
  }
  console.log(d.message, `(session_id=${d.sessionId})`);
  if (d.reset) console.log("消した行数:", JSON.stringify(d.reset));
} catch {
  console.error(`開発サーバーに接続できません（${base}）。先に npm run dev を起動してください。`);
  process.exit(1);
}
