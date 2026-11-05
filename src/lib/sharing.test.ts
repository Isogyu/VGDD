import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { resetDemoData } from "./seed";
import { addNote, endSession, getKnowledgeHints, startSession } from "./sessions";
import { SUMMARY_KEYS, type Summary, type SummaryItem, type SummaryKey } from "./summary-schema";
import {
  SHARE_KEYS,
  buildShareDraft,
  createShareCandidate,
  decideShare,
  listShareRecords,
  withdrawShare,
  type ShareCandidate,
} from "./sharing";

const OWNER = "newcomer_a";
const OTHER = "newcomer_b";
const TASK = "架空の集計作業";

const evidenced = (text: string): SummaryItem => ({ text, evidence_note_ids: [1], inferred: false, status: "evidenced" });
const inferred = (text: string): SummaryItem => ({ text, evidence_note_ids: [], inferred: true, status: "inferred" });
const none = (): SummaryItem => ({ text: "なし", evidence_note_ids: [], inferred: false, status: "none" });

/** 8項目すべてに本文のある整理結果。over で項目を差し替える */
function makeSummary(over: Partial<Record<SummaryKey, SummaryItem>> = {}): Summary {
  const items = Object.fromEntries(SUMMARY_KEYS.map((k) => [k, evidenced(`${k} の本文`)])) as Record<SummaryKey, SummaryItem>;
  return { schema: "tsubuyaki.summary.v1", ...items, ...over, questions: [], source_note_ids: [1] };
}

function insertSummary(db: DatabaseSync, sessionId: number, json: string): number {
  const r = db
    .prepare("INSERT INTO session_summaries (session_id, json, model, created_at) VALUES (?, ?, 'demo', '2026-11-03T14:00:00+09:00')")
    .run(sessionId, json);
  return Number(r.lastInsertRowid);
}

function startedSession(db: DatabaseSync): number {
  const r = startSession({ userId: OWNER, taskName: TASK }, db, "2026-11-03T13:00:00+09:00");
  if (!r.ok) throw new Error("開始できない");
  return r.session.id;
}

/** 終了済みの作業と整理結果を用意する */
function prepare(summary: Summary = makeSummary()) {
  const db = openDb(":memory:");
  const sessionId = startedSession(db);
  endSession(sessionId, db, "2026-11-03T13:30:00+09:00");
  const summaryId = insertSummary(db, sessionId, JSON.stringify(summary));
  return { db, sessionId, summaryId };
}

function createOk(db: DatabaseSync, sessionId: number): ShareCandidate {
  const r = createShareCandidate(sessionId, OWNER, db);
  if (!r.ok) throw new Error(r.error);
  return r.candidate;
}

function knowledgeCount(db: DatabaseSync): number {
  return (db.prepare("SELECT count(*) c FROM shared_knowledge").get() as { c: number }).c;
}

function teamTexts(db: DatabaseSync): string[] {
  return getKnowledgeHints(OWNER, TASK, db).teamKnowledge.map((k) => k.text);
}

