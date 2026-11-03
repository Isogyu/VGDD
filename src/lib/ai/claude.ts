// Claude API provider（Sonnet 5.5）。ANTHROPIC_API_KEY は .env.local から読む（リポジトリに入れない）。
import Anthropic from "@anthropic-ai/sdk";
import type { SummaryProvider, SummarizeInput, SummarizeOutput } from "./provider";
import { ProviderUnavailableError } from "./provider";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";

export const CLAUDE_MODEL = process.env.TSUBUYAKI_CLAUDE_MODEL || "claude-sonnet-5-5";

export class ClaudeProvider implements SummaryProvider {
  readonly name = "claude" as const;
  private client: Anthropic;

  constructor(apiKey: string | undefined = process.env.ANTHROPIC_API_KEY) {
    if (!apiKey) throw new ProviderUnavailableError("ANTHROPIC_API_KEY が設定されていません");
    this.client = new Anthropic({ apiKey });
  }

  async summarize(input: SummarizeInput): Promise<SummarizeOutput> {
    const res = await this.client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(input) }],
    });
    const text = res.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .trim();
    return {
      raw: text,
      model: res.model,
      usage: { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
    };
  }
}
