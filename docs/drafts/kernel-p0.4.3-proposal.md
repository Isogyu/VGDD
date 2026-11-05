# Governance Kernel 改正案の下書き p0.4.3（行政の長 Max、2026-11-06 02:1x）

- 位置づけ：**下書き**。法律の本体（`vgdd/`・`.claude/`）は書いていない。立法補佐が 4:00 から起草し、憲法審査とオーナーの承認を経て効力を持つ
- 出どころ：2026-11-05 夜〜11-06 未明の運用で見つかった観察（OBS-049・051・053・054）と、Kernel の UI（票の下書き `docs/tasks/drafts/T-draft-kernel-ui.md`）の前提
- 規範との対応：`vgdd/kernel/SPEC.md` p0.4.2 の §3（判定）・§4（仕様の統治）・§6（司法の独立）・§7（統合）・§8（停止）・§10（証跡）・§11（適合性）。判例（適合性テスト）の群の記号は `run.mjs` の既存の群（C1・C2・C3・G・H・K・N・A・L・M）に合わせ、新しい群は **S**（state：状態の書き出し）とする
- 点検：Codex CLI はこの環境にないため（`codex not found`）、**Claude のサブエージェント（ツールなし、憲法審査の役）**で1回点検した。指摘と対応は末尾の §7

---

## 1. Kernel の状態の書き出し（Kernel の UI の前提）

### 問題

- Z3 の記録（承認・held・裁定・判定・証拠ストア）は行政の側から読めない（設計どおり）。そのため、アプリの統治の画面（`/governance`、T-013）は、票の §6 と `_board.json` と、**オーナーが手で書き出す** `docs/governance/summary.json` しか見られない。Kernel が「いま稼働しているか、止まっているか」「どの票の仕様が承認済みか」を画面で示せない
- OBS-051：行政の長は、票を起こす前に仕様が承認済みかを確かめる手段がない（T-016 が 23:44 に blocked。T-015 の W6 は承認の前に起動した）

### 直し方の案

裁判所（gate-runner）が**周回ごとに**、公開してよい集計だけを `docs/governance/kernel-state.json` に書き出す。書くのは裁判所だけ。行政（行政の長・作業員）は読めるが書けない。

**置き方の案（2つ。推奨は A）**

| 案 | 置き方 | 利点 | 難点 |
|---|---|---|---|
| **A（推奨）** | 作業ツリーに置くが **git で追跡しない**（`.gitignore` に `docs/governance/kernel-state.json`。`merge-requests/` と同じ扱い） | 周回ごとの書き換えが main のコミットの雑音にならない。**停止中にも書ける**（停止中に main にコミットすると、再開の前の確認「停止の後に main に入ったコミットがない」（SPEC §8-3）に当たる）。UI（Next.js のサーバー）はディスクの最新を読む | 履歴が git に残らない（履歴は Z3 の `kernel_state.jsonl` に裁判所が追記して補う）。clone した審査員の環境にはファイルがない（UI は「ない」ときの表示を持つ。票 B の条件） |
| B | main に追跡し、周回ごとに `_board.json` と一緒にコミット | 履歴が main に残る。審査員の clone でも最後の状態が見える | 周回ごとのコミットの雑音（`generated_at` だけの差でもコミットが増える）。停止中は書けない（§8-3 と衝突）。`_board.json` と同じく他人の書きかけと混ざる経路に注意（G10〜G13） |

**中身（`vgdd.kernel-state.v1`）**