describe("buildShareDraft", () => {
  it("①4項目の順に並べ、none を飛ばし、inferred に（AI の推測）を付ける", () => {
    expect(SHARE_KEYS).toEqual(["struggle", "resolution", "decision_reason", "learning"]);
    const draft = buildShareDraft(
      makeSummary({
        struggle: evidenced("場所が分からない"),
        resolution: none(),
        decision_reason: inferred("早く聞くため"),
        learning: evidenced("最初に確認する"),
      }),
    );
    expect(draft).toBe("【つまずき】場所が分からない\n【判断の理由】早く聞くため（AI の推測）\n【学び】最初に確認する");
  });

  it("①4項目すべてが none なら null", () => {
    expect(buildShareDraft(makeSummary({ struggle: none(), resolution: none(), decision_reason: none(), learning: none() }))).toBeNull();
  });

  it("①他の項目（cause・tried・unresolved・ask_human）は本文に入らない", () => {
    const draft = buildShareDraft(makeSummary());
    for (const key of ["cause", "tried", "unresolved", "ask_human"]) expect(draft).not.toContain(key);
  });

  it("status のない古いデータは本文から状態を判定し、項目が欠けていれば none とする", () => {
    const old = {
      schema: "tsubuyaki.summary.v1",
      struggle: { text: "古い形の本文", evidence_note_ids: [], inferred: true },
      resolution: { text: "なし", evidence_note_ids: [], inferred: false },
      learning: { text: "根拠の配列がない" },
    } as unknown as Summary;
    expect(buildShareDraft(old)).toBe("【つまずき】古い形の本文（AI の推測）\n【学び】根拠の配列がない（AI の推測）");
  });

  it("⑬item.text の改行（\\r\\n・\\n・\\r）は半角空白1つになる", () => {
    const { db, sessionId } = prepare(
      makeSummary({ struggle: evidenced("一\r\n二\n三\r四"), resolution: none(), decision_reason: none(), learning: none() }),
    );
    expect(createOk(db, sessionId).draft_body).toBe("【つまずき】一 二 三 四");
  });
});

describe("createShareCandidate", () => {
  it("②作業がない → session_not_found", () => {
    const db = openDb(":memory:");
    expect(createShareCandidate(999, OWNER, db)).toEqual({ ok: false, error: "session_not_found" });
  });

  it("②他人の作業 → not_your_session", () => {
    const { db, sessionId } = prepare();
    expect(createShareCandidate(sessionId, OTHER, db)).toEqual({ ok: false, error: "not_your_session" });
  });

  it("②進行中の作業 → session_active", () => {
    const db = openDb(":memory:");
    const sessionId = startedSession(db);
    insertSummary(db, sessionId, JSON.stringify(makeSummary()));
    expect(createShareCandidate(sessionId, OWNER, db)).toEqual({ ok: false, error: "session_active" });
  });

  it("②整理結果がない → no_summary", () => {
    const db = openDb(":memory:");
    const sessionId = startedSession(db);
    endSession(sessionId, db);
    expect(createShareCandidate(sessionId, OWNER, db)).toEqual({ ok: false, error: "no_summary" });
  });

  it("②共有できる項目がない → nothing_to_share（行は作らない）", () => {
    const { db, sessionId } = prepare(makeSummary({ struggle: none(), resolution: none(), decision_reason: none(), learning: none() }));
    expect(createShareCandidate(sessionId, OWNER, db)).toEqual({ ok: false, error: "nothing_to_share" });
    expect(listShareRecords(OWNER, db)).toEqual([]);
  });

  it("新しい候補は pending で、作業名と整理の版を持ち、メモの本文を含まない", () => {
    const { db, sessionId, summaryId } = prepare();
    addNote({ sessionId, userId: OWNER, body: "メモだけに書いた原文" }, db);
    const r = createShareCandidate(sessionId, OWNER, db);
    expect(r.ok && r.created).toBe(true);
    if (!r.ok) throw new Error(r.error);
    expect(r.candidate).toMatchObject({
      session_id: sessionId,
      user_id: OWNER,
      task_name: TASK,
      summary_id: summaryId,
      status: "pending",
      action: null,
      final_body: null,
      knowledge_id: null,
      stale: false,
      flags: [],
    });
    expect(r.candidate.draft_body).not.toContain("メモだけに書いた原文");
  });

  it("③同じ版で2回呼ぶと、2回目は created: false で同じ id", () => {
    const { db, sessionId } = prepare();
    const first = createShareCandidate(sessionId, OWNER, db);
    const second = createShareCandidate(sessionId, OWNER, db);
    expect(first.ok && first.created).toBe(true);
    expect(second.ok && second.created).toBe(false);
    expect(second.ok && second.candidate.id).toBe(first.ok && first.candidate.id);
    expect(listShareRecords(OWNER, db)).toHaveLength(1);
  });

  it("idx_share_pending の一意の違反になったら、既存の候補を created: false で返す", () => {
    const { db, sessionId } = prepare();
    const existing = createOk(db, sessionId);
    // 事前の確認をすり抜けて INSERT まで進んだ場合を、最初の SELECT だけ「なし」にして再現する
    const realPrepare = db.prepare.bind(db);
    let hidden = false;
    db.prepare = ((sql: string) => {
      if (!hidden && sql.includes("status = 'pending'") && sql.startsWith("SELECT")) {
        hidden = true;
        return { get: () => undefined };
      }
      return realPrepare(sql);
    }) as typeof db.prepare;
    const r = createShareCandidate(sessionId, OWNER, db);
    expect(hidden).toBe(true);
    expect(r.ok && r.created).toBe(false);
    expect(r.ok && r.candidate.id).toBe(existing.id);
    expect(db.isTransaction).toBe(false);
  });

  it("draft_body の機密検査の結果が flags に入る", () => {
    const { db, sessionId } = prepare(makeSummary({ struggle: evidenced("ホクト製菓の件") }));
    expect(createOk(db, sessionId).flags.map((f) => f.match)).toEqual(["ホクト製菓"]);
  });
});

