// 機密情報の決定論的な検出（M6-1）。AI は使わない。同じ入力は常に同じ結果になる。
// 対象：メールアドレス、電話番号、カード番号らしい数字列（Luhn 検査）、API キーの形式、登録した語句（顧客名・プロジェクト名）。
// 限界（画面と README に書く）：パターンで取りこぼす情報がある。固有名詞の文脈や組み合わせで個人が特定できる情報は検出できない。
// 完全な匿名化はできない。

import registered from "./registered-terms.json";

export type FlagType = "email" | "phone" | "card" | "api_key" | "registered_term";

export interface Flag {
  type: FlagType;
  /** 一致した文字列（画面で位置を示す用。そのまま保存されるので、本文と同じ扱い） */
  match: string;
  start: number;
  end: number;
  /** 登録語句のときの区分（customer / project） */
  category?: "customer" | "project";
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 日本の電話番号らしい形：0から始まる 10〜11桁（区切りは - ・ 空白 ・ 括弧）。「+81」も拾う
const PHONE = /(?:\+81[-\s]?|0)\d{1,4}[-\s(]?\d{1,4}[-\s)]?\d{3,4}/g;
// カード番号らしい 13〜19 桁（区切りは空白か -）。Luhn で確認する
const CARD = /(?:\d[ -]?){13,19}/g;
// API キーの形式：Anthropic / OpenAI 系（sk-…）、AWS アクセスキー（AKIA…）、GitHub（ghp_ / github_pat_）、Slack（xox…）、Google（AIza…）
const API_KEY = /\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b/g;

function luhnOk(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function collect(text: string, re: RegExp, type: FlagType, accept?: (m: string) => boolean): Flag[] {
  const out: Flag[] = [];
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    if (accept && !accept(m[0])) continue;
    out.push({ type, match: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

export interface RegisteredTerms {
  customers: string[];
  projects: string[];
}

export const REGISTERED_TERMS: RegisteredTerms = {
  customers: registered.customers,
  projects: registered.projects,
};

/** 本文を検査し、該当箇所の一覧を返す（なければ空配列） */
export function detectSensitive(text: string, terms: RegisteredTerms = REGISTERED_TERMS): Flag[] {
  const flags: Flag[] = [
    ...collect(text, EMAIL, "email"),
    ...collect(text, API_KEY, "api_key"),
    ...collect(text, CARD, "card", (m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length >= 13 && digits.length <= 19 && luhnOk(digits);
    }),
  ];
  // 電話番号：カード番号として検出済みの範囲と重なるものは除く
  for (const f of collect(text, PHONE, "phone")) {
    const digits = f.match.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 11) continue;
    if (flags.some((g) => g.type === "card" && f.start < g.end && f.end > g.start)) continue;
    flags.push(f);
  }
  for (const [category, list] of [
    ["customer", terms.customers],
    ["project", terms.projects],
  ] as const) {
    for (const term of list) {
      if (!term) continue;
      let idx = text.indexOf(term);
      while (idx !== -1) {
        flags.push({ type: "registered_term", match: term, start: idx, end: idx + term.length, category });
        idx = text.indexOf(term, idx + term.length);
      }
    }
  }
  return flags.sort((a, b) => a.start - b.start);
}

export const FLAG_LABELS: Record<FlagType, string> = {
  email: "メールアドレス",
  phone: "電話番号",
  card: "カード番号らしい数字列",
  api_key: "API キーの形式",
  registered_term: "登録語句（顧客名・プロジェクト名）",
};

/** 画面用の短い説明：「メールアドレス、登録語句（顧客名）が含まれています」 */
export function describeFlags(flags: Flag[]): string {
  const kinds = Array.from(new Set(flags.map((f) => FLAG_LABELS[f.type])));
  return kinds.length ? `${kinds.join("、")}が含まれています` : "";
}
