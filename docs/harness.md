# 夜間ハーネス＋朝刊（設計案。D-55③、D-37、D-45⑦）

- 作成：2026-11-04 21:5x JST（行政の長の案。オーナー未承認。法律に当たる部分は改正案の差分として別に提案する）
- 目的：オーナーが寝ている間に、**承認済みの票のキュー**を無人で回し、朝に「一晩で何が起き、何を確認してほしいか」を読める形にする。人の時間を計画・裁定・ユーザー役・提出物に集中させる（D-55 の「差は作業員の並行と夜間の運転で埋める」）
- 前提：VGDD の仕組みはそのまま使う。**夜間だから緩める規則は一つもない**。gate-runner（統合）・judge・Codex・フック・sandbox・権限ルールは昼と同じ。ハーネスは「行政の長の役を機械的に代行するスクリプト」であり、合否や採否を決めない

## 1. 一枚の絵

```
 前の晩（人）                         夜（無人）                                      朝（人）
 ┌──────────────┐    ┌──────────────────────────────────────────────┐    ┌──────────────┐
 │ 行政の長が    │    │ night-runner.sh（オーナー権限、sandbox の外、Z3 の bin）│    │ 朝刊を読む    │
 │ キューの案を  │    │  ①前点検 ②レーンに票を配る ③作業員を headless で起動 │    │ blocked の裁定│
 │ 書く         │──▶ │  ④結果の前検査 ⑤票を review にして申請 ⑥gate-runner の │──▶ │ 差し戻しの指示│
 │ オーナーが    │    │   結果を待つ ⑦次の票 … ⑧止める条件 ⑨summary.json      │    │ push         │
 │ Z3 に置いて承認│    │ gate-runner.sh（常駐。昼と同じ法律 p0.2.4 で統合）       │    │ 片付け        │
 └──────────────┘    │ morning-report.mjs（06:30。集計 → ローカル LLM → Claude） │    └──────────────┘
                     └──────────────────────────────────────────────┘
```

機関との対応（docs/governance.md §1）：night-runner は**行政の長の夜間の代行**（票を配る・申請する。実装しない・判定しない）。作業員は昼と同じ `worker`（headless の `claude -p`）。司法は gate-runner の中の judge・Codex（昼と同じ）。朝刊の「ローカル LLM」と「Claude」は**書記**であり、何も決めない（D-52）。

## 2. 票のキュー

- **置き場所**：`~/tsubuyaki-z3/night/queue.json`（Z3。オーナーだけが書ける）。行政の長は案を `docs/tasks/night-queue.proposed.json` に書き、オーナーが中身を見て Z3 に写す。**写した時点が承認**（D-37③）。行政がキューを書き換える経路はない
- **形**：

```json
{
  "schema": "vgdd.night-queue.v1",
  "date": "2026-11-04",
  "approved_by": "owner",
  "approved_at": "2026-11-04T23:20:00+09:00",
  "limits": { "parallel": 2, "max_tickets": 6, "until": "06:30", "max_judge_calls": 20,
              "max_tokens_per_ticket": 2000000, "max_tokens_total": 12000000, "min_free_gb": 3 },
  "tickets": [ "T-004", "T-006", "T-005", "T-007" ]
}
```

- **乗せられる票の条件**（runner が main の票を読んで機械的に確かめる。1つでも外れたら飛ばして朝刊に書く）：
  1. `status: ready`、または `in_progress` で差し戻し回数が上限（3）未満
  2. `requirements_source: ticket`、`unattended: true`（新しい欄。「オーナーの判断が要らない」をオーナーが票ごとに明示する。依存の追加・削除・push・削除を要する票、要件の変更を伴う票は `false`）
  3. `depends_on` の票がすべて `merged`（T-007 のような後始末の票は、前の票が夜のうちに統合されれば自動で順番が来る）
  4. `files_allowed` が、同時に動く他のレーンの票と重ならない（重なれば後に回す）
- **順番**：キューの並びのまま。D-55 の順（M10 → M6・M9 → M5・M12 → …）はオーナーが並べる

## 3. 並行数・費用・時間の上限（決定論的。超えたら新しい票を取らない）

