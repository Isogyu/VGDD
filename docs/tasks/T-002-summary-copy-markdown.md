---
id: T-002
title: 整理結果のコピー（Markdown）
status: merged
requirements: [A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M4-1, M4-2, M10-2]   # 関連する docs/requirements.md の ID（記録用。司法には渡さない）
proposal_from: M4 の提案（2026-11-03、M4 のコミット 57a48a9 の直後にオーナー採用）
estimate_h: 0.3
time_limit_min: 40
branch: worktree-agent-a4f1080afc74ed347   # 作業員の元のブランチ（0376a0f）。申請は main 追従のため cherry-pick した新ブランチ（§6）
worker: W2
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
- 20:07 W2 起動（worktree `agent-a4f1080afc74ed347`、main 99f549a から）。20:10 コミット 0376a0f（4ファイル、+225/−3）。報告：test 96（既存 91＋5）・typecheck・lint 合格。票にない決め事：開始と所要の行は `開始: M/D HH:MM ／ 所要: …`、根拠の番号は小さい順で重複なし、根拠のない項目は「根拠:」の行を出さない、メモ本文の改行は空白に、注意書きは `MARKDOWN_DISCLAIMER` として export。コミットの Co-Authored-By は作業員が自分のモデル名（Opus 5.5）にした。拒否なし
- 20:13 行政の長が差分を確認（`files_allowed` の4ファイルのみ、禁止語なし、A1〜A6 を確認）。`status: review` で main にコミット。票のコミットで main が進むため、新しい worktree で 0376a0f を cherry-pick したブランチで申請する（README の標準手順）

- 2026-11-03T20:28:03+0900 gate-runner: status → in_progress（files_allowed の外を変更している: src/app/api/sessions/[id]/previous/route.ts src/components/PreviousSummary.tsx src/lib/sessions.test.ts src/lib/sessions.ts）
- 20:30 立法補佐：上の差し戻しは法律の不具合（OBS-017、p0.2.2 で修正）によるもの。差し戻しの回数には数えない
- 20:33 行政の長：p0.2.2 施行（66e3a5b）後の再申請。`status: review` に戻して main にコミット（§2 は変えない）。main 6d618b5 の上の鎖の2段目（`req2-T-002`。元のパッチ 0376a0f と同一）。T-001 の統合後に処理される前提

- 2026-11-03T20:56:43+0900 gate-runner: status → in_progress（files_allowed の外を変更している: src/app/api/sessions/[id]/previous/route.ts src/components/PreviousSummary.tsx src/lib/sessions.test.ts src/lib/sessions.ts）
- 20:58 立法補佐：上の差し戻しは鎖の前段（T-001）が統合されなかったための連鎖。中身の判定ではないため回数に数えない
- 21:02 行政の長：T-001 の修正後の HEAD の上に、同じパッチ（0376a0f と同一）を積み直して再申請（鎖の2段目 `req3-T-002`）。`status: review` に戻す（§2 は変えない）

- 2026-11-03T21:07:40+0900 gate-runner: status → in_progress（ブランチが main を含んでいない（rebase が必要））
- 21:12 立法補佐：上の差し戻しは gate-runner の記録のコミットで main が進んだため（OBS-019、p0.2.3 で修正）。回数に数えない
- 21:14 行政の長：p0.2.3 施行（48c6200）後の再申請。T-001 は統合済み（d4b3f39）。main 48c6200 の上に同じパッチ（0376a0f と同一）を新しい worktree で積み直す（鎖の1段目 `req4-T-002`）。`status: review` に戻す（§2 は変えない）

- 2026-11-03T21:26:26+0900 gate-runner: status → blocked（差し戻しが 3 回に達した。オーナーの判断へ）
- 21:29 オーナーが差し戻し3回を取り消し（理由：法律の不具合 OBS-017・019 と鎖の連鎖。記録は Z3 の annulments.jsonl）。p0.2.4 施行後の再申請のため status: review に戻す（§2 は変えない）

- 2026-11-03T21:35:46+0900 gate-runner: status → merged（main=dac469070944 judge=APPROVED codex=APPROVED）