| 項目 | 内容 | 出どころ（Z3） |
|---|---|---|
| `schema`・`generated_at` | 固定の文字列、書き出した時刻（JST） | — |
| `kernel_version`・`policy_version` | 法律の版（`capabilities.json` の `kernel_version`、フックの `policy_version`） | `capabilities.json`、証拠ストアの最新行 |
| `stopped` | `{ active: boolean, since: string \| null }`。**理由の本文は出さない** | `STOP` の有無と1行目の時刻 |
| `approvals` | `[{ task, fingerprint_prefix（先頭12桁）, approved_at }]`。main の票の今の指紋と一致するものだけ `current: true` | `spec_approvals.jsonl` ＋ `spec-digest.mjs` |
| `held` | `[{ task, candidate_prefix（12桁）, since }]` | `held.jsonl`（release 済みを除く） |
| `rulings` | `{ count, tasks: [...] }`。**理由の本文は出さない** | `rulings.jsonl` |
| `annulments` | `{ count }` | `annulments.jsonl` |
| `verdicts` | `{ count, by_task: { "T-NNN": { judge: "APPROVED"\|"CHANGES_REQUIRED"\|null, codex: ..., security: ..., at } } }`。結論だけ。**findings の本文は出さない** | `verdicts/` |
| `disagreements` | `{ count, tasks: [...] }` | `gate_events.jsonl` |
| `evidence` | `{ records, chain_ok, checkpoint_at, last_record_at }` | `verify-chain.mjs --summary-json`、チェックポイント |
| `conformance` | `{ passed, total, impl: "p0.4.2", at } \| null`。最後の適合性テストの結果 | **新設**：`run.mjs` に `--record` を足し、結果の1行を Z3 の `conformance.jsonl` に追記（オーナーか立法補佐が sandbox の外で実行） |
| `tickets` | `_board.json` と同じ5つの数（二重に出す必要はない。UI が `_board.json` を読めるので省いてよい） | `_board.json` |

**出さないもの（MUST NOT）**：判定の理由（findings）の全文、裁定の理由の本文、停止の理由の本文、証拠ストアの各行、ファイルのパス（Z3・worktree・ホーム）、セッション ID、`tool_use_id`、作業員の報告、コミットの本文

**書き出しの規則**

1. 裁判所は周回の終わり（`update_board` の直後）に書く。停止中の周回でも `stopped.active: true` で書く（案 A のとき）
2. 書き出しは**一時ファイルに書いてから rename**（読み手が途中の状態を読まない）
3. 内容が前回と同じ（`generated_at` を除く）なら `generated_at` も更新しない（UI の「最後に集計した日時」が意味を持つ）。Z3 の `kernel_state.jsonl` には変化があった時だけ1行追記
4. 行政の長・作業員の `docs/governance/kernel-state.json` への Edit・Write・Bash の書き込みは**フックが拒否**（保護パスに加える。`docs/governance/summary.json` も同じ扱いにそろえる）。作業員の差分に含まれていれば裁判所が保護パスとして拒否（`PROTECTED_RE` に追加）
5. UI（票 B）は zod の strict で検証し、通らない項目は出さない（`summary.json` と同じ方針）

### 足す判例（試験）の案

| 記号 | 試すこと | 期待 |
|---|---|---|
| S1 | 書き出した JSON の全文に、禁止の形が含まれない：Z3 のパス、`/Users/`、`session_id`、`tool_use_id`、`reason` の本文の鍵（`findings`・`reason`・`message` の鍵が存在しない）、改行を含む長い文字列（120 文字超の値がない） | 含まれない |
| S2 | 行政の長の probes：`Write`/`Edit`/`Bash: echo x > docs/governance/kernel-state.json` | deny |
| S3 | 作業員の probes：worktree の中の同じパスへの Write | deny。差分に含めた申請は裁判所が保護パスで拒否（G の既存の形） |
| S4 | STOP があるとき書き出すと `stopped.active` が true、`since` が STOP の1行目の時刻、理由の本文は含まれない | 一致 |
| S5 | STOP を消すと次の周回で `stopped.active` が false | 一致 |
| S6 | 承認の記録に main の指紋と一致しない行があるとき、`approvals[].current` が false | 一致 |
| S7 | 内容が同じ周回では `generated_at` が変わらない。変わった周回では Z3 の `kernel_state.jsonl` が1行増える | 一致 |
| S8 | 書き出しの失敗（ディスクに書けない）は裁判所の周回を止めず、`gate_events.jsonl` に `kernel_state_unwritten` を1行残す | 一致 |
| M | 権限の表の自己検査：新しい権限 `CAP-KERNEL-STATE-WRITE`（allowed: gate_runner）と `CAP-KERNEL-STATE-READ`（allowed: すべて）に probes と参照する試験がある | 合格 |

### 残る限界

- 書き出しは裁判所の周回ごと（既定の間隔）なので、UI の表示は最大でその間隔だけ遅れる
- 案 A では、審査員が clone した環境には状態のファイルがない。README には「実機の運用で裁判所が書き出したもの」の写し（公開してよい集計だけ）を**オーナーが選んで**コミットする手順を書く（例：`docs/governance/kernel-state.sample.json`）
- 書き出しが「正しい」ことの保証は、Z3 の記録を読める者（オーナー）の照合に依る。行政は照合できない（設計どおり）