| 上限 | 既定 | 根拠・測り方 |
|---|---|---|
| 並行の作業員 | 2（最大 4） | D-45「同時最大4」。夜は Max の5時間枠を朝まで持たせるため 2。`parallel` で変える |
| 1晩の票 | 6 | 1票 0.3〜0.7h ＋ 統合待ち。朝刊を読める量 |
| 時間 | 開始 23:30 ごろ〜 `until` 06:30。1票は `time_limit_min`＋10分で `claude -p` を打ち切る | D-37 の試験運転「最初の晩は1〜2時間」→ 初回は `until` を 01:30 にする |
| 作業員のトークン | 1票 200万（D-05）、1晩 1,200万 | `claude -p --output-format json` の `usage` を足す。超えた票は打ち切って差し戻し扱い |
| 司法の呼び出し | 1晩 20 回（judge＋Codex で1申請＝2〜3回 → 申請 7〜8件） | Z3 の `evidence/verdicts/` に今夜できたファイルを数える。D-46 の $150 の枠の中（1回 数円〜数十円の見込み。実測は朝刊に出す） |
| 空き容量 | 3GB 未満で停止 | 作業員1体の `npm ci` が約 0.5GB。レーンの worktree は統合後すぐ消す |
| 課金 | Max のサブスクリプションだけ（D-37⑥）。API キーには切り替えない | `claude -p` が利用上限の文言を返したら停止（D-36 の代替は朝に人が選ぶ） |

## 4. 1レーンの流れ（1票）

1. **worktree を作る**：runner が `git worktree add .claude/worktrees/night-T-NNN -b night/T-NNN main`。`.claude/worktrees/` の下なので、フックの閉じ込め（p0.2.0 OBS-013②：`agent_type` がなくても **cwd が `.claude/worktrees/` の下なら作業員として閉じ込める**）がそのまま効く。`baseRef` は main の HEAD
2. **作業員を起動**：`cd <worktree> && claude -p --agent worker --output-format json --max-turns 80 "<票のパス>を実装…"`。プロンプトは昼の行政の長が出すものと同じ型（票を読む・`npm ci`・files_allowed だけ・test/typecheck/lint・1コミット・報告の形）。**権限の ask（依存の追加・push・rm・npx）は無人では承認されず、拒否として作業員に返る**（fail-closed。D-37②）。`--max-turns` と OS の `timeout` で打ち切る
3. **結果の前検査**（runner。gate-runner の段階 1〜3 と同じ条件を先に機械で見て、無駄な差し戻しを減らす）：コミットが1つ以上ある／`git diff --name-only main...night/T-NNN` が `files_allowed` の中（p0.2.2 と同じ文字どおりの照合）／保護パスなし／秘密情報の形なし／`node_modules` があれば `npm run -s test` を1回。外れたら作業員の報告（`result` の文）を添えて**1回だけ**やり直し（同じ worktree）。2回目も外れたら票を `blocked` 相当として朝刊へ（票の status は触らず、runner の summary に書く）
4. **票を review にして main にコミット**：runner が `status: review` と §6 の1行（作業員の報告の要点、HEAD、テスト件数）を書き、`night-runner` の名でコミット（gate-runner が自分の記録をコミットするのと同じ形）。§2 は変えない（判定は main の票の §2。p0.2.1）
5. **main への追従は不要**（p0.3.1 の統合キュー、§4b）：作業ブランチは main から分岐したままでよい。gate-runner が申請ごとに最新の main と組み合わせた候補を作って検査する。runner は rebase も cherry-pick もしない。衝突（`needs_rebase`）になったときだけ、作業員に「main との衝突」を渡して1回だけ直させる
6. **申請**：`merge-requests/T-NNN.json` を置く（昼と同じ形。`requested_by: "night-runner"`）。統合キューにより**申請は複数同時に置ける**（票の status のコミットで main が進んでも申請は落ちない）。作業員も並行のまま
7. **結果**（夜は gate-runner を `--hold` で動かすので、合格しても統合はされない。p0.3.1）：
   - **合格（held）** → gate-runner が候補を Z3 の `held.jsonl` に記録する。worktree とブランチは**残す**（朝の `release.sh` が申請の SHA から組み直すため）。レーンに次の票
   - `rejected`（`in_progress`、judge か Codex の指摘）→ 票の §6 の gate-runner の行をそのまま作業員に渡して**1回だけ**やり直し（同じレーン、手順 2〜6）。2回目も落ちたらそのレーンは止め、朝刊の「確認してほしいこと」へ。差し戻しの回数は gate-runner が数える（上限 3、D-05）
   - `blocked`（judge と Codex が重大な指摘で分かれた、保護パス、上限）→ 何もしない。朝にオーナーが裁定（昼と同じ。p0.3.1 の `rule.sh`）
   - **朝**：オーナーが画面と判定を確かめ、`vgdd/scripts/release.sh T-NNN …` で統合する（約束9・11：1機能ごとにオーナーが見て選ぶ）。release.sh は今の main と申請の SHA から組み直し、夜に判定した候補と記録以外が一字一句同じこと、組み合わせた木の監査（sandbox の中）を確かめてから統合する
