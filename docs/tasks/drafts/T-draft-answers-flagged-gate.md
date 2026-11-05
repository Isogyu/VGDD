---
id: T-draft-answers-flagged-gate
title: 追加の質問への答えにも機密の門を置く（answers と checkin：検出のある答えは保存の前に 409、flags の位置を保存する本文に合わせる）
status: draft
requirements: [A1, A2, A3, A4, A5]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M6-1, M4-5, M10-1]   # 記録用。司法には渡さない
proposal_from: 2026-11-06 02:5x アプリの安全の点検（docs/drafts/review-security.md の #1・#2・#8）
estimate_h: 0.6
time_limit_min: 45
security_review: true          # AI に送る前の門
unattended:
branch: null
worker: null
files_allowed:
  - src/app/api/sessions/[id]/answers/route.ts
  - src/app/api/sessions/[id]/checkin/route.ts
  - src/app/api/sessions/[id]/answers/route.test.ts    # 新設（なければ）
  - src/app/api/sessions/[id]/checkin/route.test.ts    # 新設（なければ）
  - src/components/UnderstandingPanel.tsx              # 409 flagged_notes を答えの送信でも扱う
  - src/components/SessionView.tsx                     # 同上（追加の質問の答えの送信）
files_forbidden:
  - src/lib/**
  - src/app/api/sessions/[id]/summarize/route.ts
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

`POST /api/sessions/[id]/summarize` と `checkin` は、要確認（`flags_json` あり）のメモが残っていれば `confirmFlagged` がない限り 409 `flagged_notes` で止め、本人が確かめてから AI に送る（M6-1「送信前の警告」）。しかし **`answers`（追加の質問への答え）にはこの門がなく**、検出のある答えが警告なしに AI へ送られる。`checkin` は答えを**保存した後**に判定するので、409 の後に `confirmFlagged: true` で再送すると同じ答えが二重に保存される。また flags の位置が保存する本文（`Q: …\nA: …`）とずれる。審査：インパクト30（プライバシー）、深さと実行20。

## 2. 受け入れ条件

- A1. `src/app/api/sessions/[id]/answers/route.ts`：`Body` に `confirmFlagged: z.boolean().optional()` を足す。判定の順を次にする：`invalid_id` → `invalid_body` → `user_not_found` → `session_not_found` → `not_your_session` → `no_summary` → `rerun_limit` → **機密の門** → 保存 → 整理。機密の門：`answers` の各 `text`（`normalizeText` の後）を `Q: <q.text>\nA: <text>` の形に組み立てた本文に `detectSensitive` をかけた結果と、既存のメモで `flags_json` があり `excludeNoteIds` に入っていないもの（`summarize` と同じ）を合わせ、1件以上あって `confirmFlagged !== true` なら **保存せずに** 409 `{ error: "flagged_notes", flagged: <既存の要確認のメモ>, flaggedAnswers: [{ questionId, flags }] }` を返す。通れば答えを保存し（`flagsJson` は**組み立てた本文**に対する `detectSensitive` の結果）、`summarizeSession` へ。保存より前に 409 を返すので、再送で二重に保存されない
- A2. `src/app/api/sessions/[id]/checkin/route.ts`：答えの保存を**機密の門の後**に移す。門は A1 と同じ（既存の要確認のメモ＋答えの本文の検出）。`confirmFlagged` がなければ 409 `{ error: "flagged_notes", flagged, flaggedAnswers }` を**保存の前に**返す。通れば保存して整理。`flagsJson` は組み立てた本文に対する結果。`question` も本文に含めて検査する
- A3. 画面：`src/components/UnderstandingPanel.tsx`（答えの送信は `checkin`）と `src/components/SessionView.tsx`（答えの送信は `answers`）で、答えの送信の 409 `flagged_notes` を、整理の実行の 409 と同じ確認の画面（`role="dialog"`、AI に送る前の確認。`UnderstandingPanel` の既存のもの）で扱い、`flaggedAnswers` があれば「答えに機密らしい文字列があります：<describeFlags>」を足す。「このまま送る」で同じ answers に `confirmFlagged: true` を付けて送り直す。既存の確認の画面の文と振る舞いは変えない
- A4. 試験（route の試験が書ける形で。既存の `src/app/api/dev/seed/route.test.ts` の書き方に合わせ、`openDb(":memory:")` に `seedDemo`、provider は mock）：①`answers` に API キーの形の文字列を含む答え → 409 `flagged_notes`、`flaggedAnswers` に `questionId` と `flags`、**`notes` の件数が増えない**、provider の呼び出しが 0 回 ②同じ要求に `confirmFlagged: true` → 保存されて整理が呼ばれる。`notes` は 1 件だけ増える ③`checkin` に検出のある答え → 409 で `notes` が増えない。`confirmFlagged: true` で 1 件だけ増える ④保存された `flags_json` の `start`・`end` が保存した本文（`Q: …\nA: …`）の位置を指す（`body.slice(start, end) === match`）⑤検出のない答えは今までどおり 200
- A5. `npm run -s test`（既存の試験のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは `files_allowed` の最大 6 つ。`summarize/route.ts`・`src/lib/**` は変えない

## 3. 開発用テスト

- A4 の観点。画面はユーザー役が統合の後に、追加の質問の答えに顧客名を入れて確認の画面が出ることを確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. 門の判定を小さな関数にして2つのルートで同じ形に（`src/lib/` は触れないので、ルートの中か、ルートの隣のファイルには置けない。両ルートに同じ関数を書く。共通化は別の票）
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ **Codex security**（観点：検出のある答えが門を通らずに AI へ送られないか、二重保存、`excludeNoteIds` の扱い）。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（4:00 から立法補佐が行う）。（この票は点検前）

## 8. オーナーに聞くこと

1. `answers` の `excludeNoteIds` が省略可で、初回に除いたメモが再送されうる点（review-security #1 の後半）。画面が常に `excludeNoteIds` を送るようにするか、サーバーが前回の除外を覚えるか（後者は表の変更）。この票では画面側（A3）で送る
2. 機能凍結の前に通すか（修正）
