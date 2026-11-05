---
id: T-019
title: S-3 に「AI でも確かめる」を置き、AI の候補を決定論的な検出と分けて見せる（M6-2 の画面）
status: review
requirements: [A1, A1b, A2, A3, A4, A5]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M6-2, M6-4, M9-1]   # 記録用。司法には渡さない
proposal_from: 開発スケジュール 段階1。T-017（M6-2 の裏側）の画面。2026-11-06 立法補佐が起草（オーナーの承認前）
estimate_h: 0.5
time_limit_min: 45
security_review: false         # API・DB に触れない。画面だけ
unattended: false
branch: worktree-agent-a55eb031f995ad30b   # 作業員のブランチ（main 86972b2 付近から）。統合キュー（p0.3.1）により main から分岐したまま申請
worker: W16
files_allowed:
  - src/components/ShareReview.tsx
files_forbidden:
  - src/lib/**
  - src/app/**
  - src/components/ShareRecords.tsx
  - src/components/SummaryActions.tsx
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-014, T-017]
---

## 1. 目的

S-3（T-014 の `ShareReview`）で、本人が押したときだけ、共有候補の本文を Claude にも確かめさせ（T-017 の API）、**決定論的な検出とは別に**「AI の候補」を見せる。AI は検出を足すだけで、決定論的な検出は消えない。自動では置き換えない。審査：Claude の活用25、インパクト30（プライバシー）。

## 2. 受け入れ条件

- A1. `src/components/ShareReview.tsx` の、候補が `pending` で `stale` でないときの表示に、ボタン「AI でも確かめる」を1つ足す。押すと `POST /api/shares/<candidate.id>/ai-check` を `{ userId }`（T-014 と同じ読み方の `userId`）で呼ぶ。送信中は「確かめています…」と表示して押せない。自動では呼ばない（画面を開いただけでは呼ばない）。ボタンのすぐ近くに、**押す前から**次の2行を表示する：「API キーのある環境では、本文を Claude（Anthropic の API）に送って確かめます」「確かめるのは、この候補を作った時点の本文です（上の欄で編集した内容は反映されません）」
- A1b. 結果の有効範囲：押すたびに、前回の AI の結果とエラーを消してから送る。応答は、送ったときの `candidate.id` と `userId` に結び付け、応答が届いたときに表示中の候補の `id` が同じで、その候補が `pending` かつ `stale` でないときだけ表示する（候補が変わった・決定した・古くなった後に届いた応答は捨てる）。候補を承認・却下した後は、AI の結果を消す
- A2. 成功（200）の表示：見出し「AI の候補」の下に、応答の `ai` の各候補を「`match`」・種類の日本語（`ai_customer`＝顧客名・会社名、`ai_amount`＝金額、`ai_plan`＝未公開の計画、`ai_other`＝その他）・`reason` の1行ずつで並べる。0件なら「AI が足した候補はありません」。その下に応答の `notice` を常に表示し、さらに「AI が確かめたのは、編集する前の本文です」を1行。応答の `model` を小さく表示する（`demo(…)` ならデモと分かる）。既存の決定論的な検出の表示と抽象化の案（T-014 の A3 の 4）は、**この結果で消したり変えたりしない**
- A3. 失敗の表示（どれも成功の表示を出さず、送信中の状態を解く）：503 `provider_unavailable` と 422 の `schema_violation`・`empty_text`・`too_long` は応答の `message` をそのまま、403 `not_your_share` は「本人の候補だけを確かめられます」、409 `already_decided` は「この候補はすでに決定済みです」、404 `share_not_found` は「候補が見つかりません」、ほかの応答と通信の失敗は「AI で確かめられませんでした」
- A4. 候補の本文・AI の候補・理由は React の文字列としてだけ描画し（`dangerouslySetInnerHTML` を使わない）、`console`・`localStorage`（`tsubuyaki.userId` の読み取りを除く）・ほかの保存先に書かない。`@/lib/ai-sensitive` は型だけを `import type` で使い、実行時の import はしない
- A5. `npm run -s test`（既存の試験のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは `src/components/ShareReview.tsx` の1つだけ

## 3. 開発用テスト

- 画面の部品の単体試験は書かない（既存の画面と同じ）。統合の後に、ユーザー役が W1 の共有候補で「AI でも確かめる」を押し、デモモードの表示（fixture がなければ A3 の文）を確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回（`npm install` は使わない）
2. 見た目は T-014 の画面に合わせる（AI の候補は、決定論的な検出と色で区別する。例：決定論的な検出は amber、AI の候補は sky）
3. コミットは1つ。メッセージの先頭は `T-019: `

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。要件は main にコミット済みのこの票の §2（A1〜A5）。T-014 と T-017 の統合の後に着手する。T-020・T-021 と触るファイルが重ならない。

## 6. 記録

（統合後に追記）
- 01:26 行政の長が W16 を起動（worktree `agent-a55eb031f995ad30b`）。仕様はオーナーが 01:11 に approve-spec で承認済み（立法補佐の伝達）。依存の T-014（01:25、65d7173）・T-017（01:04）は release で統合済みで、`ShareReview.tsx` と `ai-check` のルートが main にあることを確認
- 01:29 W16 の報告：コミット a921350（1ファイル、+166。所要約3分）。A1・A1b・A2〜A5 達成。「AI でも確かめる」は決定の欄の上の新しい欄（sky の枠）、応答は送ったときの `candidateId`・`userId` と `candidateRef` を照らして pending かつ stale でないときだけ表示、承認・却下の成功後と 409 `stale_candidate` で結果を消す。種類の日本語と失敗の対応表は Map。純粋関数 `aiCheckFailureMessage`・`parseAiCheckSuccess` を export 追加、既存の export は不変。test 245・typecheck・lint 合格。票の解釈：承認・却下の送信中もボタンを押せなくする。拒否1件：`cd <worktree>; cat …` がフックで「.claude に対して読み取り専用と判定できない」として拒否（回避せず Read ツールと絶対パスで続行）。画面は未確認
- 01:30 行政の長が差分を確認（`files_allowed` の1ファイルのみ。`@/lib/ai-sensitive` は `import type { AiFlag }` だけ、`dangerouslySetInnerHTML`・`console` なし、A1 の2行と A2・A3 の文が票どおり、`stale` の早期 return には変更なし）。`status: review` で main にコミットし申請

- 2026-11-06T01:33:49+0900 gate-runner: status → blocked（judge と Codex の判定が重大な指摘で分かれた（judge=CHANGES_REQUIRED/1 件, codex=APPROVED/0 件）。オーナーの裁定へ）
- 01:39 オーナーの裁定（立法補佐の伝達）：merge。judge の指摘は、AI の区画を出す条件（T-014 の `stale` の早期 return）が差分の外にあって見えなかったための誤検知。Codex は APPROVED。行政の長が `status: review` に戻して同じ a921350 を再申請（コードの変更なし）

- 2026-11-06T01:41:55+0900 gate-runner: judge と Codex が分かれたが、オーナーの裁定（統合）により進める：AI の区画は描画の最後の return の中にあり、その前の早い戻り（status が pending でない・stale）で決定済み・古い候補は別の画面を返す（T-014 で統合済みの行のため差分に入らず、judge から見えなかった）。結果の反映も pending かつ stale でないときだけ。Codex の judge は APPROVED
