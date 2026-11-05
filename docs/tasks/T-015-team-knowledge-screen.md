---
id: T-015
title: S-4 チームの知恵の画面（承認済みの共有の一覧と、手順書の原案・判断のポイント。M5・C2 の画面）
status: in_progress
requirements: [A1, A2, A3, A4, A5, A5b, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M5-1, M5-2, M5-3, M5-4, M9-3, C2, D-62]   # 記録用。司法には渡さない
proposal_from: 2026-11-05 昼の進め方。T-012（M5 の裏側）の画面。C2（チームへの公開ビュー）を兼ねる
estimate_h: 1.0
time_limit_min: 60
security_review: true          # 新しい API ルート1本
unattended: false
branch: worktree-agent-a456af914ff963843   # 差し戻し対応の作業員のブランチ（main 49eb404 から、266083a を cherry-pick）。統合キュー（p0.3.1）により main から分岐したまま申請
worker: W8
files_allowed:
  - src/lib/team-knowledge.ts              # 新設：承認済みの共有の一覧（読むだけ）
  - src/lib/team-knowledge.test.ts         # 新設
  - src/app/api/knowledge/team/route.ts    # 新設
  - src/components/TeamKnowledge.tsx       # 新設：S-4 の本体
  - src/app/knowledge/page.tsx             # 新設
