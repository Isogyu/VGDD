---
id: T-024
title: 統治のライブ画面に「不変条件（INV-01〜12）」と「承認待ちの票」の区画を足す
status: merged
requirements: [A1, A2, A3, A4, A5, A6, A7]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-63, ADR-039, INV-01〜12]   # 記録用。司法には渡さない
proposal_from: 2026-11-06 立法補佐が起草（オーナーの承認前）。法律 p0.4.4 で裁判所が書き出す docs/governance/kernel-invariants.json（vgdd.kernel-invariants.v1）を見せる。オーナーの総括の不変条件 INV-01〜12 を、判例で確かめているかどうかとともにデモで5秒で伝える
estimate_h: 2.5
time_limit_min: 180
security_review: true          # 新しい GET の API がファイルを読む
unattended: false
branch: worktree-agent-aed0ebdc821163d18   # 作業員のブランチ（main 5bb8124 から）。統合キュー（p0.3.1）により main から分岐したまま申請
worker: W20
files_allowed:
  - src/lib/kernel-invariants-schema.ts     # 新設：形の検証と表示用の集計（純粋関数だけ。node:fs を使わない）
  - src/lib/kernel-invariants.ts            # 新設：ファイルの読み込み（node:fs）
  - src/lib/kernel-invariants.test.ts       # 新設
  - src/app/api/governance/kernel/invariants/route.ts   # 新設：GET
  - src/components/KernelInvariants.tsx     # 新設：区画
  - src/components/GovernanceView.tsx       # 区画を1つ差し込むだけ
files_forbidden:
  - src/lib/kernel-state.ts
  - src/lib/kernel-state-schema.ts
  - src/lib/kernel-state.test.ts
  - src/app/api/governance/kernel/route.ts
  - src/components/KernelPanel.tsx
  - src/lib/governance.ts
  - src/app/api/governance/route.ts
  - src/app/governance/page.tsx
  - src/lib/db/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-022]
---

## 1. 目的

作品の主役は VGDD（D-63）。オーナーの総括の不変条件 INV-01〜12 のそれぞれを、Kernel が「強制・一部・対象外」のどれで扱い、最後の適合性テストで合格したかを、統治のライブ画面で見せる。あわせて、仕様の承認を待っている票の一覧（ADR-039 の最小形）を出し、オーナーが承認待ちを1か所で確認できるようにする（承認の操作は含めない。承認は今までどおり approve-spec.sh）。データは裁判所が書き出す `docs/governance/kernel-invariants.json`（法律 p0.4.4。**表示用の写しで、判断の根拠にしない**）。審査：深さと実行20、デモ25。

## 2. 受け入れ条件

