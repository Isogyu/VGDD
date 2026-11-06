---
id: T-030
title: Kernel の状態の写しを「提出記録」からも読めるようにし、統治シアターのデータを1か所で取る（統治シアター U2）
status: ready
requirements: [A0, A1, A2, A3, A4, A5, A6, A7]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-64]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐が起草（オーナーの承認前）。統治シアターの U2。clone した環境で Kernel の区画が空になる問題（docs/validation.md §4）を、提出記録の写し（docs/governance/snapshots/submission/）で埋める
estimate_h: 3
time_limit_min: 210
security_review: true          # ファイルの読み込みの場所を足す（固定の名前だけ）
unattended: false
branch: null
worker: null
files_allowed:
  - src/lib/kernel-state.ts                                   # 読む場所を source で選べるようにするだけ
  - src/lib/kernel-state.test.ts
  - src/lib/kernel-invariants.ts                              # 同上
  - src/lib/kernel-invariants.test.ts
  - src/app/api/governance/kernel/submission/route.ts         # 新設：提出記録の Kernel の写し
  - src/app/api/governance/kernel/invariants/submission/route.ts  # 新設：提出記録の不変条件の写し
  - src/lib/governance-replay-schema.ts                       # 新設：/api/governance/replay の応答をクライアントで検証する（zod）
  - src/lib/governance-replay-schema.test.ts                  # 新設
  - src/lib/theater-data.ts                                   # 新設：統治シアターのデータを取る関数（fetch を引数で受ける）
  - src/lib/theater-data.test.ts                              # 新設
