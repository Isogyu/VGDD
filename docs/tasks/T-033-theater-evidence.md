---
id: T-033
title: 統治シアターの下に「判例の比較」と「判断待ちと次の担当」の欄を足す（統治シアター U5・U6）
status: ready
requirements: [A0, A1, A2, A3, A4, A5, A6, A7]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-64]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐が起草（オーナーの承認前）。統治シアターの U5（判例の比較・歴史）と U6（証拠・判断欄）。オーナーが 19:5x に起草を指示
estimate_h: 2
time_limit_min: 150
security_review: false         # 公開済みの写しと法律の要約を表示するだけ。API は変えない
unattended: false
branch: null
worker: null
files_allowed:
  - src/lib/theater-evidence.ts                       # 新設：比較と判断待ちを組み立てる純粋関数
  - src/lib/theater-evidence.test.ts                  # 新設
  - src/components/theater/LawComparison.tsx          # 新設：判例の比較の欄
  - src/components/theater/LawComparison.test.tsx     # 新設
  - src/components/theater/DecisionPanel.tsx          # 新設：判断待ちと次の担当の欄
  - src/components/theater/DecisionPanel.test.tsx     # 新設
  - src/components/theater/GovernanceTheater.tsx      # シアターの下に2つの欄を置くだけ
  - src/components/theater/GovernanceTheater.test.tsx # 上に合わせて足すだけ
