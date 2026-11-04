#!/usr/bin/env node
// VGDD — 朝刊（morning-report）。一晩の記録を「集計（決定論的） → ローカル LLM の下書き → Claude の文章」の3段で書く。
// 設計：docs/harness.md §7。**案・未試験**。ローカル LLM と Claude は書記で、合否・採否・統合は決めない（D-52）。
//
// 置き場所：原本は vgdd/scripts/morning-report.mjs。実行用は ~/tsubuyaki-z3/bin/（オーナーがコピー）。
// 使い方（sandbox の外。06:30 の launchd か手動）:
//   node ~/tsubuyaki-z3/bin/morning-report.mjs [--date YYYY-MM-DD] [--no-local-llm] [--no-claude] [--out ~/tsubuyaki-z3/night/reports]
// 入力（すべて Z3 とリポジトリの main）：night/summary-<date>.json、evidence/gate_events.jsonl、evidence/verdicts/*.json、
//   evidence/tool_calls.jsonl（verify-chain.mjs --summary-json の集計）、night/logs/<date>/*.json、docs/tasks/_board.json
// 出力：night/reports/<date>.md（原本）と night/reports/<date>.json（集計）。リポジトリには書かない（写すのは人）。

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const Z3 = process.env.VGDD_Z3_DIR || path.join(os.homedir(), "tsubuyaki-z3");
const REPO = opt("--repo", path.join(os.homedir(), "tsubuyaki-worklog", "app"));
const DATE = opt("--date", new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10));
const OUT = opt("--out", path.join(Z3, "night", "reports"));
const USE_LOCAL = !args.includes("--no-local-llm");
const USE_CLAUDE = !args.includes("--no-claude");
const OLLAMA = process.env.VGDD_OLLAMA_URL || "http://127.0.0.1:11434";
fs.mkdirSync(OUT, { recursive: true });

const readJson = (p, d = null) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const readJsonl = (p) => fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];

// ---- 1. 集計（決定論的） ---------------------------------------------------------------------------------------
const summary = readJson(path.join(Z3, "night", `summary-${DATE}.json`), {});
const since = `${DATE}T20:00`;                                   // 前の晩 20:00 以降を「今夜」とみなす
const events = readJsonl(path.join(Z3, "evidence", "gate_events.jsonl")).filter((e) => (e.ts || "") >= since);
const byType = {};
for (const e of events) byType[e.type] = (byType[e.type] || 0) + 1;
const merged = events.filter((e) => e.type === "merged").map((e) => ({ task: e.task, main: e.main, judge: e.judge, codex: e.codex, ts: e.ts }));
const rejected = events.filter((e) => e.type === "rejected").map((e) => ({ task: e.task, status: e.status, reason: e.reason, ts: e.ts }));
const disagreements = events.filter((e) => e.type === "disagreement").map((e) => ({ task: e.task, judge: e.judge, codex: e.codex, ts: e.ts }));
const outsideGate = events.filter((e) => e.type === "main_advanced_outside_gate");
const hints = events.filter((e) => e.type === "local_llm_hints").map((e) => ({ task: e.task, status: e.status, candidates: e.candidates }));

const verdictDir = path.join(Z3, "evidence", "verdicts");
const verdicts = fs.existsSync(verdictDir)
  ? fs.readdirSync(verdictDir).filter((f) => f.endsWith(".json")).map((f) => ({ f, ...readJson(path.join(verdictDir, f), {}) }))
      .filter((v) => (v.collected_at || "") >= since)
  : [];
const findings = verdicts.flatMap((v) => ((v.judge || v.codex || {}).findings || []).map((x) => ({ task: v.task_id, severity: x.severity, category: x.category, file: x.file, reason: x.reason, source: v.f.includes("codex") ? "codex" : "judge" })));

let hooks = null;
try {
  const vc = path.join(Z3, "hooks", "verify-chain.mjs");
  if (fs.existsSync(vc)) hooks = JSON.parse(execFileSync("node", [vc, "--summary-json"], { encoding: "utf8" }));
} catch { hooks = null; }
const denies = readJsonl(path.join(Z3, "evidence", "tool_calls.jsonl")).filter((r) => r.decision === "deny" && (r.ts || "") >= since)
  .map((r) => ({ ts: r.ts, agent: r.agent_type || "(main)", tool: r.tool_name, reason: String(r.reason || "").slice(0, 200) }));

