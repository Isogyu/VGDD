---
id: T-031
title: 統治シアターの主役の図（人・三権・Kernel・統合の SVG）を作り、記録の出来事ごとに光る場所を変える（統治シアター U3）
status: merged
requirements: [A0, A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-64]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐が起草（オーナーの承認前）。統治シアターの U3
estimate_h: 3
time_limit_min: 210
security_review: false         # データを読まない。props で受けて描くだけ
unattended: false
branch: worktree-agent-aaa0305065aee77b0
worker: W27
files_allowed:
  - src/lib/theater-stage.ts                      # 新設：出来事 → 図のどこを光らせるかの純粋関数
  - src/lib/theater-stage.test.ts                 # 新設
  - src/components/theater/GovernanceStage.tsx    # 新設：主役の図（SVG）
  - src/components/theater/GovernanceStage.test.tsx  # 新設
files_forbidden:
  - src/components/theater/tokens.ts              # T-029 の決まりは読むだけ
  - src/components/theater/TheaterShell.tsx
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
depends_on: [T-028, T-029]
---

## 1. 目的

統治シアターの中央に置く、作品の「顔」の図を作る。人（承認・裁定・停止）を上に、立法・行政・司法を中段に、Kernel（統合の条件を確かめる検問）を下に、その先に統合を置き、役割の間の流れ（仕様・申請・判定・差し戻し・人への差し戻し・裁定・統合）を線で描く。記録の出来事（T-028 の公開用のイベント）を1つ受けると、その出来事に関わる役割と線だけが光る。誰が何を担ったか（Claude Code・Claude・Codex）を図の中に書き、「Claude の活用」と「どこが自作か」が見て分かるようにする。依存パッケージは足さない。審査：デモ25、Claude の活用25。

## 2. 受け入れ条件

- A0. 差分は `files_allowed` の4つだけ。T-029 の `tokens.ts` は import して読むだけで、変えない
- A1. `src/lib/theater-stage.ts`（`node:fs` を読まない）に、図の部品の ID を型で置く。
  - 役割（節）：`human`・`legislative`・`executive`・`judiciary`・`kernel`・`merged`（T-029 の `tokens.ts` の役割と同じ名前）
  - 線：`spec`（立法 → 行政）、`submit`（行政 → Kernel）、`verdict`（司法 → Kernel。司法は Kernel に呼ばれて判定を返す）、`return`（Kernel → 行政）、`escalate`（Kernel → 人。裁定または統合の承認を待つ）、`ruling`（人 → Kernel）、`approve`（人 → 立法）、`merge`（Kernel → 統合）
  - 8本の線は**制度の上の経路**で、いつも描く。強調は**記録が示す出来事**で、この2つを見た目で分ける（経路は細く暗い線、強調は太く明るい線）
- A2. 同じファイルに純粋関数 `focusFor(event)` を置く。入力は `{ kind, reason, judge, codex }`（T-028 の公開用のイベントの4項目。型は値として import せず、同じ形を自分で書く）。返り値は `{ nodes, edges, tone: "normal" | "waiting" | "unknown", judge, codex }`。`nodes`・`edges` は ID の重複のない readonly の配列（順は表のとおり）。対応は次の表のとおり。`judge`・`codex` は入力をそのまま返す

  | kind（reason） | nodes | edges | tone |
  |---|---|---|---|
  | `returned`（`scope`・`rebase`・`other`） | kernel, executive | return | normal |
  | `returned`（`security`・`judiciary`） | judiciary, kernel, executive | verdict, return | normal |
  | `blocked`（`disagreement`） | judiciary, kernel, human | verdict, escalate | waiting |
  | `blocked`（`return_limit`） | kernel, human | escalate | waiting |
  | `blocked`（`spec_unapproved`） | legislative, kernel, human | escalate | waiting |
  | `blocked`（`other`） | kernel | なし | unknown |
  | `held`（夜間の合格。統合の承認待ち） | judiciary, kernel, human | verdict, escalate | waiting |
  | `merged` | kernel, merged | merge | normal |
  | `released` | human, kernel, merged | merge | normal |
  | `ruling`（裁定が済んだ） | human, kernel | ruling | normal |
  | `minor_disagreement` | judiciary, kernel | verdict | normal |
  | `resubmitted` | executive, kernel | submit | normal |
  | `other` | なし | なし | unknown |

- A3. `src/components/theater/GovernanceStage.tsx`：props は `focus`（A2 の返り値、または `null`）と `stopped: boolean` だけ。データを取りに行かず、状態を持たない（`"use client"` を付けない）。
  - 1つの `<svg>`（`viewBox` を固定し、幅いっぱいに縮む。`role="img"` と、今の状態を言葉で表す `aria-label`）。6つの節と8本の線を、A1 の位置関係（人が上、立法・行政・司法が中段の左から順、Kernel が下、統合が Kernel の右か下）で描く
  - 節と線の色は `tokens.ts` の役割と状態に合わせ、SVG の `fill`・`stroke` を Tailwind のクラス（`fill-*`・`stroke-*`）で明示する。SVG の中の文字は、1440×900 で TheaterShell の主役の区画（幅の 2/3）に置いたとき、表示の大きさで 12px 以上になる `viewBox` と文字の大きさにする
  - 節には T-029 の `tokens.ts` のラベルと形の印を書き、次の担い手の文字を添える：行政「Claude Code（作業員は worktree で並行）」、司法「Claude と Codex（記録の構成。運用では Claude の別セッションでも可）」（1行に収まらなければ、括弧の部分を2行目に折り返す）、立法「Claude（立法補佐）と人」、Kernel「自作：フック・裁判所・証拠ストア」。司法の節には `focus` の `judge`・`codex` を「Claude：合格／差し戻し／—」「Codex：…」の2つの小さな札で出す（`null` と `focus: null` のときは「—」）
  - `focus` の `nodes`・`edges` に入る節と線だけを強調する（太さと明るさ。色だけに頼らない）。ほかは暗くする。`focus` が `null` なら全体を同じ強さで描く
  - `tone` が `waiting` なら人の節に `tokens` の `waiting`（琥珀色・形の印・「判断待ち」）、`unknown` なら全体に `tokens` の `unknown`（灰色・破線・「確認できない」）を出す
  - `stopped` が true なら、`focus` にかかわらず Kernel の節に `tokens` の `stopped`（赤・形の印・「停止中」）を出し、線の強調をすべて止める
  - 動きは、強調の切り替えの transition（300ms 以下）だけ。Tailwind の `motion-safe:` を付け、`prefers-reduced-motion` では動かさない。常に動く演出（点滅・粒子・回転）は付けない
