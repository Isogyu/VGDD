// デモ用の合成データ（M7 の前倒し）。
// すべて架空の会社・人物・作業。実在の組織・案件・人名とは関係がない。
// 何度実行しても同じ結果になる（既に入っている作業は追加しない）。
//
// 入れるもの：
//   - 新人A の終了済みの作業 W1「社内向け集計スクリプトの改修」（メモ4件、所要 240 分）
//       ＋ その AI 整理の結果 1件（M4 の形。model は 'demo'）＋ 新人A が承認したチームの知識 1件（M9 の先取り）
//   - 新人A の終了済みの作業 W2「開発環境の構築」（メモ4件）、W3「API 開発」（メモ4件）。整理結果はなし
//     （M4 の実 API 呼び出しと、デモ用 fixture の採取 npm run demo:capture に使う）

import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";
import { addNote, startSession, endSession } from "./sessions";

export const DEMO_TASK_W1 = "社内向け集計スクリプトの改修";
export const DEMO_TASK_W2 = "開発環境の構築";
export const DEMO_TASK_W3 = "API 開発";

interface DemoTask {
  key: "W1" | "W2" | "W3";
  taskName: string;
  startedAt: string;
  endedAt: string;
  memos: [string, string][];
}

/** デモの作業3種類（docs/requirements.md §3）。すべて新人A の終了済みの記録 */
export const DEMO_TASKS: DemoTask[] = [
  {
    key: "W1",
    taskName: DEMO_TASK_W1,
    startedAt: "2026-10-27T10:00:00+09:00",
    endedAt: "2026-10-27T14:00:00+09:00",
    memos: [
      ["2026-10-27T10:05:00+09:00", "月次レポートの出力形式を変える、と依頼された。何を変えるのかがよく分からない"],
      ["2026-10-27T11:30:00+09:00", "AI と壁打ちして、CSV の列順を変える話だと解釈した。合っているか自信がない"],
      ["2026-10-27T13:20:00+09:00", "既存のスクリプトの場所が分からず探し続けた。AI では分からないと気づいた"],
      ["2026-10-27T13:50:00+09:00", "先輩に聞いたら、共有ドライブの tools フォルダにあった。成果物の形も最初に確認すべきだったと言われた"],
    ],
  },
  {
    key: "W2",
    taskName: DEMO_TASK_W2,
    startedAt: "2026-10-29T13:00:00+09:00",
    endedAt: "2026-10-29T14:30:00+09:00",
    memos: [
      ["2026-10-29T13:10:00+09:00", "手順書どおりにコンテナを起動したが、DB に接続できないエラーで止まる"],
      ["2026-10-29T13:40:00+09:00", "ログの見方が分からない。エラーの最後の行だけ読んでいた"],
      ["2026-10-29T14:05:00+09:00", "先輩に、エラーの前後10行を先に読むように言われた。環境変数 DB_HOST が未設定だった"],
      ["2026-10-29T14:25:00+09:00", ".env.example をコピーして差分だけ直すと起動した。手順書にはこの手順が書かれていなかった"],
    ],
  },
  {
    key: "W3",
    taskName: DEMO_TASK_W3,
    startedAt: "2026-10-31T10:00:00+09:00",
    endedAt: "2026-10-31T11:00:00+09:00",
    memos: [
      ["2026-10-31T10:05:00+09:00", "一覧 API の仕様書に「削除済みも返す」とあるが、画面側は返さない前提に見える。どちらが正しいか決めきれない"],
      ["2026-10-31T10:30:00+09:00", "どちらにも読めるので、両方の実装を考え始めて手が止まった"],
      ["2026-10-31T10:45:00+09:00", "先輩に相談。曖昧な仕様は「こう解釈します」と書いて依頼者に送り、返事を待つ間は別の作業をするよう言われた"],
      ["2026-10-31T10:55:00+09:00", "解釈を書いて送った。返事待ちの間にテストの準備を進める"],
    ],
  },
];

export interface SeedResult {
  inserted: boolean;
  /** W1 のセッション ID（M1-4 の確認用） */
  sessionId: number;
  /** 今回入れた作業（W1〜W3 のうち、まだなかったもの） */
  insertedTasks: string[];
  /** reset で消した行数（表ごと） */
  reset?: Record<string, number>;
}

/** デモ用テーブルの全行を消す（開発時のみ。users は残す）。デモのやり直し用 */
export function resetDemoData(db: DatabaseSync = getDb()): Record<string, number> {
  const counts: Record<string, number> = {};
  // 外部キーの順（子 → 親）
  for (const table of ["shared_knowledge", "session_summaries", "notes", "work_sessions"]) {
    const r = db.prepare(`DELETE FROM ${table}`).run();
    counts[table] = Number(r.changes);
  }
  return counts;
}

