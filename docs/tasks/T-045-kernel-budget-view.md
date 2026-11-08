---
id: T-045
title: 統治の画面の Kernel の区画に、予算の使用・実行の状態・受け入れの件数を出す（写しに項目がなければ「写しにない」と出す）
status: review
requirements: [A0, A1, A2, A3, A4, A5]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-66, D-67]   # 記録用。司法には渡さない
proposal_from: 2026-11-08 09:4x 立法補佐が起草（オーナーの承認前）。全範囲の設計（docs/drafts/vgdd-full-scope-design.md）§3・§8・§11 の T-045。オーナーの方針「B」（11/8 09:2x）
estimate_h: 1.5
time_limit_min: 45
security_review: false         # 検証済みの写しを表示するだけ。入力の検証（T-042）は変えない
unattended: false
branch:
worker:
files_allowed:
  - src/lib/kernel-budget.ts                          # 新設：表示用の純粋関数
  - src/lib/kernel-budget.test.ts                     # 新設：純粋関数の試験
  - src/components/KernelBudget.tsx                   # 新設：表示の部品
  - src/components/KernelBudget.test.tsx              # 新設：部品の試験
  - src/components/KernelPanel.tsx                    # 部品を1か所に置くだけ（A4）
files_forbidden:
  - src/lib/kernel-state-schema.ts
  - src/lib/kernel-state.ts
  - src/lib/kernel-invariants*.ts
  - src/lib/theater-*.ts
  - src/components/theater/**
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
depends_on: [T-042]
---

## 1. 目的

D-66・D-67 で、作業員・司法・憲法審査の呼び出しを予算の台帳に通した（p0.4.9）。T-042 で、Kernel の写し（`kernel-state.json`）は予算（`budget`）・実行の状態（`runs`）・受け入れ（`acceptance`）の3項目を任意で持てるようになった。統治の画面の Kernel の区画に、この3項目を数と割合で出す。写しにまだ項目がない（書く側が未対応）ときは、作り足さずに「写しにない」と出す。読めないこと（契約の利用枠の残り・費用）は「読めない・出さない」と書く。審査：深さ20（統治の状態が一目でわかる）・正直さ（未実装・不明を隠さない）。

## 2. 受け入れ条件

- A0. 差分を許すパスは次の5つだけ：`src/lib/kernel-budget.ts`、`src/lib/kernel-budget.test.ts`、`src/components/KernelBudget.tsx`、`src/components/KernelBudget.test.tsx`、`src/components/KernelPanel.tsx`。それ以外は変更しない。依存を足さない。型は `src/lib/kernel-state-schema.ts` の `KernelState`・`KernelBudget`・`KernelRuns`・`KernelAcceptance` と `formatJst` を import して使い、検証（`pickKernelState`）を変えたり、実行時のコードで検証をし直したりしない（試験で fixture を `pickKernelState` に通すのは許す）。サーバーへの取得を足さない（`KernelPanel` がすでに取った状態だけを使う）
- A1. **表示用の純粋関数**（`kernel-budget.ts`。副作用なし）：
  - `usageRow(used: number, limit: number | null)`：`{ used, limit, percent, text }` を返す。`limit` が null なら `percent` は null、`text` は「`used`（上限なし）」。`limit` が 0 なら `percent` は null、`text` は「`used` ／ 上限 0」。それ以外は `percent` を `Math.floor(used * 100 / limit)`（100 を超えてもそのまま）、`text` は「`used` ／ `limit`（`percent`%）」。数は3桁ごとに `,` で区切る（`Intl.NumberFormat("ja-JP")`）
  - `budgetRows(b: KernelBudget)`：次の4行を、この順で返す。各行は `{ label, row }`（`row` は `usageRow` の結果）
    1. 「トークン（精算済み＋予約中）」：`used` は `tokens.settled + tokens.reserved`、`limit` は `tokens.limit`
    2. 「司法の呼び出し」：`judge_calls.used`・`judge_calls.limit`
    3. 「試行」：`attempts.used`・`attempts.limit`
    4. 「作業員（同時）」：`workers.active`・`workers.limit`
  - 数の計算は JavaScript の Number で行う。安全な整数（`Number.MAX_SAFE_INTEGER`）を超える和や積の丸めは許す（この票では正確さを求めない）
  - `periodLabel(period_id: string)`：`period_id` が `/^[A-Za-z0-9._-]{1,40}$/` に合い、かつ16進の文字（`0-9a-fA-F`）が12字以上続く部分を含まなければそのまま（例：`freeze-20261108` は通る）、そうでなければ固定の文「（表示しない形の期間名）」を返す（T-042 の検証は長さだけなので、パスや文が入っても画面に出さない）
  - `pendingPreview(a: KernelAcceptance)`：`pending` の配列の先頭から最大 20 件（配列の順のまま）を `ids` に、表示した数を n として `more = pending_count − n`（0 未満なら 0）を返す
  - `runsRows(r: KernelRuns)`：8つの件数を、`requested`・`reserved`・`started`・`exited`・`settled`・`cancelled`・`liveness_unknown`・`usage_unknown` の順に `{ key, label, count }` で返す。ラベルは順に「要求」「予約」「起動」「終了」「精算」「取り消し」「生死が不明」「利用量が不明」
- A2. **表示の部品**（`KernelBudget.tsx`。props は `state: KernelState` だけ。見出しは「予算と実行（台帳の集計）」）：
  - `budget` があれば：期間（`periodLabel(period_id)` の結果と、`until` を `formatJst` で整えた文字列 X を使った「X まで」。`until` が null なら「終わりの指定なし」）と、A1 の4行を表で出す。`percent` が 80 以上 100 未満の行には文字で「（上限に近い）」だけを、100 以上の行には「（上限に達した）」だけを足す。`percent` が null の行には何も足さない（色だけで示さない）。`tokens.unknown_runs` が 1 以上なら「利用量を読めなかった実行 N 件は、予約の全量を使ったものとして数えている」と出す
  - `runs` があれば：A1 の8つの件数を出す。`liveness_unknown` か `usage_unknown` が 1 以上なら、その行に文字で「（オーナーの照合が要る）」を足す
  - `acceptance` があれば：「受け入れ済み N 件・受け入れ待ち M 件」（N は `accepted_count`、M は `pending_count`）と、`pendingPreview` の `ids`。`more` が 1 以上なら「ほか K 件」（K は `more`）
  - 3項目のそれぞれがなければ、その場所に「この写しには予算の集計がない」「この写しには実行の状態がない」「この写しには受け入れの記録がない」と出す（値を作り足さない。0 と表示しない）
  - いつも出す固定の注記：「契約の利用枠（サブスクリプション）の残りは読めない。推定費用は出さない。数えるのは Kernel の窓口を通った呼び出しだけで、行政の長・立法補佐・オーナーのメインの会話は含まない」
- A3. **アクセシビリティと文字**：表は `<table>` に `<caption>` で名前を付ける。割合は数でも書く。表の文字は `text-sm`、注記（固定の注記・不明の注記）は `text-xs`。合成の値でも実データでも、絶対パス・理由の本文・ハッシュを出さない（3項目に入らない形なので、ほかの項目を読まない）
- A4. **区画への組み込み**（`KernelPanel.tsx`）：`import` の1行と、状態が `ok` のときの描画の中で、注意の段落（「生のログは公開していない」）の直前に `<KernelBudget state={state} />` を1か所置く差分だけ。ほかの行（取得・間隔・stale・ほかの表示）は変えない
- A5. 試験：`kernel-budget.test.ts` で、`usageRow` の上限 null・上限 0・ちょうど 80%・100% 超・30,000,000 の区切り、`budgetRows` の順とトークンの足し算、`runsRows` の順とラベル、`periodLabel` の許す形と拒む形（`/Users/foo`・空白を含む文・41 字・`"a".repeat(40)`・`p-0123456789ab`）、`pendingPreview` で `pending_count` が配列の長さより大きいとき（例：件数 100・配列 25 件 → `ids` 20 件・`more` 80）。`KernelBudget.test.tsx` で、3項目のない写し（リポジトリの `docs/governance/snapshots/submission/kernel-state.json` を `pickKernelState` で読んだもの）で3つの「写しにない」が出て「0」の件数を出さないこと、合成の3項目で数と「（上限に近い）」「（上限に達した）」「（オーナーの照合が要る）」と待ちの票の ID の 20 件の上限と「ほか K 件」が出ること、ちょうど 100% の行に「（上限に達した）」だけが出て「（上限に近い）」が出ないこと、`until` が null で「終わりの指定なし」・日時で「X まで」が出ること、`unknown_runs` が 1 以上で不明の注記が出ること、`period_id` が `/Users/foo` のとき画面にその文字列が出ないこと、3項目のうち1つだけがある写しでほかの2つに「写しにない」が出ること、固定の注記が出ること。「0 と表示しない」は、項目がないときにこの部品が件数を出さないことを指す。そのうえで `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る

## 3. 開発用テスト

held の後、立法補佐が候補で `/governance` を開き、(1) 今の写し（3項目なし）で3つの「写しにない」が出て、ほかの表示が今までどおりであること (2) 3項目を足した合成の写しを一時の作業ツリーの中だけで置いて数・注記が出ること (3) 1440×900 と 375px で崩れないことを確かめる。

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. A1 と試験 → A2 と試験 → A4
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。T-042 の統合の後（depends_on）。ほかの票とファイルが重ならない。

## 6. 記録

- 09:4x 立法補佐が起草。写しの書く側（`kernel-state.mjs` が台帳から3項目を出す）は法律の改正 L3 で、この票の範囲の外。L3 が配置されるまで、本番の画面は「写しにない」を出す

- 2026-11-08T11:01:27+0900 night-runner: 作業員の実装を前検査で確認（HEAD be05511）。status → review で再申請（試行 1）

- 2026-11-08T11:03:47+0900 gate-runner: judge と Codex が minor の指摘で分かれた。厳しい側の指摘を残して統合（judge=APPROVED, codex=CHANGES_REQUIRED）

- 2026-11-08T11:03:48+0900 gate-runner: status → review（判定に合格（judge=APPROVED codex=CHANGES_REQUIRED）。夜間のため統合せず、朝のオーナーの承認を待つ）
