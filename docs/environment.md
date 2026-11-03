# 開発環境と依存パッケージの記録

- 作成：2026-11-03 12:22 JST（雛形生成の直後。開催期間中に新規作成）
- 目的：実際に入った版を残す（提出チェック #12 ライセンス確認、M8 の起動手順の根拠）

## 雛形

`create-next-app@latest`（2026-11-03 12:14 実行）。オプション：TypeScript、App Router、Tailwind CSS、ESLint、`src/` ディレクトリ、import alias なし、npm、`--skip-install --disable-git`。一時フォルダに生成してから `app/` に移した（既存の `docs/`・`vgdd/`・`CLAUDE.md`・`.claude/` と衝突させないため）。生成物の `README.md`・`AGENTS.md` は取り込んでいない。`.gitignore` は既存の内容に生成物の行を統合した（`.env*` は `.env.example` を隠すため採用せず）。

生成の最後に create-next-app が `RangeError: Maximum call stack size exceeded` を出したが、ファイル一式は揃っていた（sandbox 内で書けない場所への再試行が無限に続いたものと推測。推測であり未確認）。

## 実際に入った版（package-lock.json より、2026-11-03 12:22）

| 区分 | パッケージ | 版 | 用途 |
|---|---|---|---|
| dependencies | next | 16.4.4 | 画面と API |
| | react / react-dom | 19.3.0 | |
| | zod | 4.6.7 | M4 の固定スキーマと API 入力の検証 |
| | @anthropic-ai/sdk | 1.4.0 | アプリ内の Claude API 呼び出し（Sonnet 5.5） |
| devDependencies | typescript | 5.9.3 | strict |
| | @types/node | 24.19.2 | `node:sqlite` の型のため ^20 → ^24 に変更 |
| | @types/react / @types/react-dom | 19.3.0 | |
| | tailwindcss / @tailwindcss/turbopack | 4.3.4 | |
| | eslint / eslint-config-next | 9.39.5 / 16.4.4 | |
| | vitest | 4.1.12 | 開発用テスト。`npm test` は judge.sh の決定論的監査でも使う |

実行環境：Node v25.6.0（Current）、npm 11.8.0、macOS（Apple Silicon）。`engines.node >= 24`。

## DB：`node:sqlite`（Node 組み込み、DatabaseSync）

- `better-sqlite3` は使わない。sandbox の中でネイティブのビルドが失敗するため（オーナーの決定、2026-11-03）。
- `node:sqlite` は Node 25 で **ExperimentalWarning**（「SQLite is an experimental feature and might change at any time」）が出る。動作は確認済み（インメモリで create・insert・select）。README に警告の意味を書く。

## npm scripts

| script | 内容 |
|---|---|
| `dev` / `build` / `start` | `NEXT_TELEMETRY_DISABLED=1` を付けて next を起動（テレメトリを送らない） |
| `lint` | eslint（`vgdd/` も対象） |
| `typecheck` | `next typegen && tsc --noEmit`（Next.js 16 は `LayoutProps` 等の型を生成するので typegen が先） |
| `test` | `vitest run` |

## sandbox 内での注意（開発エージェント向け）

- npm のキャッシュは `/tmp/npm-cache` が書けないため `--cache "$TMPDIR/npm-cache"` を付ける。
- `npm run dev` は sandbox の中では起動しない（ローカルポートの bind が禁止）。**開発サーバーはオーナーが sandbox の外で起動する。**
- `npx`・`npm install` は ask ルールで承認画面に出る。

## 更新履歴

| 日時 | 内容 |
|---|---|
| 2026-11-03 12:22 | 初版 |
