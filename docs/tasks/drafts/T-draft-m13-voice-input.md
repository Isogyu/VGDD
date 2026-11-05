---
id: T-draft-m13-voice-input
title: M13 音声でつぶやく（ブラウザー組み込みの音声認識で入力欄に文字を足す。依存の追加なし、自動では送信しない）
status: draft
requirements: [A1, A2, A3, A4, A5, A6]   # この票の §2（requirements_source: ticket）
requirements_source: ticket
related_requirements: [M13（D-44③）, M2-1, M6-1]   # 記録用。司法には渡さない
proposal_from: 2026-11-06 02:4x 行政の長の下書き（28_night_plan_max.md §1 C-4）。D-44③「ブラウザ組み込みの音声入力、依存なし」。要件 §10 の改正（2026-11-05）で「作らないもの」から外れた
estimate_h: 0.7
time_limit_min: 45
security_review: false         # 外部 API を呼ぶのはブラウザー（Web Speech API）。アプリのサーバーは触れない
unattended:
branch: null
worker: null
files_allowed:
  - src/lib/speech.ts                       # 新設：純粋関数（文字の連結・エラーの文・型）
  - src/lib/speech.test.ts                  # 新設
  - src/components/SpeechButton.tsx         # 新設：マイクのボタン
  - src/components/WorkScreen.tsx           # 入力欄の横にボタンを1つ足し、認識した文字を入力欄に足すだけ
