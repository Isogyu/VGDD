---
id: T-008
title: 「記録なし」の判定の正規化と、質問文の下書きの重複の修正（M4-2・M10 の表示の不具合）
status: blocked
requirements: [A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M4-1, M4-2, M10-1, M10-2]   # 関連する docs/requirements.md の ID（記録用。司法には渡さない）
proposal_from: ユーザー役の確認（M10、2026-11-04 22:4x）。オーナーが直し方の例を指示
estimate_h: 0.5
time_limit_min: 45
branch: worktree-agent-aaaf0412f590ae07e   # 作業員の元のブランチ（c40be22）。申請は main 追従のため cherry-pick したブランチ（§6）
worker: W2
files_allowed:
  - src/lib/ai/prompt.ts                 # 整理の指示に「記録がなければ text は「なし」だけ」を明記
  - src/lib/summary-schema.ts            # isNoneText を広げる（M4 の S-2・M10 の両方に効く場所）
  - src/lib/summary-schema.test.ts
  - src/lib/question-draft.ts            # none を出さない・重複を除く
  - src/lib/question-draft.test.ts
files_forbidden:
  - src/components/UnderstandingPanel.tsx  # T-007 が触る。重ねない
  - src/components/**
  - src/lib/understanding.ts             # itemStatus を使っているので、この票の正規化が自動で効く。触らない
  - src/lib/summarize.ts
  - src/lib/summary-markdown.ts
  - src/lib/demo-fixtures/**             # fixture の取り直しはオーナーが統合後に行う（demo:capture）
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
depends_on: [T-004, T-006]
---

## 1. 目的

ユーザー役の確認で見つかった2つの不具合を直す。①Claude が、メモに記録のない項目に「なし。メモには書かれていない」のような本文を返すため、根拠なしの判定で `inferred`（AI の推測）になり、S-2 では紫のバッジ、S-1 の途中整理では「AI の推測」の区分、質問文の下書きでは【未確認のこと】に出てしまう（本来は `none`＝「記録なし」）。②下書きの【未確認のこと】で「未解決」が2回出る（`inferred` の一覧と、`unresolved` の個別の行）。直す場所は、整理の指示（AI 側）と `itemStatus`／`validateAndMap`（サーバー側。M4 の S-2・M10-1 の4区分・M10-2 の下書きに同じ関数で効く）と下書きの純粋関数。審査：インパクト30（事実と推測の区別が本作の差別化点）。

## 2. 受け入れ条件

- A1. `src/lib/ai/prompt.ts` の `SYSTEM_PROMPT` に、次の意味の規則を1項目足す：「**メモに記録がない項目は、text を「なし」だけにする**（「なし。〜書かれていない」のように理由を続けない）。evidence は空配列。内容を述べるのは、メモから推測できることがあるときだけ」。既存の項目は変えない（`questions` の規則・評価する言葉の禁止など）
- A2. `src/lib/summary-schema.ts` の `isNoneText(text)` を広げ、次を **true** にする（`text` は trim 後）：①従来どおり全体が「なし」「該当なし」「特になし」「記録なし」「不明」「記録がない」「メモに書かれていない」等 ②「なし」「該当なし」「特になし」「記録なし」「不明」で**始まり**、その直後が句読点（`。．、，：:`）か文末 ③全体が **60 文字以内**で、「書かれていない」「記録がない」「記録はない」「メモにない」「言及がない」「触れられていない」「確認できない」のいずれかで**文が終わる**（該当語の後ろに続くのは句読点・空白だけ）。次は **false** のまま：「設定漏れが原因ではなく、ポートの競合だった」のように内容を述べる文（「ではない」は該当語に入れない）、該当語の後ろに内容が続く文（例：A5 ③の2「〜書かれていないが、〜可能性がある」）、③の条件で **61 文字以上**の文。**②（「なし」等で始まる文）は長さを問わず true**（AI が返す「なし。〜はメモに書かれていない。」を記録なしとして扱うため）。【明確化：2026-11-04 オーナーの解釈。A2 の「含む」と A5 ③の2 が矛盾していたため、立法補佐が実装の考え方に合わせて改めた。OBS-029】
- A3. `validateAndMap()` と `itemStatus()` は従来どおり「根拠（evidence）が1件以上なら `evidenced`、なければ `isNoneText` で `none`／`inferred`」のまま（A2 の広がりがそのまま効く）。**保存する `text` は変えない**（「なし。メモには書かれていない」のままで `status: none`）。`SummaryItem` の形・`Summary` の形・`RawSummarySchema` は変えない
- A4. `src/lib/question-draft.ts` の【未確認のこと】：①`itemStatus()` が `none` の項目は出さない（A2 の正規化後は自動で外れる。明示的にも `none` を除く）②`unresolved` は**1回だけ**出す：`inferred` なら「- 未解決：<text>（AI の推測）」の1行だけ（個別の行は足さない）、`evidenced` なら「- <text>」の1行だけ、`none` なら出さない ③同じ文の行が2回出ないように重複を除く。ほかの節（担当作業・いま理解していること・試したこと・聞きたいこと）と1行目・最後の行は T-006 の A1 のまま
- A5. テストを足す（既存のテストは変えない）：`summary-schema.test.ts` に **5件以上**：①「なし。メモには書かれていない」（evidence 空）→ `none` ②「原因はメモに記録がない」→ `none` ③「設定漏れが原因ではなく、ポートの競合だった」（evidence 空）→ `inferred`（誤って none にしない） ③の2 **「原因はメモに書かれていないが、権限の設定が関係している可能性がある」（evidence 空）→ `inferred`**（「書かれていない」を含んでも、推測の内容を述べている文は none にしない。立法補佐の追加、AI の推測を「記録なし」に隠さないため）④evidence が1件以上なら本文が「なし」でも `evidenced`。`question-draft.test.ts` に **2件以上**：①本文「なし。メモには書かれていない」（evidence 空）の項目が【未確認のこと】に出ない ②`unresolved` が `inferred` のとき【未確認のこと】に「未解決」の行が1回だけ出る
- A5の2. **例外（立法補佐の追記）**：`src/lib/question-draft.test.ts` の既存のテスト（T-006）のうち、【未確認のこと】で「未解決」の重複を期待している**1行**（`"- 他の一覧画面にも同じ比較関数があるか",`。A4② で直す不具合そのものを期待値にしていた行）だけは、削除してよい。ほかの既存のテストは変えない。削除した理由をコミットの本文に書く
- A6. `npm run -s test`（既存 123 件＋追加分）・`npm run -s typecheck`・`npm run -s lint` がすべて通る。差分は `files_allowed` の5ファイルだけ。依存の追加はしない

## 3. 開発用テスト

- A5 の6件。`Summary` の見本は `summary-schema.test.ts`・`question-draft.test.ts` の作り方を参考にする
- `src/lib/demo-fixtures/` の保存済み出力は、整理の指示が変わるため**統合後にオーナーが取り直す**（`npm run demo:capture` と `npm run demo:capture -- --partial` の両方）。この票では触らない。既存の `demo.test.ts` は fixture の中身に依存しない形なので通るはず（通らなければ報告して止まる）
- 画面（S-2 の「記録なし」バッジ、S-1 の4区分、下書き）はテストしない。ユーザー役が統合と fixture の取り直しの後に確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回
2. `prompt.ts`：「守ること」の箇条書きに1行足す（A1 の文）
3. `summary-schema.ts`：`NONE_TEXT`（全体一致）はそのまま残し、`NONE_PREFIX = /^(なし|該当なし|特になし|記録なし|不明)([。．、，：:]|$)/u` と `NONE_PHRASES = ["書かれていない","記録がない","記録はない","メモにない","言及がない","触れられていない","確認できない"]` を足し、`isNoneText` を「全体一致 ‖ 先頭一致 ‖（60 文字以内 かつ 語を含む）」にする
4. `question-draft.ts`：④のループで `ask_human` と **`unresolved` を除いた**項目の `inferred` を出し、そのあと `unresolved` を状態に応じて1行だけ出す。最後に `Array.from(new Set(unconfirmed))` で重複を除く
5. コミットは1つ。メッセージの先頭は `T-008: `

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。要件は `requirements_source: ticket` により **main にコミット済みのこの票の §2（A1〜A6）**。T-007（`UnderstandingPanel.tsx` だけ）と**並行可**（触るファイルが重ならない）。

## 6. 記録

（統合後に行政の長が追記）
- 22:53 立法補佐（Pro）が §2 を確認。A2 ③（60文字以内で「書かれていない」等を含めば none）は、推測の内容を述べる文まで「記録なし」に隠すおそれがあるため、A5 に対照の試験（③の2）を追加し 5件以上に改めた。そのうえで main に固定（D-49②）
- 23:04 立法補佐：W2 が票の矛盾（A4②「未解決は1行」と、既存テストが重複を期待していること、A5「既存のテストは変えない」）で止まった（正しい止まり方）。オーナーの選択により、A5の2 として、重複を期待する既存のテストの1行だけ削除を認める例外を追記し、main に固定
- 23:07 W2 が再開してコミット c40be22（5ファイル、+123/−6。main ec9c139 から）。報告：test 132（既存 123＋9）・typecheck・lint 合格。A2 ③は行政の長の指示で「該当語を含み、かつ該当語で文が終わる（後ろは記号だけ）ときに none」と実装（A5 ③の2 と両立させるため。`endsWithNonePhrase`）。既存テストの変更は A5の2 の1行の削除だけ。拒否なし
- 23:08 行政の長が差分を確認（`files_allowed` の5ファイルのみ、A1〜A6）。`status: review` で main にコミット。新しい worktree で c40be22 を main の上に cherry-pick して申請（T-007 とは別のブランチ。鎖にしない。オーナーの指示）

- 2026-11-04T23:13:23+0900 gate-runner: status → in_progress（ブランチが main を含んでいない（rebase が必要））
- 23:13 立法補佐：上の差し戻しは、別々に分岐した2票のうち先の T-007 の統合で main が進んだため（統合キュー p0.3.1 が未施行。予告どおり）。回数に数えない。再申請のため review に

- 2026-11-04T23:20:12+0900 gate-runner: status → blocked（judge と Codex の判定が重大な指摘で分かれた（judge=APPROVED/0 件, codex=CHANGES_REQUIRED/2 件）。オーナーの裁定へ）
- 23:21 オーナーの解釈：A2 ③は「該当語で文が終わる」、61文字の上限は③だけ、②は長さを問わない。A2 の文面と、立法補佐が足した A5 ③の2 が矛盾していた（立法補佐の誤り。OBS-029）ため A2 を明確化。今の実装はこの A2 どおりでコードの変更は不要。差し戻しは回数に数えない。再申請のため review に

- 2026-11-04T23:26:57+0900 gate-runner: status → blocked（judge と Codex の判定が重大な指摘で分かれた（judge=APPROVED/0 件, codex=CHANGES_REQUIRED/1 件）。オーナーの裁定へ）
- 23:27 オーナーの裁定：Codex の指摘（③の「後ろに続くのは句読点・空白だけ」に対し、実装の TRAILING_SYMBOLS が \p{P}\p{S} で絵文字や数学記号まで許している）を採り、差し戻し。直しは1か所（許す文字を句読点・感嘆符・疑問符・空白に限る）で、票は変えない。この差し戻しは実装の不一致なので回数に数える
- 23:31 行政の長：W2（新しい worktree、main の上）に修正を指示。`TRAILING_SYMBOLS` を句読点（。．、，）・感嘆符・疑問符（！？!?）・空白だけに限り、テスト「記録がない😀 → none にしない」を1件足す。元のコミット c40be22 を cherry-pick して修正を重ね、1コミットにして再申請。`status: review` に戻す（§2 は変えない。差し戻し1回目）

- 2026-11-04T23:36:03+0900 gate-runner: status → blocked（judge と Codex の判定が重大な指摘で分かれた（judge=APPROVED/0 件, codex=CHANGES_REQUIRED/1 件）。オーナーの裁定へ）