8. **記録**：各レーンの `claude -p` の JSON（`usage`・`result`・終了コード）を `~/tsubuyaki-z3/night/logs/<date>/T-NNN-<n>.json` に。票の本文以外の生のログはリポジトリに入れない

## 4b. 統合キュー（鎖をやめる。p0.3.1、オーナーの指示 2026-11-04 22:10）

これまでは、並行した票を `--ff-only` で順に統合するために、行政の長が「T-a → T-b → T-c」の鎖を1本の worktree に cherry-pick で積んで申請していた。この形には2つの弱点があった：①main が1コミットでも進む（票の status、法律、記録）と鎖全体が「main を含まない」で落ちる（OBS-019・OBS-024）②前の票が差し戻されると後ろの票も段階3で連鎖して落ちる。11/4 の夜だけで、この型の差し戻しが T-002〜T-008 で7回起きた。

**統合キュー**（法律 §3.1 の 2・10）では、各票は **main から分岐したまま**申請する（鎖で積まない。作業員の worktree のブランチをそのまま申請してよい）。gate-runner が申請ごとに：

1. 申請の SHA が main を含んでいれば従来どおり。含んでいなければ、一時 worktree で **最新の main に申請の SHA を merge した「候補のコミット」** を作る（`--no-ff`、コミットは一時 worktree の中だけ）。衝突すれば `needs_rebase` で差し戻す（files_allowed が重なる票が先に統合されたときだけ起きる）
2. 差分の範囲（files_allowed・保護パス・秘密情報）は申請の SHA の変更分（`main...<SHA>`）で見る。決定論的な監査・judge・Codex・セキュリティ審査は**候補の木**で行う（judge の `--base main` は候補の木でも「その票の変更分」になる）
3. 合格なら main に候補を **fast-forward** で統合する（候補は検査時の main を親に持つ。検査した木と統合される木が同じ。p0.3.0 の SHA の固定は保つ）。検査の途中で main が進んでいたら統合せず、次の周回で最新の main と組み合わせて検査し直す。夜（`--hold`）は統合せず `held.jsonl` に記録する
4. 1件統合するたびに、残りの申請は次の周回で最新の main と組み合わせて検査し直される。**前の票が差し戻されても後ろの票は止まらない**

費用の注意：候補ごとに `npm ci` と judge・Codex が走る。前の票の統合で候補が変わった票は、検査をやり直す分だけ司法の呼び出しが増える（§3 の上限で止まる）。

## 5. 止める条件（1つでも当たれば新しい票を取らず、動いている作業員は `time_limit_min` まで待って終える。summary に理由を書く）

| 条件 | 見方 |
|---|---|
| オーナーの停止 | `~/tsubuyaki-z3/night/STOP` がある |
| 時刻 | `until` を過ぎた |
| gate-runner が止まっている | pid ファイル／`pgrep -f gate-runner.sh` で見えない。**runner は gate-runner を起こさない**（起こすのはオーナー。別プロセスの独立を守る） |
| 違反の検知 | `gate_events.jsonl` に `main_advanced_outside_gate`（runner 自身の `night-runner` 名のコミット以外）が出た |
| 拒否の急増 | `tool_calls.jsonl` の直近 10 分の `deny` が 30 件を超えた（作業員が拒否に当たり続けている＝票の設計か法律の不具合。朝に人が見る） |
| 連続の失敗 | 2票続けて前検査か司法で落ちた |
| 容量 | 空きが `min_free_gb` 未満 |
| 利用上限 | `claude -p` の出力に利用上限・レート制限の文言、または非 0 の終了コードが 3 回続く |
| 予算 | 司法の呼び出し数・トークンの合計が §3 の上限に達した |

