---
id: T-020
title: デモ用の保存済みの AI 出力（手順書の原案・AI の検出）を実 API で採取する仕組み（M4-4・M8-2 の拡張）
status: ready
requirements: [A1, A2, A3, A4, A5, A6, A7]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M4-4, M8-2, M5-1, M6-2, D-62]   # 記録用。司法には渡さない
proposal_from: 開発スケジュール 段階1（デモの筋書き W1 で、API キーのない審査員にも原案と AI の候補を見せる）。2026-11-06 立法補佐が起草（オーナーの承認前）
estimate_h: 0.7
time_limit_min: 50
security_review: true          # 外部 API を呼ぶ開発用のルート
unattended: true
branch: null
worker: null
files_allowed:
  - src/lib/ai/capture-extras.ts               # 新設
  - src/lib/ai/capture-extras.test.ts          # 新設
  - src/app/api/dev/capture-extras/route.ts    # 新設
  - scripts/demo-capture.mjs                   # --extras を足すだけ
files_forbidden:
  - src/lib/ai/capture.ts
  - src/lib/ai/procedure-provider.ts
  - src/lib/ai/sensitive-provider.ts
  - src/lib/procedure.ts
  - src/lib/ai-sensitive.ts
  - src/lib/sharing.ts
  - src/lib/seed.ts
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
depends_on: []
---

## 1. 目的

API キーのない審査員の環境（デモモード）でも、W1 の手順書の原案（T-012）と、S-3 の「AI でも確かめる」（T-017・T-019）の結果を見せられるように、オーナーが API キーのある自分の環境で**1回だけ**実 API を呼んで、保存済みの出力（fixture）を作る仕組み。既存の `npm run demo:capture`（整理の fixture）と同じ考え方。送るのは合成データだけ。fixture のファイル自体はこの票では作らない（オーナーが採取して、人が中身を見てからコミットする）。審査：デモ25、深さと実行20。

## 2. 受け入れ条件

- A1. `src/lib/ai/capture-extras.ts` に `captureProcedureFixtures(taskNames: string[], opts: { provider?: ProcedureProvider; dir?: string } = {}, db = getDb()): Promise<ExtraCaptureResult[]>` を export する。`ExtraCaptureResult = { kind: "procedure" | "sensitive"; key: string; ok: boolean; path?: string; model?: string; attempts: number; errors?: string[] }`（`key` は procedure なら作業名、sensitive なら本文の先頭20文字）。各作業名について：
  - 材料は `listProcedureSources(taskName, db)`（`@/lib/procedure`）。2件未満なら provider を呼ばずに `ok: false`、`errors: ["承認済みの共有が2件未満"]`、`attempts: 0`。`PROCEDURE_MAX_SOURCES`（20）件を超えるか、`body` の `.length` の合計が `PROCEDURE_MAX_BODY_CHARS`（20000）を超えれば、provider を呼ばずに `ok: false`、`errors: ["材料が多すぎる"]`、`attempts: 0`（`generateProcedure` で再生できない fixture を作らない）
  - provider（既定は `new ClaudeProcedureProvider()`。`@/lib/ai/procedure-provider`）の `generate({ taskName, sources })` を呼び、`validateProcedure(raw, sources)` に通す。違反なら `previousErrors` に違反を入れてもう1回だけ（合計2回）。2回とも違反なら `ok: false`（`errors` は最後の違反）でファイルを書かない
  - 合格したら `ProcedureFixture`（`task_name`・`model`・`captured_at: nowJst()`・`sources_fingerprint: sourcesFingerprint(sources)`・`raw`）を `procedureFixturePath(taskName, opts.dir)` に、`JSON.stringify(fx, null, 2) + "\n"` で書く（ディレクトリがなければ作る）
- A2. `captureSensitiveFixtures(texts: string[], opts: { provider?: SensitiveProvider; dir?: string } = {}): Promise<ExtraCaptureResult[]>` を export する。各本文について：`known` は `detectSensitive(text)` の各要素の `{ start, end, type }`。provider（既定は `new ClaudeSensitiveProvider()`）の `check({ text, known })` を呼び、`validateAiFlags(raw, text, detectSensitive(text))` に通す。違反ならもう1回だけ（2回目は `previousErrors` つき）。合格したら `{ model, raw }` を `sensitiveFixturePath(text, opts.dir)` に `JSON.stringify(fx, null, 2) + "\n"` で書く（ディレクトリがなければ作る）。空白だけの本文は `errors: ["本文が空"]`、2000 文字を超える本文は `errors: ["本文が長すぎる"]` で、どちらも provider を呼ばずに `ok: false`・`attempts: 0`。2回とも違反なら `ok: false`・`attempts: 2`・`errors` は最後の違反。失敗のときはファイルを書かない。`texts` が空の配列なら、`[{ kind: "sensitive", key: "-", ok: false, attempts: 0, errors: ["採取する本文がない"] }]` を返す
- A3. `demoSensitiveTexts(db = getDb()): string[]` を export する。合成データの新人A の W1（`DEMO_TASK_W1`、`@/lib/seed`）の最新の終了済みの作業の最新の整理結果（`getLatestSummary`、`@/lib/summarize`）から `buildShareDraft`（`@/lib/sharing`）で作った本文を1つ返す（S-3 で新人A が開く最初の共有候補の本文と同じ）。作業か整理結果がない、または本文が `null` なら空の配列
- A4. `POST /api/dev/capture-extras` を新設する。判定の順：`process.env.NODE_ENV !== "development"` なら 404 `{ error: "not_found" }` → 要求に `Origin` ヘッダーがあれば 403 `{ error: "forbidden_origin" }`（ブラウザーの別のサイトから採取を起こさせない。`scripts/demo-capture.mjs` の Node の `fetch` は `Origin` を付けない）→ `Content-Type` が `application/json` で始まらなければ 415 `{ error: "unsupported_media_type" }` → body が JSON のオブジェクトでなければ（読めない・`null`・配列・文字列）400 `invalid_body` → zod の strict で `{ kind?: "procedure" | "sensitive" | "all" }`（省略は `all`。未知の項目・ほかの値は 400 `invalid_body`）→ `hasApiKey()`（`@/lib/ai`）が false なら 503 `{ error: "no_api_key" }`。400・403・404・415・503 では採取の関数を呼ばない。
  - **採取の材料は合成データだけ**：ルートは今の DB（`getDb()`）を使わず、`openDb(":memory:")` で新しいメモリの DB を作って `seedDemo(db)`（`@/lib/seed`）を入れ、その DB だけを `captureProcedureFixtures([DEMO_TASK_W1], {}, db)`・`demoSensitiveTexts(db)` に渡す（seed の後に足された本物のデータは送らない。合成データの承認日時と本文は固定なので、fixture の `sources_fingerprint` は審査員の環境で `npm run seed` した後の材料と一致する）
  - `procedure` は原案、`sensitive` は AI の検出、`all` は両方を採る。200 `{ ok, results }`。`ok` は、要求した種別のすべての結果が `ok` で、かつ要求した種別ごとに1件以上の結果があるときだけ true（`all` は原案と AI の検出の両方の成功が要る）。例外は 500 `{ ok: false, error: "capture_failed" }`（例外の本文を応答に入れない）。応答・`console` に共有の本文やメモの本文を出さない（`key` の先頭20文字を除く）
