# VGDD 本稼働の統治設計（governance）

- 作成：2026-11-03 16:11 JST（開催期間中に新規作成。D-47 の確認 16:04 から公式ドキュメントの確認を経て執筆）
- 状態：**設計案（オーナー承認待ち）。この文書の時点では何も実装していない**
- 根拠：D-44（攻めの拡張とフェーズ）、D-45（本稼働の方針）、D-46（機関ごとのエージェント構成）、D-47（立法補佐の修正：裁判所を別プロセスに、`vgdd/**` を保護、不一致の扱い、S1 が通らなければ見直し）。VGDD Phase 1 仕様 §3・§4・§7・§8
- 公式ドキュメントで確認したこと（2026-11-03、code.claude.com/docs）：
  - `settings.json` の PreToolUse フックは**サブエージェントのツール呼び出しにも毎回動く**。フック入力の `agent_type` にサブエージェントの `name` が入る
  - サブエージェントの `isolation: worktree` は既定で **`.claude/worktrees/<name>/`** に worktree を作り、ブランチは `worktree-<name>`、基点は既定で **origin の既定ブランチ（`worktree.baseRef: "fresh"`）**。`"head"` にすると手元の HEAD（未 push を含む）から分岐する
  - worktree の中では Bash は worktree で動き、main の checkout への Edit・Write・`git -C` 等の向け直しは Claude Code が拒否する（isolation の4つの検査）。`cp` やリダイレクトでの書き込みは検査の対象外で、権限と sandbox に任される
  - `.worktreeinclude` がなければ gitignore 済みの `.env.local` は worktree に**コピーされない**
  - 同時に動くサブエージェントの既定の上限は20（`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`）。バックグラウンドのサブエージェントはツールが少ない
  - Codex CLI の非対話実行：`codex exec`（プロンプトは引数または標準入力、`-` で標準入力を強制）、既定は読み取り専用の sandbox、`--output-schema <file>` で JSON Schema に沿った最終応答、`-o <path>` で最終メッセージをファイルに、`--ephemeral` で記録を残さない、`--skip-git-repo-check`。`--model` と `--cd` はこのページに記載なし（`codex exec --help` でオーナーが確認）

---

## 1. 機関とエージェントの一覧（D-46 の約14体）

| 機関 | 役 | 実体 | モデル | 課金 | 持てるツール・権限 | 入力 | 出力 |
|---|---|---|---|---|---|---|---|
| 立法 | オーナー | 人 | — | — | すべて（`.claude/`・`CLAUDE.md`・`vgdd/`・Z3 を書ける唯一の主体） | 法案、裁定の依頼 | 制定・改正・裁定、ask の承認 |
| 立法補佐 | Pro | デスクトップアプリ | Pro（Opus 5.5 等） | Pro | `preparation/`・`event_records/` の書き込み。`app/` は読むだけ | 証拠ストアの集計、設計案 | 法案の起草、改正案、点検の指摘 |
| 行政の長 | Max 本体 | このセッション（VS Code） | Fable／Opus 5.5（D-26） | Max | 全ツール。ただし保護パスは不可、`npm install`・push・`rm` は ask、**merge・gate-runner は不可** | フェーズの受け入れ基準、作業員の報告、司法の判定 | タスク票、worker の起動、統合の申請（`merge-requests/T-NNN.json`）、`docs/implementation-notes.md` |
| 行政・作業員 W1〜W4 | worker | `.claude/agents/worker.md`、`isolation: worktree`、同時最大4 | Opus 5.5（`model: opus`） | Max | Read・Edit・Write・Bash・Glob・Grep。Agent 不可。保護パス・`.env.local` 不可。ask は行政の長に申請 | 票1枚（パス）＋ worktree | 票のブランチへのコミット、報告（変更ファイル・テスト結果・逸脱） |
| 行政・テスト担当 | tester | `.claude/agents/tester.md`、`isolation: worktree` | Opus 5.5 | Max | worker と同じ。ただし `src/**/*.test.ts` と `e2e/**` だけ書ける（票の `files_allowed`） | 票の受け入れ条件 | 開発用テストのコミット、報告 |
| 司法 | judge | `.claude/agents/judge.md`（配置済み）＋ `vgdd/scripts/judge.sh` | Sonnet 5.5 | API キー（$150 の枠） | **ツールなし**。差分・要件・監査結果だけ | gate-runner が機械的に集めた入力 | `vgdd.verdict.v1` の JSON |
| 司法・別系統 | Codex judge | `vgdd/scripts/judge-codex.sh` → `codex exec`（読み取り専用） | Codex（オーナーの契約） | Codex | ツールなし相当（読み取り専用 sandbox、`--ephemeral`） | judge と同じ入力 | 同じスキーマの JSON（`--output-schema`） |
| 司法・セキュリティ | Codex security | `judge-codex.sh --security` | Codex | Codex | 同上 | 差分＋依存の変更＋M6・M9 の要件 | findings（severity・file・line） |
| 司法・憲法審査 | constitutional-review | `.claude/agents/constitutional-review.md`（ツールなし） | Sonnet 5.5 | API キー | ツールなし | 法律の改正案（settings・フック・gate-runner・CLAUDE.md の差分）＋ CLAUDE.md・要件 §10 | 「憲法に反しない／反する（箇所）」 |
| 司法・決定論的な監査 | スクリプト | gate-runner 内：`npm test`・`typecheck`・`lint`、差分の検査、秘密情報の grep、フックの記録 | — | — | — | ブランチ | 合否と出力の末尾 |
| ユーザー | 新人A・新人B・先輩C 役 | Playwright のシナリオ `e2e/personas/*.spec.ts`（人物ごと） | — | — | ブラウザ操作だけ。コードは読まない | 動いているアプリ | スクリーンショット・操作の記録・コンソールのエラー |
| ユーザー・評価 | user-evaluator | `vgdd/scripts/user-eval.sh` → Claude API（SDK、オーナーの環境で実行） | Sonnet 5.5 | API キー | ツールなし。画像と記録だけ | 人物・シナリオ・スクリーンショット・記録 | 「再現手順・期待・実際・重さ」の一覧（D-43 の形） |
| ユーザー・UX 審査 | Codex UX | `judge-codex.sh --ux` | Codex | Codex | 読み取り専用 | スクリーンショットと手順 | 使いにくさの指摘 |
| 裁判所の執行 | gate-runner | `vgdd/scripts/gate-runner.sh`（原本）→ `~/tsubuyaki-z3/bin/gate-runner.sh`（実行用。オーナーがコピー） | — | — | **sandbox の外、オーナーの権限**。Z3 に書ける。main に統合できる唯一の主体 | `merge-requests/` の申請、票、ブランチ | 判定（Z3）、統合、票の更新、`docs/tasks/_board.json` |
| 行政の長・夜間の代行 | night-runner | `vgdd/scripts/night-runner.sh`（原本）→ `~/tsubuyaki-z3/bin/`（D-55③。`docs/harness.md`） | —（スクリプト） | — | **sandbox の外、オーナーの権限**。承認済みのキュー（Z3）を読み、作業員を headless で起こし、票の status と §6 だけを main にコミットし、申請を置く。**実装しない・判定しない・merge しない** | `~/tsubuyaki-z3/night/queue.json`、票、`gate_events.jsonl` | worktree と `night/T-NNN` ブランチ、`merge-requests/`、`night/summary-<date>.json` |
| 行政・作業員（夜間） | worker（headless） | `claude -p --agent worker`。cwd は `.claude/worktrees/night-T-NNN`（フックの閉じ込めは cwd で効く。p0.2.0 OBS-013②） | Opus 5.5 | Max | 昼と同じ。ask は無人では拒否（fail-closed） | 票1枚 | ブランチへのコミット、報告（JSON） |
| 書記（朝刊） | morning-report | `vgdd/scripts/morning-report.mjs`：集計（決定論的）→ ローカル LLM（lfm3・qwen3:4b-instruct。分類・言い換え）→ Claude（`claude -p`。文章） | lfm3／Sonnet 相当 | Max（Claude）、手元（ローカル） | ツールなし。**決めない**（D-52）。入力は Z3 の集計だけ | 一晩の記録 | `night/reports/<date>.md`（人が読んで `docs/night/` に写す） |

