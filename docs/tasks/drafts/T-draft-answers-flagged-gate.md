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

- A1. `src/app/api/sessions/[id]/answers/route.ts`：`Body` に `confirmFlagged: z.boolean().optional()` を足す。判定の順を次にする：`invalid_id` → `invalid_body` → `user_not_found` → `session_not_found` → `not_your_session` → `no_summary` → `rerun_limit` → **有効な答えの選別**（`questionId` が最新の整理結果の質問にあり、`normalizeText(text)` が空でないもの。0 件なら 400 `no_valid_answers`）→ **機密の門** → 保存 → 整理。機密の門は**有効な答えだけ**を見る：各答えを `Q: <q.text>\nA: <text>` の形に組み立てた本文に `detectSensitive` をかけた結果と、既存のメモで `flags_json` があり `excludeNoteIds` に入っていないもの（`summarize` と同じ）を合わせ、1件以上あって `confirmFlagged !== true` なら **保存せずに** 409 `{ error: "flagged_notes", flagged: <既存の要確認のメモ>, flaggedAnswers: [{ questionId, flags }] }` を返す。通れば答えを保存し（`flagsJson` は**組み立てた本文**に対する `detectSensitive` の結果）、`summarizeSession` へ。保存より前に 409 を返すので、**409 の再送では**二重に保存されない（保存の後に整理が 422・503 で失敗して再送した場合の二重保存は従来どおりで、この票の範囲外）
- A2. `src/app/api/sessions/[id]/checkin/route.ts`：答えの保存を**機密の門の後**に移す。門は A1 と同じ（既存の要確認のメモ＋有効な答えの本文の検出。`question` も本文に含めて検査する）。`confirmFlagged` がなければ 409 `{ error: "flagged_notes", flagged, flaggedAnswers: [{ index, question, flags }] }`（`index` は `answers` の配列の位置。checkin の答えには `questionId` がない）を**保存の前に**返す。通れば保存して整理。`flagsJson` は組み立てた本文に対する結果
- A3. 画面（2つの部品は別の確認の画面を持つので、別々に書く）：
  - (a) `src/components/UnderstandingPanel.tsx`：答えの送信（`checkin`）は既に `pendingAnswers` を持ち、409 `flagged_notes` のとき確認の画面を出して「このまま送る」で `confirmFlagged: true` の再送をしている。**足すのは**：応答の `flaggedAnswers` を state に持ち、確認の画面に「答えに機密らしい文字列があります：<describeFlags(すべての flags を連結)>」の1行を足す（`describeFlags` は `@/lib/sensitive`）。**`flaggedAnswers` が 1 件以上あるときは「該当メモを除いて送る」を出さない**（答えはまだ保存されておらず `excludeNoteIds` で除けないため。出すと確認が無限に出る）。既存の文と `aria-label` は変えない
  - (b) `src/components/SessionView.tsx`：`submitAnswers` に 409 `flagged_notes` の分岐を足し、新しい state `pendingAnswers: { questionId: string; text: string }[] | null` に送ろうとした答えを保持して、既存の確認の画面（`aria-label="AI に送る前の確認"`）を出す。「このまま送る」は `pendingAnswers` があれば答えの再送（`confirmFlagged: true`、同じ `excludeNoteIds`）、なければ従来の `summarize`。「やめる」で `pendingAnswers` を消す。「該当メモを除いて送る」は (a) と同じく `flaggedAnswers` があれば出さない。`flaggedAnswers` の1行を足す。既存の文と `aria-label` は変えない（ボタンの振る舞いは上のとおり変わる）
- A4. 試験（route を直接呼ぶ。`openDb(":memory:")` は route から見えないので、既存の `src/app/api/dev/seed/route.test.ts` の形に合わせる）：`vi.stubEnv("TSUBUYAKI_DB_PATH", <一時ファイル>)` を**最初の `getDb()` より前**に置き、`getDb()` に対して `startSession`・`addNote`・`endSession` と `session_summaries` への直接 INSERT（`sharing.test.ts` の `insertSummary` の形）で `questions: [{ id: "q1", text, target }]` を持つ最新の整理結果を作る（seed の整理結果は `questions: []` なので使わない）。provider は `@/lib/ai` の `setProviderOverride(mock)` で差し替え、`afterEach` で `setProviderOverride(null)`・`vi.unstubAllEnvs()`。route の第2引数は `{ params: Promise.resolve({ id }) } as RouteContext<…>`。試す項目：①`answers` に API キーの形の文字列を含む答え → 409 `flagged_notes`、`flaggedAnswers` に `questionId` と `flags`、**`notes` の件数が増えない**、mock の呼び出しが 0 回 ②同じ要求に `confirmFlagged: true` → 保存されて mock が 1 回呼ばれる。`notes` は 1 件だけ増える ③`checkin` に検出のある答え → 409 で `notes` が増えない。`confirmFlagged: true` で 1 件だけ増える。`flaggedAnswers[0].index` が 0 ④保存された `flags_json` の `start`・`end` が保存した本文（`Q: …\nA: …`）の位置を指す（`body.slice(start, end) === match`）⑤検出のない答えは今までどおり 200 ⑥`questionId` が未知の答えだけなら 400 `no_valid_answers`（門の前）
- A5. `npm run -s test`（既存の試験のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは `files_allowed` の最大 6 つ。`summarize/route.ts`・`src/lib/**` は変えない

