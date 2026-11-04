---
id: T-006
title: 先輩への質問文の下書きとコピー、下書きの機密検査（M10-2・M10-3）
status: review
requirements: [A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M10-2, M10-3, M6-1, M6-4]   # 関連する docs/requirements.md の ID（記録用。司法には渡さない）
proposal_from: M10（要件 §5、P-3。2026-11-04 D-55 の順番「M10 →」）
estimate_h: 0.6
time_limit_min: 50
security_review: true          # M6-1 の検査に触れる票（governance §3.1 の 9 ①）
branch: worktree-agent-a9869c6e93bda1e78   # 作業員の元のブランチ（4ed7ea7）。申請は main 追従のため cherry-pick した鎖のブランチ（§6）
worker: W3
files_allowed:
  - src/lib/question-draft.ts                  # 新設：下書きを組み立てる純粋関数
  - src/lib/question-draft.test.ts             # 新設
  - src/components/QuestionDraft.tsx           # 新設：ボタン・下書きの表示・コピー・警告
  - src/components/SummaryActions.tsx          # T-002 の部品に下書きのボタンを足す（props は変えない）
files_forbidden:
  - src/components/CopyButton.tsx              # そのまま使う（props は { text, label }）
  - src/components/SessionView.tsx
  - src/components/WorkScreen.tsx
  - src/components/UnderstandingPanel.tsx      # T-005 が作る。S-1 への設置は T-007
  - src/lib/sensitive.ts                       # 検出は変えない。呼ぶだけ
  - src/lib/summary-markdown.ts
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

整理結果の「人に確認すべきこと」から、先輩への質問文を1クリックで下書きし、コピーして使えるようにする（M10-2。送信機能は作らない）。構成は **担当作業／いま理解していること／試したこと／未確認のこと／聞きたいこと** の5つ。下書きにも M6-1 の機密検査をかけ、該当があれば警告する（M10-3。自動では置き換えない。M6-3 の抽象化の案は別の票）。まず S-2（M4 の整理結果の直後、T-002 の `SummaryActions`）に置く。S-1（M10-1 の結果）への設置は T-007。審査：インパクト30（新人が聞きやすくなる）、デモ25。

## 2. 受け入れ条件

- A1. `src/lib/question-draft.ts` に純粋関数 `buildQuestionDraft(input: { taskName: string; summary: Summary; notes: Note[] }): string` と `QUESTION_DRAFT_SECTIONS = ["担当作業", "いま理解していること", "試したこと", "未確認のこと", "聞きたいこと"] as const` を export する。返す文は次を**この順**に含む：
  - 1行目「お疲れさまです。「<taskName>」について確認したいことがあります。」
  - `【担当作業】` の見出しと `taskName` の行
  - `【いま理解していること】`：`struggle`・`cause`・`resolution`・`learning`・`decision_reason` のうち `itemStatus()` が `evidenced` の項目を `SUMMARY_KEYS` の順に「- <label>：<text>」。1つもなければ「- （まだ確認できたことがありません）」
  - `【試したこと】`：`tried` が `none` でなければ「- <text>」、`none` なら「- （まだありません）」
  - `【未確認のこと】`：①`itemStatus()` が `inferred` の項目（`ask_human` を除く）を「- <label>：<text>（AI の推測）」 ②`unresolved` が `none` でなければ「- <text>」 ③`notes` のうち `kind === "unknown"` の本文を「- <body>」。1つもなければ「- （なし）」
  - `【聞きたいこと】`：`ask_human` が `none` でなければ「- <text>」、`none` なら「- （整理結果に「人に確認すべきこと」がありません。自分の言葉で書いてください）」
  - 最後の行「お手すきのときにお願いします。」
