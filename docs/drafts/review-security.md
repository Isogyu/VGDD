# アプリの点検：安全と不具合（読むだけ）

> 下書き（2026-11-06 02:5x）。点検役：Claude のサブエージェント（読み取り専用。`src/lib/*.ts`・`src/lib/ai/*.ts`・`src/app/api/**/route.ts`・`schema.sql`・`registered-terms.json` を全文読んだ。`vgdd/`・`.claude/`・Z3 は読んでいない）。行政の長が報告を整えた。**直すのは票にしてから**（作業員は起こしていない。票の下書きは §3）。行番号は 2026-11-06 02:4x の main のもの。Codex は未点検。

## 1. 指摘（重い順。critical なし、major 6・minor 9）

| # | 重さ | 箇所 | 問題 | 再現 | 直し方の案 |
|---|---|---|---|---|---|
| 1 | major（安全） | `api/sessions/[id]/answers/route.ts` L36-46 | 追加の質問への答えは `detectSensitive` で flags を付けて保存するが、`summarize`・`checkin` にある「要確認のメモが残っていれば 409 `flagged_notes`」の門がなく、そのまま AI に送る。`excludeNoteIds` も省略可で、初回に除いたメモが再送されうる | 答えに API キーの形の文字列 → 保存され、警告なしに Claude へ | `summarize/route.ts` L31-35 と同じ `flagged` の判定（`confirmFlagged` を body に）を `summarizeSession` の前に |
| 2 | major（不具合） | `api/sessions/[id]/checkin/route.ts` L41-56 | 答えを先に保存してから `flagged` を判定して 409。再送（`confirmFlagged: true`）で答えのメモが二重に保存される。409 の応答に `savedNotes` がない | checkin に検出のある答え → 409 → 再送 → 同じ Q/A が 2 件 | 判定を保存の前に。または 409 に `savedNotes` を含めクライアントが answers を落とす |
| 3 | major（漏えい） | `lib/ai/capture.ts` L22-29・34、`api/dev/capture-fixtures/route.ts` L11-14 | 整理の fixture の採取が**今の開発 DB**の新人A の最新の終了済みの作業のメモを実 API に送り、出力を `demo-fixtures/` に保存する（リポジトリに入る）。`capture-extras.ts` L207-209 はメモリ DB に seed だけで採る（方針が違う）。`body.tasks` の要素の型を見ていない | オーナーが同じ作業名で実際のメモを付けた後に `npm run demo:capture` → 合成でないメモが API に送られ、要約が fixture として公開リポジトリに残りうる | `captureFixtures` も `openDb(":memory:")`＋`seedDemo` の DB を使う。`tasks` を `z.array(z.string().min(1).max(200)).max(10)` |
| 4 | major（安全） | `lib/summarize.ts` L64・83・88 → `summarize` L40・`checkin` L62・`answers` L48 | provider の例外の `e.message` を応答の `message` に入れる。L88 は SDK の HTTP エラー等で、API の応答の本文や request id を含みうる。`procedure.ts`・`ai-sensitive.ts` は固定文 | — | L88 を固定文（`procedure.ts` の `PROVIDER_FAILED_MESSAGE` と同じ） |
| 5 | major（安全） | `api/dev/seed/route.ts` L8-16、`api/dev/capture-fixtures/route.ts` L9-11 | `capture-extras` は `Origin` のある要求を 403 にするが、`seed`・`capture-fixtures` には Origin も Content-Type の判定もない。開発サーバーを立てている間に別サイトのページから `fetch(".../api/dev/seed", { method: "POST", mode: "no-cors", body: '{"reset":true}' })` で開発 DB の全行が消える。`capture-fixtures` は実 API の課金を起こせる。例外の `e.message` も返す | 別サイトからの no-cors の POST | 3 ルートで `checkCaptureRequest` 相当（404 → 403 Origin → 415 → 400）を共通化。例外は固定の `error` 名だけ |
| 6 | major（不具合） | `lib/sharing.ts` L168-170・86-89 | `decideShare` は action を見る前に `isStale` で `stale_candidate` を返す。整理をやり直すと旧い版の pending が stale になり、承認も却下もできず pending のまま残る。新しい版の pending も作られ、1 セッションに pending が 2 件並ぶ | 整理 → 共有候補 → 整理をやり直す → 旧い候補を却下できない | stale でも `reject` は通す。または新しい版の候補を作るときに旧い pending を `rejected`（理由固定）に |
| 7 | minor（同時実行） | `lib/summarize.ts` L50-52・95-99 | `countSummaries > MAX_RERUNS` の確認と INSERT の間に `await provider.summarize` がある。同時の 2 要求が両方通る | — | INSERT の直前（同期の区間）で再確認 |
| 8 | minor（不具合） | `answers/route.ts` L40-42、`checkin/route.ts` L45-47 | 保存する本文は `Q: …\nA: …` だが flags は `text` に対して計算し、位置がずれる。checkin の `question` は検査されない | — | 組み立てた `body` に `detectSensitive` |
| 9 | minor（一貫性） | `end` L29 `already_ended` vs `notes`・`checkin` `session_ended`／`answers` L48 `provider_unavailable` が 422（ほかは 503）／`errors ?? null` vs `?? []`／`sessions`・`notes` だけ `issues` を返す／zod の `i.message` と `i.code` の混在 | 同じ失敗に違う名前と status | — | error 名と status の対応表を 1 か所に |
| 10 | minor（一貫性） | `notes/route.ts` L26-28 ほか | 判定の順が route ごとに違う（入力 → user、user → 入力、API キー → body、body → API キー） | — | 順を 1 つに決める |
| 11 | minor（不具合） | `lib/sessions.ts` L112-115・160-162 | 「前回」の定義が 2 つ（`ended_at < w.ended_at` と `ended_at < s.started_at`）。force 開始で前の `ended_at` が新しい `started_at` と同じ値になり、`getPreviousSummary` が飛ばす | 同じ作業名を force で続けて開始 | `<=` と `id <> ?` にするか、条件を共有 |
| 12 | minor（境界） | `lib/sharing.ts` L18・186-188、`shares/[shareId]/route.ts` L13-14 | `approve` の `finalBody` は `draft_body` で、`buildShareDraft` は 2000 字を超えうる → `approve` が `body_too_long`。route の上限 4000/1000 と lib の 2000/500 の二重 | 長い整理結果 | `approve` は長さ検査を免除、または上限を lib に寄せる |
| 13 | minor（境界） | `lib/sessions.ts` L126 | `listHistory(…, 1000).find(...)` で 1000 件超の古い作業の `history` が `undefined` | — | id を条件にした 1 件取得 |
| 14 | minor（プロトタイプ） | `lib/governance.ts` L153-154 | `byAgent[k] = …` の鍵が `__proto__` だと own property にならない（入力はリポジトリ内の `summary.json` で危険は低い） | — | `Object.create(null)` か `Map`、鍵を `/^[A-Za-z0-9_-]+$/` で選別 |
| 15 | minor（一貫性） | `lib/ai/sensitive-provider.ts` L82 vs `claude.ts` L15・`procedure-provider.ts` L104 | Claude クライアントの `timeout`・`maxRetries` が違う（30 秒・1 回 vs 既定 10 分・2 回） | — | 共通の生成関数 |