同時に動くのは「作業員 最大4＋テスト担当1」。司法は判定のときだけ短時間。ユーザー役は区切りごと。gate-runner は常駐（ポーリング）だが、判定のときだけ API を使う。

### 1.1 なぜ裁判所を別プロセスにするか（D-47①）

行政（Max とそのサブエージェント）は sandbox の中で動き、Z3 に書けない。設計の初版では merge-gate を行政の sandbox の中で動かしていたため、判定を行政が書ける場所（`data/verdicts/`）に置くことになり、**判定とダッシュボードの数字を行政が書き換えられた**。gate-runner をオーナーの権限で sandbox の外に置くと、判定は Z3 に残り、統合も行政の手を離れる。行政は申請を置くだけ。

---

## 2. 行政の進め方

### 2.1 タスク票（`docs/tasks/T-NNN-<slug>.md`）

形式は `docs/tasks/README.md`。front matter に `id`・`status`・`requirements`（受け入れ基準 ID）・`files_allowed`（触ってよいファイル）・`files_forbidden`・`estimate_h`・`time_limit_min`（上限時間。worker はこれを超えたら途中でも報告して止まる）・`branch`・`worker`。本文に目的・受け入れ条件（目に見える形）・開発用テストの観点・手順の案・統合審査・記録。

### 2.2 1票の流れ

```
① 行政の長：フェーズの受け入れ基準を票に分ける。files_allowed が重ならないように分け、
   同じファイルを触る票は「差し込み口」を先に作る票（T-000 型）で分離する（§8）
② 行政の長：Agent ツールで worker を起動（isolation: worktree、票のパスとブランチ名を渡す）。同時最大4。
   行政の長自身は実装しない（CLAUDE.md の約束に追記する）
③ worker：worktree の task/T-NNN ブランチで実装 → 開発用テスト → npm test / typecheck / lint → コミット →
   報告（変更ファイル、テスト件数、逸脱、残課題）。files_allowed の外は触らない。time_limit_min を超えたら止めて報告
④ tester（任意）：同じ票から独立に開発用テストを書く。worker と別の worktree
⑤ 行政の長：報告を読み、票を review にして merge-requests/T-NNN.json を置く（Write ツール）。
   内容：票 ID、ブランチ、HEAD の SHA、要件 ID、worker 名、申請時刻
⑥ gate-runner（sandbox の外）：申請を拾い、§3 の法律で判定し、合格なら main に統合。票の status と §6 を更新。
   不合格なら票を in_progress に戻し、findings を票に貼る。行政の長はそれを読んで worker にやり直させる（差し戻し3回まで。D-05）
⑦ ユーザー役・Pro：フェーズの区切りで画面を評価 → 不具合は新しい票に
```

