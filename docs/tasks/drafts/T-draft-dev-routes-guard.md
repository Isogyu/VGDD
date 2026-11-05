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

- A1. `src/app/api/dev/seed/route.ts`：要求の判定を `@/lib/ai/capture-extras` の `checkCaptureRequest` で行う。渡すのは `{ nodeEnv: process.env.NODE_ENV, origin: req.headers.get("origin"), contentType: req.headers.get("content-type"), body }`（`body` は `JSON.parse(await req.text())`、読めなければ `undefined`）。ただし **body の形はこのルート独自**なので、`checkCaptureRequest` の 400（zod の strict の `kind`）に当たる前に、**404・403・415 の3つだけ**をこの関数の結果から使い、400 はこのルートで `{ reset?: boolean }` を zod の strict で検証する（`checkCaptureRequest` を「404・403・415 の判定だけ」に使うため、`body` には `{}` を渡す）。判定の順：404 `not_found` → 403 `forbidden_origin` → 415 `unsupported_media_type` → 400 `invalid_body`（オブジェクトでない・未知の項目・`reset` が boolean でない）。通れば今までどおり `seedDemo(undefined, { reset })`。**例外は 500 `{ ok: false, error: "seed_failed" }`**（例外の本文を応答に入れない。今の 409 と `e.message` を変える）。`req` が省略されたときの分岐（`POST(req?: Request)`）は消し、`req: Request` 必須にする（既存の試験が `POST()` を引数なしで呼んでいれば、その試験は `new Request(...)` を渡す形に変える。期待値は変えない）
- A2. `src/app/api/dev/capture-fixtures/route.ts`：同じく `checkCaptureRequest` で 404・403・415 を判定し、400 はこのルートで `{ tasks?: string[](要素は 1〜200 文字、最大 10 件); partial?: boolean }` を zod の strict で検証。判定の順：404 → 403 → 415 → 400 → 503 `no_api_key`（`{ error: "no_api_key" }` だけ。`message` は付けない）→ 採取。例外は 500 `{ ok: false, error: "capture_failed" }`
- A3. `src/lib/ai/capture.ts` の `captureFixtures(taskNames, opts, db)`：引数の `db` の既定を `getDb()` から**「`openDb(":memory:")` に `seedDemo` を入れた新しい DB」**に変える（`@/lib/db` の `openDb`、`@/lib/seed` の `seedDemo`。`capture-extras.ts` の `captureDemoExtras` と同じ形。試験からは `db` を渡せるので既定だけ変える）。関数の名前・ほかの引数・返り値の形は変えない。`latestEndedSession` の SQL は変えない（メモリの DB に seed の新人A の W1〜W3 がある）
- A4. 3本の開発用ルートの**失敗の応答に例外の本文を入れない**（`e.message`・`String(e)` を使わない）。`console` に本文を出さない
- A5. 試験：`src/app/api/dev/seed/route.test.ts` の既存の `it(`（404 と development で一時 DB に seed）は**期待値を変えずに残し**、次を足す：①`Origin: http://localhost:3000` のある要求は 403 `forbidden_origin` で `seedDemo` が呼ばれない（DB の件数が変わらない）②`Content-Type` が `text/plain` は 415 ③`{ reset: "yes" }` と `{ reset: true, x: 1 }` は 400 ④`Content-Type: application/json` で `{ reset: true }` は今までどおり入れ直す。`src/lib/ai/capture.test.ts`（なければ新設）に：⑤`captureFixtures` を `db` を渡さずに mock provider で呼ぶと、provider が受け取る `notes` が seed の新人A の W1 のメモ（本文が `DEMO_TASKS` の W1 のメモと一致）で、**試験の前に `getDb()` の側に足したメモの本文が入らない**（`globalThis` の DB を試験の中だけメモリの DB に差し替えてよい。T-020 の⑪と同じ方法）⑥`tasks` に 201 文字の要素、11 件、文字列でない要素は 400（ルートの判定は `checkCaptureRequest` の後に zod で。ルートの試験が書けなければ zod のスキーマを export して試す）
- A6. `npm run -s test`（既存の試験と追加分のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは `files_allowed` の最大5つ。`scripts/seed.mjs`・`scripts/demo-capture.mjs` は変えない（Node の `fetch` は `Origin` を付けず、`content-type: application/json` を送っていることを作業員が読んで確かめ、報告に書く。付けていなければ止まって報告）

## 3. 開発用テスト

- A5 の観点。統合の後に、オーナーが `npm run seed -- --reset` と `npm run demo:capture` が今までどおり動くことを確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. `checkCaptureRequest` の 400 はこのルートの body の形と合わないので、404・403・415 だけを使う（A1 のとおり `body: {}` を渡す）。将来、404・403・415 だけを返す関数に分けるのは別の票
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ **Codex security**（観点：別サイトからの要求が止まるか、今の DB のメモが外部に送られないか、例外の本文、入力の上限）。T-020 の統合の後（済み）。**11/7 の機能凍結の前に通す**（機能ではなく修正）。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（4:00 から立法補佐が行う）。（点検の後に追記。この票は点検前）

## 8. オーナーに聞くこと

1. 機能凍結の前に通すことを認めるか（修正だが新しい振る舞い＝Origin で 403 が入る）
2. `captureFixtures` の材料をメモリの seed だけにすると、「実際のメモで fixture を採る」ことはできなくなる（元から合成データだけが前提）。これでよいか
