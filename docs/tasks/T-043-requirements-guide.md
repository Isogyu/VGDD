---
id: T-043
title: 初心者向けの要件確認（/requirements）を足す。固定の質問・回答・未解決の事項・受け入れ条件の候補を LLM から独立したデータで持ち、票の下書きの文を出す
status: review
requirements: [A0, A1, A2, A3, A4, A5, A6, A7]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-66, D-67]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐が起草（オーナーの承認前）。全範囲の設計（docs/drafts/vgdd-full-scope-design.md）§6
estimate_h: 3
time_limit_min: 210
security_review: true          # 新しい API とローカルのデータ。外へ出さない・Z3 に触れないことを確かめる
unattended: false
branch: worktree-agent-a35928ef1988ceaae
worker: W45
files_allowed:
  - src/lib/requirements/questions.ts                 # 新設：固定の質問の型
  - src/lib/requirements/model.ts                     # 新設：完成度・未解決の一覧・下書きの文・AI の提案の検証（純粋関数）
  - src/lib/requirements/model.test.ts                # 新設
  - src/lib/requirements/store.ts                     # 新設：node:sqlite のローカルの保存（別のファイル）
  - src/lib/requirements/store.test.ts                # 新設
  - src/app/api/requirements/route.ts                 # 新設：一覧・作成
  - src/app/api/requirements/[id]/route.ts            # 新設：取得・回答の保存・AI の提案の取り込み
  - src/app/requirements/page.tsx                     # 新設：画面の入口
  - src/components/requirements/RequirementsGuide.tsx # 新設：画面の部品
  - src/components/requirements/RequirementsGuide.test.tsx # 新設
