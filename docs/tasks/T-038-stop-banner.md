---
id: T-038
title: 統治シアターの見出しに「停止の帯」と「判断待ちの件数」を出す
status: review
requirements: [A0, A1, A2, A3, A4, A5]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-64]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐が起草（オーナーの承認前）。オーナーが 21:5x に案 E を採用
estimate_h: 1.5
time_limit_min: 120
security_review: false         # 取得済みの写しから、決まった文と件数を出すだけ
unattended: false
branch: worktree-agent-ae749cb14c6fed88c
worker: W34
files_allowed:
  - src/lib/theater-banner.ts                         # 新設：帯と件数の文を組み立てる純粋関数
  - src/lib/theater-banner.test.ts                    # 新設
  - src/components/theater/GovernanceTheater.tsx      # 見出しの区画に帯と件数を置く。判断待ちの欄の包みに id を付ける
  - src/components/theater/GovernanceTheater.test.tsx # 上に合わせて足すだけ
files_forbidden:
  - src/lib/theater-evidence.ts                       # pendingDecisions は import して読むだけ
  - src/lib/theater-data.ts
  - src/lib/theater-refresh.ts
  - src/lib/theater-replay.ts
  - src/lib/theater-stage.ts
  - src/lib/theater-guide.ts
  - src/lib/claude-roles.ts
  - src/components/theater/TicketReplay.tsx
  - src/lib/governance*.ts
  - src/lib/kernel-state*.ts
  - src/lib/kernel-invariants*.ts
  - src/components/theater/GovernanceStage.tsx
  - src/components/theater/TheaterShell.tsx
  - src/components/theater/LawComparison.tsx
  - src/components/theater/DecisionPanel.tsx
  - src/components/theater/ClaudeRoles.tsx
  - src/components/theater/TheaterGuide.tsx
  - src/components/theater/tokens.ts
  - src/components/GovernanceView.tsx
  - src/app/api/**
  - docs/**
  - src/lib/db/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-033, T-035, T-036, T-037]
---

## 1. 目的

今の統治シアターでは、Kernel が停止中でも、図の箱の色が変わるだけで、ひと目では分かりにくい。動画の山場（停止 → 拒否 → 再開）で、見出しに横幅いっぱいの帯を出して「止まった」ことをはっきり見せる。あわせて、人の判断を待っているものの件数を見出しに出し、下の「判断待ちと次の担当」の欄へ案内する。どちらも、T-035 で取り直した同じ写しから作る。審査：デモ25。

## 2. 受け入れ条件

- A0. 差分を許すパスは次の4つだけ：`src/lib/theater-banner.ts`、`src/lib/theater-banner.test.ts`、`src/components/theater/GovernanceTheater.tsx`、`src/components/theater/GovernanceTheater.test.tsx`。それ以外は変更しない。実装と差分の審査の基準は、T-036・T-037 を統合した後の main とする。`pendingDecisions`（`@/lib/theater-evidence`）と `formatJst`（`@/lib/kernel-state-schema`）は import して使うだけ
- A1. **純粋関数**（`src/lib/theater-banner.ts`。React を import しない。`node:fs` を読まない）。`TheaterSection` は `@/lib/theater-data`、`KernelState` は `@/lib/kernel-state-schema`、`KernelInvariants` は `@/lib/kernel-invariants-schema` から `import type` する：
  - `stopBannerText(state: TheaterSection<KernelState> | null): string | null`：`state` が `{ kind: "ok" }` で `value.stopped.active` が true のときだけ文を返し、それ以外は `null`。文は、`value.stopped.since` があれば「Kernel は停止中（{formatJst(since)} から）。統合しません」、`null` なら「Kernel は停止中。統合しません」
  - `pendingSummaryText(state: TheaterSection<KernelState> | null, invariants: TheaterSection<KernelInvariants> | null): string | null`：`state` が `{ kind: "ok" }` でなければ `null`。それ以外は `pendingDecisions(state.value, invariants が ok ならその value・それ以外は null)` の件数 n について、n が 1 以上なら「判断待ち {n} 件」、0 なら「判断待ちはありません」
- A2. **見出しの区画**（`GovernanceTheater.tsx`）：
  - `stopBannerText` が文を返すとき、見出しの区画の先頭（`h1` より上）に、横幅いっぱいの帯を出す。帯の要素は `role="status"`。色は赤の系統（文字・枠・背景。例：`border-red-500 bg-red-950 text-red-100`）で、文は太字。文が `null` のときは帯を出さない
  - `pendingSummaryText` が文を返すとき、見出しの取得の状態の項目の並びの後に、その文を「判断待ちと次の担当」の欄へのページ内リンク（`<a href="#decisions">`）として出す。`null` のときは出さない
  - 「判断待ちと次の担当」の欄（`DecisionPanel`）を包む要素に `id="decisions"` を付ける。`DecisionPanel` の中身は変えない
  - 帯と件数には、`DecisionPanel` に渡すものと同じ、今表示している `data`（T-035 の取り直しで合わせた後のもの）の `state`・`invariants` を使う。state と invariants が同じ時点のものであることは求めず、取得の追加や同期の処理を足さない。案内中（T-037）も出す
  - 1440×900 では、帯を出しても見出し・図・選んだ票・再生の操作が最初の画面に収まり、375px ではページに横スクロールを出さない。そのための見出しの中の配置・余白の調整はしてよい（`TheaterShell` は変えない）
  - ほかの部分（T-033〜T-037 の取得・取り直し・欄・案内）は変えない
- A3. **公開してよい項目だけ**：足すのは、決まった文・整形した時刻・件数・ページ内リンクだけ。通信・保存・console への出力を足さない
- A4. 試験：
  - `theater-banner.test.ts`：`stopBannerText` が、停止中で `since` あり・`since` が `null`・停止していない・`missing`・`failed`・`null` の各場合に A1 どおり。`pendingSummaryText` が、合成の写しで件数 2・0、`state` が `ok` でない、`invariants` が `failed` のとき仕様の承認待ちを数えない、の各場合に A1 どおり
  - `GovernanceTheater.test.tsx`：今の試験はそのまま。初期の表示（取得前）に帯（`role="status"` の停止の文）と判断待ちの件数が出ないこと。`id="decisions"` の要素があること
  - 取得の後のつながり（停止中の合成の写しで帯が出る・停止が解けると消える・件数が下の欄の判断待ちの行の数と同じ・リンクで欄へ移る）と、1440×900・375px の収まりは、SSR の試験では確かめられないので、§3 で立法補佐が held の候補で確かめる。司法は差分（使う `data` とクラス）で判断する
- A5. `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る

## 3. 開発用テスト

held の後、release の前に、立法補佐が held の候補を一時的な作業ツリーで動かして確かめる。

- 提出記録で「判断待ち 1 件」（今の提出記録では T-027 の held）が出て、押すと「判断待ちと次の担当」の欄へ移る。帯は出ない
- 稼働中の観測で、写しを停止中の合成のものに差し替えると、次の取り直しで見出しに赤い帯「Kernel は停止中（…から）。統合しません」が出る。戻すと消える
- 1440×900 で、帯が出ても見出し・図・選んだ票・再生の操作がスクロールなしで見える。375px で横スクロールしない

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. A1（純粋関数と試験）→ A2 → 試験
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。T-036・T-037 の統合の後に作業員を起動する（同じ `GovernanceTheater.tsx` を触る）。

## 6. 記録

- 22:25 行政の長が W34 を起動（worktree `agent-ae749cb14c6fed88c`、T-037 を統合した後の main 66a726f から、モデルは Opus）。仕様はオーナーが 21:57:44 に approve-spec で承認済み（22:24:31 の Kernel の写しの `approvals[].current` で確かめた）。依存の T-033・T-035・T-036・T-037 は統合済み
- W34 の報告：HEAD `89a6b46d5950f4f4461365d771454c8dcb32a3c2`、66a726f の上に1コミット。test 903 件（47 ファイル）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:875` の `stopsDir` で差分の外）。§2 から外れる解釈はない
- 行政の長の確認（試験は再実行していない）：差分は A0 の4つだけ（+174 / -9）。`theater-banner.ts` の2つの関数は A1 の文面どおりで、型の3つは `import type`、`pendingDecisions`・`formatJst` は値として使うだけ。`pendingSummaryText` の数え方（`invariants` が `ok` のときだけその値、それ以外は `null`）は `DecisionPanel` と同じ。`GovernanceTheater.tsx` では、帯と件数を `data?.state ?? null`・`data?.invariants ?? null`（`DecisionPanel` に渡すものと同じ）から作り、state・ref・effect・fetch を足していない。`TheaterShell`・`selectSource`・T-035 の ref・`TicketReplay` の位置と `key`・`guideStep` は変わっていない
- 読み方が割れる所（W34 の選んだ読み方）：(1) 「取得の状態の項目の並びの後に」のリンクは、`<dl>` の中に `<a>` を入れると HTML として正しくないので、`<dl>` とリンクを flex-wrap の `div` で包み、リンクを `<dl>` の直後に置いた（広い画面では同じ行、狭い画面では折り返す。`<dl>` のクラスと中身は同じで、字下げだけ変わった） (2) 帯は `<p>` 1つに `role="status"`・赤の系統の文字・枠・背景・太字を直接付けた
- 補った解釈（文面の範囲内）：(1) リンクの色は `text-amber-200 underline font-semibold`（下の判断待ちの行の琥珀色に合わせた） (2) 帯は `px-3 py-1 text-sm` で1行に収まる大きさ、`break-words min-w-0` で狭い画面では折り返す。見出しのほかの余白は調整していない（帯を出すと約 30px 高くなる） (3) `invariants` が `missing`・`null` のときも、`failed` と同じく仕様の承認待ちを数えない（A1 の「ok ならその value・それ以外は null」）
- **確かめていない**：取得の後の帯の出方（停止中の写しで出る・停止が解けると消える）、件数と下の欄の判断待ちの行の数の一致（同じ `pendingDecisions` を同じ引数で呼ぶので、コードの上では一致するはず）、`#decisions` のリンクで欄へ移ること、1440×900 で帯が出ても最初の画面に収まること・375px で横スクロールしないこと、`npm run build`。§3 で立法補佐が held の候補で確かめる

## オーナーに聞くこと

1. 帯の文「Kernel は停止中（11/7 21:46 から）。統合しません」でよいか

- 2026-11-07T22:31:16+0900 gate-runner: status → review（判定に合格（judge=APPROVED codex=APPROVED）。夜間のため統合せず、朝のオーナーの承認を待つ）