停止は「新しい票を取らない」だけで、**統合は gate-runner が法律どおりに続ける**（申請済みのものは判定される）。runner が gate-runner を止めることはない。

## 6. gate-runner との関係

- 役割の分離は昼と同じ：runner＝行政（配る・申請する）、gate-runner＝裁判所の執行（判定・統合）。**runner は merge しない。gate-runner は票を配らない**
- 共有するもの：`merge-requests/`（runner が置き、gate-runner が拾って `done/` に移す）、`gate_events.jsonl`（gate-runner が書き、runner が読む）、票の §6（gate-runner が差し戻しの理由を書き、runner が作業員に渡す）
- 統合キュー（§4b、p0.3.1）により、runner は申請を置くだけでよい。鎖・rebase・1件ずつの待ちは不要。差し戻し（`rejected`）と `needs_rebase`（衝突）だけを作業員に渡す
- 夜間の gate-runner は **`--hold`** で動かす（p0.3.1）：判定まで行い、合格した候補を Z3 の `held.jsonl` に記録して**統合しない**。統合は朝にオーナーが `release.sh` で行う。夜の worktree とブランチは release.sh が申請の SHA を読むまで残す
- git の設定の穴（OBS-033）：runner・gate-runner・release.sh は `core.hooksPath=/dev/null`・`core.fsmonitor=false` で git を呼び、`.git/config` を Z3 の基準値（`git-baseline.sh`）と照合する。作業員は `git config` を書き換えられない（フック p0.3.1）

## 7. 朝刊の作り方（06:30。`morning-report.mjs`。ローカル LLM と Claude は書記で、決めない）

1. **集計（決定論的、node）**：`gate_events.jsonl`（今夜の `merged`／`rejected`／`blocked`／`disagreement`／`local_llm_hints`）、`evidence/verdicts/*.json`（judge・Codex の判定と findings）、`verify-chain.mjs --summary-json`（フックの件数：agent_type 別の呼び出し・拒否）、`night/logs/`（`claude -p` の usage・所要）、`docs/tasks/_board.json`。→ `night/summary.json`（件数・ID・時刻だけ。理由の本文は票の §6 への参照）
2. **ローカル LLM（lfm3・qwen3:4b-instruct。D-54 の役割）**：①拒否の理由（`tool_calls.jsonl` の deny の `reason`）を**5区分に分類**（正当な拒否／誤検知／作業員の逸脱／法律の不具合の疑い／不明。`eval/local-llm/` の分類と同じ要領で、プロンプトは `eval/local-llm/prompts/`）②差し戻しの理由（§6 の gate-runner の行）の**1行の言い換え**。出力には必ず「ローカル LLM（モデル名）」と付け、**件数と分類は参考**（D-54：小さなモデルは同じ所で同じように間違う。否定の取り違えに注意）
3. **Claude（`claude -p`、サブスクリプション。Sonnet 相当。ツールなし）**：集計 JSON とローカル LLM の下書きだけを入力に、固定の見出しで朝刊を書く：
   - **一晩の結果**（着手／統合／差し戻し／blocked の件数、時間、トークン、司法の呼び出し数）
   - **統合された票**（ID・題・main の SHA・judge/Codex の判定）
   - **差し戻し・blocked と理由**（票 ID と §6 の行の引用。ローカル LLM の言い換えは「（ローカル LLM lfm3）」付き）
   - **法律・フックの気づき**（拒否の分類の件数、`main_advanced_outside_gate` の有無、OBS 候補）
   - **朝に確認してほしいこと**（blocked の裁定、連続の失敗、止まった理由、push の要否、worktree の片付け）
   - 規則：入力にない事実を書かない、ID を必ず引く、「〜ではない」を落とさない、判断（採否・合否）を書かない
