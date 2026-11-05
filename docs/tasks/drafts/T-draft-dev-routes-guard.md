---
id: T-draft-dev-routes-guard
title: 開発用ルート（seed・capture-fixtures）の門を capture-extras と同じにし、整理の fixture の採取を合成データだけにする（別サイトからの seed --reset と、今の DB のメモの外部送信を塞ぐ）
status: draft
requirements: [A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [約束6（漏えい防止）, M7-1, M4-4, D-56①]   # 記録用。司法には渡さない
proposal_from: 2026-11-06 02:5x アプリの安全の点検（docs/drafts/review-security.md の #3・#5・#9）。開発サーバーを立てている間に別サイトのページから no-cors の POST で開発 DB が消える経路と、整理の fixture の採取が今の開発 DB のメモを実 API に送る経路
estimate_h: 0.6
time_limit_min: 45
security_review: true          # 開発用ルートと外部 API の呼び出し
unattended:
branch: null
worker: null
files_allowed:
  - src/lib/ai/capture.ts                        # DB をメモリの seed に
  - src/lib/ai/capture.test.ts                   # 新設（なければ）
  - src/app/api/dev/seed/route.ts
  - src/app/api/dev/capture-fixtures/route.ts
  - src/app/api/dev/seed/route.test.ts           # 既存の試験の期待値（404・development）はそのまま。Origin・415 の試験を足す
files_forbidden:
  - src/lib/ai/capture-extras.ts                 # checkCaptureRequest は import して使うだけ
  - src/app/api/dev/capture-extras/route.ts
  - src/lib/seed.ts
  - src/lib/db.ts
  - src/lib/demo-fixtures/**
  - src/components/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-020]
---

## 1. 目的

開発用のルート3本のうち、T-020 の `POST /api/dev/capture-extras` だけが `checkCaptureRequest`（404 → 403 `Origin` → 415 → 400）で守られ、`POST /api/dev/seed` と `POST /api/dev/capture-fixtures` は `NODE_ENV` の判定だけ。開発サーバーを立てている間（デモの録画中を含む）に、別のサイトのページから `fetch("http://localhost:3000/api/dev/seed", { method: "POST", mode: "no-cors", body: '{"reset":true}' })` で開発 DB のデモ用の表が消え、`capture-fixtures` は実 API の課金を起こせる。また `captureFixtures` は**今の開発 DB**の新人A の最新の終了済みの作業のメモを実 API に送り、出力をリポジトリの `demo-fixtures/` に保存する。オーナーが同じ作業名で実際のメモを付けた後に採取すると、合成でないメモが外部に送られ、要約が公開リポジトリに残りうる。3本の門を同じにし、採取の材料をメモリの DB に入れた seed だけにする。審査：深さと実行20、インパクト30（プライバシー）。

## 2. 受け入れ条件

- A1. `src/app/api/dev/seed/route.ts`：404・403・415 の判定を `@/lib/ai/capture-extras` の `checkCaptureRequest` で行う。**渡す `body` は常に `{}`**（この関数は 404・403・415 の判定にだけ使う。`{}` なら 400 にならない）：`checkCaptureRequest({ nodeEnv: process.env.NODE_ENV, origin: req.headers.get("origin"), contentType: req.headers.get("content-type"), body: {} })`。落ちたら `{ error }` をその `status` で返す。通ったら、このルート独自の body を `JSON.parse(await req.text())`（読めなければ `undefined`）で読み、zod の **strict** `z.object({ reset: z.boolean().optional() })` で検証し、合わなければ 400 `{ error: "invalid_body" }`。判定の順：404 `not_found` → 403 `forbidden_origin` → 415 `unsupported_media_type` → 400 `invalid_body`。通れば今までどおり `seedDemo(undefined, { reset: parsed.reset === true })`。**例外は 500 `{ ok: false, error: "seed_failed" }`**（例外の本文を応答に入れない。今の 409 と `e.message` を変える）。`POST(req?: Request)` の省略の分岐は消し、`req: Request` を必須にする。既存の試験 `src/app/api/dev/seed/route.test.ts` の2件の `it(` は、`POST()` を引数なしで呼んでいる箇所を **毎回新しく作る** `new Request("http://localhost/api/dev/seed", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })` を渡す形に変える（`Request` の body は一度しか読めない）。`expect(` の値（404・`{ error: "not_found" }`・200・`inserted` の true → false）は変えない
- A2. `src/app/api/dev/capture-fixtures/route.ts`：A1 と同じく `checkCaptureRequest(..., body: {})` で 404・403・415 を判定し、通ったら body を読んで `src/lib/ai/capture.ts` から export する **`CaptureFixturesBodySchema`**（`z.object({ tasks: z.array(z.string().min(1).max(200)).max(10).optional(), partial: z.boolean().optional() }).strict()`）で検証、合わなければ 400 `invalid_body`。`tasks` が省略か**空の配列**なら既定の3作業（`DEMO_TASKS`。今の振る舞いと同じ）。判定の順：404 → 403 → 415 → 400 → 503 `no_api_key`（`{ error: "no_api_key" }` だけ。`message` は付けない。案内は README）→ 採取。例外は 500 `{ ok: false, error: "capture_failed" }`
- A3. `src/lib/ai/capture.ts` の `captureFixtures(taskNames, opts, db?)`：署名は変えず、**`db` が省略されたときは関数の中で `openDb(":memory:")` を開いて `seedDemo(db)` を入れ、`try/finally` で閉じる**（渡された `db` は閉じない。`capture-extras.ts` の `captureDemoExtras` L207-225 と同じ形）。`getDb` の import が不要になれば消す（lint の未使用）。`@/lib/db` の `openDb`、`@/lib/seed` の `seedDemo` を使う。関数の名前・ほかの引数・返り値の形は変えない。`latestEndedSession` の SQL は変えない（メモリの DB に seed の新人A の W1〜W3 がある）。`CaptureFixturesBodySchema` をこのファイルに export する（A2）
- A4. 3本の開発用ルートの**失敗の応答に例外の本文を入れない**（`e.message`・`String(e)` を使わない）。`console` に本文を出さない
- A5. 試験：`src/app/api/dev/seed/route.test.ts` の既存の2件は A1 のとおり要求の形だけを変えて残し、次を足す：①`Origin: http://localhost:3000` のある要求は 403 `forbidden_origin`。**その後に正しい要求を送ると `inserted` が true**（403 のときは入っていなかった）②`Content-Type` が `text/plain` は 415 ③`{ reset: "yes" }` と `{ reset: true, x: 1 }` は 400 ④`Content-Type: application/json` で `{ reset: true }` は今までどおり入れ直す。`src/lib/ai/capture.test.ts`（新設）に：⑤`captureFixtures` を `db` を渡さずに mock provider で呼ぶと、provider が受け取る `notes` が seed の新人A の W1 のメモ（本文が `DEMO_TASKS` の W1 のメモと一致）で、**試験の前に `getDb()` の側に足したメモの本文が入らない**。この試験は **`globalThis.__tsubuyakiDb` を試験の中だけ `openDb(":memory:")` に差し替え、`afterEach` で戻す**（`capture-extras.test.ts` ⑪と同じ方法。`data/` の DB に触らない）。**`opts.dir` には必ず一時ディレクトリを渡す**（`src/lib/demo-fixtures/` に書かない）⑥`CaptureFixturesBodySchema`：201 文字の要素・11 件・文字列でない要素・未知の項目は不合格、`{}`・`{ tasks: [] }`・`{ tasks: ["x"], partial: true }` は合格
- A6. `npm run -s test`（既存の試験と追加分のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは `files_allowed` の最大5つで、**`src/lib/demo-fixtures/**` に差分がない**（試験の副作用の確認）。`scripts/seed.mjs`・`scripts/demo-capture.mjs` は変えない（どちらも `content-type: application/json` だけを送り、Node の `fetch` は `Origin` を付けない。作業員が読んで確かめ、報告に書く。違っていれば止まって報告）

## 3. 開発用テスト

- A5 の観点。統合の後に、オーナーが `npm run seed -- --reset` と `npm run demo:capture` が今までどおり動くことを確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. `checkCaptureRequest` の 400（`kind` の strict）はこのルートの body の形と合わないので、`body: {}` を渡して 404・403・415 だけを使う。将来、404・403・415 だけを返す関数に分けるのは別の票
3. **安全の根拠**（点検で確認）：ブラウザーは GET・HEAD 以外のメソッドでは `mode: "no-cors"` でも `Origin` を付け（隠されても文字列 `"null"` になり `!== null` で 403）、`<form>` の POST も `Origin` あり。`Content-Type` の判定が二重の門（no-cors の fetch と form は `application/json` を送れない）。通るのは同じマシンのシェルからの curl・Node だけで、オーナーと同じ信頼の層。アプリの画面から `/api/dev/*` を呼ぶ箇所はない
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ **Codex security**（観点：別サイトからの要求が止まるか、今の DB のメモが外部に送られないか、例外の本文、入力の上限）。T-020 の統合の後（済み）。**11/7 の機能凍結の前に通す**（機能ではなく修正）。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（4:00 から立法補佐が行う）。点検役：Claude のサブエージェント（読み取り専用。票と実装を突き合わせた）。03:0x、指摘 8 件（高 3・中 3・低 2）。対応：#1 `checkCaptureRequest` には常に `body: {}` を渡し、ルート独自の body は別に読むと一文に（A1・A2）／#2 試験は `opts.dir` に一時ディレクトリ、差分に `demo-fixtures/**` の変更がないことを A6 に／#3 `globalThis` の差し替えを必須に、`afterEach` で戻す（A5⑤）／#4 スキーマを `capture.ts` に `CaptureFixturesBodySchema` として export、`tasks: []` は既定の3作業（A2・A5⑥）／#5 `db` 省略時は関数の中で開いて `finally` で閉じる、署名は不変（A3）／#6 既存の試験の要求の形を具体に（A1）／#7 ①の確かめ方を「403 の後の正しい要求で `inserted` が true」に／#8 `message` を外す理由（案内は README）。安全の根拠を §4 の 3 に

## 8. オーナーに聞くこと

1. 機能凍結の前に通すことを認めるか（修正だが新しい振る舞い＝Origin で 403 が入る）
2. `captureFixtures` の材料をメモリの seed だけにすると、「実際のメモで fixture を採る」ことはできなくなる（元から合成データだけが前提）。これでよいか
