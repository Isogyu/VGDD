---
id: T-draft-share-stale-reject
title: 古くなった共有候補を本人が却下できるようにし、API の本文の上限を lib の定数に合わせる（画面の複製は意図的に残す）
status: draft
requirements: [A1, A2, A3, A4, A5]   # この票の §2（requirements_source: ticket）
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
- A3. `src/app/api/shares/[shareId]/route.ts` の zod の `body`・`reason` の上限（4000・1000）を、`@/lib/sharing` から export する定数 `MAX_BODY_LENGTH`（2000）・`MAX_REASON_LENGTH`（500）に合わせる（`sharing.ts` の L18・L20 にある定数を export する。値は変えない）。route の上限は **trim 前の長さ**で判定する（画面の事前確認と同じ。前後に空白のある 2000 字超の本文は route で `invalid_body` 400）。`ShareReview.tsx` の定数の複製（2000・500）は**触らない**（`sharing.ts` は DB を読むのでクライアントに値を読み込ませない。既存の方針）
- A4. `src/components/ShareReview.tsx` の stale の早期 return（T-014 の A3-3）に、**「却下」ボタンと理由の入力欄だけ**を足す（承認・編集して承認・案・置き換えは出さない）：(a) `STALE_MESSAGE` の文（「整理をやり直したため、この候補は古くなりました。画面を開き直してください」）はそのまま出す (b) 理由の入力欄の `placeholder` は既存と同じ「却下の理由（任意）」、`maxLength` なし、500 字超のとき既存と同じ「理由が長すぎます（500文字まで）」(c) 「却下」の `disabled` は `submitting || reason.length > MAX_REASON_LENGTH`（画面の複製の定数）(d) stale の分岐でも `sendError` の文を既存と同じ形で描く（409 `stale_candidate` を受けた経路の `STALE_MESSAGE` と重ならないよう、`sendError` が `STALE_MESSAGE` と同じ文なら出さない）。却下の送信は既存の `send(candidate.id, { action: "reject", reason }, false)`。成功の表示は既存の決定済みの表示（却下）。**T-014 の票の本文は変えない**（`docs/**` は forbidden。統合のときに行政の長が T-014 の §6 に「stale の却下はこの票で許した」と1行足す）
- A5. `src/lib/sharing.test.ts`：既存の `it(` は**すべて残し**、期待値は次の **2 箇所だけ**変える：⑦（L270 付近。stale の候補の `reject` → `stale_candidate` を期待）を「`rejected` になり `shared_knowledge` は増えない」に、⑫（L313-314 付近。2001 字の `draft_body` の `approve` → `body_too_long`）を「承認され `final_body` が 2001 字、`shared_knowledge` が 1 件増える」に。それ以外の期待値は変えない。新しい試験：①stale の候補を `approve`・`edit_approve` すると `stale_candidate` のまま ②`edit_approve` の `body` 2001 字は `body_too_long`。`npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る。差分のファイルは `files_allowed` の最大4つ

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

**Claude の点検済み、Codex は未点検**（4:00 から立法補佐が行う）。点検役：Claude のサブエージェント（読み取り専用）。03:0x、この票 5 件。対応：#1 既存の試験⑦・⑫が A1・A2 と両立しない → 変える期待値の 2 箇所を列挙（A5）／#2 T-014 の本文の更新は `docs/**` で不可 → 行政の長が §6 に書く（A4）／#3 stale の分岐の `sendError`・`disabled`・`STALE_MESSAGE`・`placeholder` を明記（A4）／#4 題を「route の上限を lib に合わせる、画面の複製は残す」に／#5 route は trim 前の長さで判定と明記（A3）

## 8. オーナーに聞くこと

1. stale の候補を**自動で**却下にする案（新しい版の候補を作るときに旧い pending を `rejected`、理由「整理をやり直したため」）もある。本人の操作を残す（この票）か、自動にするか
2. `approve` の長さの検査の免除でよいか（`draft_body` が 2000 字を超える整理結果は、`shared_knowledge.body` も長くなる）
