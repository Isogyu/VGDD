---
id: T-039
title: 統治シアターの開始の状態（見る記録と再生の票）を URL で決められるようにする
status: in_progress
requirements: [A0, A1, A2, A3, A4, A5]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-64]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐が起草（オーナーの承認前）。オーナーが 21:5x に案 F を採用
estimate_h: 1.5
time_limit_min: 120
security_review: false         # URL の値は決まった値の中から選ぶだけ。外へ送らない
unattended: false
branch: worktree-agent-a03e7c91133b5a54d
worker: W35
files_allowed:
  - src/lib/theater-start.ts                          # 新設：URL の値を検証する純粋関数
  - src/lib/theater-start.test.ts                     # 新設
  - src/components/theater/GovernanceTheater.tsx      # URL の値で最初の source と票を決める
  - src/components/theater/GovernanceTheater.test.tsx # 上に合わせて足すだけ
  - src/components/theater/TicketReplay.tsx           # 最初に選ぶ票の props を1つ足すだけ
  - src/components/theater/TicketReplay.test.tsx      # 上に合わせて足すだけ
files_forbidden:
  - src/lib/theater-data.ts
  - src/lib/theater-refresh.ts
  - src/lib/theater-replay.ts                         # pickFeatured などは import して読むだけ
  - src/lib/theater-stage.ts
  - src/lib/theater-guide.ts
  - src/lib/theater-banner.ts
  - src/lib/theater-evidence.ts
  - src/lib/claude-roles.ts
  - src/app/governance/**
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
depends_on: [T-032, T-035, T-038]
---

## 1. 目的

録画を撮り直すたびに、同じ状態から始められるようにする。また、審査員に「この票から見てください」とリンクで案内できるようにする。`/governance?source=live&ticket=T-014` のように、最初に見る記録（提出記録か稼働中の観測）と、再生で最初に選ぶ票を URL で決める。URL の値は決まった値の中から選ぶだけで、合わない値は今の既定に戻す。審査：デモ25、深さ20。

## 2. 受け入れ条件

- A0. 差分を許すパスは次の6つだけ：`src/lib/theater-start.ts`、`src/lib/theater-start.test.ts`、`src/components/theater/GovernanceTheater.tsx`、`src/components/theater/GovernanceTheater.test.tsx`、`src/components/theater/TicketReplay.tsx`、`src/components/theater/TicketReplay.test.tsx`。それ以外は変更しない。実装と差分の審査の基準は、T-038 を統合した後の main とする
- A1. **純粋関数**（`src/lib/theater-start.ts`。React を import しない。`node:fs` を読まない）：
  - `parseStartSource(value: string | null): TheaterSource`：`"live"` なら `"live"`、`"submission"` なら `"submission"`、それ以外（`null` を含む）は `"submission"`
  - `parseStartTicket(value: string | null): string | null`：文字列の全体が `T-` と ASCII の数字3〜4桁だけのときその文字列、それ以外は `null`（前後の空白・改行は取り除かずに拒む。たとえば `/^T-[0-9]{3,4}$/` を使い、`$` が末尾の改行の前でも合うことに注意して `\n` を含む値を拒む）
- A2. **URL の読み方**（`GovernanceTheater.tsx`）：
  - `next/navigation` の `useSearchParams` で `source` と `ticket` を読む（ページは今の `Suspense` の中にあるので、`src/app/governance/page.tsx` は変えない）
  - 開始の設定（source と ticket）は、`GovernanceTheater` が最初に作られたときに決め、同じ部品のまま URL が変わっても取り直さない
  - 最初の `source` の状態を `parseStartSource(searchParams.get("source"))` にする。そのあとの切り替えは今のまま（URL を書き換えない。履歴に足さない）
  - 決めた `parseStartTicket(searchParams.get("ticket"))` の値を、`TicketReplay` に新しい props `initialTicketId` として渡す（`null` も渡してよい）。source の手動の切り替えで `TicketReplay` が作り直される今の振る舞いは保ち、そのたびに決めた `initialTicketId` を使う（たとえば `ticket=T-026` で始め、手で T-014 を選んでから source を切り替えると、T-026 が最初に選ばれる）。T-035 の取り直しと T-037 の案内の開始・終了では、選択を変えない
  - ほかの部分（T-033〜T-038 の取得・取り直し・欄・案内・帯）は変えない
- A3. **再生の部品**（`TicketReplay.tsx`）：props に `initialTicketId?: string | null` を1つ足す。部品が作られたときの最初の選択だけに使う：`initialTicketId` が `pickFeatured(tickets)` の並びにあればその票、なければ今のまま並びの先頭。作られた後に `initialTicketId` が変わっても選択を変えない。ほかの振る舞い（再生・タイマー・通知・最初に戻す条件）は変えない
- A4. **公開してよい項目だけ**：URL の値は A1 で決まった値か票の ID の形にしてから使い、画面にそのまま文として出さない。通信先・取得の処理・保存・console への出力を新しく作らない。検証した source に応じて、今の `loadTheaterData` と稼働中の取り直しが動くことは許す。URL の生の値や票の値を、追加の通信に使わない
- A5. 試験と確かめ：
  - `theater-start.test.ts`：`parseStartSource` の `"live"`・`"submission"`・`null`・ほかの文字列。`parseStartTicket` の `"T-014"`・`"T-1234"`・`null`・`"t-014"`・`"T-14"`・`"T-014x"`・`"../x"`・`"T-014\n"`・`" T-014"`
  - `TicketReplay.test.tsx`：今の試験はそのまま。`renderToStaticMarkup` で、`initialTicketId` が並びにある票（例：並びの2番目）ならその票が選ばれた表示になり、並びにない票や `null` なら並びの先頭になること
  - `GovernanceTheater.test.tsx`：今の試験はそのまま（`useSearchParams` を使うので、試験では `next/navigation` を `vi.mock` で差し替えてよい）。URL に何もないとき最初の source は「提出記録」で、`source=live` のときは「稼働中の観測」が `aria-pressed="true"` になること
  - `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る
  - `npm run -s build` が通る。今のページの外側の Suspense の境界を保ち、`useSearchParams` を足したことによるプリレンダリングのエラーを出さない（`next/navigation` を差し替えた試験は、この確かめの代わりにしない。静的なシェルで今の境界の fallback が出ることは許す）

## 3. 開発用テスト

held の後、release の前に、立法補佐が held の候補を一時的な作業ツリーで動かして確かめる。

- `/governance?source=live&ticket=T-026` で、稼働中の観測が選ばれ、再生の票が T-026 になる
- `/governance?ticket=T-999` や `/governance?source=x` で、今の既定（提出記録・並びの先頭）になる
- 開いた後に source や票を切り替えても、URL は変わらない
- `npm run build` が通る（`useSearchParams` と Suspense の組み合わせ）

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. A1（純粋関数と試験）→ A3 と試験 → A2 と試験
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。T-038 の統合の後に作業員を起動する（同じ `GovernanceTheater.tsx` を触る）。

## 6. 記録

- 22:36 行政の長が W35 を起動（worktree `agent-a03e7c91133b5a54d`、T-038 を統合した後の main 0a6de21 から、モデルは Opus。T-041 の W36 と並行）。仕様はオーナーが 21:57:48 に approve-spec で承認済み（22:34:42 の Kernel の写しの `approvals[].current` で確かめた）。依存の T-032・T-035・T-038 は統合済み
- W35 の報告：HEAD `ec47ffbeaad086014f35221edea46bd6b1b5398d`、0a6de21 の上に1コミット。test 949 件（48 ファイル）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:875` の `stopsDir` で差分の外）。**`npm run -s build` は sandbox の中で落ちた**（Turbopack が `globals.css` の PostCSS のローダーで新しいプロセスを作り、ローカルのポートに bind しようとして `Operation not permitted (os error 1)`。変えたファイルとは関係なく、プリレンダリングの前に止まった）。W35 は `--webpack` などの回避をしていない。§2 から外れる解釈はない
- **build は立法補佐が ec47ffb で確かめた（22:4x、/governance は Static）**：立法補佐が ec47ffb を自分の一時的な作業ツリーで、sandbox の外でビルドした（W35 の worktree と main には触れず、sandbox の設定も変えていない）。build は成功し、経路の一覧で `/governance` は「○ (Static)」、`useSearchParams` によるプリレンダリングのエラーはない。あわせて起動して、`?source=live&ticket=T-026` で稼働中の観測と T-026 が選ばれること、`?source=x&ticket=T-014%0A` で既定（提出記録・並びの先頭）になることを確かめた
- 行政の長の確認（試験は再実行していない）：差分は A0 の6つだけ（+170 / -6）。`parseStartTicket` は `/^T-[0-9]{3,4}$/` だけで判定し、`trim` しない（JavaScript の `$` は `m` フラグがなければ文字列の末尾だけに合う）。試験で `"T-014\n"`・`"T-014\r\n"`・`" T-014"`・`"T-014 "`・`"T-014\t"`・全角の数字などを拒む。開始の設定は `useState` の初期化関数で `{ source, ticketId }` を一度だけ決め、最初の `source` の状態はその値。`TicketReplay` は `key={source}` のまま、作り直すたびに決めた `initialTicketId` を受ける。`TicketReplay` に足した props は `initialTicketId` の1つだけで、`useState` の初期値だけに使う。`selectSource`・T-035 の取り直し・ref・`guideStep`・T-038 の帯と件数は変わっていない。URL を書き換えるコード（`router`・`history`）はない
- 読み方が割れる所（W35 の選んだ読み方）：A3 の「並びにない票」は、(1) 入力の `tickets` にあるが `pickFeatured` の並びにない票（T-002）と、(2) 入力にない票（T-999）の2通りに読める。どちらでも並びの先頭になることを試験した（例の一覧にあるが入力にない T-013 も）
- 補った解釈（文面の範囲内）：(1) `initialTicketId` の既定値は `null`（`undefined` も同じ扱い） (2) 開始の設定は、`useState` の初期化関数で作る1つのオブジェクトに持つ (3) 試験の `next/navigation` の差し替えは `vi.hoisted` と `vi.mock` で書いた
- **確かめていない**：開いた後に source や票を切り替えても URL が変わらないこと、T-026 で始めて T-014 を選んでから source を切り替えると T-026 に戻ること、T-035 の取り直しと T-037 の案内の開始・終了で選択が変わらないこと（どれもコードを読んだだけ）。§3 で立法補佐が held の候補で確かめ、候補でもう一度 build を確かめる

## オーナーに聞くこと

1. 選べる票は、再生の並び（T-014・T-026・T-013）の中だけにする（並びを広げるのは別の票）

- 2026-11-07T22:48:27+0900 gate-runner: status → in_progress（judge=CHANGES_REQUIRED, codex=CHANGES_REQUIRED（両方が差し戻し））
