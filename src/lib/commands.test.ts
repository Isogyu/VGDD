import { describe, expect, it } from "vitest";
import { parseCommand, normalizeTaskName } from "./commands";

describe("parseCommand（M1-2：決定論的な照合）", () => {
  it.each([
    ["社内向け集計スクリプトの改修の作業開始", "社内向け集計スクリプトの改修"],
    ["月次レポート改修の作業を開始", "月次レポート改修"],
    ["開発環境の構築 開始", "開発環境の構築"],
    ["API 開発、作業開始。", "API 開発"],
    ["作業開始：開発環境の構築", "開発環境の構築"],
    ["開始 テスト", "テスト"],
    ["　開発環境の構築　の作業開始　", "開発環境の構築"],
    ["経費精算の作業スタート！", "経費精算"],
  ])("「%s」→ start(%s)", (input, taskName) => {
    expect(parseCommand(input)).toEqual({ type: "start", taskName });
  });

  it.each(["作業終了", "終了", "開発環境の構築の作業終了", "作業を終わります", "おわり。", "作業完了"])(
    "「%s」→ end",
    (input) => {
      expect(parseCommand(input)).toEqual({ type: "end" });
    },
  );

  it.each([
    "環境変数が見つからないエラーが出た",
    "先輩に聞いたら S3 のパスは共有ドライブにあると分かった",
    "開始時刻を間違えたかも",
    "終了条件がよく分からない",
    "開始",
  ])("「%s」→ memo（または empty）", (input) => {
    const c = parseCommand(input);
    expect(["memo", "empty"]).toContain(c.type);
    if (c.type === "memo") expect(c.body).toBe(input.replace(/[。]+$/u, ""));
  });

  it("作業名のない開始は empty（画面側で作業名を求める）", () => {
    expect(parseCommand("作業開始")).toEqual({ type: "empty" });
    expect(parseCommand("")).toEqual({ type: "empty" });
    expect(parseCommand("   ")).toEqual({ type: "empty" });
  });

  it("同じ入力は常に同じ結果（100回）", () => {
    const first = parseCommand("月次レポート改修の作業開始");
    for (let i = 0; i < 100; i++) expect(parseCommand("月次レポート改修の作業開始")).toEqual(first);
  });

  it("normalizeTaskName は空白の違いを吸収する（M1-4 の完全一致用）", () => {
    expect(normalizeTaskName("開発環境の構築")).toBe(normalizeTaskName("　開発環境の構築 "));
    expect(normalizeTaskName("API  開発")).toBe("API 開発");
  });
});
