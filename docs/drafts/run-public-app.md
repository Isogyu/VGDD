# 公開のアプリを、裁判所を止めずに起動する（下書き、2026-11-08 行政の長）

オーナーの窓口の「要件」「統治の記録」は `http://localhost:3000` へのリンク。公開のアプリ（Next.js、読むだけ）をそこに出す手順。

## コマンド1つ

main の checkout（`app/`）で：

```bash
bash docs/drafts/run-public-app.sh
```

- 開く：`http://localhost:3000/governance`・`/governance/theater`・`/requirements`・`/`
- 止める：その端末で Ctrl+C（写しの同期の繰り返しも一緒に止まる）
- 片付ける：`bash docs/drafts/run-public-app.sh --clean`（一時の作業ツリーを消す。ブランチは作っていないので、消すのは作業ツリーだけ）
- 場所とポートを変える：`PUBLIC_APP_DIR=<場所> PUBLIC_APP_PORT=<番号> bash docs/drafts/run-public-app.sh`

## 何をしているか

1. **main の checkout では `next dev` を動かさない。** Next.js は起動のときに未追跡の `AGENTS.md` などを作る。main の checkout に未追跡のファイルができると、裁判所の再開の条件に当たって止まる（11/7 に起きた）
2. **一時の作業ツリー**：`git worktree add --detach $TMPDIR/tsubuyaki-public-app main`。main の今のコミットを、ブランチを作らずに取り出す。2回目からは `checkout --detach main` で最新にする（起動のたびに main に追いつく。動いている間は追わない）
3. **依存**：作業ツリーの中で `npm ci`（`package-lock.json` が変わったときだけ。依存は足さない）
4. **稼働中の写し**：`docs/governance/kernel-state.json`・`kernel-invariants.json` は、裁判所が main の checkout に書く、git で追跡しないファイル。読み込み側が記号リンクを拒むので、**15 秒ごとに写す**（一時の名前に写してから `mv` で置き換える。書きかけを読ませない）。main の側にファイルがなければ、作業ツリーの側も消す（画面は「写しがない」と出す）。画面の Kernel の区画は 60 秒ごとに読み直し、10 分より古ければ「古い写し」と出すので、15 秒の遅れは表示に影響しない
5. **DB**：`TSUBUYAKI_DB_PATH`・`VGDD_REQUIREMENTS_DB_PATH` で main の checkout の `data/` の DB を指す（デモの合成データと要件の回答を共有する）。`data/` の中は git で無視されるので、未追跡のファイルにならない

## 確かめたこと

下の「確かめた結果」に書く。

## 限界

- 作業ツリーの中で画面を直しても main には入らない（読むだけで使う。コードの変更は票で行う）
- 起動の後に main が進んでも、作業ツリーのコードは追わない。新しいコードを見るには、止めてもう一度起動する（写しだけは追う）
- `.env.local` は作業ツリーにないので、AI の機能は API なし（固定の結果）で動く。API キーを使う録画が要るなら、オーナーが作業ツリーに置く（このスクリプトは `.env.local` を読まない・写さない）