describe("decideShare", () => {
  it("④approve で shared_knowledge に1行でき、teamKnowledge に出る", () => {
    const { db, sessionId } = prepare();
    const c = createOk(db, sessionId);
    const r = decideShare(c.id, OWNER, { action: "approve" }, db);
    if (!r.ok) throw new Error(r.error);
    expect(r.candidate).toMatchObject({ status: "approved", action: "approve", final_body: c.draft_body, stale: false });
    expect(r.candidate.knowledge_id).not.toBeNull();
    expect(r.candidate.decided_at).not.toBeNull();
    expect(knowledgeCount(db)).toBe(1);
    expect(db.prepare("SELECT task_name, user_id, session_id, body FROM shared_knowledge WHERE id = ?").get(r.candidate.knowledge_id)).toEqual({
      task_name: TASK,
      user_id: OWNER,
      session_id: sessionId,
      body: c.draft_body,
    });
    expect(teamTexts(db)).toEqual([c.draft_body]);
  });

  it("⑤edit_approve の本文（前後の空白を落とす）が final_body と shared_knowledge.body になる", () => {
    const { db, sessionId } = prepare();
    const c = createOk(db, sessionId);
    const r = decideShare(c.id, OWNER, { action: "edit_approve", body: "  \n直した本文。\n二行目。\n " }, db);
    if (!r.ok) throw new Error(r.error);
    expect(r.candidate.action).toBe("edit_approve");
    expect(r.candidate.final_body).toBe("直した本文。\n二行目。");
    expect(r.candidate.draft_body).toBe(c.draft_body);
    expect(teamTexts(db)).toEqual(["直した本文。\n二行目。"]);
  });

  it("⑤edit_approve の空の本文は empty_body（何も書かない）", () => {
    const { db, sessionId } = prepare();
    const c = createOk(db, sessionId);
    expect(decideShare(c.id, OWNER, { action: "edit_approve", body: " \n " }, db)).toEqual({ ok: false, error: "empty_body" });
    expect(decideShare(c.id, OWNER, { action: "edit_approve" }, db)).toEqual({ ok: false, error: "empty_body" });
    expect(knowledgeCount(db)).toBe(0);
    expect(listShareRecords(OWNER, db)[0].status).toBe("pending");
  });

  it("⑥reject で shared_knowledge が増えず、2回目の決定は already_decided", () => {
    const { db, sessionId } = prepare();
    const c = createOk(db, sessionId);
    const r = decideShare(c.id, OWNER, { action: "reject", reason: "  まだ早い " }, db);
    if (!r.ok) throw new Error(r.error);
    expect(r.candidate).toMatchObject({ status: "rejected", action: "reject", reject_reason: "まだ早い", final_body: null, knowledge_id: null });
    expect(knowledgeCount(db)).toBe(0);
    expect(decideShare(c.id, OWNER, { action: "approve" }, db)).toEqual({ ok: false, error: "already_decided" });
    expect(decideShare(c.id, OWNER, { action: "reject" }, db)).toEqual({ ok: false, error: "already_decided" });
    expect(knowledgeCount(db)).toBe(0);
  });

  it("reject の理由：空は NULL、500 文字まで可、超えれば reason_too_long", () => {
    const { db, sessionId, summaryId } = prepare();
    const c = createOk(db, sessionId);
    expect(decideShare(c.id, OWNER, { action: "reject", reason: "あ".repeat(501) }, db)).toEqual({ ok: false, error: "reason_too_long" });
    const r = decideShare(c.id, OWNER, { action: "reject", reason: "  " }, db);
    expect(r.ok && r.candidate.reject_reason).toBeNull();

    // 却下の後は同じ版でも新しい候補を作れる
    const again = createShareCandidate(sessionId, OWNER, db);
    if (!again.ok) throw new Error(again.error);
    expect(again.created).toBe(true);
    expect(again.candidate.summary_id).toBe(summaryId);
    const long = decideShare(again.candidate.id, OWNER, { action: "reject", reason: "あ".repeat(500) }, db);
    expect(long.ok && long.candidate.reject_reason).toHaveLength(500);
  });

  it("⑦整理をもう1行足した後の古い候補は stale: true で、approve は stale_candidate", () => {
    const { db, sessionId } = prepare();
    const c = createOk(db, sessionId);
    expect(c.stale).toBe(false);
    insertSummary(db, sessionId, JSON.stringify(makeSummary()));
    expect(listShareRecords(OWNER, db)[0].stale).toBe(true);
    expect(decideShare(c.id, OWNER, { action: "approve" }, db)).toEqual({ ok: false, error: "stale_candidate" });
    expect(decideShare(c.id, OWNER, { action: "reject" }, db)).toEqual({ ok: false, error: "stale_candidate" });
    expect(knowledgeCount(db)).toBe(0);
    expect(listShareRecords(OWNER, db)[0].status).toBe("pending");
  });

  it("⑧登録語句を含む本文の edit_approve は confirmFlagged なしで flagged_body、ありで承認", () => {
    const { db, sessionId } = prepare();
    const c = createOk(db, sessionId);
    const body = "ホクト製菓の件で確認した";
    const refused = decideShare(c.id, OWNER, { action: "edit_approve", body }, db);
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error("承認されてはいけない");
    expect(refused.error).toBe("flagged_body");
    expect(refused.flags?.map((f) => f.match)).toEqual(["ホクト製菓"]);
    expect(knowledgeCount(db)).toBe(0);

    const r = decideShare(c.id, OWNER, { action: "edit_approve", body, confirmFlagged: true }, db);
    expect(r.ok && r.candidate.final_body).toBe(body);
    expect(knowledgeCount(db)).toBe(1);
  });

  it("⑧登録語句を含む下書きの approve も confirmFlagged を求める", () => {
    const { db, sessionId } = prepare(makeSummary({ struggle: evidenced("ホクト製菓の件") }));
    const c = createOk(db, sessionId);
    const refused = decideShare(c.id, OWNER, { action: "approve" }, db);
    expect(!refused.ok && refused.error).toBe("flagged_body");
    expect(decideShare(c.id, OWNER, { action: "approve", confirmFlagged: true }, db).ok).toBe(true);
  });

  it("⑪最新の整理の行の json が読めないとき、pending の候補は stale: true で approve は stale_candidate", () => {
    const { db, sessionId } = prepare();
    const c = createOk(db, sessionId);
    insertSummary(db, sessionId, "{壊れた JSON");
    expect(listShareRecords(OWNER, db)[0].stale).toBe(true);
    expect(decideShare(c.id, OWNER, { action: "approve" }, db)).toEqual({ ok: false, error: "stale_candidate" });
    expect(knowledgeCount(db)).toBe(0);
    expect(createShareCandidate(sessionId, OWNER, db)).toEqual({ ok: false, error: "no_summary" });
  });

  it("⑫approve で draft_body が 2000 文字を超える候補は body_too_long。編集すれば承認できる", () => {
    const { db, sessionId } = prepare(makeSummary({ struggle: evidenced("あ".repeat(2001)) }));
    const c = createOk(db, sessionId);
    expect(c.draft_body.length).toBeGreaterThan(2000);
    expect(decideShare(c.id, OWNER, { action: "approve" }, db)).toEqual({ ok: false, error: "body_too_long" });
    expect(decideShare(c.id, OWNER, { action: "approve", confirmFlagged: true }, db)).toEqual({ ok: false, error: "body_too_long" });
    expect(decideShare(c.id, OWNER, { action: "edit_approve", body: "あ".repeat(2001) }, db)).toEqual({ ok: false, error: "body_too_long" });
    expect(knowledgeCount(db)).toBe(0);
    const r = decideShare(c.id, OWNER, { action: "edit_approve", body: "あ".repeat(2000) }, db);
    expect(r.ok && r.candidate.final_body).toHaveLength(2000);
  });

  it("ない候補は share_not_found", () => {
    const db = openDb(":memory:");
    expect(decideShare(999, OWNER, { action: "approve" }, db)).toEqual({ ok: false, error: "share_not_found" });
    expect(db.isTransaction).toBe(false);
  });
});

