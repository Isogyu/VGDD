---
id: T-draft-m12-interview-api
title: M12 先輩インタビューの裏側（Claude が先輩に1問ずつ聞き、答えを共有候補にして M9 の承認を通す。表・関数・API）
status: draft
requirements: [A1, A2, A3, A4, A5, A6, A7, A8, A9]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M12（D-44②）, M5-3, M9-1, M9-3, M9-4, M6-1, M6-4]   # 記録用。司法には渡さない
proposal_from: 2026-11-06 02:3x 行政の長の下書き（28_night_plan_max.md §1 C-1）。D-44②「Claude が先輩に1問ずつ聞き、未知の既知を M5 の判断のポイントへ」。承認済みの共有として入る経路は M9（共有候補 → 本人の承認）を通す。画面は別の票 T-draft-m12-interview-screen
estimate_h: 1.5
time_limit_min: 90
security_review: true          # 新しい API ルート・外部 API の呼び出し・表の追加
unattended:
branch: null
worker: null
files_allowed:
  - src/lib/db/schema.sql                     # interviews・interview_turns を追加、share_candidates の session_id・summary_id を NULL 可に、interview_id を追加
  - src/lib/sharing.ts                        # ShareRow の型と isStale だけ（A5）
  - src/lib/interview.ts                      # 新設：開始・質問・答え・終了（共有候補の作成）
  - src/lib/interview.test.ts                 # 新設
  - src/lib/ai/interview-provider.ts          # 新設：Claude・demo・mock の provider とプロンプト
  - src/app/api/interviews/route.ts           # 新設：POST（開始）・GET（一覧）
  - src/app/api/interviews/[id]/question/route.ts   # 新設：POST
  - src/app/api/interviews/[id]/answer/route.ts     # 新設：POST
  - src/app/api/interviews/[id]/finish/route.ts     # 新設：POST