- A0. 差分のファイルは次の6つだけ：`src/lib/kernel-invariants-schema.ts`（新設）、`src/lib/kernel-invariants.ts`（新設）、`src/lib/kernel-invariants.test.ts`（新設）、`src/app/api/governance/kernel/invariants/route.ts`（新設）、`src/components/KernelInvariants.tsx`（新設）、`src/components/GovernanceView.tsx`。この写しは**表示用で、承認の効力を与えない**（画面の文と部品のコメントに書く）
- A1. `src/lib/kernel-invariants-schema.ts`（**`node:fs` を import しない**）に `pickKernelInvariants(json: unknown): KernelInvariants | null` を export する。zod の **strict** で次を検証し、合わなければ `null`：`schema: z.literal("vgdd.kernel-invariants.v1")`、`generated_at: Iso`、`kernel_version: Ver.nullable()`、`verified_by: z.object({ kernel_version: Ver, impl: z.literal("z3"), at: Iso.nullable() }).strict().nullable()`（補助：`Iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?([+-]\d{2}:\d{2}|Z)$/)`、`Ver = z.string().max(40).regex(/^p\d+\.\d+\.\d+[a-z]?$/)`。書き出し側と同じ形）、`invariants: z.array(z.object({ id: z.string().regex(/^INV-\d{2}$/), status: z.enum(["enforced","partial","not_applicable"]), tests: z.number().int().min(0).max(1_000_000), verified: z.boolean().nullable() }).strict()).max(50)`、`pending_approvals: z.array(z.object({ task: z.string().regex(/^T-\d{3,4}$/), status: z.enum(["ready","in_progress","review","blocked"]) }).strict()).max(500)`。写しは自由な文（題名）を持たない（法律 p0.4.4）
- A2. 同じファイルに純粋関数 `summarizeInvariants(x: KernelInvariants): { enforced: number; partial: number; notApplicable: number; passed: number; failed: number; unknown: number }` を export する。`enforced`・`partial`・`notApplicable` は `status` ごとの件数、`passed`・`failed`・`unknown` は `verified` が `true`・`false`・`null` の件数
- A3. `src/lib/kernel-invariants.ts` に `loadKernelInvariants(root = process.cwd()): KernelInvariants | null` を export する。読むのは `<root>/docs/governance/kernel-invariants.json` の1か所だけで、パスの組み立てに外からの入力は使わない。手順（この順）：(1) `<root>/docs` と `<root>/docs/governance` を `lstat` し、シンボリックリンクかディレクトリでなければ `null` (2) ファイルを `lstat` し、シンボリックリンクか通常ファイルでなければ `null` (3) `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` で開く (4) `fstat` で通常ファイルでなければ `null`、大きさが 1,048,576 バイトを超えれば `null` (5) `readSync` を繰り返して最大 1,048,577 バイトまでだけ読み、1,048,577 バイト読めたら `null` (6) `JSON.parse` → `pickKernelInvariants`。開いたファイルはどの経路でも `finally` で閉じる。どの失敗も `null`（例外の本文は使わない）。前提：`docs/governance/` は法律で保護パス（行政は書けない）なので、ディレクトリの敵対的な同時の差し替えは扱わない（この前提を先頭のコメントに1行書く）
- A4. `GET /api/governance/kernel/invariants` を新設する。`try` の中で `await connection()` の後に 200 `{ invariants: loadKernelInvariants() }`（`null` でありうる）。例外は 500 `{ error: "invariants_unavailable" }`（例外の本文を応答に入れない）。Route Segment Config は書かない
- A5. `src/components/KernelInvariants.tsx`（クライアント部品。外側は `<section aria-label="不変条件と承認待ち">`）は、マウントごとに1回 `fetch("/api/governance/kernel/invariants", { cache: "no-store", signal })` で取り（ポーリングしない。unmount で `abort()`、`signal.aborted` なら state を更新しない）、応答の `invariants` を `pickKernelInvariants` で検証し直す。取得中は `<section aria-label="不変条件と承認待ち" aria-busy="true" />`（中身なし）。取得が終わった後の分岐は3つに固定する：(a) 2xx で `invariants === null` → 「不変条件の書き出しがありません（裁判所が p0.4.4 より前か、この環境では公開していません）」の1行だけ (b) 2xx でない・通信の失敗・応答が JSON でない・`invariants` の項目がない・非 null で検証に落ちる → 「不変条件を読めませんでした」の1行だけ (c) 検証に通った → 次の 1〜4：
  0. 「書き出し：<generated_at を KernelPanel と同じ formatJst で>（取得した時点の写し。最新は読み込み直す）」の1行。`formatJst` は `@/lib/kernel-state-schema` から import してよい（A6 の例外）
  1. 見出し「不変条件（INV-01〜12）」と、要約の1行「強制 <enforced>・一部 <partial>・対象外 <notApplicable>。最後の適合性テストで合格 <passed>・不合格 <failed>」
  2. 表（`invariants` の順のまま）：列は「ID・不変条件・状態・判例・結果」。不変条件の文は部品の中の固定の対応（`Map`）で ID から引く。文はこの12個（この文のまま）：INV-01「行政 AI は自分自身の権限を拡張できない」、INV-02「司法 AI は自らが検証する実装を直接修正しない」、INV-03「AI の委任によって権限が増加しない」、INV-04「重大な違反時は通常の自律実行より停止を優先する」、INV-05「必須の司法検証を行政 AI の自己評価で代替できない」、INV-06「承認は対象・範囲・法律の版に結び付く」、INV-07「自動の再試行には有限の上限がある」、INV-08「モデルの性能向上で利用権限が自動で広がらない」、INV-09「モデルの切り戻しを成果物の復旧と同一視しない」、INV-10「重大な仕様変更は正規の立法・承認の手続きを経る」、INV-11「検証・是正・承認・委任・モデル切替を監査できる」、INV-12「独立した作業は他の承認待ちだけで止まらない」。対応にない ID は「—」。状態は `enforced`＝「強制」、`partial`＝「一部」、`not_applicable`＝「対象外」。判例は「<tests> 件」。結果は `verified` が `true`＝「合格」（emerald）、`false`＝「不合格」（red）、`null`＝「—」。表の下に、`verified_by` があれば「結果は稼働中の Kernel（<kernel_version>、<formatJst(at)>）の適合性テスト」、`null` なら「稼働中の Kernel の今の版の適合性テストの記録がない」の1行
  3. 注意の1行：「「強制」は判例で確かめたものだけ。一部と対象外の理由は docs/kernel.md §4b」
  4. 見出し「承認待ちの票」と、`pending_approvals` の各行に「<task>・<status の日本語：ready＝準備、in_progress＝作業中、review＝申請中、blocked＝止まっている>」。0件なら「承認待ちの票はありません」