describe("withdrawShare と listShareRecords", () => {
  it("⑨取り下げた後は teamKnowledge に出ず、知識と候補に同じ時刻が入る", () => {
    const { db, sessionId } = prepare();
    const c = createOk(db, sessionId);
    const approved = decideShare(c.id, OWNER, { action: "approve" }, db);
    if (!approved.ok) throw new Error(approved.error);
    expect(teamTexts(db)).toHaveLength(1);

    const r = withdrawShare(c.id, OWNER, db);
    if (!r.ok) throw new Error(r.error);
    expect(r.candidate.status).toBe("withdrawn");
    expect(r.candidate.withdrawn_at).not.toBeNull();
    const k = db.prepare("SELECT withdrawn_at FROM shared_knowledge WHERE id = ?").get(approved.candidate.knowledge_id) as { withdrawn_at: string };
    expect(k.withdrawn_at).toBe(r.candidate.withdrawn_at);
    expect(teamTexts(db)).toEqual([]);
  });

  it("⑨approved でない候補は not_approved", () => {
    const { db, sessionId } = prepare();
    const c = createOk(db, sessionId);
    expect(withdrawShare(c.id, OWNER, db)).toEqual({ ok: false, error: "not_approved" });
    decideShare(c.id, OWNER, { action: "approve" }, db);
    expect(withdrawShare(c.id, OWNER, db).ok).toBe(true);
    expect(withdrawShare(c.id, OWNER, db)).toEqual({ ok: false, error: "not_approved" });
    expect(withdrawShare(999, OWNER, db)).toEqual({ ok: false, error: "share_not_found" });
  });

  it("⑩他人の userId は not_your_share", () => {
    const { db, sessionId } = prepare();
    const c = createOk(db, sessionId);
    expect(decideShare(c.id, OTHER, { action: "approve" }, db)).toEqual({ ok: false, error: "not_your_share" });
    expect(knowledgeCount(db)).toBe(0);
    decideShare(c.id, OWNER, { action: "approve" }, db);
    expect(withdrawShare(c.id, OTHER, db)).toEqual({ ok: false, error: "not_your_share" });
    expect(teamTexts(db)).toHaveLength(1);
  });

  it("⑩listShareRecords は本人の候補を id の降順で返し、他人の候補を出さない", () => {
    const { db, sessionId } = prepare();
    const first = createOk(db, sessionId);
    decideShare(first.id, OWNER, { action: "reject" }, db);
    const second = createOk(db, sessionId);
    expect(listShareRecords(OWNER, db).map((c) => c.id)).toEqual([second.id, first.id]);
    expect(listShareRecords(OTHER, db)).toEqual([]);
  });
});