const logsDir = path.join(Z3, "night", "logs", DATE);
const workerRuns = fs.existsSync(logsDir)
  ? fs.readdirSync(logsDir).filter((f) => f.endsWith(".json")).map((f) => { const j = readJson(path.join(logsDir, f), {}); return { file: f, tokens: (j.usage?.input_tokens || 0) + (j.usage?.output_tokens || 0), duration_ms: j.duration_ms || null, is_error: !!j.is_error }; })
  : [];
const board = readJson(path.join(REPO, "docs", "tasks", "_board.json"), { tickets: [] });

const agg = {
  schema: "vgdd.morning-report.v1", date: DATE, generated_at: new Date().toISOString(),
  night: summary, events_by_type: byType, merged, rejected, disagreements, outside_gate: outsideGate.length, local_llm_hints: hints,
  verdict_files: verdicts.length, findings, hooks_summary: hooks, denies, worker_runs: workerRuns,
  board_totals: board.totals || null, board_tickets: (board.tickets || []).map((t) => ({ id: t.id, status: t.status, returns: t.returns })),
};
fs.writeFileSync(path.join(OUT, `${DATE}.json`), JSON.stringify(agg, null, 2) + "\n");

// ---- 2. ローカル LLM の下書き（分類と言い換え。参考情報。D-54 の注意：否定を落とす・同じ所で間違う） ------------------
async function ollama(model, system, user, json = false) {
  const body = { model, stream: false, options: { temperature: 0, num_predict: 400 }, keep_alive: "5m", messages: [{ role: "system", content: system }, { role: "user", content: user }] };
  if (json) body.format = "json";
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 60_000);
  try {
    const r = await fetch(`${OLLAMA}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) return null;
    const j = await r.json(); return j.message?.content ?? null;
  } catch { return null; } finally { clearTimeout(t); }
}
const DENY_SYSTEM = `あなたは、開発を統制するフック（Policy Engine）が記録した「拒否の理由」を5つに分ける係です。判断はしません。
ラベル：legit（守るべき操作を正しく止めた）／false_positive（守る必要のない操作を止めた。読み取りだけ、別のパス、文字列の誤検知）／
agent_deviation（作業員が票の範囲外や禁止の操作をした）／law_bug（法律のスクリプトの不具合の疑い）／unknown。
出力はラベルの英語1語だけ。/no_think`;
const PARA_SYSTEM = `あなたは差し戻しの理由を、新人にも分かる日本語1文（60字以内）に言い換える係です。事実を足さない・減らさない。否定（「〜ではない」「〜していない」）は必ず残す。出力は1文だけ。`;
const local = { available: false, model_classify: "qwen3:4b-instruct", model_paraphrase: "lfm3", deny_labels: [], rejection_paraphrases: [] };
if (USE_LOCAL) {
  try { const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(3000) }); local.available = r.ok; } catch { local.available = false; }
}
if (local.available) {
  for (const d of denies.slice(0, 40)) {
    const lab = (await ollama(local.model_classify, DENY_SYSTEM, d.reason)) || "unknown";
    local.deny_labels.push({ ts: d.ts, agent: d.agent, label: lab.trim().split(/\s+/)[0].toLowerCase(), reason: d.reason });
  }
  for (const r of rejected) {
    const p = await ollama(local.model_paraphrase, PARA_SYSTEM, r.reason || "");
    local.rejection_paraphrases.push({ task: r.task, original: r.reason, paraphrase: p ? p.trim() : null });
  }
}
const denyCounts = {};
for (const d of local.deny_labels) denyCounts[d.label] = (denyCounts[d.label] || 0) + 1;

// ---- 3. Claude の文章（claude -p。ツールなし。入力は集計と下書きだけ） ------------------------------------------------
const REPORT_SYSTEM = `あなたは VGDD 開発体制の「朝刊」の書記です。入力の集計 JSON とローカル LLM の下書きだけを使い、次の見出しで日本語の Markdown を書きます：
## 一晩の結果 / ## 統合された票 / ## 差し戻し・blocked と理由 / ## 法律・フックの気づき / ## 朝に確認してほしいこと
規則：入力にない事実を書かない。票 ID・コミット・時刻は入力のまま引く。ローカル LLM の言い換えや分類を使うときは「（ローカル LLM <モデル名>）」と付け、参考情報だと書く。
「〜ではない」「〜していない」などの否定を落とさない。合否・採否・統合の判断を書かない（それはオーナーと gate-runner のもの）。数字は集計 JSON と一致させる。各見出しは箇条書き3〜8行。`;
let narrative = null;
if (USE_CLAUDE) {
  const input = `# 集計 JSON\n${JSON.stringify({ ...agg, denies: denies.slice(0, 40), findings: findings.slice(0, 40) })}\n\n# ローカル LLM の下書き（参考。モデル：分類 ${local.model_classify}、言い換え ${local.model_paraphrase}。available=${local.available}）\n${JSON.stringify({ deny_counts: denyCounts, rejection_paraphrases: local.rejection_paraphrases })}\n\n上の入力だけで朝刊を書いてください。`;
  const r = spawnSync("claude", ["-p", "--output-format", "json", "--max-turns", "1", "--system-prompt", REPORT_SYSTEM], { input, encoding: "utf8", timeout: 180_000 });
  try { const o = JSON.parse(r.stdout || "{}"); narrative = typeof o.result === "string" ? o.result : null; } catch { narrative = null; }
}

// ---- 4. 朝刊の組み立て（Claude がなくても集計だけで読める形にする） ------------------------------------------------------
const lines = [];
lines.push(`# 夜間ハーネスの朝刊 ${DATE}`, "", `- 生成：${agg.generated_at}（集計は決定論的。文章は Claude、言い換え・分類はローカル LLM。どれも判断はしない）`, `- 止まった理由：${summary.stop_reason ?? "（summary なし）"}`, "");
lines.push("## 数字（集計 JSON から）", "", `| 項目 | 件数 |`, `|---|---|`,
  `| 着手した票 | ${summary.started ?? "-"} |`, `| 統合 | ${merged.length} |`, `| 差し戻し | ${rejected.filter((r) => r.status !== "blocked").length} |`,
  `| blocked | ${rejected.filter((r) => r.status === "blocked").length} |`, `| judge と Codex の不一致 | ${disagreements.length} |`,
  `| 司法の判定ファイル | ${verdicts.length} |`, `| フックの拒否（今夜） | ${denies.length} |`, `| gate の外で main が進んだ | ${outsideGate.length} |`,
  `| 作業員のトークン合計 | ${summary.tokens_total ?? workerRuns.reduce((a, w) => a + w.tokens, 0)} |`, "");
if (merged.length) { lines.push("## 統合された票（集計）", ""); for (const m of merged) lines.push(`- ${m.task}：main=${m.main} judge=${m.judge} codex=${m.codex}（${m.ts}）`); lines.push(""); }
if (rejected.length) { lines.push("## 差し戻し・blocked（集計。理由は gate-runner の記録のまま）", ""); for (const r of rejected) lines.push(`- ${r.task}（${r.status}）：${r.reason}`); lines.push(""); }
if (local.deny_labels.length) { lines.push(`## 拒否の分類（ローカル LLM ${local.model_classify}。参考）`, "", ...Object.entries(denyCounts).map(([k, v]) => `- ${k}: ${v}`), ""); }
lines.push("## Claude の文章", "", narrative ?? "（Claude を呼んでいない、または出力を解釈できなかった。上の集計を読んでください）", "");
lines.push("---", "", "この朝刊は書記（LLM）の出力を含む。数字は同名の .json と照合できる。合否・採否はオーナーと gate-runner が決める。");
fs.writeFileSync(path.join(OUT, `${DATE}.md`), lines.join("\n") + "\n");
console.log(`朝刊: ${path.join(OUT, `${DATE}.md`)}（集計 ${path.join(OUT, `${DATE}.json`)}）`);
