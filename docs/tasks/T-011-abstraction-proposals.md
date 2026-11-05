---
id: T-011
title: 機密の検出箇所ごとの抽象化の案と、本人が選んだ案だけの置き換え（M6-3 の裏側）
status: in_progress
requirements: [A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M6-3, M6-1, M9-1]   # 記録用。司法には渡さない
proposal_from: 引き継ぎ §8 の 6（G3 の条件 M6）。2026-11-05 オーナー「票の準備へ」
estimate_h: 0.4
time_limit_min: 40
security_review: false         # 純粋関数だけ。ルート・DB・AI に触れない
unattended: true
branch: worktree-agent-adf6a1c2fb01ee932   # 作業員のブランチ（0e69137）。統合キュー（p0.3.1）により main から分岐したまま申請
worker: W4
files_allowed:
  - src/lib/abstraction.ts        # 新設：純粋関数
  - src/lib/abstraction.test.ts   # 新設
files_forbidden:
  - src/lib/sensitive.ts          # 検出の規則は変えない
  - src/lib/registered-terms.json
  - src/components/**
  - src/app/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/requirements.md
  - docs/tasks/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: []
---

## 1. 目的

共有候補（M9）や質問文の下書きに機密の検出（M6-1）が出たとき、検出箇所ごとに**抽象化の案**（例：「ホクト製菓」→「顧客A社」）を示し、元の文と置き換え後の文を並べて見せ、**本人が選んだ案だけ**を置き換える（自動では置き換えない）。画面は別の票。この票は純粋関数だけ。審査：インパクト30（プライバシーを守って共有する）、デモ25（罠の5件目で案が出る場面）。

## 2. 受け入れ条件

- A1. `src/lib/abstraction.ts` に型と純粋関数を export する：
  - `AbstractionProposal = { id: string; type: FlagType; start: number; end: number; original: string; replacement: string }`（`FlagType`・`Flag` は `@/lib/sensitive` の型を import する。`detectSensitive` は呼ばない）
  - `proposeAbstractions(text: string, flags: Flag[]): AbstractionProposal[]`
  - `applyAbstractions(text: string, proposals: AbstractionProposal[], acceptedIds: string[]): string`
  - `previewAbstraction(text: string, proposals: AbstractionProposal[], acceptedIds: string[]): { before: string; after: string }`（`before` は `text` そのまま、`after` は `applyAbstractions` の結果）
- A2. `proposeAbstractions` の置き換え文は種類ごとに次のとおり（全角のかっこ「（）」）：`email` → `（メールアドレス）`、`phone` → `（電話番号）`、`card` → `（カード番号）`、`api_key` → `（API キー）`。`registered_term` で `category` が `customer` → `顧客A社`・`顧客B社`・…、`project` → `プロジェクトA`・`プロジェクトB`・…（`category` がない `registered_term` は `（登録語句）`）。顧客とプロジェクトの文字（A, B, C, …, Z）は、**それぞれの区分の中で、文の中に初めて現れた位置の順**に、異なる語ごとに1つずつ割り当てる（同じ語は同じ置き換え文）。27個目以降は `顧客27社`・`プロジェクト27` のように数字にする
- A3. `proposeAbstractions` の範囲の扱い：`flags` を `start` の昇順（同じ `start` は長い順、`start` も長さも同じなら入力の順）に並べ、すでに採った案と範囲が重なる flag は捨てる（重なり＝`a.start < b.end && b.start < a.end`）。`start`・`end` のどちらかが整数でない（`Number.isInteger` が false。小数・`NaN` を含む）、`text` の範囲の外、`start >= end`、または `text.slice(start, end) !== flag.match` の flag も捨てる。`id` は採った順に `p1`・`p2`・…。A2 の顧客・プロジェクトの文字の割り当ては、**捨てた flag を数えず、採った案だけ**で行う。返り値は `start` の昇順。`text` も `flags` も変更しない（引数を書き換えない）
- A4. `applyAbstractions`：`acceptedIds` に含まれる `id` の案だけを置き換え、含まれない案の箇所と、案のない箇所は1文字も変えない。`acceptedIds` が空なら `text` をそのまま返す。存在しない `id` は無視する。**案は適用の時にも検証し、通らない案は置き換えない**（例外は投げない）：`start`・`end` が整数で `0 <= start < end <= text.length`、かつ `text.slice(start, end) === original`（案を作った後に本文が編集された場合はここで外れる）。`proposals` の中で同じ `id` が2つ以上あれば、その `id` の案はどれも置き換えない。選ばれて検証に通った案を `start` の昇順（同じなら配列の順）に見て、**すでに置き換えると決めた案**と重なる案を捨てる（例：A＝[0,4)、B＝[3,8)、C＝[7,10) なら B だけを捨て、A と C を置き換える）。置き換えは後ろの案から行い、前の置き換えで位置がずれないようにする
- A5. `src/lib/abstraction.test.ts` に、下の①〜⑩を**それぞれ1件以上の `it(`**で試す：①罠の5件目「ホクト製菓の案件で見積りが 350 万円になった」に `detectSensitive` の結果を渡すと、案が1件で `replacement` が `顧客A社`（試験では `detectSensitive` を呼んでよい） ②`ホクト製菓`・`みなみ運輸`・`ホクト製菓` の順に出る文で、`顧客A社`・`顧客B社`・`顧客A社` になる。`さくらポータル刷新` は `プロジェクトA` ③メールと電話の案の置き換え文 ④重なる2つの flag は先の（同じ `start` なら長い）1つだけが残る。`match` と本文が食い違う flag は捨てられる ⑤`acceptedIds` が空なら元の文、1つだけ選ぶとその箇所だけが変わる（他の検出箇所は元のまま） ⑥`previewAbstraction` の `before` と `after` ⑦引数の `flags` の配列と要素が呼び出しの後も変わらない ⑧本文を編集した後の文に古い案を渡すと、`original` と一致しない案は置き換えられない。範囲の外の案、同じ `id` が2つある案も置き換えられない ⑨捨てた flag は採番に数えない（`match` が食い違う顧客の flag の後に別の顧客が出ても、その顧客は `顧客A社`）。`start` か `end` が小数の flag も捨てられる ⑩`applyAbstractions` に A＝[0,4)・B＝[3,8)・C＝[7,10) の3案を選んで渡すと、A と C だけが置き換わる
- A6. `npm run -s test`（既存の試験と追加分のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは `src/lib/abstraction.ts`（新設）と `src/lib/abstraction.test.ts`（新設）の2つだけ

## 3. 開発用テスト

- `abstraction.test.ts`：A5 の観点。試験の文はすべて架空（`src/lib/registered-terms.json` の語と、`example.co.jp` のメール、`03-1234-5678` の電話）

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回（`npm install` は使わない）
2. `abstraction.ts`：`import type { Flag, FlagType } from "@/lib/sensitive"`。顧客・プロジェクトの文字は区分ごとの `Map<string, string>` で決める
3. コミットは1つ。メッセージの先頭は `T-011: `

## 5. 統合審査

決定論的な監査（`npm test`・`typecheck`・`lint`）＋ judge ＋ Codex judge。要件は main にコミット済みのこの票の §2（A1〜A6）。T-010 と触るファイルが重ならない。

## 6. 記録

（統合後に追記）
- 23:04 W4 起動（worktree `agent-adf6a1c2fb01ee932`、main 836733a から。T-013 が申請まで進んで枠が空いたため）。23:0x コミット 0e69137（2ファイル新設、+358）。報告：test 151（既存 135＋16）・typecheck・lint 合格（警告1件は既存の `vgdd/conformance/run.mjs`）。`sensitive` からは型だけ import。試験の文はすべて架空。拒否・逸脱なし
- 23:08 行政の長が差分を確認（`files_allowed` の2ファイルのみ、禁止語なし、A1〜A6。A5 の①〜⑩に `it(` が対応、16件）。`status: review` で main にコミットし申請（gate-runner `--hold`。合格は held、統合は朝に release.sh）

- 2026-11-05T23:14:28+0900 gate-runner: status → in_progress（judge=CHANGES_REQUIRED, codex=CHANGES_REQUIRED（両方が差し戻し））
