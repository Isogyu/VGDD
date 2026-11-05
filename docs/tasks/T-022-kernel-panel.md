---
id: T-022
title: 統治のライブ画面に「Kernel」の区画を足す（法律の版・稼働／停止・成立条件①〜⑤の強制と試験・承認済みの仕様・held・裁定・判定と不一致・ハッシュチェーン）
status: merged
requirements: [A1, A2, A3, A4, A5, A6, A7, A8, A9]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-55①, D-59③, ADR-017, ADR-028]   # 記録用。司法には渡さない
proposal_from: 2026-11-06 02:2x 行政の長の下書き（docs/tasks/drafts/T-draft-kernel-ui.md）を 04:3x に立法補佐が T-022 として起こした。元の下書き（28_night_plan_max.md §1 B）。前提は改正案 p0.4.3 §1（裁判所が docs/governance/kernel-state.json を書き出す）。立法補佐が仕上げ、オーナーの approve-spec の後に着手
estimate_h: 3
time_limit_min: 180             # Codex の点検 #13：厳格な読み込み・通信の往復・12 分類の試験を含む
security_review: true          # 新しい GET の API がファイルを読む（Codex の点検 #13）
unattended: false
branch: worktree-agent-a13d89d1cd0b8a9d7   # 作業員のブランチ（main 691ef66 から）。統合キュー（p0.3.1）により main から分岐したまま申請
worker: W18
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
depends_on: [kernel-p0.4.3]   # 法律 p0.4.3（ブランチ law/p0.4.3、vgdd/scripts/kernel-state.mjs）がオーナーに反映されてから。A1 の形は 04:3x に立法補佐が kernel-state.mjs の出力と一字ずつ合わせた。形が変われば票を差し替える（strict のため）
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

- A1. `src/lib/kernel-state-schema.ts`（**`node:fs` を import しない**）に `pickKernelState(json: unknown): KernelState | null` を export する。手順：(1) `json` がオブジェクト（`null`・配列でない）でなければ `null` (2) `json.verdicts.by_task` がオブジェクトなら、`Object.entries` で鍵と値を取り出し、鍵が `^T-\d{3,4}$` に合うものだけを `Map` に移す（合わない鍵は捨てる。全体は `null` にしない）。zod には `by_task` を除いた形を渡す (3) zod の **strict** で次を検証し、合わなければ `null`。型（zod 式）：
  - `schema: z.literal("vgdd.kernel-state.v1")`、`generated_at: Iso`、`kernel_version: Short.nullable()`、`policy_version: Short.nullable()`
  - `stopped: z.object({ active: z.boolean(), since: Iso.nullable() }).strict()`
  - `judiciary: z.object({ status: z.enum(["ok","unavailable"]), kind: z.enum(["preflight_failed","judiciary_unavailable"]).nullable(), since: Iso.nullable() }).strict()`、refine：`status === "ok"` なら `kind === null`、そうでなければ `kind !== null`
  - `approvals: z.array(z.object({ task: TaskId, current: z.boolean(), approved_at: Iso.nullable() }).strict()).max(500)`（改正案 §9 の 7(c)：承認の記録に `ts` がなければ `null`）
  - `held: z.array(z.object({ task: TaskId, since: Iso.nullable() }).strict()).max(500)`
  - `rulings: z.object({ count: Count, tasks: z.array(TaskId).max(500) }).strict()`、`annulments: z.object({ count: Count }).strict()`
  - `verdicts: z.object({ count: Count }).strict()`（`by_task` は (2) で別に扱う。**`by_task` が無い・オブジェクトでなければ空の `Map`**。各値は `z.object({ judge: Verdict, codex: Verdict, security: Verdict, at: Iso }).strict()` で1件ずつ検証し、落ちた値（例：`codex: "SKIPPED"` の文字列。裁判所は `--no-codex` の `SKIPPED` を `null` に写す＝改正案への申し送り）は捨てる）
  - `tickets` は**持たない**（strict なので裁判所が出せば state 全体が `null` になる。改正案 §1 の表を「`tickets` は出さない（MUST NOT。`_board.json` にある）」に固定する申し送り）
  - `disagreements: z.object({ count: Count, tasks: z.array(TaskId).max(500) }).strict()`
  - `evidence: z.object({ records: Count, chain_ok: z.boolean().nullable(), checkpoint_mismatches: Count.nullable(), checkpoint_at: Iso.nullable(), last_record_at: Iso.nullable() }).strict()`（`chain_ok` はハッシュチェーン、`checkpoint_mismatches` はチェックポイントとの食い違いの件数。`null` は「確かめていない」）
  - `conformance: z.object({ passed: Count, total: Count, impl: z.enum(["repo","z3"]).nullable(), kernel_version: Short.nullable(), at: Iso.nullable() }).strict().nullable()`、refine：`passed <= total`
  - 補助：`Iso = z.string().min(10).max(40)`、`Short = z.string().min(1).max(40)`、`TaskId = z.string().regex(/^T-\d{3,4}$/)`、`Count = z.number().int().min(0).max(1_000_000)`、`Verdict = z.enum(["APPROVED","CHANGES_REQUIRED"]).nullable()`
  - 返り値 `KernelState` は上の形で、`verdicts.by_task` だけ `ReadonlyMap<string, { judge; codex; security; at }>`
  - **通信の形**（Codex の点検 #2 critical：`Map` は `JSON.stringify` で `{}` になり判定の一覧が消える）：同じファイルに `toWire(state: KernelState): KernelStateWire` を export する。`KernelStateWire` は `verdicts.by_task` を `Object.fromEntries` で普通のオブジェクトに戻した形（ほかは同じ）。`pickKernelState(toWire(x))` は `x` と同じ内容を返す（A8⑫）