### 2.3 worktree の扱い（公式ドキュメントの確認結果と、必要な法律の変更）

- **置き場所**：既定の `.claude/worktrees/<name>/` は、いまの法律では `.claude/**` が保護パス（権限 deny・sandbox の denyWrite・フック）なので、**worker が自分の worktree に書けない**。対策は2つ。
  - **案 A（オーナー承認 2026-11-03）**：
    - **フック p0.2.0**：「`.claude/` はすべて保護。`.claude/worktrees/` だけ例外。その例外の中（各 worktree）の `.claude/` のコピーは保護」の方式。つまり `<root>/.claude/**` は拒否、ただし `<root>/.claude/worktrees/<name>/**` は許可、さらに `<root>/.claude/worktrees/<name>/.claude/**` と `…/CLAUDE.md`・`…/.github/**`・`…/vgdd/**`・`…/docs/tasks/_board.json` は拒否
    - **権限ルールの deny**：`.claude/` 全体の deny は worktree への Edit・Write も止めてしまうため、具体名に絞る：`settings.json`・`settings.local.json`・`agents/**`・`skills/**`・`hooks/**`・`commands/**`・`output-styles/**`・`rules/**`（それぞれ `.claude/…` と `**/.claude/…`）。sandbox の denyWrite も同じ一覧
    - 公式ドキュメントは「`.claude` の設定ファイルは sandbox の中でも書き込み拒否のまま」としている
  - 案 B（不採用）：`WorktreeCreate` フックで worktree をリポジトリの外に作る。保護は変えずに済むが、フックの追加と作業ディレクトリの扱いの確認が増える
- **基点**：`worktree.baseRef` を **`"head"`** にする。既定の `"fresh"` は origin の main から分岐するため、未 push のコミットが worktree に入らない（いまは main が origin より先行している）
- **worktree の `.claude/settings.json`**：リポジトリのコピーで、サブエージェントは設定を main の checkout から読むので効かない。ただし統合すると main の設定が変わるため、gate-runner は差分に `.claude/**` が含まれていれば拒否する
- **`.env.local`**：`.worktreeinclude` を置かない。worker は API キーを持たない（テストは mock、M4 は demo モード）
- **同時数**：起動時に `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=5`（作業員4＋テスト担当1）。worker は前面で起こす（バックグラウンドはツールが少ない）
- **main への追従（2026-11-03 18:04 に判明、オーナー決定）**：main が進んで作業ブランチが main を含まなくなったとき、作業員の worktree で `git rebase main` を実行すると、main の変更に `vgdd/**`・`.claude/agents/**` が含まれていれば sandbox の denyWrite に止まる（`unable to unlink old 'vgdd/…': Operation not permitted`。衝突ではない。T-000 の再申請で確認）。行政の長も同じ sandbox の中なので同じ。**標準の手順は「新しい worktree ＋ cherry-pick」**：行政の長が新しい worker を `isolation: worktree`（`baseRef: head` で main の HEAD から作られる）で起こし、元のコミットを `git cherry-pick <sha>` させる（`vgdd/` を書かない経路）。新しい HEAD で申請し、旧 worktree とブランチはオーナーが片付ける

### 2.4 S1：V7 の試験計画（フックと sandbox がサブエージェントにも効くか。D-42・D-47④の条件）

V6 と同じ方法（実際に試して「保証できる／できない」を記録）。worker を1体、`isolation: worktree` で起こし、次を順に試させる。worker には「結果をそのまま報告し、回避や再試行をしない。中身を表示しない」と指示する。

| # | 試すこと（worktree の中で） | 期待 | 確認する場所 |
|---|---|---|---|
| V7-1 | Write で `src/lib/_v7_probe.ts` を作る（許可されるべき） | 成功 | worker の報告、worktree の中身 |
| V7-2 | Edit で worktree 内の `.claude/settings.json` を書き換える | 拒否（権限 deny。案 A なら設定ファイルの deny） | 報告、Z3 の記録に `agent_type: worker` と deny |
| V7-3 | Bash `wc -c /Users/…/app/.env.local`（main の checkout の絶対パス。中身は出さない） | 拒否（sandbox の denyRead、または isolation の検査） | 報告 |
| V7-4 | Bash `echo probe >> CLAUDE.md`（worktree 内の相対パス） | p0.1.2 では**通る見込み**（保護は main の絶対パスだけ）。p0.2.0 で塞ぐ | 報告。通れば「保証できない（p0.2.0 で対応）」と記録 |
| V7-5 | Bash `git -C /Users/…/app status`（main への向け直し） | 拒否（フック p0.1.2 と isolation の検査の両方） | 報告 |
| V7-6 | `git commit` を worktree のブランチに作る | 成功（共有の `.git` への書き込みは sandbox が許す） | `git log task/…` |
| V7-7 | Z3 の記録に、worker の呼び出しが `agent_type`・`cwd`（worktree のパス）・`git_branch` 付きで残っている | 残る | オーナーが `verify-chain.mjs` で確認 |

通らなければ（特に V7-1 が拒否、または V7-2・V7-3 が通る）、その時点で設計を見直す（D-47④）。

---

## 3. 統合の法律

### 3.1 条件（gate-runner が順に検査する。1つでも落ちれば統合しない）