## 3. 開発用テスト

- A4 の観点。画面はユーザー役が統合の後に、追加の質問の答えに顧客名を入れて確認の画面が出ることを確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. 門の判定を小さな関数にして2つのルートで同じ形に（`src/lib/` は触れないので、ルートの中か、ルートの隣のファイルには置けない。両ルートに同じ関数を書く。共通化は別の票）
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ **Codex security**（観点：検出のある答えが門を通らずに AI へ送られないか、二重保存、`excludeNoteIds` の扱い）。`SessionView.tsx` を触る票（T-draft-ui-error-handling）と重なるので、順に統合する（並行しない）。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（4:00 から立法補佐が行う）。点検役：Claude のサブエージェント（読み取り専用。票と実装を突き合わせた）。03:0x、3票あわせて 17 件、この票 6 件。対応：#1 試験の前提（`:memory:` は route から見えない）→ `stubEnv`＋`setProviderOverride`＋`insertSummary` の形に（A4）／#2 `SessionView` は自前の確認の画面で `pendingAnswers` が要る → A3 を (a)(b) に分け、「変えない」は文と `aria-label` に限定／#3 「該当メモを除いて送る」が無限に出る穴 → `flaggedAnswers` があれば出さない（A3）／#4 checkin の `flaggedAnswers` の形 → `{ index, question, flags }`（A2）／#5 `no_valid_answers` の順 → 有効な答えの選別を門の前に（A1・A4⑥）／#6 画面は既に `excludeNoteIds` を常に送っている → §8 を絞る。「再送で二重保存されない」は 409 の再送に限定

## 8. オーナーに聞くこと

1. サーバーが前回の除外（`excludeNoteIds`）を覚える形にするか（表の変更。画面は既に常に送っているので、この票では変えない）
2. 機能凍結の前に通すか（修正）

## Codex の点検（2026-11-06 04:4x、立法補佐が sandbox の外で実行。原文。未反映）

**major 6件、minor 1件。critical の指摘はありません。** 読み取りのみで確認しました。

- **major｜A3(b)：除外時に答えを送る規定がない。** 既存の `SessionView` の「該当メモを除いて送る」は `summarize` を呼びます。機密のない答え＋既存の要確認メモで409になった場合、答えが反映されません。**修正：** `pendingAnswers` があれば、除外IDを加えて `answers` に再送する、と明記。

- **major｜A2：checkin の条件が閉じていない。** 「門はA1と同じ」では、質問IDによる選別や0件時400まで適用するか曖昧です。統合済みT-004では、`answers` 省略・空配列は通常整理、非空配列が正規化後すべて空なら400です。**修正：** この区別、`session_ended` の判定順、`partial: true`・整理結果を保存しないことを§2に明記。

- **major｜A4：DBの試験間分離が不足。** [`getDb()`](src/lib/db.ts:51) は `globalThis` に接続を保持するため、環境変数を戻すだけでは次の一時DBへ切り替わりません。**修正：** ファイル単位で一時DBを共有して各試験前にデータを初期化し、終了時に接続・グローバル参照・一時ファイルを片付ける手順を指定。

- **major｜A4：安全上の主要分岐を試験していない。** 現状の項目では、既存メモの門・除外・質問文だけの検出・他人のセッションへの応答が壊れても通り得ます。**修正：** 両ルートでこれらを追加し、mockに渡るメモが対象セッション内かつ除外後のものだけであること、拒否時は本文を返さず保存・AI呼出しがないことを確認。

- **major｜A3(b)：確認を迂回する既存ボタンが残る。** [`もう一度整理する`](src/components/SessionView.tsx:169) は常に `confirmFlagged: true` を送ります。別のエラー後でも、要確認メモを確認画面なしに送れます。**修正：** 通常の再試行では確認済み扱いにせず、門を通す条件を追加。

- **major｜A1・A2：例外本文の扱いが未規定。** 既存の `summarizeSession` はproviderの例外文を `message` に含め、両ルートが返します。機密を含む例外本文の露出が残ります。またA1の「503」は現行answersでは422です。**修正：** `provider_unavailable` の応答を固定文にし、HTTPステータスを422維持か503へ変更か明記。機密文字列を含む例外で応答に残らない試験を追加。

- **minor｜A3・files_allowed・見積もり：状態の終了処理と工数。** 成功・中止・通常整理開始時の `pendingAnswers`／`flaggedAnswers` の消去が一部未指定です。**修正：** 消去条件を明記。現行6ファイルで実装可能ですが、2ルート・2画面・DB試験基盤まで含む0.6時間／45分は余裕が薄く、再見積もりを推奨します。

**承認に回してよいか：現状は不可。上記majorを§2に反映してから。**