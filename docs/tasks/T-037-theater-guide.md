---
id: T-037
title: 統治シアターに「はじめて見る」の案内を足す（5つの手順で図の見方を説明し、該当する場所を光らせる）
status: review
requirements: [A0, A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-64]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐が起草（オーナーの承認前）。オーナーが 21:1x に案 C（初めて見る人の案内）を採用。Codex の追加提案の提案2と同じ内容を合わせた
estimate_h: 2
time_limit_min: 150
security_review: false         # 固定の文と図の強調だけ。データの取得と API は変えない
unattended: false
branch: worktree-agent-ad3d16cbc52b24dd6
worker: W33
files_allowed:
  - src/lib/theater-guide.ts                          # 新設：案内の手順（固定の文と図の強調）
  - src/lib/theater-guide.test.ts                     # 新設
  - src/components/theater/TheaterGuide.tsx           # 新設：案内の欄（表示と操作のボタン）
  - src/components/theater/TheaterGuide.test.tsx      # 新設
  - src/components/theater/GovernanceTheater.tsx      # 「はじめて見る」のボタンと、案内中の図・選んだ票の区画の切り替え
  - src/components/theater/GovernanceTheater.test.tsx # 上に合わせて足すだけ
files_forbidden:
  - src/lib/theater-stage.ts                          # 型と ID は import して読むだけ
  - src/lib/theater-data.ts
  - src/lib/theater-replay.ts
  - src/lib/theater-evidence.ts
  - src/lib/theater-refresh.ts
  - src/lib/claude-roles.ts
  - src/lib/governance*.ts
  - src/components/theater/GovernanceStage.tsx
  - src/components/theater/TicketReplay.tsx
  - src/components/theater/TheaterShell.tsx
  - src/components/theater/LawComparison.tsx
  - src/components/theater/DecisionPanel.tsx
  - src/components/theater/ClaudeRoles.tsx
  - src/components/theater/tokens.ts
  - src/components/GovernanceView.tsx
  - src/app/**
  - docs/**
  - src/lib/db/**
  - .claude/**
  - CLAUDE.md
  - .github/**
  - vgdd/**
  - merge-requests/**
  - package.json
  - package-lock.json
depends_on: [T-031, T-034, T-035, T-036]
---

## 1. 目的

VGDD を知らない人（clone した審査員、動画を見る人）が、統治シアターを開いてすぐに「誰のための画面か」「人・AI・司法・Kernel がそれぞれ何をするか」を、自分の速さで追えるようにする。見出しの「はじめて見る」を押すと、5つの手順で説明が進み、主役の図の該当する場所が光る（T-031 の図の強調をそのまま使い、新しい描き方は作らない）。最後の手順で、下の再生で本物の記録を追うよう案内する。審査：デモ25（前提知識のない人でも分かるか）、インパクト30（誰の課題かが冒頭で分かるか）。

## 2. 受け入れ条件

- A0. 差分を許すパスは次の6つだけ：`src/lib/theater-guide.ts`、`src/lib/theater-guide.test.ts`、`src/components/theater/TheaterGuide.tsx`、`src/components/theater/TheaterGuide.test.tsx`、`src/components/theater/GovernanceTheater.tsx`、`src/components/theater/GovernanceTheater.test.tsx`。それ以外は変更しない。実装と差分の審査の基準は、T-035・T-036 を統合した後の main とする。`GovernanceStage`・`TicketReplay`・`theater-stage.ts` は import して使うだけ
- A1. **案内の手順**（`src/lib/theater-guide.ts`。React を import しない。`node:fs` を読まない）：`GUIDE_STEPS` を export する。各手順は `{ title, body, focus }`。`focus` は `StageFocus`（`@/lib/theater-stage` の型）で、`tone` は `"normal"`、`judge`・`codex` は `null`。文と強調は次のとおり（文は一字一句このまま）

  | # | title | body | focus.nodes | focus.edges |
  |---|---|---|---|---|
  | 1 | 誰のための画面か | 複数の AI に開発を任せ、仕様の承認と統合の判断を1人で担う開発者のための画面です。AI が作り、別の AI が確かめ、統合の条件は Kernel が強制します。 | `human` | （なし） |
  | 2 | 人が決める | 人（オーナー）が目的を決め、立法補佐（Claude）が書いた作業の条件（票）を承認します。承認のない票は統合されません。 | `human`、`legislative` | `approve` |
  | 3 | AI が作る | 行政（Claude Code）の作業員が、隔離した場所で票のとおりに実装し、Kernel に申請します。 | `legislative`、`executive`、`kernel` | `spec`、`submit` |
  | 4 | 別の AI が確かめる | 司法（Claude と Codex）が、差分・受け入れ条件・監査の結果だけで独立に判定します。重大な指摘で判定が分かれたら、Kernel は統合せずに人の裁定を待ちます。 | `judiciary`、`kernel`、`human` | `verdict`、`escalate` |
  | 5 | 条件を満たしたものだけが入る | Kernel は、仕様の承認・監査・司法の判定や人の裁定など、統合の条件を確かめます。停止中は統合せず、夜間に合格した票は held として、人の統合の承認を待ちます。下の再生で、本物の記録を1票ずつ追えます。 | `kernel`、`merged` | `merge` |

  - あわせて `GUIDE_NOTE = "案内の光は説明のための強調で、記録の出来事ではありません"` を export する
- A2. **案内の欄**（`src/components/theater/TheaterGuide.tsx`）：props は `{ step, onPrev, onNext, onClose }`（`step` は 0 から 4 の手順の番号）。表示だけで、状態を持たない
  - 「{step + 1} / 5」、手順の `title`（`h2` ではなく `h3`）、`body`、`GUIDE_NOTE` を出す
  - ボタンは「戻る」「次へ」「案内を終える」の3つ（`button` 要素）。最初の手順では「戻る」を `disabled`、最後の手順では「次へ」の代わりに「終える」を出し、押すと `onClose` を呼ぶ
  - 欄の要素に `role="region"` と `aria-label="はじめて見る人への案内"` を付け、手順が変わったことを読み上げられるよう、手順の文の入れ物に `aria-live="polite"` を付ける
  - 動きの演出（アニメーション・遷移）を足さない
- A3. **シアターへの組み込み**（`GovernanceTheater.tsx`）：
  - 案内の状態 `guideStep`（`number | null`。`null` は案内していない）を持つ。最初は `null`
  - 見出しの区画に「はじめて見る」ボタンを置く（source によらず出す）。押すと `guideStep` を 0 にする。案内中はこのボタンを出さない
  - 案内中は、主役の区画の `GovernanceStage` に、選んだ出来事の強調の代わりに `GUIDE_STEPS[guideStep].focus` を渡す。`stopped` は今のまま（写しの値。案内では変えない）
  - 案内中は、選んだ票の区画の中身を `TheaterGuide` に替える。「戻る」「次へ」で `guideStep` を1つずつ動かし（0 未満・4 より大きくしない）、「案内を終える」「終える」で `null` に戻す
  - 案内の開始・終了で、`TicketReplay` を外さず、`key` を変えず、選んだ出来事（`currentEvent`）を消さない。案内を終えると、図はふたたび選んだ出来事の強調（なければ `null`）に戻る
  - 案内中も、再生と出来事の更新はふだんどおり続く。案内を終えたときは、その時点の `currentEvent` の強調に戻す（始めたときの位置には巻き戻さない）。上の「外さない・消さない」は、案内の開始・終了で再生を最初に戻すことを禁じるもので、source の切り替えによる今の作り直しはそのまま
  - A1 の表は、渡す `focus` の値を決めるもの。停止中は今の停止の表示を優先し、線が光らないことを許す（案内中に T-035 の取り直しで停止の状態が変わった場合も同じ）
  - source の切り替え・T-035 の取り直し・T-036 の欄は変えない。案内中に source を切り替えても案内は続く
- A4. **公開してよい項目だけ**：足すのは A1 の固定の文とボタンだけ。通信・保存・console への出力を足さない
- A5. 試験：
  - `theater-guide.test.ts`：`GUIDE_STEPS` が5つで、各手順の `title`・`body` が A1 の表どおり。`focus.nodes` と `focus.edges` が A1 の表どおりで、どの値も `STAGE_NODE_IDS`・`STAGE_EDGE_IDS`（`theater-stage.ts`）に含まれること。`tone` が `"normal"`、`judge`・`codex` が `null`
  - `TheaterGuide.test.tsx`：`renderToStaticMarkup` で、手順 0 で「1 / 5」と「戻る」が `disabled`、手順 4 で「終える」が出て「次へ」が出ないこと。`GUIDE_NOTE`、`role="region"` と `aria-label`、`aria-live="polite"` が出ること
  - `GovernanceTheater.test.tsx`：今の試験はそのまま。初期の表示に「はじめて見る」ボタンが出て、案内の欄（`aria-label="はじめて見る人への案内"`）は出ないこと
  - クリックによる手順の移動と、終えた後に図が選んだ出来事の強調に戻ることは SSR の試験では確かめられないので、§3 で立法補佐が held の候補で確かめる
- A6. `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る

## 3. 開発用テスト

held の後、release の前に、立法補佐が held の候補を一時的な作業ツリーで動かして確かめる。

- 「はじめて見る」を押すと、選んだ票の区画が案内に替わり、図の光る場所が手順ごとに A1 の表どおりに変わる
- 再生を一時停止した状態で案内を始めて終えると、再生の位置と選んだ出来事が元のまま。図も選んだ出来事の強調に戻る。再生中に案内を始めると、再生は続き、終えたときはその時点の出来事の強調になる
- キーボード（Tab と Enter）だけで最後まで進めて終えられる
- 1440×900 で最初の画面に収まる（案内の文が区画からあふれたら、区画の中で縦にスクロールできる）。375px でページに横スクロールが出ない
- 初めて見る人の目で、説明なしに、誰が承認し、誰が実装し、何を条件に統合されるかを答えられるか（立法補佐とオーナーで確かめる）

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. A1（手順と試験）→ A2 と試験 → A3 と試験
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。T-035・T-036 の統合の後に作業員を起動する（同じ `GovernanceTheater.tsx` を触る）。

## 6. 記録

- 22:11 行政の長が W33 を起動（worktree `agent-ad3d16cbc52b24dd6`、モデルは Opus）。仕様はオーナーが 21:37:51 に approve-spec で承認済み（22:10:31 の Kernel の写しの `approvals[].current` で確かめた）。依存の T-031・T-034・T-035・T-036 は統合済み。起動の前に、A1 の表の節と線の ID がどれも `theater-stage.ts` の `STAGE_NODE_IDS`・`STAGE_EDGE_IDS` にあり、`StageFocus` の形と `tone: "normal"` が型に合うことを確かめた
- W33 の報告：基点は main 91a5735（T-036 の統合 78dc6d5 と、その後の盤・README の文書のコミットを含む）。HEAD `3b7e0f8e009e9ec6009ade5bdb778b4cbcd5b49a`、91a5735 の上に1コミット。test 892 件（46 ファイル）合格、typecheck 合格、lint はエラー 0（警告 1 件は `vgdd/conformance/run.mjs:875` の `stopsDir` で差分の外）。§2 から外れる解釈はない
- 行政の長の確認（試験は再実行していない）：差分は A0 の6つだけ（+276 / -1）。A1 の5つの title・body と `GUIDE_NOTE` を、票の表から切り出した文字列と機械で照らし合わせ、どれも一字一句同じ。節と線は表の順で、「（なし）」は空の配列。`GovernanceTheater.tsx` の変更は、`guideStep` の state、「はじめて見る」ボタン、主役の区画に渡す `focus` の切り替え、選んだ票の区画（`side`）の中身の切り替えだけ。`controls` の `TicketReplay`（位置・`key={source}`・`onEventChange={setCurrentEvent}`）、`selectSource`、T-035 の取り直し、T-033・T-036 の区画は変わっていない
- 読み方が割れる所（W33 の選んだ読み方）：(1) `aria-live="polite"` は、「n / 5」・`h3` の title・body をまとめた入れ物に付ける（ボタンと `GUIDE_NOTE` はその外） (2) 「/ 5」の 5 は `GUIDE_STEPS.length` から作り、1つの文字列にする (3) 「はじめて見る」は、見出しの区画の右側、source の切り替えの前に置く
- 補った解釈（文面の範囲内）：(1) ボタンの見た目は source のボタンと同じ class。「戻る」の `disabled` に `disabled:opacity-50 disabled:cursor-not-allowed` を足す（transition はない） (2) `TheaterGuide` は `step` が 0〜4 にあると前提し、範囲に収めるのは `GovernanceTheater` の更新関数 (3) 最後の手順でも「案内を終える」は出したまま（「終える」と同じ `onClose`。A2 の「ボタンは3つ」に合わせた） (4) 案内中は `judge`・`codex` が `null` なので、図の判定のバッジは「Claude —、Codex —」になる。手順 1 は線がすべて暗くなる（`GovernanceStage` の既存の振る舞い。画面では未確認）
- **確かめていない**：クリックによる手順の移動と図の光る場所、終えた後の図の戻り（一時停止中・再生中の両方）、キーボード操作（案内を始めると「はじめて見る」が消え、終えると案内の欄が消えるので、そのときのフォーカスの行き先を見ていない）、1440×900 と 375px の実際の収まり（案内の文があふれたときの縦のスクロールを含む）、`npm run build`。§3 で立法補佐が held の候補で確かめる

## オーナーに聞くこと

1. 案内の5つの文（A1 の表）でよいか。動画の冒頭の 15〜35 秒をこの案内で見せることもできる
2. 再生の票を案内から自動で選ぶこと（たとえば T-014）は、`TicketReplay` を変えることになるので、この票では入れていない

- 2026-11-07T22:19:56+0900 gate-runner: status → review（判定に合格（judge=APPROVED codex=APPROVED）。夜間のため統合せず、朝のオーナーの承認を待つ）
