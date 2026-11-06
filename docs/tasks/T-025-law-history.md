---
id: T-025
title: 統治のライブ画面に「法律が判例で育った歴史」の区画を足す（可視化 V3）
status: review
requirements: [A0, A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-64, V3]   # 記録用。司法には渡さない
proposal_from: 2026-11-06 立法補佐が起草（オーナーの承認前）。docs/drafts/vgdd-visualizer.md の V3。データは法律の公開の要約 vgdd/kernel/history.json（vgdd.law-history.v1）
estimate_h: 2
time_limit_min: 150
security_review: true          # 新しい GET の API がファイルを読む
unattended: false
branch: worktree-agent-aceeac6c3dcc8e170
worker: W21
files_allowed:
  - src/lib/law-history-schema.ts        # 新設：形の検証と表示用の集計（純粋関数だけ。node:fs を使わない）
  - src/lib/law-history.ts               # 新設：ファイルの読み込み（node:fs）
  - src/lib/law-history.test.ts          # 新設
  - src/app/api/governance/history/route.ts   # 新設：GET
  - src/components/LawHistory.tsx        # 新設：区画
  - src/components/GovernanceView.tsx    # 区画を1つ差し込むだけ
files_forbidden:
  - src/lib/kernel-state*.ts
  - src/lib/kernel-invariants*.ts
  - src/components/KernelPanel.tsx
  - src/components/KernelInvariants.tsx
  - src/lib/governance.ts
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
depends_on: [T-024]
---

## 1. 目的

作品の主役は VGDD の可視化（D-64）。デモで「統治の仕組み自身の失敗を、穴の発見 → 再現する判例 → オーナーの承認を含む正規の改正 → 再検証、の手続きで直してきた」を伝える。法律の版ごとに、改善した項目・最初に見つけた主体・足した判例・前の版で落ちた件数（判例が空回りしていない証拠）を時系列で見せる。AI が自律的に法律を変えて自分に適用したようには見せない。データは法律の公開の要約 `vgdd/kernel/history.json`（立法補佐が版ごとに書き、オーナーの承認で入る）。審査：デモ25、深さと実行20、Claude の活用25。

## 2. 受け入れ条件

