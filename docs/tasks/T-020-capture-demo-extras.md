---
id: T-020
title: デモ用の保存済みの AI 出力（手順書の原案・AI の検出）を実 API で採取する仕組み（M4-4・M8-2 の拡張）
status: review
requirements: [A1, A2, A3, A4, A5, A6, A7]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M4-4, M8-2, M5-1, M6-2, D-62]   # 記録用。司法には渡さない
proposal_from: 開発スケジュール 段階1（デモの筋書き W1 で、API キーのない審査員にも原案と AI の候補を見せる）。2026-11-06 立法補佐が起草（オーナーの承認前）
estimate_h: 0.7
time_limit_min: 50
security_review: true          # 外部 API を呼ぶ開発用のルート
unattended: true
branch: worktree-agent-a8d585142e02f121c   # 差し戻し対応の作業員のブランチ（29cc506 を cherry-pick）。統合キュー（p0.3.1）により main から分岐したまま申請
worker: W17
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
- A7. ルートの要求の判定（A4 の判定の順のうち、API キーの確認より前の 404・403・415・400）は、`capture-extras.ts` の純粋な関数 `checkCaptureRequest(input: { nodeEnv: string | undefined; origin: string | null; contentType: string | null; body: unknown }): { ok: true; kind: "procedure" | "sensitive" | "all" } | { ok: false; status: 404 | 403 | 415 | 400; error: "not_found" | "forbidden_origin" | "unsupported_media_type" | "invalid_body" }` にして export し、ルートはこれを呼ぶ（`body` は JSON として読んだ値。読めなければ `undefined` を渡す）。採取の本体（メモリの DB に seed して材料にする）は `captureDemoExtras(kind: "procedure" | "sensitive" | "all", opts: { procedureProvider?: ProcedureProvider; sensitiveProvider?: SensitiveProvider; dir?: string } = {}): Promise<{ ok: boolean; results: ExtraCaptureResult[] }>`（メモリの DB を作って seed し、A4 の `ok` の規則で返す）として export し、ルートは `checkCaptureRequest` と API キーの確認に通ったときだけこれを呼ぶ。試験は `checkCaptureRequest`（⑫）と `captureDemoExtras`（⑪）で行う（2026-11-06 01:3x 立法補佐が明確化：前の文は Origin の拒否を `captureDemoExtras` で試すように読め、試せない条件だった。セキュリティ審査の差し戻し）
- A6. `src/lib/ai/capture-extras.test.ts` に、下の①〜⑫を**それぞれ1件以上の `it(`**で試す（provider は mock、`dir` は試験の一時ディレクトリ、DB は `openDb(":memory:")` と `seedDemo`）：①共有が1件なら provider を呼ばずに ng ②正しい出力で fixture ができ、`DemoProcedureProvider(dir)` で同じ材料から `generateProcedure` が成功する（往復） ③2回とも壊れた出力ならファイルができない ④AI の検出の fixture ができ、`DemoSensitiveProvider(dir)` で `checkSensitiveWithAi` が成功する（往復） ⑤2001文字の本文は provider を呼ばずに ng ⑥`demoSensitiveTexts` が seed の後に1件で、`buildShareDraft` の本文と同じ ⑦mock が受け取った入力に、メモの本文（`notes` の表の本文）が入らない ⑧共有が21件なら provider を呼ばずに ng ⑨`captureSensitiveFixtures([])` が「採取する本文がない」の ng を1件返す ⑩空白だけの本文と、2回とも壊れた出力の本文は ng でファイルができない ⑪`captureDemoExtras("all", …)` が、試験の中で別に作った DB（`getDb()` の側）に足した共有を材料にしない（mock の受け取った `sources` が seed の2件だけ） ⑫`checkCaptureRequest`：`nodeEnv` が `development` でなければ 404 `not_found`、`origin` があれば（`http://localhost:3000` でも）403 `forbidden_origin`、`contentType` が `application/json` で始まらなければ 415、`body` が `undefined`・`null`・配列・文字列・未知の項目つき・`kind` が3つ以外なら 400 `invalid_body`、`{}` なら `kind: "all"`、判定の順は 404 → 403 → 415 → 400。あわせて `npm run -s test`（既存の試験と追加分のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは次の4つだけ：`src/lib/ai/capture-extras.ts`（新設）、`src/lib/ai/capture-extras.test.ts`（新設）、`src/app/api/dev/capture-extras/route.ts`（新設）、`scripts/demo-capture.mjs`

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
- 01:17 行政の長が W14 を起動（worktree `agent-a1db65563f70a6a0c`）。仕様はオーナーが 01:11 に approve-spec で承認済み（立法補佐の伝達）。T-021 と並行（触るファイルは重ならない）
- 01:22 W14 の報告：コミット d303121（4ファイル、+571。所要約5分）。A1〜A7 達成。試験は①〜⑪をそれぞれ1件以上、やり直しの回し方と ok の規則も試験（追加16件、test 261）・typecheck・lint 合格。票の解釈：既定の Claude provider は呼ぶ直前に作る（材料不足や片方の種別だけのときに使わない側がキーを求めて例外を出さないため）、⑪は `globalThis.__tsubuyakiDb` を試験の中だけメモリの DB に差し替え（後で戻す）、`Content-Type` は小文字にして比較。ルート（A4 の HTTP の判定）は試験なし（A7 のとおり関数で試験）。`procedureFixturePath` には作業名をそのまま渡す（票のとおり。`normalizeTaskName` で形が変わる作業名では名前が合わないが `DEMO_TASK_W1` は同じ形で往復の試験も合格）。拒否なし
- 01:22 行政の長が差分を確認し、503 の応答に票にない `message` が付いていたので取り除くよう W14 に依頼（A4 は `{ error: "no_api_key" }` だけ）。01:23 W14 が同じ1コミットに amend（HEAD 29cc506、4ファイル +569。test 261・typecheck・lint 合格）。行政の長が再確認（`files_allowed` の4ファイルのみ、A4 の判定の順 404→403 Origin→415→400→400 strict→503、ルートと lib に `console` なし、材料は `captureDemoExtras` のメモリ DB、例外は `capture_failed` のみ）。`status: review` で main にコミットし申請（security_review: true）

