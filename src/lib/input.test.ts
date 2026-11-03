import { describe, expect, it } from "vitest";
import { removeSubmittedPrefix } from "./input";

describe("removeSubmittedPrefix（送信完了時に送った文字だけを消す）", () => {
  it("送信後に何も打っていなければ空になる", () => {
    expect(removeSubmittedPrefix("エラーが出た", "エラーが出た")).toBe("");
  });

  it("送信後に打った文字は残る（先頭の空白は落とす）", () => {
    expect(removeSubmittedPrefix("エラーが出た原因は環境変数", "エラーが出た")).toBe("原因は環境変数");
    expect(removeSubmittedPrefix("エラーが出た 次のメモ", "エラーが出た")).toBe("次のメモ");
  });

  it("送信後に本人が先頭を書き換えていたら、何も消さない", () => {
    expect(removeSubmittedPrefix("エラーが消えた", "エラーが出た")).toBe("エラーが消えた");
    expect(removeSubmittedPrefix("", "エラーが出た")).toBe("");
  });

  it("送信した文字が空なら現状のまま", () => {
    expect(removeSubmittedPrefix("途中", "")).toBe("途中");
  });
});
