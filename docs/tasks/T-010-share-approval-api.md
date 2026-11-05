---
id: T-010
title: 共有前の本人確認の裏側（共有候補の作成・承認・編集して承認・却下・取り下げ・記録。M9 の裏側）
status: review
requirements: [A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A11]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M9-1, M9-2, M9-3, M9-5, M6-1, D-56]   # 記録用。司法には渡さない
proposal_from: 引き継ぎ §8 の 6（G3 の条件 M1〜M6・M9。D-55 の順「M6・M9」）。2026-11-05 オーナー「票の準備へ」
estimate_h: 1.2
time_limit_min: 75
security_review: true          # 新しい API ルート3本と新しい表
unattended: false              # 2026-11-05 22:5x：昼の作業員で仕上げる（夜間の --allowedTools が [id] のパスに効かない。OBS-049）
branch: worktree-agent-ad2ebcea670275c51   # 昼の作業員のブランチ（4fbc2ad。夜の 6525714 を cherry-pick して仕上げ）。統合キュー（p0.3.1）により main から分岐したまま申請
worker: W1
files_allowed:
  - src/lib/db/schema.sql                    # 表 share_candidates を足す（既存の表は変えない）
  - src/lib/db.test.ts                       # 表の一覧の試験の期待値に1つ足すだけ（A8）
  - src/lib/sharing.ts                       # 新設
  - src/lib/sharing.test.ts                  # 新設
  - src/app/api/sessions/[id]/share/route.ts # 新設：共有候補の作成
  - src/app/api/shares/route.ts              # 新設：本人の記録の一覧
  - src/app/api/shares/[shareId]/route.ts    # 新設：承認・編集して承認・却下・取り下げ
  - src/lib/seed.ts                          # resetDemoData の削除の対象に share_candidates を足すだけ（A11）
  - src/lib/seed.test.ts                     # reset の戻り値の期待値に share_candidates を足すだけ（A11）
files_forbidden:
  - src/lib/sessions.ts                      # getKnowledgeHints は取り下げ済みを既に除く。触らない
  - src/lib/summarize.ts
  - src/lib/summary-schema.ts
  - src/lib/sensitive.ts
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

本人が作業の整理結果（M4）から「チームに共有する要約」を作り、**そのまま承認／編集して承認／却下**を選び、承認したものだけがチームの知恵（`shared_knowledge`。M1-4② と S-4 が読む）に入るようにする。原文のメモは共有しない。承認は**作ったときの整理結果の版**に結び付け、整理をやり直した後の古い候補では承認できない（D-56⑤）。画面（S-3）は別の票。この票は裏側だけ。**認証は作らない**（要件 §10。固定の架空ユーザー）：「本人の候補か」は送られた `userId` と候補の `user_id` の一致で見るだけで、`userId` を偽った利用は防がない（README の「保証できないこと」への記載は README の票で行う。この票では README を変えない）。審査：インパクト30（プライバシーを守って知恵にする）、深さと実行20。

## 2. 受け入れ条件

- A1. `src/lib/db/schema.sql` の末尾に表 `share_candidates` を `CREATE TABLE IF NOT EXISTS` で足す。列はこの順で、型と制約もこのとおり：
  - `id INTEGER PRIMARY KEY AUTOINCREMENT`
  - `session_id INTEGER NOT NULL REFERENCES work_sessions(id)`
  - `user_id TEXT NOT NULL REFERENCES users(id)`
  - `task_name TEXT NOT NULL`
  - `summary_id INTEGER NOT NULL REFERENCES session_summaries(id)`（作ったときの整理結果の版）
  - `draft_body TEXT NOT NULL`（A2 で作った本文）
  - `status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn'))`
  - `action TEXT CHECK (action IN ('approve', 'edit_approve', 'reject'))`（未決定は NULL）
  - `final_body TEXT`（承認後の本文。却下・未決定は NULL）
  - `reject_reason TEXT`（任意。却下のときだけ）
  - `knowledge_id INTEGER REFERENCES shared_knowledge(id)`（承認で作った行）
  - `created_at TEXT NOT NULL`、`decided_at TEXT`、`withdrawn_at TEXT`
  - 索引 `CREATE INDEX IF NOT EXISTS idx_share_user ON share_candidates(user_id, id);` と、同じ版の未決定の候補を1つに限る部分一意索引 `CREATE UNIQUE INDEX IF NOT EXISTS idx_share_pending ON share_candidates(session_id, summary_id) WHERE status = 'pending';`。**既存の5つの表の定義は1文字も変えない**