1. 申請（`merge-requests/T-NNN.json`）の票が存在し、`status: review`、ブランチの HEAD が申請の SHA と一致する
2. **統合キュー**（p0.3.1 案、D-55③）：ブランチが main を含んでいればそのまま。含んでいなければ、gate-runner が一時 worktree で **main に申請の SHA を試しに merge**（`--no-ff`、コミットは一時 worktree の中だけ）して「候補のコミット」を作る。衝突すれば `needs_rebase` で差し戻す。以後の検査・判定（3〜9）は候補のコミットに対して行い、差分の範囲（3）は `main...<申請の SHA>` で見る。**鎖で積まなくてよい**：各票は main から分岐し、前の票が止まっても後ろの票は止まらない
3. `git diff main...task/T-NNN --name-only` が票の `files_allowed` の中だけ。**`.claude/**`・`CLAUDE.md`・`.github/**`・`vgdd/**`・`docs/requirements.md`・`merge-requests/**` が含まれていれば即拒否**（憲法の保護）
4. 差分に秘密情報らしい文字列・実名の形がない（既存の push 前の grep と同じ。Z3 の実名リストも照合）
5. gate 用の一時 worktree で `npm ci`（lockfile に変更があれば拒否）→ `npm test` → `npm run typecheck` → `npm run lint`（決定論的な監査）
6. `judge.sh --req <requirements> --base main --out ~/tsubuyaki-z3/evidence/verdicts/` → `final_verdict: APPROVED`
7. `judge-codex.sh --req … --base main`（同じ入力）→ APPROVED
8. judge と Codex の不一致（D-47③）：**critical・major の判断が分かれたときだけ** `blocked` にしてオーナーが裁定。minor だけの違いなら、厳しい側の指摘を票の §6 に残して統合する。不一致の件数を Z3 に記録する
9. 票が `security_review: true`（M6・M9・依存の変更）なら `judge-codex.sh --security` も APPROVED であること
10. すべて合格 → gate-runner が **main の checkout で `git merge --ff-only <検査した候補のコミット>`**（候補は main を親に持つので常に fast-forward。検査した木と統合される木が同じ。p0.3.0 の SHA の固定はそのまま）→ 票の `status: merged`、§6 に判定 ID と時刻を追記して gate-runner の名でコミット → 申請を `merge-requests/done/` に移す → `docs/tasks/_board.json` を更新。**1件統合するたびに、残りの申請は次の周回で最新の main と組み合わせて 2〜10 をやり直す**（前の票の統合で候補が変わるため。files_allowed が重ならなければ衝突しない）

### 3.2 エージェントが main に直接統合できないことの強制（3層）

| 層 | 仕組み |
|---|---|
| 権限ルール | `Bash(git merge *)`・`Bash(gh pr merge *)`・`Bash(git push --force*)` は deny（いまもある）。`git push` は ask |
| フック p0.2.0 | Bash の `git merge`・`git rebase` を main 上で実行する形、`git checkout main`・`git switch main` に続く書き込み、`git branch -f main`・`git update-ref refs/heads/main` を拒否。worktree の中からの `git -C <main>` 等は isolation の検査も拒否 |
| sandbox | main の checkout の `.git` は共有なので git 自体は動く。だからこそフックと権限で `main` への参照更新を止める |
| 事後の検知 | gate-runner は申請の処理前に `git log main` を見て、自分の統合以外のコミットが main に増えていれば**警告を Z3 に書き、オーナーに通知**（違反の検知。防ぐのは上の3層）。例外は author が `gate-runner` と **`night-runner`**（夜間ハーネスの票の status のコミットだけ。差分が `docs/tasks/T-*.md` 以外に及べば例外にしない。D-55③） |

限界：Bash の文字列照合は回避できる余地が残る（V6 の限界と同じ）。`main` の保護は「フック＋権限＋事後検知」で、OS レベルの保証ではない。README に書く。

---

## 4. 司法

### 4.1 judge.sh に Codex の判定を足す

- `vgdd/scripts/judge.sh` の入力の組み立て（要件の行・監査の結果・差分）を関数に切り出し、`judge-codex.sh` が**同じ入力の文字列**を使う（情報の独立：行政の説明文は含めない）
- 呼び出し（非対話、読み取り専用、記録を残さない）：

```bash
printf '%s' "$INPUT" | codex exec - \
  --output-schema vgdd/schemas/verdict.schema.json \
  -o "$OUT_FILE" --ephemeral --skip-git-repo-check
```

  - `vgdd/schemas/verdict.schema.json` は `vgdd.verdict.v1` の JSON Schema（judge.md のスキーマと同じ）。Codex の最終応答がこれに沿う
  - モデルの指定と作業ディレクトリの指定は、公式ページに記載がなかったため **`codex exec --help` でオーナーが確認**してスクリプトに入れる
  - 読み取り専用 sandbox が既定。差分は入力に含めるので、Codex はリポジトリを読まなくてよい
- 出力の処理は judge.sh と同じ（JSON の取り出し、監査不合格時の上書き、Z3 への保存）
- 費用：Codex はオーナーの契約。1票あたり 1〜2 回の呼び出し

### 4.2 セキュリティ審査（Codex）の起動条件

次のいずれかで gate-runner が `judge-codex.sh --security` を追加で回す：①票の `security_review: true`（M6 機密検査、M9 共有、M10-3 の下書きの検査、API の認可に触れる票）②差分に `package.json`・`package-lock.json` の変更がある ③差分に `src/app/api/**` の新しいルート、または `child_process`・`eval`・`fetch(` の新規使用がある。観点：入力の検証、認可（他人のセッションに触れないか）、秘密情報の扱い、依存の脆弱性（`npm audit` の結果を入力に添える）。