---

## 2. OBS-051：承認の有無を行政の長が読める。昼の作業員の起動の時点の承認は promise

### 問題

- 行政の長は、昼に作業員を起こす前に「この票の仕様はオーナーが承認済みか」を確かめられない（承認の記録は Z3）。T-015・T-016 は承認の前に作業員を起こし、T-016 は裁判所で blocked になった。T-015 は結果として承認が間に合ったが、順番は守れていない
- 権限の表には「作業員の起動は承認の後」という規則が強制としても約束としても書かれていない

### 直し方の案

1. §1 の `kernel-state.json` の `approvals[].current` で、行政の長が承認の有無を読める（新しい権限 `CAP-APPROVAL-STATE-READ`。enforced_by は不要＝読み取り）
2. 権限の表に **`CAP-WORKER-START-AFTER-APPROVAL`**（昼の作業員の起動は、main の票の指紋に `approved_by: owner` の記録があるときだけ）を足し、`allowed: [executive_head]`、`enforced_by: ["promise", "gate"]` と書く。強制は裁判所の段階（未承認の申請は司法の前に blocked。既存の G1・G4）にしかなく、起動そのものは止めていないので **promise** を明示する。`known_gaps` に「起動は止めない。無駄になるのは作業員の時間だけで、main には入らない」
3. 夜間の代行は既存の規則（承認のない票を作業員に渡さない。N の試験）のまま

### 足す判例の案

| 記号 | 試すこと | 期待 |
|---|---|---|
| M | `CAP-WORKER-START-AFTER-APPROVAL` に `enforced_by: promise` が含まれ、`known_gaps` が空でない（約束を公開している） | 合格 |
| C2 | `approvals[].current` が、承認の後に §2 を1文字変えた票では false になる（S6 と同じ） | 一致 |

### 残る限界

- 行政の長が約束を破って起動しても止まらない。止めるには「作業員の起動（Agent ツール）をフックが見て、票の承認を照合する」が要るが、フックは Agent ツールの入力から票を特定できない（プロンプトの文字列照合になる）。p0.4.3 では見送り、promise として公開する

---

## 3. OBS-053：裁判所の起動時に司法の道具の有無を確かめる

### 問題

- 2026-11-06 00:20、T-015 の申請が「セキュリティ審査が差し戻し」になったが、オーナーの調べで**裁判所の環境の不具合**（司法の道具が動かなかった）と分かり、同じ d07cc6a を再申請して合格した。道具がないときに「差し戻し」として票に書かれると、行政は原因を知れず、再申請の回数（上限3回）も消費する

### 直し方の案

1. **起動時の点検（preflight）**：gate-runner は起動時に `codex`・`claude`・`jq`・`node`・`git` の有無（`command -v`）と、`claude --version`・`codex --version` が 0 で終わることを確かめる。欠けていれば `gate_events.jsonl` に `preflight_failed`（欠けた道具の名）を1行書いて**起動しない**（申請は処理しない。票は書き換えない）
2. **司法の呼び出しの失敗を「判定」と区別する**：judge・Codex・Codex security の呼び出しが、起動できない（終了コード 127）・時間切れ・出力が空のときは、`judiciary_unavailable`（どの司法か）を `gate_events.jsonl` に書き、**申請を残して票を書き換えない**（次の周回でやり直す）。差し戻し（CHANGES_REQUIRED）に数えない。連続 N 回（既定3）失敗したら裁判所は停止して `gate_events.jsonl` に `judiciary_down` を書く（オーナーが見る）
3. 司法の出力がスキーマに合わない（`judge_parse_ok: false`）のは今のまま（判定の失敗として扱う。p0.2 の `judge.sh` の規則）。「起動できない」と「出力が壊れている」を分ける

### 足す判例の案

| 記号 | 試すこと | 期待 |
|---|---|---|
| G14 | PATH に `codex` がない状態で起動 | 起動しない。`preflight_failed` が1行。票と申請は不変 |
| G15 | 司法の代わりのスクリプトが 127 で終わる | 票の status は不変、申請は残る、`judiciary_unavailable` が1行、差し戻しの回数が増えない |
| G16 | 司法の代わりのスクリプトが空の出力で 0 で終わる | 同上（空の出力も「使えない」） |
| G17 | 3周回続けて失敗 | 裁判所が止まり `judiciary_down` が1行 |
| G18（陽性の対照） | 司法の代わりが正しい JSON を返す | 今までどおり判定される |