describe("途中失敗の巻き戻し", () => {
  const FAIL_UPDATE = `CREATE TRIGGER fail_share_update BEFORE UPDATE ON share_candidates
    BEGIN SELECT RAISE(ABORT, '試験用の失敗'); END`;

  function snapshot(db: DatabaseSync, id: number) {
    return {
      knowledge: db.prepare("SELECT * FROM shared_knowledge ORDER BY id").all(),
      candidate: db.prepare("SELECT * FROM share_candidates WHERE id = ?").get(id),
    };
  }

  it("⑭approve の候補の更新が失敗すると、shared_knowledge も候補も呼び出しの前のまま", () => {
    const { db, sessionId } = prepare();
    const c = createOk(db, sessionId);
    db.exec(FAIL_UPDATE);
    const before = snapshot(db, c.id);
    expect(() => decideShare(c.id, OWNER, { action: "approve" }, db)).toThrow();
    expect(snapshot(db, c.id)).toEqual(before);
    expect(knowledgeCount(db)).toBe(0);
    expect(db.isTransaction).toBe(false);

    // 原因を除けば、同じ候補をそのまま承認できる
    db.exec("DROP TRIGGER fail_share_update");
    expect(decideShare(c.id, OWNER, { action: "approve" }, db).ok).toBe(true);
    expect(knowledgeCount(db)).toBe(1);
  });

  it("⑭withdrawShare の候補の更新が失敗すると、withdrawn_at も候補も呼び出しの前のまま", () => {
    const { db, sessionId } = prepare();
    const c = createOk(db, sessionId);
    decideShare(c.id, OWNER, { action: "approve" }, db);
    db.exec(FAIL_UPDATE);
    const before = snapshot(db, c.id);
    expect(() => withdrawShare(c.id, OWNER, db)).toThrow();
    expect(snapshot(db, c.id)).toEqual(before);
    expect(teamTexts(db)).toHaveLength(1);
    expect(db.isTransaction).toBe(false);

    db.exec("DROP TRIGGER fail_share_update");
    expect(withdrawShare(c.id, OWNER, db).ok).toBe(true);
    expect(teamTexts(db)).toEqual([]);
  });
});