### 4.3 憲法審査（Claude、ツールなし）の起動条件

法律の改正のときだけ：`.claude/settings.json`・フック・gate-runner・judge*.sh・CLAUDE.md・`docs/requirements.md` §10 の差分。オーナーが `vgdd/scripts/review-constitution.sh <diff>` を実行し、`constitutional-review` サブエージェント（`claude -p --agent constitutional-review`）に差分と CLAUDE.md・要件 §10・VGDD 仕様 §3 の規則を渡す。出力は「反しない／反する（どの約束に、どの行が）」。オーナーの承認の前段。

---

## 5. ユーザー役（Playwright）

```
① オーナー：npx playwright install chromium（ブラウザ本体の取得は sandbox の外）。devDependency の追加は承認制
② シナリオ：e2e/personas/newcomer-a.spec.ts・newcomer-b.spec.ts・senior-c.spec.ts
   各シナリオは人物の目的に沿って画面だけを操作（例：新人A が W1 を開始→メモ→終了→整理→承認）。
   各ステップでスクリーンショットと操作の記録（何を押し、何が表示されたか、コンソールのエラー）を e2e/output/<persona>/ に保存
③ 実行：オーナーが npm run e2e（開発サーバーが動いている状態、sandbox の外）
④ 評価：vgdd/scripts/user-eval.sh <persona> が、スクリーンショット（画像）と記録を Claude API（Sonnet 5.5、オーナーの API キー）に渡し、
   「再現手順・期待・実際・重さ（high/mid/low）」の一覧を e2e/reports/<日時>-<persona>.md に書く（D-43 の形）。コードは渡さない
⑤ Codex UX 審査：同じスクリーンショットと手順を judge-codex.sh --ux に渡し、使いにくさの指摘を追加
⑥ オーナー：報告を読み、採用するものを票にする（行政の長に渡す）
```

- Playwright のテストは **sandbox の中では動かない**（ブラウザの起動とポート）。行政はシナリオのコードを書くだけ。実行と評価はオーナー
- 要件 §10「作らない」から Playwright を外す改正（D-46）が必要。開発時のみの依存

---

## 6. 法律の改正案（settings.json の差分。反映はオーナー）

```diff
 {
   "permissions": {
     "additionalDirectories": ["../preparation"],
     "blockWritesOutsideWorkingDirectories": true,
     "deny": [
       "Edit(../preparation/**)", "Write(../preparation/**)",
       "Edit(../event_records/**)", "Write(../event_records/**)",
       "Edit(~/tsubuyaki-worklog/preparation/**)", "Write(~/tsubuyaki-worklog/preparation/**)",
       "Edit(~/tsubuyaki-worklog/event_records/**)", "Write(~/tsubuyaki-worklog/event_records/**)",
-      "Edit(.claude/**)", "Write(.claude/**)",
+      "Edit(.claude/settings.json)", "Write(.claude/settings.json)",
+      "Edit(.claude/settings.local.json)", "Write(.claude/settings.local.json)",
+      "Edit(.claude/agents/**)", "Write(.claude/agents/**)",
+      "Edit(.claude/skills/**)", "Write(.claude/skills/**)",
+      "Edit(.claude/hooks/**)", "Write(.claude/hooks/**)",
+      "Edit(.claude/commands/**)", "Write(.claude/commands/**)",
+      "Edit(.claude/output-styles/**)", "Write(.claude/output-styles/**)",
+      "Edit(.claude/rules/**)", "Write(.claude/rules/**)",
+      "Edit(**/.claude/settings.json)", "Write(**/.claude/settings.json)",
+      "Edit(**/.claude/settings.local.json)", "Write(**/.claude/settings.local.json)",
+      "Edit(**/.claude/agents/**)", "Write(**/.claude/agents/**)",
+      "Edit(**/.claude/skills/**)", "Write(**/.claude/skills/**)",
+      "Edit(**/.claude/hooks/**)", "Write(**/.claude/hooks/**)",
+      "Edit(**/.claude/commands/**)", "Write(**/.claude/commands/**)",
+      "Edit(**/.claude/output-styles/**)", "Write(**/.claude/output-styles/**)",
+      "Edit(**/.claude/rules/**)", "Write(**/.claude/rules/**)",
+      "Edit(**/CLAUDE.md)", "Write(**/CLAUDE.md)",
       "Edit(CLAUDE.md)", "Write(CLAUDE.md)",
+      "Edit(vgdd/**)", "Write(vgdd/**)",
+      "Edit(**/vgdd/**)", "Write(**/vgdd/**)",
+      "Edit(docs/tasks/_board.json)", "Write(docs/tasks/_board.json)",
+      "Edit(**/docs/tasks/_board.json)", "Write(**/docs/tasks/_board.json)",
       "Read(~/tsubuyaki-z3/**)", "Edit(~/tsubuyaki-z3/**)", "Write(~/tsubuyaki-z3/**)",
       "Edit(.github/**)", "Write(.github/**)",
+      "Edit(**/.github/**)", "Write(**/.github/**)",
       "Read(.env.local)", "Read(**/.env.local)",
       "Bash(git merge *)", "Bash(gh pr merge *)", "Bash(git push --force*)", "Bash(git push -f *)", "Bash(sudo *)",
       "Edit(~/.claude/settings.json)", "Write(~/.claude/settings.json)",
       "Edit(~/.claude/settings.local.json)", "Write(~/.claude/settings.local.json)",
       "Edit(~/.claude/hooks/**)", "Write(~/.claude/hooks/**)",
       "Edit(~/.claude.json)", "Write(~/.claude.json)"
     ],
     "ask": [
       "Bash(rm *)", "Bash(git rm *)",
       "Bash(npm install *)", "Bash(npm i *)", "Bash(npm uninstall *)", "Bash(npx *)",
       "Bash(git push *)",
       "Edit(package.json)", "Write(package.json)", "Edit(package-lock.json)", "Write(package-lock.json)"
     ],
+    "allow": [
+      "Bash(npx --no-install *)"
+    ]
   },
   "sandbox": {
     "enabled": true,
+    "autoAllowBashIfSandboxed": true,
     "allowUnsandboxedCommands": false,
     "failIfUnavailable": true,
     "filesystem": {
-      "denyWrite": ["../preparation", "../event_records", "~/tsubuyaki-z3", "CLAUDE.md", ".claude", ".github",
+      "denyWrite": ["../preparation", "../event_records", "~/tsubuyaki-z3", "CLAUDE.md",
+                    ".claude/settings.json", ".claude/settings.local.json", ".claude/agents", ".claude/skills", ".claude/hooks",
+                    ".claude/commands", ".claude/output-styles", ".claude/rules",
+                    ".github", "vgdd", "docs/tasks/_board.json",
                     "~/.claude/settings.json", "~/.claude/settings.local.json", "~/.claude/hooks", "~/.claude.json"],
       "denyRead": ["~/tsubuyaki-z3", ".env.local"]
     },
     "network": { "allowedDomains": ["registry.npmjs.org", "api.anthropic.com", "github.com", "code.claude.com"] }
   },
+  "worktree": { "baseRef": "head" },
   "hooks": { "PreToolUse": [ { "matcher": "*", "hooks": [ { "type": "command", "command": "node ~/tsubuyaki-z3/hooks/policy.mjs", "timeout": 10, "onFailure": "block" } ] } ] }
 }
```

