// 共有候補への AI の追加の検出（M6-2）の provider。既存の SummaryProvider とは別に持つ（T-017）。
//   claude：Claude API。ANTHROPIC_API_KEY があるとき
//   demo  ：保存済みの出力（fixture：src/lib/demo-fixtures/sensitive-<本文の SHA-256 の先頭16文字>.json）を返す
//   mock  ：試験用。checkSensitiveWithAi の opts.provider か setSensitiveProviderOverride で渡す
// 渡すのは本文と、決定論的な検出の範囲・種類だけ。メモ・作業名・利用者は渡さない。
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { CLAUDE_MODEL } from "./claude";
import { FIXTURE_DIR } from "./demo";
import { ProviderUnavailableError, resolveProviderName } from "./provider";

export type SensitiveInput = {
  text: string;
  /** 決定論的な検出ですでに見つかった範囲（範囲と種類だけ） */
  known: { start: number; end: number; type: string }[];
  /** やり直し時：前回の出力の問題（値そのものは含まない） */
  previousErrors?: string[];
};

export type SensitiveOutput = {
  /** provider の生の出力。検証は呼び出し側（validateAiFlags）で行う */
  raw: string;
  model: string;
};

export type SensitiveProvider = {
  readonly name: "claude" | "demo" | "mock";
  check(input: SensitiveInput): Promise<SensitiveOutput>;
};

export const SENSITIVE_SYSTEM_PROMPT = `あなたは、チームに共有する前の文章から、外に出すと困る情報の候補を挙げる補助役です。次のことを守ってください。
- JSON だけを返す。前後に説明文やコードフェンスを付けない。
- match には、本文にそのまま現れる文字列だけを入れる。言い換えたり、まとめたり、補ったりしない。
- 決定論的な検出ですでに見つかった箇所（known に示す範囲）は挙げない。
- 種類（kind）は次の4つだけを使う：customer（登録されていない顧客名・会社名）、amount（金額）、plan（未公開の計画・予定）、other（そのほか外に出すと困る情報）。
- 候補がなければ candidates を空の配列にする。`;

/** AI の追加の検出のためのユーザー向けプロンプト。入れるのは本文・known の範囲と種類・前回の問題だけ */
export function buildSensitivePrompt(input: SensitiveInput): string {
  const lines: string[] = [];
  lines.push("本文：");
  lines.push("<<<");
  lines.push(input.text);
  lines.push(">>>");
  lines.push("");
  lines.push("決定論的な検出ですでに見つかった範囲（文字の位置。開始は含み、終わりは含まない。挙げないこと）：");
  if (input.known.length === 0) {
    lines.push("（なし）");
  } else {
    for (const k of input.known) lines.push(`- ${k.start}〜${k.end}（${k.type}）`);
  }
  lines.push("");
  lines.push("出力の形（JSON だけ）：");
  lines.push(
    '{"candidates":[{"match":"本文にそのまま現れる文字列（1〜100字）","kind":"customer|amount|plan|other","reason":"外に出すと困る理由（1〜200字）"}]}',
  );
  lines.push("candidates は0〜20件。");
  if (input.previousErrors && input.previousErrors.length > 0) {
    lines.push("");
    lines.push("前回の出力の問題（直して出し直すこと）：");
    for (const e of input.previousErrors) lines.push(`- ${e}`);
  }
  return lines.join("\n");
}

/** 本文から fixture のパスを作る：sensitive-<本文の SHA-256 の16進の先頭16文字>.json */
export function sensitiveFixturePath(text: string, dir: string = FIXTURE_DIR): string {
  const key = createHash("sha256").update(text).digest("hex").slice(0, 16);
  return path.join(dir, `sensitive-${key}.json`);
}

const DEMO_MISSING_MESSAGE = "デモモードでは、この本文の AI の検出の保存済みの結果がありません";

export class ClaudeSensitiveProvider implements SensitiveProvider {
  readonly name = "claude" as const;
  private client: Anthropic;

  constructor(apiKey: string | undefined = process.env.ANTHROPIC_API_KEY) {
    if (!apiKey) throw new ProviderUnavailableError("ANTHROPIC_API_KEY が設定されていません");
    this.client = new Anthropic({ apiKey, timeout: 30000, maxRetries: 1 });
  }

  async check(input: SensitiveInput): Promise<SensitiveOutput> {
    const res = await this.client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      system: SENSITIVE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildSensitivePrompt(input) }],
    });
    const text = res.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    return { raw: text, model: res.model };
  }
}

export class DemoSensitiveProvider implements SensitiveProvider {
  readonly name = "demo" as const;
  constructor(private dir: string = FIXTURE_DIR) {}

  async check(input: SensitiveInput): Promise<SensitiveOutput> {
    const p = sensitiveFixturePath(input.text, this.dir);
    let fx: unknown;
    try {
      fx = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      // ファイルがない・読めない・JSON でない
      throw new ProviderUnavailableError(DEMO_MISSING_MESSAGE);
    }
    const o = fx as { model?: unknown; raw?: unknown } | null;
    if (!o || typeof o !== "object" || typeof o.model !== "string" || typeof o.raw !== "string") {
      throw new ProviderUnavailableError(DEMO_MISSING_MESSAGE);
    }
    return { raw: o.raw, model: `demo(${o.model})` };
  }
}

let override: SensitiveProvider | null = null;

/** 試験から差し替える（mock）。null で解除 */
export function setSensitiveProviderOverride(p: SensitiveProvider | null): void {
  override = p;
}

export function getSensitiveProvider(): SensitiveProvider {
  if (override) return override;
  return resolveProviderName() === "claude" ? new ClaudeSensitiveProvider() : new DemoSensitiveProvider();
}
