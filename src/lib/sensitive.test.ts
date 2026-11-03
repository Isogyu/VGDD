import { describe, expect, it } from "vitest";
import { detectSensitive, describeFlags } from "./sensitive";

// 罠の入力5件（docs/requirements.md §3。すべて架空の値）
// API キーの形式の試験値は、GitHub の秘密情報の検出（push protection）に反応しないよう実行時に組み立てる（司法の指摘 T-M1M3）
const FAKE_API_KEY = "sk-ant-" + "api03-" + "x".repeat(40);
const TRAPS: [string, string][] = [
  ["email", "先輩の連絡先は taro.sample@example.co.jp だった"],
  ["phone", "依頼者の内線は 03-1234-5678 と言われた"],
  ["card", "テスト用のカード番号 4242 4242 4242 4242 を使った"],
  ["api_key", `環境変数に ${FAKE_API_KEY} を入れた`],
  ["registered_term", "ホクト製菓の案件で見積りが 350 万円になった"],
];

describe("detectSensitive（M6-1：決定論的な検出）", () => {
  it.each(TRAPS)("罠 %s：警告が出る", (type, text) => {
    const flags = detectSensitive(text);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags.map((f) => f.type)).toContain(type);
  });

  it("通常のメモでは警告が出ない（誤検出の確認）", () => {
    for (const text of [
      "環境変数の設定漏れで起動しなかった",
      "先輩に聞いたら共有ドライブの tools フォルダにあった",
      "2026-11-03 13:50 に作業を再開した",
      "テストは 36 件、所要 240 分。バージョンは 16.4.4",
      "注文番号 12345678 の件を確認する",
    ]) {
      expect(detectSensitive(text)).toEqual([]);
    }
  });

  it("Luhn 検査に通らない数字列はカード番号として扱わない", () => {
    expect(detectSensitive("番号 1234 5678 9012 3456 を控えた").filter((f) => f.type === "card")).toEqual([]);
  });

  it("登録語句は区分（customer / project）と位置を返す。同じ語が2回あれば2件", () => {
    const flags = detectSensitive("さくらポータル刷新の件。さくらポータル刷新は来月");
    expect(flags).toHaveLength(2);
    expect(flags[0]).toMatchObject({ type: "registered_term", category: "project", start: 0, end: "さくらポータル刷新".length });
  });

  it("同じ入力は常に同じ結果", () => {
    const a = detectSensitive(TRAPS[0][1]);
    for (let i = 0; i < 50; i++) expect(detectSensitive(TRAPS[0][1])).toEqual(a);
  });

  it("describeFlags は種類を重複なしで並べる", () => {
    const flags = detectSensitive("taro.sample@example.co.jp と hanako.sample@example.co.jp、ホクト製菓");
    expect(describeFlags(flags)).toBe("メールアドレス、登録語句（顧客名・プロジェクト名）が含まれています");
    expect(describeFlags([])).toBe("");
  });
});
