---
id: T-draft-share-stale-reject
title: 古くなった共有候補を本人が却下できるようにし、承認の本文の長さの上限を1か所にする
status: draft
requirements: [A1, A2, A3, A4]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M9-1, M9-2, M9-5]   # 記録用。司法には渡さない
proposal_from: 2026-11-06 02:5x アプリの安全の点検（docs/drafts/review-security.md の #6・#12）
estimate_h: 0.5
time_limit_min: 40
security_review: false
unattended:
branch: null
worker: null
files_allowed:
  - src/lib/sharing.ts
  - src/lib/sharing.test.ts
  - src/app/api/shares/[shareId]/route.ts      # zod の上限を lib の定数に
  - src/components/ShareReview.tsx              # stale の分岐に「却下」だけを出す
files_forbidden:
  - src/lib/db/schema.sql
  - src/lib/sessions.ts
  - src/lib/summarize.ts
  - src/app/api/sessions/**
  - src/components/ShareRecords.tsx
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-014]
---

## 1. 目的

`decideShare` は `action` を見る前に `isStale` で `stale_candidate` を返す。整理をやり直すと旧い版の未決定の候補が stale になり、**承認も却下もできず pending のまま残る**（`/shares` の一覧に出続ける）。新しい版の候補も作られ、1つの作業に pending が2件並ぶ。本人が片付けられるように、stale の候補は **却下だけ**通す。あわせて、`approve` の本文は `draft_body` そのままなのに 2000 字の検査にかかり、`buildShareDraft` が 2000 字を超えると承認できない点と、route（4000・1000）と lib（2000・500）の二重の上限を直す。審査：深さと実行20。

## 2. 受け入れ条件

- A1. `src/lib/sharing.ts` の `decideShare`：`isStale` の判定を **`action` が `approve`・`edit_approve` のときだけ**行う（`reject` は stale でも通す）。却下の処理（`reject_reason`・`decided_at`・`status = 'rejected'`）は今のまま。`DecideShareError` の種類は変えない
- A2. `approve` のとき `finalBody = row.draft_body` の **長さの検査（`body_too_long`）を免除**する（`draft_body` は作成時に `buildShareDraft` が作ったもので、本人が変えていない。`edit_approve` の `body` は今までどおり 2000 字で検査）。`empty_body` と `flagged_body` の検査は `approve` でも今のまま
- A3. `src/app/api/shares/[shareId]/route.ts` の zod の `body`・`reason` の上限（4000・1000）を、`@/lib/sharing` から export する定数 `MAX_BODY_LENGTH`（2000）・`MAX_REASON_LENGTH`（500）に合わせる（定数が export されていなければ `sharing.ts` で export する。値は変えない）。route で上限を超えたときの `error` は `invalid_body`（400）のまま
- A4. `src/components/ShareReview.tsx` の stale の早期 return（T-014 の A3-3）に、**「却下」ボタンと理由の入力欄だけ**を足す（承認・編集して承認・案・置き換えは出さない。T-014 A3-3 の「操作のボタンを出さない」は「置き換えと承認の操作」の意味に読み替え、この票でその文を更新する）。却下の送信は既存の `send(candidate.id, { action: "reject", reason }, false)` と同じ経路。成功の表示は既存の決定済みの表示（却下）。`src/lib/sharing.test.ts` に：①stale の候補を `reject` すると `rejected` になる ②stale の候補を `approve`・`edit_approve` すると `stale_candidate` ③`draft_body` が 2001 字の候補を `approve` すると承認される（`final_body` が 2001 字）④`edit_approve` の `body` 2001 字は `body_too_long`。既存の `it(` と期待値はすべて残す。`npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る。差分のファイルは `files_allowed` の最大4つ

## 3. 開発用テスト

- A4 の観点。画面はユーザー役が、整理をやり直した後に旧い候補を `/sessions/<id>/share` で開いて却下できることを確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。T-014 の統合の後（済み）。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（4:00 から立法補佐が行う）。（この票は点検前）

## 8. オーナーに聞くこと

1. stale の候補を**自動で**却下にする案（新しい版の候補を作るときに旧い pending を `rejected`、理由「整理をやり直したため」）もある。本人の操作を残す（この票）か、自動にするか
2. `approve` の長さの検査の免除でよいか（`draft_body` が 2000 字を超える整理結果は、`shared_knowledge.body` も長くなる）
