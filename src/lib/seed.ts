// デモ用の合成データ（M7 の前倒し・最小分）。
// すべて架空の会社・人物・作業。実在の組織・案件・人名とは関係がない。
// 何度実行しても同じ結果になる（既に入っていれば追加しない）。
//
// 入れるもの（M1-4 を画面で見せるのに必要な最小分）：
//   - 新人A の終了済みの作業 W1「社内向け集計スクリプトの改修」1本（メモ4件、所要 240 分）
//   - その作業の AI 整理の結果 1件（M4 の形の先取り。model は 'demo'）
//   - 新人A が承認したチームの知識 1件（M9 の先取り）

import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";
import { addNote, startSession, endSession } from "./sessions";

export const DEMO_TASK_W1 = "社内向け集計スクリプトの改修";
const W1_STARTED_AT = "2026-10-27T10:00:00+09:00";
const W1_ENDED_AT = "2026-10-27T14:00:00+09:00";

export interface SeedResult {
  inserted: boolean;
  sessionId: number;
}

export function seedDemo(db: DatabaseSync = getDb()): SeedResult {
  const existing = db
    .prepare("SELECT id FROM work_sessions WHERE user_id = 'newcomer_a' AND task_name = ? AND started_at = ?")
    .get(DEMO_TASK_W1, W1_STARTED_AT) as { id: number } | undefined;
  if (existing) return { inserted: false, sessionId: existing.id };

  // 進行中の作業があると開始できないので、デモ用は force なしで入れられるときだけ入れる
  const r = startSession({ userId: "newcomer_a", taskName: DEMO_TASK_W1 }, db, W1_STARTED_AT);
  if (!r.ok) throw new Error("新人A に進行中の作業があるため、デモ用の過去の記録を入れられません。先に終了してください");
  const sid = r.session.id;

  const memos: [string, string][] = [
    ["2026-10-27T10:05:00+09:00", "月次レポートの出力形式を変える、と依頼された。何を変えるのかがよく分からない"],
    ["2026-10-27T11:30:00+09:00", "AI と壁打ちして、CSV の列順を変える話だと解釈した。合っているか自信がない"],
    ["2026-10-27T13:20:00+09:00", "既存のスクリプトの場所が分からず探し続けた。AI では分からないと気づいた"],
    ["2026-10-27T13:50:00+09:00", "先輩に聞いたら、共有ドライブの tools フォルダにあった。成果物の形も最初に確認すべきだったと言われた"],
  ];
  for (const [at, body] of memos) addNote({ sessionId: sid, userId: "newcomer_a", body }, db, at);
  endSession(sid, db, W1_ENDED_AT);

  // AI 整理の結果（M4-1 のスキーマの先取り。各項目に根拠のメモ ID を付ける）
  const noteIds = (db.prepare("SELECT id FROM notes WHERE session_id = ? ORDER BY id").all(sid) as { id: number }[]).map(
    (n) => n.id,
  );
  const summary = {
    struggle: { text: "依頼の意図と成果物の形が分からず、既存スクリプトの場所も分からなかった", evidence_note_ids: [noteIds[0], noteIds[2]], inferred: false },
    cause: { text: "依頼時に成果物の条件と既存コードの有無を確認しなかった", evidence_note_ids: [noteIds[3]], inferred: false },
    tried: { text: "AI と壁打ちして依頼内容を解釈し、既存スクリプトを自力で探した", evidence_note_ids: [noteIds[1], noteIds[2]], inferred: false },
    resolution: { text: "先輩に確認し、共有ドライブの tools フォルダにあると分かった", evidence_note_ids: [noteIds[3]], inferred: false },
    decision_reason: { text: "AI で調べられることと、人にしか分からないこと（コードの場所）を分けて、後者は早く人に聞く", evidence_note_ids: [noteIds[2], noteIds[3]], inferred: true },
    learning: { text: "依頼を受けたら、成果物の形と既存コードの有無を最初に確認する", evidence_note_ids: [noteIds[3]], inferred: false },
    unresolved: { text: "なし", evidence_note_ids: [], inferred: false },
    ask_human: { text: "既存スクリプトの場所、出力形式の具体的な条件", evidence_note_ids: [noteIds[0], noteIds[2]], inferred: false },
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

  return { inserted: true, sessionId: sid };
}
