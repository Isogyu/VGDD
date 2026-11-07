---
id: T-034
title: 統治シアターを /governance の先頭に組み込み、今の区画を下の「証拠」に移し、旧い API から記録の文を除く（統治シアター U7）
status: review
requirements: [A0, A1, A2, A3, A4, A5, A6, A7, A8]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-64, D-65]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐が起草（オーナーの承認前）。統治シアターの U7。T-028・T-030・T-032 の §1 で「公開の前の条件」とした旧い API の記録の文の除去を含む
estimate_h: 3
time_limit_min: 210
security_review: true          # API の応答を変える（公開してよい項目だけにする）
unattended: false
branch: worktree-agent-a7ea5f6c7fe8f6632
worker: W29
files_allowed:
  - src/lib/governance-public.ts                   # 新設：旧い API の応答から記録の文を除く純粋関数
  - src/lib/governance-public.test.ts              # 新設
  - src/app/api/governance/route.ts                # 応答を governance-public で組み立てるだけ
  - src/components/GovernanceView.tsx              # 見出しを「証拠」にし、記録の文の表示をやめる
  - src/components/theater/GovernanceTheater.tsx   # 新設：シアターの部品をつなぐ（データの取得・選んだ出来事・提出記録と稼働中の切り替え）
  - src/components/theater/GovernanceTheater.test.tsx  # 新設
  - src/components/theater/TheaterShell.tsx        # 区画の高さの制約だけ
  - src/components/theater/TheaterShell.test.tsx   # 上に合わせて直すだけ
  - src/app/governance/page.tsx                    # シアターを先頭に、今の画面を下に
