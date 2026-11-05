---
id: T-draft-m11-knowing-map
title: M11 知らないことマップ（「いまの理解」の4区分を氷山の図で見せる。S-1 の整理結果の下）
status: draft
requirements: [A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M11（D-44①）, M10-1, M4-3]   # 記録用。司法には渡さない
proposal_from: 2026-11-06 02:4x 行政の長の下書き（28_night_plan_max.md §1 C-2）。D-44①「M10 の4区分を氷山の図で見せる」
estimate_h: 0.8
time_limit_min: 50
security_review: false         # 画面だけ。API・DB に触れない
unattended:
branch: null
worker: null
files_allowed:
  - src/lib/knowing-map.ts                  # 新設：図のための純粋関数（層・切り詰め・件数）
  - src/lib/knowing-map.test.ts             # 新設
  - src/components/KnowingMap.tsx           # 新設：SVG の図
  - src/components/UnderstandingPanel.tsx   # 結果の下に図を1つ差し込むだけ
files_forbidden:
  - src/lib/understanding.ts
  - src/lib/summary-schema.ts
  - src/app/**
  - src/components/WorkScreen.tsx
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - docs/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: []
---

## 1. 目的

「いまの理解を整理」（M10-1、T-004・T-005）の結果は4区分の箇条書きで出る。これを**氷山の図**にして、「水面の上＝確認済みの事実」「水面＝AI の推測」「水面の下＝未確認」「深い所＝人に確認すべきこと」が一目で分かるようにする。新人が「自分は何を知らないか」を形で見る（原体験：知らないことが分からず半日）。審査：インパクト30（知らないことを見つける）、デモ25（0:40〜1:00 の場面に図が出る）。

## 2. 受け入れ条件

- A1. `src/lib/knowing-map.ts` に純粋関数 `buildKnowingMap(u: Understanding): KnowingMap` を export する（`Understanding` は `@/lib/understanding` の型。`import type` だけ）。`KnowingMap = { layers: KnowingLayer[]; total: number; summary: string }`、`KnowingLayer = { key: "confirmed" | "inferred" | "unverified" | "ask_human"; label: string; items: string[]; overflow: number; count: number }`。層は**この順に4つ固定**（件数が 0 でも層は出す）。`label` は `@/lib/understanding` の `UNDERSTANDING_LABELS` の値。`items` は各区分の `text` を `seq` 順（配列の順）に**最大 4 件**、1件は **28 文字**を超えれば先頭 27 文字＋「…」。`overflow` は 5 件目以降の件数。`count` は元の件数。`ask_human` は `null` なら 0 件、あれば 1 件。`NOT_IN_NOTES_TEXT`（「まだメモにない」）の項目は**どの層にも入れない**（件数にも数えない）。`total` は4層の `count` の合計。`summary` は「確認済み <n>・推測 <n>・未確認 <n>・人に確認 <n>」の形
- A2. `src/components/KnowingMap.tsx`（クライアント部品、props `{ understanding: Understanding }`）は `buildKnowingMap` の結果を **インラインの SVG**（`viewBox="0 0 320 240"`、幅は親に合わせる）で描く：上から4つの横の帯（高さ 60 ずつ）、水面の線を1層目と2層目の境（y=60）に引き、帯の左に `label`、帯の中に `items` を1行ずつ（`<text>`。長い文字は A1 で切り詰め済み）、`overflow` が 1 以上なら最後に「ほか <overflow> 件」。色：1層目 emerald、2層目 violet（既存の「AI の推測」のバッジと同じ系）、3層目 zinc、4層目 amber。SVG には `role="img"` と `aria-label="知らないことマップ：<summary>"` を付け、SVG の直後に**スクリーンリーダー用の一覧**（`<ul className="sr-only">` に層ごとの `label` と `items`）を置く。`total` が 0 なら SVG を描かず「整理の結果がまだありません」の1行
- A3. `src/components/UnderstandingPanel.tsx` の、結果の4区分（`renderSection` ×4）の**直後**に、見出し「知らないことマップ」（`<h3>`、既存の見出しと同じ見た目）と `<KnowingMap understanding={result.understanding} />` を差し込む。結果がないとき（`result` が `null`）は出さない。それ以外（fetch・質問への答え・4区分の表示・props の型）は変えない
- A4. `KnowingMap` は `@/lib/knowing-map` を実行時に import してよい（純粋関数だけ。`node:fs`・DB を使わない）。`@/lib/understanding` は `import type` と `UNDERSTANDING_LABELS`・`NOT_IN_NOTES_TEXT` の定数だけ（実行時に DB を読まないことを作業員が確かめる）。`dangerouslySetInnerHTML`・`console`・`localStorage` を使わない。SVG の `<text>` に入れる文字列は React の子としてだけ渡す（文字列から SVG を組み立てない）
- A5. `src/lib/knowing-map.test.ts` に、下の①〜⑥を**それぞれ1件以上の `it(`**で試す：①4層が固定の順と `label` で出る（件数 0 の層も）②5件以上の区分は `items` が 4 件で `overflow` が残りの数、`count` は元の数 ③29 文字の `text` は 27 文字＋「…」（28 文字はそのまま）④`ask_human` が `null` なら 0 件、あれば 1 件 ⑤「まだメモにない」の項目は層に入らず `total` に数えない ⑥`summary` の文が「確認済み 2・推測 1・未確認 0・人に確認 1」の形
- A6. `npm run -s test`（既存の試験のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは次の4つだけ：`src/lib/knowing-map.ts`（新設）、`src/lib/knowing-map.test.ts`（新設）、`src/components/KnowingMap.tsx`（新設）、`src/components/UnderstandingPanel.tsx`

## 3. 開発用テスト

- `knowing-map.test.ts`：A5 の観点。図の見た目はユーザー役が統合の後に W1 のメモ3件で「いまの理解を整理」を押して確かめる（4層が出る、長い文が切れる）

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. SVG は固定の座標で描く（レイアウトの計算を JS でしない）。帯の y は 0・60・120・180、`items` の y は帯の上端＋18 から 12 ずつ
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。**T-draft-m14-checkin-prompt と `UnderstandingPanel.tsx` が重なる**ので、どちらかの統合の後にもう片方を着手する（並行しない）。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（Codex は sandbox の中から呼べない。4:00 から立法補佐が行う）。（点検の後に追記）

## 8. オーナーに聞くこと

1. 図を常に出すか、「図で見る」の切り替えにするか（下書きは常に出す。デモで1クリック減る）
2. 「AI の推測」を水面（2層目）に置く解釈でよいか（D-44①の「氷山」の層の割り当てはオーナーの構想に合わせる）