## 2. 問題のなかった観点

SQL はすべてプレースホルダー／`console` の使用なし、`parseInt` なし、ID は `Number()`＋`isInteger`／`notes` の漏えい経路なし（`sharing`・`team-knowledge`・`procedure`・`ai-sensitive` は notes を読まない。プロンプトに入るのは共有の本文だけ）／パスの組み立ては作業名・本文のハッシュ、`governance.ts` は固定名＋lstat＋O_NOFOLLOW／`development` 専用の 3 ルートは `NODE_ENV` で 404／共有の作成・決定・取り下げは `BEGIN IMMEDIATE`／日時は `+09:00` 固定の ISO 文字列／AI の出力は 3 系統とも zod strict＋根拠の範囲検査＋1 回のやり直し／決定論的な検出は AI で減らない

## 3. 票の下書きの候補（§1 から。小さくまとまる単位）

| 票の案 | 含む指摘 | 範囲 | security_review |
|---|---|---|---|
| **A 開発用ルートの門を共通化**（優先） | #3・#5（＋#9 の例外の本文） | `src/lib/ai/capture.ts`（メモリ DB に）、`api/dev/seed/route.ts`・`api/dev/capture-fixtures/route.ts`（`checkCaptureRequest` を使う）、試験 | true |
| **B 追加の質問の答えの機密の門** | #1・#2・#8 | `api/sessions/[id]/answers/route.ts`・`checkin/route.ts`、`UnderstandingPanel.tsx`（409 の扱い）、試験 | true |
| **C 失敗の文を固定に** | #4・#9 の `message`・#15 | `lib/summarize.ts`、3 ルート、`lib/ai/claude.ts`（共通の生成関数）、試験 | false |
| **D 共有候補の stale の遷移** | #6・#12 | `lib/sharing.ts`、`sharing.test.ts`、route の上限 | false |
| 小修正 | #7・#10・#11・#13・#14 | 各 1〜数行 | false |

票 A は**漏えいと破壊の経路**（開発サーバーを立てている間だけだが、デモの録画中に起きうる）なので最優先。票の下書きは `docs/tasks/drafts/T-draft-dev-routes-guard.md`（F-5 で作成）。

## オーナーに聞くこと

1. 票 A を 11/7 の機能凍結の前に通すか（機能ではなく修正）
2. #6 の直し方：stale でも却下を通す（本人が片付けられる）か、新しい版を作るときに旧い pending を自動で却下にするか