- A2. `src/lib/sharing.ts` に純粋関数 `buildShareDraft(summary: Summary): string | null` を export する。`SHARE_KEYS = ["struggle", "resolution", "decision_reason", "learning"] as const` も export する。この4項目を**この順**に見て、`itemStatus(item)` が `none` でない項目だけを `【<SUMMARY_LABELS[key]>】<本文>` の1行にし（本文は `item.text` の改行 `\r\n`・`\n`・`\r` をそれぞれ半角空白1つに置き換えたもの）、`\n` で結ぶ（最後に改行を付けない）。`inferred` の項目は行末に `（AI の推測）` を付ける。4項目すべてが `none` なら `null`。`summary` の他の項目（`cause`・`tried`・`unresolved`・`ask_human`・`questions`・`source_note_ids`）は本文に入れない。メモの本文は使わない（引数は `Summary` だけ）
- A3. `createShareCandidate(sessionId: number, userId: string, db = getDb())` を export する。返り値は `{ ok: true; candidate: ShareCandidate; created: boolean } | { ok: false; error: "session_not_found" | "not_your_session" | "session_active" | "no_summary" | "nothing_to_share" }`。判定の順：作業がない → `session_not_found`、`user_id` が違う → `not_your_session`、`status` が `ended` でない → `session_active`、`getLatestSummary` が `null` → `no_summary`、`buildShareDraft` が `null` → `nothing_to_share`。同じ `session_id` と最新の `summary_id` で `pending` の候補がすでにあれば、新しく作らずそれを返す（`created: false`）。なければ `pending` で1行作る（`created: true`。最新の整理の取得から INSERT までを `BEGIN IMMEDIATE`〜`COMMIT` の中で行い、失敗したら `ROLLBACK`。`idx_share_pending` の一意の違反になったら、既存の候補を `created: false` で返す。`task_name` は作業の `task_name`、`created_at` は `nowJst()`）。`ShareCandidate` は A1 の列と同じ名前の項目を持つ型に、`flags: Flag[]`（`detectSensitive(draft_body)` の結果）と `stale: boolean`（A4）を足したもの
- A4. **古い候補**：`stale` は「`status` が `pending` で、その作業の今の `getLatestSummary(session_id)` が `null`（最新の行が読めない場合を含む）か、その `.id` が候補の `summary_id` と違う」とき `true`、それ以外は `false`
- A5. `decideShare(candidateId: number, userId: string, input: { action: "approve" | "edit_approve" | "reject"; body?: string; reason?: string; confirmFlagged?: boolean }, db = getDb())` を export する。返り値は `{ ok: true; candidate: ShareCandidate } | { ok: false; error: ...; flags?: Flag[] }`。**この関数の判定と書き込みは、すべて1つの `BEGIN IMMEDIATE`〜`COMMIT` の中で行う**（失敗・エラーの返却では `ROLLBACK`。判定の後に別の書き込みが割り込まない）。判定の順：候補がない → `share_not_found`、`user_id` が違う → `not_your_share`、`status` が `pending` でない → `already_decided`、`stale` → `stale_candidate`（何も書かない）。そのあと：
  - **最終本文**：`approve` は `draft_body`、`edit_approve` は `(body ?? "").trim()`（前後の空白と改行だけを落とす。行の中と末尾の句点は変えない）。`approve`・`edit_approve` のどちらでも、最終本文が空なら `empty_body`、`.length`（JavaScript の文字列の長さ）が 2000 を超えれば `body_too_long`（長い候補をそのまま承認することはできず、編集して承認する）
  - `approve`・`edit_approve` は本文に `detectSensitive` をかけ、1件以上あって `confirmFlagged` が `true` でなければ `{ ok: false, error: "flagged_body", flags }`（何も書かない。M6-1 の送信前の警告と同じ考え方）
  - 承認：`shared_knowledge` に `(task_name, user_id, session_id, body=最終本文, approved_at=nowJst())` を1行作り、候補を `status='approved'`・`action`・`final_body=最終本文`・`knowledge_id`・`decided_at` にする。候補の更新は `WHERE id = ? AND status = 'pending'` の条件つきで行い、更新した行が1でなければ `ROLLBACK` して `already_decided` を返す
  - `reject`：`shared_knowledge` に書かない。`status='rejected'`・`action='reject'`・`reject_reason`（`(reason ?? "").trim()` が空なら NULL、500文字を超えれば `reason_too_long`）・`decided_at`