- A5. `scripts/demo-capture.mjs` に `--extras` を足す：指定すると `/api/dev/capture-fixtures` の代わりに `/api/dev/capture-extras` を `{ kind: "all" }` で呼び、結果を `OK  <kind> <key> → <path>（<model>、<attempts>回）`／`NG  <kind> <key>: <errors>` の1行ずつで表示する。`--extras` がないときの今の動きは変えない。先頭のコメントの「使い方」に `npm run demo:capture -- --extras` の1行を足す
- A7. ルートの判定（A4）のうち、`Origin` があると 403 で採取の関数を呼ばないこと、メモリの DB に seed した材料だけを使うことは、`capture-extras.ts` に `captureDemoExtras(kind: "procedure" | "sensitive" | "all", opts: { procedureProvider?: ProcedureProvider; sensitiveProvider?: SensitiveProvider; dir?: string } = {}): Promise<{ ok: boolean; results: ExtraCaptureResult[] }>`（メモリの DB を作って seed し、A4 の `ok` の規則で返す）を export してルートから呼び、試験はこの関数で行う
- A6. `src/lib/ai/capture-extras.test.ts` に、下の①〜⑪を**それぞれ1件以上の `it(`**で試す（provider は mock、`dir` は試験の一時ディレクトリ、DB は `openDb(":memory:")` と `seedDemo`）：①共有が1件なら provider を呼ばずに ng ②正しい出力で fixture ができ、`DemoProcedureProvider(dir)` で同じ材料から `generateProcedure` が成功する（往復） ③2回とも壊れた出力ならファイルができない ④AI の検出の fixture ができ、`DemoSensitiveProvider(dir)` で `checkSensitiveWithAi` が成功する（往復） ⑤2001文字の本文は provider を呼ばずに ng ⑥`demoSensitiveTexts` が seed の後に1件で、`buildShareDraft` の本文と同じ ⑦mock が受け取った入力に、メモの本文（`notes` の表の本文）が入らない ⑧共有が21件なら provider を呼ばずに ng ⑨`captureSensitiveFixtures([])` が「採取する本文がない」の ng を1件返す ⑩空白だけの本文と、2回とも壊れた出力の本文は ng でファイルができない ⑪`captureDemoExtras("all", …)` が、試験の中で別に作った DB（`getDb()` の側）に足した共有を材料にしない（mock の受け取った `sources` が seed の2件だけ）。あわせて `npm run -s test`（既存の試験と追加分のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは次の4つだけ：`src/lib/ai/capture-extras.ts`（新設）、`src/lib/ai/capture-extras.test.ts`（新設）、`src/app/api/dev/capture-extras/route.ts`（新設）、`scripts/demo-capture.mjs`

## 3. 開発用テスト

- `capture-extras.test.ts`：A6 の観点。Claude の API は呼ばない
- 既知の限界（この票の範囲外）：原案の fixture の `sources_fingerprint` は共有の `knowledge_id` を含む（T-012 の `sourcesFingerprint`）。メモリの DB の seed では `knowledge_id` は 1 と 2。`npm run seed -- --reset` で入れ直した DB は自動の番号が 1 から始まらないため一致せず、デモモードの原案は「保存済みの原案は、いまの共有と一致しません」になりうる。新しく clone した環境（審査員）では一致する。デモの録画の前に確かめ、必要なら指紋から `knowledge_id` を外す票を別に作る
- 採取そのものはオーナーの作業：`npm run dev` → `npm run seed -- --reset` → `npm run demo:capture -- --extras` → `src/lib/demo-fixtures/` の新しいファイルの中身を人が見てからコミット

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回（`npm install` は使わない）
2. 構成は `src/lib/ai/capture.ts` を見本に（やり直しの回し方、保存の形）
3. コミットは1つ。メッセージの先頭は `T-020: `

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ **Codex security**（観点：本番では動かないこと、合成データだけを送ること、本文を応答・ログに出さないこと、例外の本文）。要件は main にコミット済みのこの票の §2（A1〜A6）。T-019・T-021 と触るファイルが重ならない。

## 6. 記録

（統合後に追記）
