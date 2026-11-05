import { describe, expect, it } from "vitest";
import { applyAbstractions, previewAbstraction, proposeAbstractions, type AbstractionProposal } from "./abstraction";
import { detectSensitive, type Flag } from "./sensitive";

// 試験の文はすべて架空（registered-terms.json の語、example.co.jp のメール、03-1234-5678 の電話）

/** 試験用の案を作る */
function proposal(id: string, start: number, end: number, original: string, replacement: string): AbstractionProposal {
  return { id, type: "registered_term", start, end, original, replacement };
}

describe("proposeAbstractions（M6-3：抽象化の案）", () => {
  it("① 罠の5件目に detectSensitive の結果を渡すと、案が1件で 顧客A社", () => {
    const text = "ホクト製菓の案件で見積りが 350 万円になった";
    const proposals = proposeAbstractions(text, detectSensitive(text));
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toEqual({
      id: "p1",
      type: "registered_term",
      start: 0,
      end: 5,
      original: "ホクト製菓",
      replacement: "顧客A社",
    });
  });

  it("② 顧客は初めて現れた順に 顧客A社・顧客B社、同じ語は同じ置き換え文。プロジェクトは別に採番", () => {
    const text = "ホクト製菓とみなみ運輸、またホクト製菓。さくらポータル刷新の件";
    const proposals = proposeAbstractions(text, detectSensitive(text));
    expect(proposals.map((p) => [p.original, p.replacement])).toEqual([
      ["ホクト製菓", "顧客A社"],
      ["みなみ運輸", "顧客B社"],
      ["ホクト製菓", "顧客A社"],
      ["さくらポータル刷新", "プロジェクトA"],
    ]);
    expect(proposals.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("② 区分のない登録語句は（登録語句）、27個目以降は数字", () => {
    const text = "語句";
    expect(proposeAbstractions(text, [{ type: "registered_term", match: "語句", start: 0, end: 2 }])[0].replacement).toBe(
      "（登録語句）",
    );
    // 架空の顧客 28 語を並べる（C00〜C27）
    const names = Array.from({ length: 28 }, (_, i) => `C${String(i).padStart(2, "0")}`);
    const long = names.join(" ");
    const flags: Flag[] = names.map((n, i) => ({
      type: "registered_term",
      match: n,
      start: i * 4,
      end: i * 4 + 3,
      category: "customer",
    }));
    const ps = proposeAbstractions(long, flags);
    expect(ps[0].replacement).toBe("顧客A社");
    expect(ps[25].replacement).toBe("顧客Z社");
    expect(ps[26].replacement).toBe("顧客27社");
    expect(ps[27].replacement).toBe("顧客28社");
    const pflags: Flag[] = flags.map((f) => ({ ...f, category: "project" }));
    expect(proposeAbstractions(long, pflags)[26].replacement).toBe("プロジェクト27");
  });

  it("③ メールと電話の置き換え文", () => {
    const text = "連絡先は taro.sample@example.co.jp と 03-1234-5678";
    const proposals = proposeAbstractions(text, detectSensitive(text));
    expect(proposals.map((p) => [p.type, p.original, p.replacement])).toEqual([
      ["email", "taro.sample@example.co.jp", "（メールアドレス）"],
      ["phone", "03-1234-5678", "（電話番号）"],
    ]);
  });

  it("③ カード番号と API キーの置き換え文", () => {
    const text = "abcd efgh";
    const ps = proposeAbstractions(text, [
      { type: "card", match: "abcd", start: 0, end: 4 },
      { type: "api_key", match: "efgh", start: 5, end: 9 },
    ]);
    expect(ps.map((p) => p.replacement)).toEqual(["（カード番号）", "（API キー）"]);
  });

  it("④ 重なる2つの flag は先の（同じ start なら長い）1つだけが残る", () => {
    const text = "ホクト製菓本社";
    // 同じ start：長い方が残る（入力では短い方が先）
    const sameStart = proposeAbstractions(text, [
      { type: "registered_term", match: "ホクト", start: 0, end: 3, category: "project" },
      { type: "registered_term", match: "ホクト製菓", start: 0, end: 5, category: "customer" },
    ]);
    expect(sameStart).toHaveLength(1);
    expect(sameStart[0].original).toBe("ホクト製菓");
    expect(sameStart[0].replacement).toBe("顧客A社");
    // start が違う：先の方が残る（入力の順は逆）
    const diffStart = proposeAbstractions(text, [
      { type: "registered_term", match: "製菓本社", start: 3, end: 7, category: "customer" },
      { type: "registered_term", match: "ホクト製菓", start: 0, end: 5, category: "customer" },
    ]);
    expect(diffStart.map((p) => p.original)).toEqual(["ホクト製菓"]);
  });

  it("④ match と本文が食い違う flag は捨てられる", () => {
    const text = "ホクト製菓の件";
    const ps = proposeAbstractions(text, [
      { type: "registered_term", match: "みなみ運輸", start: 0, end: 5, category: "customer" },
    ]);
    expect(ps).toEqual([]);
  });

  it("⑦ 引数の flags の配列と要素が呼び出しの後も変わらない", () => {
    const text = "さくらポータル刷新でホクト製菓に連絡（03-1234-5678）";
    const flags = detectSensitive(text).reverse();
    const snapshot = structuredClone(flags);
    const ref = [...flags];
    const textBefore = text;
    proposeAbstractions(text, flags);
    expect(flags).toEqual(snapshot);
    expect(flags.length).toBe(ref.length);
    flags.forEach((f, i) => expect(f).toBe(ref[i]));
    expect(text).toBe(textBefore);
  });

  it("⑨ 捨てた flag は採番に数えない（食い違う顧客の flag の後の顧客は 顧客A社）", () => {
    const text = "ホクト製菓とみなみ運輸";
    const ps = proposeAbstractions(text, [
      // match が本文と食い違う（捨てられる）
      { type: "registered_term", match: "みなみ運輸", start: 0, end: 5, category: "customer" },
      { type: "registered_term", match: "みなみ運輸", start: 6, end: 11, category: "customer" },
    ]);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ id: "p1", original: "みなみ運輸", replacement: "顧客A社" });
  });

  it("⑨ start か end が小数・NaN、範囲の外、start >= end の flag は捨てられる", () => {
    const text = "ホクト製菓とみなみ運輸";
    const ps = proposeAbstractions(text, [
      { type: "registered_term", match: "ホクト製菓", start: 0.5, end: 5, category: "customer" },
      { type: "registered_term", match: "ホクト製菓", start: 0, end: 5.5, category: "customer" },
      { type: "registered_term", match: "ホクト製菓", start: NaN, end: 5, category: "customer" },
      { type: "registered_term", match: "", start: 3, end: 3, category: "customer" },
      { type: "registered_term", match: "運輸", start: 9, end: 12, category: "customer" },
      { type: "registered_term", match: "みなみ運輸", start: 6, end: 11, category: "customer" },
    ]);
    expect(ps.map((p) => [p.id, p.original, p.replacement])).toEqual([["p1", "みなみ運輸", "顧客A社"]]);
  });

  it("⑨ NaN や小数の flag が間に混じっても、捨ててから並べるので start の昇順と採番が崩れない", () => {
    const text = "ホクト製菓とみなみ運輸、さくらポータル刷新";
    const ps = proposeAbstractions(text, [
      // start が 6・NaN・0 の順に並ぶ入力
      { type: "registered_term", match: "みなみ運輸", start: 6, end: 11, category: "customer" },
      { type: "registered_term", match: "ホクト製菓", start: NaN, end: 5, category: "customer" },
      { type: "registered_term", match: "ホクト製菓", start: 0, end: 5, category: "customer" },
      { type: "registered_term", match: "さくらポータル刷新", start: 12, end: 21.5, category: "project" },
      { type: "registered_term", match: "さくらポータル刷新", start: 12, end: 21, category: "project" },
    ]);
    expect(ps.map((p) => [p.id, p.start, p.original, p.replacement])).toEqual([
      ["p1", 0, "ホクト製菓", "顧客A社"],
      ["p2", 6, "みなみ運輸", "顧客B社"],
      ["p3", 12, "さくらポータル刷新", "プロジェクトA"],
    ]);
  });
});

describe("applyAbstractions・previewAbstraction（本人が選んだ案だけを置き換える）", () => {
  const text = "ホクト製菓の担当は taro.sample@example.co.jp、電話 03-1234-5678";

  it("⑤ acceptedIds が空なら元の文、1つだけ選ぶとその箇所だけが変わる", () => {
    const ps = proposeAbstractions(text, detectSensitive(text));
    expect(ps).toHaveLength(3);
    expect(applyAbstractions(text, ps, [])).toBe(text);
    const email = ps.find((p) => p.type === "email");
    expect(email).toBeDefined();
    expect(applyAbstractions(text, ps, [email!.id])).toBe("ホクト製菓の担当は （メールアドレス）、電話 03-1234-5678");
    // 存在しない id は無視する
    expect(applyAbstractions(text, ps, ["p99"])).toBe(text);
    // すべて選ぶ
    expect(applyAbstractions(text, ps, ps.map((p) => p.id))).toBe("顧客A社の担当は （メールアドレス）、電話 （電話番号）");
  });

  it("⑥ previewAbstraction の before は元の文、after は applyAbstractions の結果", () => {
    const ps = proposeAbstractions(text, detectSensitive(text));
    const ids = [ps[0].id];
    const preview = previewAbstraction(text, ps, ids);
    expect(preview.before).toBe(text);
    expect(preview.after).toBe(applyAbstractions(text, ps, ids));
    expect(preview.after).toBe("顧客A社の担当は taro.sample@example.co.jp、電話 03-1234-5678");
  });

  it("⑦ applyAbstractions は proposals と acceptedIds を書き換えない", () => {
    const ps = proposeAbstractions(text, detectSensitive(text));
    const snapshot = structuredClone(ps);
    const ids = ps.map((p) => p.id).reverse();
    const idsSnapshot = [...ids];
    applyAbstractions(text, ps, ids);
    expect(ps).toEqual(snapshot);
    expect(ids).toEqual(idsSnapshot);
  });

  it("⑧ 本文を編集した後の文に古い案を渡すと、original と一致しない案は置き換えられない", () => {
    const ps = proposeAbstractions(text, detectSensitive(text));
    const edited = "【追記】" + text; // 位置がずれる
    expect(applyAbstractions(edited, ps, ps.map((p) => p.id))).toBe(edited);
  });

  it("⑧ 範囲の外の案、同じ id が2つある案も置き換えられない", () => {
    const t = "ホクト製菓とみなみ運輸";
    const outOfRange = [proposal("p1", 6, 20, "みなみ運輸", "顧客B社")];
    expect(applyAbstractions(t, outOfRange, ["p1"])).toBe(t);
    const negative = [proposal("p1", -1, 5, "ホクト製菓", "顧客A社")];
    expect(applyAbstractions(t, negative, ["p1"])).toBe(t);
    const fractional = [proposal("p1", 0, 4.5, "ホクト製菓", "顧客A社")];
    expect(applyAbstractions(t, fractional, ["p1"])).toBe(t);
    const dup = [
      proposal("p1", 0, 5, "ホクト製菓", "顧客A社"),
      proposal("p1", 6, 11, "みなみ運輸", "顧客B社"),
      proposal("p2", 6, 11, "みなみ運輸", "顧客B社"),
    ];
    // p1 は重複しているのでどれも置き換えない。p2 は置き換える
    expect(applyAbstractions(t, dup, ["p1", "p2"])).toBe("ホクト製菓と顧客B社");
  });

  it("⑩ A＝[0,4)・B＝[3,8)・C＝[7,10) を選ぶと、A と C だけが置き換わる", () => {
    const t = "0123456789XY";
    const ps = [
      proposal("B", 3, 8, "34567", "[B]"),
      proposal("A", 0, 4, "0123", "[A]"),
      proposal("C", 7, 10, "789", "[C]"),
    ];
    expect(applyAbstractions(t, ps, ["A", "B", "C"])).toBe("[A]456[C]XY");
  });
});
