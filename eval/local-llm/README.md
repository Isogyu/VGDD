# ローカル LLM の評価セット（D-52・D-54）

ローカルの小さなモデル（Ollama、`127.0.0.1:11434`）に任せる「高度な推論の要らない作業」の評価セット。**モデルは決めない**（合否・統合・改正の採否を出さない。出せるのは下書きと候補の追加だけ。出力には「ローカル LLM（モデル名）」と明記する。D-52）。

| 作業 | モデル（D-54） | ファイル | 評価のしかた |
|---|---|---|---|
| つぶやきの5区分の分類 | `qwen3:4b-instruct`（思考なし） | `classify-5way.jsonl` ＋ `prompts/classify-system.txt`・`prompts/classify-fewshot.json` | 出力のラベルが `expected` と一致した件数／10 |
| 実名・顧客名らしい語の候補出し | `lfm3` | `name-candidates.jsonl` ＋ `prompts/names-system.txt` | `must_flag` の語がすべて候補に含まれ、`must_not_flag` の語が含まれない件数／件数。候補は**本文に現れる文字列だけ**を数える（現れない語は候補として無効） |
| 言い換え（合成データの量産、M7） | `lfm3` | `paraphrase.jsonl` ＋ `prompts/paraphrase-system.txt` | `must_include` をすべて含み、`must_not_include` を含まず、長さが元の `max_length_ratio` 倍以内 |
| 二択の判定（下書き用） | `lfm3` | `two-choice.jsonl` ＋ `prompts/two-choice-system.txt` | `expected` との一致件数。**人が読む下書きの材料にだけ使う** |
| 記録の要約の否定の回帰 | 両方 | `summarize-negation.jsonl` | `must_include` のいずれか1つ以上を含み、`must_not_include` を含まない。D-54 で両モデルが同じ取り違えをした箇所の回帰試験 |

## 実行

- 実行するスクリプトは**オーナーが sandbox の外で動かす**（行政の長と作業員は sandbox の中で、`127.0.0.1:11434` に届かない）。D-54 の計測に使った元のスクリプト（`cls.py`・`lfm3eval.py`）はオーナーが後でこのフォルダに移す。
- 1行＝1件の JSONL。各ファイルの先頭の `_comment` 行（`id` が `_` で始まる）は説明で、件数に数えない。
- 分類は `format: json` を使わず、ラベルの文字列だけを出させる（`prompts/classify-system.txt`）。候補出しは `format: json`。temperature は 0。
- 結果は `eval/local-llm/results/<日付>-<モデル>.json` に置く（件数・一致数・所要秒・モデルのタグ）。README に載せる数字はここから。

## 分類の5区分（**推測。D-54 の `cls.py` の区分と照合して直す**）

D-54 の計測で使った5区分の定義は本リポジトリにまだない。ここでは M4 の8項目と M10 の「待ち」に合わせて次の5つを置いた。`cls.py` と違えばこちらを直す。

| ラベル | 意味 | 近い M4 の項目 |
|---|---|---|
| `struggle` | つまずき・分からない・迷っている | つまずき、原因、未解決 |
| `tried` | 試したこと・いま進めている作業 | 試したこと |
| `learning` | 分かったこと・解決・次に活かすこと | 解決、学び |
| `decision` | 決めたこと・方針・判断の理由 | 判断の理由 |
| `waiting` | 人の返事待ち・確認待ち・人に聞くこと | 人に確認すべきこと |

D-54 で外れた2件（「考え始めた」＝`tried` と `struggle` の境、「待つ間は準備を進める」＝`waiting` と `tried` の境）は、そのまま境目の試験として入れてある（`C07`・`C08`）。

## 守ること

- データはすべて**合成**（架空の会社・人物・案件。`docs/requirements.md` §3 の設計に沿う）。実案件の語を入れない。
- 評価の結果で「実装済み」と書けるのは、このフォルダの件数で測ったものだけ（README には数字で載せる）。
- gate-runner への導入（候補出しの段階）とアプリへの導入（M6 の後の票）は、それぞれ法律の改正案・タスク票で別に決める。このフォルダは評価だけ。