- A6. `src/components/GovernanceView.tsx` に `KernelInvariants` の import を1行足し、既存の `<KernelPanel />` の直後に `<KernelInvariants />` を1つ置く。それ以外は変えない。`KernelInvariants` が実行時に import してよい `@/lib` は `kernel-invariants-schema` と、`kernel-state-schema` の `formatJst` だけ。`dangerouslySetInnerHTML`・`console`・`localStorage` を使わない
- A7. `src/lib/kernel-invariants.test.ts` に、次をそれぞれ1件以上の `it(` で試す（`loadKernelInvariants` は一時ディレクトリの `root` で）：①正しい JSON が通る ②未知の項目が1つあると `null`（strict）③`status` が `"done"`、`id` が `"INV-1"`、`pending_approvals[].task` が `"T-draft"`、`invariants[]` に `title` の項目がある、の4つを**それぞれ別に**試し、どれも `null`。strict は外側・`invariants` の要素・`pending_approvals` の要素の3か所でそれぞれ試す ④ファイルがない・シンボリックリンク・`docs/governance` がディレクトリへのシンボリックリンクなら `null` ⑤有効な JSON を末尾の空白で詰めて作った 1,048,576 バイトのファイルは非 `null`、1,048,577 バイトは `null` ⑥`summarizeInvariants` の6つの数（例：強制 8・一部 3・対象外 1、合格 10・不合格 1・— 1）。あわせて `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る（これは裁判所の決定論的な監査の結果で確かめる。司法はコードと試験の中身を判定する）

## 3. 開発用テスト

- A7 の観点。統合の後に、ユーザー役が `/governance` で、法律 p0.4.4 の反映の後に不変条件の表と承認待ちが出ること、反映の前は (a) の1行が出ることを確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. 見た目は `KernelPanel` の表に合わせる（zinc 系、合格は emerald、不合格は red）
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ Codex security。要件は main にコミット済みのこの票の §2。T-022 の部品（`KernelPanel`・`kernel-state*`）は変えない。

## 5b. 点検の記録

Codex の点検（2026-11-06、立法補佐が sandbox の外で実行）：指摘 8 件（重 2・中 5・軽 1）。対応：#1 `tests` の上限を書き出し側（100 万）に合わせ、書き出し側の版の文字列にも 40 文字の上限（法律 p0.4.4）／#2 読み込みの手順を §2 に列挙、6ファイルを A0 に、監査と司法の役割を A7 に／#3 import 1行を A6 に／#4 取得中の状態を A5 に／#5 目的を「承認待ちを1か所で確認」に／#6 表示用で承認の効力を与えないことと保護ディレクトリの前提を §2 に／#7 書き出し日時と「取得した時点の写し」を表示／#8 ③⑤の試し方を具体に、見積もり 2.5 時間

## 6. 記録

- 22:2x 行政の長が W20 を起動（worktree `agent-aed0ebdc821163d18`）。仕様はオーナーが approve-spec で承認済み（立法補佐の伝達と、不変条件の写しの `pending_approvals` が空であることで確かめた）
- A0 の解釈（立法補佐が着手中に出した）：A0 は司法の判定に含まれる（front matter の `requirements` は記録用の一覧で、A0 が抜けているのは書き損じ。指紋が変わるので今は直さない）。A0 と A5 は衝突しない。A0 は表示用であることを画面に書くよう求める、より具体的な条件で、A5 はほかの文を足すことを禁じていない
- A0 の画面の文の置き場所：(c) の表示で、A5 の 4「承認待ちの票」の見出しの直下に固定の1行「この一覧は表示用で、承認の効力を与えない（承認はオーナーの approve-spec.sh）」。部品の先頭のコメントにも同じ趣旨を書いた。(a)(b) は「1行だけ」と固定なので置かない。0件のときも出す（0件の扱いは行政の長の読みで、立法補佐の解釈にはない）
- W20 の報告：HEAD `8cb2c14e9e39e455af17a4865dc478b66a3be021`。test 324 件（26 ファイル）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:717` で差分の外）。**画面と API は動かしていない**（ブラウザーの表示、GET の実呼び出し、`npm run build` は未確認。§3 で統合の後に確かめる）
- 本番の写しは `pickKernelInvariants` に通していない。W20 が Read で読んで A1 の形と目で照合した。統合の後に `/governance` で表が出るかで確かめる。本番の値から数えた要約の見込みは「強制 7・一部 4・対象外 1。合格 11・不合格 0」（22:20 の写しの行ごとの値から。行政の長も同じ値を読んだ。画面では未確認）
- 補った解釈・逸脱：React の `key` に添字を混ぜた（同じ ID が重なっても衝突しない。表示には影響しない）。試験は A7 より多い（`verified_by` の strict、`docs` がリンクの場合、場所がディレクトリの場合など）
- 拒否された操作：W20 の Bash 4件が拒否された。ヒアドキュメント3件は、フックが「worktree の外（/）」と判定した（書き先は worktree の中の相対パス）。`sed -i` の1件は worktree の隔離の検査が「複雑すぎて確かめられない」と止めた。W20 は回避せず Write・Edit でやり直した。W19（T-023）と同じ「worktree の外」の判定で、OBS-056 の文字列照合とは別の規則（立法補佐に渡す）
- 22:26 行政の長が差分を確認（`files_allowed` の6つだけ、追加 628・削除 0、`GovernanceView.tsx` は import 1行と差し込み1行だけ。禁止語と秘密情報の形なし。A0〜A7 と読み合わせ、12個の文と固定の文は §2 と一致。行政の長は試験と画面を自分では動かしていない）。`status: review` で main にコミットし申請

- 2026-11-06T22:29:31+0900 gate-runner: status → review（判定に合格（judge=APPROVED codex=APPROVED）。夜間のため統合せず、朝のオーナーの承認を待つ）

- 2026-11-06T22:32:34+0900 release: status → merged（main=7ab54c3af4bd。夜間の判定に合格した候補 9ec1d4b6fe0f を、オーナーが朝に承認して統合）
