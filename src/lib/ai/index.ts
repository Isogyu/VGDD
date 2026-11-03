// provider の選択と、テスト用の差し替え口
import type { SummaryProvider } from "./provider";
import { resolveProviderName } from "./provider";
import { ClaudeProvider } from "./claude";
import { DemoProvider } from "./demo";

let override: SummaryProvider | null = null;

/** テストから差し替える（mock）。null で解除 */
export function setProviderOverride(p: SummaryProvider | null): void {
  override = p;
}

export function getProvider(): SummaryProvider {
  if (override) return override;
  return resolveProviderName() === "claude" ? new ClaudeProvider() : new DemoProvider();
}

export { resolveProviderName, hasApiKey, ProviderUnavailableError } from "./provider";
export type { SummaryProvider, SummarizeInput, SummarizeOutput } from "./provider";