files_forbidden:
  - src/lib/procedure.ts
  - src/lib/ai/**
  - src/lib/sessions.ts
  - src/lib/db/schema.sql
  - src/app/api/knowledge/route.ts
  - src/app/api/procedures/**
  - src/components/WorkScreen.tsx
  - src/components/SessionView.tsx
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-012]
---

## 1. 目的

チームの次の人が、作業名ごとに**本人が承認した共有だけ**を読み、2件以上あれば手順書の原案と判断のポイント（T-012）を作って根拠つきで見られる画面（S-4）。承認していない内容・取り下げた内容は出さない（M9-3）。審査：インパクト30（暗黙知の引き継ぎ）、デモ25（新人A と先輩C の共有から原案ができる場面）。

## 2. 受け入れ条件

- A1. `src/lib/team-knowledge.ts` に `listTeamKnowledge(db = getDb()): { task_name: string; items: { id: number; display_name: string; role: "newcomer" | "senior"; approved_at: string; body: string }[] }[]` を export する。`shared_knowledge` を `users` と結び、`withdrawn_at IS NULL` の行だけを、`task_name` の昇順でまとめ、各まとまりの中は `approved_at` の昇順・`id` の昇順。共有が0件の作業名は出さない。**`notes`・`session_summaries`・`share_candidates` の表は読まない**
- A2. `GET /api/knowledge/team` を新設する。引数を取らず、200 で `{ groups: listTeamKnowledge() }`。例外は 500 `{ error: "knowledge_unavailable" }`（例外の本文を応答に入れない）
- A3. `/knowledge`（`src/app/knowledge/page.tsx`。中身は `TeamKnowledge` のクライアント部品。`src/app/sessions/[id]/page.tsx` と同じく `Suspense` で包む）に、見出し「チームの知恵」と1行「本人が承認した共有だけを表示しています（原文のメモは表示しません）」。作業名ごとに、共有を `display_name`（先輩は「先輩」のバッジ）・承認日時（`MM/DD HH:MM`）・本文の順に並べる。共有が1件もなければ「まだ承認された共有はありません」。一覧は開いたときに `fetch(…, { cache: "no-store" })` で取り、「最新の状態に読み直す」ボタンで取り直す。表示は**取った時点**のもので、そのことを「<取得した時刻 HH:MM> 時点」と表示する。読み直したら、作ってあった原案はすべて消す。取得に失敗したら「チームの知恵を読めませんでした」
- A4. 各作業名に「手順書の原案を作る」ボタン。押すと `POST /api/procedures` を `{ taskName }` で呼ぶ（作業中は「作成中…」で押せない）。成功したら：
  1. 応答の `notice`（「原案。利用前に本人・先輩の確認が必要」）を、原案の上に**常に**表示する（M5-4）
  2. 「手順」：`procedure.steps` を番号付きの一覧に。各項目の後ろに根拠（`evidence` の `display_name`・`MM/DD HH:MM` を「・」で結ぶ）。`inferred` が true なら根拠の代わりに「AI の推測」のバッジ
  3. 「判断のポイント」：`procedure.decision_points` を一覧に。各項目は `text`、その下に「なぜ：<reason>」、根拠は 2 と同じ。0件なら「判断のポイントは見つかりませんでした」
  4. 「（model）で作成」と小さく表示（`demo(…)` ならデモモードと分かる）
- A5. 失敗の表示：`insufficient_records` は応答の `message` をそのまま（「記録が不足しています（…）」）、`too_large` は「共有が多すぎるため作れません」、`provider_unavailable` は応答の `message`、`schema_violation` は「AI の出力を整理できませんでした。もう一度試してください」、`sources_changed` は応答の `message`（このとき、その作業名の前の原案は消す）、ほかの応答と通信の失敗は「原案を作れませんでした」。どの失敗でも「作成中…」を解く
- A5b. `TeamKnowledge` は `@/lib/procedure`・`@/lib/team-knowledge` を**型だけ** `import type` で使い、実行時の import はしない（DB・AI を読むモジュールのため）。`POST /api/procedures` の成功の応答は `{ procedure, model, attempts, notice }`。共有の本文と原案は React の文字列としてだけ描画し（`dangerouslySetInnerHTML` を使わない）、`console`・`localStorage`・ほかの保存先に書かない
- A6. `src/lib/team-knowledge.test.ts` に、下の①〜④を**それぞれ1件以上の `it(`**で試す（`openDb(":memory:")`、`shared_knowledge` に直接 INSERT してよい）：①取り下げ済みの共有は出ない ②作業名ごとにまとまり、作業名の昇順・各まとまりは承認日時の昇順 ③`display_name` と `role` が `users` から入る ④共有のない作業名は出ない。あわせて `npm run -s test`（既存の試験と追加分のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは次の5つだけ（すべて新設）：`src/lib/team-knowledge.ts`、`src/lib/team-knowledge.test.ts`、`src/app/api/knowledge/team/route.ts`、`src/components/TeamKnowledge.tsx`、`src/app/knowledge/page.tsx`

## 3. 開発用テスト

- `team-knowledge.test.ts`：A6 の観点。画面はユーザー役が統合の後に確かめる（W1 で新人A と先輩C が承認した後に原案を作る）。デモモードの原案の fixture の採取は別の票

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回（`npm install` は使わない）
2. `procedure.ts` は変えない（A5b）
3. 見た目は既存の画面（Tailwind、zinc 系、「原案」の注意は amber、「AI の推測」のバッジは S-2 と同じ見た目）に合わせる
4. コミットは1つ。メッセージの先頭は `T-015: `

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ **Codex security**（観点：未承認・取り下げ済みが出ないか、原文のメモを読まないか、例外の本文を出さないか）。要件は main にコミット済みのこの票の §2（A1〜A6）。T-012 の統合の後に着手する。T-014 と触るファイルが重ならない。

## 6. 記録

（統合後に追記）
- 23:40 行政の長が W6 を起動（worktree `agent-a9b7f50fdcfb584fa`、main 11c86a8 から）。依存の T-012 は 23:25 に release で統合済み。T-014 は依存の T-011 が差し戻し中のため未着手
- 23:44 W6 の報告：コミット 266083a（新設5ファイル、+442。所要約10分）。test 204（既存 198＋6）・typecheck・lint 合格（警告1件は既存の `vgdd/conformance/run.mjs`）。T-012 の型・応答・`error` 名は §2 と一致。票の解釈：根拠が複数のときは「根拠：」を付けて「、」で並べる、応答に `notice` がなければ T-012 と同じ固定の文を出す、読み直しの後に届いた原案は捨てる。拒否2件（scratchpad への Write、`git -C` の add。どちらも worktree の外・`git -C` の規則どおりで、回避せず worktree 内の plain な git で代替）。画面の描画は未確認（統合後にユーザー役が W1 の流れで確かめる）
- 23:45 行政の長が差分を確認（`files_allowed` の5ファイルのみ、すべて新設。`listTeamKnowledge` は `shared_knowledge` と `users` だけを読み `withdrawn_at IS NULL`、並びは task_name・approved_at・id の昇順。route は例外で `knowledge_unavailable` だけを返す。部品は `@/lib/procedure`・`@/lib/team-knowledge` を `import type` だけ、`dangerouslySetInnerHTML`・`console`・`localStorage` なし。試験は①〜④に `it(` 6件）。`status: review` で main にコミットし申請（security_review: true。gate-runner `--hold` なら合格は held、統合は release.sh）

- 2026-11-05T23:48:58+0900 gate-runner: status → in_progress（セキュリティ審査が差し戻し）
- 00:1x 立法補佐からの伝達（オーナー経由）：Codex security の指摘は major 1件（A4）。`TeamKnowledge.tsx` が作業名を普通のオブジェクトのキーにしており（`drafts`・`busy`・`errors`）、作業名が `constructor`・`toString` 等だと継承のプロパティを拾って画面が壊れる。直し方：Map か `Object.create(null)` の辞書で所有のプロパティだけを読む。§2 は変えない
- 00:13 行政の長が W8 を起動（worktree `agent-a456af914ff963843`、main 49eb404 から）。266083a を cherry-pick し、3つの辞書を Map に直して1コミットに amend、`team-knowledge.test.ts` に作業名が `constructor`・`__proto__` でもまとまる試験を足せるなら足す指示。W6 の worktree `agent-a9b7f50f…` は触らない