- A2. `src/lib/kernel-state-schema.ts` に純粋関数 `summarizeKernel(state: KernelState, now: Date): KernelSummary` と **`formatJst(iso: string | null): string`**（`null` か `Date.parse` が `NaN` なら「—」、そうでなければ `formatMdHm(toJstIso(new Date(ms)))`。`@/lib/time` の `toJstIso`・`formatMdHm` を使う。表記は `formatMdHm` の書式に従う。注：T-draft-ui-consistency が `formatMdHm` をゼロ埋めに変える予定で、この票はその書式をそのまま使う）を export する。`KernelSummary` は：`approvedCurrent: number`（`current` が true の件数）、`approvalsSorted: KernelState["approvals"]`（`approved_at` の文字列の降順、同じなら `task` の昇順。**`approved_at` が `null` の行は末尾**、`null` 同士は `task` の昇順）、`verdictRows: { task; judge; codex; security; at; disagreed: boolean }[]`（`by_task` を `task` の昇順、`disagreed` は `disagreements.tasks` に含まれるか）、`heldCount: number`（`held.length`）、`rulingCount: number`（`rulings.tasks.length`）、`stale: boolean`（`generated_at` を `Date` にして `now` との差が **600,000 ミリ秒を超える**か、`Date` にできなければ true。ちょうど 600,000 は false）。件数の出どころは固定する（Codex の点検 #4）：`approvals`・`held`・`rulings.tasks`・`verdictRows`・`disagreements.tasks` は**配列の長さ**（`count` と食い違っても長さ）。`annulments.count`・`evidence.records`・`evidence.checkpoint_mismatches`・`conformance.passed`／`total` はその値
- A3. `src/lib/kernel-state.ts` に `loadKernelState(root = process.cwd()): KernelState | null` を export する。読むのは `<root>/docs/governance/kernel-state.json` の1か所だけ。パスの組み立てに外からの入力は使わない。手順（この順）：(1) `<root>/docs` と `<root>/docs/governance` を `lstat` し、シンボリックリンクかディレクトリでなければ `null`（lstat と O_NOFOLLOW はパスの最後の要素にしか効かないため。`governance.ts` の `isRealDir` と同じ）(2) ファイルを `lstat` し、シンボリックリンクか通常ファイルでなければ `null`（FIFO やデバイスを読まない）(3) `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` で開く（FIFO に差し替えられても待ち続けない。Codex の点検 #8）(4) `fstat` で通常ファイルでなければ `null`、大きさが **1,048,576 バイトを超えれば** `null`（ちょうど 1,048,576 は読む。**この大きさの検査は `governance.ts` にはなく、この票で新しく書く**）(5) **最大 1,048,577 バイトまでだけ**を `readSync` で読み、1,048,577 バイト読めたら `null`（`fstat` の後に追記されても上限を超えて読まない）。読んだ分を `JSON.parse` → `pickKernelState`。前提：`docs/governance/` は法律 p0.4.3 で保護パス（行政は書けない）なので、ディレクトリの敵対的な同時の差し替えまでは扱わない（この前提を `kernel-state.ts` の先頭のコメントに1行書く）。どの段階の失敗も `null`（例外の本文は使わない）。`governance.ts` の `isRealDir`・`readRegularFile` は export されていないので**写す**（`governance.ts` は変えない）
- A4. `GET /api/governance/kernel` を新設する。引数を取らず、`try` の中で `await connection()` の後に 200 `{ state: s === null ? null : toWire(s) }`（`s = loadKernelState()`。`state` は `null` でありうる。`Map` をそのまま返さない）。例外は 500 `{ error: "kernel_unavailable" }`（例外の本文を応答に入れない）。**Route Segment Config（`export const dynamic = …` 等）は書かない**（`cacheComponents` が有効なため。既存の `api/governance/route.ts` と同じ形）
- A5. `src/components/KernelPanel.tsx`（クライアント部品。外側は `<section aria-label="Kernel">`、折りたたまない）は、**マウントごとに1回** `fetch("/api/governance/kernel", { cache: "no-store", signal })` で取る（ポーリングしない。再読み込みのボタンは置かない。開発時の StrictMode による中断と再実行は許す。unmount で `AbortController` の `abort()`。**`signal.aborted` のときは state を更新しない**＝`AbortError` を失敗として出さない）。表示する状態は**取得した時点の写し**で、停止の後の状態を見るにはページを読み込み直す。ただし `stale` だけは `setInterval`（60,000 ミリ秒。unmount で `clearInterval`）で `now` を進めて計算し直す。分岐は次の3つに固定する（Codex の点検 #3）：(a) 2xx で `state === null` → 区画の中に「Kernel の状態の書き出しがありません（裁判所が稼働していないか、この環境では公開していません）」の1行だけ (b) 2xx でない・通信の失敗・`state` が非 null で **`pickKernelState` の検証**（`@/lib/kernel-state-schema` を実行時に import。`@/lib/kernel-state` は import しない）に落ちる → 「Kernel の状態を読めませんでした」の1行だけ (c) 検証に通った → 下の 1〜8。そうでなければ `summarizeKernel(state, new Date())` の結果で次を出す（日時はすべて `formatJst`）：
  1. **書き出し日時**：「書き出し：<formatJst(generated_at)>」。`stale` が true なら横に「古い写しです（10分を超えて更新がありません）」（amber）
  2. **稼働／停止中**：`stopped.active` が false なら「稼働中」（emerald）、true なら「停止中（<formatJst(since)> から）」（red）。区画の中で最も大きい文字（`text-2xl` 以上）。`judiciary.status` が `ok` でなければ、その横に「司法の道具が使えません（<kind の日本語：preflight_failed＝起動時の点検で不足、judiciary_unavailable＝呼び出しの失敗>）」（amber）
  3. 法律の版：「Kernel <kernel_version>・フック <policy_version>」
  4. **成立条件①〜⑤の表**（`docs/kernel.md` §3 の表を生きた数字で）。行は固定の5行、列は「成立条件・どう強制しているか（固定の文）・いまの数字」。固定の文はこの5つ（この文のまま）：①役割分離＝「フック・権限・sandbox・別プロセスで、役割ごとにできる操作を分ける」②仕様の統治＝「受け入れ条件の指紋をオーナーが承認する。裁判所は司法の前に照合する」③独立司法＝「司法は差分と受け入れ条件だけを見る。ツールを持たない。2つの系統で判定する」④Kernel による強制＝「main に入れるのは裁判所と朝の承認だけ。未承認・不合格・保護パス・停止中は入らない」⑤証跡＝「判定ごとの記録とハッシュチェーン、チェックポイント」。いまの数字：①役割分離＝`conformance` があれば「適合性テスト <passed>/<total>（<impl>、<formatJst(at)>）」、なければ「未記録」②仕様の統治＝「承認済み <approvedCurrent> 票」③独立司法＝「判定 <verdictRows.length> 件、不一致 <disagreements.tasks.length> 件」④Kernel による強制＝「held <heldCount> 件、裁定 <rulingCount> 件、取り消し <annulments.count> 件」⑤証跡＝「記録 <evidence.records> 件、ハッシュチェーン <chain_ok が true なら 改ざんなし、false なら 不整合、null なら 未確認>、チェックポイントの食い違い <checkpoint_mismatches> 件（null なら —）、最後のチェックポイント <formatJst(checkpoint_at)>」。食い違いが1件以上なら、その行の下に小さく「食い違いは裁判所の記録の取り方の競合でも生じる（OBS-055。p0.4.3 で修正）。改ざんかどうかはオーナーが verify-chain で確かめる」
  5. 承認済みの仕様の一覧：`approvalsSorted` を、票・承認日時（`formatJst(approved_at)`。`null` は「—」）・`current` が false なら「仕様が変わった（承認し直しが要る）」のバッジ
  6. held・裁定・取り消し：`held` の票と `since`、`rulings.tasks`、`annulments.count`
  7. 判定の一覧：`verdictRows` を表に（judge・Codex・security の3列。`null` は「—」。`disagreed` の行は amber）
  8. 注意の1行（常に表示）：「生のログは公開していない。ここにあるのは裁判所が書き出した件数と結論だけ」
  **日時の整形**はすべて `formatJst`（JST に固定、表記は**現行の** `formatMdHm` の出力のまま。`Date` にできない文字列と `null` は「—」。生の文字列は出さない）。`kernel_version`・`policy_version`・`conformance.impl`・`conformance.kernel_version` が `null` なら「—」
