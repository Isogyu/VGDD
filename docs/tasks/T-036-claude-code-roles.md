---
id: T-036
title: 統治シアターの下に「Claude Code の使い分け」の欄を足す（役割ごとの機能・モデル・道具の制限と、フックの集計）
status: review
requirements: [A0, A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-64]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐が起草（オーナーの承認前）。オーナーが 21:1x に案 B（Claude Code の使い分けの区画）を採用
estimate_h: 2
time_limit_min: 150
security_review: false         # 公開済みの集計（summary.json）を既存の API から読むだけ。API は変えない
unattended: false
branch: worktree-agent-ab6384d485b3ba4d2
worker: W32
files_allowed:
  - src/lib/claude-roles.ts                           # 新設：役割の表（固定の文）と、集計から行を組み立てる純粋関数
  - src/lib/claude-roles.test.ts                      # 新設
  - src/components/theater/ClaudeRoles.tsx            # 新設：Claude Code の使い分けの欄
  - src/components/theater/ClaudeRoles.test.tsx       # 新設
  - src/components/theater/GovernanceTheater.tsx      # 欄を1つ置くだけ
  - src/components/theater/GovernanceTheater.test.tsx # 上に合わせて足すだけ
files_forbidden:
  - src/lib/governance*.ts                            # 型と検証は import して読むだけ
  - src/lib/theater-*.ts
  - src/lib/kernel-state*.ts
  - src/lib/kernel-invariants*.ts
  - src/lib/law-history*.ts
  - src/components/theater/TicketReplay.tsx
  - src/components/theater/GovernanceStage.tsx
  - src/components/theater/TheaterShell.tsx
  - src/components/theater/LawComparison.tsx
  - src/components/theater/DecisionPanel.tsx
  - src/components/theater/tokens.ts
  - src/components/GovernanceView.tsx
  - src/app/**
  - docs/**
  - src/lib/db/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-034, T-035]
---

## 1. 目的

審査の「Claude の活用」は、Claude Code を中心に据え、機能やモデルを目的に応じて使い分けたかを問う。VGDD では、三権の役割ごとに Claude Code の別の機能で境界を作った（作業員は worktree で隔離、司法と憲法審査はツールを外したサブエージェント、すべての操作は PreToolUse フックが判定）。これを1つの欄で、役割・使った機能・モデル・道具の制限と、フックの実際の集計（公開済みの `summary.json`）を並べて見せる。動画の「15〜35 秒」の場面に使う。審査：Claude の活用25、デモ25。

## 2. 受け入れ条件

- A0. 差分を許すパスは次の6つだけ：`src/lib/claude-roles.ts`、`src/lib/claude-roles.test.ts`、`src/components/theater/ClaudeRoles.tsx`、`src/components/theater/ClaudeRoles.test.tsx`、`src/components/theater/GovernanceTheater.tsx`、`src/components/theater/GovernanceTheater.test.tsx`。それ以外は変更しない。実装と差分の審査の基準は、T-035 を統合した後の main とする
- A1. **役割の表**（`src/lib/claude-roles.ts`。React を import しない。`node:fs`・`node:path` を読まず、`@/lib/governance` は `import type` だけで参照する）：`CLAUDE_ROLES` を export する。各行は `{ key, role, feature, model, limits, agentKey }`。文は次のとおり（一字一句このまま）。`agentKey` は集計の `by_agent` の鍵で、ない行は `null`

  | key | role | feature | model | limits | agentKey |
  |---|---|---|---|---|---|
  | `main` | メインのセッション | 行政の長などが、作業員を起動して申請する | 指定なし | 権限ルールと sandbox で Z3 に触れない | `(main)` |
  | `worker` | 作業員 | サブエージェント `worker`。自分の git worktree で実装する（`isolation: worktree`） | Opus | ほかのエージェントの起動・Web の取得を外す | `worker` |
  | `tester` | テスト担当 | サブエージェント `tester`。作業員とは別に試験を書く（`isolation: worktree`） | Opus | ほかのエージェントの起動・Web の取得を外す | `tester` |
  | `helper` | 汎用の補助 | 汎用のサブエージェント（調べもの・点検） | 指定なし | 権限ルールとフックは同じ | `general-purpose` |
  | `judge` | 司法（Claude） | サブエージェント `judge` を、裁判所の `judge.sh` が `claude -p --agent judge` で別のプロセスとして呼ぶ。差分・受け入れ条件・監査の結果だけを入力にする | Sonnet | 定義に並べた組み込みのツールを `disallowedTools` で禁止 | `null` |
  | `constitutional` | 憲法審査 | サブエージェント `constitutional-review`。法律の改正案が憲法に合うかを読む | Sonnet | 定義に並べた組み込みのツールを `disallowedTools` で禁止 | `constitutional-review` |

- A2. **集計の検証と、行の組み立て**（同じファイル。どれも純粋関数）：
  - `pickRoleSummary(json: unknown)`：ブラウザで使える検証。`GovernanceSummary`（`@/lib/governance` の型）と同じ項目と型（`schema` が `"vgdd.governance-summary.v1"`、`generated_at`、`period.first`・`period.last`（文字列か `null`）、`chain_ok`、`records`・`sessions`・`agents`（数）、`tool_calls.allow`・`tool_calls.deny`（数）、`deny_kinds`（値が数のオブジェクト）、`by_agent`（値が `{ calls, deny }`（どちらも数）のオブジェクト））を確かめ、合えばそれらの項目だけで組み立て直して返す。合わなければ `null`。数の判定を含め、今の `pickSummary`（`@/lib/governance` の zod のスキーマ）と同じ入力で同じ判定になること（`pickSummary` より厳しくも緩くもしない）。判定には、`claude-roles.ts` の中に `pickSummary` と同じ形の zod のスキーマを置いて使ってよい（zod は依存に入っている。`@/lib/governance` は値として import しない）
  - `buildRoleRows(summary)`：`summary` は `GovernanceSummary | null`。`CLAUDE_ROLES` の順のまま、各行に `calls` と `deny` を足して返す。`agentKey` が `null`、`summary` が `null`、`summary.by_agent` にその鍵がないときは、どちらも `null`（0 で埋めない）
  - `buildHookTotals(summary)`：`summary` が `null` なら `null`。それ以外は `{ allow: summary.tool_calls.allow, deny: summary.tool_calls.deny, sessions: summary.sessions, records: summary.records, chainOk: summary.chain_ok, generatedAt: summary.generated_at, periodLast: summary.period.last, denyKinds }`。`denyKinds` は `summary.deny_kinds` を件数の多い順（同じ件数は鍵の名前の順）に並べた `{ key, label, count }` の配列
  - `deny_kinds` の鍵の表示名：`protected_path`→「保護パスへの操作」、`git_scope`→「git の範囲の外」、`z3`→「Z3」、`readonly_outside`→「読むだけのフォルダ」、`hook_internal`→「証拠ストア・入力の形」、`other`→「その他」。それ以外の鍵は「その他の分類」
- A3. **欄**（`src/components/theater/ClaudeRoles.tsx`、`"use client"`）：
  - 表示だけの部品 `ClaudeRolesView({ summary })` を export する（`summary` は `GovernanceSummary | null`）。既定の export はデータを取る部品で、マウントのたびに1回だけ `GET /api/governance` を取り（ポーリングしない）、応答の `summary` を `pickRoleSummary` で検証し直してから `ClaudeRolesView` に渡す。外れた後の応答は反映しない。`@/lib/governance` を値として import しない
  - 取得の状態の文：取得前は「読み込み中…」。HTTP 200 で生の `body.summary` が `null` のときだけ「操作の集計の書き出しがありません」。通信の失敗・200 以外・JSON として読めない・`pickRoleSummary` が `null` を返したときは「操作の集計を読めませんでした」。どの場合も役割の表（A1 の固定の文）は出し、件数の列は「—」
  - 見出し `h2`「Claude Code の使い分け」。その下に1行「役割ごとに Claude Code の別の機能で境界を作りました。ツール呼び出しは PreToolUse フックが判定します」
  - 役割の表：列は「役割」「Claude Code の機能」「モデル」「道具の制限」「呼び出しの記録（拒否を含む）」「うちフックの拒否」。件数が `null` なら「—」。数字は3桁ごとに「,」で区切る
  - フックの集計（`buildHookTotals` が `null` でないときだけ）：「フックの判定：許可 {allow}・拒否 {deny}（{sessions} セッション、記録 {records} 行（結果の記録を含む）、ハッシュチェーン {OK／NG}）」と、拒否の分類ごとの札（「{label} {count}」）
  - 注記（いつも出す）：「件数は記録の agent_type ごとです。(main) は agent_type のない記録をまとめたもので、行政の長だけの件数ではありません。役割の説明は今の定義、件数は書き出した期間の記録で、過去の件数は今の制限のもとで動いたことを示しません。司法（Claude）は judge.sh が別のプロセスで呼び、この表では件数を対応させません。— は 0 件という意味ではありません。許可は実行の成功を意味しません。拒否の分類は理由の文による分類で、権限ルールなどによる拒否のすべてではありません。Codex は第2の司法と監査で、この表の外です」
  - 出どころの1行：`summary` があれば「出どころ：docs/governance/summary.json（{generatedAt} に生成、最後の記録は {periodLast}）」（時刻は `@/lib/kernel-state-schema` の `formatJst`。`null` は「—」）、なければ「出どころ：docs/governance/summary.json」
- A4. **置き場所**（`GovernanceTheater.tsx`）：変えるのは import と、T-033 の「判例の比較」「判断待ちと次の担当」の区画の**下**に `ClaudeRoles` を横幅いっぱいの区画として1つ置くことだけ。`TheaterShell` に渡す4つの区画と、T-033・T-035 の部分（取得・取り直し・時刻の表示）は変えない。`ClaudeRoles` は source の切り替えで作り直さず、T-035 の取り直しにも加わらない。色は T-033 の区画と同じ `theaterTokens.page` の系統。幅 375px では表を横にスクロールできる入れ物（`overflow-x-auto`）に入れ、ページに横スクロールを出さない
- A5. 試験：
  - `claude-roles.test.ts`：`CLAUDE_ROLES` の6行の `key` の順と `agentKey`。合成の `GovernanceSummary` で、`buildRoleRows` が `by_agent` の値を写し（`tester` の件数がある合成の入力ではその値）、鍵がない行と `agentKey` が `null` の行は `null` になること。`summary` が `null` のとき全行 `null`。`buildHookTotals` の項目の対応・並べ方（件数の多い順、同数は鍵の名前の順）・未知の鍵の表示名。`pickRoleSummary` と `pickSummary` に、同じ合成の入力（正しいもの・項目が欠けたもの・型が違うもの）とリポジトリの実際の `docs/governance/summary.json` を通して、合う・合わないの判定が一致し、実際のファイルでは `worker` の行の `calls` が 1 以上であること（`pickSummary` は試験の中でだけ import してよい）
  - `ClaudeRoles.test.tsx`：`renderToStaticMarkup` で `ClaudeRolesView` を合成の入力で描き、見出し・6行の役割の文・数字の区切り・「—」・拒否の札・注記・出どころの1行。`summary` が `null` でも役割の表と注記が出て、フックの集計の数字と札が出ないこと。既定の export の初期の表示が「読み込み中…」であること
  - `GovernanceTheater.test.tsx`：今の試験はそのまま。初期の表示に `h2`「Claude Code の使い分け」が出ることを足す
- A6. `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る

## 3. 開発用テスト

held の後、release の前に、立法補佐が held の候補を一時的な作業ツリーで動かして確かめる。

- 下へ送ると、判例の比較・判断待ちの下に「Claude Code の使い分け」が出て、その下に「証拠」が続く
- 数字が `docs/governance/summary.json` と一致する（メインのセッション 2,018・拒否 44、作業員 1,123・拒否 33、汎用 377・拒否 5、憲法審査 6・拒否 0、許可 3,442・拒否 82）
- 1440×900 で最初の画面は今のまま。375px でページに横スクロールが出ない

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. A1・A2（純粋関数と試験）→ A3 と試験 → A4 と試験
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。T-035 の統合の後に作業員を起動する（同じ `GovernanceTheater.tsx` を触る）。

## 6. 記録

- 21:50 行政の長が W32 を起動（worktree `agent-ab6384d485b3ba4d2`、T-035 を統合した後の main 382d861 から、モデルは Opus）。仕様はオーナーが 21:33:00 に approve-spec で承認済み（21:50:16 の Kernel の写しの `approvals[].current` で確かめた）。依存の T-034・T-035 は統合済み
- W32 の最初の報告：HEAD `984fe0c`。A2 の「0 以上の整数」と「`pickSummary` と同じ判定」がぶつかることを「§2 から外れる解釈」として挙げた（`pickSummary` は `z.number()` で負の数・小数も通す。`governance.ts` は変更禁止）。判定は zod 4 の内部の判定を手で写して `pickSummary` に合わせていた。行政の長が `governance.ts` で `z.number()` を確かめ、オーナーに2点を相談した
- オーナーの判断：(1) 数の判定は `pickSummary` と同じにし、0 以上の整数の条件を外す（厳しくも緩くもしない） (2) `claude-roles.ts` の中に `pickSummary` と同じ形の zod のスキーマを置いて判定する。§2 の A2 をこの意味に直して main e9241f5 でコミットし、22:00:51 に承認し直した（22:03:22 の Kernel の写しの `approvals[].current` で確かめた）
- W32 の直し：手書きの判定を、`governance.ts` の `summarySchema` と同じ形の zod のスキーマ `roleSummarySchema` と `safeParse` に置き換えた（`@/lib/governance` は `import type` だけのまま）。組み立て直しも `pickSummary` と同じ書き方。`pickSummary` との一致の試験（37 通り、実際の `summary.json` を含む）は残した。コミットに直しを入れ、オーナーの指示で基点を e9241f5 に積み直した（衝突なし）。HEAD `6ee3dd1f381a85cc9b7e36e250814233a6d24c29`、e9241f5 の上に1コミット。test 880 件（44 ファイル）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:875` の `stopsDir` で差分の外）
- 行政の長の確認（試験は再実行していない）：差分は A0 の6つだけ（+730）。984fe0c からの変更は `claude-roles.ts` と試験だけ。`roleSummarySchema` の項目と型が `summarySchema` と同じこと、A1 の6行の文が票の表（バッククォートを外した中身）と一字一句同じこと、件数がないときに 0 で埋めず `null`（画面は「—」）にすること、`ClaudeRoles.tsx` と `claude-roles.ts` が `@/lib/governance` を `import type` だけで参照すること、`GovernanceTheater.tsx` の変更が import 1行と T-033 の区画の下の入れ物1つだけ（`key` なし、取り直しにつながない）であることを、§2 と読み合わせた
- 読み方が割れる所（W32 の選んだ読み方）：(1) 表の中のバッククォートは書式として外し、中身だけを文字列にした（行政の長の指示）。`(main)` は文字列、`null` は値 (2) `GovernanceTheater` には `<div>` の入れ物を置き、`<section aria-label="Claude Code の使い分け">` は `ClaudeRoles` の側が持つ（同じ名前の section を二重にしないため） (3) 入れ物は `px-4 pb-4` で、T-033 の区画の `p-4` と合わせて間を 16px にした
- 補った解釈（文面の範囲内）：(1) フックの集計の文と拒否の札の数字にも「,」区切りを使う（§3 の「許可 3,442」に合わせた。`toLocaleString("en-US")`） (2) 取得の状態の文は既定の export の側で欄の上に出し、`ClaudeRolesView` には `summary={null}` を渡す（props を `{ summary }` だけに保つため） (3) 応答が object でない・null・配列のとき、`summary` の鍵がないときは「操作の集計を読めませんでした」 (4) 鍵の名前の順は UTF-16 の符号の順（ロケールに左右されない） (5) 表に `min-w-[48rem]` を付け、`overflow-x-auto` の中で横にスクロールさせる
- **確かめていない**：画面からの実際の `GET /api/governance` の取得（取得の流れの試験もない）、§3 の数字と画面の表示の照合（試験で確かめたのは、実際の `summary.json` での `pickSummary` との判定の一致と、作業員の行の `calls` が 1 以上であることだけ）、1440×900 と 375px の実際の収まり、`npm run build`（クライアントの束に `node:fs` が入らないことは import の形からの推論）。§3 で立法補佐が held の候補で確かめる

## オーナーに聞くこと

1. 役割の表の文は、`.claude/agents/*.md` の定義（worker・tester は Opus と worktree、judge・constitutional-review は Sonnet でツールなし）から立法補佐が書いた。行政の長のモデルは定義がないので「指定なし」にした
2. `(main)` の集計は agent_type のない記録のまとめで、役職を見分けていない。表では「メインのセッション」とし、注記で行政の長だけの件数ではないと書いた

- 2026-11-07T22:06:01+0900 gate-runner: status → review（判定に合格（judge=APPROVED codex=APPROVED）。夜間のため統合せず、朝のオーナーの承認を待つ）
