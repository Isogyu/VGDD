---
id: T-042
title: Kernel の写しの読み取りを、予算・実行・受け入れの新しい項目（任意）にも対応させる（新旧の両方の写しを読める）
status: ready
requirements: [A0, A1, A2, A3, A4]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-66, D-67]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐が起草（オーナーの承認前）。全範囲の設計（docs/drafts/vgdd-full-scope-design.md）§8 の「読む側を先に両対応にする」
estimate_h: 1
time_limit_min: 90
security_review: true          # 写しの検証（公開の項目）を変える
unattended: false
branch: null
worker: null
files_allowed:
  - src/lib/kernel-state-schema.ts                    # 任意の3項目の検証と型を足すだけ
  - src/lib/kernel-state.test.ts                      # 試験を足す
files_forbidden:
  - src/lib/kernel-state.ts                           # 読み込みは変えない
  - src/lib/kernel-invariants*.ts
  - src/lib/theater-*.ts
  - src/components/**
  - src/app/**
  - src/lib/db/**
  - docs/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-022, T-030]
---

## 1. 目的

全範囲の設計（D-66・D-67）では、Kernel の写し（`kernel-state.json`）に、予算・実行の記録・受け入れの集計を足す。写しの検証は厳しく（余分な項目があると写し全体を拒む）、書く側（Kernel、法律の改正 L1・L3）を先に変えると、今の画面が写しを読めなくなる。そこで先に読む側を、新しい3項目が**あってもなくても**読めるようにする。項目の形はここで決め、L1・L3 はこの形で書く。数と ID だけで、理由の本文・パス・ハッシュは持たない。審査：深さ20。

## 2. 受け入れ条件

- A0. 差分を許すパスは次の2つだけ：`src/lib/kernel-state-schema.ts`、`src/lib/kernel-state.test.ts`。それ以外は変更しない。今の項目と今の入力に対する検証・整形・`verdicts.by_task` の扱い（`pickKernelState`・`toWire`・`formatJst`）は変えない。A1 の新しい3項目を受け取り、`pickKernelState` と `toWire` の結果に保つ変更は許す。3項目はそれぞれ独立に省いてよく、省いた項目を作り足さない
- A1. **任意の3項目**（`kernelStateSchema` の strict のまま、次の3つを `.optional()` で足す。書かれていなければ検証を通り、値は `undefined`）：
  - ここでの「数」は 0 以上 `Number.MAX_SAFE_INTEGER` 以下の整数で、新しい3項目だけの検証を使う（今の `Count`（上限 100 万）と `Iso` は流用もしないし変えもしない）。票の ID は今の `TaskId` と同じ（`T-` と ASCII の数字3〜4桁）
  - `budget`：`{ period_id: 文字列（1〜40字）, until: タイムゾーン付きの有効な日時の文字列か null, tokens: { settled: 数, reserved: 数, unknown_runs: 数, limit: 数か null }, judge_calls: { used: 数, limit: 数か null }, attempts: { used: 数, limit: 数か null }, workers: { active: 数, limit: 数か null } }`（すべての階層で strict）。集計の対象は `period_id` の期間
  - `runs`：`{ requested: 数, reserved: 数, started: 数, exited: 数, settled: 数, cancelled: 数, liveness_unknown: 数, usage_unknown: 数 }`（strict）。`requested`〜`cancelled` は今の状態ごとの件数、`liveness_unknown`・`usage_unknown` はそれぞれの不明の件数で、ほかの件数との重なりを許す。集計の対象は `period_id` の期間
  - `acceptance`：`{ accepted_count: 数, pending_count: 数, accepted: 票の ID の配列（最大 500）, pending: 票の ID の配列（最大 500） }`（strict）。件数は配列の長さ以上
  - 型 `KernelState` に、この3つを任意の項目として含める（`KernelStateWire` も同じ）
- A2. **公開してよい項目だけ**：3項目に、文字列は `period_id`・`until`・票の ID しか入らない。それ以外の項目（理由の本文・パス・ハッシュなど）が中にあれば strict で拒む
- A3. 試験（`kernel-state.test.ts` に足す。今の試験はそのまま）：3項目のない今の写し（リポジトリの `docs/governance/snapshots/submission/kernel-state.json` を含む）が今までどおり通ること。3項目の正しい合成の値が通り、`toWire` で同じ値が返ること。足したすべての階層の余分な鍵、数の欄の負の数・小数・安全な整数の範囲外、配列の票の ID でない文字列と 501 件、長すぎる `period_id`、不正な `until`、件数が配列の長さより小さい `acceptance` で、写し全体が `null` になること。30,000,000 が通ること。3項目のうち1つだけを足した写しが通ること
- A4. `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る

## 3. 開発用テスト

held の後、立法補佐が候補で `/governance` を開き、提出記録・稼働中の観測の両方が今までどおり出ることを確かめる（3項目のない写し）。

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. A1 → A3
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ Codex security。法律の改正 L3（書く側）より前に統合する。

## 6. 記録

## オーナーに聞くこと

1. 3項目の形（A1）を、法律の改正 L1・L3 で書く形として固定する