files_forbidden:
  - src/lib/sessions.ts
  - src/lib/input.ts
  - src/app/**
  - src/components/UnderstandingPanel.tsx
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

手がふさがっているときや、考えながら話したいときに、S-1 の入力欄へ**声でつぶやく**。ブラウザー組み込みの Web Speech API（`SpeechRecognition`／`webkitSpeechRecognition`）だけを使い、依存は足さない。認識した文字は入力欄に**足すだけ**で、送信は本人が押す（M2 の保存と M6-1 の検査は既存の経路のまま）。対応しないブラウザーではボタンを出さない。審査：デモ25（P5 の「音声と仕上げ」）、インパクト30。

## 2. 受け入れ条件

- A1. `src/lib/speech.ts` に次を export する（DOM の型に依存しない純粋な部分）：
  - `appendTranscript(current: string, transcript: string, max: number): string`：`transcript.trim()` が空なら `current` をそのまま。そうでなければ `current` が空なら `transcript.trim()`、空でなければ `current` の末尾が空白でなければ半角空白1つを挟んで連結。**連結後の全長**が `max` 文字を超えれば先頭 `max` 文字に切る（`.length`）。`max` は WorkScreen が渡す（**既存の入力の上限**：`<input>` の `maxLength` か、メモの API の検証の上限値。作業員が `src/lib/input.ts`・`src/app/api/sessions/[id]/notes/route.ts` を読んで確かめ、同じ定数を import するか同じ数を渡す。サーバーの上限を超える文字を入力欄に入れない）
  - `speechErrorMessage(code: string): string`：`not-allowed`・`service-not-allowed` → 「マイクの使用が許可されていません（ブラウザーの設定を確かめてください）」、`no-speech` → 「音声が聞き取れませんでした。もう一度お試しください」、`audio-capture` → 「マイクが見つかりません」、`network` → 「音声認識のサービスに接続できませんでした」、`aborted` → 「音声入力を中止しました」、それ以外（空文字を含む）→ 「音声入力を使えませんでした」
  - 最小の型 `SpeechRecognitionLike = { lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number; start(): void; stop(): void; abort(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null }` と `getSpeechRecognitionCtor(w: { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }): (new () => SpeechRecognitionLike) | null`（`SpeechRecognition` があればそれ、なければ `webkitSpeechRecognition`、どちらも関数でなければ `null`）。`lib.dom.d.ts` の `SpeechRecognition` 型には依存しない（型の有無が TypeScript の版で変わるため）
  - `pickFinalTranscript(results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>): { final: string; interim: string }`：`results` を先頭から順に見て、`isFinal` が true の結果の `[0].transcript` を**すべて順に連結**して `final`（最後の1件だけではない）、false のものを連結して `interim`。`continuous = false` でも確定の結果が複数来ることがある
- A2. `src/components/SpeechButton.tsx`（クライアント部品、props `{ disabled: boolean; onTranscript: (text: string) => void }`）：描画の後（`useEffect`）に `getSpeechRecognitionCtor(window)` を見て、`null` なら**何も描かない**（`null` を返す。対応しないブラウザー）。あればボタン「音声で入力」（`aria-pressed` で状態）。押すと認識を始める（`lang = "ja-JP"`、`interimResults = true`、`continuous = false`、`maxAlternatives = 1`）。認識中はボタンの文を「聞いています…（押して止める）」にし、`interim` を横に小さく出す（zinc）。`onresult` で `pickFinalTranscript` の `final` が空でなければ `onTranscript(final)` を呼ぶ（**入力欄へ足すだけ。送信しない**）。`onerror` は `speechErrorMessage(e.error)` を `role="alert"` で出し、認識を止める。**エラーの文は、次にボタンを押すまで残す**（直後の `onend` で消さない）。`onend` で「聞いています」の状態を戻す。unmount のとき `abort()` し、**unmount の後は state を更新しない**（`useRef` の mounted の印で守る）。`disabled` が true のときは押せない。**ボタンが描かれている間は常に**、ボタンの直下に1行（押す前から見える）：「音声はブラウザーの音声認識（外部のサービスに送られることがあります）で文字にします。文字は入力欄に入るだけで、送信はあなたが押します」
- A3. `src/components/WorkScreen.tsx`：入力欄（`<input>`）と「送信」ボタンの間に `<SpeechButton disabled={busy} onTranscript={(t) => setInput((cur) => appendTranscript(cur, t, INPUT_MAX))} />` を1つ足す（`INPUT_MAX` は A1 の既存の上限の定数）（`setInput` は既存の入力の state の setter。名前は作業員が確かめて合わせる）。`appendTranscript` は `@/lib/speech` から import。既存の送信・保存・二重送信の防止（`busy`）・送信した分だけを消す処理は変えない
- A4. `SpeechButton` と `WorkScreen` は `dangerouslySetInnerHTML`・`console`・`localStorage` の新しい使用を足さない。認識した文字は入力欄の state にだけ入れ、ほかの保存先に書かない。`window` を読むのは `useEffect` の中だけ（サーバーでの描画で `window` を参照しない）
- A5. `src/lib/speech.test.ts` に、下の①〜⑦を**それぞれ1件以上の `it(`**で試す：①`appendTranscript("", " こんにちは ", 500)` が「こんにちは」②`appendTranscript("作業開始", "月次", 500)` が「作業開始 月次」、末尾が空白なら空白を足さない ③`transcript` が空白だけなら `current` のまま ④連結後に 501 文字になる入力は 500 文字に切れる（`max` 500） ⑤`speechErrorMessage` の6種の対応と、未知の `code` の既定の文 ⑥`getSpeechRecognitionCtor` が `SpeechRecognition` を優先し、`webkit` だけならそれ、どちらもなければ `null` ⑦`pickFinalTranscript` が、確定2件＋途中1件の `results` で `final` に確定2件を順に連結し、`interim` に途中の1件を入れる

  `SpeechButton.tsx` の注意の1行と `aria-pressed` は、票 §3 のとおり画面で確かめる（部品の描画の試験は書かない）
- A6. `npm run -s test`（既存の試験のすべて）・`npm run -s typecheck`・`npm run -s lint` が通る（決定論的な監査の結果で確かめる）。差分のファイルは次の4つだけ：`src/lib/speech.ts`（新設）、`src/lib/speech.test.ts`（新設）、`src/components/SpeechButton.tsx`（新設）、`src/components/WorkScreen.tsx`。`package.json` の依存は増えない

## 3. 開発用テスト

- `speech.test.ts`：A5 の観点。マイクと認識はブラウザーの機能なので自動では試さない。統合の後に、オーナーが Chrome で「音声で入力」を押して W1 の一言が入力欄に入ること、Safari か Firefox でボタンが出ない（または出て動く）ことを確かめ、結果を README の「保証できないこと」に書く

## 4. 手順の案

1. `npm ci --cache "$TMPDIR/npm-cache"` を単独のコマンドで最初に1回
2. 見た目は既存の「送信」ボタンに合わせる。認識中は amber の枠
3. コミットは1つ。メッセージの先頭は票の ID

## 5. 統合審査

決定論的な監査＋ judge ＋ Codex judge。`WorkScreen.tsx` を触る票（T-draft-m14-checkin-prompt・T-draft-m12-interview-screen）と重なるので、並行せず順に統合する。

## 6. 記録

（統合後に追記）

## 7. 点検の記録

**Claude の点検済み、Codex は未点検**（Codex は sandbox の中から呼べない。4:00 から立法補佐が行う）。点検役：Claude のサブエージェント（ツールなし）。02:5x、3票あわせて指摘 12 件。この票への対応：#1 注意の1行はボタンが描かれている間は常に、押す前から見える位置に（A2）／#6 `final` は確定の結果をすべて順に連結（A1・試験⑦）／#7 `max` は連結後の全長、既存の入力の上限と同じ値を WorkScreen が渡す（A1・A3）／#8 エラーの文は次にボタンを押すまで残す、unmount 後に setState しない（A2）

## 8. オーナーに聞くこと

1. **プライバシー**：Chrome の Web Speech API は音声を外部（ブラウザーの提供者のサービス）に送る。業務のつぶやきを送ることを README とボタンの注意書きで明示するだけでよいか、それとも M13 自体を見送るか
2. 対応しないブラウザーで「ボタンを出さない」でよいか（「このブラウザーでは音声入力を使えません」と出す案もある）
