---
id: T-004
title: 「いまの理解を整理」の API と4区分への並べ替え（M10-1 の裏側）
status: blocked
requirements: [A1, A2, A3, A4, A5, A6, A7]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M10-1, M4-5, D-40]   # 関連する docs/requirements.md の ID（記録用。司法には渡さない）
proposal_from: M10（要件 §5、P-1'。D-40 の4区分、D-44 の P2。2026-11-04 D-55 の順番「M10 →」）
estimate_h: 0.5
time_limit_min: 45
security_review: true          # 新しい API ルート（governance §3.1 の 9 ③）
branch: worktree-agent-ac11a91bf6763b495   # 作業員の元のブランチ（fb4afbc）。申請は main 追従のため cherry-pick した鎖のブランチ（§6）
worker: W1
files_allowed:
  - src/lib/understanding.ts                   # 新設：整理結果を4区分に並べ替える純粋関数
  - src/lib/understanding.test.ts              # 新設
  - src/app/api/sessions/[id]/checkin/route.ts # 新設：進行中の作業の途中整理（保存しない）
files_forbidden:
  - src/lib/summarize.ts                       # partial の経路は既にある。触らない
  - src/lib/summary-schema.ts
  - src/lib/ai/prompt.ts                       # 途中整理の文言は既にある
  - src/app/api/sessions/[id]/summarize/route.ts
  - src/app/api/sessions/[id]/answers/route.ts
  - src/components/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/requirements.md
  - docs/tasks/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: []
---

## 1. 目的

進行中の作業で本人が「いまの理解を整理」を押したときに、それまでのメモを M4 と同じ整理（`summarizeSession` の `partial: true`。保存しない）にかけ、結果を D-40 の区分に並べ替えて返す API。画面（S-1）は T-005 が作る。この票は裏側だけ。M4-5 と同じ追加の質問（最大2問、1問ずつは画面側）に本人が答えると、答えをメモとして保存して整理をやり直す。作業は終了しない。タイマーによる自動実行はしない（M10-1）。審査：インパクト30（30分で気づく）、Claude の活用25。

## 2. 受け入れ条件

- A1. `src/lib/understanding.ts` に純粋関数 `groupUnderstanding(summary: Summary): Understanding` と型を export する：
  - `UnderstandingItem = { key: SummaryKey; label: string; text: string; evidence_note_ids: number[] }`（`label` は `SUMMARY_LABELS[key]`）
  - `Understanding = { confirmed: UnderstandingItem[]; inferred: UnderstandingItem[]; unverified: UnderstandingItem[]; ask_human: UnderstandingItem | null; questions: Summary["questions"] }`
  - `UNDERSTANDING_LABELS = { confirmed: "確認済みの事実", inferred: "AI の推測", unverified: "未確認", ask_human: "人に確認すべきこと" }` を export（D-40：①既知の既知＝確認済みの事実、②既知の未知＝人に確認すべきこと、④未知の未知＝`questions`）
  - 並べ替えの規則：6つの項目 `struggle`・`cause`・`tried`・`resolution`・`decision_reason`・`learning` を **`SUMMARY_KEYS` の順**に見て、`itemStatus()` が `evidenced` → `confirmed`、`inferred` → `inferred`、`none` → `unverified`（`text` は「まだメモにない」に置き換える）。`unresolved` は `none` なら出さず、それ以外は `unverified` の**先頭**に入れる（本文そのまま）。`ask_human` は `none` なら `null`、それ以外は項目として返す。`questions` は `summary.questions` をそのまま返す
