---
id: T-002
title: 整理結果のコピー（Markdown）
status: ready
requirements: [M4-1, M4-2, M10-2]
proposal_from: M4 の提案（2026-11-03、M4 のコミット 57a48a9 の直後にオーナー採用）
estimate_h: 0.3
branch: task/T-002-summary-copy
worker: null
files_allowed:
  - src/lib/summary-markdown.ts
  - src/lib/summary-markdown.test.ts
  - src/components/CopyButton.tsx
  - src/components/SummaryActions.tsx    # T-000 が作った差し込み口の中身
files_forbidden:
  - src/components/SessionView.tsx       # 差し込み口は T-000 で作成済み。触らない
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/requirements.md
  - src/lib/summary-schema.ts
depends_on: []
---

## 1. 目的

8項目と根拠のメモを Markdown にしてクリップボードにコピーするボタン。日報やチャットに貼って使える（ハッカソン後の利用場面。審査：インパクト30「使い続けられる」）。M10-2（質問文の下書きのコピー）と同じ部品 `CopyButton` を使う。

## 2. 受け入れ条件

- A1. 純粋関数 `summaryToMarkdown(summary, notes, session)` が、見出し（作業名・日時・所要）、8項目（ラベル・本文・状態「AI の推測」「記録なし」）、根拠のメモ（番号・時刻・本文）を Markdown で返す
- A2. S-2 に「Markdown でコピー」ボタンがあり、押すとクリップボードに入り、2秒間「コピーしました」と出る
- A3. 「原案。利用前に本人・先輩の確認が必要」の一文が Markdown の末尾に入る
- A4. AI に送っていないメモ（除外）は根拠に出ない

## 3. 開発用テスト

- `summary-markdown.test.ts`：A1 と A3 と A4。Markdown の見出しの数と、状態のラベルが本文に含まれること

## 4. 手順の案

- `src/lib/summary-markdown.ts` に純粋関数。`CopyButton.tsx` は `navigator.clipboard.writeText` を使い、失敗時は textarea で選択状態にする代替
- `SummaryActions.tsx`（T-000 が null を返す形で用意済み。props は `summary`・`notes`・`session`）の中にボタンを置く。`SessionView.tsx` は触らない

## 5. 統合審査

決定論的な監査＋ judge（`--req M4-1,M4-2`）＋ Codex judge。T-000 の統合後なら、T-001・T-003 と**並行可**（触るファイルが重ならない）。

## 6. 記録

（統合後に行政の長が追記）
