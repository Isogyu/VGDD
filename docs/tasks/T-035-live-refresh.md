---
id: T-035
title: 統治シアターの「稼働中の観測」を自動で取り直し、取得の時刻と失敗を見せる
status: ready
requirements: [A0, A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [D-64]   # 記録用。司法には渡さない
proposal_from: 2026-11-07 立法補佐が起草（オーナーの承認前）。オーナーが 21:1x に案 A（稼働中の観測の自動更新）を採用。Codex の追加提案の提案1と同じ内容を合わせた
estimate_h: 1.5
time_limit_min: 120
security_review: false         # 既存の API を取り直すだけ。API と公開の項目は変えない
unattended: false
branch: null
worker: null
files_allowed:
  - src/lib/theater-refresh.ts                        # 新設：取り直した結果を今の表示に合わせる純粋関数
  - src/lib/theater-refresh.test.ts                   # 新設
  - src/components/theater/GovernanceTheater.tsx      # 取り直しのタイマー・「今すぐ取得」・取得の状態の表示
  - src/components/theater/GovernanceTheater.test.tsx # 上に合わせて足すだけ
files_forbidden:
  - src/lib/theater-data.ts                           # loadTheaterData は import して読むだけ
  - src/lib/theater-evidence.ts
  - src/lib/theater-replay.ts
  - src/lib/theater-stage.ts
  - src/lib/governance*.ts
  - src/lib/kernel-state*.ts
  - src/lib/kernel-invariants*.ts
  - src/components/theater/TicketReplay.tsx
  - src/components/theater/GovernanceStage.tsx
  - src/components/theater/TheaterShell.tsx
  - src/components/theater/LawComparison.tsx
  - src/components/theater/DecisionPanel.tsx
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
depends_on: [T-030, T-033, T-034]
---

## 1. 目的

今の統治シアターは、source を切り替えたときに1回だけ写しを取る。オーナーが Kernel を止めても、画面は切り替え直すまで「稼働中」のままに見える。「稼働中の観測」を選んでいる間だけ、Kernel と不変条件の写しを一定の間隔で取り直し、停止・再開が画面に自然に出るようにする。あわせて、写しの書き出しの時刻と、画面が最後に取得した時刻と、取得の失敗を分けて見せる。提出記録は静的な記録なので、取り直さない。審査：デモ25（動画の停止の場面）、深さ20。

## 2. 受け入れ条件

- A0. 差分を許すパスは次の4つだけ：`src/lib/theater-refresh.ts`、`src/lib/theater-refresh.test.ts`、`src/components/theater/GovernanceTheater.tsx`、`src/components/theater/GovernanceTheater.test.tsx`。それ以外は変更しない。`loadTheaterData`（`theater-data.ts`）、`TicketReplay`・`GovernanceStage`・`LawComparison`・`DecisionPanel` は import して使うだけで、変えない
- A1. **純粋関数**（`src/lib/theater-refresh.ts`。React を import しない。`node:fs` を読まない）：
  - `LIVE_REFRESH_MS = 15000` を export する。これは画面の側の取得の間隔で、裁判所が写しを書き出す周期や、停止が画面に出るまでの時間を保証しない
  - `mergeRefresh(current, next)`：`current` は今表示している `TheaterData`、`next` は取り直した `TheaterData`。返り値は `{ data, failed }`
    - `current.source` と `next.source` が違うときは、`next` を捨てて `{ data: current, failed: false }` を返す
    - `data.source` は `current.source`。`data.replay` は `current.replay` と同じ参照（取り直しでは再生の記録を差し替えない）
    - 判定には `next.state.kind`・`next.invariants.kind` を使う。`next.state.kind` が `"ok"` か `"missing"` なら `data.state = next.state`・`data.generated_at = next.generated_at`。`"failed"` なら両方とも `current` の値を保つ
    - `next.invariants.kind` が `"ok"` か `"missing"` なら `data.invariants = next.invariants`。`"failed"` なら `current.invariants` を保つ
    - `failed` は、`next.state.kind` と `next.invariants.kind` のどちらかが `"failed"` のとき true
- A2. **取り直し**（`GovernanceTheater.tsx`）：
  - 最初の取得（source を選んだときの取得）は今のまま `mergeRefresh` を通さずに結果を表示する。最初の取得は、結果が失敗でも「終わった」とみなす
  - source が `"live"` で最初の取得が終わった後だけ、`LIVE_REFRESH_MS` ごとに `loadTheaterData("live", fetch)` を呼び、結果を `mergeRefresh` で今の表示に合わせる。`"submission"` では取り直さない
  - 見出しの区画に、source が `"live"` のときだけ「今すぐ取得」ボタンを置く。最初の取得が終わる前は、押しても要求を出さない。終わった後は、自動の取り直しと同じ規則で1回取り直す
  - 自動と手動の取り直しは同じ排他の管理を使い、同時に走る取り直しは1つだけにする（走っている間に時刻が来た・押されたときは要求を出さない）
  - 要求は「source を選んでいる期間」ごとに見分ける。source を変えたとき（`live → submission → live` の往復を含む）と部品が外れたときはタイマーを止め、前の期間の要求の応答と終わりの処理は、表示の `data`・最後の取得の時刻・失敗の状態・今の期間の「走っている」状態を変えない
  - 取り直しの開始・完了・失敗で `data` を `null` にしない。`TicketReplay` の描画の位置と `key` を変えず、選んだ出来事（`currentEvent`）を消さない。取り直しが原因で再生の位置が最初に戻ることを起こさない
  - `GovernanceStage` の `stopped` と `DecisionPanel` には、合わせた後の同じ `data` を渡す。Kernel の写しと不変条件の写しが同じ時点に書き出されたものであることは求めない
- A3. **時刻と失敗の表示**（見出しの区画）：
  - 今の「Kernel の写しの書き出し」の項目は残す（写しの `generated_at`）
  - source が `"live"` のときだけ「最後の取得：{時刻}」を足す。最初の取得と取り直しのどちらでも、state と invariants の `kind` のどちらも `"failed"` ではないとき（片方でも `"failed"` なら記録しない。`"missing"` は成功に含める）だけ、その結果を表示に反映した時点の画面の側の時刻を記録し、`HH:MM:SS`（日本時間）で出す。まだ一度も記録がなければ「最後の取得：—」
  - 最初の取得か取り直しで、state と invariants のどちらかの `kind` が `"failed"` のときは、「最新の取得で一部または全部を取得できませんでした。取得できなかった項目は前の表示のままです」を出す。次の取得で両方とも `"failed"` でなくなったら消す
  - source を変えたら、最後の取得の時刻と失敗の状態を初めに戻す
  - source が `"submission"` のときは、「最後の取得」も失敗の文も出さない
  - 画面のどこにも、取得できたことを「再開してよい」「安全」などの判断の言葉で表さない
- A4. **公開してよい項目だけ**：足すのは、時刻と決まった文とボタンだけ。A2 の既存の API への取得の要求のほかに通信を足さない。console への出力・保存・取得したデータや状態の外部への送信を足さない
- A5. 試験：
  - `theater-refresh.test.ts`：`mergeRefresh` について、`ok`→`ok`（`next` の値になり `replay` の参照が `current` と同じ）、`ok`→`failed`（`current` を保ち `failed: true`）、`ok`→`missing`（`missing` になる）、state と invariants の片方だけ `failed`、source が違うときに `next` を捨てる、の各場合
  - `GovernanceTheater.test.tsx`：今の試験はそのまま。`renderToStaticMarkup` の初期の表示（source は `"submission"`）に「今すぐ取得」と「最後の取得」が出ないこと
  - タイマー・取得・クリック（最初の取得の前のクリック、連打、`live → submission → live` の遅れた応答を含む）は SSR の試験では確かめられないので、§3 で立法補佐が held の候補で確かめる。純粋関数に切り出せる判定（たとえば最後の取得の時刻を記録するかどうか）は `theater-refresh.ts` に置いて試験してよい
- A6. `npm run -s test`・`npm run -s typecheck`・`npm run -s lint` が通る

## 3. 開発用テスト

held の後、release の前に、立法補佐が held の候補を一時的な作業ツリーで動かして確かめる。稼働中の写しは、作業ツリーの `docs/governance/` に通常のファイルとして置く。

- 「稼働中の観測」を選ぶと、「最後の取得」が約 15 秒ごとに進む。提出記録では進まず、項目も出ない
- 写しのファイルを、`stopped.active` が true の合成の写しに置き換えると、次の取得で図が停止中になり、元に戻すと次の取得で消える
- 写しのファイルを壊すと「最新の取得で一部または全部を取得できませんでした…」が出て、取得できなかった項目は前の取得のまま。直すと文が消える
- 最初の取得の前に「今すぐ取得」を押しても二重に取得しない。`稼働中 → 提出記録 → 稼働中` と素早く切り替えても、前の期間の応答で表示が変わらない
- 再生の途中で取り直しが起きても、再生の位置と選んだ出来事が変わらない
- 「今すぐ取得」で「最後の取得」がすぐ進む
- 1440×900 で最初の画面に収まり、375px で横スクロールしない

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. A1（純粋関数と試験）→ A2・A3 → 試験
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。API と公開の項目は変えないので security は省く。続く票（Claude Code の使い分け、初めて見る人の案内）も `GovernanceTheater.tsx` を触るので、この票の統合の後に始める。

## 6. 記録

## オーナーに聞くこと

1. 取り直しの間隔は 15 秒（裁判所の書き出しは 30 秒ごと）
2. 取得に失敗したときは、前の取得の表示を残し、失敗したことを文で出す（停止中に通信が一度失敗しても、赤い表示が消えて「稼働中」に見えないようにするため）
