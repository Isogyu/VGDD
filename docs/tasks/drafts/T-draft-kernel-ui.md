---
id: T-draft-kernel-ui
title: 統治のライブ画面に「Kernel」の区画を足す（法律の版・稼働／停止・成立条件①〜⑤の強制と試験・承認済みの仕様・held・裁定・判定と不一致・ハッシュチェーン）
status: draft
requirements: [A1, A2, A3, A4, A5, A6, A7, A8]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-55①, D-59③, ADR-017, ADR-028]   # 記録用。司法には渡さない
proposal_from: 2026-11-06 02:2x 行政の長の下書き（28_night_plan_max.md §1 B）。前提は改正案 p0.4.3 §1（裁判所が docs/governance/kernel-state.json を書き出す）。立法補佐が仕上げ、オーナーの approve-spec の後に着手
estimate_h: 1.2
time_limit_min: 75
security_review: false         # 読むのは docs/ の下の JSON だけ。API・DB・外部に触れない
unattended:
branch: null
worker: null
files_allowed:
  - src/lib/kernel-state.ts                # 新設：kernel-state.json の読み込みと検証（純粋関数＋読み込み）
  - src/lib/kernel-state.test.ts           # 新設
  - src/app/api/governance/kernel/route.ts # 新設：GET
  - src/components/KernelPanel.tsx         # 新設：Kernel の区画
  - src/components/GovernanceView.tsx      # 区画を1つ差し込むだけ
