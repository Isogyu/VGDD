---
id: T-draft-ui-error-handling
title: 画面の失敗の扱いを統一する（fetch の失敗で止まらない、失敗は role="alert" と red、ErrorBox 部品、前の作業の整理結果が残らない）
status: draft
requirements: [A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M1, M4, M10-1, P5（UI の刷新）]   # 記録用。司法には渡さない
proposal_from: 2026-11-06 02:5x アプリの画面の点検（docs/drafts/review-ui.md の #1・#2・#3・#5・#9 の red 枠・#15 の ReadonlyMap）
estimate_h: 0.8
time_limit_min: 50
security_review: false         # 画面だけ
unattended:
branch: null
worker: null
files_allowed:
  - src/components/ErrorBox.tsx          # 新設：失敗の文の部品
  - src/components/WorkScreen.tsx
  - src/components/SessionView.tsx
  - src/components/GovernanceView.tsx    # STATUS_BADGES を ReadonlyMap に、red 枠を ErrorBox に
  - src/components/ShareReview.tsx       # red 枠を ErrorBox に（文と振る舞いは変えない）
  - src/components/ShareRecords.tsx      # 同上
  - src/components/TeamKnowledge.tsx     # 同上
files_forbidden:
  - src/lib/**
  - src/app/**
  - src/components/UnderstandingPanel.tsx   # M14・M11 の票が触るため、この票では key={session.id} の付与だけ WorkScreen 側で行う
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-019, T-021]
---

## 1. 目的

画面の失敗の扱いが部品ごとに違う：`WorkScreen` の進行中の作業の取得は try/catch がなく、通信が切れると「読み込み中…」のまま止まる。`SessionView` の整理と答えの送信は catch がなく、失敗しても何も出ない。`WorkScreen` は成功・注意・失敗を1つの `message`（`role="status"`、amber）で出す。失敗の red の枠は部品ごとに書かれ、`dark:` の抜けがある。また 409 →「終了して始める」の経路で `UnderstandingPanel` がマウントされ続け、前の作業の整理結果が新しい作業の下に残る。失敗の表示を1つの部品にまとめ、止まらない・分かる・残らない、にする。審査：深さと実行20（審査員が触って壊れない）、デモ25。

## 2. 受け入れ条件

- A1. `src/components/ErrorBox.tsx` を新設する：props `{ children: ReactNode; kind?: "error" | "warn" | "info"; className?: string }`。`error`（既定）は `role="alert"`・red の枠（`rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-100`）、`warn` は `role="status"`・amber（同じ形で amber）、`info` は `role="status"`・zinc。`className` は**外側の余白**（`mt-2` など）にだけ使う。余白の内側は `p-3` に統一してよい（文・条件は変えない）。中身は文字列か要素（`dangerouslySetInnerHTML` は使わない）
- A2. `src/components/WorkScreen.tsx`：(1) 進行中の作業・履歴の取得（`Promise.all` の fetch）を `try/catch/finally` で包み、失敗したら **`!cancelled` のときだけ** `ErrorBox` に「作業の状態を取得できませんでした。再読み込みしてください」を出し、`finally` で **`if (!cancelled) setLoading(false)`**（取り消した効果が新しい読み込みの表示を消さない）(2) `message` の state を `{ kind: "info" | "warn" | "error"; text: string } | null` にし、`setMessage` の **16 箇所すべて**に次の規則で `kind` を付ける：**「できませんでした」を含む文＝ `error`**（`ユーザー一覧を取得できませんでした`・`開始できませんでした（…）`×2・`保存できませんでした（…）`×2・`終了できませんでした（…）`×2・`削除できませんでした`）、**`注意：` で始まる文と入力の催促＝ `warn`**（`注意：…`・`先に作業を始めてください…`・`メモを入れてください`・`作業名を入れてください。例：…`・`進行中の作業がありません`・`作業名を入れてから「開始」を押してください`）、**`「…」を終了しました` で始まる文＝ `info`**。**文はすべて今のまま**（司法は差分の各 `setMessage` 行とこの規則を突き合わせる。箇所が 16 と違えば作業員が報告に実数を書く）。表示は `ErrorBox` で (3) `<UnderstandingPanel … />` に `key={session.id}` を付ける（作業が変わったら部品を作り直す。`UnderstandingPanel.tsx` 自体は変えない）
- A3. `src/components/SessionView.tsx`：`summarize` と `submitAnswers` の `try` に `catch` を足し、`setError("整理できませんでした（通信エラー）")`（答えの送信は「答えを送れませんでした（通信エラー）」）。既存の `finally` と成功の処理は変えない。red の枠 2 箇所（L132 付近の文だけの枠、L165-174 付近の「もう一度整理する」ボタンを含む枠）を `ErrorBox` に置き換え、**ボタンを含む枠は `ErrorBox` に文だけを入れ、「もう一度整理する」ボタンは `ErrorBox` の外の同じ枠（`role="group"`）に出す**（文・`disabled`・`onClick`（`confirmFlagged: true` で呼ぶ既存の振る舞い）は変えない）
- A4. 置き換える **red の失敗の枠は次の 10 箇所**（`border-red-300 bg-red-50 …` の `<p role="alert">` か `<div role="alert">`。行は 2026-11-06 02:4x の main）：`GovernanceView.tsx` L120、`SessionView.tsx` L132・L166（A3）、`ShareReview.tsx` L444・L583・L640、`ShareRecords.tsx` L105・L108、`TeamKnowledge.tsx` L232・L270。**文・表示の条件・ボタンは変えない**。**変えないもの**：枠のない red の文字（`ShareReview.tsx` L518・L624）、amber の注意と確認（`ShareReview.tsx` L483・L626 の `flagged_body` の確認、`QuestionDraft.tsx`）、`UnderstandingPanel.tsx`。`GovernanceView` の `STATUS_BADGES: Record<string, …>` を `ReadonlyMap<string, …>` にし、読み取りは `.get(status) ?? 既定` にする（`constructor` 等の `status` で Function を拾わない。`ShareReview` の `DECIDE_FAILURES` が先例）
- A5. どの部品も `console`・`localStorage` の新しい使用を足さない。`dangerouslySetInnerHTML` を使わない。`ErrorBox` を `import` するのは `src/components/` の中だけ
- A6. `npm run -s test`（既存の試験のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは `files_allowed` の最大7つ。画面の部品の単体試験は書かない（既存の画面と同じ）

## 3. 開発用テスト

- なし（画面）。統合の後に、ユーザー役が開発サーバーを止めた状態で S-1 を開き「取得できませんでした」が出ること、409 →「終了して始める」の後に前の整理結果が残らないことを確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. `ErrorBox` の見た目は既存の red の枠（`ShareReview` のもの）をそのまま部品にする
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。`WorkScreen.tsx` を触る票（M13・M14・M12 の画面）、`ShareReview.tsx` を触る票（M12 の画面の stale、share-stale-reject）と重なるので、順に統合する（並行しない）。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（4:00 から立法補佐が行う）。点検役：Claude のサブエージェント（読み取り専用）。03:0x、この票 6 件。対応：#1 `setMessage` 16 箇所の `kind` の規則を閉じた（A2）／#2 `ShareReview` の `flagged_body` は amber なので対象から外し、ボタンを含む red の枠は `SessionView` L166 と明記（A3・A4）／#3 `finally` は `!cancelled` のとき（A2）／#4 `className` と余白の方針（A1）／#5 対象の 10 箇所と変えないものを列挙（A4）／#6 「もう一度整理する」の既存の振る舞いは変えないと明記（A3）

## 8. オーナーに聞くこと

1. UI の刷新（P5、11/7）に含めるか、先に通すか（#3 の「前の作業の整理結果が残る」は本番で再現しうる）
2. review-ui の票 B（見た目の1本化：日時の書式・二次ボタン・句点）と票 C（アクセシビリティの小修正）も下書きにするか
