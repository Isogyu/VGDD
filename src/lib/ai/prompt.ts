// AI 整理（M4）と途中整理（M10）のプロンプト。日本語。出力は JSON だけ。
import type { SummarizeInput } from "./provider";
import { SUMMARY_KEYS, SUMMARY_LABELS } from "../summary-schema";

export const SYSTEM_PROMPT = `あなたは、新人の作業中のつぶやき（短いメモ）を整理する補助役です。
目的は、本人と次の人のために「何につまずき、何を試し、どう判断し、何が分からないままか」を事実と推測を分けて残すことです。

守ること：
- 出力は JSON だけ。前後に説明文やコードフェンスを付けない。
- 根拠はメモの番号（#1 のような番号の数字だけ）で示す。メモに書かれていないことは推測であり、その項目の evidence は空配列にする。
- メモに書かれていない事実を作らない。分からなければ「なし」と書く。
- 本人を評価する言葉（怠慢・能力不足など）は書かない。
- 「人に確認すべきこと」には、AI や本人の手元の情報では確実に答えられない事項（コードの場所、成果物の正式な条件、依頼の意図など）を書く。
- 情報が足りない項目があれば、本人への短い質問を最大2件 questions に入れる。質問は「はい／いいえ」で終わらない、具体的なもの（例：「最初に何を確認しましたか？」）。足りていなければ空配列。
- 各項目の text は 1〜3 文、日本語。`;

export function buildUserPrompt(input: SummarizeInput): string {
  const lines: string[] = [];
  lines.push(`# 作業名\n${input.taskName}`);
  lines.push(
    input.partial
      ? "# 状況\n作業はまだ進行中です。ここまでのメモで「確認できたこと」「推測」「未確認」「人に確認すべきこと」を整理します。"
      : "# 状況\n作業は終了しています。",
  );
  const kindLabel: Record<string, string> = {
    memo: "メモ",
    known: "開始時：分かっていること",
    unknown: "分からないこと",
    answer: "追加の質問への答え",
  };
  lines.push(
    "# メモ（番号・時刻・種別・本文）\n" +
      input.notes
        .map((n, i) => `#${i + 1} [${n.created_at.slice(11, 16)}] (${kindLabel[n.kind] ?? n.kind}) ${n.body}`)
        .join("\n"),
  );
  const keys = SUMMARY_KEYS.map((k) => `  "${k}": {"text": "…", "evidence": [番号…]}   // ${SUMMARY_LABELS[k]}`).join(",\n");
  lines.push(
    `# 出力の形（この JSON だけを返す）\n{\n${keys},\n  "questions": [{"text": "…", "target": "${SUMMARY_KEYS.join("|")}"}]   // 最大2件。足りていれば []\n}`,
  );
  if (input.previousErrors?.length) {
    lines.push(
      "# 前回の出力の問題（直して返す）\n" + input.previousErrors.map((e) => `- ${e}`).join("\n"),
    );
  }
  return lines.join("\n\n");
}