files_forbidden:
  - src/lib/governance.ts
  - src/app/api/governance/route.ts
  - src/app/governance/page.tsx
  - src/lib/db/**
  - src/lib/sessions.ts
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [kernel-p0.4.3]   # 改正案 p0.4.3 §1 の書き出しが法律として反映されてから（ファイルがないときの表示は先に作れる）
---

## 1. 目的

デモの3分の中で「AI が憲法と法律のもとで動いた証拠」を**5秒で**伝える。統治のライブ画面（`/governance`、T-013）の先頭に「Kernel」の区画を足し、裁判所が書き出す `docs/governance/kernel-state.json`（改正案 p0.4.3 §1。表示用の写し、判断の根拠にしない）を読んで、法律の版・**稼働／停止中**の大きな表示・成立条件①〜⑤ごとの「どう強制しているか」と適合性テストの件数・承認済みの仕様・held・裁定・判定と不一致・ハッシュチェーンの検証結果を出す。生のログは出さない。審査：深さと実行20（統制の実在）、デモ25。

### 置き方の案（2つ。推奨は①）

| 案 | 内容 | 利点 | 難点 |
|---|---|---|---|
| **①（推奨）** | 今の `/governance` の先頭（見出しの直下、「統治の数字」の上）に `<section aria-label="Kernel">` を1つ足す | デモで画面の切り替えが要らない（5秒で伝える）。既存の API と部品を変えずに、新しい API と部品を足すだけ | 1画面が長くなる（Kernel の区画は折りたたまず、票の盤より上に置く） |
| ② | `/governance/kernel` を新設し、`/governance` の見出しにリンク | 画面ごとの責務が分かれる。Kernel の区画を大きく作れる | デモで1クリック増える。導線を2か所に足す |

### `_board.json` の既知の課題への対処（1行）

release.sh は統合の後に `_board.json` を作り直さない（次の gate-runner の統合まで古い数字）。直し方の案：release.sh の最後で `update_board` と同じ関数を呼ぶ（法律の変更。p0.4.3 の別項目として立法補佐へ）。UI 側はこの票では変えず、`_board.json` の `generated_at` を「最後に集計した日時」として出し続ける。

## 2. 受け入れ条件

- A1. `src/lib/kernel-state.ts` に `pickKernelState(json: unknown): KernelState | null` を export する。zod の **strict** で `vgdd.kernel-state.v1` を検証し、合わなければ `null`。項目は次のとおり（改正案 p0.4.3 §1 の表に合わせる。ここに**ない項目があれば strict で落ちる**）：`schema: "vgdd.kernel-state.v1"`、`generated_at: string`、`kernel_version: string`、`policy_version: string`、`stopped: { active: boolean; since: string | null }`、`judiciary: { status: "ok" | "unavailable" | "down"; kind: "preflight_failed" | "judiciary_unavailable" | null; since: string | null }`、`approvals: { task: string; current: boolean; approved_at: string }[]`、`held: { task: string; since: string }[]`、`rulings: { count: number; tasks: string[] }`、`annulments: { count: number }`、`verdicts: { count: number; by_task: Record<string, { judge: "APPROVED" | "CHANGES_REQUIRED" | null; codex: "APPROVED" | "CHANGES_REQUIRED" | null; security: "APPROVED" | "CHANGES_REQUIRED" | null; at: string }> }`、`disagreements: { count: number; tasks: string[] }`、`evidence: { records: number; chain_ok: boolean; checkpoint_at: string | null; last_record_at: string | null }`、`conformance: { passed: number; total: number; impl: string; at: string } | null`。`by_task` の鍵は `^T-\d{3}$` に合うものだけ残し、合わない鍵は捨てる（`Object.prototype` の鍵を拾わないよう、結果は `Map<string, …>` か `Object.create(null)` で持つ）
- A2. `src/lib/kernel-state.ts` に `loadKernelState(root = process.cwd()): KernelState | null` を export する。読むのは `<root>/docs/governance/kernel-state.json` の1か所だけ。`src/lib/governance.ts` と同じく、`lstat` で確かめてシンボリックリンクなら「ない」として扱い、`O_NOFOLLOW` で開き、**1MB を超えるファイルは読まない**（`null`）。パスの組み立てに外からの入力は使わない。読めない・JSON でない・検証に落ちる、のどれも `null`
- A3. `GET /api/governance/kernel` を新設する。引数を取らず、`await connection()` の後に 200 `{ state: loadKernelState() }`（`state` は `null` でありうる）。例外は 500 `{ error: "kernel_unavailable" }`（例外の本文を応答に入れない）
- A4. `src/components/KernelPanel.tsx`（クライアント部品）は、開いたときに `fetch("/api/governance/kernel", { cache: "no-store" })` で取り、次を表示する。`state` が `null`（ファイルがない・読めない・形が違う）なら、区画の中に「Kernel の状態の書き出しがありません（裁判所が稼働していないか、この環境では公開していません）」の1行だけを出し、下の 1〜7 は出さない：
  1. **稼働／停止中**：`stopped.active` が false なら「稼働中」（emerald）、true なら「停止中（<since> から）」（red）。区画の中で最も大きい文字（`text-2xl` 以上）。`judiciary.status` が `ok` でなければ、その横に「司法の道具が使えません（<kind>）」（amber）
  2. 法律の版：「Kernel <kernel_version>・フック <policy_version>」
  3. **成立条件①〜⑤の表**（`docs/kernel.md` §3 の表を生きた数字で）。行は固定の5行で、列は「成立条件・どう強制しているか（固定の文）・いまの数字」。いまの数字は次のとおり：①役割分離＝`conformance` があれば「適合性テスト <passed>/<total>（<impl>、<at>）」、なければ「未記録」②仕様の統治＝「承認済み <approvals のうち current が true の数> 票」③独立司法＝「判定 <verdicts.count> 件、不一致 <disagreements.count> 件」④Kernel による強制＝「held <held.length> 件、裁定 <rulings.count> 件、取り消し <annulments.count> 件」⑤証跡＝「記録 <evidence.records> 件、ハッシュチェーン <chain_ok ? 改ざんなし : 不整合>、最後のチェックポイント <checkpoint_at か —>」
  4. 承認済みの仕様の一覧：`approvals` を `approved_at` の新しい順に、票・承認日時（`MM/DD HH:MM`）・`current` が false なら「仕様が変わった（承認し直しが要る）」のバッジ
  5. held・裁定・取り消し：`held` の票と `since`、`rulings.tasks`、`annulments.count`
  6. 判定の一覧：`verdicts.by_task` を票の昇順に、judge・Codex・security の結論を3列（`null` は「—」）、`disagreements.tasks` に入る票は行を amber に
  7. 注意の1行（常に表示）：「生のログは公開していない。ここにあるのは裁判所が書き出した件数と結論だけ」
  失敗（応答が 2xx でない・通信の失敗・`state` の形が違う）は「Kernel の状態を読めませんでした」の1行
- A5. `src/components/GovernanceView.tsx` の見出し（`<header>`）の直後、「統治の数字」の `<section>` の前に `<KernelPanel />` を1つ差し込む。それ以外（既存の区画・文・API の呼び出し）は変えない。`KernelPanel` は自分で fetch するので、`GovernanceView` の `data` には触れない
- A6. `KernelPanel` は `@/lib/kernel-state` を**型だけ** `import type` で使い、実行時の import はしない（`node:fs` を使うモジュールのため）。文字列をキーにする辞書は `Map` で持つ。`dangerouslySetInnerHTML`・`console`・`localStorage` を使わない。表示する文字列（票の ID・版・時刻）は React の文字列としてだけ描画する
- A7. `src/lib/kernel-state.test.ts` に、下の①〜⑦を**それぞれ1件以上の `it(`**で試す（`loadKernelState` は一時ディレクトリの `root` で）：①正しい JSON が通り、各項目が入る ②未知の項目が1つあると `null`（strict）③`by_task` に `constructor`・`__proto__`・`T-1`（3桁でない）の鍵があると捨てられ、`T-015` は残る ④ファイルがないと `null`、シンボリックリンクなら `null` ⑤1MB 超は `null` ⑥JSON でないと `null` ⑦`stopped.active: true` と `judiciary.status: "down"` の値がそのまま入る（表示の分岐の前提）
- A8. `npm run -s test`（既存の試験のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは次の5つだけ：`src/lib/kernel-state.ts`（新設）、`src/lib/kernel-state.test.ts`（新設）、`src/app/api/governance/kernel/route.ts`（新設）、`src/components/KernelPanel.tsx`（新設）、`src/components/GovernanceView.tsx`

## 3. 開発用テスト

- `kernel-state.test.ts`：A7 の観点。画面はユーザー役が統合の後に確かめる（ファイルがないときの1行、裁判所が書き出した後の表示、`kernel-stop.sh` の後に「停止中」が出ること＝K2 の本番の確認を兼ねる）
- デモの5秒：`/governance` を開いた直後に「稼働中」と「適合性テスト N/N」が見える

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. 読み込みと検証は `src/lib/governance.ts` の `pickSummary`・`readJson`（lstat・O_NOFOLLOW・1MB）の形に合わせる。`governance.ts` は変えない（同じ補助関数が要れば `kernel-state.ts` に写す）
3. 見た目は `GovernanceView` の `Tile` に合わせる（zinc 系、稼働は emerald、停止は red、司法の注意は amber）
4. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。要件は main にコミット済みのこの票の §2。`kernel-state.json` の**書き出し**（裁判所側。改正案 p0.4.3 §1）はこの票の範囲外で、法律の反映の後に本番で確かめる。それまでは A4 の「ありません」の1行が出る。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（Codex は sandbox の中から呼べない。4:00 から立法補佐が行う）。（点検の後に追記）

## 8. オーナーに聞くこと

1. 置き方は①（`/governance` の先頭に区画）でよいか
2. `kernel-state.json` の形は改正案 p0.4.3 §1 の表に依る。立法補佐の起草で項目が変われば A1 を合わせる
3. `_board.json` を release の後に作り直す直し（法律の変更）を p0.4.3 に含めるか