4. **置き場所**：`~/tsubuyaki-z3/night/reports/<date>.md`（原本）。オーナーが読んで問題なければ `docs/night/<date>.md` に写してコミット（README と動画の材料。生のログ・秘密情報・実名は含めない前提で、写す前に人が見る）

## 8. 保証できないこと・限界（README に書く）

- 作業員は headless でも同じフックと sandbox の下で動くが、**`claude -p --agent worker` のフック入力に `agent_type` が入るかは未確認**。入らなくても `.claude/worktrees/` の下で動かすことで閉じ込めは効く（p0.2.0 の cwd の判定）。初回の試験運転（V8）で `tool_calls.jsonl` を見て確かめる
- runner は gate-runner と同じくオーナー権限のスクリプト。runner のバグで main が壊れる経路は「票の status のコミット」だけに限る（ソースは触らない）。`main_advanced_outside_gate` の検知では、author が `night-runner` で差分が `docs/tasks/T-*.md` だけのコミットを例外にしている（p0.3.1）。夜は `--hold` なので、main にコードが入る経路は朝の `release.sh` だけ
- Max の5時間枠の残量は API で読めない。利用上限の文言で止めるしかなく、止まった後の作業員の途中の作業は worktree に残る（朝に人が見る）
- 朝刊の文章は LLM の出力。数字は集計 JSON から人が照合できるようにする

## 9. 試験運転の計画（V8。最初の晩）

| # | 確認 | 期待 |
|---|---|---|
| V8-1 | `--dry-run` でキューの検査・レーンの割り当て・止める条件を表示だけ | 何も起動しない |
| V8-2 | 票1件、`parallel 1`、`until` 1時間後 | 作業員が実装 → 前検査 → 申請 → gate-runner が統合 |
| V8-3 | `tool_calls.jsonl` に作業員の呼び出しが worktree の cwd で残り、閉じ込めの拒否が効く | §8 の未確認を解消 |
| V8-4 | 差し戻し（故意に A 条件を満たさない票）→ 1回のやり直し → 2回目で止まる | 朝刊に「確認してほしいこと」 |
| V8-5 | `STOP` ファイルで止まる。gate-runner を止めても runner は merge しない | 停止の記録 |
| V8-6 | 朝刊が3段（集計・ローカル LLM・Claude）で生成され、数字が `summary.json` と一致する | 06:30 の cron か手動 |

## 10. 法律の改正（p0.3.1 として施行済み。69f3a12、2026-11-05 00:14。憲法審査は VIOLATES → 指摘に対応して CONSISTENT）

1. `docs/governance.md`：§1 の表に「行政の長・夜間の代行（night-runner）」「行政・作業員（夜間）」「書記（朝刊）」の行、§3.1 の 2・10 を統合キューに、§3.2 の事後検知に `night-runner` の例外、§11「夜間ハーネス」（本書への参照。`--hold` と `release.sh` の注つき）
2. `docs/tasks/README.md`：front matter に `unattended: true|false`（夜に無人で回してよいか。既定 false）
3. `vgdd/scripts/night-runner.sh`・`morning-report.mjs`（新設）、`gate-runner.sh`（統合キュー、`--hold`）、`release.sh`（朝の統合）、`rule.sh`（オーナーの裁定）、`git-baseline.sh`（`.git/config` の基準値。OBS-033）。実行用は `~/tsubuyaki-z3/bin/` にオーナーが写す。**夜間の運転は未試験（V8 で確かめる）**
4. フック `policy.mjs`：`git config` の書き換えを拒否（OBS-033）。閉じ込めは cwd の判定のまま（V8-3 で `agent_type` の有無を確かめる）
5. `docs/requirements.md` §10：夜間の運転に関する改正

## 更新履歴

| 日時 | 内容 |
|---|---|
| 2026-11-05 00:2x | p0.3.1 の施行に合わせて更新：§4 の 5〜7（追従は不要、申請は複数同時、夜は `--hold` で判定まで・朝に `release.sh`）、§4b 統合キュー、§6（`--hold`、git の設定の穴）、§8、§10 を施行済みに |
| 2026-11-04 21:5x | 初版（設計案）。D-55③の採用を受けて行政の長が起草 |
