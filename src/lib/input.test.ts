import { describe, expect, it } from "vitest";
import { removeSubmittedPrefix, restoreSubmitted } from "./input";

describe("送信直後に入力欄を空にする方針（連続入力の結合を防ぐ）", () => {
  // 画面の onSubmit の動きを純粋関数で再現する：
  //   submit(text) → 入力欄は即 ""。保存中に打った文字は入力欄にそのまま残る。2件目の submit は2件目の文字だけになる
  function simulate(events: ({ type: "type"; text: string } | { type: "submit" })[]) {
    let input = "";
    const submitted: string[] = [];
    for (const e of events) {
      if (e.type === "type") input += e.text;
      else {
        submitted.push(input);
        input = ""; // 送信した瞬間に消す
      }
    }
    return { input, submitted };
  }

  it("1件目の保存が終わる前に2件目を打って送信しても、2件は結合しない", () => {
    const r = simulate([
      { type: "type", text: "依頼者の内線は 03-1234-5678" },
      { type: "submit" },
      { type: "type", text: "次のメモ" }, // 1件目の保存がまだ終わっていない間に入力
      { type: "submit" },
    ]);
    expect(r.submitted).toEqual(["依頼者の内線は 03-1234-5678", "次のメモ"]);
    expect(r.input).toBe("");
  });

  it("失敗したら、送信した文字を、その後に打った文字の前に戻す", () => {
    expect(restoreSubmitted("", "エラーが出た")).toBe("エラーが出た");
    expect(restoreSubmitted("次のメモ", "エラーが出た")).toBe("エラーが出た 次のメモ");
    expect(restoreSubmitted("途中", "")).toBe("途中");
  });
});

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