- 2026-11-06T01:31:49+0900 gate-runner: status → in_progress（セキュリティ審査が差し戻し）
- 01:36 立法補佐からの伝達（オーナー経由）：Codex security の指摘は A7（`Origin` の拒否の試験がない）。原因は票の A7 の書き方（`captureDemoExtras` で試すように読め、試せない形）。立法補佐が A7 と A6 の⑫を明確化して main に固定（2e823d3）、オーナーが承認し直し済み。直し方：ルートの要求の判定を純粋な関数 `checkCaptureRequest` に分けてルートから呼び、試験⑫を足す
- 01:37 行政の長が W17 を起動（worktree `agent-a8d585142e02f121c`）。29cc506 を cherry-pick し、`checkCaptureRequest` への分離と⑫の試験を足して1コミットに amend する指示。W14 の worktree `agent-a1db6556…` は触らない
- 01:40 W17 の報告：コミット c8ebe6a（1つに amend。main との差は4ファイル +683。29cc506 との差は `capture-extras.ts` +39、`route.ts` +11/−18、試験 +82、`demo-capture.mjs` は不変）。`checkCaptureRequest`（404→403→415→400、zod の strict はこの関数に移動、`Content-Type` は小文字で比較、空文字の Origin も 403）を export し、ルートは本文を JSON で読んで（読めなければ `undefined`）この関数 → `hasApiKey`（503）→ `captureDemoExtras(check.kind)` の順。⑫の `it(` 7件（404 の3入力、403 の3入力、415 の5入力、大文字・charset つきは通る、400 の13入力、`{}` と3種類の kind、判定の順）。test 268・typecheck・lint 合格。拒否1件：`sed` にパスを変数で渡したコマンドが worktree の分離の確認で拒否（回避せずパスを書き出して実行）。逸脱：本番でも本文を一度読んでから 404 を返す（A7 が関数に `body` を渡す形のため。本文は使わず応答にも出さない）
- 01:41 行政の長が差分を確認（`files_allowed` の4ファイルのみ、ルートの全文と `checkCaptureRequest` の判定の順、⑫の試験の一覧を読んだ。`console` なし、応答の形は A4 のまま）。`status: review` で main にコミットし再申請（差し戻し1回目。security_review: true）
