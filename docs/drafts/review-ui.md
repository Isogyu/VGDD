# アプリの点検：画面の使いやすさとアクセシビリティ（読むだけ）

> 下書き（2026-11-06 02:5x）。点検役：Claude のサブエージェント（読み取り専用。`src/components/*.tsx`・`src/app/**/page.tsx`・`layout.tsx`・`globals.css` の 19 ファイル 2,873 行を読んだ）。行政の長が報告を整えた。**直すのは票にしてから**（作業員は起こしていない）。行番号は 2026-11-06 02:4x の main のもの。Codex は未点検。

## 1. 指摘（重い順。critical なし、major 6・minor 9）

| # | 重さ | 箇所 | 問題 | 直し方の案 |
|---|---|---|---|---|
| 1 | major | `WorkScreen.tsx` L63-80 | 進行中の作業・履歴の取得（`Promise.all` の fetch）に try/catch がない。失敗すると「読み込み中…」のまま止まり、文も出ない | `try/catch/finally` で失敗の文と `setLoading(false)` |
| 2 | major | `SessionView.tsx` L64-90・L102-127 | `summarize`・`submitAnswers` に catch がなく、通信の失敗で `error` が設定されず何も出ない（WorkScreen・UnderstandingPanel は「通信エラー」を出す） | `catch { setError("整理できませんでした（通信エラー）") }` |
| 3 | major | `WorkScreen.tsx` L448-450 ＋ `UnderstandingPanel.tsx` L35-44 | 409 →「終了して始める」→ `reloadActive` の経路で `UnderstandingPanel` がマウントされ続け、前の作業の `result`・`excluded`・`qIndex` が新しい作業の下に残る。`excluded` の note id も次の checkin に送られる | `<UnderstandingPanel key={session.id} … />`（`docs/ideas.md` 11/4 の見送り案の再検討。SessionView・ShareReview も同じ構造） |
| 4 | major | `lib/time.ts` L54-58、`ShareReview.tsx` L35-38、`TeamKnowledge.tsx` L21-23、`GovernanceView.tsx` L34-37・L236 | 日時の書式が3系統（`11/3 13:05`・`11/03 13:05`・`11/03`）。同じ画面でも不一致 | `lib/time` に1本（`MM/DD HH:MM`、ゼロ埋め）を置き、3つのローカル関数を消す |
| 5 | major | `WorkScreen.tsx` L396-400 | `message` が成功・注意・失敗を兼ね、失敗も `role="status"`＋amber（ほかの画面は `role="alert"`＋red） | `message` を `{ kind: "info" \| "warn" \| "error"; text }` に。error は `role="alert"`・red |
| 6 | major | `CopyButton.tsx` L45、`QuestionDraft.tsx` L31、`SummaryActions.tsx` L26 | 同じ列の「チームに共有する」Link は枠付き、隣の2つのボタンはブラウザ既定の見た目。CopyButton は `aria-live` を button 自身に付けている | 二次ボタンの共通クラス。通知文は隣の `<span role="status">` に |
| 7 | minor | `ShareReview.tsx` L509-515・L476-481・L607-613、`WorkScreen.tsx` L326、`ShareRecords.tsx` L124 | フォームのラベル欠け（本文の textarea に label も aria-label もない、却下の理由は placeholder だけ、`aria-label="入力"` は内容が伝わらない、空の `<th>`） | `aria-labelledby` を h2 に、`aria-label="却下の理由"`、「つぶやきまたは作業名」、`<span className="sr-only">操作</span>` |
| 8 | minor | `TeamKnowledge.tsx` L216・L245・L94・L104、`ShareReview.tsx` L568・L200 | 見出しの階層の飛び（h1→h2→h4、section に h2 がなく中が h3） | h4→h3。「AI でも確かめる」に h2 |
| 9 | minor | `ShareReview` L444・L583・L640、`TeamKnowledge` L232・L270、`ShareRecords` L105・L108、`SessionView` L132、`GovernanceView` L120、`QuestionDraft` L49、`globals.css` | red の失敗枠に `dark:` がない箇所、textarea の dark、`color-scheme` がなく select・checkbox・スクロールバーが暗色で白 | `ErrorBox` 部品に集約。`:root { color-scheme: light dark; }` |
| 10 | minor | `WorkScreen.tsx` L460・L505・L433・L439、`SessionView.tsx` L229・L152、`UnderstandingPanel.tsx` L94 | 長い文字列（URL 1本）の折り返しがなく横にはみ出る | `min-w-0 break-words whitespace-pre-wrap` |
| 11 | minor | `SessionView.tsx` L156・L161・L241、`WorkScreen` L576-578、主ボタンの色、句点、`ShareRecords.tsx` L358 | 前回との差の色の条件が画面で違う、モデル名が固定文、主ボタンの zinc の濃さ、句点の有無、確認が `window.confirm` と画面内で混在 | 条件をそろえる、`model` から組む、共通クラス、句点の規則、確認の方式を1つに |
| 12 | minor | `SessionView.tsx` L281-282、`WorkScreen` L482、`GovernanceView` L616 | 根拠ボタンの強調が hover だけ（Tab で来ても光らない）。`text-zinc-400` のコントラスト約 3:1 | `onFocus/onBlur`。zinc-500 以上 |
| 13 | minor | `ShareReview.tsx` L626-639、`SessionView.tsx` L165-173 | `role="alert"` の中に操作のボタン | alert は文の `<p>` だけ。枠は `role="group"` |
| 14 | minor | `WorkScreen` L321・L368・L381・L520、`SessionView` L306、`UnderstandingPanel` L211、`ShareReview` L509・L607 | `maxLength` がなく、サーバーの上限が画面から分からない（ShareReview だけ文字数の表示あり） | API の上限に合わせた `maxLength` と「n / N 文字」 |
| 15 | minor | `SessionView.tsx` L93-100、`TeamKnowledge` L165-171、`ShareRecords` L65-72、`ShareReview` L274-276、`GovernanceView` L27・L82 | lint 回避の `setTimeout(0)`・`eslint-disable`、state を ref に写すだけの effect、`STATUS_BADGES: Record<string, …>` を記録由来の `status` で添字（`"constructor"` で Function を拾う） | `useCallback`、直接呼ぶ、render 中に ref を更新、`ReadonlyMap` |

