import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GovernanceSummary } from "@/lib/governance";
import { CLAUDE_ROLES } from "@/lib/claude-roles";
import { formatJst } from "@/lib/kernel-state-schema";
import ClaudeRoles, { ClaudeRolesView } from "./ClaudeRoles";

// 合成の集計（架空の件数）
const summary: GovernanceSummary = {
  schema: "vgdd.governance-summary.v1",
  generated_at: "2026-11-07T12:00:00.000+09:00",
  period: { first: "2026-11-03T10:00:00.000+09:00", last: "2026-11-07T11:00:00.000+09:00" },
  chain_ok: true,
  records: 12345,
  sessions: 7,
  agents: 3,
  tool_calls: { allow: 4321, deny: 21 },
  deny_kinds: { protected_path: 10, git_scope: 8, other: 3 },
  by_agent: {
    "(main)": { calls: 1500, deny: 9 },
    worker: { calls: 2600, deny: 11 },
    "constitutional-review": { calls: 6, deny: 0 },
  },
};

const NOTE =
  "件数は記録の agent_type ごとです。(main) は agent_type のない記録をまとめたもので、行政の長だけの件数ではありません。役割の説明は今の定義、件数は書き出した期間の記録で、過去の件数は今の制限のもとで動いたことを示しません。司法（Claude）は judge.sh が別のプロセスで呼び、この表では件数を対応させません。— は 0 件という意味ではありません。許可は実行の成功を意味しません。拒否の分類は理由の文による分類で、権限ルールなどによる拒否のすべてではありません。Codex は第2の司法と監査で、この表の外です";

/** 表の本文の行（tbody の tr）を取り出す */
function bodyRows(markup: string): string[] {
  const tbody = markup.match(/<tbody>([\s\S]*)<\/tbody>/)?.[1] ?? "";
  return tbody.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
}

/** 1行のセル（th・td）の文字を取り出す */
function cells(row: string): string[] {
  return [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((m) => m[1]);
}

describe("ClaudeRolesView（集計あり）", () => {
  const markup = renderToStaticMarkup(<ClaudeRolesView summary={summary} />);

  it("見出しと1行の文", () => {
    expect(markup).toMatch(/<h2[^>]*>Claude Code の使い分け<\/h2>/);
    expect(markup).toContain(
      "役割ごとに Claude Code の別の機能で境界を作りました。ツール呼び出しは PreToolUse フックが判定します",
    );
  });

  it("列の見出し", () => {
    const head = markup.match(/<thead>([\s\S]*)<\/thead>/)?.[1] ?? "";
    expect(cells(head)).toEqual([
      "役割",
      "Claude Code の機能",
      "モデル",
      "道具の制限",
      "呼び出しの記録（拒否を含む）",
      "うちフックの拒否",
    ]);
  });

  it("6行の役割の文と、数字の区切りと「—」", () => {
    const rows = bodyRows(markup).map(cells);
    expect(rows).toHaveLength(6);
    rows.forEach((r, i) => {
      const role = CLAUDE_ROLES[i];
      expect(r.slice(0, 4)).toEqual([role.role, role.feature, role.model, role.limits]);
    });
    expect(rows[0].slice(4)).toEqual(["1,500", "9"]); // メインのセッション
    expect(rows[1].slice(4)).toEqual(["2,600", "11"]); // 作業員
    expect(rows[2].slice(4)).toEqual(["—", "—"]); // テスト担当（鍵がない）
    expect(rows[3].slice(4)).toEqual(["—", "—"]); // 汎用の補助（鍵がない）
    expect(rows[4].slice(4)).toEqual(["—", "—"]); // 司法（対応させない）
    expect(rows[5].slice(4)).toEqual(["6", "0"]); // 憲法審査（0 は 0 のまま）
  });

  it("フックの集計と拒否の札（件数の多い順）", () => {
    expect(markup).toContain(
      "フックの判定：許可 4,321・拒否 21（7 セッション、記録 12,345 行（結果の記録を含む）、ハッシュチェーン OK）",
    );
    const tags = [...markup.matchAll(/<li[^>]*>([^<]*)<\/li>/g)].map((m) => m[1]);
    expect(tags).toEqual(["保護パスへの操作 10", "git の範囲の外 8", "その他 3"]);
  });

  it("ハッシュチェーンが合わなければ NG", () => {
    const ng = renderToStaticMarkup(<ClaudeRolesView summary={{ ...summary, chain_ok: false }} />);
    expect(ng).toContain("ハッシュチェーン NG）");
  });

  it("注記と出どころの1行", () => {
    expect(markup).toContain(NOTE);
    expect(markup).toContain(
      `出どころ：docs/governance/summary.json（${formatJst(summary.generated_at)} に生成、最後の記録は ${formatJst(summary.period.last)}）`,
    );
  });

  it("最後の記録の時刻が null なら「—」", () => {
    const m = renderToStaticMarkup(<ClaudeRolesView summary={{ ...summary, period: { first: null, last: null } }} />);
    expect(m).toContain("最後の記録は —）");
  });

  it("表は横にスクロールできる入れ物に入れる", () => {
    expect(markup).toMatch(/<div class="[^"]*overflow-x-auto[^"]*"><table/);
  });
});

describe("ClaudeRolesView（集計なし）", () => {
  const markup = renderToStaticMarkup(<ClaudeRolesView summary={null} />);

  it("役割の表と注記を出し、件数はすべて「—」", () => {
    expect(markup).toMatch(/<h2[^>]*>Claude Code の使い分け<\/h2>/);
    const rows = bodyRows(markup).map(cells);
    expect(rows).toHaveLength(6);
    rows.forEach((r, i) => {
      expect(r[0]).toBe(CLAUDE_ROLES[i].role);
      expect(r.slice(4)).toEqual(["—", "—"]);
    });
    expect(markup).toContain(NOTE);
  });

  it("フックの集計の数字と札を出さず、出どころは名前だけ", () => {
    expect(markup).not.toContain("フックの判定");
    expect(markup).not.toContain("<li");
    expect(markup).toContain("出どころ：docs/governance/summary.json</p>");
  });
});

describe("ClaudeRoles（既定の export）の初期の表示", () => {
  // SSR では effect が動かないので、取得はしない
  const markup = renderToStaticMarkup(<ClaudeRoles />);

  it("「読み込み中…」と、件数のない役割の表", () => {
    expect(markup).toContain("読み込み中…");
    expect(markup).not.toContain("操作の集計の書き出しがありません");
    expect(markup).not.toContain("操作の集計を読めませんでした");
    const rows = bodyRows(markup).map(cells);
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(r.slice(4)).toEqual(["—", "—"]);
    expect(markup).not.toContain("フックの判定");
  });
});
