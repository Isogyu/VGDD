---
id: T-032
title: 票1枚の記録を、再生・一時停止・1つ送り・1つ戻しで追える再生の部品を作る（統治シアター U4）
status: merged
requirements: [A0, A1, A2, A3, A4, A5, A6, A7, A8]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-64]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐が起草（オーナーの承認前）。統治シアターの U4。例の票は T-014（司法が分かれて止まり、直して合格）・T-026（人の裁定）・T-013（セキュリティ審査の差し戻し → 直して合格）。Codex の点検（重大6・軽微4）を反映
estimate_h: 3
time_limit_min: 210
security_review: false         # データを取りに行かない。props で受けた公開用のイベントを表示するだけ
unattended: false
branch: worktree-agent-a3915ebf8babf02b6
worker: W28
files_allowed:
  - src/lib/theater-replay.ts                    # 新設：出来事の表示の文・時刻・再生の状態の純粋関数
  - src/lib/theater-replay.test.ts               # 新設
  - src/components/theater/TicketReplay.tsx      # 新設：再生の部品（操作・出来事の一覧・今の出来事）
  - src/components/theater/TicketReplay.test.tsx # 新設
files_forbidden:
  - src/components/theater/tokens.ts             # 読むだけ
  - src/components/theater/TheaterShell.tsx      # 区画の高さの制約は T-034
  - src/components/theater/GovernanceStage.tsx
  - src/lib/governance-replay-schema.ts          # import type で読むだけ
  - src/lib/theater-data.ts
  - src/lib/theater-stage.ts
  - src/app/**
  - src/lib/governance*.ts
  - src/lib/kernel-*.ts
  - src/components/Governance*.tsx
  - src/components/Kernel*.tsx
  - src/components/LawHistory.tsx
  - docs/**
  - src/lib/db/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-029, T-030]
---

## 1. 目的

統治シアターの下の区画に置く「票1枚の再生」を作る。公開用のイベント（T-028 の `/api/governance/replay` を、親が T-030 の `pickReplay` で検証した値）を props で受け、票1枚の出来事を1つずつ再生する。今の出来事を親に知らせ、親（T-034）がそれを主役の図（T-031）の光る場所に変える。記録にない出来事を補わず、記録の分類より強い意味を与えず、実際の時刻と再生のために圧縮した時間を分けて見せる。

この票の合格は、公開してよいことの判定ではない。旧い `GET /api/governance` の自由な文（`detail`）を応答から除き、今の画面の取得と表示を変えるのは T-034 で、公開の前の条件。審査：デモ25、深さと実行20。

## 2. 受け入れ条件

- A0. 差分は `files_allowed` の4つだけ。`tokens.ts` は import して読むだけ、`governance-replay-schema.ts` は `import type { Replay }` だけで、どちらも変えない
- A1. `src/lib/theater-replay.ts`（`node:fs` を読まない）に、出来事の表示の文を返す純粋関数 `labelFor({ kind, reason })` を置く。文は次の表のとおり（一字一句）。reason の列が「—」の行は `reason: null` のときだけ当てる。表にない組み合わせは「記録の分類の外の出来事」

  | kind | reason | 文 |
  |---|---|---|
  | `returned` | `scope` | 許された範囲の外のファイルの変更として差し戻された |
  | `returned` | `rebase` | 最新の main を含まないとして差し戻された |
  | `returned` | `security` | セキュリティ審査で差し戻された |
  | `returned` | `judiciary` | 司法の2系統がともに差し戻した |
  | `returned` | `other` | 差し戻された |
  | `blocked` | `disagreement` | 司法の2系統が重大な指摘で分かれたため止めた。人の裁定へ |
  | `blocked` | `return_limit` | 差し戻しが3回に達したとの記録で止めた。人の判断へ |
  | `blocked` | `spec_unapproved` | 仕様が人に承認されていないため止めた |
  | `blocked` | `other` | 止めた（理由は記録の分類の外） |
  | `held` | — | 合格。夜間のため統合を保留し、人の承認を待つ |
  | `merged` | — | 統合した（裁判所） |
  | `released` | — | 統合した（人が承認） |
  | `ruling` | — | 人が裁定した |
  | `minor_disagreement` | — | 司法が軽微な指摘で分かれた。厳しい側の指摘を残して進めた |
  | `resubmitted` | — | 作業員の実装を前検査で確認し、申請し直した |
  | `other` | — | 記録の分類の外の出来事 |

- A2. 同じファイルに、出来事の見た目の種類を返す `toneFor({ kind, reason })` を置く：`blocked` で reason が `disagreement`・`return_limit`・`spec_unapproved` のもの、と `held` は `"waiting"`。`ruling`・`released` は `"human"`。`merged` は `"merged"`。`blocked`（`other`）と、A1 の表にない組み合わせは `"unknown"`。それ以外は `"normal"`
- A3. 同じファイルに、時刻の純粋関数を置く。どちらも例外を出さない。
  - `formatJst(ts)`：`2026-11-06T01:07:36+0900` の形の時刻を、実行環境のタイムゾーンとロケールによらず Asia/Tokyo の `MM/DD HH:mm` にする（例：`2026-11-05T16:30:00+0000` は `11/06 01:30`）。読めなければ「時刻を確認できません」
  - `elapsedLabel(firstTs, currentTs)`：差を分に切り捨て、X＝総分÷60 の整数部、Y＝余りとして「実際の経過：最初の出来事から X 時間 Y 分」。どちらかが `null` なら「実際の経過：—」。読めない・差が負なら「時刻を確認できません」
- A4. 同じファイルに、再生の状態の純粋関数 `replayReducer(state, action)` と `intervalMs(speed)` を置く。
  - 初期状態 `INITIAL_REPLAY = { index: -1, playing: false, speed: 1 }`。出来事の数 `count` は action に含めて渡す
  - `play`：index を変えずに `playing: true`。index が最後の出来事のとき、または `count` が0のときは何も変えない
  - `tick`：`playing` が true のときだけ1つ進む（-1 からは 0 へ）。最後の出来事に達したら `playing: false`。`playing` が false なら何も変えない
  - `pause`：`playing: false`
  - `next`・`prev`：`playing: false` にして1つ進む・戻る。最後より先、-1 より前には動かない
  - `reset`：速さを保ったまま `{ index: -1, playing: false }`
  - `setSpeed`：速さだけを変える（0.5・1・2 のどれか）
  - `count` が0なら、どの action でも `{ index: -1, playing: false }`
  - `intervalMs`：1倍で 1500、0.5倍で 3000、2倍で 750
- A5. 同じファイルに、例の票の ID を、この順の定数 `FEATURED_TICKETS = ["T-014", "T-026", "T-013"]` で置く
- A6. `src/components/theater/TicketReplay.tsx`（`"use client"`）：props は `tickets: Replay["tickets"]` と `onEventChange: (event: Replay["tickets"][number]["events"][number] | null) => void` の2つ。データを取りに行かない。
  - **票を選ぶ欄**：`FEATURED_TICKETS` のうち `tickets` にある票を、その順で、ID と題で並べる。最初の選択は並びの先頭。どれもなければ「再生できる票がありません」とだけ出す
  - **票を変えたとき**：速さを保って `reset` し、`onEventChange(null)` を呼ぶ。`tickets` が新しく渡されたときは、選んだ ID を保つ。その票の出来事の数か `seq` の並びが変わっていれば `reset` する。選んだ票がなくなれば、並びの先頭に移って `reset` する
  - **操作**：「再生」「一時停止」「1つ戻す」「1つ送る」「最初から」の `<button type="button">` と、速さ（0.5倍・1倍・2倍）。再生中は `intervalMs(speed)` ごとに `tick` を送る。再開と速さの変更のときは、新しい間隔を最初から数える。一時停止・速さの変更・票の変更・部品が外れるときは、前のタイマーを止める
  - **通知**：今の出来事（index が変わったとき）だけ `onEventChange` を呼ぶ。描画の最中には呼ばず、`onEventChange` の参照が変わっただけでは呼ばない
  - **出来事の一覧**：選んだ票の全出来事を、`formatJst` の時刻と A1 の文で並べる。今の出来事に `aria-current="step"` を付けて強調する。`judge`・`codex` が `null` でなければ「Claude：合格／差し戻し」「Codex：合格／差し戻し」を添える（`APPROVED` は合格、`CHANGES_REQUIRED` は差し戻し）
  - 一覧の下に「記録の当時の分類です。後の訂正や取り消しは含みません」を出す
  - **今の出来事の欄**：`aria-live="polite"` で A1 の文を出す。始まる前は「再生を押すと、この票の記録を順に追います」
  - **時間の表示**：`elapsedLabel(最初の出来事の時刻, 今の出来事の時刻または null)` と「再生では時間を圧縮しています」
  - **見た目**：A2 の種類ごとに `tokens.ts` の状態か役割（`waiting`・`human`・`merged`・`unknown`）のラベルと形の印を添える。`normal` は印を付けない
  - **高さ**：部品の外枠は親の高さに従い（`h-full min-h-0`）、操作と今の出来事の欄は固定、出来事の一覧だけが部品の中でスクロールする（`min-h-0 overflow-y-auto`）。親の区画（TheaterShell）の高さの制約と、1440×900 での収まりの確認は T-034
  - **動き**：文字と強調の切り替えだけ。強調の transition だけ `motion-safe:` にする。`prefers-reduced-motion` でも、1つずつ進むことは止めない
- A7. 表示するのは、票の ID と題、`formatJst` の時刻、A1 の文、判定の結論、A3・A6 の決まった文だけ。入力全体を JSON にして出さない。余分な項目を表示しない。console への出力・保存・送信をしない。記録にない出来事を補わない（一覧に出すのは props の出来事だけ）
- A8. 試験（`npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る）：
  - `theater-replay.test.ts`：A1 の16行すべての文と、表にない組み合わせ（例：`held` に `reason: "scope"`）。A2 のすべての分岐。A3 の `formatJst`（`+0900` の入力、UTC で日付をまたぐ入力 `2026-11-05T16:30:00+0000` → `11/06 01:30`、読めない入力）と `elapsedLabel`（秒の切り捨て：59 分 59 秒 → 0 時間 59 分、61 分 → 1 時間 1 分、`null`、読めない、負）。A4 のすべての action と境界（停止中の `tick`、最後での `play`、`next`・`prev` で `playing` が false、`reset` で速さを保つ、0件）。`intervalMs` の3つの値。`FEATURED_TICKETS` の順
  - `TicketReplay.test.tsx`：`react-dom/server` の `renderToStaticMarkup` で**初期の表示だけ**を試す（タイマー・クリック・通知は試さず、A4 の純粋関数の試験と差分で審査する）。入力は T-002・対象外の票・T-026・T-014 の順に渡し、選ぶ欄が T-014・T-026 の順で（T-013 は入力にないので出ない）、最初の選択が T-014。T-014 の4つの出来事（固定の入力。時刻と A1 の文の期待値を試験の中に書く）、判定の結論の表示と `null` の非表示、5つのボタンの名前、「再生では時間を圧縮しています」「記録の当時の分類です。後の訂正や取り消しは含みません」、始まる前の文、「実際の経過：—」。`FEATURED_TICKETS` の票が1つもないときは「再生できる票がありません」だけ

## 3. 開発用テスト

held の後、release の前に、立法補佐が held の候補を一時的な作業ツリーで動かして確かめる（入口は足さないので、確認用の一時的なページは立法補佐が作業ツリーの中だけで作り、コミットしない）。

- T-014 を再生すると、4つの出来事が 1.5 秒ごとに順に強調され、最後で止まる（1倍で約6秒）
- 「1つ戻す」「1つ送る」「最初から」と速さの切り替えが効き、再生中に票を変えると始まる前に戻る

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. `theater-replay.ts` と試験 → `TicketReplay.tsx` と試験
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。T-031 とはファイルが重ならない（出来事から図の光る場所への変換 `focusFor` の呼び出しと、データの取得は T-034）。

## 6. 記録

- 12:29 行政の長が W28 を起動（worktree `agent-a3915ebf8babf02b6`、main ea8367f から、モデルは Opus）。仕様はオーナーが 12:27:06 に approve-spec で承認済み（12:28:28 の Kernel の写しの `approvals[].current` で確かめた）。依存の T-029・T-030 は統合済み
- W28 の報告：HEAD `ca1c13eca8b1a386c2ac6d02a3727a24adfac957`。test 673 件（34 ファイル）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:851` で差分の外）。**再生・クリック・タイマーの片付け・再開の数え直し・`onEventChange` の呼び出しは、動かして確かめていない**（A8 の範囲外で、DOM の試験用ライブラリもない）。実際の CSS の見え方も未確認。§3 で立法補佐が held の候補で確かめる
- 行政の長の確認（試験は再実行していない）：差分は `files_allowed` の4つだけ（+894）。A1 の16の文、A4 の遷移、A6 のタイマーと通知の実装を §2 と読み合わせた
- 補った解釈：(1) `other`／`null` の `toneFor` は `"normal"`。A2 の「それ以外」に当たると読んだ。文は「記録の分類の外の出来事」なのに印が付かないので、`unknown` にしたいなら §2 の変更が要る (2) 0件の `setSpeed` は index と playing を初期に戻し、速さは指定に従う (3) 変化がなければ `replayReducer` は同じオブジェクトを返す (4) 時刻は `Date.parse` を使わず正規表現で読み、+9 時間を固定で足す。存在しない日時、`+2400` の形の時差、西暦 0000〜0099 年は「読めない」。日本に夏時間があった 1948〜51 年の日時は1時間ずれる（記録は 2026 年なので影響しない）(5) `onEventChange` のキーは「票の ID と seq の並び＋ index」。マウント直後は呼ばない。例の票がすべて消えたときも `null` を呼ぶ (6) 同じ seq の並びで中身だけが変わった `tickets` は §2 のとおり reset せず通知もしないので、親の持つ出来事は古いままになる (7) 票を選ぶ欄は `<select>`、速さは `aria-pressed` 付きのボタン3つ（ボタンは計8個）。押しても変わらないボタンは `disabled` でなく `aria-disabled` (8) `aria-live` の欄には A1 の文だけを入れ、印はその外 (9) 票にない補助として `pickFeatured`・`ticketSignature`・`verdictLabels`・`REPLAY_SPEEDS` を足した
- T-034 への申し送り：一覧の自動スクロールは入れていない（A6 の「文字と強調の切り替えだけ」に従った）。区画が低いと、強調された行が見える範囲から外れることがある。今の出来事の文は固定の欄に常に出る

## オーナーに聞くこと

1. A1 の16の文は §2 なので、承認の前に決める
2. 例の票の3つ目を T-002 から T-013 に替えた。T-002 の上限到達は、3回の差し戻しがどれも法律の不具合と連鎖によるもので、オーナーが取り消して統合した。公開用のイベントには取り消しが出ないため、再生すると「正当な上限到達」に見える

- 2026-11-07T12:43:09+0900 gate-runner: status → review（判定に合格（judge=APPROVED codex=APPROVED）。夜間のため統合せず、朝のオーナーの承認を待つ）

- 2026-11-07T14:57:38+0900 release: status → merged（main=2797bdbf9df2。夜間の判定に合格した候補 f40f864beb54 を、オーナーが朝に承認して統合）