describe("デモのリセット（A11）", () => {
  function count(db: DatabaseSync, table: string): number {
    return (db.prepare(`SELECT count(*) c FROM ${table}`).get() as { c: number }).c;
  }

  it("承認済み・未決定・取り下げ済みの候補がある DB でも resetDemoData は外部キーの違反にならず、share_candidates は 0 行になる", () => {
    const { db, sessionId } = prepare();
    const approved = createOk(db, sessionId);
    decideShare(approved.id, OWNER, { action: "approve" }, db);
    // 取り下げ済みの候補も残す
    const withdrawn = createOk(db, sessionId);
    decideShare(withdrawn.id, OWNER, { action: "approve" }, db);
    withdrawShare(withdrawn.id, OWNER, db);
    // 未決定の候補も残す
    createOk(db, sessionId);
    expect(count(db, "share_candidates")).toBe(3);
    expect(count(db, "shared_knowledge")).toBe(2);

    const r = resetDemoData(db);
    expect(r).toEqual({ share_candidates: 3, shared_knowledge: 2, session_summaries: 1, notes: 0, work_sessions: 1 });
    expect(count(db, "share_candidates")).toBe(0);
    expect(count(db, "shared_knowledge")).toBe(0);
    expect(count(db, "work_sessions")).toBe(0);
    expect(count(db, "users")).toBeGreaterThan(0);
  });
});
