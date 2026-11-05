---
id: T-draft-fixed-failure-messages
title: AI の呼び出しの失敗の文を固定にし（例外の本文を応答に出さない）、Claude クライアントの timeout と再試行を1か所で決める
status: draft
requirements: [A1, A2, A3, A4]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M4-1, M10-1, 約束6（漏えい防止）]   # 記録用。司法には渡さない
proposal_from: 2026-11-06 02:5x アプリの安全の点検（docs/drafts/review-security.md の #4・#15・#9 の一部）
estimate_h: 0.5
time_limit_min: 40
security_review: true          # 応答に出る文の変更
unattended: false
branch: null
worker: null
files_allowed:
  - src/lib/summarize.ts
  - src/lib/summarize.test.ts
  - src/lib/ai/claude.ts                    # 共通の client の生成関数を export
  - src/lib/ai/procedure-provider.ts        # 生成関数を使うだけ
  - src/lib/ai/sensitive-provider.ts        # 生成関数を使うだけ
files_forbidden:
  - src/lib/procedure.ts
  - src/lib/ai-sensitive.ts
  - src/lib/ai/provider.ts
  - src/lib/ai/demo.ts
  - src/lib/ai/prompt.ts
  - src/app/**
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

`summarizeSession` は provider の例外の `e.message` を結果の `message` に入れ、3本のルート（`summarize`・`checkin`・`answers`）がそれを応答に返す。SDK の HTTP エラーの文は API の応答の本文や request id を含みうる。`procedure.ts`・`ai-sensitive.ts` は固定の文にそろえているので、`summarize.ts` も合わせる。あわせて Claude クライアントの `timeout`・`maxRetries` が provider ごとに違う（整理と原案は既定の 10 分・2 回、AI の検出は 30 秒・1 回）ので、1か所の生成関数で同じ値にする。審査：深さと実行20、インパクト30（プライバシー）。

## 2. 受け入れ条件

- A1. `src/lib/summarize.ts`：小さな純粋関数 `providerFailureMessage(e: unknown): string` を export する（`src/lib/ai-sensitive.ts` の `failureMessage` と同じ形）：`e instanceof ProviderUnavailableError` なら `e.message`（内製の固定の文）、それ以外は定数 **`PROVIDER_FAILED_MESSAGE = "AI の呼び出しに失敗しました"`**（`procedure.ts` と同じ文・同じ定数名。export する）。`provider.summarize` の例外（今は `AI の呼び出しに失敗しました：${e.message}` と例外の文を連結）と `getProvider()` の例外（provider の生成）の **両方**でこの関数の返り値を `message` にする（先例の `procedure.ts`・`ai-sensitive.ts` と同じ割り当て。「AI が使えません」の文はこの票では使わない）。`reason`・`attempts`・ほかの振る舞いは変えない
- A2. `src/lib/ai/claude.ts` に `createAnthropicClient(apiKey: string, opts: { timeoutMs?: number } = {}): Anthropic` を export し、`new Anthropic({ apiKey, timeout: opts.timeoutMs ?? 60000, maxRetries: 1 })` を返す。使う側：`claude.ts` の `ClaudeProvider`（整理）は既定の 60 秒、`procedure-provider.ts` の `ClaudeProcedureProvider`（原案）は既定の 60 秒、`sensitive-provider.ts` の `ClaudeSensitiveProvider`（検出）は `{ timeoutMs: 30000 }`（今の値のまま）。3 箇所の `new Anthropic(...)` をこの関数の呼び出しに置き換え、**`./claude` からの import に `createAnthropicClient` を足す**（`import Anthropic from "@anthropic-ai/sdk"` は `private client: Anthropic` の型のために残すか `import type` に変える。どちらでもよい）。ほかは変えない。注：所要の実測は fixture の採取 1 回あたり約 6〜7 秒（`demo-fixtures/final-*.json` の `captured_at` の間隔。メモ 4 件）だけで、原案の実測はない。SDK は timeout も再試行するので、`maxRetries: 1` では失敗の確定まで最長 timeout の 2 倍
- A3. `src/lib/summarize.test.ts`（既存 8 件の `it(` は削除も変更もしない）に、下の①〜③を**それぞれ1件以上の `it(`**で足す：①mock provider が `new Error("秘密の文 abc123")` を投げると `reason` が `"provider_unavailable"`、`message` が `"AI の呼び出しに失敗しました"` と**完全一致**（`toBe`）、`message` に `abc123` が含まれない（`not.toContain`）②`new ProviderUnavailableError("デモの保存済みの結果がありません")` を投げると `message` がその文と完全一致 ③`providerFailureMessage` の単体：`new Error("xyz789")` → `PROVIDER_FAILED_MESSAGE` と完全一致で `xyz789` を含まない、`new ProviderUnavailableError("固定の文")` → `"固定の文"`、文字列 `"abc"` や `null` → `PROVIDER_FAILED_MESSAGE`（`getProvider()` が `ProviderUnavailableError` 以外を投げる状況は今の実装では作れないので、生成時の経路は関数の単体で確かめる）
- A4. `npm run -s test`（既存の試験と追加分のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは `files_allowed` の最大5つ。ルート（`src/app/api/**`）は変えない（`message` をそのまま返す今の形で、固定の文になる）。`answers/route.ts` の `provider_unavailable` が 422 である不一致（review-security #9）は**この票の範囲外**

## 3. 開発用テスト

- A3 の観点。実 API の失敗の文は、オーナーが **無効なキー**（`ANTHROPIC_API_KEY=sk-ant-invalid`）で起動し、`POST /api/sessions/<id>/summarize` が 503 で `message` が「AI の呼び出しに失敗しました」、request id や HTTP の文を含まないことを確かめる（キーなしはデモモードになるので、この確認には使えない）

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. `timeout` は整理・原案 60 秒、検出 30 秒（A2）。実 API で超えれば `provider_unavailable`「AI の呼び出しに失敗しました」になる。値はオーナーに聞く（§8）
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ **Codex security**（観点：例外の本文が応答に出ないか）。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（4:00 から立法補佐が行う）。点検役：Claude のサブエージェント（読み取り専用。SDK の既定値も確認）。03:2x、指摘 8 件（重い 3・中 3・軽 2）。対応：#1 `getProvider()` が PUE 以外を投げる状況は作れない → 写像を純粋関数 `providerFailureMessage` にして単体で試す（A1・A3③）／#2 文の割り当てが先例と逆 → PUE 以外はすべて `PROVIDER_FAILED_MESSAGE`、文は完全一致（A1・A3）／#3 「キーなし」はデモモードになる → 無効なキーでの確認に（§3）／#4 import の変更を明記（A2）／#5 `toBe` と明記（A3）／#6 timeout の実測は採取 6〜7 秒だけ → 用途ごとに渡せる形、整理・原案 60 秒・検出 30 秒、実測なしと注記（A2）／#7 #9 の範囲（A4）／#8 既存 8 件と件数を明記（A3）

## 8. オーナーに聞くこと

1. `timeout` を整理・原案 60 秒、検出 30 秒、`maxRetries` 1 でよいか（原案の所要は実測がない）
2. 機能凍結の前に通すか（修正）
