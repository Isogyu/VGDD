# 実装メモ：計画からの逸脱と死角の記録（D-40⑦）

- 目的：実装中に「計画どおりにいかなかったこと」「計画になかった判断」をその場で1行ずつ残す。README の「Claude の活用」と「深さと実行力」の材料。人が確認した要約だけを書き、生のログは置かない。
- 書き方：日時（JST、`date` で確認）、対象の機能 ID、計画 → 実際、理由、影響。

## M1 作業開始（2026-11-03、計画は 12:3x のチャットでオーナー承認）

### 実装前の死角の確認（計画に書いたもの）

1. `node:sqlite` が Next.js 16 の開発サーバー（Turbopack）で読み込めるか → 手順1で確認する
2. 時刻は JST 固定で保存・表示（ブラウザのタイムゾーンに依存させない）
3. 認証なし。userId はクライアントから送る（README に明記）
4. M1-4 は M4・M9 のデータがないと空。受け入れ試験は seed の行で行う
5. 型検査は `npm run typecheck`（`next typegen` が先）

### 逸脱と判断

| 日時 | 対象 | 計画 → 実際 | 理由 | 影響 |
|---|---|---|---|---|
| 11/3 12:45 | 雛形 layout.tsx | 雛形の `next/font/google`（Geist）を使う → **システムフォントに置き換え** | `next/font/google` はビルド時に Google からフォントを取得する。sandbox 内のビルドと、オフラインの審査環境で失敗する | 見た目は OS 既定のフォント。`lang` を `ja` にし、タイトルを変更 |
| 11/3 12:45 | テスト | vitest の設定ファイルなしで進める → `vitest.config.ts` を追加 | `@/*` の import alias を vitest でも解決するため | — |
| 11/3 12:46 | API | Route Handler に `export const dynamic = "force-dynamic"` を書く → **書かない** | 雛形の `cacheComponents: true` と Route Segment Config は両立せず、ビルドが失敗した | Route Handler は既定で動的。画面側はクライアントコンポーネントで API を叩く |
| 11/3 12:47 | 検証手段 | 死角1（`node:sqlite` が Turbopack で通るか）を sandbox 内の `next build` で確かめる → **sandbox 内ではビルドできない** | Turbopack の CSS ローダー（`@tailwindcss/turbopack`）が子プロセスを起こしてポートに bind し、sandbox が拒否する（Operation not permitted） | 死角1の確認は、オーナーの開発サーバーで `/api/users` を叩いて行う。以後、動作確認は vitest（Node 直）とオーナーの `npm run dev` の2本立て |
| 11/3 12:47 | 作業の仕方 | ファイル変更に Bash の python を使っていた → **Edit・Write ツールに統一**（オーナー指示） | 証拠ストアに対象ファイルのパスが残る。承認画面が減る。フックは Bash での `~/.claude/**` 書き込みも拒否する | Bash は実行と確認だけ |
| 11/3 12:50 | テスト実行 | `npx vitest` → **`npm test`**（オーナー指示） | `npx` は ask ルールの対象で、毎回承認画面が出る | — |
| 11/3 12:55 | S-1 経過時間 | クライアントで `Date.now()` から計算 → **サーバーが返す `elapsedMin` を1分ごとに取り直す** | React Compiler の lint（`react-hooks/purity`、`set-state-in-effect`）が描画中の時刻参照と effect 内の setState を禁じる。結果として「時刻はサーバー（JST）に固定」の方針にも合う | 表示の更新は最大1分遅れる。開始直後は 0 分 |
| 11/3 12:55 | M1-4 の確認方法 | 画面で確認 → **vitest で確認**（seed の整理結果と承認済み知識） | 画面で見せるには M4（整理結果）と M9（承認）のデータが要る。いまは表が空 | デモ用の seed（M7）ができれば画面でも見える |
| 11/3 12:55 | 入力欄の M2・M3 | （計画外）メモと作業終了の入力は、保存せず「M2／M3 で実装します」と表示する | 同じ入力欄を使うため、無反応にせず現状を正直に示す | M2・M3 の繰り返しで置き換える |
