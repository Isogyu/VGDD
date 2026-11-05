---
id: T-draft-kernel-ui
title: 統治のライブ画面に「Kernel」の区画を足す（法律の版・稼働／停止・成立条件①〜⑤の強制と試験・承認済みの仕様・held・裁定・判定と不一致・ハッシュチェーン）
status: draft
requirements: [A1, A2, A3, A4, A5, A6, A7, A8, A9]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-55①, D-59③, ADR-017, ADR-028]   # 記録用。司法には渡さない
proposal_from: 2026-11-06 02:2x 行政の長の下書き（28_night_plan_max.md §1 B）。前提は改正案 p0.4.3 §1（裁判所が docs/governance/kernel-state.json を書き出す）。立法補佐が仕上げ、オーナーの approve-spec の後に着手
estimate_h: 1.3
time_limit_min: 80
security_review: false         # 読むのは docs/ の下の JSON だけ。API・DB・外部に触れない
unattended:
branch: null
worker: null
files_allowed:
  - src/lib/kernel-state-schema.ts         # 新設：形の検証と表示用の整形（純粋関数だけ。node:fs を使わない。画面からも読む）
  - src/lib/kernel-state.ts                # 新設：ファイルの読み込み（node:fs）
  - src/lib/kernel-state.test.ts           # 新設
  - src/app/api/governance/kernel/route.ts # 新設：GET
  - src/components/KernelPanel.tsx         # 新設：Kernel の区画
  - src/components/GovernanceView.tsx      # 区画を1つ差し込むだけ
