---
id: T-026
title: 統治のライブ画面の先頭に「統治の全体図」と「停止の全面表示」を置く（可視化 V1・V2）
status: review
requirements: [A0, A1, A2, A3, A4, A5]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-64, V1, V2]   # 記録用。司法には渡さない
proposal_from: 2026-11-06 立法補佐が起草（オーナーの承認前）。docs/drafts/vgdd-visualizer.md の V1・V2。データは今ある3つ（kernel-state.json・_board.json・summary.json）だけ
estimate_h: 3
time_limit_min: 210
security_review: false         # 新しい API もファイルの読み込みも足さない（既存の2つの API を読むだけ）
unattended: false
branch: worktree-agent-a709fe1738ee26e8c
worker: W22
files_allowed:
  - src/lib/governance-map.ts         # 新設：全体図の数字を組み立てる純粋関数
  - src/lib/governance-map.test.ts    # 新設
  - src/components/GovernanceMap.tsx  # 新設：全体図と停止の全面表示
  - src/components/GovernanceView.tsx # 部品を1つ差し込むだけ
  - src/components/KernelPanel.tsx    # 60 秒ごとの読み直しを足すだけ（停止の表示を全体図とそろえる。Codex の点検）
files_forbidden:
  - src/lib/governance.ts
  - src/lib/kernel-state*.ts
  - src/lib/kernel-invariants*.ts
  - src/app/api/**
  - src/components/KernelInvariants.tsx
  - src/lib/db/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-024]
---

## 1. 目的

作品の主役は VGDD の可視化（D-64）。デモの冒頭で「市民（オーナー）・立法・行政・司法・Kernel の5つが、役割を分けて動いている」を、生きた数字の全体図で5秒で伝える。Kernel は自分で合否を判断する4つ目の権力ではなく、成立した規則を実行時に強制する基盤として示す。山場では、Kernel を停止すると、写しが書き出された後の次の取得で見出しの直下が赤い帯に変わり、停止の後に始まる AI の操作が拒否されていることを示す。データは今ある `GET /api/governance/kernel`（Kernel の状態の写し）と、`GovernanceView` がすでに持つ票の盤（`board`）と操作の集計（`summary`）だけ。審査：デモ25、Claude の活用25（役割ごとのエージェントの使い分け）。

## 2. 受け入れ条件

- A0. 差分のファイルは次の5つだけ：`src/lib/governance-map.ts`（新設）、`src/lib/governance-map.test.ts`（新設）、`src/components/GovernanceMap.tsx`（新設）、`src/components/GovernanceView.tsx`、`src/components/KernelPanel.tsx`。前提（既存の契約。この票では変えない）：`pickKernelState` は `KernelState | null` を返し、`state.verdicts.by_task` は `ReadonlyMap`（件数は `.size`）。`GET /api/governance/kernel` は 200 `{ state: KernelStateWire | null }` を返し、`by_task` は通信では普通のオブジェクトで、`pickKernelState` が `Map` に戻す
- A1. `src/lib/governance-map.ts`（`node:fs` を import しない。型は `@/lib/governance` と `@/lib/kernel-state-schema` から `import type` だけ）に純粋関数 `buildGovernanceMap(input: { state: KernelState | null; board: GovernanceBoard | null; summary: GovernanceSummary | null }): GovernanceMap` を export する。`GovernanceMap` は5つの箱 `citizen`・`legislative`・`executive`・`judiciary`・`kernel` を持ち、各箱は `{ title: string; role: string; figures: { label: string; value: string }[] }`。数が取れないときの `value` は「—」。箱ごとの `title`・`role`・`figures` は次の固定（この文と順のまま）：
  - `citizen`：title「市民（オーナー）」、role「目的と制約を決め、仕様を承認し、裁定し、止める」、figures「承認済みの仕様」＝`state.approvals` のうち `current` が true の数、「裁定」＝`state.rulings.tasks` の長さ、「Kernel（取得した写し）」＝`state.stopped.active` が true なら「停止中」、false なら「稼働中」、`state` が null なら「確認できない」
  - `legislative`：title「立法（立法補佐・憲法審査）」、role「憲法と法律を起草し、票の受け入れ条件を書く」、figures「法律の版」＝`state.kernel_version`（`null` なら「—」）、「憲法審査の呼び出し」＝`summary.by_agent["constitutional-review"].calls`
  - `executive`：title「行政（行政の長・作業員）」、role「票を読んで作業員を起こし、隔離した作業場所で実装する。自分では統合できない」、figures「行政の長の操作」＝`summary.by_agent["(main)"].calls`、「作業員の操作」＝`summary.by_agent["worker"].calls`、「補助のエージェントの操作」＝`summary.by_agent["general-purpose"].calls`
  - `judiciary`：title「司法（judge・Codex）」、role「差分と受け入れ条件だけを見て、2つの系統で判定する。ツールを持たない」、figures「判定した票の数」＝`state.verdicts.by_task.size`、「judge と Codex が分かれた票の数」＝`state.disagreements.tasks` の長さ
  - `kernel`：title「Kernel（裁判所・フック・証拠ストア）」、role「成立した規則を、権限・停止・統合・証跡として実行時に強制する。自分で合否を判断しない」、figures「票の数」＝`board.tickets`、「統合の出来事の数」＝`board.merged`、「held の票の数」＝`state.held` の長さ、「拒否した操作の数」＝`summary.tool_calls.deny`、「証拠の記録の数」＝`state.evidence.records`
  - 数は `String(n)`。`state`・`board`・`summary`・`by_agent` の鍵のどれかがなければ、その数は「—」
- A2. `src/components/GovernanceMap.tsx`（クライアント部品）は props `{ board: GovernanceBoard | null; summary: GovernanceSummary | null }` を受け、マウントのときと、その後 **60,000 ミリ秒ごと**に `fetch("/api/governance/kernel", { cache: "no-store", signal })` で取る（`setInterval`。unmount で `clearInterval` と `abort()`。前の取得が終わっていなければ前のものを `abort()` してから取る。`signal.aborted` なら state を更新しない）。応答が `!response.ok`・JSON でない・`state` の項目がないときと通信の失敗は「取得の失敗」とする。2xx の `state` を `pickKernelState`（`@/lib/kernel-state-schema`）で検証し直し、通らない・取得の失敗・`null` のときは `state: null` として A1 に渡す（全体図は「—」の数で出し続ける）。最後に取得に成功した時刻（端末の時計）を持つ。古さの判定に使う現在時刻は、取得とは別の `setInterval`（60,000 ミリ秒。unmount で `clearInterval`）で進める（取得が長引いたり失敗したりしても、古い写しの表示が切り替わる）
- A3. **停止の表示（V2）**：部品の先頭に、状態の帯を1つ出す（`formatJst` は `@/lib/kernel-state-schema`）。(a) 検証に通った `state` の `stopped.active` が true → `role="alert"` の赤い帯「取得した写し（書き出し <formatJst(state.generated_at)>）では、Kernel は停止中（<formatJst(stopped.since)> から）。停止の後に始まる AI の書き込み・Bash・作業員の起動は拒否される。停止の前から動いている処理は止めない」(b) 取得の失敗・検証に落ちた・`state` が null → amber の帯「Kernel の状態を確認できない（取得に失敗した）。稼働中とはみなさない」(c) `stopped.active` が false → 停止の帯は出さない。帯の有無にかかわらず、帯の位置の直下に、常に次の1行を出す：「Kernel の写し：書き出し <formatJst(state.generated_at)。state が null なら —>・最後の取得 <最後に取得に成功した時刻を formatJst で。なければ —>」。`state` があり `summarizeKernel(state, new Date()).stale` が true なら（`summarizeKernel` は `@/lib/kernel-state-schema`）、その横に amber で「古い写し（10 分を超えて書き出しがない）」
- A4. **全体図（V1）**：`<section aria-label="統治の全体図">` の中に、上段に `citizen`、中段に `legislative`・`executive`・`judiciary` を横に3つ（狭い画面では縦に）、下段に `kernel` を置く。箱ごとに title・role・figures（label と value）を出す。上段と中段の間に「承認・裁定・停止 ↓」、中段と下段の間に「すべての操作は Kernel を通る ↓」の固定の文を置く。最後に注意の3行（常に出す）「Kernel の写しは 60 秒ごとに取得する。票の盤と操作の集計は画面を開いた時点のもの。取得の時点が違う数を並べている」「この全体図と下の Kernel の区画は別々に取得するので、通信の遅れや失敗のときは一時的に食い違うことがある。停止の帯が消えても、再開の条件を確かめたことにはならない（再開はオーナーが kernel-resume.sh で条件を確かめて行う）」「数字は裁判所の写しと操作の集計から。生のログは公開していない」。文字列は React の文字列としてだけ描画し、`dangerouslySetInnerHTML`・`console`・`localStorage` を使わない。新しい依存は足さない（図は HTML と CSS だけ）
- A5. `src/components/GovernanceView.tsx` に `GovernanceMap` の import を1行足し、既存の `<KernelPanel />` の直前（見出しの直下。統治のデータの取得に成功したときに出る）に `<GovernanceMap board={data.board} summary={data.summary} />` を1つ置く。それ以外は変えない。`src/components/KernelPanel.tsx` は、マウントのときの1回の取得に加えて、**60,000 ミリ秒ごとに同じ取得をやり直す**ように変える（前の取得の `abort()`、unmount で `clearInterval`、`signal.aborted` なら state を更新しない、はマウントのときと同じ）。表示の文・分岐・ほかの処理は変えない（全体図と区画は別々に取得するので、食い違いは A4 の注意の文で明示する。そろう時間は保証しない）。`src/lib/governance-map.test.ts` に、次をそれぞれ1件以上の `it(` で試す：①3つの入力がそろうと、5つの箱の title・role・figures の label が A1 の文と順のとおりで、value が入力から数えた値 ②`state` が null だと、`citizen` の承認と裁定・`legislative` の法律の版・`judiciary`・`kernel` の held と証拠の記録の数が「—」、`citizen` の「Kernel（取得した写し）」が「確認できない」で、`board`・`summary` から取れる数は出る ③`summary.by_agent` に `"worker"` がないと「作業員の操作」だけ「—」 ④`stopped.active` が true なら `citizen` の「Kernel（取得した写し）」が「停止中」、`state` が null なら「確認できない」 ⑤`kernel_version` が null なら「法律の版」が「—」 ⑥`by_task` が空の `Map`・`held` が 0 件でも数は「0」（「—」ではない） ⑦3つの入力がすべて null でも例外にならない。試験の入力は、次の**具体例**を試験の中にそのまま書いて使う（本番の写し 2026-11-07 00:28 から配列を短くしたもの。`state` は `pickKernelState` に通して作り、最初に非 null を確かめる。`by_task` は通信の形の普通のオブジェクトで、`pickKernelState` が `Map` にする）。必須の項目と制約は、main の `src/lib/kernel-state-schema.ts` の `pickKernelState`（T-022 の A1。strict）と `src/lib/governance.ts` の `GovernanceBoard`・`GovernanceSummary` に従う。下の例はそれらに通ることを Codex の点検で確かめた。ほかの場面（停止中・null の項目・空の配列）は、この例の値を、その形の中で変えて作る：
  - `state` の元の JSON：`{"schema":"vgdd.kernel-state.v1","generated_at":"2026-11-07T00:28:57+09:00","kernel_version":"p0.4.4","policy_version":"p0.4.3","stopped":{"active":false,"since":null},"judiciary":{"status":"ok","kind":null,"since":null},"approvals":[{"task":"T-010","current":true,"approved_at":"2026-11-06T22:18:11+09:00"},{"task":"T-011","current":true,"approved_at":"2026-11-06T22:18:11+09:00"}],"held":[],"rulings":{"count":2,"tasks":["T-017","T-019"]},"annulments":{"count":16},"verdicts":{"count":128,"by_task":{"T-000":{"judge":"APPROVED","codex":"APPROVED","security":null,"at":"2026-11-03T18:08:59+09:00"},"T-001":{"judge":"APPROVED","codex":"APPROVED","security":null,"at":"2026-11-03T21:07:35+09:00"}}},"disagreements":{"count":13,"tasks":["T-001","T-003"]},"evidence":{"records":5191,"chain_ok":true,"checkpoint_mismatches":1,"checkpoint_at":"2026-11-07T00:28:53+09:00","last_record_at":"2026-11-07T00:28:43.392+09:00"},"conformance":{"passed":377,"total":377,"impl":"z3","kernel_version":"p0.4.4","at":"2026-11-06T22:15:49+09:00"}}`（このとき「承認済みの仕様」2、「裁定」2、「法律の版」p0.4.4、「判定した票の数」2、「分かれた票の数」2、「held の票の数」0、「証拠の記録の数」5191）
  - `board`：`{"tickets":25,"merged":25,"rejected":33,"blocked":0,"disagreements":13}`
  - `summary`：`{"schema":"vgdd.governance-summary.v1","generated_at":"2026-11-06T06:49:17.201+09:00","period":{"first":"2026-11-03T11:23:53.146+09:00","last":"2026-11-06T06:31:25.593+09:00"},"chain_ok":true,"records":5031,"sessions":12,"agents":4,"tool_calls":{"allow":2698,"deny":56},"deny_kinds":{"protected_path":26},"by_agent":{"(main)":{"calls":1593,"deny":30},"general-purpose":{"calls":253,"deny":5},"worker":{"calls":902,"deny":21},"constitutional-review":{"calls":6,"deny":0}}}`（このとき「行政の長の操作」1593、「作業員の操作」902、「補助のエージェントの操作」253、「憲法審査の呼び出し」6、「拒否した操作の数」56）あわせて `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る（裁判所の決定論的な監査の結果で確かめる。司法はコードと試験の中身を判定する）

## 3. 開発用テスト

- A5 の観点。統合の後に、ユーザー役が `/governance` の先頭に全体図が出ること、オーナーが `kernel-stop.sh` で止めると、写しが書き出された後、次の取得に成功したときに赤い帯が出て、区画も「停止中」になり、`kernel-resume.sh` で再開した後、写しが書き出されて次の取得に成功したときに消えることを確かめる（本番の停止の実演 K2 を兼ねる。停止の操作から帯が出るまでの時間は保証しない）

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. 見た目は `KernelPanel` に合わせる（zinc 系）。赤い帯は red、市民の箱だけ少し強い枠
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。要件は main にコミット済みのこの票の §2。T-025 と触るファイルは `GovernanceView.tsx` だけが重なる（差し込む位置が違う）。並行で作るときは、後に統合する方が前の変更の上に組み直す（統合キュー）。

## 6. 記録

- 01:00 行政の長が W22 を起動（worktree `agent-a709fe1738ee26e8c`、main 6f924ca から）。仕様はオーナーが 00:59:02 に approve-spec で承認済み（立法補佐の指示の条件を、01:00 の Kernel の写しの `approvals[].current` で確かめた）。T-025 と重なる `GovernanceView.tsx` の衝突を避けるため、import の位置を `import KernelPanel` の直前と指示した（A5 の範囲内）
- W22 の報告：HEAD `2a56fd817e968b895ef0a53e02f22b65f691fa28`。test 332 件（27 ファイル）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:717` で差分の外）。**画面と API は動かしていない**（dev サーバーは sandbox の `listen EPERM` で起動せず、描画・帯の出し分け・60 秒ごとの取得は未確認。§3 で統合の後に確かめる）
- 補った解釈・逸脱：(1) 最初の取得の結果が出るまでは帯を出さない（§2 の (a)〜(c) に定めがない。全体図の Kernel の欄は「確認できない」）。最初の取得が応答しないまま続くと、次の取得で中断されるので帯のない状態が続く (2) 「最後に取得に成功した時刻」は、2xx・JSON・`state` の項目がある応答で更新する（`state: null`・検証の不合格でも更新し、帯は amber）(3) 古さの判定は、別の `setInterval` で進める `now` を渡す（表示は最大 60 秒遅れる）(4) amber の帯に `role` を付けない (5) `KernelPanel.tsx` の先頭と useEffect のコメントを動作に合わせて直した。試験は §2 より1件多い（`current` が true のものだけを数える）
- 拒否された操作：worktree の外の scratchpad への Write（フック）、複合の git コマンド2回（ハーネス）。W22 は回避せず、Write は `grep -oF` で主な固定の文14個の一致を確かめる形に替え、コマンドは分けた
- 01:06 行政の長が差分を確認（`files_allowed` の5つだけ、追加 425・削除 7。`GovernanceView.tsx` は import 1行と差し込み1行、`KernelPanel.tsx` は再取得とコメントだけで表示の文と分岐は変更なし。A1 の箱の title・role・figures と A3・A4 の固定の文を §2 と読み合わせた。A5 の試験①〜⑦は `it(` の名前で対応を確かめた。禁止語・秘密情報の形・`dangerouslySetInnerHTML`・`console`・`localStorage` なし。行政の長は試験と画面を自分では動かしていない）。`status: review` で main にコミットし申請。T-025（held）の統合の後は、裁判所が最新の main と組み合わせて検査し直す

- 2026-11-07T01:08:02+0900 gate-runner: status → blocked（judge と Codex の判定が重大な指摘で分かれた（judge=APPROVED/0 件, codex=CHANGES_REQUIRED/1 件）。オーナーの裁定へ）
- 01:15 オーナーが裁定（merge）した（立法補佐の伝達と、01:15:04 の Kernel の写しの `rulings` に T-026 が入ったことで確かめた）。立法補佐の指示で `status: review` に戻し、同じ HEAD `2a56fd8` で再申請。コードは変えていない。Codex の指摘の本文は Z3 にあり、行政の長は読んでいない

- 2026-11-07T01:17:53+0900 gate-runner: judge と Codex が分かれたが、オーナーの裁定（統合）により進める：Codex の指摘（初回の取得中に amber の帯が出ない）は §2 のあいまいさによる。A3(b) の帯の文は取得の後の失敗を指し、取得中に出すと誤りになる。取得中も全体図の Kernel の欄は「確認できない」で、稼働中とは出ないので、§2 の目的は満たす。judge は APPROVED

- 2026-11-07T01:17:53+0900 gate-runner: status → review（判定に合格（judge=APPROVED codex=CHANGES_REQUIRED）。夜間のため統合せず、朝のオーナーの承認を待つ）