files_forbidden:
  - src/lib/db.ts                                     # 題材のアプリの DB は使わない・変えない
  - src/lib/db/**
  - src/lib/ai/**                                     # アプリの AI の呼び出しは使わない
  - src/lib/governance*.ts
  - src/lib/kernel-*.ts
  - src/lib/theater-*.ts
  - src/components/theater/**
  - src/components/GovernanceView.tsx
  - src/app/governance/**
  - src/app/api/governance/**
  - src/app/layout.tsx
  - docs/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-034]
---

## 1. 目的

全範囲の設計の新しいペルソナ（仮説・未検証）は、業務は分かるがコードの良し悪しは判断できない業務改善の担当者。その人が、業務の言葉で困りごとを書き、固定の質問に答えていくと、目的・正しい結果の例・反例・制約・対象外・未解決の事項が整理され、票の下書きの文ができる画面を作る。**データは LLM から独立**させ、AI がなくても使える。AI の補助（不足の指摘・追加の質問・受け入れ条件の候補）は、オーナーが端末で動かす別の道具（法律の改正 L2 の `req-assist.sh`）の結果を「AI の提案」の欄に取り込むだけで、この画面から AI を呼ばない。承認は今の `approve-spec.sh` のままで、この画面は承認の状態を表示するだけ。審査：インパクト30、デモ25。

## 2. 受け入れ条件

- A0. 差分を許すパスは次の10個だけ：`src/lib/requirements/questions.ts`、`src/lib/requirements/model.ts`、`src/lib/requirements/model.test.ts`、`src/lib/requirements/store.ts`、`src/lib/requirements/store.test.ts`、`src/app/api/requirements/route.ts`、`src/app/api/requirements/[id]/route.ts`、`src/app/requirements/page.tsx`、`src/components/requirements/RequirementsGuide.tsx`、`src/components/requirements/RequirementsGuide.test.tsx`。それ以外は変更しない。依存を足さない（DB は Node の組み込みの `node:sqlite`）。題材のアプリの DB（`src/lib/db.ts`）と AI の呼び出し（`src/lib/ai/`）は使わない
- A1. **固定の質問**（`questions.ts`）：`QUESTIONS` を export する。段階は `problem`（課題）・`behavior`（動作）・`constraints`（制約）・`review`（確認）の4つ。各質問は `{ id, stage, text, required }`。少なくとも次を含む（`id` と `required` はこのまま、文は業務の言葉で）：`problem.who`（誰が困るか、必須）、`problem.when`（いつ・どの場面で）、`problem.goal`（どうなればよいか、必須）、`behavior.input`（入力）、`behavior.example`（正しい結果の具体例、必須）、`behavior.counter`（こうなってはいけない例＝反例）、`behavior.error`（失敗したとき）、`constraints.data`（扱うデータの種類）、`constraints.external`（外部への送信）、`constraints.out_of_scope`（対象外、必須）
- A2. **純粋関数**（`model.ts`。React と `node:` を import しない）：
  - 回答の形は、質問の id から `{ text: string, unknown: boolean }` への対応（未知の質問の id・余分な鍵は拒む）
  - `completeness(answers)`：必須の質問がすべて「`unknown` が false で、`text.trim()` が空でない」か。`{ ready: boolean, missing: 質問の id の配列 }`。「わからない」は充足にしない
  - `unresolved(record)`：必須の未回答、本人が「わからない」と答えた質問、AI の提案のうち本人が採否を決めていないもの、を並べた未解決の一覧
  - `draftTicketText(record)`：`completeness` が `ready` のときだけ、票の下書きの文（Markdown）を返す。中身は「1. 目的」（課題・場面・ゴールの回答を並べる）と「2. 受け入れ条件の候補」（正しい結果の例を候補にし、反例があればそれも候補にする。番号は実際に出した候補に「A1.」から連番。反例が未回答なら候補を作らず、未解決に「反例が未確認」と出す）と「未解決の事項」と、先頭に「この下書きに効力はない。票にするのは立法補佐、承認するのはオーナー（approve-spec）」の1行。`ready` でなければ `null`
  - `parseAiSuggestions(json, record)`：AI の提案の取り込みの検証。形は `{ schema: "vgdd.requirements-assist.v1", record_id, answers_version, suggestions: [{ kind: "missing" | "question" | "criterion", target: 質問の id か null, text: 1〜500字 }]（最大 30） }`。`record_id` と `answers_version` が今の記録と合わなければ `null`（古い回答への取り込みを拒む）。余分な項目・形の違いは `null`
- A3. **保存**（`store.ts`、サーバー側だけ）：DB のファイルは環境変数 `VGDD_REQUIREMENTS_DB_PATH`、なければ `data/vgdd-requirements.db`（既定の `.db` と SQLite の副ファイルは今の ignore の規則で Git に入らない）。永続の DB の指定は `.db` の拡張子に限る。DB を開く前にパスを正規化し、記号リンクの先も含めて、Z3（`~/tsubuyaki-z3` と `VGDD_Z3_DIR`）の下・題材のアプリの DB（`data/tsubuyaki.db`）と一致する指定は固定のエラーで拒む（試験の `:memory:` は許す）。SQL は値をバインドする。回答の版の比較・更新・版の加算は1つのトランザクションで行う。表は要件の記録1つ（`id`・題・作成の時刻・回答の JSON・`answers_version`（回答を保存するたびに1つ増える）・AI の提案の JSON・提案ごとの採否・結び付けた票の ID（`T-NNN` か null））。試験では `:memory:` を使う。入力の上限：題 100 字、1つの回答 2,000 字、AI の提案の JSON 32KB
- A4. **API**（`src/app/api/requirements/`）：
  - `GET /api/requirements`（一覧：id・題・時刻・`ready` だけ）、`POST /api/requirements`（題だけで作る）
  - `GET /api/requirements/[id]`（記録の全体）、`PUT /api/requirements/[id]`（回答の保存。`answers_version` を受け取り、今の値と違えば 409 で拒む）、`POST /api/requirements/[id]`（本文が AI の提案の JSON のとき `parseAiSuggestions` で検証して取り込む。合わなければ 400。提案ごとの採否の更新もここで受ける）
  - **ローカルの要求だけ**：すべてのメソッドで、DB に触れる前・本文を読む前に、要求の URL と `Host` が loopback（`localhost`・`127.0.0.1`・`[::1]`）でなければ 403。更新（POST・PUT）は、さらに `Origin` が同じ origin であることと `Content-Type: application/json` を求め、欠けている・違うときは 403・415。CORS の許可は足さない
  - **本文の形**：PUT は `{ answers_version, answers, linked_ticket_id }`（`linked_ticket_id` は null か `T-` と ASCII の数字3〜4桁）。POST の本文は、AI の提案の取り込み（`{ action: "import", suggestions: <A2 の形> }`）と採否の更新（`{ action: "decide", answers_version, suggestions_version, index, decision: "accepted" | "rejected" | "pending" }`）を `action` で分ける。存在しない記録は 404、形の違いは 400
  - **版**：AI の提案の取り込みは、トランザクションの中で最新の `answers_version` に対して検証し直して保存し、`suggestions_version` を1つ増やす。回答を変えたら、前の提案と採否を無効にする。古い `answers_version`・`suggestions_version` の採否の更新は 409
  - **大きさ**：更新の本文は UTF-8 で 32,768 バイトまで。読みながら数え、`Content-Length` の有無によらず超えたら 413
  - この票で新しく作るモジュールとその経路は、外部への通信・AI の呼び出し・子プロセスの起動・Z3 の読み書きをせず、AI の資格情報を受け取らない。応答とログに、本文・提案・SQL・環境変数・絶対パス・例外の本文を出さず、内部のエラーは固定のエラーの符号で返す
  - 運用はローカル（loopback に bind した環境）だけ。司法は、`Request` を直接渡す試験で、外の `Host`・別の origin・`Origin` の欠け・JSON でない本文・大きすぎる本文の拒否を判断する（ポートの bind の試験は求めない）
- A5. **画面**（`/requirements`、`RequirementsGuide`、`"use client"`）：
  - 記録の一覧と「新しく始める」。記録を開くと、段階ごとに質問を出し、回答を保存できる。各質問に「わからない」を選べる
  - 右（狭い画面では下）に、`completeness` と `unresolved` の結果をいつも出す（「下書きにできない：必須の未回答 n 件」など）
  - 「AI の提案を取り込む」の欄（JSON を貼る）。取り込んだ提案は「AI の提案」と明記して本人の回答と分けて出し、提案ごとに「採る」「採らない」を選べる。採っても回答は自動では書き換えない（本人が回答に書き写す）
  - 「票の下書き」：`draftTicketText` の文を出し、コピーできる（ファイルや Z3 には書かない）
  - 「AI の補助に渡す材料」：記録の JSON（`record_id`・`answers_version`・質問と回答）を出してコピーできる。オーナーが端末で別の道具に渡す
  - 承認の状態：記録に結び付けた票の ID があれば、`GET /api/governance/kernel` の応答の `state.approvals` を読み、その票が `current: true` なら「承認済み（写しの上で）」、false なら「承認が古い」、一覧にないなら「写しに承認の記録がない」（未承認とは断定しない）、取得の失敗・`state` が null・形の違いは「写しがない」と出す。写しの `generated_at` が 10 分より前か不正なら「古い写し」を添える。この表示は承認の操作にも効力の判断にも使わない
  - 画面のどこにも「承認する」ボタンを置かない。データはすべて合成で試す旨を1行出す
- A6. 試験：`model.test.ts`（`completeness`（「わからない」は充足しない）・`unresolved`・`draftTicketText` が ready でないと null・反例がないとき候補を作らない・`parseAiSuggestions` の版の不一致・余分な項目・上限）、`store.test.ts`（`:memory:` で作成・保存・`answers_version` の不一致で拒む・同じ版での2つの保存は片方だけ通る・回答を変えると提案が無効になる・Z3 や題材の DB を指すパスを拒む・上限）、API の試験（`store.test.ts` か `model.test.ts` の中で、ルートの関数に `Request` を直接渡す：外の `Host`・別の origin・`Origin` の欠け・JSON でない本文・32,768 バイトを超える本文・存在しない記録・古い版）、`RequirementsGuide.test.tsx`（`renderToStaticMarkup` の初期の表示に「承認する」がないこと、見出し）
- A7. `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る

## 3. 開発用テスト

held の後、立法補佐が候補で確かめる（build は作業員の sandbox で動かないので、立法補佐が行う）：合成の業務課題（架空の会社の請求書の確認）で、質問に答え、未解決の一覧が減り、必須がそろうと票の下書きの文が出ること。AI の提案の JSON（合成）を取り込み、古い `answers_version` の JSON を拒むこと。`npm run build` が通ること。375px で横スクロールしないこと。

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. A1・A2（純粋関数と試験）→ A3 と試験 → A4 → A5 と試験
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ Codex security。ほかの票とファイルが重ならないので、並行でよい。

## 6. 記録

- 23:52 行政の長が W40 を起動（worktree `agent-a63c5d0f33ec9eeef`、main f4c3403 から、モデルは Opus。T-040 の W38・T-042 の W39 と並行。D-67 の同時3体の枠の中）。仕様はオーナーが 23:50:01 に approve-spec で承認済み（23:51:40 の Kernel の写しの `approvals[].current` で確かめた）。依存の T-034 は統合済み。作業員の起動は Kernel の窓口の外（法律の改正 L2 の配置の前のため、予算の管理の外）
- W40 の報告：HEAD `fb146daeca3b73b0523123f5421525cb45c9f2b9`、f4c3403 の上に1コミット。test 1003 件（52 ファイル。新しい試験は model 20・store と API 26・画面 4）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:875` の `stopsDir` で差分の外）
- 行政の長の確認（試験は再実行していない）：差分は A0 の10ファイルだけ（+2458）。新しいファイルに `@/lib/db`・`@/lib/ai`・`child_process`・`console.` はない（git grep）。画面の `fetch` は `/api/requirements*` と `/api/governance/kernel` だけ。画面に「承認する」の文字はない。2つの `route.ts` は、どのメソッドも最初に `checkLoopback`（要求の URL の hostname と `Host` の両方が loopback）を通し、更新は `checkUpdateHeaders`（`Origin` が欠け・`"null"`・別の origin なら 403、`Content-Type` が `application/json` でなければ 415）、本文は `readJsonBody`（ストリームを読みながら数え、32,768 バイトを超えた時点で 413。`Content-Length` は見ない）。内部のエラーは固定の符号だけを返す
- W40 が「§2 から外れる解釈」として挙げたもの：既存の API の `connection()` を使わない（行政の長の「既存の流儀に合わせる」の指示から外れる）。理由は、`connection()` が要求の外で例外を投げ、A4 の `Request` を直接渡す試験で GET が必ず 500 になること、POST・PUT を export するルートは Next.js がビルド時に静的に固めないこと（`hasNonStaticMethods`）。行政の長の判断：§2 は `connection()` を定めていないので、§2 の範囲内とした。静的に固められないことは build で未検証
- 読み方が割れる所（W40 の選んだ読み方）：(1) 「回答を変えたら、前の提案と採否を無効にする」は、回答の中身が変わったときだけ無効にする（票の ID だけを変えた保存では提案を残す）。`answers_version` は保存のたびに増やすので、その後は古い版の材料で作った提案の JSON は拒まれる (2) 「反例が未確認」は、下書きの「未解決の事項」と `unresolved()` の結果（画面の右の欄）の両方に出す (3) `parseAiSuggestions` の `json` は、貼った文字列と解析済みの値の両方を受ける (4) 文字数の「字」はコードポイントで数える（画面の `maxLength` は UTF-16 で数えるので、画面の上限は同じかより厳しい）
- 補った解釈（文面の範囲内）：(1) 入口の検査の関数は `store.ts`（サーバー側だけ）に置く（ルートのファイルは決まった名前しか export できないため） (2) `suggestions_version` の列を足す（A4 が求める）。取り込み・採否の更新・回答の変更による無効化で増やすので、同じ版での2回目の採否は 409 (3) 範囲外の採否の番号は 400 (4) 画面に「未決定に戻す」のボタン（`decision: "pending"`） (5) `Origin` は、要求の URL の origin と同じ、host が `Host` と同じ、文字列が origin の直列化そのもの（パス付きは拒む）。`Content-Type` の charset は utf-8 だけ (6) 本文が UTF-8 として正しくなければ 400 (7) `Host` の末尾の点・空のポート・利用者の情報は拒み、大文字は許す (8) DB のパスの検査に `TSUBUYAKI_DB_PATH` も入れる。Z3 との比較は大文字と小文字を区別しない。正規化だけの形と記号リンクを解いた形の両方で比べる (9) 検査を通った指定についてだけ、DB を開く前に親のフォルダを作る (10) 記録の ID は UUID。形の違う ID は DB に触れずに 404 (11) 空白だけの提案は拒む。提案 0 件の取り込みは許す (12) 承認の状態は、記録を開いたときと票の ID を変えて保存したときに1回だけ取る（定期には取らない）。未来の `generated_at` は「古い」としない (13) 応答に `Cache-Control: no-store`
- **確かめていない**：実際のブラウザでの操作（質問に答える・未解決が減る・下書きが出る・AI の提案の取り込みと古い版の拒否・採否・コピー）、実サーバーでの API（Next.js の dev・start で `req.url` の host が `Host` から作られるか。食い違えば正しい要求も 403 になる。ブラウザが同じ origin の PUT・POST に `Origin` を付けるか）、375px での収まり、`npm run build`（`connection()` なしで静的に固められないこと、バンドラーが `node:sqlite` を扱えること、cacheComponents の下で `/requirements` を prerender できること）、dev の HMR で DB が何度も開かれないか。残る限界として、パスの検査と DB を開く間の記号リンクの差し替え（TOCTOU）。§3 で立法補佐が held の候補で確かめる

## オーナーに聞くこと

1. 画面は `/requirements`（ローカルだけで動かす）。トップの画面や `/governance` からの導線は、別の票で足す
2. 初心者が本当に使えるかは未検証。開発の経験のない人に試してもらうまで、README では「仮説」と書く

- 2026-11-08T00:14:54+0900 gate-runner: status → in_progress（セキュリティ審査が差し戻し）
- 03:1x 差し戻しの指摘（オーナーが Z3 から共有。Codex judge と Codex security が同じ1点、judge は APPROVED）：`RequirementsGuide.tsx` の `open()` は成功のたびに承認の表示を空に戻すのに、取り直す `useEffect` の依存は `ticketId` だけ。そのため「読み込み直す」・同じ記録の再選択・同じ票 ID の別の記録を開くと取り直されず、表示が「読み込み中…」のまま戻らない（A5）。実装の不具合で、§2 は変えない（承認は 23:50:01 のまま。03:14:20 の Kernel の写しの `approvals[].current` で確かめた）
- 03:15 行政の長が W45 を起動（worktree `agent-a35928ef1988ceaae`、main 7e255de から、モデルは Opus。T-042 の W43・T-044 の W44 と並行）。`fb146da` を cherry-pick させ、承認の表示を空に戻す契機と取り直す契機をそろえさせた。作業員の起動は台帳の外（昼の作業員は次の改正 L2 で窓口に寄せる）
- W45 の報告：HEAD `7b8b493a3579d2871f566f262c08c6d2e6a2bda2`、7e255de の上に1コミット（A0 の10ファイル、+2539）。承認の表示を `ApprovalSlot = { generation, view }` の1つの state にした。空に戻す3か所（`create()`、`open()`、票 ID が変わったときの `save()`）は、どれも世代を1つ進める `resetApproval()` にした。取り直す `useEffect` の依存は `[ticketId, generation]` で、空に戻すたびに必ず取り直す。AbortController の中断は保ち、応答は取得を始めたときの世代と比べ、古ければ捨てる（`applyApprovalResponse`）。純粋関数（`resetApprovalSlot`・`applyApprovalResponse`）を部品のファイルから export し、試験を5件足した（空に戻すと世代が進む、3つの場面で依存が変わり新しい応答で表示が戻る、古い応答で上書きしない）。test は 1032 件（52 ファイル）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:880` の `stopsDir` で差分の外）
- 行政の長の確認（試験は再実行していない）：`fb146da` から変わったのは `RequirementsGuide.tsx`（+32 / -6）と `RequirementsGuide.test.tsx`（+57 / -2。-2 は import の書き換えで、今ある試験の中身は同じ）だけ。`setApproval(null)` はすべて `resetApproval()` に置き換わり、ほかの部分は変わっていない
- 補った解釈：(1) 表示を空に戻すたびに必ず取り直す (2) `create()` の後は票 ID が null なので、世代が進んでも取得しない (3) `save()` で票 ID が変わらないときは、空に戻さず取り直しもしない（元の動きのまま）
- **確かめていない**：ブラウザでの実際の操作（3つの場面で表示が戻るか、React が effect を動かし直して abort するか、開発時の StrictMode での見え方）。3つの場面が `open()` を通ることは、コードの構造で保っているだけで、試験していない。ほかに、前の記録と同じもの（実サーバーでの API と `GET /api/governance/kernel`、375px、`npm run build`）。§3 で立法補佐が held の候補で確かめる
