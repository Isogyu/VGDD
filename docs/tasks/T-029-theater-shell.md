---
id: T-029
title: 統治シアターの画面の骨格（区画・色・余白）を作り、/governance/theater で見られるようにする（統治シアター U1）
status: review
requirements: [A0, A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-64]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐が起草（オーナーの承認前）。ChatGPT の案（統治シアター）を立法補佐が仕分け、オーナーが 02:2x に「推奨で起草する」と決めた
estimate_h: 2
time_limit_min: 150
security_review: false         # データを読まない。API もファイルの読み込みも足さない
unattended: false
branch: worktree-agent-a69c40dca9341c11c
worker: W25
files_allowed:
  - src/components/theater/tokens.ts            # 新設：役割と状態の色・形・文字の決まり
  - src/components/theater/TheaterShell.tsx     # 新設：画面の骨格（区画だけ。中身は props で受ける）
  - src/components/theater/TheaterShell.test.tsx # 新設
  - src/app/governance/theater/page.tsx         # 新設：骨格を見るための入口（中身は空の区画）
files_forbidden:
  - src/app/governance/page.tsx                 # 今の /governance は変えない（組み込みは T-034）
  - src/components/Governance*.tsx
  - src/components/Kernel*.tsx
  - src/components/LawHistory.tsx
  - src/app/globals.css
  - src/app/layout.tsx
  - src/app/api/**
  - src/lib/**
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

作品の顔にする「統治シアター」の骨格を作る。今の `/governance` は、細い枠の区画と小さな文字が同じ強さで縦に並び、最初に見る人にはどこを見ればよいか分からない。新しい画面は、**主役の図・選んだ1件・再生の操作** の3つに強弱を付ける。この票では区画と色の決まりだけを作り、統治図（T-031）・再生（T-032）・証拠の欄（T-033）は、後の票が props で差し込む。依存パッケージは足さない。審査：デモ25、インパクト30。

## 2. 受け入れ条件

- A0. 差分は `files_allowed` の4つだけ。今の `/governance` の画面と、ほかの部品は変えない
- A1. `src/components/theater/tokens.ts` に、役割と状態の表示の決まりを、`as const` の1つのオブジェクトで置く。それぞれ Tailwind のクラス（文字・枠・背景）と、色だけに頼らないための **ラベル**（日本語）と **形の印**（1文字の記号）を持つ。
  - 役割：`human`（人：承認・裁定・停止）、`legislative`（立法）、`executive`（行政：Claude Code）、`judiciary`（司法：Claude と Codex）、`kernel`（Kernel：統合の条件を確かめる。中立色）、`merged`（統合）
  - 状態：`waiting`（判断待ち：琥珀色）、`stopped`（停止：赤）、`unknown`（確認できない：灰色。枠は破線）
  - 色の向き：立法は紫、行政は青、司法は金（amber／yellow）、Kernel は slate、統合は緑（emerald）。画面の背景は `bg-slate-950`、本文の文字は `text-slate-100`。役割の文字色は Tailwind の 200〜300 を使い、実際に隣り合う文字色と背景色の組でコントラスト 4.5:1 以上（§6 に組と値を書く）
- A2. `src/components/theater/TheaterShell.tsx` は、次の props を受けて並べるだけの部品（`"use client"` は付けない。データの取得も状態も持たない）。
  - `header`（作品名・観測の状態）、`stage`（主役の図）、`side`（選んだ票の詳細）、`controls`（再生の操作と要点）：いずれも `React.ReactNode`
  - 幅 1024px 以上（Tailwind の `lg:`）：上に `header`、中央は左 2/3 に `stage`、右 1/3 に `side`、下に `controls`。高さは画面の高さ（`lg:h-dvh`）を grid の行で上 15%・中央 65%・下 20% に分ける（`lg:grid-rows-[15fr_65fr_20fr]` のような明示の配分。区画の間の gap と外側の余白も明示する）
  - 収まり（スクロールしない）を求めるのは A3 の仮の中身のときだけ。後の票が渡す長い中身の扱い（区画の中のスクロールなど）は、その票で決める
  - 幅 1024px 未満：`header` → `stage` → `side` → `controls` の順に縦に並ぶ。横にスクロールしない
  - 区画はそれぞれ `<header>`・`<section aria-label="統治図">`・`<aside aria-label="選んだ票">`・`<footer aria-label="再生の操作">` で、全体の背景は A1 の濃い紺。親のテーマ（ライト／ダーク）にかかわらず同じ見た目
- A3. `src/app/governance/theater/page.tsx` は `TheaterShell` に、区画ごとの仮の中身を渡す。
  - `header`：`h1` に `VGDD Governance Kernel`、その下に1つの `p` 要素で `AI が作る。別系統の AI が独立して確かめる。統合の条件は Kernel が強制し、承認と停止は人が持つ。`（狭い画面では折り返す）
  - ほかの3つ：区画の名前と「（後の票で中身を入れる）」だけ。数字・票の ID・架空の記録は出さない
  - `metadata` の `title`：`統治シアター（試作）— VGDD Governance Kernel`
- A4. 動き（transition・animation）はこの票では付けない。`prefers-reduced-motion` の扱いは、動きを入れる票（T-031・T-032）で決める
- A5. 試験（`TheaterShell.test.tsx`）：`react-dom/server` の `renderToStaticMarkup` で `TheaterShell` を描き、4つの区画の要素（A2 の要素と `aria-label`）が A2 の順に出て、渡した中身が各区画の中に入ることを確かめる。`tokens` の各項目にラベルと形の印があり、役割の6つと状態の3つでラベルが互いに重ならないことを確かめる
- A6. `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る

## 3. 開発用テスト

夜間の合格（held）の後、release の前に、立法補佐が held の候補を一時的な作業ツリーで動かして次を確かめ、結果をオーナーに見せる（release の判断の材料。T-022・T-026 と同じ）。

- `/governance/theater` を 1440×900 で開き、4つの区画がスクロールなしで収まる。主役の図の区画がいちばん大きい
- 幅 375px で縦に並び、横にスクロールしない
- システムのライト／ダークのどちらでも同じ見た目
- 今の `/governance` が変わっていない

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. `tokens.ts` → `TheaterShell.tsx` → 試験 → `page.tsx` の順
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。新しいファイルだけで、T-028 と同時に進めても衝突しない。

## 6. 記録

- 02:28 行政の長が W25 を起動（worktree `agent-a69c40dca9341c11c`、main e82c150 から、モデルは Opus）。T-028 と並行。仕様はオーナーが 02:27:19 に approve-spec で承認済み（立法補佐の指示の条件を、02:27:43 の Kernel の写しの `approvals[].current` で確かめた）
- W25 の報告：HEAD `c92b7672e185dd598a337b81e69d99c8c185aefe`。test 372 件（29 ファイル。うち新しい試験 12 件）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:723` で差分の外）。**画面は動かしていない**（`npm run dev` は実行していない。見た目、1440×900 の収まり、幅 375px、ライト／ダーク、Tailwind のクラスの生成は未確認。§3 で立法補佐が held の候補で確かめる）
- A1 のコントラスト（WCAG 2。`tailwindcss` 4.3.4 の `theme.css` の oklch を線形 sRGB に変換し、範囲外は 0〜1 に丸めて計算した値。ブラウザの実測ではない）。項目ごとの「文字色／自分の背景」：human pink-200／pink-950 10.89、legislative violet-300／violet-950 8.21、executive blue-300／blue-950 8.13、judiciary yellow-200／yellow-950 12.52、kernel slate-200／slate-800 11.90、merged emerald-300／emerald-950 9.98、waiting amber-300／amber-950 10.37、stopped red-300／red-950 8.40、unknown gray-300／gray-900 12.06。今の画面で実際に使う組：slate-100／slate-950 18.40（h1）、slate-300／slate-950 13.59（header の `p`、side と controls の仮の文）、slate-300／slate-900 12.02（stage の仮の文）。最小は 8.13 で、すべて 4.5:1 以上。役割の色はこの票の画面ではまだ使っていない
- 補った解釈：(1) ラベルは括弧書きのコロンの前（人・立法・行政・司法・Kernel・統合・判断待ち・停止・確認できない）(2) 形の印は W25 が決めた（◆ ▲ ■ ● ◎ ✓ … × ?）(3) `human` の色は §2 に指定がなく pink にした（オーナーの好みで変えられる）(4) `judiciary` は yellow、`waiting` は amber で分けた (5) 区画に `min-h-0` を付けていない（中身が大きいか画面が低いと、行が 15:65:20 より広がる。区画は重ならない。§2 のとおり長い中身の扱いは後の票）(6) 横にスクロールさせないため全体に `overflow-x-clip`（はみ出した中身は切られる）(7) `min-h-dvh` を足した (8) A3 のページの文言も同じ試験で確かめた (9) §1 の強弱のため、`stage` にだけ `bg-slate-900` と強めの枠。手順の案からの逸脱：試験がページも読むので、`page.tsx` を試験と同時に書いた
- 拒否された操作：worktree の外の scratchpad への Write（フック）。Tailwind のクラスの生成を確かめるコマンド（フックが正規表現の `>` と `/^` をリダイレクトと判定。先頭に不要な `npx --no-install --version` が入っていたのは W25 の誤りと本人が報告。実行されていない）。どちらも回避も再試行もしていない
- 02:34 行政の長が差分を確認（`files_allowed` の4つだけ、追加 274・削除 0。`TheaterShell` は `"use client"`・取得・状態なしで、要素・`aria-label`・順・grid の配分が A2 と一致。A1 の役割6つと状態3つ、A3 の h1・p・`metadata.title` の文字列を §2 と読み合わせた。`transition`・`animation`・`dark:` なし。行政の長は試験と画面を自分では動かしていない）。`status: review` で main にコミットし申請

## オーナーに聞くこと

1. A3 の1行の文（作品の要約）は §2 なので、承認の前に決める。直すなら承認の前に言ってほしい
2. 画面の背景を、システムのライト／ダークにかかわらず濃い紺に固定する（録画で見た目をそろえるため）
3. 入口は `/governance/theater`（試作）。今の `/governance` に組み込むのは T-034

- 2026-11-07T09:42:37+0900 gate-runner: status → blocked（judge と Codex の判定が重大な指摘で分かれた（judge=APPROVED/0 件, codex=CHANGES_REQUIRED/1 件）。オーナーの裁定へ）
- 09:44 オーナーが裁定（merge）。申請の SHA は変えずに申請し直す
