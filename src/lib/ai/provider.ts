// AI 呼び出しの差し替え口。アプリは SummaryProvider だけを知り、Claude / demo / mock を環境で切り替える。
//   claude：Claude API（Sonnet 5.5）。ANTHROPIC_API_KEY があるとき
//   demo  ：保存済みの出力（fixture）を返す。キーがないとき（M4-4）
//   mock  ：テスト用。vitest から注入する
// 選び方：TSUBUYAKI_AI_PROVIDER（claude|demo）が優先。未指定ならキーの有無で決める。

import type { Note } from "../sessions";

export interface SummarizeInput {
  taskName: string;
  /** 整理の対象メモ（除外済み）。番号は配列の順（#1〜#n） */
  notes: Pick<Note, "id" | "body" | "kind" | "created_at">[];
  /** 進行中の途中整理（M10）なら true。終了後の整理なら false */
  partial: boolean;
  /** やり直し時：前回の違反内容（プロンプトに添える） */
  previousErrors?: string[];
}

export interface SummarizeOutput {
  /** provider の生の出力（JSON 文字列）。検証は呼び出し側で行う */
  raw: string;
  model: string;
  /** 入出力トークン（分かる場合） */
  usage?: { input_tokens: number; output_tokens: number };
}

export interface SummaryProvider {
  readonly name: "claude" | "demo" | "mock";
  summarize(input: SummarizeInput): Promise<SummarizeOutput>;
}

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

export function hasApiKey(): boolean {
  return !!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim().length > 0;
}

export type ProviderName = "claude" | "demo";

export function resolveProviderName(): ProviderName {
  const forced = process.env.TSUBUYAKI_AI_PROVIDER;
  if (forced === "claude" || forced === "demo") return forced;
  return hasApiKey() ? "claude" : "demo";
}
