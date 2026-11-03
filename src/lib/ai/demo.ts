// demo provider：API キーがないときに、保存済みの AI 出力（fixture）を返す（M4-4）。
// fixture は src/lib/demo-fixtures/<key>.json。実 API（Sonnet 5.5）の出力を npm run demo:capture で保存したもの。
// 該当する作業名の fixture がなければ ProviderUnavailableError（画面で「デモモードでは整理できません」と出す）。
import fs from "node:fs";
import path from "node:path";
import type { SummaryProvider, SummarizeInput, SummarizeOutput } from "./provider";
import { ProviderUnavailableError } from "./provider";
import { normalizeTaskName } from "../commands";

export const FIXTURE_DIR = path.join(process.cwd(), "src", "lib", "demo-fixtures");

export interface Fixture {
  task_name: string;
  partial: boolean;
  captured_at: string;
  model: string;
  /** 整理対象だったメモの件数（番号の上限）。いまのメモ数がこれより少なければ番号を切り詰める */
  note_count: number;
  raw: string;
  /** "claude"＝実 API の出力、"handwritten"＝手書きの見本（capture で置き換える） */
  source?: "claude" | "handwritten";
  note?: string;
}

/** 作業名から fixture のファイル名を作る（日本語を避け、ハッシュ風の短い英数字にする） */
export function fixtureKey(taskName: string, partial: boolean): string {
  const name = normalizeTaskName(taskName);
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return `${partial ? "partial" : "final"}-${h.toString(16).padStart(8, "0")}`;
}

export function fixturePath(taskName: string, partial: boolean, dir: string = FIXTURE_DIR): string {
  return path.join(dir, `${fixtureKey(taskName, partial)}.json`);
}

export function loadFixture(taskName: string, partial: boolean, dir: string = FIXTURE_DIR): Fixture | null {
  const p = fixturePath(taskName, partial, dir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Fixture;
  } catch {
    return null;
  }
}

export function saveFixture(fx: Fixture, dir: string = FIXTURE_DIR): string {
  fs.mkdirSync(dir, { recursive: true });
  const p = fixturePath(fx.task_name, fx.partial, dir);
  fs.writeFileSync(p, JSON.stringify(fx, null, 2) + "\n");
  return p;
}

/**
 * fixture の raw はメモ番号で根拠を示している。いまのセッションのメモ数が少ないときは、
 * 存在しない番号を落として検証を通す（デモは「保存した AI 出力の表示」であることを画面に出す）。
 */
export function clampEvidence(raw: string, noteCount: number): string {
  try {
    const v = JSON.parse(raw) as Record<string, { evidence?: number[] } | unknown>;
    for (const [k, item] of Object.entries(v)) {
      if (k === "questions" || !item || typeof item !== "object") continue;
      const it = item as { evidence?: number[] };
      if (Array.isArray(it.evidence)) it.evidence = it.evidence.filter((n) => n >= 1 && n <= noteCount);
    }
    return JSON.stringify(v);
  } catch {
    return raw;
  }
}

export class DemoProvider implements SummaryProvider {
  readonly name = "demo" as const;
  constructor(private dir: string = FIXTURE_DIR) {}

  async summarize(input: SummarizeInput): Promise<SummarizeOutput> {
    const fx = loadFixture(input.taskName, input.partial, this.dir);
    if (!fx) {
      throw new ProviderUnavailableError(
        `デモモードでは、この作業名「${input.taskName}」の保存済みの整理結果がありません。ANTHROPIC_API_KEY を設定すると Claude で整理できます`,
      );
    }
    return { raw: clampEvidence(fx.raw, input.notes.length), model: `demo(${fx.model})` };
  }
}