- A2. `src/components/QuestionDraft.tsx`（`"use client"`、default export、props `{ summary: Summary; notes: Note[]; session: WorkSession }`）：ボタン**「先輩への質問文を下書き」**を押すと、`buildQuestionDraft` の結果を `readOnly` の `textarea`（`aria-label="質問文の下書き"`）で表示し、その下に `<CopyButton text={draft} label="質問文をコピー" />`（T-002 の部品。変えない）と「送信はしません。コピーしてチャットなどに貼ってください」の注意を出す。もう一度押すと閉じる（ボタンの文は「下書きを閉じる」）
- A3. **M10-3**：下書きを表示するとき `detectSensitive(draft)` を呼び、1件以上なら `role="alert"` で「注意：<describeFlags(flags)>。送る前に伏せてください。パターンで取りこぼす情報もあります」を黄色の枠（S-1 の警告と同じ `border-amber-300 bg-amber-50`）で出す。該当がなければ出さない。本文は**自動で置き換えない**（コピーはできる）
- A4. `SummaryActions`（props `summary`・`notes`・`session` は T-000 の形のまま）は、既存の `<CopyButton label="Markdown でコピー" />` と並べて `<QuestionDraft summary={summary} notes={notes} session={session} />` を描く（横並び、`flex flex-wrap gap-2`。下書きの枠はその下に広がってよい）
- A5. `src/lib/question-draft.test.ts` に **4件以上**：①5つの見出しが `QUESTION_DRAFT_SECTIONS` の順で含まれ、1行目と最後の行が A1 の文 ②`evidenced` の項目が「いま理解していること」に、`inferred` の項目が「未確認のこと」に「（AI の推測）」付きで、`kind: "unknown"` のメモが「未確認のこと」に入る ③`ask_human` が `none` のとき A1 の代わりの文が入る ④登録語句（`src/lib/registered-terms.json` の顧客名）を含む `ask_human` から下書きを作ると `detectSensitive(draft)` が `registered_term` を返す（M10-3 の根拠）
- A6. `npm run -s test`（既存 114 件＋追加分）・`npm run -s typecheck`・`npm run -s lint` がすべて通る。差分は `files_allowed` の4ファイルだけ。依存の追加はしない

## 3. 開発用テスト

- `question-draft.test.ts`：A5 の4件。`Summary` の見本は `summary-markdown.test.ts`・`summary-schema.test.ts` の作り方を参考にする。登録語句は `REGISTERED_TERMS.customers[0]` を使う（架空の社名）
- 部品の描画とクリップボードはテストしない。ユーザー役が統合後に S-2 で「下書き → コピー → 警告」を確かめる（W1 の整理結果と、顧客名を含むメモの作業）

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回
2. `question-draft.ts`：`@/lib/summary-schema` の `SUMMARY_KEYS`・`SUMMARY_LABELS`・`itemStatus`、型 `Summary`・`Note`。見出しは `【…】`。行は `\n` 区切り
3. `QuestionDraft.tsx`：`useState<boolean>` で開閉。`draft` は `useMemo` か描画中の計算。`detectSensitive`・`describeFlags` は `@/lib/sensitive`（client から import してよい。`registered-terms.json` を含むだけ）
4. `SummaryActions.tsx`：`<div className="flex flex-wrap gap-2">` に `CopyButton` と `QuestionDraft` を並べる
5. コミットは1つ。メッセージの先頭は `T-006: `

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge ＋ **Codex security**（`security_review: true`。観点：下書きに本文以外の情報が混ざらないか、検出結果を取り消していないか）。要件は `requirements_source: ticket` により **main にコミット済みのこの票の §2（A1〜A6）**（`--ticket`）。T-004・T-005 と**並行可**。

## 6. 記録

（統合後に行政の長が追記）
- 21:52 立法補佐（Pro）が §2 の受け入れ条件を確認（関数名・応答の形・判定の順・テスト件数まで具体的で検証できる。T-004〜T-006 の files_allowed は重ならない。T-007 は T-004〜T-006 の後）。main に固定（D-49②）
- 21:54 W3 起動（worktree `agent-a9869c6e93bda1e78`、main 9a9481d から）。21:5x コミット 4ed7ea7（4ファイル、+264/−1）。報告：test 118（既存 114＋4）・typecheck・lint 合格。気づき：`unresolved` が inferred のとき「未確認のこと」に2行出る（A1 の文どおり。重複の扱いは次の改善候補）。本文の改行はそのまま。追加：ボタンに `aria-expanded`、textarea の行数は下書きに合わせる（最大 24）。拒否1件：自分の worktree への `git -C` がフックで止まった（回避せず）
- 21:59 行政の長が差分を確認（`files_allowed` の4ファイルのみ、禁止語なし、A1〜A6 を確認）。`status: review` で main にコミット。鎖の3段目