files_forbidden:
  - src/lib/sessions.ts
  - src/lib/procedure.ts
  - src/lib/sensitive.ts
  - src/lib/ai/provider.ts
  - src/lib/ai/claude.ts
  - src/lib/ai/demo.ts
  - src/lib/ai/prompt.ts
  - src/lib/ai/index.ts
  - src/lib/seed.ts
  - src/app/api/shares/**
  - src/app/api/sessions/**
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

先輩が持つ「手順書に書いていない判断の理由」（要件 §3 の先輩C）を、Claude が**1問ずつ**聞いて引き出し、答えを**共有候補**にする。候補は M9 と同じく本人（先輩）が承認・編集して承認・却下し、承認したものだけが `shared_knowledge` に入る（M9-1・M9-3）。承認済みの共有は T-012 の `listProcedureSources` が拾い、T-015 の S-4 で手順書の原案と判断のポイントになる（M5-3）。AI に送るのは**作業名・その作業の承認済みの共有・このインタビューの問いと答え**だけで、メモ（`notes`）は送らない。審査：Claude の活用25（対話で暗黙知を引き出す）、インパクト30。

## 2. 受け入れ条件

- A1. `src/lib/db/schema.sql` に次を足す（既存の表の列の順は変えない。**既存の DB ファイルは `CREATE TABLE IF NOT EXISTS` では変わらないので、`npm run seed -- --reset` か DB ファイルの削除で作り直す。README に書く**）：
  - `interviews (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id), task_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')), ai_done INTEGER NOT NULL DEFAULT 0 CHECK (ai_done IN (0,1)), started_at TEXT NOT NULL, ended_at TEXT, candidate_id INTEGER REFERENCES share_candidates(id))`、索引 `idx_interviews_user ON interviews(user_id, status)`、**`CREATE UNIQUE INDEX idx_interviews_active ON interviews(user_id) WHERE status = 'active'`**（1人1つを DB で守る。同時の2要求でも片方は UNIQUE 違反）
  - `interview_turns (id INTEGER PRIMARY KEY AUTOINCREMENT, interview_id INTEGER NOT NULL REFERENCES interviews(id), seq INTEGER NOT NULL, question TEXT NOT NULL, answer TEXT, asked_at TEXT NOT NULL, answered_at TEXT, UNIQUE (interview_id, seq))`
  - `share_candidates`：`session_id` と `summary_id` を **NULL 可**に、`interview_id INTEGER REFERENCES interviews(id)` を足し、CHECK の式は **`CHECK ((session_id IS NOT NULL AND summary_id IS NOT NULL AND interview_id IS NULL) OR (session_id IS NULL AND summary_id IS NULL AND interview_id IS NOT NULL))`**。索引 `CREATE UNIQUE INDEX idx_share_pending_interview ON share_candidates(interview_id) WHERE status = 'pending' AND interview_id IS NOT NULL`（未決定のインタビューの候補は1つだけ。既存の `idx_share_pending (session_id, summary_id)` は NULL 同士を別と扱うので、インタビューの候補はこの索引で守る）。SQLite では NOT NULL の外しと CHECK の追加は表の作り直しになるので、`schema.sql` の `CREATE TABLE IF NOT EXISTS share_candidates (...)` の定義を書き換える（既存の DB には効かない。上の「作り直す」）
  - 作業員は、`share_candidates` の `session_id`・`summary_id` を**非 NULL として読んでいるコード**を `grep -rn -E "session_id|summary_id" src/lib/sharing.ts src/lib/*.ts src/app/api/shares src/components/ShareReview.tsx src/components/ShareRecords.tsx` で探し、型の変更で `typecheck` が落ちる箇所が `files_allowed` の外にあれば**止まって報告する**（票の範囲を広げない）
- A2. `src/lib/ai/interview-provider.ts` に次を export する：`InterviewInput = { taskName: string; approvedShares: string[]; turns: { question: string; answer: string }[]; previousErrors?: string[] }`（`approvedShares` の各要素は**先頭 600 文字**に切る。最大 20 件。`turns` は答えのある turn だけ）、`InterviewOutput = { raw: string; model: string }`、`InterviewProvider = { readonly name: "claude" | "demo" | "mock"; ask(input: InterviewInput): Promise<InterviewOutput> }`、`ClaudeInterviewProvider`（`@anthropic-ai/sdk` を `new Anthropic({ apiKey, timeout: 30000, maxRetries: 1 })`、モデルは `./claude` の `CLAUDE_MODEL`、`max_tokens` 400、`system` は `INTERVIEW_SYSTEM_PROMPT`、`user` は `buildInterviewPrompt(input)`。キーがなければ `./provider` の `ProviderUnavailableError`）、`DemoInterviewProvider`（`constructor(dir = FIXTURE_DIR)`。`src/lib/demo-fixtures/interview-<作業名の SHA-256 の16進の先頭16文字>-<turns.length>.json`（`{ model, raw }`）を読む。ない・読めないなら `ProviderUnavailableError`「デモモードでは、この作業のインタビューの保存済みの質問がありません」）、`getInterviewProvider()`（`resolveProviderName()` が `claude` なら Claude、それ以外は demo）、試験用の `setInterviewProviderOverride(p | null)`、`INTERVIEW_SYSTEM_PROMPT`（日本語。守ること：JSON だけを返す／形は `{ "question": "<100文字以内の1問>" }` か `{ "done": true }`／聞くのは「手順書に書いていない判断の理由・失敗しやすい箇所・確認すべき相手」の3つのどれか／すでに承認済みの共有に書いてあることは聞かない／前の答えを踏まえて深める／5問目までに `done` を返す／個人名・顧客名・金額を聞かない）、`buildInterviewPrompt(input)`。プロンプトに入れてよいのは固定の指示と出力の形、`input.taskName`、`input.approvedShares`（本文だけ）、`input.turns`、`input.previousErrors` だけ
- A3. `src/lib/interview.ts` に次を export する（`db = getDb()` を最後の引数に取る）：
  - **共通の所有の確認**（`nextQuestion`・`answerQuestion`・`finishInterview`・`getInterviewTurns`）：`interviews` の行がなければ `interview_not_found`、`user_id` が `userId` と違えば `not_your_interview`。`userId` は要求の body の申告（既存の API と同じ方式。限界は §8）だが、**役割（`role`）と所有は必ず DB から引く**（クライアントの申告を信じない）。文字数はすべて JavaScript の `.length`（UTF-16 の単位）で数える
  - `startInterview(userId: string, taskName: string, db): { ok: true; interview: Interview } | { ok: false; error: "user_not_found" | "not_senior" | "empty_task" | "task_too_long" | "interview_active" }`。`users` に行がなければ `user_not_found`、`users.role` が `senior` でなければ `not_senior`。`task_name` は `@/lib/commands` の `normalizeTaskName`（**export 済み。`sessions.ts` も同じものを import している**）で正規化し、**正規化の後**に空なら `empty_task`、80 文字を超えれば `task_too_long`。INSERT が `idx_interviews_active` の UNIQUE 違反なら `interview_active`（確認してから INSERT ではなく、**INSERT の失敗で判定**する。同時の2要求でも1つしか作られない）
  - `nextQuestion(interviewId: number, userId: string, opts: { provider?: InterviewProvider } = {}, db): Promise<NextQuestionResult>`。`NextQuestionResult = { ok: true; done: false; turn: InterviewTurn; model: string; attempts: number } | { ok: true; done: true; model: string; attempts: number } | { ok: false; error: "interview_not_found" | "not_your_interview" | "interview_ended" | "ai_done" | "unanswered_turn" | "max_turns" | "provider_unavailable" | "schema_violation"; message?: string; attempts: number }`。順に：所有の確認 → `status` が `ended` → `interview_ended` → `ai_done` が 1 → `ai_done`（provider を呼ばない。画面は終了へ誘導）→ 答えのない turn がある → `unanswered_turn` → **turn の総数（答えの有無を問わず）が 5 件** → `max_turns`（provider を呼ばない）。provider に渡す入力は `{ taskName, approvedShares, turns }`（`approvedShares` は `shared_knowledge` の同じ `task_name` で `withdrawn_at IS NULL` の `body` を `approved_at` の昇順で最大 20 件、各 600 文字に切る。`turns` はこのインタビューの答えのある turn だけ。**`notes`・`session_summaries`・`share_candidates`・ほかのインタビューの表は読まない**）。出力は `raw` が文字列なら `@/lib/summary-schema` の `extractJson` を通し、zod の **strict** で `{ question: string(1〜100) } | { done: true }`（余分な鍵があれば違反。`__proto__` 等も余分な鍵として落ちる。出力から DB に入るのは `question` の本文だけで、ほかの列は変えない）。違反なら `previousErrors`（zod の issue の `path: code` だけ。AI の出力の値は入れない）を付けてもう1回だけ（合計2回）。2回とも違反なら `schema_violation`（`message`「AI の質問を読めませんでした」）。`ProviderUnavailableError` は `provider_unavailable`（`message`「AI が使えません（API キーがない、またはデモの保存済みの質問がありません）」）。ほかの例外は `provider_unavailable`（`message`「AI の呼び出しに失敗しました」）。**`message` は固定の文だけ**で、例外の文・AI の生出力・zod の文を含めない。`question` が返れば `interview_turns` に `seq = turn の総数 + 1` で INSERT して返す（UNIQUE 違反なら `unanswered_turn` を返す＝同時の要求が先に作った）。`done` が返れば `interviews.ai_done = 1` に UPDATE して `done: true`
  - `answerQuestion(interviewId: number, userId: string, turnId: number, answer: string, db): { ok: true; turn: InterviewTurn } | { ok: false; error: "interview_not_found" | "not_your_interview" | "interview_ended" | "turn_not_found" | "already_answered" | "empty_answer" | "answer_too_long" }`。所有の確認の後、`turn` が **この `interviewId` に属していなければ** `turn_not_found`（他人のインタビューの turn を turnId だけで書けない）。`answer.trim()` が空なら `empty_answer`、280 文字を超えれば `answer_too_long`。`UPDATE interview_turns SET answer = ?, answered_at = ? WHERE id = ? AND interview_id = ? AND answer IS NULL` の**変更件数が 1 でなければ `already_answered`**（確認と書き込みを分けない）
  - `finishInterview(interviewId: number, userId: string, db): { ok: true; candidate: ShareCandidate } | { ok: false; error: "interview_not_found" | "not_your_interview" | "interview_ended" | "no_answers" }`。所有の確認の後、答えのある turn が 0 件なら `no_answers`。`draft_body` は決定論的に作る：答えのある turn を `seq` の昇順に、1件を `「<question>」→ <answer>` の1行にして改行で結ぶ（**AI は使わない。要約・書き直しもしない**。最大 5 件 × (100＋280＋4) ＝ 1,920 文字 ≤ 2000）。トランザクションで、まず `UPDATE interviews SET status = 'ended', ended_at = ? WHERE id = ? AND status = 'active'` の変更件数が 1 でなければ `interview_ended`（二重の終了で候補を2つ作らない）、次に `share_candidates` に `(interview_id, user_id, task_name, draft_body, status 'pending', created_at)` を INSERT（`session_id`・`summary_id` は NULL）、`interviews.candidate_id` を UPDATE し、`@/lib/sharing` の `getShareCandidate(id)`（なければこの票で `sharing.ts` に足す読むだけの関数）で返す
  - `listInterviews(userId: string, db): Interview[]`（その `userId` の行だけ。`id` の降順）、`getInterviewTurns(interviewId: number, userId: string, db): InterviewTurn[] | null`（所有の確認に落ちれば `null`。`seq` の昇順）
- A4. 共有候補の決定（承認・編集して承認・却下・取り下げ）は**既存の `decideShare`・`withdrawShare`・`POST /api/shares/[shareId]`** をそのまま使う（この票では変えない）。承認で `shared_knowledge` に入る行の `session_id` は NULL（表の定義は元から NULL 可）、`task_name`・`user_id`・`body`・`approved_at` は候補の値
- A5. `src/lib/sharing.ts` の変更は次の2点だけ：`ShareRow`・`ShareCandidate` の `session_id`・`summary_id` を `number | null` に、`interview_id: number | null` を足す（既存の export の名前と引数は変えない）／`isStale` は `summary_id` が `null` なら **false**（インタビューの候補は古くならない）。`createShareCandidate`・`listShareRecords` のほかの振る舞いは変えない（既存の `sharing.test.ts` の `it(` と期待値はすべて残す）
- A6. API を4本新設する。body は zod の strict、判定の順は既存の `/api/shares/[shareId]` に合わせる（`invalid_id` 400 → `invalid_body` 400 → `user_not_found` 404 → lib の結果）。失敗の応答は **`{ error }` か `{ error, message }`** で、`message` は lib の固定の文だけ。例外の本文・AI の生出力・zod の文を応答に入れない。`console` に `answer`・`draft_body`・`approvedShares`・`question` を出さない：
  - `POST /api/interviews` `{ userId: string(1〜), taskName: string(1〜) }` → 201 `{ interview }`
  - `GET /api/interviews?userId=…` → 200 `{ interviews, turns }`。`interviews` は `listInterviews(userId)`、`turns` は**その userId のインタビューの分だけ**を `{ [interviewId]: InterviewTurn[] }` の形に（`Map<number, InterviewTurn[]>` から `Object.fromEntries`。鍵は数値の id。JSON.parse した値をほかのオブジェクトにマージしない）。`userId` がなければ 400 `invalid_query`
  - `POST /api/interviews/[id]/question` `{ userId }` → 200 `{ done: false, turn, model, attempts }` か `{ done: true, model, attempts }`
  - `POST /api/interviews/[id]/answer` `{ userId, turnId: number(整数), answer: string }` → 200 `{ turn }`
  - `POST /api/interviews/[id]/finish` `{ userId }` → 200 `{ candidate }`
  - **エラーと HTTP の対応表**（画面の票はこの表を参照する）：

    | HTTP | `error` |
    |---|---|
    | 400 | `invalid_id`、`invalid_body`、`invalid_query`、`empty_task`、`task_too_long`、`empty_answer`、`answer_too_long` |
    | 403 | `not_senior`、`not_your_interview` |
    | 404 | `user_not_found`、`interview_not_found`、`turn_not_found` |
    | 409 | `interview_active`、`interview_ended`、`ai_done`、`unanswered_turn`、`max_turns`、`already_answered`、`no_answers` |
    | 422 | `schema_violation`（`message` あり） |
    | 503 | `provider_unavailable`（`message` あり） |

  - `Interview` の形：`{ id, user_id, task_name, status: "active" | "ended", ai_done: 0 | 1, started_at, ended_at: string | null, candidate_id: number | null }`。`InterviewTurn`：`{ id, interview_id, seq, question, answer: string | null, asked_at, answered_at: string | null }`
- A7. 決定論的な検出（M6-1）：`finishInterview` が作る `draft_body` にも、既存の `toCandidate` が `detectSensitive` をかける（`flags` が付く）。承認の送信で機密らしい文字列が残っていれば、既存の `flagged_body`（409）と `confirmFlagged` の規則がそのまま効く。この票で新しい検出の規則は足さない
- A8. `src/lib/interview.test.ts` に、下の①〜⑮を**それぞれ1件以上の `it(`**で試す（`openDb(":memory:")` に `seedDemo`、provider は `mock`）：①新人A（`newcomer`）が開始すると `not_senior`、先輩C（`senior_c`）は開始できる ②同じ先輩が2つ目を開始すると `interview_active`（DB の UNIQUE 違反で判定） ③mock が `{ question }` を返すと turn が1件でき `seq` が 1、`approvedShares` に W1 の承認済みの共有の本文（seed の2件）が入り、**`notes` の本文・ほかのユーザーの `pending` の `draft_body`・ほかのインタビューの turn が入らない**（試験の中で別に作って確かめる） ④答えのない turn があると次の質問は `unanswered_turn` ⑤turn が5件（答えの有無を問わず）の後は `max_turns` で provider の呼び出しが0回 ⑥壊れた出力の後に正しい出力なら `attempts: 2`、2回とも壊れていれば `schema_violation`、`previousErrors` に AI の出力の値が入らない ⑦`ProviderUnavailableError` は `provider_unavailable` で `message` に例外の文が入らない ⑧281 文字の答えは `answer_too_long`、空白だけは `empty_answer` ⑨答えが0件で `finishInterview` は `no_answers` ⑩2問答えて終了すると `share_candidates` に `interview_id` 付き・`session_id` NULL の `pending` が1件でき、`draft_body` が「「<q1>」→ <a1>\n「<q2>」→ <a2>」と一致し、`interviews.status` が `ended`。**もう一度 `finishInterview` を呼ぶと `interview_ended` で候補は増えない** ⑪その候補を `decideShare(approve)` すると `shared_knowledge` に `session_id` NULL・`user_id` `senior_c` の行ができ、`listProcedureSources(task)`（`@/lib/procedure`）が 3 件になる（seed の2件＋1件）。`withdrawShare` で外れる ⑫`isStale` がインタビューの候補で false、既存の `sharing.test.ts` の `it(` がすべて残っている ⑬**他人のインタビュー**：別の先輩（試験の中で `users` に `senior_d` を INSERT してよい）が `nextQuestion`・`answerQuestion`・`finishInterview`・`getInterviewTurns` を呼ぶと `not_your_interview`（`getInterviewTurns` は `null`）、他人の turn の `turnId` を自分のインタビューに渡すと `turn_not_found` ⑭`done` を受けると `ai_done` が 1 になり、次の `nextQuestion` は `ai_done` で provider の呼び出しが0回 ⑮同じ turn に2回答えると2回目は `already_answered`（UPDATE の変更件数で判定）
- A9. `npm run -s test`（既存の試験と追加分のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは `files_allowed` の9つだけ

## 3. 開発用テスト

- `interview.test.ts`：A8 の観点。Claude の API は呼ばない。デモ用の fixture（質問の保存）の採取は T-020 の仕組みを広げる別の票
- 既知の限界：`finishInterview` の `draft_body` は問いと答えの素朴な連結。文章として整えるのは本人の「編集して承認」に任せる（AI で整えると M9-1 の「本人の確認」の前に本文が変わる経路になるため、この票ではしない）

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. 構成は T-017 の `src/lib/ai/sensitive-provider.ts`・`src/lib/ai-sensitive.ts` を見本に（provider・demo・override・やり直し・固定の失敗の文）
3. `schema.sql` の変更は末尾に追記せず、該当の表の定義を直す（`CREATE TABLE IF NOT EXISTS` のまま）
4. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ **Codex security**（観点：`notes` を AI に送らないか、他人のインタビューを操作できないか、先輩以外が開始できないか、例外の本文、入力の上限）。T-draft-m12-interview-screen と触るファイルが重ならない。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（Codex は sandbox の中から呼べない。4:00 から立法補佐が行う）。点検役：Claude のサブエージェント（ツールなし）。02:3x、2票あわせて指摘 12 件（critical 2・major 7・minor 3）。この票への対応：

| # | 指摘 | 対応 |
|---|---|---|
| 1 | `turnId` だけで他人の turn に書ける。所有の確認が明記されていない | A3 に「共通の所有の確認」。`answerQuestion` は turn がこのインタビューに属するか、`getInterviewTurns` は所有に落ちれば `null`、`GET` は本人の分だけ。試験⑬ |
| 2 | 認可が body の `userId` の申告だけ | 既存の方式と明記し、役割と所有は DB から引く。限界を §8 に |
| 3 | 同時実行で「1人1つ」「seq」「already_answered」「二重の終了」が破れる | `idx_interviews_active`（UNIQUE 部分索引）、INSERT の失敗で判定、`UPDATE … WHERE answer IS NULL` の変更件数、`UPDATE … WHERE status='active'` の変更件数。試験⑩⑮ |
| 4 | `max_turns` と `unanswered_turn` が閉じていない。`done` の後が不明 | `max_turns` は turn の総数で判定。`done` は `interviews.ai_done = 1` に書き、次は `ai_done` で provider を呼ばない。試験⑭ |
| 5 | 外部 API に送る範囲（他の先輩の承認済みの本文、未承認の答え）と上限 | 各本文 600 文字・20 件、`turns` は自分のインタビューだけ。試験③に他人の pending と他のインタビューを足す。送ってよいかを §8 に |
| 6 | `normalizeTaskName` の出どころ、長さの判定の前後、文字数の数え方 | `@/lib/commands`（export 済み）。正規化の後に判定。`.length` で統一 |
| 7 | `idx_share_pending` が NULL を別扱い、CHECK の式があいまい、SQLite の表の作り直し、型変更の波及 | CHECK の式を明記、インタビュー側の UNIQUE 部分索引、`CREATE TABLE` の定義を書き換える、`grep` で波及を確かめて外にあれば止まる |
| 8 | 応答・ログに生出力・zod の文・本文を出さない | A6 に明記。`previousErrors` は `path: code` だけ |
| 9 | strict と `__proto__`、出力から DB に入るのは `question` だけ | A3 に明記 |
| 12 | エラーと HTTP の対応表、`Interview`・`InterviewTurn` の形 | A6 に表と形を追加。画面の票はこれを参照 |

## 8. オーナーに聞くこと

1. `share_candidates` の `session_id`・`summary_id` を NULL 可にする表の変更を認めるか（既存の DB は作り直しが要る。デモの DB は seed で作り直せる）
2. 質問の上限 5 問、答えの上限 280 文字、`draft_body` は問いと答えの連結（AI で整えない）でよいか
3. インタビューの開始を先輩（`role: senior`）に限るか、新人にも開くか（下書きは先輩だけ。D-44②の文のとおり）
4. **外部 API（Claude）に送るもの**：同じ作業名の**ほかの人の承認済みの共有の本文**（各 600 文字まで）と、**本人のまだ承認していない答え**を送ってよいか（M9 の「承認したものだけが共有される」は人への共有の規則で、AI への送信は M4 の整理と同じ扱いになる。要件の解釈をオーナーに）
5. 認可は既存の API と同じく body の `userId` の申告に依る（ログインなし。要件 §4）。なりすましの限界をそのままにするか
6. `done` の後に本人が「もう1問」を求める経路は作らない（`ai_done` で止める）でよいか
