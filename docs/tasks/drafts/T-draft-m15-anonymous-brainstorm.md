---
id: T-draft-m15-anonymous-brainstorm
title: M15 匿名ブレスト（個人のチャットで意見を出す → 名前・固有名詞を伏せる → Claude が論点ごとにまとめる → 共有は本人の確認を通す）の設計の下書き
status: draft
requirements: []   # 未確定。設計の論点を §2 に書き、オーナーの判断の後に票の形にする
requirements_source: ticket
related_requirements: [M15（D-55）, M6-1, M9-1, M9-3, M9-4]   # 記録用
proposal_from: D-55「凄さが伝わる」ための拡張。2026-11-06 03:0x 行政の長の下書き（28_night_plan_max.md §1 F-5）。見込み約 3.5h（D-55）
estimate_h: 3.5
time_limit_min:
security_review: true
unattended:
branch: null
worker: null
files_allowed: []
files_forbidden: []
depends_on: [T-draft-m12-interview-api]
---

## 1. 目的

チームで「言いにくい意見」を集める。各人が自分の画面で意見を書き、**名前・固有名詞を伏せた**うえで Claude が論点ごとにまとめ、まとめの共有は本人の確認を通す（M9 と同じ経路）。審査：インパクト30（心理的安全）、Claude の活用25。

## 2. 設計の論点（オーナーの判断が要る。票の形にする前に決める）

| # | 論点 | 案 | 推奨 |
|---|---|---|---|
| 1 | **固有名詞を伏せる手段**。D-55 は「決定論的な検査と手元の LLM」。手元の LLM（ローカル）は未導入で、依存の追加か別のプロセスが要る | (a) 決定論的な検査だけ（M6-1 の `detectSensitive`＋登録語句＋人名の簡単な規則）で伏せ、取りこぼしは本人の確認（S-3 と同じ抽象化の案）で補う (b) ローカル LLM を足す（依存・時間・再現性の問題） | **(a)**。期間中はローカル LLM を入れない。README に「伏せるのはパターンの照合、完全ではない」 |
| 2 | **誰の意見かを DB に残すか** | (a) 残さない（`user_id` を持たない。本人の確認ができない）(b) 残すが画面に出さない（本人が自分の意見を取り下げられる） | **(b)**。M9-5（取り下げ）と M9-4（人事評価に使わない）の注意を出す |
| 3 | **まとめの材料**。Claude に送るのは伏せた後の本文だけ | 送るのは `masked_body` だけ。原文（`body`）は送らない。試験で「原文の語が入力に入らない」を確かめる | そのまま |
| 4 | **共有の経路**。まとめは誰が承認するか | (a) まとめの対象になった各人が自分の意見の部分を承認（M9 と同じ）(b) 先輩がまとめ全体を承認 | **(a)** を基本に、まとめ（論点ごと）は「全員の承認が済んだ論点だけ」を S-4 に出す |
| 5 | **画面** | S-6 `/brainstorm`：題（テーマ）を作る → 各人が意見を書く（伏せた結果をその場で見せる）→ 「まとめる」（Claude）→ 論点ごとのまとめと、自分の意見の承認 | — |
| 6 | **表** | `brainstorms (id, title, status, created_at)`、`opinions (id, brainstorm_id, user_id, body, masked_body, flags_json, status pending\|approved\|withdrawn, created_at)`、`brainstorm_summaries (id, brainstorm_id, json, model, created_at)` | — |
| 7 | **デモ** | 合成データに題1つ・意見3件（新人A・新人B・先輩C）。fixture は T-020 の仕組みで採る | — |

## 3. 票に分ける案

1. 裏側（表・伏せる関数・まとめの provider・API）1.5h、security_review あり
2. 画面 1.0h
3. デモの seed と fixture 0.5h

## 4. 保留の理由

- G4（11/7 夜）の機能凍結までに、M12・M11・M14・M13・S1 と、安全の修正（dev-routes・answers の門）が先。M15 は D-55 の順でも「匿名ブレスト」は夜間ハーネスと統治の画面の後
- ローカル LLM を入れない (a) の案なら、M6-1 と M9 の既存の部品で組める。入れる (b) なら依存の追加（オーナーの承認）

## オーナーに聞くこと

1. §2 の 1〜4 の推奨でよいか（特に 1：ローカル LLM を期間中は入れない）
2. G4 までに M15 を作るか、将来構想（README §8）に置くか
