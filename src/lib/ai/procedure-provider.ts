// 手順書の原案（M5）の provider。既存の SummaryProvider とは別に持つ（T-012）。
//   claude：Claude API。ANTHROPIC_API_KEY があるとき
//   demo  ：保存済みの原案（fixture：src/lib/demo-fixtures/procedure-<8桁>.json）を返す
//   mock  ：試験用。generateProcedure の opts.provider か setProcedureProviderOverride で渡す
// 材料は本人が承認した共有（shared_knowledge）だけ。原文のメモは受け取らない（M9-3、D-62）。
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { ProcedureSource } from "../procedure";
import { CLAUDE_MODEL } from "./claude";
import { fixtureKey, FIXTURE_DIR } from "./demo";
import { ProviderUnavailableError, resolveProviderName } from "./provider";

export interface ProcedureInput {
  taskName: string;
  /** 材料の共有。番号は n（#1〜#n） */
  sources: ProcedureSource[];
  /** やり直し時：前回の出力の問題（値そのものは含まない） */
  previousErrors?: string[];
}

export interface ProcedureOutput {
  /** provider の生の出力。検証は呼び出し側（validateProcedure）で行う */
  raw: string;
  model: string;
}

export interface ProcedureProvider {
  readonly name: "claude" | "demo" | "mock";
  generate(input: ProcedureInput): Promise<ProcedureOutput>;
}

export const PROCEDURE_SYSTEM_PROMPT = `あなたは、チームの作業の記録から新人向けの手順書の原案を作る補助役です。
材料は、本人が承認してチームに共有した記録だけです。次のことを守ってください。
- JSON だけを返す。前後に説明文やコードフェンスを付けない。
- 根拠は共有の番号（#1 なら 1）だけで evidence に示す。共有に書かれていないことを書くときは evidence を空の配列にする。
- 共有にない事実を作らない。人名・数値・手順を補って作らない。
- 記録者を評価する言葉（できる・できない・遅い・優秀など）を書かない。
- 判断のポイント（decision_points）には「なぜそうするか」を reason に書く。先輩（role が senior）の共有に理由があれば、それを優先して使う。
- 手順（steps）は実行する順に、1項目に1つの行動を書く。`;

/** 共有の承認日時を「YYYY-MM-DD HH:MM」にする（JST の ISO 8601 を想定。形が違えばそのまま） */
function formatApprovedAt(iso: string): string {
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : iso;
}

/** 手順書の原案を作るためのユーザー向けプロンプト */
export function buildProcedurePrompt(input: ProcedureInput): string {
  const lines: string[] = [];
  lines.push(`作業名：${input.taskName}`);
  lines.push("");
  lines.push("承認済みの共有（番号・記録者・新人か先輩か・承認日時・本文）：");
  for (const s of input.sources) {
    const role = s.role === "senior" ? "先輩" : "新人";
    const body = s.body.replace(/\r?\n/g, " ");
    lines.push(`#${s.n} [${s.display_name}・${role}・${formatApprovedAt(s.approved_at)}] ${body}`);
  }
  lines.push("");
  lines.push("出力の形（JSON だけ）：");
  lines.push(
    '{"steps":[{"text":"手順（1〜300字）","evidence":[共有の番号]}],"decision_points":[{"text":"判断の場面（1〜300字）","reason":"なぜそうするか（1〜300字）","evidence":[共有の番号]}]}',
  );
  lines.push("steps は1〜12件、decision_points は0〜8件、evidence は最大10個。番号は上の共有の番号だけを使う。");
  if (input.previousErrors && input.previousErrors.length > 0) {
    lines.push("");
    lines.push("前回の出力の問題（直して出し直すこと）：");
    for (const e of input.previousErrors) lines.push(`- ${e}`);
  }
  return lines.join("\n");
}

/** 材料の指紋：[knowledge_id, approved_at, body] の配列を JSON にした文字列の SHA-256（16進） */
export function sourcesFingerprint(sources: ProcedureSource[]): string {
  const material = JSON.stringify(sources.map((s) => [s.knowledge_id, s.approved_at, s.body]));
  return createHash("sha256").update(material).digest("hex");
}

/** 作業名から手順書の fixture のパスを作る（ハッシュは demo の fixtureKey と同じ計算） */
export function procedureFixturePath(taskName: string, dir: string = FIXTURE_DIR): string {
  const key = fixtureKey(taskName, false).replace(/^final-/, "procedure-");
  return path.join(dir, `${key}.json`);
}

export interface ProcedureFixture {
  task_name: string;
  model: string;
  captured_at: string;
  sources_fingerprint: string;
  raw: string;
}

const DEMO_MISSING_MESSAGE =
  "デモモードでは、この作業名の保存済みの手順書の原案がありません。ANTHROPIC_API_KEY を設定すると Claude で作れます";
const DEMO_MISMATCH_MESSAGE = "保存済みの原案は、いまの共有と一致しません";

export class ClaudeProcedureProvider implements ProcedureProvider {
  readonly name = "claude" as const;
  private client: Anthropic;

  constructor(apiKey: string | undefined = process.env.ANTHROPIC_API_KEY) {
    if (!apiKey) throw new ProviderUnavailableError("ANTHROPIC_API_KEY が設定されていません");
    this.client = new Anthropic({ apiKey });
  }

  async generate(input: ProcedureInput): Promise<ProcedureOutput> {
    const res = await this.client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system: PROCEDURE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildProcedurePrompt(input) }],
    });
    const text = res.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    return { raw: text, model: res.model };
  }
}

export class DemoProcedureProvider implements ProcedureProvider {
  readonly name = "demo" as const;
  constructor(private dir: string = FIXTURE_DIR) {}

  async generate(input: ProcedureInput): Promise<ProcedureOutput> {
    const p = procedureFixturePath(input.taskName, this.dir);
    let fx: Partial<ProcedureFixture>;
    try {
      fx = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<ProcedureFixture>;
    } catch {
      // ファイルがない・読めない・JSON でない
      throw new ProviderUnavailableError(DEMO_MISSING_MESSAGE);
    }
    if (!fx || typeof fx.sources_fingerprint !== "string" || typeof fx.raw !== "string") {
      throw new ProviderUnavailableError(DEMO_MISSING_MESSAGE);
    }
    if (fx.sources_fingerprint !== sourcesFingerprint(input.sources)) {
      // 採取の後に共有が承認・取り下げ・変更された
      throw new ProviderUnavailableError(DEMO_MISMATCH_MESSAGE);
    }
    return { raw: fx.raw, model: `demo(${fx.model ?? "unknown"})` };
  }
}

let override: ProcedureProvider | null = null;

/** 試験から差し替える（mock）。null で解除 */
export function setProcedureProviderOverride(p: ProcedureProvider | null): void {
  override = p;
}

export function getProcedureProvider(): ProcedureProvider {
  if (override) return override;
  return resolveProviderName() === "claude" ? new ClaudeProcedureProvider() : new DemoProcedureProvider();
}