files_forbidden:
  - src/lib/governance*.ts
  - src/lib/theater-data.ts
  - src/lib/theater-replay.ts
  - src/lib/theater-stage.ts
  - src/lib/law-history*.ts                           # 検証の関数は import して読むだけ
  - src/lib/kernel-state*.ts
  - src/lib/kernel-invariants*.ts
  - src/components/theater/GovernanceStage.tsx
  - src/components/theater/TicketReplay.tsx
  - src/components/theater/TheaterShell.tsx           # 最初の画面の配分は変えない
  - src/components/theater/tokens.ts
  - src/components/GovernanceView.tsx
  - src/components/KernelPanel.tsx
  - src/components/KernelInvariants.tsx
  - src/components/LawHistory.tsx
  - src/app/**
  - docs/**
  - src/lib/db/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-025, T-030, T-034]
---

## 1. 目的

統治シアターの最初の画面は「票1枚がどう流れたか」を見せる。その下に、2つの問いに答える欄を足す。

- **判例の比較**：法律の穴を見つけたとき、判例（試験）を足し、その判例を前の版にかけると落ち、直した版では通る。版を選ぶと、旧版と修正版、足した判例、落ちた件数、見つけた主体が並ぶ。代表例は p0.4.3（片方の司法の判定が欠けても統合された穴。判例 G15・G19）
- **判断待ちと次の担当**：いま人の判断を待っているもの（停止、held、承認を確かめられない票、仕様の承認待ち）と、次に動くのは誰かを、写しから決められる範囲だけで示す。不変条件は「一部」を合格だけで緑にしない

データはどちらも公開済みのもの（法律の公開の要約 `vgdd/kernel/history.json` と、シアターが取る Kernel・不変条件の写し）で、API は変えない。審査：デモ25、Claude の活用25、インパクト30。

## 2. 受け入れ条件

- A0. 差分を許すパスは次の8つだけ：`src/lib/theater-evidence.ts`、`src/lib/theater-evidence.test.ts`、`src/components/theater/LawComparison.tsx`、`src/components/theater/LawComparison.test.tsx`、`src/components/theater/DecisionPanel.tsx`、`src/components/theater/DecisionPanel.test.tsx`、`src/components/theater/GovernanceTheater.tsx`、`src/components/theater/GovernanceTheater.test.tsx`。それ以外は変更しない。`TheaterShell.tsx`・`tokens.ts`・`GovernanceStage.tsx`・`TicketReplay.tsx` と、`law-history-schema.ts`・`kernel-state-schema.ts`・`kernel-invariants-schema.ts`・`theater-data.ts` は import して読むだけで、変えない
- A1. **純粋関数**（`src/lib/theater-evidence.ts`。`node:fs` を読まない。React を import しない）：
  - `comparableVersions(history)`：`LawHistory`（`law-history-schema.ts` の型）の `versions` のうち、`prev_failed` が `null` でない版を、元の順のまま返す
  - `FEATURED_VERSION = "p0.4.3"` を export する。`defaultVersion(history)` は、比べられる版に `FEATURED_VERSION` があればそれ、なければ比べられる版の最後、1つもなければ `null`
  - `comparisonFor(history, version)`：その版と、`versions` の中で1つ前の項目の版名（先頭なら `null`）を返す。返す項目は `{ version, date, title, fixed, precedents, foundBy, prevFailed, testsTotal, previousVersion }`。`foundBy` は見つけた主体の表示名の配列（`executive_head`→「行政の長」、`legislative`→「立法補佐」、`codex`→「Codex の監査」、`judge`→「司法（Claude）」、`owner`→「オーナー」、`operation`→「運用の記録」。それ以外は「—」）。版がなければ `null`
  - `pendingDecisions(state, invariants)`：`state` は `KernelState | null`、`invariants` は `KernelInvariants | null`。判断待ちの行の配列を、次の順で返す。各行は `{ key, what, next, since }`（`since` は ISO の文字列か `null`）
    1. `state.stopped.active` が true：what「Kernel は停止中。統合しない」、next「オーナー（再開）」、since は `stopped.since`
    2. `state.judiciary.status` が `"unavailable"`：what「司法が使えない。統合しない」、next「記録からは決められない」、since は `judiciary.since`
    3. `state.held` の票ごと：what「{票}：判定に合格。統合を保留」、next「オーナー（release で承認）」、since は `held[].since`
    4. `state.approvals` の `current` が false の票ごと：what「{票}：今の仕様・法律の系統に対する承認を確かめられない」、next「オーナー（承認の確認。必要なら承認し直し）」、since は `null`（写しに原因はないので、仕様が変わったとは書かない）
    5. `invariants.pending_approvals` の票ごと：what「{票}：仕様の承認待ち」、next「オーナー（仕様の承認）」、since は `null`
    - 同じ票は1行だけにし、上の順で先に当たった行を残す。`state` が `null` なら 1〜4 を、`invariants` が `null` なら 5 を作らない（ないものを推し量って行を足さない）
  - `invariantTone(row)`：不変条件の1行を、`"ok"`（`status` が `enforced` で `verified` が true）、`"partial"`（`status` が `partial`。`verified` が true でも）、`"failed"`（`verified` が false）、`"unknown"`（それ以外）に分ける。`"failed"` は `"partial"` より先に判定する
- A2. **判例の比較の欄**（`src/components/theater/LawComparison.tsx`、`"use client"`）：
  - 表示だけの部品 `LawComparisonView({ history, selected, onSelect })` を export する（`history` は `LawHistory`、`selected` は版名か `null`）。既定の export はデータを取る部品で、マウントのたびに1回だけ `GET /api/governance/history` を取り（ポーリングしない）、応答の `history` を `pickLawHistory` で検証し直してから `LawComparisonView` に渡す。外れた後の応答は反映しない。最初に選ぶ版は `defaultVersion`
  - 取得の状態の文：取得前は「読み込み中…」。HTTP 200 の応答で、生の `body.history` が `null` のときだけ「法律の歴史の記録がありません」。通信の失敗・200 以外・JSON として読めない・応答の形が違う・`pickLawHistory` が `null` を返したときは「法律の歴史を読めませんでした」
  - 見出し `h2`「判例の比較」。比べられる版をボタン（`aria-pressed`、文は版名）で並べる。選んだ版について、次を出す：
    - 「旧版：{previousVersion}」「修正版：{version}（{date}）」と題。`previousVersion` が `null` なら「旧版：—」
    - 「旧版にかけると {prevFailed} 件が落ちた」。「修正版の適合性テスト：全 {testsTotal} 件」（`testsTotal` が `null` なら「修正版の適合性テスト：未測定」）
    - 直した点（`fixed`）の箇条、足した判例（`precedents`）の札、見つけた主体（`foundBy`）の札
    - 出どころの1行：「出どころ：vgdd/kernel/history.json（法律の公開の要約）。落ちた件数は、その版で足した判例を前の版にかけた結果で、防いだ不具合の数ではありません」
  - 比べられる版が1つもなければ「比べられる版がありません」
- A3. **判断待ちと次の担当の欄**（`src/components/theater/DecisionPanel.tsx`。props だけで描き、取得しない）：
  - props は `{ state, invariants, sourceLabel, generatedAt }`。`state` と `invariants` は `TheaterSection`（`theater-data.ts`）の値か、取得前の `null`
  - 見出し `h2`「判断待ちと次の担当」。その下に「{sourceLabel}・{generatedAt を kernel-state-schema の formatJst で}の写しから」
  - 取得前（`state` が `null`）は「読み込み中…」。`state` が `ok` でないときは、判断待ちの行を作らず、次の全文を出す。`missing` は「Kernel の写しの書き出しがありません。判断待ちは決められません」、`failed` は「Kernel の写しを取得できませんでした。判断待ちは決められません」
  - `state` が `ok` なら、`pendingDecisions(state の値, invariants が ok ならその値・それ以外は null)` の行を、what・「次の担当：{next}」・since（`formatJst`。`null` なら出さない）で並べる。行が0件なら「判断待ちはありません」。`invariants` が `ok` でないときは「不変条件の写しがないため、仕様の承認待ちは含みません」を添える
  - 不変条件：`invariants` が `ok` のとき、見出し `h3`「不変条件」と、各行を札で並べる。札の文は「{id}・{状態}・試験 {tests} 件・{結果}」（状態：enforced→「強制」、partial→「一部」、not_applicable→「対象外」。結果：true→「合格」、false→「不合格」、null→「未確認」）。色は `invariantTone` で決め、緑の色は `"ok"` だけに使う。札には色に頼らない文が入っているので、色だけで意味を伝えない
- A4. **置き場所**（`GovernanceTheater.tsx`）：`TheaterShell` の後ろ（最初の画面の外）に、`LawComparison` と `DecisionPanel` を並べる区画を1つ置く。幅 1024px 以上で横に2列、未満で縦に1列。`DecisionPanel` には、シアターが今持っている `data?.state ?? null`・`data?.invariants ?? null`・見ている source の表示名・`data?.generated_at ?? null` を渡す（source を切り替えると、取得中に戻ってから新しい写しで描き直る。もう一方の source の写しを使わない）。`TheaterShell` に渡す4つの区画とその中身は変えない
  - 新しい区画は `theaterTokens.page` の背景と文字の色を使い、`grid-cols-1 lg:grid-cols-2` に相当する配置にする。子要素は縮み・折り返せるようにし、固定の最小幅を付けない。司法は差分のクラスで判断し、1440×900・幅 375px での実際の収まりは §3 で立法補佐が確かめる
- A5. **公開してよい項目だけ**（新しい2つの欄に当てはめる。`TheaterShell` の中の今の表示は A4 のとおり変えない）：入力から出してよいのは、版名・日付・題・直した点・判例の名前・件数・見つけた主体の表示名、票の ID、整形した時刻、source の表示名、不変条件の ID・状態・試験の件数・結果と、A1〜A3 で決めた文だけ。入力全体を JSON にして出さない。console への出力・保存・送信をしない
- A6. 試験：
  - 型：未知の主体の試験では、その値を作る所だけ型アサーションを使い、スキーマは変えない。合成の `KernelState` は `verdicts.by_task` を `new Map()` で作るか、通信の形の入力を `pickKernelState` に通して作る
  - `theater-evidence.test.ts`：合成の `LawHistory` で `comparableVersions`・`defaultVersion`（`FEATURED_VERSION` がある・ない・比べられる版がない）・`comparisonFor`（先頭の版の `previousVersion` が `null`、未知の主体が「—」、ない版で `null`）。合成の `KernelState`・`KernelInvariants` で `pendingDecisions` の順・同じ票の重複の除去・`state` や `invariants` が `null` のとき行を作らないこと。`invariantTone` の4つ（partial で verified が true は `"partial"`、verified が false は status によらず `"failed"`）。リポジトリの実際の `vgdd/kernel/history.json` を読んで `pickLawHistory` に通し、`defaultVersion` が `"p0.4.3"` になり、その `comparisonFor` の `precedents` に `G15` と `G19` があること
  - `LawComparison.test.tsx`：`react-dom/server` の `renderToStaticMarkup` で `LawComparisonView` を合成の入力で描き、見出し、版のボタン（選んだ版だけ `aria-pressed="true"`）、旧版・修正版の文、`testsTotal` が `null` の版で「未測定」、出どころの1行が出ること。既定の export の初期の表示が「読み込み中…」であること（取得とクリックは試さない）
  - `DecisionPanel.test.tsx`：`renderToStaticMarkup` で、取得前の「読み込み中…」、`state` が `missing`・`failed` のときの文と行が0件であること、停止・held・`current` が false の承認・仕様の承認待ちを含む合成の写しで行と「次の担当」の文が A1 の順に出ること、行が0件のときの文、partial の札に緑の色の class が付かないこと
  - `GovernanceTheater.test.tsx`：今の試験はそのまま。初期の表示に `h2`「判例の比較」と「判断待ちと次の担当」が出ることを足す
- A7. `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る

## 3. 開発用テスト

held の後、release の前に、立法補佐が held の候補を一時的な作業ツリーで動かして確かめる。

- `/governance` を 1440×900 で開くと、最初の画面は今のまま（見出し・図・選んだ票・再生がスクロールなしで見える）。下に送ると「判例の比較」と「判断待ちと次の担当」が並び、その下に「証拠」が続く
- 「判例の比較」：最初は p0.4.3 が選ばれ、旧版 p0.4.2・足した判例に G15・G19・落ちた件数が出る。ほかの版を押すと中身が変わる
- 「判断待ちと次の担当」：提出記録では、写しにある held の票（今の提出記録では T-027）が「オーナー（release で承認）」で出る。「稼働中の観測」に切り替えると、取得中に戻ってから稼働中の写しで描き直る（写しがない作業ツリーでは「判断待ちは決められません」）
- 不変条件の札で、INV-03 など「一部」が緑にならない
- 幅 375px で縦に並び、横にスクロールしない

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. A1（純粋関数と試験）→ A3 と試験 → A2 と試験 → A4 と試験
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。API と公開の項目は変えないので security は省く（security_review: false）。

## 6. 記録

## オーナーに聞くこと

1. 代表例は p0.4.3（README の例2と同じ、片方の司法の判定が欠けても統合された穴）にする
2. 機能凍結（11/8 09:00）までに統合できなければ、この票は見送り、提出には含めない
