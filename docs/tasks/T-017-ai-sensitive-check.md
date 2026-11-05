---
id: T-017
title: 共有候補への AI の追加の検出（決定論的な検出に足すだけ。M6-2 の裏側）
status: ready
requirements: [A1, A2, A3, A4, A5, A6, A7]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M6-2, M6-1, M6-4, M9-1]   # 記録用。司法には渡さない
proposal_from: 開発スケジュール 段階1（G3 の条件 M6）。2026-11-05 立法補佐が起草（オーナー不在の間。着手はオーナーの approve-spec の後）
estimate_h: 1.0
time_limit_min: 60
security_review: true          # 新しい API ルートと外部 API の呼び出し
unattended: false              # 角かっこを含むパスがある（OBS-049）
branch: null
worker: null
files_allowed:
  - src/lib/ai-sensitive.ts                 # 新設：プロンプト・検証・統合
  - src/lib/ai-sensitive.test.ts            # 新設
  - src/lib/ai/sensitive-provider.ts        # 新設：Claude と demo の provider
  - src/app/api/shares/[shareId]/ai-check/route.ts   # 新設
files_forbidden:
  - src/lib/sensitive.ts                    # 決定論的な検出は変えない
  - src/lib/sharing.ts
  - src/lib/ai/provider.ts
  - src/lib/ai/claude.ts
  - src/lib/ai/demo.ts
  - src/lib/ai/prompt.ts
  - src/lib/ai/index.ts
  - src/lib/demo-fixtures/**
  - src/lib/db/schema.sql
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

共有候補（M9）の本文に対して、決定論的な検出（M6-1）に加えて、Claude に「登録されていない顧客名・金額・未公開の計画」の候補を挙げさせ、**検出を足す**。AI は決定論的な検出を取り消せない。結果は本人への注意の追加で、自動では置き換えない（置き換えは M6-3 の案を本人が選ぶ）。画面への組み込みは別の票。審査：Claude の活用25、インパクト30（プライバシー）。

## 2. 受け入れ条件

- A1. `src/lib/ai/sensitive-provider.ts` に次を export する：
  - `SensitiveInput = { text: string; known: { start: number; end: number; type: string }[]; previousErrors?: string[] }`、`SensitiveOutput = { raw: string; model: string }`、`SensitiveProvider = { readonly name: "claude" | "demo" | "mock"; check(input: SensitiveInput): Promise<SensitiveOutput> }`
  - `ClaudeSensitiveProvider`（`@anthropic-ai/sdk`、モデルは `./claude` の `CLAUDE_MODEL`、`max_tokens` 1000、`system` は `SENSITIVE_SYSTEM_PROMPT`、`user` は `buildSensitivePrompt(input)`。キーがなければ `./provider` の `ProviderUnavailableError`）
  - `DemoSensitiveProvider`：`src/lib/demo-fixtures/sensitive-<本文の SHA-256 の16進の先頭16文字>.json`（`{ model, raw }`）を読む。ない・読めなければ `ProviderUnavailableError`（「デモモードでは、この本文の AI の検出の保存済みの結果がありません」）。`sensitiveFixturePath(text, dir?)` を export
  - `getSensitiveProvider()`（`./provider` の `resolveProviderName()` が `claude` なら Claude、それ以外は demo）と、試験用の `setSensitiveProviderOverride(p: SensitiveProvider | null)`
  - `SENSITIVE_SYSTEM_PROMPT`（日本語。守ること：JSON だけを返す／本文に**そのまま現れる**文字列だけを `match` に入れる／決定論的な検出ですでに見つかった箇所（`known`）は挙げない／種類は `customer`（登録されていない顧客名・会社名）・`amount`（金額）・`plan`（未公開の計画・予定）・`other` の4つ／候補がなければ空の配列）と `buildSensitivePrompt(input)` を export する
- A2. `src/lib/ai-sensitive.ts` に `AiFlag = { type: "ai_customer" | "ai_amount" | "ai_plan" | "ai_other"; match: string; start: number; end: number; reason: string; source: "ai" }` と `validateAiFlags(raw: unknown, text: string, known: Flag[]): { ok: true; flags: AiFlag[] } | { ok: false; errors: string[] }` を export する。出力の形は zod の strict で `{ candidates: { match: string(1〜100); kind: "customer"|"amount"|"plan"|"other"; reason: string(1〜200) }[](0〜20件) }`（`raw` が文字列なら `@/lib/summary-schema` の `extractJson` を通して読む）。各候補の `start` は `text.indexOf(match)`、`end` は `start + match.length`。**`text` に現れない `match` の候補は捨てる**（違反にはしない）。`known` のどれかと範囲が重なる候補も捨てる（重なり＝`a.start < b.end && b.start < a.end`）。同じ範囲の候補は最初の1つだけ。返す順は `start` の昇順。`errors` には出力の値を含めない（`<項目のパス>: <issue の code>`、または `出力が JSON として解釈できない`）
- A3. `checkSensitiveWithAi(text: string, opts: { provider?: SensitiveProvider } = {})` を export する。返り値は `{ ok: true; deterministic: Flag[]; ai: AiFlag[]; model: string; attempts: number } | { ok: false; reason: "provider_unavailable" | "schema_violation" | "empty_text"; message: string; deterministic: Flag[]; errors?: string[]; attempts: number }`。
  - `deterministic` は常に `detectSensitive(text)`（`@/lib/sensitive`）の結果をそのまま入れる（**AI の結果で減らさない・変えない**。失敗のときも入れる）
  - `text.trim()` が空なら provider を呼ばずに `empty_text`
  - provider の `ProviderUnavailableError` は `provider_unavailable`（`message` はその文）、ほかの例外は `provider_unavailable` で固定の「AI の呼び出しに失敗しました」
  - 検証の違反は、`errors` を `previousErrors` に入れてもう1回だけ呼ぶ（合計2回まで）。2回とも違反なら `schema_violation`
- A4. `POST /api/shares/[shareId]/ai-check` を新設する。body は zod で `{ userId: string(1〜) }`。判定の順：`invalid_id` 400（`Number(shareId)` が整数でない）→ `invalid_body` 400 → `user_not_found` 404（`@/lib/db` の `getUser`）→ 候補を `share_candidates` から id で読み、ない → `share_not_found` 404、`user_id` が違う → `not_your_share` 403、`status` が `pending` でない → 409 `already_decided`。対象の本文は候補の `draft_body`（**`notes` の表は読まない**）。`checkSensitiveWithAi` の失敗は `provider_unavailable` 503・`schema_violation` 422・`empty_text` 422（どれも `{ error, message, deterministic }`）、成功は 200 `{ deterministic, ai, model, notice: "AI の検出は候補です。見落としも誤りもあります。決定論的な検出は AI の結果で取り消されません" }`。`console` に本文を出さない。DB には書かない
- A5. 決定論的な検出は AI の結果で取り消せない：`checkSensitiveWithAi` の成功・失敗のどちらでも、`deterministic` は同じ `text` の `detectSensitive(text)` と等しい
- A6. `src/lib/ai-sensitive.test.ts` に、下の①〜⑨を**それぞれ1件以上の `it(`**で試す（provider は `mock`）：①罠の5件目「ホクト製菓の案件で見積りが 350 万円になった」で、mock が `350 万円`（amount）を返すと `ai` に `ai_amount` が1件、`deterministic` に登録語句が1件 ②mock が `ホクト製菓`（決定論的な検出と同じ範囲）を返しても `ai` に入らない ③本文にない `match` は捨てられ、違反にならない ④壊れた出力の後に正しい出力なら `attempts: 2` で成功 ⑤2回とも壊れていれば `schema_violation` で、`deterministic` は入っている ⑥`ProviderUnavailableError` で `provider_unavailable`、`deterministic` は入っている ⑦本文を含む普通の `Error` で、`message` に本文が入らない ⑧空白だけの本文は provider を呼ばずに `empty_text` ⑨`DemoSensitiveProvider` が一時ディレクトリの fixture を読め、ないときは `ProviderUnavailableError`
- A7. `npm run -s test`（既存の試験と追加分のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは次の4つだけ（すべて新設）：`src/lib/ai-sensitive.ts`、`src/lib/ai-sensitive.test.ts`、`src/lib/ai/sensitive-provider.ts`、`src/app/api/shares/[shareId]/ai-check/route.ts`

## 3. 開発用テスト

- `ai-sensitive.test.ts`：A6 の観点。Claude の API は呼ばない
- デモ用の fixture の採取と、S-3 の画面への組み込み（「AI でも確かめる」ボタン）は別の票

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回（`npm install` は使わない）
2. 構成は T-012 の `src/lib/procedure.ts`・`src/lib/ai/procedure-provider.ts` を見本に（やり直し・例外の扱い・demo の fixture）
3. 候補を DB から読むときは、`@/lib/sharing` の公開関数に必要なものがなければ、ルートで `getDb().prepare("SELECT id, user_id, status, draft_body FROM share_candidates WHERE id = ?")` を使ってよい（`sharing.ts` は変えない）
4. コミットは1つ。メッセージの先頭は `T-017: `

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ **Codex security**（観点：決定論的な検出が AI で減らないか、原文のメモを送らないか、他人の候補、例外の本文、入力の検証）。要件は main にコミット済みのこの票の §2（A1〜A7）。T-014・T-015 と触るファイルが重ならない。

## 6. 記録

（統合後に追記）
