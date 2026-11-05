---
id: T-013
title: 統治のライブ画面 /governance（票の盤・票1枚の運命・統治の数字。D-59③）
status: review
requirements: [A1, A2, A3, A4, A5, A6, A7]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-45, D-55, D-56, D-59]   # 記録用。司法には渡さない
proposal_from: 2026-11-05 オーナー「VGDD の基盤作りはやらないんですか」「切り替える」。docs/governance.md §7、D-56⑦（1枚の票の運命を単位に）
estimate_h: 1.0
time_limit_min: 60
security_review: true          # 新しい API ルート（リポジトリのファイルを読む）
unattended: false
branch: worktree-agent-a897ccfab702af5d3   # W5 のブランチ（5fe29b5。8d58f68 に修正を重ねて1コミット）。元は W3 の worktree-agent-ad0fec44ee0f07850（8d58f68）
worker: W3
files_allowed:
  - src/lib/governance.ts                # 新設：読み込みと解析（純粋関数＋ファイルの読み込み）
  - src/lib/governance.test.ts           # 新設
  - src/app/api/governance/route.ts      # 新設
  - src/app/governance/page.tsx          # 新設
  - src/components/GovernanceView.tsx    # 新設
files_forbidden:
  - docs/**
  - src/app/layout.tsx
  - src/app/page.tsx
  - src/components/WorkScreen.tsx
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: []
---

## 1. 目的

VGDD の統治が実際に働いたことを、アプリの中の1画面で見せる。データは**リポジトリの `docs/` の中の3種類のファイル**（アプリを動かしている作業ツリーにあるもの。どれも公開リポジトリにコミットする前提のもので、秘密を含めない）だけ：票（`docs/tasks/T-*.md`）の §6 にある裁判所・夜間の代行・release の記録の行、裁判所が書く盤（`docs/tasks/_board.json`）、オーナーが書き出してコミットする件数だけの集計（`docs/governance/summary.json`。ないこともある）。**生のログ（証拠ストア・判定の全文）は読まない・出さない。** 単位は「票1枚の運命」（起草 → 差し戻し → 両司法 → 統合）。審査：Claude の活用25（多数のエージェントを統治した証拠）、深さと実行20、デモ25。

## 2. 受け入れ条件

- A1. `src/lib/governance.ts` に純粋関数 `parseTimeline(markdown: string): TimelineEvent[]` を export する。`TimelineEvent = { ts: string; actor: "gate-runner" | "night-runner" | "release"; status: string | null; detail: string }`。票の本文のうち、見出し `## 6. 記録` の行より後ろだけを見る（その見出しがなければ空配列）。各行が正規表現 `^- (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}) (gate-runner|night-runner|release): (.*)$` に一致する行だけを、出てきた順に返す（`ts`・`actor`・`detail` はそれぞれ1・2・3番目の一致。`detail` は前後の空白を落とす）。`status` は `detail` に `status → ` の後ろに英小文字と `_` の並び（`[a-z_]+`）があればそれ、なければ `null`。ほかの行（`立法補佐`・`行政の長` などの行、時刻の形が違う行）は無視する
- A2. `parseFrontMatter(markdown: string): { id: string; title: string; status: string } | null` を export する。先頭が `---` の行で始まり、次の `---` の行までの間から、`id:`・`title:`・`status:` の行の値（行頭のキー、`: ` の後ろから行末まで。`#` 以降のコメントと前後の空白を落とす）を読む。3つのどれかがなければ `null`
- A3. `loadGovernance(root: string = process.cwd()): GovernanceData` を export する。`GovernanceData = { generated_at: string; tickets: { id: string; title: string; status: string; timeline: TimelineEvent[]; returns: number; disagreements: number }[]; board: { tickets: number; merged: number; rejected: number; blocked: number; disagreements: number } | null; summary: GovernanceSummary | null }`
  - `tickets`：`<root>/docs/tasks/` の中で名前が `^T-\d{3}-[a-z0-9-]+\.md$` に一致するファイルだけを名前の順に読み、`parseFrontMatter` が `null` のものは飛ばす。`returns` は `timeline` のうち `actor` が `gate-runner` で `status` が `in_progress` の件数、`disagreements` は同じく `status` が `blocked` で `detail` に `分かれた` を含む件数
  - `board`：`<root>/docs/tasks/_board.json` の `totals`（`tickets`・`merged`・`rejected`・`blocked`・`disagreements` の5つの数）。ファイルがない・読めない・数でない項目があれば `null`
  - `summary`：`<root>/docs/governance/summary.json` を zod で検証した `GovernanceSummary = { schema: "vgdd.governance-summary.v1"; generated_at: string; period: { first: string | null; last: string | null }; chain_ok: boolean; records: number; sessions: number; agents: number; tool_calls: { allow: number; deny: number }; deny_kinds: Record<string, number>; by_agent: Record<string, { calls: number; deny: number }> }`（ほかの項目があっても無視して通す。zod の `.passthrough()` は使わず、上の項目だけを取り出す）。ファイルがない・読めない・検証に通らなければ `null`
  - `generated_at` は `nowJst()`（`@/lib/time`）
  - 読むのは上の3か所だけ。`root` の外、`~/tsubuyaki-z3`、`.env*`、`node_modules` は読まない
  - **シンボリックリンクはたどらない**：`<root>/docs`・`<root>/docs/tasks`・`<root>/docs/governance` と、読む各ファイルを `fs.lstatSync` で確かめ、リンクであれば（`isSymbolicLink()`）そのディレクトリ・ファイルは「ない」として扱う（票なら飛ばし、`_board.json`・`summary.json` なら `null`。例外は投げない）。パスの組み立てに外からの入力（リクエストの値）を使わない
- A4. `GET /api/governance` を新設する。引数を取らず、200 で `loadGovernance()` の結果を返す。例外は 500 `{ error: "governance_unavailable" }`（例外の本文を応答に入れない）
- A5. `/governance` のページ（`src/app/governance/page.tsx`。中身は `src/components/GovernanceView.tsx` のクライアント部品。データは `GET /api/governance` から取る。既存の `src/app/sessions/[id]/page.tsx` と同じく `Suspense` で包む）に、次を上から順に表示する：
  1. 見出し「統治のライブ画面」と1行の説明「AI の作業員・裁判所・司法が、憲法と法律のもとで動いた記録（件数とリポジトリの記録だけ。生のログは公開していない）」
  2. **数字のタイル**：`summary` があれば「証拠ストアの記録件数」（`records`）、「拒否」（`tool_calls.deny`）、「エージェントの種類」（`agents`）、「ハッシュチェーン」（`chain_ok` が true なら「改ざんなし」、false なら「不整合」）。`board` があれば「票」（`tickets`）、「統合」（`merged`）、「差し戻し・停止の累計」（`rejected`。裁判所が数えた、差し戻しと判断待ちの合計）、「司法の不一致」（`disagreements`）。`summary` がなければ、その4枚の代わりに「操作の集計はまだ書き出されていません」と1行
  3. **票の盤**：`ready`・`in_progress`・`review`・`merged`・`blocked` の5列（見出しは「準備」「作業中」「申請中」「統合」「判断待ち」）。各票は `id`・`title`・差し戻しの回数（`returns`）のカード。5つ以外の status の票は「その他」の列に出す。カードを押すとその票が選ばれる
  4. **票1枚の運命**：選ばれた票（最初は `timeline` の件数が最も多い票。同数なら `id` の大きい票）の `timeline` を時刻の順に縦に並べ、各行に時刻（`MM/DD HH:MM`）・`actor` の日本語名（`gate-runner`＝「裁判所」、`night-runner`＝「夜間の代行」、`release`＝「朝の統合」）・`status` のバッジ（`merged` は統合、`in_progress` は差し戻し、`blocked` は判断待ち、`review` は申請、ほかは文字のまま）・`detail` を出す
  5. 末尾に「最後に集計した日時」（`summary.generated_at`、なければ「—」）と「画面を作った日時」（`generated_at`）
- A6. `src/lib/governance.test.ts` に、下の①〜⑨を**それぞれ1件以上の `it(`**で試す（ファイルを読む試験は、試験の中で一時ディレクトリに `docs/tasks/` と `docs/governance/` を作って `loadGovernance(<一時ディレクトリ>)` を呼ぶ）：①§6 の裁判所の行から `ts`・`actor`・`status`・`detail` が取れる ②`## 6. 記録` より前の同じ形の行と、`立法補佐` の行は入らない ③`status → ` がない行は `status: null` ④`parseFrontMatter` がコメントを落とし、`title` がない票は `null` ⑤`returns` と `disagreements` の数え方 ⑥名前が規則に合わないファイル（`README.md`・`T-1-x.md`）を読まない ⑦`_board.json` がない・壊れているときは `board: null`、`summary.json` がない・項目の型が違うときは `summary: null` ⑧`summary.json` の余分な項目は結果に入らない ⑨一時ディレクトリの外のファイルを指すシンボリックリンク（票の名前のリンク、`_board.json` のリンク、`docs/tasks` ディレクトリそのもののリンク）は読まれない
- A7. `npm run -s test`（既存の試験と追加分のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは次の5つだけ（すべて新設）：`src/lib/governance.ts`、`src/lib/governance.test.ts`、`src/app/api/governance/route.ts`、`src/app/governance/page.tsx`、`src/components/GovernanceView.tsx`

## 3. 開発用テスト

- `governance.test.ts`：A6 の観点。リポジトリの実際の票に依存する期待値は書かない（一時ディレクトリの見本だけ）
- 画面はユーザー役が統合後にブラウザで確かめる（`npm run dev` → `/governance`）

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回（`npm install` は使わない）
2. 見た目は既存の画面（Tailwind、zinc 系）に合わせる。タイルは横に並べ、狭い画面では折り返す
3. `docs/governance/summary.json` は作らない（オーナーが証拠ストアから書き出してコミットする。この票の範囲外）
4. コミットは1つ。メッセージの先頭は `T-013: `

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ **Codex security**（観点：読むファイルが3か所に限られるか、パスの組み立てに外からの入力が入らないか、生のログ・本文を出さないか）。要件は main にコミット済みのこの票の §2（A1〜A7）。T-010・T-011・T-012 と触るファイルが重ならない。

## 6. 記録

（統合後に追記）
- 22:59 W3 起動（worktree `agent-ad0fec44ee0f07850`、main 836733a から）。23:0x コミット 8d58f68（5ファイル新設、+790）。報告：test 147（既存 135＋12）・typecheck・lint 合格（警告1件は既存の `vgdd/conformance/run.mjs`）。票にない守り：開くときに `O_NOFOLLOW`、1MB 超は読まない、`docs` がディレクトリでなければ「ない」。ルートで `await connection()`（cacheComponents で GET をビルド時に固めないため）。front matter は空の値を「ない」、同じキーは最初の行。運命の時刻は記録の文字列から `MM/DD HH:MM`。拒否なし
- 23:07 行政の長が差分を確認（`files_allowed` の5ファイルのみ、読む場所は3か所、禁止語なし、A1〜A7。A6 の①〜⑨に `it(` が対応）。`status: review` で main にコミットし申請（gate-runner `--hold`。合格は held、統合は朝に release.sh）。画面はユーザー役が `/governance` で確認

- 2026-11-05T23:10:24+0900 gate-runner: status → in_progress（セキュリティ審査が差し戻し）
- 23:15 立法補佐：Codex の judge とセキュリティ審査の指摘は1件（major、A3）。作業員が足した 1MB の上限（`MAX_FILE_BYTES` と `readRegularFile` のサイズ判定）が票にない読み飛ばし。上限だけを取り除く（lstat・O_NOFOLLOW・非ディレクトリの扱いは残す）
- 23:16 行政の長：W5 を新しい worktree（main 84db97f）で起こし、8d58f68 を cherry-pick して修正を指示。23:18 W5 のコミット 5fe29b5（1つに amend）。取り除いたのは定数1行と判定2か所だけ（8d58f68 との差は3行）。上限を前提にした試験はなかったので試験は変更なし。test 147・typecheck・lint 合格。拒否なし
- 23:19 行政の長が差分を確認（8d58f68 との差が上限の除去だけ、`files_allowed` の5ファイル）。`status: review` で main にコミットし再申請（差し戻し1回目）

- 2026-11-05T23:21:49+0900 gate-runner: status → review（判定に合格（judge=APPROVED codex=APPROVED）。夜間のため統合せず、朝のオーナーの承認を待つ）
