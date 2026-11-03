---
id: T-003
title: 整理の待ち時間にメモを振り返る表示
status: merged
requirements: [A1, A2, A3, A4, A5]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M3-2, M4-1]   # 関連する docs/requirements.md の ID（記録用。司法には渡さない）
proposal_from: M4 の提案（2026-11-03、M4 のコミット 57a48a9 の直後にオーナー採用）
estimate_h: 0.3
time_limit_min: 40
branch: worktree-agent-a304c702b5112e003   # 作業員の元のブランチ（f2b9781）。申請は main 追従のため cherry-pick した新ブランチ（§6）
worker: W3
files_allowed:
  - src/lib/use-note-replay.ts           # T-000 が作った差し込み口（フック）の中身。関数名・引数・返り値の型は変えない
  - src/lib/use-note-replay.test.ts
files_forbidden:
  - src/components/SessionView.tsx       # 差し込み口は T-000 で作成済み。触らない（返した番号の li に薄い青を付ける口がある）
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

「整理しています…」の約10秒の間に、左のメモを上から順に軽く強調して「AI が読み込んでいる」感を出す。デモ動画で待ち時間が間延びしない。審査：デモ25。SessionView は T-000 で、`useNoteReplay` が返した番号の `li` に `bg-sky-100` を付ける口を作ってある（根拠の黄色 `bg-yellow-100` が付くときは付けない）。

## 2. 受け入れ条件

- A1. `src/lib/use-note-replay.ts` に純粋関数 `nextReplayIndex(current: number | null, count: number): number | null` を export する：`count <= 0` なら `null`。`current` が `null` なら `1`。`current < count` なら `current + 1`。`current >= count` なら `1`（末尾で先頭に戻る）
- A2. `useNoteReplay(count: number, active: boolean): number | null`（T-000 の形を変えない）は、`active` が `true` かつ `count > 0` のとき、呼ばれた直後の描画で `1` を返し、以後 **`REPLAY_INTERVAL_MS`（export、値は 800）ミリ秒ごと**に A1 の順で番号を進める。`active` が `false`、または `count` が `0` のときは常に `null`
- A3. `active` が `true` から `false` に変わる（整理が終わる・失敗する）と、次の描画で `null` に戻る。interval は effect の cleanup で必ず消す（unmount 後に setState しない）
- A4. `window.matchMedia("(prefers-reduced-motion: reduce)").matches` が `true` のときは、`active` の間 **`1` のまま動かさない**（interval を作らない）。`matchMedia` がない環境（テスト）では動くものとして扱う
- A5. `src/lib/use-note-replay.test.ts` に `nextReplayIndex` のテストを **4件以上**（`count` 0・`null` から・途中・末尾で先頭に戻る）と、`REPLAY_INTERVAL_MS === 800` の確認。`npm run -s test`（既存 91 件＋追加分）・`npm run -s typecheck`・`npm run -s lint` がすべて通る。差分は `files_allowed` の2ファイルだけ（`SessionView.tsx` は変えない）

## 3. 開発用テスト

- `use-note-replay.test.ts`：A5。フックの描画（interval）はテストしない。ユーザー役が統合後に「整理しています…」の間に薄い青が上から順に動くことを確認する
- 既存のテストは `@testing-library/react` を使っていない。**依存の追加はしない**（フックのテストは書かない）

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を最初に1回（`npm install` は使わない）
2. `use-note-replay.ts`：`"use client"` は不要（client 部品から呼ばれる）。`useState<number | null>(null)` と `useEffect`。effect の中で `active && count > 0` なら `setIndex(1)`（**effect 内の同期的な setState は React Compiler の lint `react-hooks/set-state-in-effect` に当たる**ので、`setTimeout(…, 0)` で次のティックにするか、`useState` の初期値と `key` で代える等、lint が通る形にする。interval のコールバック内の `setIndex(prev => nextReplayIndex(prev, count))` は許される）。cleanup で `clearInterval`・`clearTimeout` と `setIndex(null)` は不要（`active` の変化は effect が再実行されるので、`active` が false の分岐で `setTimeout(() => setIndex(null), 0)` か、返り値を `active ? index : null` にする）
3. reduced motion は effect の中で `typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches` で判定
4. T-000 のコメント（「T-003 が中身を書く差し込み口…」）は、実装後に「T-003 で実装」と書き換えてよい
5. コミットは1つ。メッセージの先頭は `T-003: `

## 5. 統合審査

決定論的な監査（`npm test`・`typecheck`・`lint`）＋ judge ＋ Codex judge。要件は `requirements_source: ticket` により **main にコミット済みのこの票の §2（A1〜A5）**（`--ticket`）。T-001・T-002 と**並行可**。

## 6. 記録