- A0. **前提**：この票は、法律の公開の要約 `vgdd/kernel/history.json`（vgdd.law-history.v1）が main に反映された後に着手する（法律は保護パスで、この票では変えない）。差分のファイルは次の6つだけ：`src/lib/law-history-schema.ts`（新設）、`src/lib/law-history.ts`（新設）、`src/lib/law-history.test.ts`（新設）、`src/app/api/governance/history/route.ts`（新設）、`src/components/LawHistory.tsx`（新設）、`src/components/GovernanceView.tsx`
- A1. `src/lib/law-history-schema.ts`（`node:fs` を import しない）に `pickLawHistory(json: unknown): LawHistory | null` と型 `LawHistory` を export する。zod の **strict** で検証し、合わなければ `null`：`schema: z.literal("vgdd.law-history.v1")`、`note: z.string().max(1000)`、`versions: z.array(Version).min(1).max(100)`。`Version = z.object({ version: z.string().regex(/^p\d+\.\d+\.\d+[a-z]?$/), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), title: z.string().min(1).max(120), fixed: z.array(z.string().min(1).max(200)).max(20), found_by: z.array(z.enum(["executive_head","legislative","codex","judge","owner","operation"])).max(6), precedents: z.array(z.string().regex(/^[A-Z][A-Za-z0-9-]{0,11}$/)).max(50), tests_total: z.number().int().min(0).max(1_000_000).nullable(), prev_failed: z.number().int().min(0).max(1_000_000).nullable(), obs: z.array(z.string().regex(/^OBS-\d{3}$/)).max(20) }).strict()`。あわせて純粋関数 `summarizeLawHistory(h: LawHistory): { versions: number; improvements: number; byFinder: ReadonlyMap<string, number>; latestTests: number | null }` を export する（`improvements` は全版の `fixed` の件数の合計で、独立した脆弱性の数ではない。`byFinder` は `found_by` の主体ごとに、その主体を含む版の数（同じ版の中の重複は `Set` で1回に数える）、`latestTests` は最後の版の `tests_total`）
- A2. `src/lib/law-history.ts` に `loadLawHistory(root = process.cwd()): LawHistory | null` を export する。読むのは `<root>/vgdd/kernel/history.json` の1か所だけ（外からの入力でパスを組み立てない）。手順：(1) `<root>/vgdd` と `<root>/vgdd/kernel` を `lstat` し、シンボリックリンクかディレクトリでなければ `null` (2) ファイルを `lstat` し、シンボリックリンクか通常ファイルでなければ `null` (3) `O_RDONLY | O_NOFOLLOW | O_NONBLOCK` で開く (4) `fstat` で通常ファイルでなければ `null`、262,144 バイトを超えれば `null` (5) `readSync` を繰り返して最大 262,145 バイトまでだけ読み、262,145 バイト読めたら `null` (6) `JSON.parse` → `pickLawHistory`。開いたファイルはどの経路でも `finally` で閉じる。どの失敗も `null`（例外の本文は使わない）。前提：`root` は信頼できるリポジトリで、`vgdd/` は保護パス（行政は書けない）なので、ディレクトリの敵対的な同時の差し替えは扱わない（この前提を先頭のコメントに1行書く）
- A3. `GET /api/governance/history` を新設する。`try` の中で `await connection()` の後に 200 `{ history: loadLawHistory() }`（`null` でありうる）。例外は 500 `{ error: "history_unavailable" }`（例外の本文を応答に入れない）。Route Segment Config は書かない
- A4. `src/components/LawHistory.tsx`（props のないクライアント部品を default export する。外側は `<section aria-label="法律が判例で育った歴史">`）は、マウントごとに1回（開発時の StrictMode による中断と再実行は許す）`fetch("/api/governance/history", { cache: "no-store", signal })` で取り（ポーリングしない。unmount で `abort()`、`signal.aborted` なら state を更新しない）、応答の `history` を `pickLawHistory` で検証し直す。取得中は `aria-busy="true"` の空の section。取得の後の分岐は3つ：(a) 2xx で `history === null` → 「法律の歴史の記録がありません」の1行だけ (b) 2xx でない・通信の失敗・応答が JSON でない・`history` の項目がない・非 null で検証に落ちる → 「法律の歴史を読めませんでした」の1行だけ (c) 検証に通った → 次の 1〜3：
  1. 見出し「法律が判例で育った歴史」と、要約の1行「<versions> 版で <improvements> 件の改善。最新の適合性テストは <latestTests> 件」（`latestTests` が `null` なら「最新の適合性テストは —」）
  2. 版ごとの行を `versions` の順のまま縦に並べる（新しい版が下）。各行に：版（等幅）・日付・`title`・`fixed` の箇条書き・見つけた主体のバッジ（`executive_head`＝「行政の長」、`legislative`＝「立法補佐」、`codex`＝「Codex の監査」、`judge`＝「司法（Claude）」、`owner`＝「オーナー」、`operation`＝「運用の記録」）・足した判例（等幅で並べる。0件なら出さない）・`prev_failed` が `null` でなければ「前の版にかけると <prev_failed> 件が落ちた」（`tests_total` も `null` でなければ「／全 <tests_total> 件」を続ける）・`obs`（0件なら出さない）
  3. 注意の2行：「前の版で落ちた件数は、その版で足した判例が空回りしていない証拠。記録は法律の公開の要約 vgdd/kernel/history.json」「バッジは、その版の問題を最初に見つけた主体。直す・判例を書く・承認するは、立法補佐・作業員・オーナーが正規の改正の手続きで分担した」
