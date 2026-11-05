---
id: T-draft-fingerprint-no-id
title: 手順書の原案の fixture の指紋から共有の番号（knowledge_id）を外す（seed --reset の後も保存済みの原案が一致するように）
status: draft
requirements: [A1, A2, A3, A4]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M5-1, M7-1, M4-4, D-62]   # 記録用。司法には渡さない
proposal_from: T-020 §3 の既知の限界（2026-11-06）。原案の fixture の `sources_fingerprint` が `knowledge_id` を含むため、`npm run seed -- --reset` で入れ直した DB（自動の番号が 1 から始まらない）では一致せず、デモモードの原案が「保存済みの原案は、いまの共有と一致しません」になりうる。28_night_plan_max.md §1 C-6
estimate_h: 0.3
time_limit_min: 30
security_review: false
unattended:
branch: null
worker: null
files_allowed:
  - src/lib/ai/procedure-provider.ts        # sourcesFingerprint の材料だけ
  - src/lib/procedure.test.ts               # 指紋の試験の期待値と追加の試験
  - src/lib/ai/capture-extras.test.ts       # 往復の試験が指紋に依存していれば期待値だけ
files_forbidden:
  - src/lib/procedure.ts
  - src/lib/ai/capture-extras.ts
  - src/lib/demo-fixtures/**
  - src/components/**
  - src/app/**
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

デモモード（API キーなし）の手順書の原案は、保存済みの fixture の `sources_fingerprint` が**いまの材料**（承認済みの共有）の指紋と一致するときだけ出る（T-012 の `sources_changed` の規則。承認済みの共有が変わったのに古い原案を出さないため）。今の指紋は `[knowledge_id, approved_at, body]` を含み、`knowledge_id` は DB の自動の番号なので、同じ合成データでも `seed --reset` の回数で変わる。**内容が同じなら一致する**ように、指紋から番号を外し、材料の並びを内容で決める。審査：デモ25（審査員の環境と録画の環境で同じ結果）。**T-020 の fixture の採取（オーナー）の前に統合する**（採取の後に変えると fixture を採り直す）。

## 2. 受け入れ条件

- A0. **作業員が最初に確かめ、報告に書く（どれかが外れていれば止まって報告する。票の目的が成立しないため）**：(a) fixture の `raw` の中で原案の根拠（`evidence`）が材料をどう指しているか（`procedure.ts` の `validateProcedure`・`mapEvidence` を読む）。**`knowledge_id` そのものを指しているなら**、`seed --reset` の後は番号が変わり、指紋が一致しても根拠の参照が外れる。その場合は止まる（指紋だけ直しても目的に届かない。根拠を「材料の並びの番号（1〜n）」で指す形への変更が別に要る）。材料の並びの番号を指しているなら進める (b) seed（`src/lib/seed.ts`）の共有の `approved_at` が固定の文字列であること（`seed --reset` のたびに変わらない）(c) `ProcedureSource.approved_at` が ISO の文字列型であること
- A1. `src/lib/ai/procedure-provider.ts` の `sourcesFingerprint(sources)` を次に変える：材料を `[approved_at, body]` の配列にし、**`approved_at` の昇順、同じなら `body` の昇順**に並べてから `JSON.stringify` し、SHA-256 の16進を返す。比較は **文字列の `<`・`>`（コードポイント順）** で行い、`localeCompare` は使わない（実行環境のロケールで順が変わり、指紋が環境で揺れるため）。**引数の配列を書き換えない**（`[...sources].sort(...)` のように写しを並べる）。関数の名前・引数・返り値の型は変えない。`knowledge_id` は材料に入れない。同じ `[approved_at, body]` が2件あればそのまま2件として並べる（重複を除かない）
- A2. `ProcedureFixture` の形は変えない（`sources_fingerprint: string` のまま）。既存の fixture ファイルは `src/lib/demo-fixtures/` に `procedure-*.json` が**ない**ことを作業員が確かめ、報告に書く（あれば止まって報告する。採り直しが要るため）
- A3. `src/lib/procedure.test.ts` に次を足す（既存の `it(` は、指紋の値そのものを期待している行があれば**その期待値だけ**を変え、それ以外は変えない）：①`knowledge_id` だけが違う2つの材料の配列で指紋が等しい ②材料の順が違う（同じ2件を逆に並べた）配列で指紋が等しく、**呼び出しの後も元の配列の順が変わっていない** ③`body` が1文字違えば指紋が違う ④`approved_at` が違えば指紋が違う ⑤既知の入力（`approved_at` と `body` を試験に書いた2件）に対する**固定の16進の値**と等しい（並びや材料の形が黙って変わったら落ちる）⑥同じ `[approved_at, body]` が2件ある配列と1件だけの配列で指紋が違う。`src/lib/ai/capture-extras.test.ts` の往復の試験（②④）は、指紋の計算が変わっても通ることを確かめる（期待値に指紋の文字列を直接書いていれば、その値だけ変える）
- A4. `npm run -s test`（既存の試験と追加分のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは `src/lib/ai/procedure-provider.ts`・`src/lib/procedure.test.ts`・（必要なときだけ）`src/lib/ai/capture-extras.test.ts` の最大3つ

## 3. 開発用テスト

- `procedure.test.ts`：A3 の観点。統合の後に、オーナーが `npm run seed -- --reset` を2回行っても `/knowledge` の原案（fixture 採取後）が「一致しません」にならないことを確かめる

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. 並べ替えは `[...sources].sort((a, b) => (a.approved_at < b.approved_at ? -1 : a.approved_at > b.approved_at ? 1 : a.body < b.body ? -1 : a.body > b.body ? 1 : 0))` の形（`localeCompare` は使わない）
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。T-020 の fixture の採取の**前**に統合する。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（Codex は sandbox の中から呼べない。4:00 から立法補佐が行う）。点検役：Claude のサブエージェント（ツールなし）。02:5x、2票あわせて指摘 8 件。この票への対応：#2 `evidence` が `knowledge_id` を直接指すなら目的に届かない → A0 で作業員が確かめ、該当なら止まる。§8 にも／#3 seed の `approved_at` が固定か → A0 (b)／#6 比較はコードポイント順の `<`・`>` に票で決め、入力を書き換えない（A1・試験②）、`approved_at` の型を A0 (c)／#7 固定のハッシュの試験⑤、重複の扱い⑥／#8 README に既知の限界を1行（§8 の 1 の帰結）

## 8. オーナーに聞くこと

1. 指紋から `knowledge_id` を外すことで、「同じ本文・同じ承認日時の共有を取り下げて同じ内容で承認し直した」ときに原案が古いまま出る（内容が同じなので一致する）。これを許容するか。許容するなら README の「保証できないこと」に1行
2. A0 (a) で `evidence` が `knowledge_id` を直接指していると分かったとき、根拠を「材料の並びの番号」で指す形に変える票（`procedure.ts` の `validateProcedure`・`mapEvidence`、T-012 の A 条件の変更）を起こすか。T-020 の fixture の採取はその後にする