（統合後に行政の長が追記）
- 20:04 立法補佐（Pro）が §2 の受け入れ条件を確認（具体的で検証できる。3票の files_allowed は重ならない）。main に固定（D-49②）
- 20:07 W3 起動（worktree `agent-a304c702b5112e003`、main 99f549a から）。20:10 コミット f2b9781（2ファイル、+96/−6）。報告：test 97（既存 91＋6）・typecheck・lint 合格。逸脱：最初の 1 は `setTimeout` ではなく返り値を `index ?? 1` にして出す。`active` の切り替えは描画中に前回の値と比べて state を捨てる形（effect 内の同期 setState を避ける）。メモが減って番号が範囲外なら 1 を返す。拒否なし
- 20:13 行政の長が差分を確認（`files_allowed` の2ファイルのみ、禁止語なし、A1〜A5 を確認）。`status: review` で main にコミット。票のコミットで main が進むため、新しい worktree で f2b9781 を cherry-pick したブランチで申請する（README の標準手順）

- 2026-11-03T20:28:03+0900 gate-runner: status → in_progress（files_allowed の外を変更している: src/app/api/sessions/[id]/previous/route.ts src/components/CopyButton.tsx src/components/PreviousSummary.tsx src/components/SummaryActions.tsx src/lib/sessions.test.ts src/lib/sessions.ts src/lib/summary-markdown.test.ts src/lib/summary-markdown.ts）
- 20:30 立法補佐：上の差し戻しは法律の不具合（OBS-017、p0.2.2 で修正）によるもの。差し戻しの回数には数えない
- 20:33 行政の長：p0.2.2 施行（66e3a5b）後の再申請。`status: review` に戻して main にコミット（§2 は変えない）。main 6d618b5 の上の鎖の3段目（新しい worktree のブランチ。元のパッチ f2b9781 と同一）。T-002 の統合後に処理される前提

- 2026-11-03T20:56:43+0900 gate-runner: status → in_progress（files_allowed の外を変更している: src/app/api/sessions/[id]/previous/route.ts src/components/CopyButton.tsx src/components/PreviousSummary.tsx src/components/SummaryActions.tsx src/lib/sessions.test.ts src/lib/sessions.ts src/lib/summary-markdown.test.ts src/lib/summary-markdown.ts）
- 20:58 立法補佐：上の差し戻しは鎖の前段（T-001）が統合されなかったための連鎖。中身の判定ではないため回数に数えない
- 21:02 行政の長：T-002 の段の上に、同じパッチ（f2b9781 と同一）を積み直して再申請（鎖の3段目）。`status: review` に戻す（§2 は変えない）

- 2026-11-03T21:07:40+0900 gate-runner: status → in_progress（ブランチが main を含んでいない（rebase が必要））
- 21:12 立法補佐：上の差し戻しは gate-runner の記録のコミットで main が進んだため（OBS-019、p0.2.3 で修正）。回数に数えない
- 21:14 行政の長：p0.2.3 施行（48c6200）後の再申請。`req4-T-002` の上に同じパッチ（f2b9781 と同一）を積み直す（鎖の2段目。新しい worktree のブランチ）。`status: review` に戻す（§2 は変えない）

- 2026-11-03T21:26:26+0900 gate-runner: status → blocked（差し戻しが 3 回に達した。オーナーの判断へ）
- 21:29 オーナーが差し戻し3回を取り消し（理由：法律の不具合 OBS-017・019 と鎖の連鎖。記録は Z3 の annulments.jsonl）。p0.2.4 施行後の再申請のため status: review に戻す（§2 は変えない）

- 2026-11-03T21:36:54+0900 gate-runner: status → blocked（judge と Codex の判定が重大な指摘で分かれた（judge=APPROVED/0 件, codex=CHANGES_REQUIRED/1 件）。オーナーの裁定へ）
- 21:38 オーナーの裁定：judge（APPROVED）と Codex（CHANGES_REQUIRED）の不一致について、Codex の指摘（強調の位置の初期化が active の変化だけで、count が0になって戻ったときに先頭から始まらない。A2 に反する）を採り、差し戻し。影響は小さいが、修正は1か所で条件を確実に満たせるため。立法補佐がコードで確認済み（OBS-021）
- 21:41 行政の長：W3（新しい worktree、main の上）に修正を指示。直し方：`prevActive` ではなく `running`（`active && count > 0`）の変化を見て index を null に戻す。判定を純粋関数として export し、「active のまま count 3 → 0 → 3 で、再開直後が 1」のテストを足す（`use-note-replay.test.ts`）。T-002 は統合済み（dac4690）なので鎖は T-003 だけ。`status: review` に戻して再申請（§2 は変えない。中身の差し戻し1回目）

- 2026-11-03T21:47:06+0900 gate-runner: status → merged（main=60dd9bbc3b98 judge=APPROVED codex=APPROVED）