- A2. `POST /api/sessions/[id]/checkin` を新設する。body は zod で `{ userId: string(1〜), excludeNoteIds?: number[](最大500), confirmFlagged?: boolean, answers?: { question: string(1〜300), text: string(1〜1000) }[](最大2) }`。判定の順は既存の `summarize` ルートと同じ：`invalid_id` 400 → `invalid_body` 400 → `user_not_found` 404 → `session_not_found` 404 → `not_your_session` 403 → 作業が `active` でなければ 409 `{ error: "session_ended" }`
- A3. `answers` があれば、各答えを**先に**メモとして保存する：`kind: "answer"`、本文は `Q: <question>\nA: <normalizeText(text)>`、`flags_json` は `detectSensitive(text)` の結果（空なら null。既存の `answers` ルートと同じ形）。正規化して空になった答えは飛ばす。`answers` があるのに1件も保存できなければ 400 `{ error: "no_valid_answers" }`。途中整理は `session_summaries` に保存しないので、やり直しの回数（`MAX_RERUNS`）は数えない
- A4. 答えの保存のあと、`flags_json` のあるメモが（`excludeNoteIds` で除かれずに）残っていて `confirmFlagged` でなければ、AI に送らずに 409 `{ error: "flagged_notes", flagged: Note[] }` を返す（M6-1 の送信前の警告。既存の `summarize` ルートと同じ）
- A5. `summarizeSession(sessionId, { partial: true, excludeNoteIds })` を呼ぶ。失敗は `provider_unavailable` → 503、それ以外（`schema_violation`・`no_notes`）→ 422 で `{ error: result.reason, message: result.message }`。成功は 200 `{ understanding: groupUnderstanding(summary), summary, model, attempts, savedNotes: Note[] }`。`session_summaries` には**何も書かない**（`partial: true` のまま。`countSummaries` が変わらない）
- A6. `src/lib/understanding.test.ts` に **5件以上**：①`evidenced` の項目が `confirmed` に `SUMMARY_KEYS` の順で入る ②`inferred` の項目が `inferred` に入る ③`none` の項目が `unverified` に「まだメモにない」で入り、`unresolved`（evidenced）が `unverified` の先頭に入る ④`ask_human` が `none` なら `null`、`evidenced` なら項目 ⑤`questions` が 0 件でも 2 件でもそのまま返る。`Summary` の見本は `summary-schema.test.ts` の作り方を参考にする（`status` は `evidenced`／`inferred`／`none`。古い形は `itemStatus()` が判定する）
- A7. `npm run -s test`（既存 114 件＋追加分）・`npm run -s typecheck`・`npm run -s lint` がすべて通る。差分は `files_allowed` の3ファイルだけ

## 3. 開発用テスト

- `understanding.test.ts`：A6 の5件。純粋関数だけをテストする
- ルートはテストしない（既存のルートも同様）。ユーザー役が統合後に S-1（T-005）から確かめる
- **デモモードの注意**：`DemoProvider` は `partial-<hash>.json` の fixture を探す。いまは `final-*` しかないので、API キーのない環境では 503（「デモモードでは…保存済みの整理結果がありません」）になる。オーナーが `POST /api/dev/capture-fixtures { "partial": true }`（`npm run demo:capture` の partial）で W1〜W3 の途中整理の fixture を採る（この票の範囲外）

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回（`npm install` は使わない）
2. `understanding.ts`：`@/lib/summary-schema` の `SUMMARY_KEYS`・`SUMMARY_LABELS`・`itemStatus`・型 `Summary`・`SummaryKey`・`SummaryItem` を使う。`FACT_KEYS = ["struggle","cause","tried","resolution","decision_reason","learning"]` を定数に。`import` は型と純粋関数だけ（DB・AI に触れない）
3. `checkin/route.ts`：`summarize/route.ts` と `answers/route.ts` を見本に。`getUser`・`getSession`・`listNotes`・`addNote`・`summarizeSession`・`detectSensitive`・`normalizeText`・`groupUnderstanding`。`active` の判定は `session.status !== "active"`
4. コミットは1つ。メッセージの先頭は `T-004: `

## 5. 統合審査

決定論的な監査（`npm test`・`typecheck`・`lint`）＋ judge ＋ Codex judge ＋ **Codex security**（`security_review: true`。観点：認可＝他人の作業に触れないか、本文をログに出さないか、入力の検証）。要件は `requirements_source: ticket` により **main にコミット済みのこの票の §2（A1〜A7）**（`--ticket`）。T-005・T-006 と**並行可**（触るファイルが重ならない。T-005 は応答の形をこの票の A1・A5 に合わせて書く）。

## 6. 記録

（統合後に行政の長が追記）
- 21:52 立法補佐（Pro）が §2 の受け入れ条件を確認（関数名・応答の形・判定の順・テスト件数まで具体的で検証できる。T-004〜T-006 の files_allowed は重ならない。T-007 は T-004〜T-006 の後）。main に固定（D-49②）
- 21:53 W1 起動（worktree `agent-ac11a91bf6763b495`、main 9a9481d から）。21:5x コミット fb4afbc（3ファイル、+207）。報告：test 119（既存 114＋5）・typecheck・lint 合格。解釈：`answers: []` は「なし」扱い（400 にしない）。追加の export：`FACT_KEYS`・`NOT_IN_NOTES_TEXT`。Co-Authored-By は作業員が自分のモデル名（Opus 5.5）にした。拒否1件：自分の worktree への `git -C <worktree>` がフックに「作業フォルダ以外」として止められた（回避せず `-C` なしで実行。OBS 候補）
- 21:59 行政の長が差分を確認（`files_allowed` の3ファイルのみ、禁止語なし、A1〜A7 を確認）。`status: review` で main にコミット。鎖 T-004 → T-005 → T-006 を新しい worktree で積んで申請

- 2026-11-04T22:09:04+0900 gate-runner: status → blocked（judge と Codex の判定が重大な指摘で分かれた（judge=APPROVED/0 件, codex=CHANGES_REQUIRED/1 件）。オーナーの裁定へ）