要点：①権限ルールと sandbox の `.claude/` の保護を具体名（設定・agents・skills・hooks・commands・output-styles・rules）に絞り、worktree（`.claude/worktrees/`）への書き込みを通す。フックは「`.claude/` 全体を保護、`worktrees/` だけ例外、例外の中のコピーは保護」②`vgdd/**` と `docs/tasks/_board.json`（gate-runner だけが書く）を保護パスに（D-47②）③`**/` 付きで worktree の中のコピーも deny ④`npx` は ask のまま。許可は `npx --no-install *` だけ（オーナー決定）⑤`worktree.baseRef: "head"`。

起動時の環境変数（オーナー）：`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS=5`、`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`（worker を前面で待つ）、`VGDD_MODEL`（手動セッションのモデル名）。

フック p0.2.0 の変更点（原本 `vgdd/hooks/policy.mjs`。**p0.2.0 を入れる前に、必要な原本をすべて書き終える**：D-47②）：
1. `.claude/` の保護を「**`.claude/` はすべて保護、`.claude/worktrees/` だけ例外、例外の中の `.claude/` のコピーは保護**」にする。あわせて、どの worktree の中でも相対パスが `CLAUDE.md`・`.github/`・`vgdd/`・`docs/tasks/_board.json`・`merge-requests/done/` に当たれば拒否。`.claude/worktrees/<name>/src/...` は許可
2. `vgdd/**` と `docs/tasks/_board.json` を保護パスに（`_board.json` は gate-runner だけが書く）
3. main への統合・参照更新の拒否（§3.2）
4. 記録に `agent_type`・`agent_id`（入力にあれば）・`cwd` を追加。`verify-chain.mjs --summary-json` で agent_type 別の件数を出す
5. `merge-requests/*.json` は行政の長だけが書ける（`agent_type` が空＝本体のときだけ許可。worker からは拒否）

---

## 7. 統治ダッシュボード（アプリ内 `/governance`）

- **入力は集計だけ。生のログは出さない**（13 §4、D-45⑥）
  - `src/lib/governance-summary.json`：オーナーが `node ~/tsubuyaki-z3/hooks/verify-chain.mjs --summary-json > …` で書き出し、人が確認してコミット。中身は件数のみ：期間、セッション数、agent_type 別の呼び出し数・拒否数、拒否の種類別（保護パス／Z3／git の向け直し／その他）、チェーンの検証結果（OK/NG）
  - `docs/tasks/_board.json`：**gate-runner だけが書く保護パス**（権限 deny・sandbox・フック p0.2.0。行政は読むだけ）。票ごとの `status`、差し戻し回数、judge・Codex の判定、不一致の有無、統合日時。理由の本文は含めない（票の §6 にある）
- **画面**：上に数字のタイル（エージェント数、操作数、拒否、差し戻し、自動統合、不一致→裁定）。下に票の盤（ready／in_progress／review／merged／blocked の列）。「最後に集計した日時」と「生のログは公開していない」の注記
- **実装**：P5（11/7）の票にする。見込み 1h。デモ動画の最後と README の「Claude の活用」の材料

---

## 8. 最初のタスク票（M4 の提案3件。触るファイルが重ならないように）

3件はいずれも S-2（`SessionView.tsx`）に差し込むため、そのままだと同じファイルを触る。**行政の長が先に「差し込み口」を作る票 T-000** を1つ入れ、3件は自分の新しいファイルだけを書く形にする。