- A6. `src/components/GovernanceView.tsx` の見出し（`<header>`）の直後、「統治の数字」の `<section>` の前に `<KernelPanel />` を1つ差し込む。それ以外（既存の区画・文・API の呼び出し）は変えない。`KernelPanel` は自分で fetch するので、`GovernanceView` の `data` には触れない。**従属の明記**：`GovernanceView` は `/api/governance` の失敗・読み込み中に早期 return するので、その間は Kernel の区画も出ない（受け入れる。早期 return の前に置く案は構造の変更が増えるため §8 で問う）
- A7. `KernelPanel` が実行時に import してよい `@/lib` は `kernel-state-schema` だけ（`time` は `kernel-state-schema.ts` の中から `toJstIso`・`formatMdHm` に限って使う）。`@/lib/kernel-state`（`node:fs`）は import しない。文字列をキーにする辞書は `Map` で持つ。`dangerouslySetInnerHTML`・`console`・`localStorage` を使わない。表示する文字列は React の文字列としてだけ描画する。**`src/lib/kernel-state.ts`・`kernel-state-schema.ts` を import するのは、この票の新設ファイルと `KernelPanel` だけ**（ほかのモジュールが状態を読んで判断に使う経路を作らない）
- A8. `src/lib/kernel-state.test.ts` に、下の①〜⑪を**それぞれ1件以上の `it(`**で試す（`loadKernelState` は一時ディレクトリの `root` で）：①正しい JSON が通り、各項目が入る ②未知の項目が1つあると `null`（strict）③`by_task` に `constructor`・`__proto__`・`T-1`・`T-draft-x` の鍵があると捨てられ、`T-015` は残る。確かめ方は**エントリーの検査**に固定する：結果が `instanceof Map`、`map.has("constructor")`・`map.has("__proto__")` が false、`map.has("T-015")` が true（`__proto__` の入力は JSON の文字列から `JSON.parse` で作る）。`by_task` が無い・配列なら空の `Map` ④ファイルがないと `null`、ファイルがシンボリックリンクなら `null`、**`docs/governance` がディレクトリへのシンボリックリンクなら `null`** ⑤ちょうど 1,048,576 バイト（有効な JSON を末尾の空白で詰めて作る）は読み、1,048,577 バイトは `null` ⑥JSON でないと `null` ⑦`judiciary.status: "ok"` で `kind` が非 `null` なら `null`、`conformance.passed > total` なら `null`（refine）⑧`summarizeKernel`：`approvedCurrent` の数、`approvalsSorted` が降順で同時刻は `task` の昇順で **`approved_at: null` の行は末尾**、`verdictRows` が `task` の昇順で `disagreed` が付く、`generated_at` が 11 分前なら `stale` が true で 9 分前なら false、`Date` にできない `generated_at` は true ⑨`stopped.active: true` と `judiciary.status: "unavailable", kind: "judiciary_unavailable"` の値がそのまま入り、`judiciary.status: "down"` は `null`（Codex の点検 #1） ⑩`by_task` の値に `{ codex: "SKIPPED" }` を含む1件は落ち、ほかの値は残る ⑪`formatJst`：`+09:00` の文字列、`Z` の文字列（JST に変換される）、不正な文字列（「—」）、`null`（「—」）の4例 ⑫通信の往復：`by_task` に2件ある正しい state を `pickKernelState` → `toWire` → `JSON.stringify` → `JSON.parse` → `pickKernelState` にかけても、`by_task` の2件が残る（`GET /api/governance/kernel` の route を一時ディレクトリの `root` で呼ぶ試験でもよい）⑬`summarizeKernel` の `stale`：ちょうど 600,000 ミリ秒前は false、600,001 ミリ秒前は true
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