files_forbidden:
  - src/app/api/governance/kernel/route.ts                    # 今の稼働中の写しの API は変えない
  - src/app/api/governance/kernel/invariants/route.ts
  - src/app/api/governance/route.ts
  - src/app/api/governance/replay/**
  - src/lib/governance.ts
  - src/lib/governance-replay.ts
  - src/lib/kernel-state-schema.ts
  - src/lib/kernel-invariants-schema.ts
  - src/components/**
  - docs/**
  - src/lib/db/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-028]
---

## 1. 目的

裁判所が書き出す Kernel の状態の写し（`docs/governance/kernel-state.json`・`kernel-invariants.json`）は git で追跡しないので、審査員が clone した環境では Kernel の区画が「書き出しがありません」になる。提出の時点の写しは `docs/governance/snapshots/submission/` にあるので、それを **「提出記録」として、はっきり分けて** 読めるようにする。稼働中の写しが読めないときに、黙って提出記録に切り替えることはしない（どちらを見ているかを、画面がいつも示せるようにする）。あわせて、統治シアターが使うデータ（公開用のイベント・Kernel の写し・不変条件の写し）を1つの関数で取り、各部品が別々に取りに行かないようにする。**この票の合格は、公開してよいことの判定ではない**：旧い `GET /api/governance` は票の記録の文（`detail`）を返し続け、公開の前に T-034 で旧い API の応答から自由な文を除き、今の画面の取得と表示も変える（画面から隠すだけでは済ませない）。審査：デモ25、インパクト30。

## 2. 受け入れ条件

- A0. 差分は `files_allowed` の10個だけ。今の API（`/api/governance`・`/api/governance/kernel`・`/api/governance/kernel/invariants`）の応答と、今の画面は変えない
- A1. `loadKernelState(root, source)` と `loadKernelInvariants(root, source)` に2つ目の引数 `source: "live" | "submission"`（既定は `"live"`）を足す。
  - `"live"`：今と同じ `<root>/docs/governance/<名前>.json`
  - `"submission"`：`<root>/docs/governance/snapshots/submission/<名前>.json`
  - パスは root と固定の名前だけで組み立てる。`snapshots` と `submission` も、今の `docs`・`governance` と同じく、リンクでない実在のディレクトリであることを確かめる。ファイルの読み方（リンクをたどらない・上限・検証）は今と同じ
  - 既存の呼び出し（引数1つ）の動きは変わらない
- A2. 新しい API を2つ置く。どちらも export する HTTP メソッドは `GET` だけで、引数（クエリ）は読まない。
  - `src/app/api/governance/kernel/submission/route.ts`：`{ source: "submission", state: <今の kernel の API と同じ形 | null> }`
  - `src/app/api/governance/kernel/invariants/submission/route.ts`：`{ source: "submission", invariants: <今の invariants の API と同じ形 | null> }`
  - 例外は本文を入れずに 500（`{ error: "kernel_unavailable" }`・`{ error: "invariants_unavailable" }`）。書き方は今の2つの route.ts に合わせる：`await connection()` のあとにローダーを呼ぶ。Route Segment Config（`dynamic` など）は足さない。Kernel の写しは `toWire` に通して返す（Map をそのまま JSON にしない）
- A3. `src/lib/governance-replay-schema.ts`：`node:fs` を読まない（クライアントで使う）。`pickReplay(json: unknown)` が、T-028 の応答の形（`schema: "vgdd.governance-replay.v1"`・`generated_at`・`tickets[].{id,title,status,events[]}`・`events[]` の7項目と列挙値）に合えば、許可したキーだけで組み立て直した値を、合わなければ `null` を返す。列挙値は T-028 の §2 A1 の表と同じ
- A4. `src/lib/theater-data.ts`：`node:fs` を読まない。`loadTheaterData(source, fetchFn)` が、次の3つを取って1つにまとめて返す。
  - 公開用のイベント：`/api/governance/replay`（source にかかわらず同じ。票は git で追跡しているので clone でも同じ）。応答は必ず `pickReplay` に通し、その返り値だけを持つ
  - Kernel の写し：source が `"live"` なら `/api/governance/kernel`、`"submission"` なら `/api/governance/kernel/submission`。`pickKernelState` で検証し直す
  - 不変条件の写し：同じく `/api/governance/kernel/invariants` か `/api/governance/kernel/invariants/submission`。`pickKernelInvariants`（`@/lib/kernel-invariants-schema`）で検証し直す
  - 返り値は `{ source, replay, state, invariants, generated_at }`。`replay`・`state`・`invariants` はそれぞれ `{ kind: "ok", value } | { kind: "missing" } | { kind: "failed" }`。`generated_at` は `state` が `ok` のときその写しの書き出しの時刻、それ以外は `null`
  - `missing`：応答が 200 で `state`／`invariants` が `null`。`failed`：通信の失敗・200 以外・JSON として読めない・検証に通らない。`replay` は `pickReplay` が `null` なら `failed`（replay に `missing` はない）
  - submission の2つの応答は `source === "submission"` を必須とし、欠けや違いは `failed`
  - 1つの項目が失敗しても、ほかの項目の結果は失わない
  - **どの失敗でも、別の source の URL を呼ばない**（source が `"live"` で Kernel の写しが `missing` や `failed` でも、提出記録を取りに行かない。黙って切り替えない）
- A5. 試験：
  - `kernel-state.test.ts`・`kernel-invariants.test.ts`：一時ディレクトリに live と submission の両方の写しを置き、source ごとに正しい方を読む。両方のローダーで、`snapshots`・`submission`・JSON のファイルをそれぞれリンクにすると `null`。submission でも、通常のファイルでない・上限を超える・JSON でない・形が合わないものは `null`。引数1つの呼び出しが live を読む。既存の試験は消さず、弱めない
  - `governance-replay-schema.test.ts`：正しい応答が通る。余分なキー（トップ・票・イベント）が落ちる。列挙値の外・`seq` が数でない・`events` が配列でないものは `null`
  - `theater-data.test.ts`：偽の `fetchFn` で、source ごとに取りに行く URL が A4 のとおりであること（呼ばれた URL の一覧で確かめる）。live で Kernel が `null` のとき `missing`、500 のとき `failed` で、どちらでも submission の URL を呼ばないこと。500・例外・JSON の読み取りの失敗・形の違い・submission の応答の `source` の欠けと違いが `failed` になること。3つの項目のうち1つだけが失敗しても、ほかの2つは `ok` のまま。`detail`・SHA・パスを足した replay の応答から、それらが返り値に残らないこと
- A6. 試験の中で、リポジトリの実際の `docs/governance/snapshots/submission/` の2つのファイルを `source: "submission"` で読み、どちらも `null` でないこと（提出記録が今の検証に通ることの確認）
- A7. `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る

## 3. 開発用テスト

held の後、release の前に、立法補佐が held の候補を一時的な作業ツリーで動かして確かめる。

- `GET /api/governance/kernel/submission` と `/invariants/submission` が 200 で、写しの中身（法律の版 p0.4.5、書き出しの時刻 2026-11-07T02:03）が返る
- 稼働中の写しを置かない作業ツリーで、`/api/governance/kernel` が `state: null` のまま（提出記録に切り替わらない）
- 今の `/governance` が変わっていない

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. A1 → A2 → A3 → A4 の順。A3 の列挙値は、main に統合された T-028 の `src/lib/governance-replay.ts` の値と同じにする（import はしない。`governance-replay.ts` は `governance.ts` を通して `node:fs` を読むため）
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ Codex security。T-031 とはファイルが重ならない。

## 6. 記録

## オーナーに聞くこと

1. 統治シアターは、最初に開いたときに「提出記録」を見せる（clone した審査員でも中身が出るように）。切り替えの表示と既定値は、組み込みの票（T-034）で決める
2. `docs/governance/snapshots/submission/README.md` の「画面はこのフォルダを読まない」は、この票の統合の後に立法補佐が直す