function findDemoSession(task: DemoTask, db: DatabaseSync): number | undefined {
  const row = db
    .prepare("SELECT id FROM work_sessions WHERE user_id = 'newcomer_a' AND task_name = ? AND started_at = ?")
    .get(task.taskName, task.startedAt) as { id: number } | undefined;
  return row?.id;
}

function insertDemoSession(task: DemoTask, db: DatabaseSync): number {
  // 進行中の作業があると開始できないので、デモ用は force なしで入れられるときだけ入れる
  const r = startSession({ userId: "newcomer_a", taskName: task.taskName }, db, task.startedAt);
  if (!r.ok) throw new Error("新人A に進行中の作業があるため、デモ用の過去の記録を入れられません。先に終了するか、npm run seed -- --reset を使ってください");
  const sid = r.session.id;
  for (const [at, body] of task.memos) addNote({ sessionId: sid, userId: "newcomer_a", body }, db, at);
  endSession(sid, db, task.endedAt);
  return sid;
}

function insertW1Extras(sid: number, db: DatabaseSync): void {
  // AI 整理の結果（M4-1 のスキーマ。各項目に根拠のメモ ID を付ける）
  const noteIds = (db.prepare("SELECT id FROM notes WHERE session_id = ? ORDER BY id").all(sid) as { id: number }[]).map(
    (n) => n.id,
  );
  const summary = {
    schema: "tsubuyaki.summary.v1",
    struggle: { text: "依頼の意図と成果物の形が分からず、既存スクリプトの場所も分からなかった", evidence_note_ids: [noteIds[0], noteIds[2]], inferred: false },
    cause: { text: "依頼時に成果物の条件と既存コードの有無を確認しなかった", evidence_note_ids: [noteIds[3]], inferred: false },
    tried: { text: "AI と壁打ちして依頼内容を解釈し、既存スクリプトを自力で探した", evidence_note_ids: [noteIds[1], noteIds[2]], inferred: false },
    resolution: { text: "先輩に確認し、共有ドライブの tools フォルダにあると分かった", evidence_note_ids: [noteIds[3]], inferred: false },
    decision_reason: { text: "AI で調べられることと、人にしか分からないこと（コードの場所）を分けて、後者は早く人に聞く", evidence_note_ids: [], inferred: true },
    learning: { text: "依頼を受けたら、成果物の形と既存コードの有無を最初に確認する", evidence_note_ids: [noteIds[3]], inferred: false },
    unresolved: { text: "なし", evidence_note_ids: [], inferred: false },
    ask_human: { text: "既存スクリプトの場所、出力形式の具体的な条件", evidence_note_ids: [noteIds[0], noteIds[2]], inferred: false },
    questions: [],
    source_note_ids: noteIds,
  };
  db.prepare("INSERT INTO session_summaries (session_id, json, model, created_at) VALUES (?, ?, 'demo', ?)").run(
    sid,
    JSON.stringify(summary),
    "2026-10-27T14:01:00+09:00",
  );

  // 本人（新人A）が確認して承認した共有知識（M9 の先取り。原文のメモは含まない）
  db.prepare(
    "INSERT INTO shared_knowledge (task_name, user_id, session_id, body, approved_at) VALUES (?, 'newcomer_a', ?, ?, ?)",
  ).run(
    DEMO_TASK_W1,
    sid,
    "依頼を受けたら、成果物の形と既存コードの場所を30分以内に依頼者に確認する。AI で調べられることと、人にしか分からないことを分けてから聞く",
    "2026-10-27T14:10:00+09:00",
  );
}

export function seedDemo(db: DatabaseSync = getDb(), opts: { reset?: boolean } = {}): SeedResult {
  const reset = opts.reset ? resetDemoData(db) : undefined;
  const insertedTasks: string[] = [];
  let w1Id: number | undefined;
  for (const task of DEMO_TASKS) {
    const existing = findDemoSession(task, db);
    if (existing !== undefined) {
      if (task.key === "W1") w1Id = existing;
      continue;
    }
    const sid = insertDemoSession(task, db);
    if (task.key === "W1") {
      w1Id = sid;
      insertW1Extras(sid, db);
    }
    insertedTasks.push(task.key);
  }
  return { inserted: insertedTasks.length > 0, sessionId: w1Id!, insertedTasks, reset };
}
