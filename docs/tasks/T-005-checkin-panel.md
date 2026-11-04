---
id: T-005
title: S-1 の「いまの理解を整理」ボタンと4区分の表示（M10-1 の画面）
status: review
requirements: [A1, A2, A3, A4, A5, A6, A7]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M10-1, M4-5, D-40]   # 関連する docs/requirements.md の ID（記録用。司法には渡さない）
proposal_from: M10（要件 §5、P-1'。D-40 の4区分と1問ずつの質問（⑤）。2026-11-04 D-55 の順番「M10 →」）
estimate_h: 0.7
time_limit_min: 60
branch: worktree-agent-ab1057c7c9f36132d   # 作業員の元のブランチ（f5576dc）。申請は main 追従のため cherry-pick した鎖のブランチ（§6）
worker: W2
files_allowed:
  - src/components/UnderstandingPanel.tsx      # 新設：ボタン・結果の4区分・追加の質問・送信前の確認
  - src/components/WorkScreen.tsx              # 無効のボタンを部品に置き換える。ほかの動きは変えない
files_forbidden:
  - src/lib/**                                 # 応答の型は部品の中に書く（T-004 と並行のため。統合後に T-004 の型へ寄せる票を出してよい）
  - src/app/**
  - src/components/SessionView.tsx
  - src/components/SummaryActions.tsx
  - src/components/CopyButton.tsx
  - src/components/PreviousSummary.tsx
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

進行中の作業（S-1）で「いまの理解を整理」を押すと、T-004 の API（`POST /api/sessions/[id]/checkin`）を呼び、結果を **確認済みの事実／AI の推測／未確認／人に確認すべきこと** の4つの見出しで S-1 に差し込んで見せる。情報が足りなければ AI の追加の質問を**1問ずつ**（D-40⑤）出し、答えると答えをメモとして保存して整理をやり直す。作業は終了しない。タイマーで自動実行しない（M10-1）。デモ：W1 のメモ3件で押す → 結果と質問が出る → 作業は進行中のまま。審査：インパクト30、デモ25、Claude の活用25。

## 2. 受け入れ条件

- A1. `src/components/UnderstandingPanel.tsx`（`"use client"`、default export）。props は `{ session: WorkSession; userId: string; notes: Note[]; onNotesChanged: () => void }`。`WorkScreen.tsx` は、右の「現在の作業」にある無効のボタン「いまの理解を整理（M10 で有効）」を**削除**し、左の列の「この作業の過去の記録とチームの知恵」の枠の**直後**（メモ一覧の前）に、進行中の作業があるときだけ `<UnderstandingPanel session={session} userId={userId} notes={active.notes} onNotesChanged={reloadActive} />` を置く。`WorkScreen` のほかの動き（開始・メモ・終了・削除・履歴）は変えない
- A2. 部品の中に、T-004 の応答の型を書く：`UnderstandingItem = { key: string; label: string; text: string; evidence_note_ids: number[] }`、`Understanding = { confirmed: UnderstandingItem[]; inferred: UnderstandingItem[]; unverified: UnderstandingItem[]; ask_human: UnderstandingItem | null; questions: { id: string; text: string; target: string }[] }`、応答 `{ understanding: Understanding; model: string; savedNotes: Note[] }`。ボタン「いまの理解を整理」は `notes.length === 0` か実行中なら無効。押すと `POST /api/sessions/${session.id}/checkin` に `{ userId, excludeNoteIds }` を送り、待つ間は `role="status"` で「整理しています…（10秒ほどかかります）」
- A3. 409 `flagged_notes` のときは、S-2 と同じ文面の確認（「機密情報らしい文字列を含むメモが n 件あります。AI（Claude API）に送る前に確認してください」、該当メモの一覧、「パターンで取りこぼす情報もあります。完全な匿名化はできません。」）と3つのボタン **「このまま送る」**（`confirmFlagged: true`）**「該当メモを除いて送る」**（該当 ID を `excludeNoteIds` に足して送る）**「やめる」**を出す。除いた ID は部品の state に残し、以後の呼び出しにも付ける
- A4. 成功したら、**この順**の4つの見出し「確認済みの事実」「AI の推測」「未確認」「人に確認すべきこと」で結果を描く。各項目は `label：text` と、`evidence_note_ids` があれば `#番号`（`notes` の並び順、1始まり）。空の区分は「なし」。「AI の推測」の項目には S-2 と同じ紫のバッジ、「未確認」の「まだメモにない」は薄い文字。結果の下に「原案です。作業は続いています。この整理は保存されません」と、応答の `model`
- A5. `questions` が1件以上あれば、**1問だけ**表示する（「AI からの追加の質問（1/2）」の形）。答えの `textarea` と2つのボタン：**「答えて整理をやり直す」**（`POST …/checkin` に `{ userId, excludeNoteIds, answers: [{ question: q.text, text }] }` を送り、成功したら結果を置き換え、`onNotesChanged()` を呼んで S-1 のメモ一覧を更新する。空の答えでは送らない）と **「答えない」**（次の質問があれば次へ、なければ質問の枠を閉じる）。409 `flagged_notes` は A3 と同じ扱い
- A6. 失敗は枠の中に `message ?? error` を出す（409 `session_ended` は「作業は終了しています」、503 は応答の `message`）。**`setInterval`・`setTimeout` による自動実行はしない**（押したときだけ呼ぶ）。作業の終了・開始・メモの保存は部品から呼ばない
- A7. `npm run -s test`（既存のテストを変えない）・`npm run -s typecheck`・`npm run -s lint`（React Compiler の `react-hooks/set-state-in-effect` を含む）がすべて通る。差分は `files_allowed` の2ファイルだけ。新しいテストは不要（画面の描画はテストしない。ユーザー役が統合後に確認）

## 3. 開発用テスト

- テストは書かない（画面の描画）。ユーザー役（Pro）が統合後に、W1 のメモ3件で「いまの理解を整理」→4区分→質問に答える→メモ一覧に「答え」が増える、を確かめる
- API キーのない環境では T-004 の 503 の文（デモモードの fixture がない）がそのまま枠に出ることを確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回
2. `UnderstandingPanel.tsx`：`useState` で `result`・`busy`・`error`・`confirmFlagged: Note[] | null`・`excluded: number[]`・`qIndex`・`answerText`。`useEffect` は使わない（取得はクリックのときだけ。effect 内の setState の lint に当たらない）。見た目は S-2 の整理結果の枠（`rounded border border-sky-300 bg-sky-50 … dark:…`、紫のバッジ `bg-violet-100 text-violet-900`）に合わせる。`formatHm` 等は `@/lib/time`（型と純粋関数の import は `src/lib/**` の**変更**ではないので可）
3. `WorkScreen.tsx`：`import UnderstandingPanel from "@/components/UnderstandingPanel"`。`session && active && (<UnderstandingPanel … />)` を hints の枠の直後に。右の無効ボタン（`disabled`、`title="M10 で有効になります"`）を削除
4. T-004 が未統合でも typecheck は通る（API の型は部品の中。実行時の確認は統合後）
5. コミットは1つ。メッセージの先頭は `T-005: `

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。要件は `requirements_source: ticket` により **main にコミット済みのこの票の §2（A1〜A7）**（`--ticket`）。T-004・T-006 と**並行可**（触るファイルが重ならない）。質問文の下書きボタンを S-1 の結果に置くのは T-007（T-005・T-006 の統合後）。

## 6. 記録

（統合後に行政の長が追記）
- 21:52 立法補佐（Pro）が §2 の受け入れ条件を確認（関数名・応答の形・判定の順・テスト件数まで具体的で検証できる。T-004〜T-006 の files_allowed は重ならない。T-007 は T-004〜T-006 の後）。main に固定（D-49②）
- 21:54 W2 起動（worktree `agent-ab1057c7c9f36132d`、main 9a9481d から）。21:5x コミット f5576dc（2ファイル、+250/−8）。報告：test 114（変更なし）・typecheck・lint 合格。手順の案との差：答えを送って 409 `flagged_notes` が返っても答えを失わないよう `pendingAnswers` を足した。「該当メモを除いて送る」は票どおり `confirmFlagged` なし（S-2 は付けている）。気づき：ユーザー切替で前の結果が残る可能性（`selectUser` が `active` を null にして部品が外れるため実害なしと行政の長が判断。`key={session.id}` は次の改善候補）。拒否1件：自分の worktree への `git -C` がフックで止まった（回避せず）
- 21:59 行政の長が差分を確認（`files_allowed` の2ファイルのみ、禁止語なし、A1〜A7 を確認。T-004 の API は未統合のため実行時の確認は統合後のユーザー役）。`status: review` で main にコミット。鎖の2段目

- 2026-11-04T22:09:04+0900 gate-runner: status → in_progress（files_allowed の外を変更している: src/app/api/sessions/[id]/checkin/route.ts src/lib/understanding.test.ts src/lib/understanding.ts）
- 22:13 立法補佐：上の差し戻しは鎖の前段 T-004 の不一致による連鎖。回数に数えない
