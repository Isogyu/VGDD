---
id: T-000
title: S-2 の差し込み口（T-001〜T-003 を並行にするための空の部品）
status: merged
requirements: [A1, A2, A3, A4, A5, A6]   # この票の §2 の完了条件（基盤の票。docs/requirements.md の ID では満たせない）
requirements_source: ticket               # judge.sh・judge-codex.sh は docs/requirements.md ではなく §2 を要件として渡す（p0.2.1）
proposal_from: docs/governance.md §8（2026-11-03 オーナー承認。案 A）
estimate_h: 0.2
time_limit_min: 30
branch: worktree-agent-aaba144821b87eb14
worker: W1
files_allowed:
  - src/components/SessionView.tsx
  - src/components/PreviousSummary.tsx
  - src/components/SummaryActions.tsx
  - src/lib/use-note-replay.ts
files_forbidden:
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/requirements.md
  - docs/tasks/**
  - merge-requests/**
  - src/lib/sessions.ts
  - src/lib/summary-schema.ts
  - src/app/**
  - package.json
  - package-lock.json
depends_on: []
---

## 1. 目的

T-001（前回との比較）・T-002（Markdown でコピー）・T-003（整理の待ち時間の演出）は、いずれも S-2（`src/components/SessionView.tsx`）に差し込む。3票が同じファイルを触ると統合で衝突するので、**この票で先に「差し込み口」を3つ作り、何もしない実装（null）で統合する**。以後の3票は自分の新しいファイルだけを書けばよい。審査：直接の加点はない（VGDD 本稼働の初回の統合＝法律の試運転でもある）。

## 2. 受け入れ条件（完了条件。`requirements_source: ticket` のため、司法はこの節を要件として判定する）

この票は基盤の票で、利用者に見える機能を足さない。`docs/requirements.md` の M4-2・M3-2 は「差し込み口の中身」を書く T-001〜T-003 が満たす。司法は A1〜A6 だけを判定する。

- A1. `src/components/PreviousSummary.tsx`：既定エクスポートの React 部品 `PreviousSummary`。props は `{ sessionId: number; userId: string; taskName: string }`。**常に `null` を返す**。`SessionView.tsx` の右の列（整理結果の列）で、見出し「AI 整理（原案）」の直後・「整理しています…」の表示より前に `<PreviousSummary sessionId={session.id} userId={session.user_id} taskName={session.task_name} />` として置く（`session.status` を問わず置く。出すか出さないかは部品が決める）
- A2. `src/components/SummaryActions.tsx`：既定エクスポートの React 部品 `SummaryActions`。props は `{ summary: Summary; notes: Note[]; session: WorkSession }`（型は `@/lib/summary-schema` と `@/lib/sessions` の既存のもの）。**常に `null` を返す**。`SessionView.tsx` の `{summary && (<>…</>)}` の中で、8項目の `<dl>` の直後・追加の質問（`currentQ`）より前に `<SummaryActions summary={summary} notes={notes} session={session} />` として置く
- A3. `src/lib/use-note-replay.ts`：名前付きエクスポートのフック `useNoteReplay(count: number, active: boolean): number | null`。**常に `null` を返す**（強調中のメモ番号＝1始まりの #番号を返す予定の口）。`SessionView.tsx` では **早期 return より前の、ほかのフックと同じ位置**で `const replayIndex = useNoteReplay(data?.notes.length ?? 0, summarizing);` と呼ぶ（rules-of-hooks）。左のメモの `li` では、`replayIndex === idx` かつ `highlight !== n.id` のとき、薄い色のクラス `bg-sky-100 dark:bg-sky-900` を付ける（根拠の黄色 `bg-yellow-100` と同時には付けない）
- A4. 画面の見た目と動きは**この票の前と同じ**（3つの口はすべて null なので、何も描かれない・何も変わらない）
- A5. `npm run -s test`（既存 91 件）・`npm run -s typecheck`・`npm run -s lint` がすべて通る
- A6. 3つの新しいファイルの先頭に日本語のコメントで「T-00x が中身を書く差し込み口。props／引数の名前と型は T-00x の票が前提にしているので変えない」と書く

## 3. 開発用テスト

この票にロジックはない（すべて null）。新しいテストは書かない。既存のテスト 91 件が通ることを確認する。描画の確認はユーザー役（Pro）が T-001〜T-003 の統合後に行う。

## 4. 手順の案

1. `src/lib/use-note-replay.ts`：`export function useNoteReplay(count: number, active: boolean): number | null { return null; }`。引数が未使用で lint（`@typescript-eslint/no-unused-vars`）が落ちる場合は、関数の先頭で `void count; void active;` と書くか、その行だけ `eslint-disable-next-line` を付ける。**引数名は変えない**（T-003 が前提にする）。`"use client"` は不要（フックは client 部品から呼ばれる）
2. `src/components/PreviousSummary.tsx`・`SummaryActions.tsx`：先頭に `"use client";`。props の型を `interface … Props` で出し、未使用なら同様に `void props;`。`React.FC` は使わず関数で書く
3. `SessionView.tsx`：A1〜A3 の位置に差し込む。import は既存の `@/…` の形。`useNoteReplay` の呼び出しは `useState`・`useRef` の並び（`const [answerText, …]` の直後）に置く。`li` の className の条件を A3 のとおりに足す
4. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回実行して worktree に `node_modules` を作る（`npm install` は使わない。lockfile を変えない）。その後 `npm run -s test`・`typecheck`・`lint`
5. コミットは1つ。メッセージの先頭は `T-000: `。本文に「3つの口はすべて null」と書く

## 5. 統合審査

決定論的な監査（`npm test`・`typecheck`・`lint`）＋ judge ＋ Codex judge。要件は `requirements_source: ticket` により **この票の §2（A1〜A6）**（p0.2.1 の `--ticket` で渡す）。差分は `files_allowed` の4ファイルだけであること。この票は**本稼働の初回の統合**（gate-runner の試運転）。

## 6. 記録

- 2026-11-03 17:17 行政の長が票を作成（未追跡のまま置く。統合時に gate-runner が `docs/tasks/` をコミットする）。17:17 worker（W1、Opus、`isolation: worktree`）を起動
- 17:21 worker の報告：A1〜A6 達成。test 91 件・typecheck・lint 合格。コミット ebba9a1（1つ）。`npm ci` で node_modules を用意（406 packages、lockfile 不変。npm audit moderate 16 件は未対応）。拒否1件（Claude Code の worktree isolation：test・typecheck・lint・git status を1コマンドにまとめた形が「複雑すぎて検証できない」→ 分割して実行）。逸脱：props の型を export、差し込み3か所にコメント
- 17:21 行政の長の確認：ブランチは main（90e84ad）を含む、変更は files_allowed の4件だけ、禁止語なし、HEAD 一致。`status: review` にして `merge-requests/T-000.json` を置いた

- 2026-11-03T17:26:14+0900 gate-runner: status → in_progress（judge=CHANGES_REQUIRED, codex=CHANGES_REQUIRED（両方が差し戻し））
- 17:28 オーナーの報告：初回の gate-runner は差し戻し。judge は「票の要件 M4-2・M3-2 は差し込み口では満たせない」と判定（正しい。票の要件の付け方の誤り）。Codex は `verdict.schema.json` が OpenAI の構造化出力の制約（`findings.items` の `required` に全プロパティが要る。`requirement_id` が欠落）で拒否され、判定なし → fail-closed。判定は Z3（オーナー補佐が確認）。対応：①要件を A1〜A6 に書き直し `requirements_source: ticket` を付けた（この票）②法律 p0.2.1 の改正案（スキーマの strict 対応、`--ticket`、フックの誤検知4件）を行政の長が差分で提案 → 立法補佐の点検・憲法審査 → オーナーが反映 → 再申請（ブランチ・HEAD ebba9a1 は変更なし）
- 18:02 立法補佐（Pro）が §2 の受け入れ条件 A1〜A6 を確認（実装の前の 17:17 に作られた条件で、検証できる内容）。憲法審査の注意（D-49②）に従い、立法補佐が status: review で main にコミットした

- 2026-11-03T18:09:05+0900 gate-runner: status → merged（main=e3c3da3328df judge=APPROVED codex=APPROVED）