| 票 | 内容 | files_allowed | 並行 |
|---|---|---|---|
| T-000（行政の長、0.2h） | `SessionView.tsx` に3つの差し込み口を作る：`<PreviousSummary …/>`・`<SummaryActions …/>`・`useNoteReplay(...)`。それぞれ何もしない実装（null を返す）で先に統合 | `src/components/SessionView.tsx`、`src/components/PreviousSummary.tsx`、`src/components/SummaryActions.tsx`、`src/lib/use-note-replay.ts` | 先行 |
| T-001 前回との比較 | `PreviousSummary.tsx` の中身、`sessions.ts` の前回の取得、`GET /api/sessions/[id]` の `previous` | `src/components/PreviousSummary.tsx`、`src/lib/sessions.ts`、`src/lib/sessions.test.ts`、`src/app/api/sessions/[id]/route.ts` | T-002・T-003 と並行可 |
| T-002 Markdown でコピー | `summary-markdown.ts`・`CopyButton.tsx`・`SummaryActions.tsx` の中身 | `src/lib/summary-markdown.ts`、`src/lib/summary-markdown.test.ts`、`src/components/CopyButton.tsx`、`src/components/SummaryActions.tsx` | 並行可 |
| T-003 待ち時間の演出 | `use-note-replay.ts` の中身（強調する番号の計算と interval）。`SessionView` は T-000 で `li` に class を渡す口を作ってある | `src/lib/use-note-replay.ts`、`src/lib/use-note-replay.test.ts` | 並行可 |

票の本文は `docs/tasks/T-00{1,2,3}-*.md`（この設計に合わせて `files_allowed` を更新）。T-000 は本稼働の S5 で行政の長が最初に作る。

---

## 9. 危険と限界

| 項目 | 内容 | 対策・書き方 |
|---|---|---|
| Max の上限 | 作業員4体が同じサブスクリプションを使う。5時間の枠を早く使い切る | 同時数は票の大きさで調整（小さい票は2体まで）。上限に達したら D-36 の順（コード以外の作業 → API キーで Claude Code → Pro） |
| 統合の衝突 | 同じファイルを触る票が並ぶと ff-only で統合できない | `files_allowed` を重ねない。差し込み口の票（T-000 型）で分離。worker は申請前に main を取り込む（rebase）。衝突したら gate-runner が `needs_rebase` で返す |
| 費用の上限 | 司法とユーザー役は API キー（$150 の枠。D-46）。1票あたり judge 1〜2回（数円）、user-eval は画像つきで1回数十円 | gate-runner が Z3 に累計トークンを記録し、$120 で警告、$150 で司法を止めてオーナーに通知（決定論的な上限） |
| フックの文字列照合 | パスの分割・広いグロブ・`main` への参照更新の別表現は通りうる | sandbox と isolation の検査で補う。main は事後検知も入れる。保証できない部分として README に書く |
| 裁判所の独立 | gate-runner はオーナーの権限で動く。オーナーが止めれば統合は止まる（意図どおり）。judge は同じ Claude 系統 | Codex（別系統）との一致を条件に。両者が同じ見落としをする可能性は残る |
| 行政の長の自制 | 「自分では実装しない」はプロンプト上の約束で、強制ではない | 証拠ストアの agent_type 別の件数で、本体の Edit・Write が増えていないかをダッシュボードで見せる |
| worktree の設定コピー | worktree 内の `.claude/settings.json` は効かないが、統合すれば main に入る | gate-runner が `.claude/**` の差分を即拒否 |
| ユーザー役の自動化 | Playwright は操作まで。「使いにくさ」の判断は評価エージェントと Pro | 評価は推定であることを報告に明記 |
| 夜間運転 | フックの失敗で全操作が止まる（V6 #4）。gate-runner が止まれば申請が溜まる | 朝に Z3 の「記録が途切れた時刻」と `merge-requests/` の残りを見る |
| 保証できないこと | ①Bash の文字列照合の回避 ②人が承認した操作 ③Z3 の存在の秘匿 ④`main` への直接更新の OS レベルの禁止 ⑤判定の正しさ（LLM） | README の「VGDD の実装状況」に V6・V7 の結果とともに書く |

---

## 10. 整備の手順（承認後。約3h）

| # | 作業 | 見込み | 担当 |
|---|---|---|---|
| S1 | V7（§2.4）。worker 1体で7項目。結果を `docs/vgdd-status.md` に | 0.5h | Max（起動）＋オーナー（Z3 の確認） |
| S2 | 原本を書く：`vgdd/hooks/policy.mjs` p0.2.0、`vgdd/scripts/gate-runner.sh`、`judge-codex.sh`、`vgdd/schemas/verdict.schema.json`、`vgdd/agents/worker.md`・`tester.md`・`constitutional-review.md`、`verify-chain.mjs --summary-json`、`.gitignore` に `merge-requests/`。**p0.2.0 の有効化はこの後** | 1.2h | Max（原本）→ オーナー（Z3・`.claude/` に配置、settings の反映） |
| S3 | T-000（差し込み口）を行政の長が作り、申請 → gate-runner で初回の統合（法律の試運転） | 0.3h | Max＋gate-runner |
| S4 | T-001〜T-003 を worker 3体で並行 → 申請 → 統合 | 0.3h（＋票の実装 約1.1h は MVP の枠） | 行政の長 |
| S5 | Playwright の導入（承認）とペルソナ1本、`user-eval.sh` | 0.5h | Max＋オーナー |
| S6 | `/governance` は P5 の票 | — | — |