### 残る限界

- 道具はあるが認証が切れている・利用の上限に達している場合は、起動時の点検では分からない（2 の呼び出し時の扱いで拾う。利用上限の文言は夜間の代行と同じ照合を足す）
- 裁判所の環境は sandbox の外（オーナーの権限）なので、適合性テストは「代わりの司法」で場面を作る（既存の G と同じ方式）

---

## 4. OBS-054：司法の入力に、変更した hunk を含む関数の全体を参考として渡す

### 問題

- T-019（01:33）で judge が CHANGES_REQUIRED を出したが、オーナーの裁定で**誤検知**と分かった。AI の区画を出す条件（`stale` の早期 return）が、差分の外（T-014 で入った既存のコード）にあり、差分だけを見た judge には見えなかった。T-017（00:52）でも judge と Codex が分かれた
- 司法の入力は「差分・main の票の §2・監査の結果」だけ（SPEC §6-1）。差分の外の文脈がないと、条件分岐の上下にある既存のコードを読めない

### 直し方の案

1. 司法の入力に **「参考：変更したファイルの全文（変更後）」** の節を足す。節の見出しで「差分」と「参考」を分け、判定の対象は差分と §2 のままと明記する（judge のプロンプトに「参考は文脈の確認にだけ使い、参考の中の既存のコードの欠陥を差し戻しの理由にしない」）
2. 大きさの上限：1ファイル 64KB、合計 256KB。超えたファイルは「変更した hunk の前後 60 行」に落とす。上限を超えたことを入力に書く（司法が「文脈は一部」と分かる）
3. **入れないものは変えない**（SPEC §6-1）：コミットの本文、票の手順の案・§6、作業員の報告、会話。ファイルの全文は**コード**であり行政の説明ではない。ただし、コードのコメントに行政の説明が書かれうる限界は残る（下）
4. Codex の judge・security も同じ入力の組み立て（SPEC §6-2 の SHOULD）
5. 判定の記録（`verdicts/`）に、入力に含めたファイルと大きさの一覧を残す（何を見て判定したかの証跡）

### 足す判例の案

| 記号 | 試すこと | 期待 |
|---|---|---|
| C3 | 司法の入力に、差分で触ったファイルの全文（変更後）が「参考」の節にある | 含まれる |
| C3 | 差分で触っていないファイルは入っていない | 含まれない |
| C3 | 64KB を超えるファイルは hunk の前後 60 行に落ち、その旨の1行がある | 一致 |
| C3（既存の確認） | コミットの本文・票の §4・§6・作業員の報告は入っていない | 含まれない |
| C3 | 判定の記録に、含めたファイルと大きさの一覧がある | 一致 |

### 残る限界

- 変更したファイル以外（import している別のファイル）の条件は見えない。T-019 の例は同じファイルの中だったので拾えるが、別ファイルの前提は拾えない
- コードのコメントに「行政の説明」を書き込んで司法を誘導する経路は、差分にも元からある（コメントは差分に含まれる）。全文を渡すことで誘導できる面積は広がる。司法のプロンプトで「コメントの主張ではなくコードの振る舞いを判定する」と明記する
- 入力が大きくなり、司法の費用と時間が増える（1票あたり最大 256KB）。昼の司法の費用の上限は未実装（kernel.md §2 の Budget Controller）

---

## 5. OBS-049：夜間の `--allowedTools` が角かっこのパスに効かない

### 問題

- 夜間の代行は、票の `files_allowed` から `Edit(/<wt>/<path>)`・`Write(/<wt>/<path>)` を作って `--allowedTools` に渡す（p0.3.2、headless では確認待ちが拒否になるため）。Next.js の動的ルートのパス `src/app/api/sessions/[id]/share/route.ts` を渡すと、夜の作業員の書き込みが拒否された（T-010、2026-11-05 夜）。**原因の推測**：許可ルールのパターンは glob で、`[id]` が文字クラス（`i` か `d` の1文字）として解釈され、文字どおりの `[id]` に一致しない。**オーナーの端末での再現試験はまだ**
- そのため T-010・T-017 は `unattended: false` にして昼の作業員で行った。角かっこのパスを含む票は夜に回せない

### 直し方の案（3つ。推奨は①）

