// 機密の検出箇所ごとの抽象化の案（M6-3 の裏側）。純粋関数だけ。
// 検出（detectSensitive）の結果を受け取り、箇所ごとに置き換え文の案を作る。
// 置き換えは本人が選んだ案だけに行う（自動では置き換えない）。引数は書き換えない。

import type { Flag, FlagType } from "@/lib/sensitive";

export type AbstractionProposal = {
  id: string;
  type: FlagType;
  start: number;
  end: number;
  original: string;
  replacement: string;
};

/** 種類ごとの固定の置き換え文（顧客・プロジェクトは別に採番する） */
const FIXED_REPLACEMENTS: Record<Exclude<FlagType, "registered_term">, string> = {
  email: "（メールアドレス）",
  phone: "（電話番号）",
  card: "（カード番号）",
  api_key: "（API キー）",
};

const UNCATEGORIZED_TERM = "（登録語句）";

/** 0 始まりの番号を A〜Z に。27個目（index 26）以降は数字（27, 28, …）にする */
function labelFor(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

/** 範囲 [a.start, a.end) と [b.start, b.end) が重なるか */
function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

/** 範囲が整数で、0 <= start < end <= length か */
function validRange(start: number, end: number, length: number): boolean {
  return Number.isInteger(start) && Number.isInteger(end) && 0 <= start && start < end && end <= length;
}

/** 検出箇所ごとに抽象化の案を作る。返り値は start の昇順 */
export function proposeAbstractions(text: string, flags: Flag[]): AbstractionProposal[] {
  // 不正な flag（整数でない・範囲の外・空や逆向き・本文と食い違う）は、並べ替えの前に捨てる。
  // NaN などが残ると比較が常に false になり、並べ替えの順（と採番）が崩れるため。
  // その後、start の昇順、同じ start は長い順、それも同じなら入力の順（索引で安定させる）
  const ordered = flags
    .map((flag, index) => ({ flag, index }))
    .filter(({ flag }) => validRange(flag.start, flag.end, text.length) && text.slice(flag.start, flag.end) === flag.match)
    .sort((x, y) => {
      if (x.flag.start !== y.flag.start) return x.flag.start - y.flag.start;
      const lx = x.flag.end - x.flag.start;
      const ly = y.flag.end - y.flag.start;
      if (lx !== ly) return ly - lx;
      return x.index - y.index;
    });

  const customers = new Map<string, string>();
  const projects = new Map<string, string>();
  const out: AbstractionProposal[] = [];

  for (const { flag } of ordered) {
    const { start, end } = flag;
    // すでに採った案と重なる flag は捨てる
    if (out.some((p) => overlaps(p, flag))) continue;

    let replacement: string;
    if (flag.type === "registered_term") {
      if (flag.category === "customer") {
        let r = customers.get(flag.match);
        if (r === undefined) {
          r = `顧客${labelFor(customers.size)}社`;
          customers.set(flag.match, r);
        }
        replacement = r;
      } else if (flag.category === "project") {
        let r = projects.get(flag.match);
        if (r === undefined) {
          r = `プロジェクト${labelFor(projects.size)}`;
          projects.set(flag.match, r);
        }
        replacement = r;
      } else {
        replacement = UNCATEGORIZED_TERM;
      }
    } else {
      replacement = FIXED_REPLACEMENTS[flag.type];
    }

    out.push({
      id: `p${out.length + 1}`,
      type: flag.type,
      start,
      end,
      original: flag.match,
      replacement,
    });
  }

  // start の昇順で採っているので、そのまま昇順になっている
  return out;
}

/** 選ばれた案だけを置き換えた文を返す。通らない案は置き換えない（例外は投げない） */
export function applyAbstractions(text: string, proposals: AbstractionProposal[], acceptedIds: string[]): string {
  if (acceptedIds.length === 0) return text;
  const accepted = new Set(acceptedIds);

  // 同じ id が2つ以上ある案は、どれも置き換えない
  const idCount = new Map<string, number>();
  for (const p of proposals) idCount.set(p.id, (idCount.get(p.id) ?? 0) + 1);

  const candidates = proposals
    .map((p, index) => ({ p, index }))
    .filter(
      ({ p }) =>
        accepted.has(p.id) &&
        idCount.get(p.id) === 1 &&
        validRange(p.start, p.end, text.length) &&
        text.slice(p.start, p.end) === p.original,
    )
    .sort((x, y) => (x.p.start !== y.p.start ? x.p.start - y.p.start : x.index - y.index));

  // すでに置き換えると決めた案と重なる案を捨てる
  const chosen: AbstractionProposal[] = [];
  for (const { p } of candidates) {
    if (chosen.some((c) => overlaps(c, p))) continue;
    chosen.push(p);
  }

  // 後ろの案から置き換え、前の置き換えで位置がずれないようにする
  let result = text;
  for (let i = chosen.length - 1; i >= 0; i--) {
    const p = chosen[i];
    result = result.slice(0, p.start) + p.replacement + result.slice(p.end);
  }
  return result;
}

/** 元の文と置き換え後の文を並べて見せる用 */
export function previewAbstraction(
  text: string,
  proposals: AbstractionProposal[],
  acceptedIds: string[],
): { before: string; after: string } {
  return { before: text, after: applyAbstractions(text, proposals, acceptedIds) };
}
