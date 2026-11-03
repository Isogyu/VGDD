---
id: T-002
title: 整理結果のコピー（Markdown）
status: ready
requirements: [A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M4-1, M4-2, M10-2]   # 関連する docs/requirements.md の ID（記録用。司法には渡さない）
proposal_from: M4 の提案（2026-11-03、M4 のコミット 57a48a9 の直後にオーナー採用）
estimate_h: 0.3
time_limit_min: 40
branch: null           # Claude Code が worktree に付ける worktree-agent-<id>。起動後に行政の長が記入
worker: null
files_allowed:
  - src/lib/summary-markdown.ts
  - src/lib/summary-markdown.test.ts
  - src/components/CopyButton.tsx
  - src/components/SummaryActions.tsx    # T-000 が作った差し込み口の中身（props は summary・notes・session。変えない）
files_forbidden:
  - src/components/SessionView.tsx       # 差し込み口は T-000 で作成済み。触らない
  - src/lib/summary-schema.ts
  - src/lib/sessions.ts
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/requirements.md
  - docs/tasks/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-000]
---

## 1. 目的

8項目と根拠のメモを Markdown にしてクリップボードにコピーするボタン。日報やチャットに貼って使える（ハッカソン後の利用場面。審査：インパクト30「使い続けられる」）。M10-2（質問文の下書きのコピー）でも同じ部品 `CopyButton` を使う予定。

## 2. 受け入れ条件

- A1. `src/lib/summary-markdown.ts` に純粋関数 `summaryToMarkdown(summary: Summary, notes: Note[], session: WorkSession): string` を追加する。返す Markdown は次を**この順**に含む：①`# <task_name>` の見出し ②`formatMdHm(started_at)` の開始時刻と `formatDuration(duration_min)` の所要を含む1行 ③`SUMMARY_KEYS` の順に8つの `## <SUMMARY_LABELS[key]>` 見出しと本文。`itemStatus()` が `inferred` の項目は見出しの末尾に「（AI の推測）」、`none` の項目は「（記録なし）」を付ける。根拠があれば本文の下に `根拠: #3, #5` の形で**メモの番号（1始まり）**を書く ④`## 根拠のメモ` の見出しと、`summary.source_note_ids` に含まれるメモだけを `- #<番号> <HH:MM> <本文>` の形で番号順に
- A2. Markdown の**最後の行**は「※ これは AI の原案です。利用前に本人・先輩の確認が必要です。」
- A3. `summary.source_note_ids` に含まれないメモ（AI に送っていないメモ）は「根拠のメモ」に出ない。根拠の番号は `notes` の並び順の番号（S-2 の #番号と同じ）
- A4. `src/components/CopyButton.tsx`：props は `{ text: string; label: string }`。押すと `navigator.clipboard.writeText(text)` を呼び、成功したら **2秒間**「コピーしました」と表示して元の `label` に戻る。失敗（`clipboard` がない・例外）したら「コピーできませんでした」と表示する。`"use client"`
- A5. `SummaryActions`（props は `summary`・`notes`・`session`。T-000 の形を変えない）は、`summaryToMarkdown` の結果を `text` にした `<CopyButton label="Markdown でコピー" />` を1つ描く
- A6. `src/lib/summary-markdown.test.ts` に **4件以上**のテスト：①8つの見出しがこの順で含まれる ②`inferred`・`none` の項目に「（AI の推測）」「（記録なし）」が付く ③除外したメモが「根拠のメモ」に出ず、含まれるメモが `#番号` と本文つきで出る ④最後の行が A2 の文。`npm run -s test`（既存 91 件＋追加分）・`npm run -s typecheck`・`npm run -s lint` がすべて通る。差分は `files_allowed` の4ファイルだけ

## 3. 開発用テスト

- `summary-markdown.test.ts`：A6 の4件。`Summary` の見本は `summary-schema.test.ts` の作り方を参考にする（`status` は `evidenced`／`inferred`／`none`。古い形は `itemStatus()` が判定する）
- `CopyButton` の描画と clipboard はテストしない（ユーザー役が統合後に確認）

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回（`npm install` は使わない）
2. `summary-markdown.ts`：`@/lib/summary-schema` の `SUMMARY_KEYS`・`SUMMARY_LABELS`・`itemStatus`、`@/lib/time` の `formatMdHm`・`formatDuration`・`formatHm` を使う。メモの番号は `notes.findIndex(n => n.id === id) + 1`
3. `CopyButton.tsx`：`useState` で表示文、`setTimeout` 2000ms で戻す（unmount 時に `clearTimeout`）。`navigator.clipboard` がなければ失敗扱い
4. `SummaryActions.tsx`：`void props;` を消して、`CopyButton` を描く。T-000 のコメントは残してよい
5. コミットは1つ。メッセージの先頭は `T-002: `

## 5. 統合審査

決定論的な監査（`npm test`・`typecheck`・`lint`）＋ judge ＋ Codex judge。要件は `requirements_source: ticket` により **main にコミット済みのこの票の §2（A1〜A6）**（`--ticket`）。T-001・T-003 と**並行可**。

## 6. 記録

（統合後に行政の長が追記）
- 20:04 立法補佐（Pro）が §2 の受け入れ条件を確認（具体的で検証できる。3票の files_allowed は重ならない）。main に固定（D-49②）
