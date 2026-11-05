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
  - `appendTranscript(current: string, transcript: string, max = 500): string`：`transcript.trim()` が空なら `current` をそのまま。そうでなければ `current` が空なら `transcript.trim()`、空でなければ `current` の末尾が空白でなければ半角空白1つを挟んで連結。結果が `max` 文字を超えれば先頭 `max` 文字に切る（`.length`）
  - `speechErrorMessage(code: string): string`：`not-allowed`・`service-not-allowed` → 「マイクの使用が許可されていません（ブラウザーの設定を確かめてください）」、`no-speech` → 「音声が聞き取れませんでした。もう一度お試しください」、`audio-capture` → 「マイクが見つかりません」、`network` → 「音声認識のサービスに接続できませんでした」、`aborted` → 「音声入力を中止しました」、それ以外（空文字を含む）→ 「音声入力を使えませんでした」
  - 最小の型 `SpeechRecognitionLike = { lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number; start(): void; stop(): void; abort(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null }` と `getSpeechRecognitionCtor(w: { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }): (new () => SpeechRecognitionLike) | null`（`SpeechRecognition` があればそれ、なければ `webkitSpeechRecognition`、どちらも関数でなければ `null`）。`lib.dom.d.ts` の `SpeechRecognition` 型には依存しない（型の有無が TypeScript の版で変わるため）
  - `pickFinalTranscript(results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>): { final: string; interim: string }`：`isFinal` が true の結果の `[0].transcript` を順に連結して `final`、false のものを連結して `interim`
- A2. `src/components/SpeechButton.tsx`（クライアント部品、props `{ disabled: boolean; onTranscript: (text: string) => void }`）：描画の後（`useEffect`）に `getSpeechRecognitionCtor(window)` を見て、`null` なら**何も描かない**（`null` を返す。対応しないブラウザー）。あればボタン「音声で入力」（`aria-pressed` で状態）。押すと認識を始める（`lang = "ja-JP"`、`interimResults = true`、`continuous = false`、`maxAlternatives = 1`）。認識中はボタンの文を「聞いています…（押して止める）」にし、`interim` を横に小さく出す（zinc）。`onresult` で `pickFinalTranscript` の `final` が空でなければ `onTranscript(final)` を呼ぶ（**入力欄へ足すだけ。送信しない**）。`onerror` は `speechErrorMessage(e.error)` を `role="alert"` で出し、認識を止める。`onend` で状態を戻す。unmount のとき `abort()`。`disabled` が true のときは押せない。ボタンの近くに常に1行：「音声はブラウザーの音声認識（外部のサービスに送られることがあります）で文字にします。文字は入力欄に入るだけで、送信はあなたが押します」
- A3. `src/components/WorkScreen.tsx`：入力欄（`<input>`）と「送信」ボタンの間に `<SpeechButton disabled={busy} onTranscript={(t) => setInput((cur) => appendTranscript(cur, t))} />` を1つ足す（`setInput` は既存の入力の state の setter。名前は作業員が確かめて合わせる）。`appendTranscript` は `@/lib/speech` から import。既存の送信・保存・二重送信の防止（`busy`）・送信した分だけを消す処理は変えない
- A4. `SpeechButton` と `WorkScreen` は `dangerouslySetInnerHTML`・`console`・`localStorage` の新しい使用を足さない。認識した文字は入力欄の state にだけ入れ、ほかの保存先に書かない。`window` を読むのは `useEffect` の中だけ（サーバーでの描画で `window` を参照しない）
- A5. `src/lib/speech.test.ts` に、下の①〜⑦を**それぞれ1件以上の `it(`**で試す：①`appendTranscript("", " こんにちは ")` が「こんにちは」②`appendTranscript("作業開始", "月次")` が「作業開始 月次」、末尾が空白なら空白を足さない ③`transcript` が空白だけなら `current` のまま ④501 文字になる連結は 500 文字に切れる ⑤`speechErrorMessage` の6種の対応と、未知の `code` の既定の文 ⑥`getSpeechRecognitionCtor` が `SpeechRecognition` を優先し、`webkit` だけならそれ、どちらもなければ `null` ⑦`pickFinalTranscript` が `isFinal` で `final` と `interim` に分ける
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

**Claude の点検済み、Codex は未点検**（Codex は sandbox の中から呼べない。4:00 から立法補佐が行う）。（点検の後に追記）

## 8. オーナーに聞くこと

1. **プライバシー**：Chrome の Web Speech API は音声を外部（ブラウザーの提供者のサービス）に送る。業務のつぶやきを送ることを README とボタンの注意書きで明示するだけでよいか、それとも M13 自体を見送るか
2. 対応しないブラウザーで「ボタンを出さない」でよいか（「このブラウザーでは音声入力を使えません」と出す案もある）