files_forbidden:
  - src/lib/governance.ts                          # 読み込みは変えない（差し戻しの数えにも detail を使う）
  - src/lib/governance-replay*.ts
  - src/lib/theater-*.ts                           # T-030〜T-032 の純粋関数は読むだけ
  - src/components/theater/GovernanceStage.tsx
  - src/components/theater/TicketReplay.tsx
  - src/components/theater/tokens.ts
  - src/app/governance/theater/**                  # 試作の入口は残す
  - src/app/api/governance/replay/**
  - src/app/api/governance/kernel/**
  - src/app/api/governance/history/**
  - src/components/GovernanceMap.tsx
  - src/components/KernelPanel.tsx
  - src/components/KernelInvariants.tsx
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
depends_on: [T-028, T-029, T-030, T-031, T-032]
---

## 1. 目的

作品の顔「統治シアター」を `/governance` の先頭に置き、審査員が最初に見る画面にする。今の区画（全体図・Kernel・不変条件と承認待ち・法律の歴史・統治の数字・票の盤・票1枚の運命）は消さずに、シアターの下の「証拠」に移す。あわせて、旧い `GET /api/governance` が返していた票の §6 の記録の文（`detail`。SHA・パス・判定の要約を含む）を応答から除き、画面からも消す。T-028・T-030・T-032 で「公開の前の条件」とした仕事で、これで公開の画面に記録の文が出なくなる。審査：デモ25、インパクト30。

## 2. 受け入れ条件

- A0. 差分は `files_allowed` の9つだけ。`GovernanceStage.tsx`・`TicketReplay.tsx`・`tokens.ts` と T-028〜T-032 の純粋関数は import して読むだけで、変えない
- A1. **旧い API の記録の文の除去**：`src/lib/governance-public.ts`（`node:fs` を読まない。`import type` で `@/lib/governance` の型を読むのは可）に純粋関数 `toPublicGovernance(data)` を置く。
  - 返す形：`{ generated_at, board, summary, tickets: [{ id, title, status, returns, disagreements, timeline: [{ ts, actor, status }] }] }`。各階層で許可したキーだけを明示して組み立てる（入力のオブジェクトを広げてコピーしない）。`detail` はどこにも入れない
  - `board`・`summary` は、既存の `GovernanceBoard`・`GovernanceSummary` の項目と値を保つ（`null` は `null` のまま）。入れ子も既知のキーだけで組み立て直す。`summary.deny_kinds` と `summary.by_agent` の動的なキーは保ち、`by_agent` の値は `calls`・`deny` だけにする
  - 公開の応答の型（`PublicGovernance` とその票・出来事の型）を同じファイルから export する。内部の `TimelineEvent` の `detail` は消さない（`governance.ts` は変えない）
  - `src/app/api/governance/route.ts` は `toPublicGovernance(loadGovernance())` を返す。export する HTTP メソッドは `GET` だけ。ほかの書き方（`connection()`・例外の扱い）は今のまま
- A2. **今の画面**（`GovernanceView.tsx`）：
  - 見出しの `h1` を `h2`「証拠：実運用の集計・票の記録・検証結果」にする（ページの `h1` はシアターが持つ）。説明の文と「← 作業画面へ」の導線は残す
  - 「票1枚の運命」の区画は、時刻・担い手・状態の札だけを出し、記録の文（`e.detail`）は出さない
  - state・JSON の型付け・補助関数（`sortTimeline`・`defaultTicketId`・担い手のラベルの表など）の型を、A1 で export した公開の型か、そこから派生した型にする
  - ほかの区画とその中身は変えない
- A3. **シアターの部品**（`src/components/theater/GovernanceTheater.tsx`、`"use client"`）：
  - データは `loadTheaterData(source, fetch)`（T-030）だけで取る。最初の source は `"submission"`（clone した審査員でも中身が出る）。見出しの区画に「提出記録」「稼働中の観測」を切り替えるボタン（`aria-pressed`）を置く
  - source を変えたら：取得中に戻し、取得の結果と選んだ出来事を消し、`TicketReplay` を外す（`key` を source にするなど）。変える前の要求の応答と、部品が外れた後の応答は反映しない。取得が終わったら、再生は始まる前から。もう一方の source に自動で切り替えない
  - 見出しの区画：`h1`「VGDD Governance Kernel」、その下に1行「AI が作る。別系統の AI が独立して確かめる。統合の条件は Kernel が強制し、承認と停止は人が持つ。」、見ている source（「提出記録」か「稼働中の観測」）、Kernel の写しの書き出しの時刻（`generated_at` を `formatJst` で。なければ「—」）、3つの取得の状態「公開イベント」「Kernel の写し」「不変条件の写し」。状態の文は、取得前は「読み込み中…」、`ok` は「取得済み」、`missing` は「書き出しがありません」、`failed` は「取得できませんでした」
  - 主役の区画：`GovernanceStage`（T-031）に、`TicketReplay` が知らせた今の出来事を `focusFor`（T-031）で変えた値を渡す（出来事が `null` なら `null`）。`stopped` は、Kernel の写しが `ok` で `stopped.active` が true のときだけ true
  - 選んだ票の区画：今の出来事の文（`labelFor`）、時刻（`formatJst`）、Claude と Codex の結論（`null` は出さない）。出来事がなければ「下の再生を押すと、票1枚の記録を順に追います」。あわせて「出来事は票の §6 の記録の分類です。記録の文そのものは公開していません」
  - 再生の区画：`TicketReplay`（T-032）に、replay が `ok` のときの `tickets` を渡す。replay が `ok` でなければ「記録を取得できませんでした」
- A4. **区画の高さ**（`TheaterShell.tsx`）：幅 1024px 以上のときの行の配分を、見出しは中身の高さ、主役と選んだ票は残りの高さ、再生は高さ 16rem に変える（例：`lg:grid-rows-[auto_minmax(0,1fr)_16rem]`）。主役・選んだ票・再生の区画に `min-h-0` を付け、選んだ票の区画は中で縦にスクロールできる（`overflow-y-auto`）。幅 1024px 未満のときは今のまま縦に並び、見出しの区画の下に余分な空きを作らない
  - 主役の図の高さの制約は、`GovernanceTheater` の主役の区画の包み（ラッパー）から子要素のセレクタで与える（例：`lg:h-full lg:[&_svg]:max-h-full lg:[&_svg]:w-auto lg:[&_svg]:mx-auto`）。`GovernanceStage` の本体と props は変えない。制約は `lg:` 以上だけで、狭い画面では SVG の縦横比どおりの高さ
  - 画面の合否：`/governance` を 1440×900 で開くと、ページをスクロールせずに見出し・図・選んだ票・再生の操作が見え、出来事の一覧は再生の区画の中でスクロールする。幅 375px では区画が見出し・図・選んだ票・再生の順に並び、ページに横スクロールが出ない。この2つは SSR の試験では確かめられないので、司法は差分のクラスの配分で判断し、実際の収まりは §3 で立法補佐が held の候補で確かめる
- A5. **ページ**（`src/app/governance/page.tsx`）：先頭に `GovernanceTheater`、その下に今の `GovernanceView` を置く（どちらも今の `Suspense` の中）。タブの題は `src/app/layout.tsx` から受け継ぎ、ページに `metadata` を足さない
- A6. **公開してよい項目だけ**：シアターに出すのは、票の ID と題、整形した時刻、決まった文、判定の結論、source と書き出しの時刻だけ。入力全体を JSON にして出さない。console への出力・保存・送信をしない
- A7. 試験：
  - `governance-public.test.ts`：`detail` に自由な文・SHA・パスを入れ、票と出来事に余分な項目を足した合成の入力で、トップ・票・出来事のキーの集合が A1 の形と完全に一致し、合成の文字列が応答のどこにも残らない。`board`・`summary`（入れ子と `by_agent` の値を含む）にも余分な項目を足し、それが落ちて既知の項目と値と `null` が保たれる。リポジトリの実際の `docs/tasks` を `loadGovernance(process.cwd())` で読んで `toPublicGovernance` に通し、票と出来事がそれぞれ1件以上あることを確かめてから、出来事の配列の `JSON.stringify` に `files_allowed`・`main=`・16進の12文字以上の並びが入らず、出来事のキーの集合がちょうど `ts`・`actor`・`status` であること
  - `GovernanceTheater.test.tsx`：`react-dom/server` の `renderToStaticMarkup` で初期の表示だけを試す（取得・クリック・再生は試さない）。`h1` の文、A3 の1行の文、「提出記録」「稼働中の観測」のボタン（最初は「提出記録」が `aria-pressed="true"`）、3つの取得の状態がどれも「読み込み中…」
  - `TheaterShell.test.tsx`：A4 に合わせて直す（4つの区画の要素と順は今のまま）
- A8. `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る

## 3. 開発用テスト

held の後、release の前に、立法補佐が held の候補を一時的な作業ツリーで動かして確かめる（稼働中の写しを置く場合と置かない場合の両方）。

- `/governance` を 1440×900 で開くと、シアターが画面いっぱいに出て、ページを下に送ると「証拠」の区画が続く。最初の画面でスクロールせずに、見出し・図・選んだ票・再生の操作が見える
- 「提出記録」で、T-014 を再生すると図の光る場所と選んだ票の文が変わり、最後に止まる。「稼働中の観測」に切り替えると、稼働中の写しがない作業ツリーでは Kernel の項目が「取得できませんでした」か書き出しなしになり、提出記録には戻らない
- `GET /api/governance` の応答に `detail` がない。「証拠」の票1枚の運命に記録の文が出ない
- 幅 375px で縦に並び、横にスクロールしない

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. A1（純粋関数と試験、API）→ A2 → A4 → A3 と試験 → A5
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ Codex security。T-033 を同時に進める場合は、`GovernanceView.tsx`・`page.tsx` を T-033 が触らないこと（T-033 は新しい部品だけ）。

## 6. 記録

- 15:17 行政の長が W29 を起動（worktree `agent-a7ea5f6c7fe8f6632`、main 9ba7f0c から、モデルは Opus）。仕様はオーナーが 15:16:38 に approve-spec で承認済み（15:17:05 の Kernel の写しの `approvals[].current` で確かめた）。依存の T-028〜T-032 は統合済み
- W29 の報告：HEAD `471837dd4fdb27c047db1b6b35dfa01b20445e89`。test 767 件（38 ファイル）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs` の `stopsDir` で差分の外）。**source の切り替え、古い応答の破棄、取得後の表示、再生と図の連動、1440×900 と 375px の実際の収まり、route を通した `GET /api/governance` の応答、`npm run build` は確かめていない**。§3 で立法補佐が held の候補で確かめる
- 行政の長の確認（試験は再実行していない）：差分は `files_allowed` の9つだけ（+440 / -21）。`governance-public.ts`・`GovernanceTheater.tsx` の全体と、route・page・`GovernanceView`・`TheaterShell` の差分を §2 と読み合わせた。`eval/`・`scripts/` に `api/governance` を使う箇所はない（main で検索）
- 審査で問われそうな点：
  1. replay の取得中は「読み込み中…」、失敗のときだけ「記録を取得できませんでした」を出す。A3 の文面は「replay が `ok` でなければ」だが、取得前に失敗と出さないのが A3 の趣旨と読んだ
  2. 時刻の形が、写し（`11/7 02:03`）と出来事（`11/07 02:03`）で違う。写しの `generated_at` は `+09:00` の形で、`theater-replay.ts` の `formatJst` は `+0900` の形しか読めないため、写しには `kernel-state-schema.ts` の `formatJst` を使った。どちらの関数も変更禁止のファイルにある
  3. `TheaterShell` の `content-start` は、幅 1024px 未満で見出しの下に空きを作らないために足した（A4）。同じ部品を使う試作の入口 `/governance/theater` にも効く
- 補った解釈：(1) `deny_kinds`・`by_agent` の動的なキーは `Object.fromEntries` で写す（`__proto__` というキーでもプロトタイプが変わらない。試験を足した） (2) 古い要求は中止せず、応答を捨てるフラグで防ぐ（`loadTheaterData(source, fetch)` に `fetch` をそのまま渡すため。古い要求は最後まで走るが、画面には反映しない）
- 申請の基点は 9ba7f0c のまま。その後 main は abdc3c0 まで文書の2コミットで進んだが、差分とファイルは重ならない。積み直さず、裁判所が最新の main と組み合わせた候補を作る（オーナーの判断）

## オーナーに聞くこと

1. 最初に見せる source は「提出記録」にする（clone した審査員でも中身が出る。録画では「稼働中の観測」に切り替えて見せられる）
2. 試作の入口 `/governance/theater` は残す（消すのはファイルの削除なので、オーナーの承認が要る。提出の後に整理する）

- 2026-11-07T15:28:45+0900 gate-runner: status → review（判定に合格（judge=APPROVED codex=APPROVED）。夜間のため統合せず、朝のオーナーの承認を待つ）