- A6. `withdrawShare(candidateId: number, userId: string, db = getDb())` を export する。判定の順：ない → `share_not_found`、`user_id` が違う → `not_your_share`、`status` が `approved` でない → `not_approved`。判定と書き込みは A5 と同じく1つの `BEGIN IMMEDIATE`〜`COMMIT` の中で行う。成功すると、同じ時刻（`nowJst()` 1回）で `shared_knowledge.withdrawn_at` と候補の `withdrawn_at` を書き、候補を `status='withdrawn'` にする（候補の更新は `WHERE id = ? AND status = 'approved'` の条件つき。更新した行が1でなければ `ROLLBACK` して `not_approved`）。取り下げた知識は `getKnowledgeHints` の `teamKnowledge` に出ない（既存の `withdrawn_at IS NULL` による）。`listShareRecords(userId: string, db = getDb()): ShareCandidate[]` を export し、本人の候補を `id` の降順で全件返す（他人の候補は返さない）
- A7. API ルートを3本新設する。body は zod。**`sharing.ts` と3本のルートは `notes` の表を読まない**（共有の本文の出どころは整理結果と、本人が編集で入力した本文だけ）。`console` に本文を出さない。判定の順はルートごとに次のとおり（パスの id は `Number(id)` が `Number.isInteger` でなければ `invalid_id`。既存の `summarize` ルートと同じ）
  - `POST /api/sessions/[id]/share`：`invalid_id` 400 → `invalid_body` 400 → `user_not_found` 404 → 以下。body `{ userId: string(1〜) }`。`createShareCandidate` の失敗は `session_not_found` 404・`not_your_session` 403・`session_active` 409・`no_summary` 409・`nothing_to_share` 422。成功は `created` が true なら 201、false なら 200 で `{ candidate }`
  - `GET /api/shares?userId=…`：パスの id も body もない。クエリの `userId` が空・なし・存在しないユーザーなら 404 `user_not_found`。それ以外は 200 `{ records: listShareRecords(userId) }`
  - `POST /api/shares/[shareId]`：`invalid_id` 400 → `invalid_body` 400 → `user_not_found` 404 → 以下。body `{ userId: string(1〜), action: "approve" | "edit_approve" | "reject" | "withdraw", body?: string(最大4000), reason?: string(最大1000), confirmFlagged?: boolean }`。`withdraw` は `withdrawShare`、ほかは `decideShare`。失敗は `share_not_found` 404・`not_your_share` 403・`already_decided`／`not_approved`／`stale_candidate` 409・`flagged_body` 409（`{ error, flags }`）・`empty_body`／`body_too_long`／`reason_too_long` 400。成功は 200 `{ candidate }`
- A8. `src/lib/db.test.ts` の既存の試験「5つの表ができている」は、**題を「6つの表ができている」に、期待する配列に `"share_candidates"` を名前の順の位置（`"session_summaries"` の後、`"shared_knowledge"` の前）に足す**ことだけを変える（新しい表を足す仕様の変更による。それ以外の既存の `it(` は変えない）
- A9. `src/lib/sharing.test.ts` に、下の①〜⑭を**それぞれ1件以上の `it(`**で試す（合計14件以上。`openDb(":memory:")` と固定ユーザーを使う。整理結果は `session_summaries` に直接 INSERT してよい）：①`buildShareDraft` が4項目の順・`none` を飛ばす・`inferred` に `（AI の推測）`・全部 `none` で `null` ②`createShareCandidate` の5つの失敗（各1回）③同じ版で2回呼ぶと2回目は `created: false` で同じ `id` ④`approve` で `shared_knowledge` に1行でき、`getKnowledgeHints` の `teamKnowledge` に出る ⑤`edit_approve` の本文が `final_body` と `shared_knowledge.body` になる。空の本文は `empty_body` ⑥`reject` で `shared_knowledge` が増えず、2回目の決定は `already_decided` ⑦整理をもう1行足した後の古い候補は `stale: true` で、`approve` が `stale_candidate`（`shared_knowledge` は増えない） ⑧登録語句（`ホクト製菓`）を含む本文の `edit_approve` は `confirmFlagged` なしで `flagged_body`、ありで承認 ⑨`withdrawShare` の後は `teamKnowledge` に出ず、`approved` でない候補は `not_approved` ⑩他人の `userId` は `not_your_share`、`listShareRecords` に他人の候補が出ない ⑪最新の整理の行の `json` が読めない（`getLatestSummary` が `null`）とき、`pending` の候補は `stale: true` で `approve` が `stale_candidate` ⑫`approve` で `draft_body` が 2000 文字を超える候補は `body_too_long` ⑬`item.text` に改行がある整理から作った `draft_body` で、改行が半角空白になっている ⑭途中失敗の巻き戻し：試験の中で `share_candidates` の UPDATE を `RAISE(ABORT, ...)` で失敗させる TRIGGER を作ると、`decideShare` の `approve` と `withdrawShare` は失敗し（例外を投げるか `ok: false`）、`shared_knowledge` の行数・`withdrawn_at` と候補の行は呼び出しの前と同じ
- A10. `npm run -s test`（既存の試験と追加分のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは次の9つだけ：`src/lib/db/schema.sql`、`src/lib/db.test.ts`、`src/lib/seed.ts`、`src/lib/seed.test.ts`、`src/lib/sharing.ts`（新設）、`src/lib/sharing.test.ts`（新設）、`src/app/api/sessions/[id]/share/route.ts`（新設）、`src/app/api/shares/route.ts`（新設）、`src/app/api/shares/[shareId]/route.ts`（新設）
- A11. デモのリセット：`src/lib/seed.ts` の `resetDemoData` が消す表の配列を `["share_candidates", "shared_knowledge", "session_summaries", "notes", "work_sessions"]`（子 → 親の順。`share_candidates` は `shared_knowledge`・`session_summaries`・`work_sessions` を参照するので先頭）にする。`resetDemoData` のそれ以外は変えない。`src/lib/seed.test.ts` の既存の試験「reset：進行中の作業があっても…」の `expect(r.reset).toEqual({ … })` の期待値に `share_candidates: 0` を足すことだけを変える（表を足す仕様の変更による。それ以外の既存の `it(` は変えない）。あわせて `sharing.test.ts` に、承認済みの候補がある DB で `resetDemoData` が外部キーの違反にならず、`share_candidates` が 0 行になる試験を1件以上足す

