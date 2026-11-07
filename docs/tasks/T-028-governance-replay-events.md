---
id: T-028
title: 票の記録を、自由な文を含まない公開用のイベント（列挙値だけ）に変える API を作る（統治シアター U0）
status: merged
requirements: [A0, A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-64]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐が起草（オーナーの承認前）。ChatGPT の案（統治シアター）を立法補佐が仕分け、オーナーが 02:2x に「推奨で起草する」と決めた
estimate_h: 2
time_limit_min: 150
security_review: true          # 新しい API。公開してよい項目だけを返すことが目的なので、セキュリティ審査をかける
unattended: false
branch: worktree-agent-a6c176682dbe54d0f
worker: W24
files_allowed:
  - src/lib/governance-replay.ts              # 新設：記録の行を列挙値に変える純粋関数と、応答の組み立て
  - src/lib/governance-replay.test.ts         # 新設
  - src/app/api/governance/replay/route.ts    # 新設：GET /api/governance/replay
files_forbidden:
  - src/lib/governance.ts                     # 読み込みは既存の loadGovernance を import して使う。中身は変えない
  - src/app/api/governance/route.ts
  - src/app/api/governance/kernel/**
  - src/app/api/governance/history/**
  - src/components/**
  - src/lib/db/**
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

作品の顔にする「統治シアター」（票1枚が、承認・司法・Kernel を通って統合されるまでを再生する画面）の材料を作る。今の `GET /api/governance` は、票の §6 の記録の行の文（`detail`）をそのまま返している。文には SHA・パス・判定の要約が入り、公開の画面にそのまま出すものではない。新しい API は、記録の行を **時刻・役割・出来事の種類・理由の種類・判定の結論** の列挙値だけに変えて返す。自由な文は API の外に出さない（画面の CSS で隠すのではない）。**この票が保証する非公開の境界は `/api/governance/replay` の応答だけ**。旧い `GET /api/governance` と今の画面の自由な文は残り、新しい画面に切り替える T-034 で、旧い API の応答と画面の取得・表示を変える（区画を画面から外すだけでは済ませない）。審査：デモ25、深さと実行20。

## 2. 受け入れ条件

- A0. 差分は `files_allowed` の3つだけ。既存の `src/lib/governance.ts` と既存の API は変えない。route.ts が export する HTTP メソッドは `GET` だけ
- A1. `src/lib/governance-replay.ts` に、`TimelineEvent`（`@/lib/governance` の型）を1つ受けて次の `PublicEvent` を返す純粋関数 `toPublicEvent(e, seq)` を置く。`detail` の文は返り値に入れない。
  - `seq`：票の中の出現順（1 から）
  - `ts`：元の `ts` のまま（`2026-11-06T01:07:36+0900` の形）
  - `actor`：`"gate-runner" | "night-runner" | "release"`
  - `kind`（出来事）と `reason`（理由）は、`actor` と `detail` の先頭の決まった文字列で、次の表のとおりに分類する。具体的な行を先に当て、「上のどれでもない」の行は最後に当てる。どれにも当たらない行は `kind: "other"`、`reason: null`

  | 記録の行（`detail` の形） | kind | reason |
  |---|---|---|
  | gate-runner：`status → in_progress（files_allowed の外を変更している…` | `returned` | `scope` |
  | gate-runner：`status → in_progress（ブランチが main を含んでいない…` | `returned` | `rebase` |
  | gate-runner：`status → in_progress（セキュリティ審査が差し戻し）` | `returned` | `security` |
  | gate-runner：`status → in_progress（judge=CHANGES_REQUIRED, codex=CHANGES_REQUIRED（両方が差し戻し））`（件数の付く形 `judge=CHANGES_REQUIRED/2 件, codex=…` も含む。`両方が差し戻し` を含むかで判定） | `returned` | `judiciary` |
  | gate-runner：上のどれでもない `status → in_progress` | `returned` | `other` |
  | gate-runner：`status → blocked（judge と Codex の判定が重大な指摘で分かれた…` | `blocked` | `disagreement` |
  | gate-runner：`status → blocked（差し戻しが 3 回に達した…` | `blocked` | `return_limit` |
  | gate-runner：`status → blocked（仕様（…）がオーナーに承認されていない…` | `blocked` | `spec_unapproved` |
  | gate-runner：上のどれでもない `status → blocked` | `blocked` | `other` |
  | gate-runner：`status → review（判定に合格…夜間のため統合せず…` | `held` | `null` |
  | gate-runner：`status → merged` | `merged` | `null` |
  | release：`status → merged` | `released` | `null` |
  | gate-runner：`judge と Codex が分かれたが、オーナーの裁定` で始まる | `ruling` | `null` |
  | gate-runner：`judge と Codex が minor の指摘で分かれた` で始まる | `minor_disagreement` | `null` |
  | night-runner：`作業員の実装を前検査で確認` で始まる | `resubmitted` | `null` |

  - `judge`・`codex`：分類とは独立に、すべての行（`other` も含む）で `detail` の中に完全なトークンの `judge=APPROVED`／`judge=CHANGES_REQUIRED`（`codex=` も同じ）があればその値、なければ `null`。トークンの直後が英字・数字・`_` なら当てない（`APPROVED_EXTRA` は `null`）。この2つの値のほかは返さない（`/0 件` などの件数は捨てる）
- A2. 同じファイルに `buildReplay(data: GovernanceData)` を置き、次の形を返す。票の順は `data.tickets` の順のまま。`title`・`status` は front matter の値（票の題は公開してよい）
  ```
  { schema: "vgdd.governance-replay.v1", generated_at: string,
    tickets: [{ id, title, status, events: PublicEvent[] }] }
  ```
  - `generated_at` は `data.generated_at` を引き継ぐ。各票の `events` は `timeline` と同じ件数・同じ順序で、`seq` は票ごとに 1 から連続する
  - 応答は、トップレベル・票・イベントの各階層で、許可したキーだけを明示して組み立てる（入力のオブジェクトを広げてコピーしない）
- A3. `src/app/api/governance/replay/route.ts`：`GET` だけ。引数は取らない。`await connection()` のあと `buildReplay(loadGovernance())` を返す。例外は本文を入れずに `{ error: "governance_replay_unavailable" }` と 500（既存の `src/app/api/governance/route.ts` と同じ書き方）
- A4. 試験（`src/lib/governance-replay.test.ts`）：
  - A1 の表の15行それぞれに1つずつ `kind`・`reason`・`judge`・`codex` を確かめる。実例のある13行は実際の票の §6 の行を写した固定の入力、`returned`／`blocked` の `other` の2行は合成の入力を使う
  - 当たらない行：判定のトークンがなければ `kind: "other"`、`reason: null`、`judge: null`、`codex: null`。トークンがあれば `kind: "other"` のまま `judge`・`codex` だけが入る。`APPROVED_EXTRA` は `null`
  - 余分な項目の試験：`detail` に自由な文・SHA・パスを入れ、票に余分な項目（例：`summary`・`extra`）を足した合成の `GovernanceData` で `buildReplay` を作り、トップレベル・票・イベントのキーの集合がそれぞれ A2 と A1 の集合に完全に一致し、合成の文字列が応答のどこにも残らないこと。`kind`・`reason`・`actor`・`judge`・`codex` が列挙値の中にあり、`seq` が 1 から連続すること
  - **漏えいの試験（補助）**：リポジトリの実際の `docs/tasks`（`loadGovernance(process.cwd())`）で `buildReplay` を作り、全票の `events` の配列だけを `JSON.stringify` した結果に、16進の7文字以上の並び（`/[0-9a-f]{7,}/`）、`/`、`files_allowed`、`main=`、`（` のどれも入っていないこと（題には `（` や `/` が入るので、`title` は対象にしない）。票が1枚以上あり、イベントが1つ以上あること。各イベントのキーが A1 の7つちょうどであること
- A5. 返り値の型に `detail` やほかの自由な文の項目がない（`PublicEvent` の項目は A1 の7つだけ）
- A6. `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る

## 3. 開発用テスト

統合の後に、ユーザー役が次を確かめる。

- 一時的な作業ツリーで `GET /api/governance/replay` を開き、T-014 のイベントが `minor_disagreement → blocked(disagreement) → held → released` の順に並ぶ（APPROVED と CHANGES_REQUIRED の値が出る）
- T-002・T-003 に `blocked(return_limit)` が出る
- `events` の中に SHA・パス・日本語の理由の文がない（公開を許した `title` は除く）

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. 分類は、`detail` の先頭の決まった文字列（A1 の表）で判定する。正規表現は表の行ごとに1つ。広い正規表現で文を抜き出さない
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ Codex security。新しいファイルだけで、ほかの票と衝突しない。

## 6. 記録

- 02:28 行政の長が W24 を起動（worktree `agent-a6c176682dbe54d0f`、main e82c150 から、モデルは Opus）。T-029 と並行。仕様はオーナーが 02:27:09 に approve-spec で承認済み（立法補佐の指示の条件を、02:27:43 の Kernel の写しの `approvals[].current` で確かめた）
- W24 の報告：HEAD `856188aaf1338a4b45922df64fad0d897f969a45`。test 400 件（29 ファイル。うち新しい試験 40 件）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:723` で差分の外）。**API は動かしていない**（`npm run dev` は実行していない。`route.ts` は型検査と lint だけで、200 と 500 の経路は未確認。§3 で統合の後に確かめる）。`buildReplay` と `loadGovernance` の組み合わせは vitest で実データに対して試した
- 補った解釈：(1) 判定のトークンは直前が英字・数字・`_` の場合も当てない（`prejudge=APPROVED` は `null`。§2 が書くのは直後だけ）(2) `status → merged_extra` のように続きのある語は `other` にする (3) judiciary は `両方が差し戻し` を含むかで判定し、`judge=` の形は必須にしない (4) 同じ文に同じトークンが複数あれば最初のものを使う。逸脱なし
- §2 より多い試験：実例の 13 行が実際の票の §6 と一致すること、件数の付く judiciary の形（合成）、§3 の T-014 の順序と T-002・T-003 の `return_limit`。実例の一致の試験は、統合済みの票の §6 を書き換えると落ちる
- 拒否された操作：`sed` の置換式の `<sha>/g` がリダイレクトと判定された読み取りの1件（フック、誤検知とみられる）。W24 は `sed` を使わない `grep` で §6 の行を表示した。目的が一部重なるので回避にあたるかの判断を求めた。行政の長の読み：読み取りだけで、書き込みの制限を越えていない
- 02:34 行政の長が差分を確認（`files_allowed` の3つだけ、追加 567・削除 0。`RULES` の 15 行が表の順と kind・reason に一致することを読んだ。route.ts の export は `GET` だけで、例外の本文を応答に入れない。`buildReplay` は3階層とも許可したキーを明示し、スプレッドなし。禁止語・秘密情報の形なし。行政の長は試験と API を自分では動かしていない）。`status: review` で main にコミットし申請。旧い `GET /api/governance` の `detail` は残る（§1 のとおり T-034）

## オーナーに聞くこと

1. 票の題（`title`）は公開の応答に入れる。題は今も `/governance` の票の盤に出ているので、新しく公開するものではない
2. 既存の `GET /api/governance` の `detail` は、この票では変えない（今の画面が使っている）。新しい画面に切り替える T-034 で、今の「票1枚の運命」の区画をどう扱うかを決める

- 2026-11-07T09:40:57+0900 gate-runner: status → review（判定に合格（judge=APPROVED codex=APPROVED）。夜間のため統合せず、朝のオーナーの承認を待つ）

- 2026-11-07T09:44:14+0900 release: status → merged（main=59f82b08895f。夜間の判定に合格した候補 90da0849a2b9 を、オーナーが朝に承認して統合）