- A5. `src/components/GovernanceView.tsx` に `LawHistory` の import を1行足し、既存の `<KernelInvariants />` の直後に `<LawHistory />` を1つ置く。それ以外は変えない。`LawHistory` が実行時に import してよい `@/lib` は `law-history-schema` だけ。この票で新しく書くコードの、文字列をキーにする辞書は `Map`（既存の `GovernanceView` の辞書は変えない）。`dangerouslySetInnerHTML`・`console`・`localStorage` を使わない
- A6. `src/lib/law-history.test.ts` に、次をそれぞれ1件以上の `it(` で試す（`loadLawHistory` は一時ディレクトリの `root` で）：①正しい JSON が通る ②未知の項目が外側・版の要素の2か所それぞれにあると `null` ③`version` が `"0.4.4"`、`found_by` に `"ai"`、`precedents` に `"g15"`、`obs` に `"OBS-1"` の4つをそれぞれ別に試し、どれも `null`。`precedents` の `"INV06a"`・`"INV06d"`・`"INV-META"`・`"G15"` はそれぞれ通る ④ファイルがない・シンボリックリンク・`vgdd/kernel` がディレクトリへのシンボリックリンクなら `null` ⑤有効な JSON を末尾の空白で詰めた 262,144 バイトは非 `null`、262,145 バイトは `null` ⑥`summarizeLawHistory` の4つの値（`byFinder` は `Map` の `get` で確かめる。同じ版の `found_by` に同じ主体が2回あっても1と数える）⑦リポジトリの実物 `vgdd/kernel/history.json` を `loadLawHistory(process.cwd())` で読むと非 `null`（実物との一致は裁判所の決定論的な監査の test で確かめる）。あわせて `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る（裁判所の決定論的な監査の結果で確かめる。司法はコードと試験の中身を判定する）

## 3. 開発用テスト

- A6 の観点。統合の後に、ユーザー役が `/governance` で、9 つの版が並び（要約は「9 版で 22 件の改善。最新の適合性テストは 377 件」）、p0.4.3 の行に「行政の長」「Codex の監査」のバッジと「前の版にかけると 66 件が落ちた／全 348 件」が出ることを確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. 見た目は `KernelPanel` に合わせる（zinc 系）。版の行は左に縦の線を引いた時系列にしてよい
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ Codex security。要件は main にコミット済みのこの票の §2。`vgdd/kernel/history.json` は法律（保護パス）で、この票では変えない。法律の改正（憲法 D-64 と同じブランチ）の反映の後に着手する（A6 ⑦が実物を読むため）。

## 6. 記録

- 00:41 行政の長が W21 を起動（worktree `agent-aceeac6c3dcc8e170`）。仕様はオーナーが 00:27:53 に approve-spec で承認済み（立法補佐の指示の条件を、00:40 に書き出された Kernel の写しの `approvals[].current` と `pending_approvals` が空であることで確かめた）。22:42 の写しは票のコミット（00:25）より前で、根拠にしなかった
- W21 の報告：HEAD `a3fdb73fc929250fb0edb93cfeaa2841a495af2b`。test 352 件（27 ファイル）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:717` で差分の外）。**画面と API は動かしていない**（dev サーバーは sandbox の `listen EPERM` で起動せず、`route.ts` の実行と `LawHistory` の描画は未確認。§3 で統合の後に確かめる）
- 補った解釈・逸脱：`fixed`・`found_by` が空の版は空の `ul` を出す（「0件なら出さない」は判例と `obs` だけのため）。`found_by` の重複はバッジではそのまま出す。`latestTests` が null なら「—」で「件」を付けない。`note` は指定がないので画面に出さない。React の `key` に添字を混ぜた。試験は A6 より多い（`vgdd` がない・リンク・ファイル、`history.json` がディレクトリ、JSON でないなど）。実物の 9 版・22 件・377 件は関数の実行では確かめていない
- 拒否された操作：`git -C <自分の worktree>`、worktree の外の scratchpad への Write 2件、実物の `history.json` を `node -e` で集計（いずれもフック）。検査と `git status` を1つにまとめたコマンド（ハーネス）。W21 は回避せず、素の `git status` に分け、ほかの確かめはやめた
- 00:46 行政の長が差分を確認（`files_allowed` の6つだけ、追加 583・削除 0、`GovernanceView.tsx` は import 1行と差し込み1行だけ。A1〜A5 と読み合わせ、固定の文は §2 と一致。A6 は `it(` の名前で①〜⑦の対応を確かめた。禁止語・秘密情報の形・`dangerouslySetInnerHTML`・`console`・`localStorage` なし。行政の長は試験と画面を自分では動かしていない）。`status: review` で main にコミットし申請