## 3. 開発用テスト

- `sharing.test.ts`：A9 の観点。DB は `:memory:`、時刻に依存する比較はしない（`nowJst()` の値そのものは比べない）
- ルートはテストしない（既存のルートと同じ）。画面の票（S-3）の後にユーザー役が確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回（`npm install` は使わない）
2. `sharing.ts`：`@/lib/db`（`getDb`）、`@/lib/sessions`（`getSession`）、`@/lib/summarize`（`getLatestSummary`）、`@/lib/summary-schema`（`SUMMARY_LABELS`・`itemStatus`・型）、`@/lib/sensitive`（`detectSensitive`・型 `Flag`）、`@/lib/time`（`nowJst`）。行を `ShareCandidate` に写す関数を1つ作り、`flags` と `stale` はそこで付ける
3. ルートは `src/app/api/sessions/[id]/summarize/route.ts` を見本に（`RouteContext` の型、`invalid_id` の判定）
4. コミットは1つ。メッセージの先頭は `T-010: `

## 5. 統合審査

決定論的な監査（`npm test`・`typecheck`・`lint`）＋ judge ＋ Codex judge ＋ **Codex security**（`security_review: true`。観点：他人の作業・候補に触れないか、原文のメモが応答や共有に出ないか、本文をログに出さないか、入力の検証、2つの書き込みの原子性）。要件は main にコミット済みのこの票の §2（A1〜A11）。T-011 と触るファイルが重ならない。

## 6. 記録

（統合後に追記）

- 2026-11-05T22:50:56+0900 night-runner: 作業員の実装を前検査で確認（HEAD 6525714）。status → review で再申請（試行 1）

- 2026-11-05T22:53:27+0900 gate-runner: status → in_progress（judge=CHANGES_REQUIRED, codex=CHANGES_REQUIRED（両方が差し戻し））
- 23:00 行政の長：昼の作業員 W1 を新しい worktree（main 836733a）で起こし、夜の 6525714 を cherry-pick して仕上げを指示（夜は `[id]` のパスへの書き込みが拒否され A7 のルート2本と A11 が未着手。OBS-049）。worktree `night-T-010` は触らない
- 23:08 W1 の報告：コミット 4fbc2ad（1つに amend。9ファイル、+793/−3）。足したのは A7 のルート2本（`sessions/[id]/share`・`shares/[shareId]`）、A11（seed.ts・seed.test.ts、reset の試験）。夜の実装（A1〜A6・A8・既存の GET）は A 条件と照合して変更なし。test 167（既存 135＋32）・typecheck・lint 合格（警告1件は既存の `vgdd/conformance/run.mjs`）。票にない確認1つ：`withdrawShare` で `shared_knowledge` の UPDATE が1行でなければ ROLLBACK して `not_approved`（夜の実装のまま）。逸脱：件数の確認に `npx --no-install vitest run` を1回使った（ask の例外の範囲だが、約束は `npm test`）。拒否なし
- 23:09 行政の長が差分を確認（`files_allowed` の9ファイルのみ、`notes`・`console` の使用なし、禁止語なし、schema・seed・db.test の差分が A1・A8・A11 どおり）。`status: review` で main にコミットし再申請（差し戻し1回目。gate-runner `--hold`、合格は held、統合は朝に release.sh）

- 2026-11-05T23:12:53+0900 gate-runner: status → review（判定に合格（judge=APPROVED codex=APPROVED）。夜間のため統合せず、朝のオーナーの承認を待つ）