- A4. 記録にない経路を描かない：A1 の8本の線のほかの線を描かない
- A5. 試験：
  - `theater-stage.test.ts`：A2 の表の行を、表でまとめた `reason` も1つずつ分けて、すべて確かめる（`nodes`・`edges` は集合として期待値と完全に一致）。`judge`・`codex` がそのまま返る
  - `GovernanceStage.test.tsx`：`react-dom/server` の `renderToStaticMarkup` で描き、6つの節のラベルと4つの担い手の文字が出る（2行に折り返した文字は、行ごとの文字列がそれぞれ出ることを確かめてよい）。節に `data-node`、線に `data-edge` の ID を付け、`focus` を与えると `data-active="true"` の付いた節と線の ID の集合が `nodes`・`edges` と完全に一致する。`focus: null` で判定の札が両方「—」。`stopped` で「停止中」が出て、`data-active="true"` の線が0本になる。`tone: "unknown"` で「確認できない」が出る。線の要素（`data-edge`）がちょうど8つ
- A6. `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る

## 3. 開発用テスト

held の後、release の前に、立法補佐が held の候補を一時的な作業ツリーで動かして確かめる（この票では入口を足さないので、確認用の一時的なページは立法補佐が作業ツリーの中だけで作り、コミットしない）。

- 1440×900 の TheaterShell の主役の区画で、担い手の文字と判定の札を含めて文字の重なり・欠けがない
- T-014 の4つの出来事を順に与えると、光る場所が A2 のとおりに動く
- `prefers-reduced-motion` で切り替えが即時になる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. `theater-stage.ts` と試験 → `GovernanceStage.tsx` と試験
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。T-030 とはファイルが重ならない。

## 6. 記録

- 12:29 行政の長が W27 を起動（worktree `agent-aaa0305065aee77b0`、main ea8367f から、モデルは Opus）。仕様はオーナーが 12:27:02 に approve-spec で承認済み（12:28:28 の Kernel の写しの `approvals[].current` で確かめた）
- W27 の報告：HEAD `d446972aeb0268d60d070164b01d99d1e740bf87`。test 626 件（34 ファイル）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:851` で差分の外）。**画面は動かしていない**。1440×900 の文字の重なり・欠け、Tailwind のクラスが CSS になること、`prefers-reduced-motion` は未確認で、§3 で立法補佐が held の候補で確かめる
- 行政の長の確認（試験は再実行していない）：差分は `files_allowed` の4つだけ（+816）。A2 の表の全行を実装と照合した。`<path>`・`<polygon>` はそれぞれ8個ですべて `data-edge` の中。座標を読んだ範囲で、線は節を横切らない
- 補った解釈：(1) §2 の表にない組み合わせ（`returned`・`blocked` で reason が `null` か表にない値）は `other` の行と同じ（何も光らせず `unknown`）(2) 司法の文字は3行に折り返した（「Claude と Codex」「（記録の構成。」「運用では Claude の別セッションでも可）」）。§2 は括弧の部分を2行目に折り返すとしているが、13px の1行では節の幅に収まらないため。文字は変えていない (3) `stopped` で止めるのは線の強調だけで、節の `data-active`、人の判断待ち、全体の確認できないは残す (4) `unknown` の「全体に」は、図の全面の灰色の破線の枠、左上の「確認できない」、各節の灰色の破線の枠。Kernel の停止中と人の判断待ちを優先する (5) 線のラベルは §1 の語。`held` でも escalate のラベルは「人への差し戻し」(6) 人の節の添え書き「承認・裁定・停止」は §1 と `tokens.ts` のコメントから (7) `viewBox` は `0 0 900 490` で文字は 13 以上。主役の区画の内側を幅約 899px と計算した値で、実測ではない (8) 司法の節の幅は 268 で、ほかの中段の節（260）より広い
- T-034 への申し送り：SVG は `h-auto w-full` で幅に合わせて高さが決まる。画面の高さが 900 より低いと、区画に収まらず行が伸びる可能性がある

## オーナーに聞くこと

1. 節に添える担い手の文字（A3）は §2 なので、承認の前に決める。とくに Kernel の「自作：フック・裁判所・証拠ストア」と、司法の文字（11/7 オーナーが案A に決めた：構築の段階の記録は Codex を第2の司法にした構成で、本来の運用は1つの Claude アカウントで役割を分けたセッション）
2. 司法のモデル名（Sonnet など）は書かない。判定の担い手のモデルは設定で変えられ、図が古くなるため

- 2026-11-07T12:41:05+0900 gate-runner: status → review（判定に合格（judge=APPROVED codex=APPROVED）。夜間のため統合せず、朝のオーナーの承認を待つ）

- 2026-11-07T14:56:48+0900 release: status → merged（main=59d125d1a5ee。夜間の判定に合格した候補 9f5f2b95b501 を、オーナーが朝に承認して統合）