## 2. 問題のなかった観点

`key` の重複なし／二重送信の防止（全画面で `disabled`＋busy、ShareReview は候補 id に結び付けた応答の捨て方まで）／戻る導線（全ページ）／ユーザー切替で表示を即消去、PreviousSummary は取得結果を `sessionId`・`userId` で照合／空の状態の文／「AI の推測」violet は3か所で同じ色と文、注意 amber・失敗 red は統一／`flex-wrap`、`html lang="ja"`、`aria-expanded`・`aria-controls`・`aria-pressed`／TeamKnowledge の `Map`、世代カウンタによる古い応答の破棄

## 3. 票にすると小さくまとまる単位（下書きの候補）

| 票の案 | 含む指摘 | 範囲 |
|---|---|---|
| **失敗の扱いの統一** | #1・#2・#5・#9 の red 枠 | クライアント部品の中で完結。`ErrorBox` 部品を新設、fetch の try/catch、`message` の種別 |
| **見た目の1本化** | #4・#6・#11 | `lib/time` の日時を1本に（3つのローカル関数を消す）、二次ボタンの共通クラス、条件・固定文・句点の統一 |
| **アクセシビリティの小修正** | #7・#8・#10・#12・#13・#14 | label・`aria-labelledby`、h4→h3、`break-words`、`onFocus`、alert の範囲、`maxLength`。1〜数行の変更の集まり |
| 同梱 | #3（`key={session.id}`）・#15（`ReadonlyMap`） | 2行。上のどれかに |

UI の刷新（P5、11/7）とまとめるか、先に「失敗の扱いの統一」だけを票にするかはオーナーの判断。#3 は本番で再現しうる不具合（前の作業の整理結果が残る）なので、票の優先は高い。

## オーナーに聞くこと

1. 3つの票に分けるか、UI の刷新（P5）に含めるか
2. #3 を単独の小さな票（`key={session.id}` の1行＋試験なし）で先に通すか
