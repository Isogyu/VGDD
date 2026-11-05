// チームの知恵（S-4、T-015）：本人が承認した共有を、作業名ごとにまとめて返す（読むだけ）。
// 読む表は shared_knowledge と users だけ。原文のメモ（notes）・整理結果（session_summaries）・共有候補（share_candidates）は読まない（M9-3）。
// 取り下げ済み（withdrawn_at が入っている行）は出さない。

import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";

export type TeamKnowledgeItem = {
  id: number;
  display_name: string;
  role: "newcomer" | "senior";
  approved_at: string;
  body: string;
};

export type TeamKnowledgeGroup = {
  task_name: string;
  items: TeamKnowledgeItem[];
};

type Row = TeamKnowledgeItem & { task_name: string };

/** 承認済みで取り下げられていない共有を、作業名の昇順でまとめる。各まとまりは承認日時・id の昇順 */
export function listTeamKnowledge(db: DatabaseSync = getDb()): TeamKnowledgeGroup[] {
  const rows = db
    .prepare(
      `SELECT k.id AS id, k.task_name AS task_name, u.display_name AS display_name, u.role AS role,
              k.approved_at AS approved_at, k.body AS body
         FROM shared_knowledge k
         JOIN users u ON u.id = k.user_id
        WHERE k.withdrawn_at IS NULL
        ORDER BY k.task_name ASC, k.approved_at ASC, k.id ASC`,
    )
    .all() as unknown as Row[];

  const groups: TeamKnowledgeGroup[] = [];
  for (const r of rows) {
    let g = groups[groups.length - 1];
    if (!g || g.task_name !== r.task_name) {
      g = { task_name: r.task_name, items: [] };
      groups.push(g);
    }
    g.items.push({
      id: Number(r.id),
      display_name: r.display_name,
      role: r.role,
      approved_at: r.approved_at,
      body: r.body,
    });
  }
  // 行が0件の作業名はそもそも結果に現れない（共有のない作業名は出さない）
  return groups;
}