files_forbidden:
  - src/lib/governance.ts
  - src/app/api/governance/route.ts
  - src/app/governance/page.tsx
  - src/lib/db/**
  - src/lib/sessions.ts
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [kernel-p0.4.3]   # 改正案 p0.4.3 §1 がオーナーに承認され、kernel-state.json の形（vgdd.kernel-state.v1）が固定されてから。形が変わればこの票は差し替える（strict で検証するため、項目の追加1つで state 全体が null になる）
---

## 1. 目的

デモの3分の中で「AI が憲法と法律のもとで動いた証拠」を**5秒で**伝える。統治のライブ画面（`/governance`、T-013）の先頭に「Kernel」の区画を足し、裁判所が書き出す `docs/governance/kernel-state.json`（改正案 p0.4.3 §1。**表示用の写し。判断の根拠にしない**）を読んで、法律の版・**稼働／停止中**の大きな表示・成立条件①〜⑤ごとの「どう強制しているか」と適合性テストの件数・承認済みの仕様・held・裁定・判定と不一致・ハッシュチェーンの検証結果を出す。生のログは出さない。審査：深さと実行20（統制の実在）、デモ25。

### 置き方の案（2つ。推奨は①）

| 案 | 内容 | 利点 | 難点 |
|---|---|---|---|
| **①（推奨）** | 今の `/governance` の先頭（見出しの直下、「統治の数字」の上）に `<section aria-label="Kernel">` を1つ足す | デモで画面の切り替えが要らない（5秒で伝える）。既存の API と部品を変えずに、新しい API と部品を足すだけ | 1画面が長くなる（Kernel の区画は折りたたまず、票の盤より上に置く） |
| ② | `/governance/kernel` を新設し、`/governance` の見出しにリンク | 画面ごとの責務が分かれる。Kernel の区画を大きく作れる | デモで1クリック増える。導線を2か所に足す |

### `_board.json` の既知の課題への対処（1行）

release.sh は統合の後に `_board.json` を作り直さない（次の gate-runner の統合まで古い数字）。直し方の案：release.sh の最後で `update_board` と同じ関数を呼ぶ（法律の変更。p0.4.3 の別項目として立法補佐へ）。UI 側はこの票では変えず、`_board.json` の `generated_at` を「最後に集計した日時」として出し続ける。

## 2. 受け入れ条件

- A1. `src/lib/kernel-state-schema.ts`（**`node:fs` を import しない**）に `pickKernelState(json: unknown): KernelState | null` を export する。手順：(1) `json` がオブジェクト（`null`・配列でない）でなければ `null` (2) `json.verdicts.by_task` がオブジェクトなら、`Object.entries` で鍵と値を取り出し、鍵が `^T-\d{3}$` に合うものだけを `Map` に移す（合わない鍵は捨てる。全体は `null` にしない）。zod には `by_task` を除いた形を渡す (3) zod の **strict** で次を検証し、合わなければ `null`。型（zod 式）：
  - `schema: z.literal("vgdd.kernel-state.v1")`、`generated_at: Iso`、`kernel_version: Short`、`policy_version: Short`
  - `stopped: z.object({ active: z.boolean(), since: Iso.nullable() }).strict()`
  - `judiciary: z.object({ status: z.enum(["ok","unavailable","down"]), kind: z.enum(["preflight_failed","judiciary_unavailable"]).nullable(), since: Iso.nullable() }).strict()`、refine：`status === "ok"` なら `kind === null`、そうでなければ `kind !== null`
  - `approvals: z.array(z.object({ task: TaskId, current: z.boolean(), approved_at: Iso.nullable() }).strict()).max(500)`（改正案 §9 の 7(c)：承認の記録に `ts` がなければ `null`）
  - `held: z.array(z.object({ task: TaskId, since: Iso }).strict()).max(500)`
  - `rulings: z.object({ count: Count, tasks: z.array(TaskId).max(500) }).strict()`、`annulments: z.object({ count: Count }).strict()`
  - `verdicts: z.object({ count: Count }).strict()`（`by_task` は (2) で別に扱う。**`by_task` が無い・オブジェクトでなければ空の `Map`**。各値は `z.object({ judge: Verdict, codex: Verdict, security: Verdict, at: Iso }).strict()` で1件ずつ検証し、落ちた値（例：`codex: "SKIPPED"` の文字列。裁判所は `--no-codex` の `SKIPPED` を `null` に写す＝改正案への申し送り）は捨てる）
  - `tickets` は**持たない**（strict なので裁判所が出せば state 全体が `null` になる。改正案 §1 の表を「`tickets` は出さない（MUST NOT。`_board.json` にある）」に固定する申し送り）
  - `disagreements: z.object({ count: Count, tasks: z.array(TaskId).max(500) }).strict()`
  - `evidence: z.object({ records: Count, chain_ok: z.boolean(), checkpoint_at: Iso.nullable(), last_record_at: Iso.nullable() }).strict()`
  - `conformance: z.object({ passed: Count, total: Count, impl: Short, at: Iso }).strict().nullable()`、refine：`passed <= total`
  - 補助：`Iso = z.string().min(10).max(40)`、`Short = z.string().min(1).max(40)`、`TaskId = z.string().regex(/^T-\d{3}$/)`、`Count = z.number().int().min(0).max(1_000_000)`、`Verdict = z.enum(["APPROVED","CHANGES_REQUIRED"]).nullable()`
  - 返り値 `KernelState` は上の形で、`verdicts.by_task` だけ `ReadonlyMap<string, { judge; codex; security; at }>`
- A2. `src/lib/kernel-state-schema.ts` に純粋関数 `summarizeKernel(state: KernelState, now: Date): KernelSummary` と **`formatJst(iso: string | null): string`**（`null` か `Date.parse` が `NaN` なら「—」、そうでなければ `formatMdHm(toJstIso(new Date(ms)))`。`@/lib/time` の `toJstIso`・`formatMdHm` を使う。表記は `formatMdHm` の書式に従う。注：T-draft-ui-consistency が `formatMdHm` をゼロ埋めに変える予定で、この票はその書式をそのまま使う）を export する。`KernelSummary` は：`approvedCurrent: number`（`current` が true の件数）、`approvalsSorted: KernelState["approvals"]`（`approved_at` の文字列の降順、同じなら `task` の昇順。**`approved_at` が `null` の行は末尾**、`null` 同士は `task` の昇順）、`verdictRows: { task; judge; codex; security; at; disagreed: boolean }[]`（`by_task` を `task` の昇順、`disagreed` は `disagreements.tasks` に含まれるか）、`heldCount: number`（`held.length`）、`rulingCount: number`（`rulings.tasks.length`）、`stale: boolean`（`generated_at` を `Date` にして `now` との差が **10 分**を超えるか、`Date` にできなければ true）。表示に使う件数は**配列の長さ**を使い、`count` は使わない（`count` と長さが食い違っても画面は長さ）
- A3. `src/lib/kernel-state.ts` に `loadKernelState(root = process.cwd()): KernelState | null` を export する。読むのは `<root>/docs/governance/kernel-state.json` の1か所だけ。パスの組み立てに外からの入力は使わない。手順（この順）：(1) `<root>/docs` と `<root>/docs/governance` を `lstat` し、シンボリックリンクかディレクトリでなければ `null`（lstat と O_NOFOLLOW はパスの最後の要素にしか効かないため。`governance.ts` の `isRealDir` と同じ）(2) ファイルを `lstat` し、シンボリックリンクか通常ファイルでなければ `null`（FIFO やデバイスを読まない）(3) `O_RDONLY | O_NOFOLLOW` で開く (4) `fstat` で通常ファイルでなければ `null`、大きさが **1,048,576 バイトを超えれば** `null`（ちょうど 1,048,576 は読む。**この大きさの検査は `governance.ts` にはなく、この票で新しく書く**）(5) 読んで `JSON.parse` → `pickKernelState`。どの段階の失敗も `null`（例外の本文は使わない）。`governance.ts` の `isRealDir`・`readRegularFile` は export されていないので**写す**（`governance.ts` は変えない）
- A4. `GET /api/governance/kernel` を新設する。引数を取らず、`try` の中で `await connection()` の後に 200 `{ state: loadKernelState() }`（`state` は `null` でありうる）。例外は 500 `{ error: "kernel_unavailable" }`（例外の本文を応答に入れない）。**Route Segment Config（`export const dynamic = …` 等）は書かない**（`cacheComponents` が有効なため。既存の `api/governance/route.ts` と同じ形）
- A5. `src/components/KernelPanel.tsx`（クライアント部品）は、開いたときに**1回だけ** `fetch("/api/governance/kernel", { cache: "no-store", signal })` で取り（再読み込みのボタンは置かない。unmount で `AbortController` の `abort()`。**`signal.aborted` のときは state を更新しない**＝`AbortError` を失敗として出さない）、応答の `state` を **`pickKernelState` で検証し直す**（`@/lib/kernel-state-schema` を実行時に import。`@/lib/kernel-state` は import しない）。`null`（ファイルがない・読めない・形が違う）なら、区画の中に「Kernel の状態の書き出しがありません（裁判所が稼働していないか、この環境では公開していません）」の1行だけを出す。そうでなければ `summarizeKernel(state, new Date())` の結果で次を出す（日時はすべて `formatJst`）：
  1. **書き出し日時**：「書き出し：<formatJst(generated_at)>」。`stale` が true なら横に「古い写しです（10分以上更新がありません）」（amber）
  2. **稼働／停止中**：`stopped.active` が false なら「稼働中」（emerald）、true なら「停止中（<formatJst(since)> から）」（red）。区画の中で最も大きい文字（`text-2xl` 以上）。`judiciary.status` が `ok` でなければ、その横に「司法の道具が使えません（<kind の日本語：preflight_failed＝起動時の点検で不足、judiciary_unavailable＝呼び出しの失敗>）」（amber）
  3. 法律の版：「Kernel <kernel_version>・フック <policy_version>」
  4. **成立条件①〜⑤の表**（`docs/kernel.md` §3 の表を生きた数字で）。行は固定の5行、列は「成立条件・どう強制しているか（固定の文）・いまの数字」。いまの数字：①役割分離＝`conformance` があれば「適合性テスト <passed>/<total>（<impl>、<at の MM/DD HH:MM>）」、なければ「未記録」②仕様の統治＝「承認済み <approvedCurrent> 票」③独立司法＝「判定 <verdictRows.length> 件、不一致 <disagreements.tasks.length> 件」④Kernel による強制＝「held <heldCount> 件、裁定 <rulingCount> 件、取り消し <annulments.count> 件」⑤証跡＝「記録 <evidence.records> 件、ハッシュチェーン <chain_ok ? 改ざんなし : 不整合>、最後のチェックポイント <checkpoint_at の MM/DD HH:MM か —>」
  5. 承認済みの仕様の一覧：`approvalsSorted` を、票・承認日時（`formatJst(approved_at)`。`null` は「—」）・`current` が false なら「仕様が変わった（承認し直しが要る）」のバッジ
  6. held・裁定・取り消し：`held` の票と `since`、`rulings.tasks`、`annulments.count`
  7. 判定の一覧：`verdictRows` を表に（judge・Codex・security の3列。`null` は「—」。`disagreed` の行は amber）
  8. 注意の1行（常に表示）：「生のログは公開していない。ここにあるのは裁判所が書き出した件数と結論だけ」
  失敗（応答が 2xx でない・通信の失敗・`state` が検証に落ちる）は「Kernel の状態を読めませんでした」の1行。**日時の整形**は `formatJst`（JST に固定、`Date` にできない文字列と `null` は「—」。生の文字列は出さない）
- A6. `src/components/GovernanceView.tsx` の見出し（`<header>`）の直後、「統治の数字」の `<section>` の前に `<KernelPanel />` を1つ差し込む。それ以外（既存の区画・文・API の呼び出し）は変えない。`KernelPanel` は自分で fetch するので、`GovernanceView` の `data` には触れない。**従属の明記**：`GovernanceView` は `/api/governance` の失敗・読み込み中に早期 return するので、その間は Kernel の区画も出ない（受け入れる。早期 return の前に置く案は構造の変更が増えるため §8 で問う）
- A7. `KernelPanel` が実行時に import してよい `@/lib` は `kernel-state-schema` だけ（`time` は `kernel-state-schema.ts` の中から `toJstIso`・`formatMdHm` に限って使う）。`@/lib/kernel-state`（`node:fs`）は import しない。文字列をキーにする辞書は `Map` で持つ。`dangerouslySetInnerHTML`・`console`・`localStorage` を使わない。表示する文字列は React の文字列としてだけ描画する。**`src/lib/kernel-state.ts`・`kernel-state-schema.ts` を import するのは、この票の新設ファイルと `KernelPanel` だけ**（ほかのモジュールが状態を読んで判断に使う経路を作らない）
- A8. `src/lib/kernel-state.test.ts` に、下の①〜⑪を**それぞれ1件以上の `it(`**で試す（`loadKernelState` は一時ディレクトリの `root` で）：①正しい JSON が通り、各項目が入る ②未知の項目が1つあると `null`（strict）③`by_task` に `constructor`・`__proto__`・`T-1`・`T-draft-x` の鍵があると捨てられ、`T-015` は残り、結果は `Map` で `Object.prototype` の鍵を持たない。`by_task` が無い・配列なら空の `Map` ④ファイルがないと `null`、ファイルがシンボリックリンクなら `null`、**`docs/governance` がディレクトリへのシンボリックリンクなら `null`** ⑤ちょうど 1,048,576 バイト（有効な JSON を末尾の空白で詰めて作る）は読み、1,048,577 バイトは `null` ⑥JSON でないと `null` ⑦`judiciary.status: "ok"` で `kind` が非 `null` なら `null`、`conformance.passed > total` なら `null`（refine）⑧`summarizeKernel`：`approvedCurrent` の数、`approvalsSorted` が降順で同時刻は `task` の昇順で **`approved_at: null` の行は末尾**、`verdictRows` が `task` の昇順で `disagreed` が付く、`generated_at` が 11 分前なら `stale` が true で 9 分前なら false、`Date` にできない `generated_at` は true ⑨`stopped.active: true` と `judiciary.status: "down", kind: "judiciary_unavailable"` の値がそのまま入る ⑩`by_task` の値に `{ codex: "SKIPPED" }` を含む1件は落ち、ほかの値は残る ⑪`formatJst`：`+09:00` の文字列、`Z` の文字列（JST に変換される）、不正な文字列（「—」）、`null`（「—」）の4例
- A9. `npm run -s test`（既存の試験のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは次の6つだけ：`src/lib/kernel-state-schema.ts`（新設）、`src/lib/kernel-state.ts`（新設）、`src/lib/kernel-state.test.ts`（新設）、`src/app/api/governance/kernel/route.ts`（新設）、`src/components/KernelPanel.tsx`（新設）、`src/components/GovernanceView.tsx`

## 3. 開発用テスト

- `kernel-state.test.ts`：A8 の観点。画面はユーザー役が統合の後に確かめる（ファイルがないときの1行、裁判所が書き出した後の表示、`kernel-stop.sh` の後に「停止中」が出ること＝K2 の本番の確認を兼ねる、裁判所を止めて 10 分後に「古い写しです」が出ること）
- デモの5秒：`/governance` を開いた直後に「稼働中」と「適合性テスト N/N」が見える

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. 読み込みは `src/lib/governance.ts` の `isRealDir`・`readRegularFile`（lstat・O_NOFOLLOW・fstat の `isFile`）の形に合わせて `kernel-state.ts` に写し、**1,048,576 バイトの上限はこの票で新しく足す**（`governance.ts` にはない）。`governance.ts` は変えない
3. 見た目は `GovernanceView` の `Tile` に合わせる（zinc 系、稼働は emerald、停止は red、司法の注意と古い写しは amber）
4. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。要件は main にコミット済みのこの票の §2。`kernel-state.json` の**書き出し**（裁判所側。改正案 p0.4.3 §1）はこの票の範囲外で、法律の反映の後に本番で確かめる。それまでは A5 の「ありません」の1行が出る。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（Codex は sandbox の中から呼べない。4:00 から立法補佐が行う）。点検役：Claude のサブエージェント（ツールなし）。02:2x、指摘 10 件（major 6・minor 4）。対応：

| # | 指摘 | 対応 |
|---|---|---|
| 1 | `by_task` の型（Record）と Map の指示が矛盾。zod の record では `__proto__` の汚染を検証の後に捨てることになる | A1 で「zod に渡す前に `Object.entries` で Map へ移す」順に固定。型は `ReadonlyMap` |
| 2 | 画面側に形を検査する手段がない（型だけの import） | 検証（zod）を `node:fs` を使わない `kernel-state-schema.ts` に分け、画面が実行時に `pickKernelState` で検証し直す（A5・A7）。files_allowed に1ファイル追加 |
| 3 | 古い写しが「稼働中」と緑で出る | 書き出し日時を常に表示し、10 分超は「古い写しです」（amber）。`stale` は純粋関数で計算（A2・A5-1） |
| 4 | 画面のロジック（件数・並び）を機械的に確かめられない | `summarizeKernel` を純粋関数に出し、A8 の⑧で試す |
| 5 | スキーマの型・上限・`T-NNN` の制限が未確定 | A1 を zod 式で全項目、`max(500)`、`TaskId` をすべての票に、`Iso`・`Short`・`Count` の補助型 |
| 6 | strict と「p0.4.3 で形が変わる」の衝突 | depends_on に「形が固定されてから。変われば票を差し替える」。版を書く |
| 7 | `judiciary.kind`・`count` と長さ・`passed ≤ total` の整合 | refine を A1 に。表示は配列の長さを使う（A2） |
| 8 | 日時の書式・タイムゾーン・不正な値 | JST 固定、`Date` にできなければ「—」、同時刻は `task` の昇順（A2・A5） |
| 9 | `readJson` の再利用か写しか、1MB の境界 | `governance.ts` は export していないので写す。境界は 1,048,576 を読み 1,048,577 は `null`（A3・A8⑤） |
| 10 | fetch の運用（回数・abort） | 1回だけ、再読み込みなし、unmount で abort（A5） |
| 整合 | `kernel-state` を他のモジュールが読んで判断に使う経路 | A7 に「import するのは新設ファイルと `KernelPanel` だけ」 |

**2回目の点検**（Claude のサブエージェント、読み取り専用。改正案 §1・§9 と既存コードとの突き合わせ。03:1x、指摘 8 件：major 3・medium 3・minor 2）：

| # | 指摘 | 対応 |
|---|---|---|
| 1 | `approvals[].approved_at` の null 可が改正案 §9 の 7(c) と食い違う | `Iso.nullable()`、並びは null を末尾、表示は「—」（A1・A2・A5-5・A8⑧） |
| 2 | `tickets` の有無が法律で任意なのに strict で拒む。`judiciary.since`・`evidence.*_at` の null 可が §1 に無記述 | `tickets` は持たない。改正案への申し送り：「`tickets` は出さない（MUST NOT）」「`since`・`checkpoint_at`・`last_record_at` は `string \| null`」「`SKIPPED` は `null` に写す」（A1・§8） |
| 3 | 「`readJson` を写す」と書いたが 1MB の上限は `governance.ts` にない。ディレクトリのリンク・`isFile` の検査が抜ける | A3 を手順 (1)〜(5) で列挙、上限は新規と明記（A3・§4-2・A8④） |
| 4 | 「JST の MM/DD HH:MM、不正は —」を満たす関数が `time.ts` にない | `formatJst` を `kernel-state-schema.ts` に純粋関数で置き、試験⑪（A2・A5・A8） |
| 5 | Kernel の区画の表示が `/api/governance` の成功に従属する | A6 に明記して受け入れ、§8 で問う |
| 6 | unmount の `abort()` が「読めませんでした」を誘発（StrictMode） | `signal.aborted` なら state を更新しない（A5） |
| 7 | `by_task` の値単位の捨て方・無いときの扱い・⑤の作り方 | 空の Map、試験⑩、空白で詰めた JSON（A1・A8） |
| 8 | Route Segment Config を足すとビルドが落ちる | A4 に「書かない。`connection()` は try の中」 |

## 8. オーナーに聞くこと

1. 置き方は①（`/governance` の先頭に区画）でよいか
2. `kernel-state.json` の形は改正案 p0.4.3 §1 の表に依る。**立法補佐への申し送り（この票の A1 と一致させる）**：`tickets` は出さない（MUST NOT）、`judiciary.since`・`evidence.checkpoint_at`・`evidence.last_record_at`・`approvals[].approved_at` は `string | null`、`verdicts.by_task` の `SKIPPED` は `null` に写す。起草で項目が変われば A1 を合わせ、票を差し替える
3. `_board.json` を release の後に作り直す直し（法律の変更）を p0.4.3 に含めるか
4. 「古い写し」の閾値 10 分は、裁判所の周回の間隔（既定）に合わせて決める。間隔が違えば変える
5. Kernel の区画が `/api/governance` の成功に従属する点（A6）を受け入れるか、早期 return の前に置く構造の変更をするか