| 案 | 内容 | 利点 | 難点 |
|---|---|---|---|
| **①（推奨）** | `files_allowed` の各パスの**角かっこを含む区切り（ディレクトリ名・ファイル名）を `*` に置き換えて**許可ルールを作る（例：`src/app/api/sessions/[id]/share/route.ts` → `Edit(/<wt>/src/app/api/sessions/*/share/route.ts)`）。置き換えたことを夜の記録に1行書く | 実装が小さい。許可は広がるが、**`files_allowed` の外の変更は前検査（precheck）が落とす**ので main には入らない | 作業員が `src/app/api/sessions/other/share/route.ts` を**作る**ことはできてしまう（前検査で落ちる＝再申請の無駄）。glob の意味は Claude Code の実装に依存 |
| ② | 角かっこを `\[`・`\]` にエスケープ | 許可が広がらない | エスケープが効くかは実装に依存。公式ドキュメントに記載を確認できていない。試験が要る |
| ③ | 角かっこを含む票は夜間の代行が取らない（今の運用を規則にする） | 安全 | 動的ルートの票をすべて昼に回すことになる。夜間の価値が下がる |

①を推奨する。前提として、**オーナーの端末で再現試験**（角かっこのパスの `--allowedTools` が実際に拒否されること、`*` に置き換えると通ること）を p0.4.3 の起草の前に行う。再現しなければ原因は別（例：worktree isolation の判定）で、案を見直す

### 足す判例の案

| 記号 | 試すこと | 期待 |
|---|---|---|
| N | `files_allowed` に `src/app/api/sessions/[id]/share/route.ts` がある票で、夜間の代行が作る許可ルールの一覧に `*/share/route.ts` の形があり、`[id]` の形がない | 一致 |
| N | 置き換えが起きた票の夜の記録（`lanes-*.tsv` か `summary`）に、置き換えの1行がある | 一致 |
| N（陽性の対照） | 角かっこのないパスは置き換えない | 一致 |
| N | 前検査：`files_allowed` に `[id]` の票で、作業員が `sessions/other/share/route.ts` を作ったら `files_allowed の外` で落ちる | 一致 |

### 残る限界

- 許可ルールの glob の意味（`*` が `/` を越えるか、`[` の扱い）は Claude Code の実装に依存し、版が上がれば変わりうる。再現試験の結果と版を記録に残す
- 実機の `--allowedTools` の振る舞いは適合性テストの範囲外（SPEC §12 と同じ）。試験は「代行が作る文字列」までしか確かめられない

---

## 6. 版と文書の更新の案

- `vgdd/kernel/SPEC.md`：§7 に「裁判所は周回ごとに公開してよい集計を状態のファイルに書き出す。書くのは裁判所だけ（MUST）」、§6-1 に「参考として変更したファイルの全文を含めてよい（SHOULD）。行政の説明は含めない（MUST NOT）」、§3 に「司法の道具が使えないことは判定ではない（MUST。申請を残す）」
- `vgdd/kernel/capabilities.json`：`kernel_version: p0.4.3`。新しい権限 `CAP-KERNEL-STATE-WRITE`・`CAP-KERNEL-STATE-READ`・`CAP-WORKER-START-AFTER-APPROVAL`（promise）
- `vgdd/conformance/run.mjs`：S1〜S8、G14〜G18、C3 の5件、N の4件、M の自己検査。**前の版（p0.4.2）にかけて新しい試験だけが落ちることを確かめる**（SPEC §11）
- `docs/kernel.md` §2・§3、`docs/vgdd-status.md` の表（K4：状態の書き出し）
- 保護パス：`PROTECTED_RE` と フックの保護パスに `docs/governance/kernel-state.json`・`docs/governance/summary.json`

## 7. 点検の記録（Claude のサブエージェント、ツールなし、憲法審査の役）

（点検の後に追記）

## 8. オーナーに聞くこと

1. §1 の置き方：案 A（追跡しない）か B（main に追跡）か。推奨は A
2. §1 の `conformance`：`run.mjs --record` で Z3 に結果を残す運用でよいか（オーナーか立法補佐が実行する手順が1つ増える）
3. §5 の案①：夜間の許可を `*` に広げることを認めるか。前にオーナーの端末での再現試験が要る
4. §3 の 2：司法が連続3回使えないときに裁判所を**止める**（stop）か、**待つ**（申請を残して周回を続ける）か。下書きは「止める」