## 11. 夜間ハーネス＋朝刊（D-55③。設計は `docs/harness.md`）

- **行政の長の夜間の代行**：`night-runner.sh`（オーナー権限、sandbox の外）が、オーナーが Z3 に置いて承認したキュー（`~/tsubuyaki-z3/night/queue.json`。写した時点が承認。D-37③）の順に、`unattended: true` の票だけを配る。実装は昼と同じ `worker`（headless、cwd は `.claude/worktrees/night-T-NNN`）。判定と統合は gate-runner（昼と同じ法律）。**夜間だから緩める規則はない**
- **runner が main に書けるもの**：票の `status` と §6 の行だけ（`night-runner` の名でコミット）。§2（受け入れ条件）は触らない。ソースに触らない。merge・push はしない
- **統合キュー**（§3.1 の 2・10）：各票は main から分岐したまま申請する（鎖で積まない）。gate-runner が申請ごとに「最新の main ＋ 申請の SHA」の候補を一時 worktree で作って検査・判定し、合格なら候補を fast-forward で統合する。1件統合するたびに残りは最新の main と組み合わせて検査し直す。**前の票が差し戻されても後ろの票は止まらない**（files_allowed が重ならない限り衝突しない）。runner の status のコミットで main が進んでも申請は落ちないので、申請は複数同時に置ける。作業員は並行（既定 2、最大 4）
- **上限（決定論的）**：並行数・1晩の票数・時刻・1票と1晩のトークン・司法の呼び出し回数・空き容量。**止める条件**：STOP ファイル、時刻、gate-runner の停止、`main_advanced_outside_gate`、拒否の急増、連続の失敗、容量、利用上限の文言、予算。止まるのは「新しい票を取らない」だけで、統合は gate-runner が続ける
- **差し戻し**：前検査（gate-runner の段階 1〜4 を runner が先に見る）か司法で落ちたら、理由を添えて作業員に**1回だけ**やり直させる。2回目で止めて朝刊へ。回数は gate-runner が数える（上限 3）。`blocked` は朝にオーナーが裁定
- **朝刊**：`morning-report.mjs` が「集計（決定論的）→ ローカル LLM（分類・言い換え。参考）→ Claude（固定の見出しで文章）」の3段で `night/reports/<date>.md` を書く。書記は決めない（D-52）。人が読んで `docs/night/` に写す
- **未試験**：V8（`docs/harness.md` §9）で、閉じ込め・前検査・申請・停止・朝刊を1晩 1〜2 時間で確かめてから本番にする（D-37「最初の晩は試験運転」）


> **p0.3.1 での変更（憲法審査 OBS-035②、オーナーの決定 2026-11-05）**：夜間の gate-runner は `--hold` で動かし、**判定に合格しても統合しない**。合格した候補を Z3 の `held.jsonl` に記録し、朝にオーナーが画面と判定を確かめて `vgdd/scripts/release.sh T-NNN …` で統合する（約束9・11：1機能ごとにオーナーが見て選ぶ）。release.sh は、今の main と申請の SHA から組み直し、入る変更が夜に判定した変更と一字一句同じであることと、組み合わせた木の監査（sandbox の中）を確かめてから統合する。

## 更新履歴

| 日時 | 内容 |
|---|---|
| 2026-11-04 22:2x（案） | **統合キュー**（p0.3.1 案。オーナーの指示 22:10）：§3.1 の 2 と 10 を改正。main を含まない申請は gate-runner が「最新の main ＋ 申請の SHA」の候補を一時 worktree で作って検査し、候補を fast-forward で統合。鎖で積まない。前の票が止まっても後ろは止まらない。`vgdd/scripts/gate-runner.sh` の差分は scratchpad |
| 2026-11-04 2x:xx（案） | 夜間ハーネス（D-55③）：§1 に night-runner・夜間の worker・書記の行、§3.2 の事後検知に `night-runner` の例外、§11 を追加。`vgdd/scripts/night-runner.sh`・`morning-report.mjs` を新設（未試験）。票の front matter に `unattended` |
| 2026-11-03 16:11 | 初版（設計案）。`docs/vgdd-operations.md` の内容を取り込み、D-47 の修正と公式ドキュメントの確認結果を反映 |
| 2026-11-03 16:48 | OBS-013（立法補佐の点検）を p0.2.0 に反映：①対象パスはリンクの実体（realpath。未存在なら存在する親）で判定、`ln` は常に拒否 ②作業員（worker・tester、または cwd が worktree 内）の書き込み・cd は自分の worktree の中だけ。手元試験 46/46 |
| 2026-11-03 16:40 | S2 の原本を `vgdd/` に書き終えた（p0.2.0・verify-chain・settings.v2・gate-runner・judge-codex・review-constitution・schemas・agents 3体）。手元試験 35/35。OBS-012 の4点（cwd の記録、cwd から git を読む、outcome の記録、commit 本文の除外）を反映。V7 の結果は `docs/vgdd-status.md` §2b |
| 2026-11-03 16:21 | オーナー承認（案 A）。修正3点：フックの `.claude/` 保護方式（全体保護・worktrees だけ例外・例外内のコピーは保護）と deny に commands/・output-styles/・rules/ を追加、`npx` は ask のまま `--no-install` だけ allow、`docs/tasks/_board.json` を gate-runner 専用の保護パスに |
