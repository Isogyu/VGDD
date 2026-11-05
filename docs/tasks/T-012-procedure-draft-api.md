---
id: T-012
title: 手順書の原案と判断のポイントの生成（承認済みの共有から。M5 の裏側）
status: ready
requirements: [A1, A2, A3, A4, A5, A6, A7, A8]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M5-1, M5-2, M5-3, M5-4, M9-3, M4-4, D-62]   # 記録用。司法には渡さない
proposal_from: 2026-11-05 オーナー「切り替える」（昼の進め方）。材料は承認済みの共有だけ（オーナーの選択 22:5x、D-62）
estimate_h: 1.0
time_limit_min: 60
security_review: true          # 新しい API ルートと外部 API の呼び出し
unattended: false
branch: null
worker: null
files_allowed:
  - src/lib/procedure.ts                 # 新設：材料の取得・プロンプト・検証・生成
  - src/lib/procedure.test.ts            # 新設
  - src/lib/ai/procedure-provider.ts     # 新設：Claude と demo の provider（既存の SummaryProvider とは別）
  - src/app/api/procedures/route.ts      # 新設
files_forbidden:
  - src/lib/ai/provider.ts
  - src/lib/ai/claude.ts
  - src/lib/ai/demo.ts
  - src/lib/ai/prompt.ts
  - src/lib/ai/index.ts
  - src/lib/ai/capture.ts
  - src/lib/demo-fixtures/**
  - src/lib/db/schema.sql
  - src/lib/sessions.ts
  - src/components/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/requirements.md
  - docs/tasks/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: []
---

## 1. 目的

同じ作業名で**本人が承認した共有（`shared_knowledge`。取り下げ済みを除く）が2件以上**あるとき、Claude にそれらだけを渡して、番号付きの手順書の原案と、「なぜそうするか」の判断のポイントを作る。各項目に、根拠になった共有（記録者・承認日時）を付ける。**原文のメモは使わない**（承認していない内容をチームの知恵に出さない。M9-3。オーナーの選択 D-62）。画面（S-4）は別の票。保存はしない（呼ぶたびに作る）。審査：インパクト30（暗黙知の引き継ぎ）、Claude の活用25。

## 2. 受け入れ条件

- A1. `src/lib/procedure.ts` に `ProcedureSource = { n: number; knowledge_id: number; display_name: string; role: "newcomer" | "senior"; approved_at: string; body: string }` と `listProcedureSources(taskName: string, db = getDb()): ProcedureSource[]` を export する。`shared_knowledge` を `users` と結び、`task_name` が `normalizeTaskName(taskName)`（`@/lib/commands`）と一致し `withdrawn_at IS NULL` の行を `approved_at` の昇順・`id` の昇順で全件返す。`n` は 1 から振る番号。**`notes` の表は読まない**（`procedure.ts`・`procedure-provider.ts`・ルートのどれも）
- A2. `src/lib/ai/procedure-provider.ts` に次を export する：
  - `ProcedureInput = { taskName: string; sources: ProcedureSource[]; previousErrors?: string[] }`、`ProcedureOutput = { raw: string; model: string }`、`ProcedureProvider = { readonly name: "claude" | "demo" | "mock"; generate(input: ProcedureInput): Promise<ProcedureOutput> }`
  - `ClaudeProcedureProvider`：`@anthropic-ai/sdk` で `messages.create`（モデルは `./claude` の `CLAUDE_MODEL`、`max_tokens` 2000、`system` は `PROCEDURE_SYSTEM_PROMPT`、`user` は `buildProcedurePrompt(input)`）。キーがなければ `ProviderUnavailableError`（`./provider`）
  - `DemoProcedureProvider`：`src/lib/demo-fixtures/procedure-<8桁の16進>.json`（ハッシュは `./demo` の `fixtureKey` と同じ計算を作業名に行い、接頭辞を `procedure-` にしたもの。`procedureFixturePath(taskName, dir?)` を export）を読み、`raw` と `model: "demo(<fixture の model>)"` を返す。fixture は `{ task_name, model, captured_at, sources_fingerprint, raw }` の形で、`sources_fingerprint` が `sourcesFingerprint(input.sources)`（export する。`sources` の `[knowledge_id, approved_at, body]` の配列を `JSON.stringify` した文字列の SHA-256 の16進。`node:crypto`）と一致しなければ、採取の後に共有が変わったとみなして `ProviderUnavailableError`（「保存済みの原案は、いまの共有と一致しません」）。ファイルがない・読めない・`sources_fingerprint` がなければ `ProviderUnavailableError`（「デモモードでは、この作業名の保存済みの手順書の原案がありません。ANTHROPIC_API_KEY を設定すると Claude で作れます」）
  - `getProcedureProvider(): ProcedureProvider`（`./provider` の `resolveProviderName()` が `claude` なら Claude、それ以外は demo）と、試験用の `setProcedureProviderOverride(p: ProcedureProvider | null)`
  - `PROCEDURE_SYSTEM_PROMPT`（日本語。守ること：JSON だけを返す／根拠は共有の番号だけで示し、共有にないことは evidence を空にする／事実を作らない／本人を評価する言葉を書かない／判断のポイントは「なぜそうするか」を、先輩（role が senior）の共有を優先して書く）と `buildProcedurePrompt(input): string`（作業名、共有を `#<n> [<display_name>・<先輩|新人>・<approved_at の日付と時刻>] <body>` の1行ずつ、出力の形、`previousErrors` があれば「前回の出力の問題」）を export する
- A3. 出力の形と検証：`validateProcedure(raw: unknown, sources: ProcedureSource[])` を `procedure.ts` に export する。`raw` が文字列なら、前後の説明文やコードフェンスを除いて JSON として読む（`@/lib/summary-schema` の `extractJson` を使ってよい）。zod の strict で `{ steps: { text: string(1〜300); evidence: int[](最大10) }[](1〜12件); decision_points: { text: string(1〜300); reason: string(1〜300); evidence: int[](最大10) }[](0〜8件) }`。evidence の番号が `1〜sources.length` の外なら違反。返り値は `{ ok: true; steps: ProcedureItem[]; decision_points: (ProcedureItem & { reason: string })[] } | { ok: false; errors: string[] }`。`ProcedureItem = { text: string; evidence: { knowledge_id: number; display_name: string; approved_at: string }[]; inferred: boolean }`（evidence が空なら `inferred: true`。同じ番号の重複は1つにする。`text`・`reason` は前後の空白を落とす）。`errors` は最大10件で、**出力の値そのものを含めない**：zod の違反は `<項目のパス>: <issue の code>`、番号の範囲外は `<項目のパス>: 番号 <n> は 1〜<sources.length> の外`、JSON として読めなければ `出力が JSON として解釈できない`。完成した形は `Procedure = { schema: "tsubuyaki.procedure.v1"; task_name: string; steps; decision_points; source_ids: number[] }` で、A4 が組み立てる（`task_name` は `normalizeTaskName(taskName)`、`source_ids` は材料にした全部の共有の `knowledge_id` を `n` の順に）
- A4. `generateProcedure(taskName: string, opts: { provider?: ProcedureProvider } = {}, db = getDb())` を export する。返り値は `{ ok: true; procedure: Procedure; model: string; attempts: number } | { ok: false; reason: "insufficient_records" | "too_large" | "provider_unavailable" | "schema_violation" | "sources_changed"; message: string; count?: number; errors?: string[]; attempts: number }`。
  - 材料は**最初に1回** `listProcedureSources` で取った一覧（スナップショット）。2件未満なら provider を呼ばずに `insufficient_records`（`count` に件数、`message` は「記録が不足しています（承認済みの共有が2件以上必要です。いまは N 件）」、`attempts: 0`）。20件を超えるか、`body` の `.length` の合計が 20000 を超えれば provider を呼ばずに `too_large`（`count` に件数、`attempts: 0`）
  - provider の取得・呼び出しで `ProviderUnavailableError` なら `provider_unavailable`（`message` はその例外の文）。**ほかの例外なら `provider_unavailable` で `message` は固定の「AI の呼び出しに失敗しました」**（例外の本文を入れない）
  - 検証の違反は、`errors` を `previousErrors` に入れて**もう1回だけ**呼ぶ（合計2回まで）。2回とも違反なら `schema_violation`（`errors` は最後の検証の `errors`）
  - 成功を返す直前に `listProcedureSources` をもう一度呼び、`knowledge_id` の並びがスナップショットと違えば（生成の途中に承認・取り下げがあった）、結果を捨てて `sources_changed`（`message` は「生成の途中で共有が変わりました。もう一度作ってください」）
- A5. `PROCEDURE_NOTICE = "原案。利用前に本人・先輩の確認が必要"` を `procedure.ts` に export する（M5-4 の常時の表示は画面の票で使う）
- A6. `POST /api/procedures` を新設する。body は zod で `{ taskName: string(1〜100) }`。判定の順：`invalid_body` 400 → `normalizeTaskName` して空なら 400 `task_name_empty` → `generateProcedure`。失敗は `insufficient_records`・`too_large` 422（`{ error, message, count }`）、`provider_unavailable` 503（`{ error, message }`）、`schema_violation` 422（`{ error, message, errors }`）、`sources_changed` 409（`{ error, message }`）。zod の body の検証の失敗では、入力の値を応答に入れない。成功は 200 `{ procedure, model, attempts, notice: PROCEDURE_NOTICE }`。`console` に共有の本文を出さない
- A7. `src/lib/procedure.test.ts` に、下の①〜⑭を**それぞれ1件以上の `it(`**で試す（`openDb(":memory:")`、`shared_knowledge` には直接 INSERT してよい。provider は `mock` を `opts.provider` で渡す）：①共有が1件なら `insufficient_records` で `count: 1`、provider は呼ばれない ②取り下げ済みの共有は数えない ③別の作業名の共有は入らない ④正しい出力で、evidence の番号が `knowledge_id`・`display_name`・`approved_at` に写り、空の evidence は `inferred: true` ⑤1回目が壊れた出力（JSON でない）、2回目が正しい出力なら `attempts: 2` で成功し、2回目の入力の `previousErrors` が空でない ⑥2回とも違反なら `schema_violation` ⑦範囲外の番号（`sources.length + 1`）は違反 ⑧provider が `ProviderUnavailableError` を投げれば `provider_unavailable` ⑨`buildProcedurePrompt` の文字列に共有の本文と `先輩`／`新人` の区別が入り、`notes` の表に入れた本文（試験で INSERT した別の文）は入らない。⑩共有が21件なら `too_large` で provider は呼ばれない ⑪mock の1回目の呼び出しの中で共有を1件取り下げると `sources_changed` ⑫provider が本文を含む普通の `Error` を投げると `provider_unavailable` で、`message` に本文が入らない ⑬違反の `errors` に、出力に入れた目印の文字列が入らない ⑭`DemoProcedureProvider` が、試験の一時ディレクトリに置いた fixture（`sources_fingerprint` が一致）を読める。ない作業名、`sources_fingerprint` が違う（共有を1件取り下げた後）ときは `ProviderUnavailableError`
- A8. `npm run -s test`（既存の試験と追加分のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは次の4つだけ（すべて新設）：`src/lib/procedure.ts`、`src/lib/procedure.test.ts`、`src/lib/ai/procedure-provider.ts`、`src/app/api/procedures/route.ts`

## 3. 開発用テスト

- `procedure.test.ts`：A7 の観点。Claude の API は呼ばない（mock と demo だけ）
- デモ用の fixture（`procedure-*.json`）の採取はこの票の範囲外（承認済みの共有の seed と、`capture` の拡張は別の票）

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回（`npm install` は使わない）
2. `procedure-provider.ts` は `./claude`（`CLAUDE_MODEL`）、`./demo`（`fixtureKey`・`FIXTURE_DIR`）、`./provider`（`ProviderUnavailableError`・`resolveProviderName`）を import するだけで、それらのファイルは変えない。`fixtureKey(taskName, false)` の `final-` を `procedure-` に置き換えればハッシュは同じ
3. `procedure.ts` の構成は `src/lib/summarize.ts` を見本に（やり直しの回し方、例外の扱い）
4. コミットは1つ。メッセージの先頭は `T-012: `

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ **Codex security**（観点：原文のメモが Claude に送られないか、取り下げ・未承認の内容が混ざらないか、入力の検証、本文をログに出さないか）。要件は main にコミット済みのこの票の §2（A1〜A8）。T-010・T-011・T-013 と触るファイルが重ならない。

## 6. 記録

（統合後に追記）
