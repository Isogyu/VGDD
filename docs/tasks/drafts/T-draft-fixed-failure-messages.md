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

- A1. `src/lib/summarize.ts`：`provider.summarize` の例外のうち `ProviderUnavailableError` 以外のときの `message` を、固定の文 **「AI の呼び出しに失敗しました」** にする（今の `AI の呼び出しに失敗しました：${e.message}` から例外の文を外す）。`ProviderUnavailableError` の `message` は内製の固定の文なのでそのまま。`getProvider()` の例外（provider の生成）も、`ProviderUnavailableError` なら `e.message`、それ以外は「AI が使えません」の固定の文（例外の文を使わない）。`reason`・`attempts`・ほかの振る舞いは変えない
- A2. `src/lib/ai/claude.ts` に `createAnthropicClient(apiKey: string): Anthropic` を export し、`new Anthropic({ apiKey, timeout: 30000, maxRetries: 1 })` を返す（AI の検出と同じ値。整理・原案の既定 10 分・2 回をこれにそろえる）。`claude.ts` の `ClaudeProvider`、`procedure-provider.ts` の `ClaudeProcedureProvider`、`sensitive-provider.ts` の `ClaudeSensitiveProvider` は、それぞれの `new Anthropic(...)` をこの関数の呼び出しに置き換える（ほかは変えない）
- A3. `src/lib/summarize.test.ts`（既存）に、下の①〜③を**それぞれ1件以上の `it(`**で足す（既存の `it(` と期待値は変えない）：①mock provider が `new Error("秘密の文 abc123")` を投げると `reason: "provider_unavailable"`・`message` が「AI の呼び出しに失敗しました」で、`message` に `abc123` が含まれない ②`ProviderUnavailableError("デモの保存済みの結果がありません")` を投げると `message` がその文のまま ③`opts.provider` を渡さず `getProvider()` が `ProviderUnavailableError` 以外の例外を投げる状況（`setProviderOverride` で生成時に投げる provider を渡す、または `TSUBUYAKI_AI_PROVIDER` の環境変数で不正な名を指定）で `message` が「AI が使えません」
- A4. `npm run -s test`（既存の試験と追加分のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは `files_allowed` の最大5つ。ルート（`src/app/api/**`）は変えない（`message` をそのまま返す今の形で、固定の文になる）

## 3. 開発用テスト

- A3 の観点。実 API の失敗（キーが無効）の文は、オーナーがキーなしの環境で `/api/sessions/<id>/summarize` を呼んで「AI が使えません（…）」の固定の文が出ることを確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. `timeout` 30 秒は整理（メモ 12 件程度）と原案（共有 20 件まで）でも足りる見込みだが、実 API で超えれば `provider_unavailable`「AI の呼び出しに失敗しました」になる。値はオーナーに聞く（§8）
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ **Codex security**（観点：例外の本文が応答に出ないか）。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（4:00 から立法補佐が行う）。（この票は点検前）

## 8. オーナーに聞くこと

1. `timeout` 30 秒・`maxRetries` 1 を整理と原案にも使うか（原案は材料が多いと長くかかる。60 秒にする案）
2. 機能凍結の前に通すか（修正）
