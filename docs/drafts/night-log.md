# 夜の作業の記録（行政の長 Max、2026-11-06 02:00〜。計画 `28_night_plan_max.md`）

形式：時刻・したこと・成果のパス。1つ終えるごとに足す。点検は Claude のサブエージェント（ツールなし）。Codex は sandbox の中から呼べないため未点検（4:00 から立法補佐が行う）。

| 時刻 | したこと | 成果 |
|---|---|---|
| 02:02 | 計画を読み、前提（kernel.md・SPEC・capabilities.json・gate-runner・requirements・関連コード）を確認。Codex CLI はこの環境にない（`codex not found`） | — |
| 02:07 | A：Kernel 改正案 p0.4.3 の下書き（状態の書き出し kernel-state.json、OBS-051 promise、OBS-053 司法の道具の点検、OBS-054 参考の全文、OBS-049 角かっこ）。点検役を起動 | `docs/drafts/kernel-p0.4.3-proposal.md`（45da41a） |
| 02:13 | A の点検（Claude、12件：critical 2・major 5・minor 5、憲法に反する点なし）を反映。表示用の写しと明記、指紋を出さない、停止中の扱いと司法の失敗の上限、参考のコメントの2択。オーナーに聞くこと 6件 | 同上（aa4b61c） |
| 02:17 | B：票 T-draft-kernel-ui の下書き（/governance の先頭に Kernel の区画。置き方の案2つ） | `docs/tasks/drafts/T-draft-kernel-ui.md`（dcc6f01） |
| 02:2x | B の点検（Claude、10件：major 6・minor 4）を反映。検証を fs なしのファイルに分けて画面でも検証、書き出し日時と「古い写し」、表示用の純粋関数と試験、zod 式の全項目 | 同上（0a390a5） |
| 02:3x | C-1：M12 先輩インタビューの票2枚（裏側・画面）。点検（Claude、12件：critical 2・major 7・minor 3）を反映：所有の確認、UNIQUE と UPDATE の件数で同時実行を防ぐ、`done` の後は `ai_done`、外部 API に送る範囲と上限、エラーの対応表、`normalizeTaskName` は `@/lib/commands` | `docs/tasks/drafts/T-draft-m12-interview-api.md`・`T-draft-m12-interview-screen.md` |
| 02:4x | C-5：AGENTS.md の票（生成の出どころを確かめて `agentRules: false` か `.gitignore`。Codex の司法が AGENTS.md を読む経路を p0.4.3 の候補に）、C-6：原案の指紋から `knowledge_id` を外す票。点検役を起動 | `docs/tasks/drafts/T-draft-agents-md.md`・`T-draft-fingerprint-no-id.md` |
| 02:5x | C-2：M11 知らないことマップ、C-3：M14 30分チェックイン（促しの表示だけ。デモ時計は §8 で問う）、C-4：M13 音声でつぶやく（Web Speech API、依存なし、プライバシーを §8 で問う） | `docs/tasks/drafts/T-draft-m11-knowing-map.md`・`T-draft-m14-checkin-prompt.md`・`T-draft-m13-voice-input.md`（9f42d72） |
| 02:3x | C-5・C-6 の点検（8件）と C-2〜C-4 の点検（12件）を反映。D：implementation-notes に「M9・M6-3・M6-2・M5 と画面の経過」の表（票ごとの判断・逸脱・差し戻しの原因）、vgdd-status の K1 を本番で運用中に、K4（状態の書き出しと UI、下書き）を追加 | `docs/implementation-notes.md`・`docs/vgdd-status.md`・票の下書き5枚 |
| 02:4x | E：README の下書き（数字は main から：test 268/22、画面 6、票 22 枚統合、コミット 198、適合性 231。保証できないことを明記）、3分デモの筋書きの下書き（Kernel の画面を 2:20〜、代替の表）。点検役を起動 | `docs/drafts/README.md`・`docs/drafts/demo-script.md`（56c464f） |
| 02:5x | E の点検（Claude、12件：重い 5・中 5・軽 2）を反映。強制の層の表（実装と検証の状態）、数字の出どころと時刻、デモモードは再生で任意の入力に対応しないと明記、Kernel の区画は任意の項目に、「半日 → 30分」は原体験の語り。F-4：アプリの点検（安全・不具合／使いやすさ・アクセシビリティ）の読み取り専用の点検役を2体起動 | 同上（1aa4124） |
| 02:5x | F-2b：今夜の統治の実績のまとめ（12 票の起草→承認→作業→判定→統合の時刻と件数、言えること・言えないこと）。F-3：既知の課題の判例の候補 17 件（前提・操作・期待の形）。F-4：画面の点検の結果（major 6・minor 9、票の案3つ） | `docs/drafts/governance-record-2026-11-05.md`・`conformance-candidates.md`・`review-ui.md`（83364df） |
| 02:5x | F-4：安全と不具合の点検の結果（major 6・minor 9。開発用ルートに Origin の門がなく別サイトから seed --reset が打てる、整理の fixture の採取が今の DB のメモを実 API に送る、答えの機密の門がない、例外の本文が応答に出る、stale の候補が却下できない）。票の案 A〜D | `docs/drafts/review-security.md`（aa77e67） |
| 03:0x | F-2a：比較実験の計画（3条件・5票・指標・言えないこと）、F-2c：適合性の段階（8段階）と重要度別の承認（`risk` の機械的な計算）の設計。F-5：安全の票 A の下書き（開発用ルートの門を共通化、採取をメモリの seed に）。F-1：p0.4.3 案の2回目の点検（既存の試験との衝突・実現性、読み取り専用）を起動 | `docs/drafts/comparison-experiment.md`・`kernel-stages-and-approval-levels.md`・`docs/tasks/drafts/T-draft-dev-routes-guard.md`（9f63f58） |
| 03:0x | F-5：点検から票の下書き3枚（答えの機密の門、stale の候補の却下と上限の1本化、画面の失敗の扱いの統一と `key={session.id}`）。dev-routes の票の点検役（読み取り専用）を起動 | `docs/tasks/drafts/T-draft-answers-flagged-gate.md`・`T-draft-share-stale-reject.md`・`T-draft-ui-error-handling.md`（e98682f） |
| 03:0x | F-5：要件の未着手から票の下書き2枚（S1 共通つまずきの簡易集計＝承認済みの共有から `【つまずき】` の行を拾う、M15 匿名ブレスト＝設計の論点と推奨。C2 は T-015 で実装済み）。3票の点検役（読み取り専用）を起動 | `docs/tasks/drafts/T-draft-s1-common-struggles.md`・`T-draft-m15-anonymous-brainstorm.md` |
