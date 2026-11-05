#!/usr/bin/env node
// デモ用 fixture（API キーがない審査員向けの保存済み AI 出力）を実 API で採取する。
// 前提：npm run dev が動いていて、app/.env.local に ANTHROPIC_API_KEY があり、npm run seed 済み。
// 使い方：npm run demo:capture            （W1〜W3 の終了後の整理）
//        npm run demo:capture -- --partial（途中整理。M10 用）
//        npm run demo:capture -- --extras （W1 の手順書の原案と、S-3 の AI の検出。T-020）
// 送るのは seed の合成データだけ。出力は src/lib/demo-fixtures/*.json に保存される（コミット対象）。
const base = process.env.SEED_BASE_URL || "http://localhost:3000";
const partial = process.argv.includes("--partial");
const extras = process.argv.includes("--extras");
if (extras) {
  try {
    const r = await fetch(`${base}/api/dev/capture-extras`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "all" }),
    });
    const d = await r.json();
    if (!r.ok) {
      console.error(`採取に失敗しました（${r.status}）: ${d.message ?? d.error ?? ""}`);
      process.exit(1);
    }
    for (const x of d.results) {
      console.log(x.ok ? `OK  ${x.kind} ${x.key} → ${x.path}（${x.model}、${x.attempts}回）` : `NG  ${x.kind} ${x.key}: ${(x.errors ?? []).join("; ")}`);
    }
    process.exit(d.ok ? 0 : 1);
  } catch {
    console.error(`開発サーバーに接続できません（${base}）。先に npm run dev を起動してください。`);
    process.exit(1);
  }
}
try {
  const r = await fetch(`${base}/api/dev/capture-fixtures`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ partial }),
  });
  const d = await r.json();
  if (!r.ok) {
    console.error(`採取に失敗しました（${r.status}）: ${d.message ?? d.error ?? ""}`);
    process.exit(1);
  }
  for (const x of d.results) {
    console.log(x.ok ? `OK  ${x.task_name}${x.partial ? "（途中）" : ""} → ${x.path}（${x.model}、${x.attempts}回）` : `NG  ${x.task_name}: ${(x.errors ?? []).join("; ")}`);
  }
  process.exit(d.ok ? 0 : 1);
} catch {
  console.error(`開発サーバーに接続できません（${base}）。先に npm run dev を起動してください。`);
  process.exit(1);
}
