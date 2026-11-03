---
id: T-003
title: 整理の待ち時間にメモを振り返る表示
status: ready
requirements: [M3-2, M4-1]
proposal_from: M4 の提案（2026-11-03、M4 のコミット 57a48a9 の直後にオーナー採用）
estimate_h: 0.3
branch: task/T-003-summarizing-replay
worker: null
files_allowed:
  - src/lib/use-note-replay.ts           # T-000 が作った差し込み口（フック）の中身
  - src/lib/use-note-replay.test.ts
files_forbidden:
  - src/components/SessionView.tsx       # 差し込み口は T-000 で作成済み。触らない
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/requirements.md
depends_on: []
---

## 1. 目的

「整理しています…」の約10秒の間に、左のメモを上から順に軽く強調して「AI が読み込んでいる」感を出す。デモ動画で待ち時間が間延びしない。審査：デモ25。

## 2. 受け入れ条件

- A1. 整理中（summarizing が true）の間だけ、メモが上から順に1件ずつ約0.8秒間隔で強調される。最後まで行ったら先頭に戻る
- A2. 整理が終わる、または失敗すると強調は消える
- A3. 根拠の #番号を押したときの黄色の強調（既存）と見た目がぶつからない（整理中は根拠ボタンがないので両立する）
- A4. `prefers-reduced-motion` のときは強調を動かさない（固定の「読み込み中」表示にする）

## 3. 開発用テスト

- 純粋なロジック（次に強調する番号の計算）を小さな関数に切り出してテストする。描画は Pro のユーザー評価で確認

## 4. 手順の案

- `use-note-replay.ts`（T-000 が「常に null を返す」形で用意済み。`useNoteReplay(count: number, active: boolean): number | null` は強調中のメモ番号を返す）の中身を書く。`setInterval` は effect の中で作り、cleanup で消す。React Compiler の lint（effect 内の setState）に注意：interval のコールバック内の setState は許される
- 番号の計算（次に強調する番号、末尾で先頭に戻る）は純粋関数に切り出してテストする。`SessionView.tsx` は T-000 で、返された番号の `li` に薄い色のクラスを付ける口を作ってあるので触らない

## 5. 統合審査

決定論的な監査＋ judge（`--req M3-2`）＋ Codex judge。T-000 の統合後なら、T-001・T-002 と**並行可**。

## 6. 記録

（統合後に行政の長が追記）