- 06:24 W18 が着手（worktree `agent-a13d89d1cd0b8a9d7`）。仕様はオーナーが 06:19 に approve-spec で承認済み（Kernel の写しの `approvals[].current` と、オーナーの着手の指示で確かめた）。T-023 と並行（触るファイルは重ならない）
- W18 の報告：HEAD `ce610871d4b774fb89a9b2a82a6400a740c4f32c`。test 292 件（23 ファイル）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:602` で差分の外）。**画面と API は動かしていない**（ブラウザーの表示、`GET /api/governance/kernel` の実呼び出し、`npm run build` は未確認。§3 で統合の後に確かめる）
- 本番の `kernel-state.json` は `pickKernelState` に通していない（`node` で読むコマンドはフックが拒否）。W18 が先頭と末尾を目で A1 と突き合わせ、抜粋を書き写した試験が通った。統合の後に `/governance` が (c) の表示になるかで確かめる
- 補った解釈・逸脱：(1) `now` を state で持つ（A5 の `summarizeKernel(state, new Date())` の形と違う。取得の後と 60 秒ごとに更新）(2) 読み込み中は文を出さず空の `<section aria-busy>` (3) **`conformance.kernel_version` は画面に出していない**（A5 の末尾に「null なら —」とあるが、1〜8 に出し場所がない）(4) h2「Kernel」と一覧の小見出し、判定の表の列「票」を足し、空の一覧は「—」(5) 食い違いの注記は⑤の数字のセルの下側 (6) `checkpoint_mismatches` が null なら「件」を付けない (7) A8 の外に試験を数件足した。試験の先頭のコメントは「値はすべて架空」だが、本番の形を書き写した試験には実在の票 ID と時刻が入る（件数と結論だけ）
- 拒否された操作：W18 の Bash 3件をフックが拒否した（本番の写しを `node -e` で読む、`git -C`、worktree の絶対パスを変数に入れる）。W18 は回避せず、`files_allowed` の中の試験に置き換えた
- 06:31 行政の長が差分を確認（`files_allowed` の6つだけ、追加 970・削除 0、`GovernanceView.tsx` は import 1行と差し込みだけ。`kernel-state` を参照するのは新設の5ファイルだけ。禁止語と秘密情報の形なし。A1〜A9 と読み合わせ、固定の文は §2 と一致。行政の長は試験と画面を自分では動かしていない）。`status: review` で main にコミットし申請

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

## 7b. 立法補佐の仕上げ（04:3x）

- A1 の形を、法律 p0.4.3 の実装 `vgdd/scripts/kernel-state.mjs`（ブランチ `law/p0.4.3`）の出力と一字ずつ合わせた：`kernel_version`・`policy_version`・`held[].since`・`evidence.chain_ok` は null 可、`evidence.checkpoint_mismatches` を追加（本番の記録で 01:18:23 のチェックポイントの食い違い1件が出るため。原因は裁判所の競合 OBS-055）、`conformance` は `impl`（repo／z3）と `kernel_version` を持つ、`judiciary.status` は ok／unavailable の2つ、票の ID は3〜4桁
- 書き出しは周回ごとに必ず書き直す（`generated_at` が生存の合図）。A2 の `stale`（10 分）はこれを前提にする。時刻は `+09:00` の形にそろえて出す（`+0900` は出さない）
- 本番の記録で試しに書き出した値（04:11）：法律 p0.4.2・フック p0.4.0・稼働中・承認 12 票すべて有効・held 0・裁定 2（T-017・T-019）・取り消し 16・判定 114 件（22 票）・不一致 13 件（7 票）・証拠 4825 件

## 7c. Codex の点検（04:5x、立法補佐が sandbox の外で実行）

指摘 13 件（critical 2・major 7・minor 4）。対応：#1 A8⑨ を unavailable に、down は null／#2 `toWire` と通信の往復の試験⑫（`Map` が JSON で消える）／#3 A5 の分岐を (a)(b)(c) に固定、注意の1行は (c) だけ／#4 件数の出どころを列挙／#5 強制の固定の文を §2 に転記、`<section aria-label="Kernel">` を A5 に／#6 書き出し側（法律 p0.4.3）に配列 500・件数 100 万・`passed ≤ total` の範囲を入れた／#7 写しは取得時点のもの、`stale` だけ 60 秒ごとに計算し直す、境界は 600,000 ミリ秒（⑬）／#8 `O_NONBLOCK`、最大 1,048,577 バイトだけ読む、`docs/governance/` は保護パスという前提をコメントに／#9 監査の結果は司法の入力（SPEC §6-1）なので変えない／#10 日時は現行の `formatMdHm`、null の版は「—」／#11 マウントごとに1回、StrictMode を許す／#12 Map の試験はエントリーの検査に／#13 見積もり 3 時間・180 分、`security_review: true`。**Codex の点検済み**（Claude の点検 2 回と合わせて 3 回）

## 8. オーナーに聞くこと

1. 置き方は①（`/governance` の先頭に区画）でよいか
2. `kernel-state.json` の形は改正案 p0.4.3 §1 の表に依る。**立法補佐への申し送り（この票の A1 と一致させる）**：`tickets` は出さない（MUST NOT）、`judiciary.since`・`evidence.checkpoint_at`・`evidence.last_record_at`・`approvals[].approved_at` は `string | null`、`verdicts.by_task` の `SKIPPED` は `null` に写す。起草で項目が変われば A1 を合わせ、票を差し替える
3. `_board.json` を release の後に作り直す直し（法律の変更）を p0.4.3 に含めるか
4. 「古い写し」の閾値 10 分は、裁判所の周回の間隔（既定）に合わせて決める。間隔が違えば変える
5. Kernel の区画が `/api/governance` の成功に従属する点（A6）を受け入れるか、早期 return の前に置く構造の変更をするか

- 2026-11-06T06:36:35+0900 gate-runner: status → review（判定に合格（judge=APPROVED codex=APPROVED）。夜間のため統合せず、朝のオーナーの承認を待つ）

- 2026-11-06T06:47:55+0900 release: status → merged（main=f0e342b94be7。夜間の判定に合格した候補 ad7c2f4f83f8 を、オーナーが朝に承認して統合）
