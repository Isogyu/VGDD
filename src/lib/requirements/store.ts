// 要件確認（/requirements、T-043）のローカルの保存と、API の入口の検査。サーバー側だけで使う。
// DB は Node の組み込みの node:sqlite で、題材のアプリの DB（data/tsubuyaki.db）とは別のファイルに置く。
// このモジュールは外部への通信・AI の呼び出し・子プロセスの起動をしない。Z3 の中身は読み書きしない
// （DB のパスの検査で、Z3 の根の場所の記号リンクを解くだけ）。例外の本文・パス・SQL は外に出さず、固定の符号だけを返す。

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { nowJst } from "@/lib/time";
import {
  BODY_MAX_BYTES,
  SUGGESTIONS_JSON_MAX_BYTES,
  completeness,
  parseAiSuggestions,
  parseAnswers,
  sameAnswers,
  utf8Bytes,
  type Decision,
  type PutBody,
  type RecordListItem,
  type RequirementRecord,
  type Suggestion,
} from "./model";

// ---------- DB のパスの検査 ----------

export type StoreErrorCode = "db_path_rejected";

/** 固定のエラー。メッセージは符号だけで、パスや環境変数の値を含めない */
export class RequirementsStoreError extends Error {
  readonly code: StoreErrorCode;
  constructor(code: StoreErrorCode) {
    super(code);
    this.name = "RequirementsStoreError";
    this.code = code;
  }
}

export const MEMORY_DB = ":memory:";
export const DEFAULT_DB_RELATIVE = path.join("data", "vgdd-requirements.db");

export interface PathCheckOptions {
  /** 相対パスの基点（既定は process.cwd()） */
  cwd?: string;
  /** ~ の場所（既定は os.homedir()）。Z3 の既定の場所 ~/tsubuyaki-z3 に使う */
  homeDir?: string;
  /** VGDD_Z3_DIR の値（既定は process.env.VGDD_Z3_DIR） */
  z3Dir?: string;
  /** 題材のアプリの DB の指定（既定は process.env.TSUBUYAKI_DB_PATH） */
  appDbPath?: string;
}

function errCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : undefined;
}

/**
 * パスを正規化し、記号リンクの先まで解いた形にする。まだないパスは、あるところまで親をたどって解き、残りの名前をつなぐ。
 * 記号リンクそのものはあるが先がない（解けない）とき、調べられないときは null。
 */
function canonicalPath(p: string): string | null {
  const abs = path.resolve(p);
  let exists = true;
  try {
    fs.lstatSync(abs);
  } catch (e) {
    const c = errCode(e);
    if (c !== "ENOENT" && c !== "ENOTDIR") return null;
    exists = false;
  }
  if (exists) {
    try {
      return fs.realpathSync.native(abs);
    } catch {
      return null;
    }
  }
  const parent = path.dirname(abs);
  if (parent === abs) return null;
  const rp = canonicalPath(parent);
  return rp === null ? null : path.join(rp, path.basename(abs));
}

/** 比べる対象の形（正規化だけの形と、記号リンクを解いた形の両方）。大文字と小文字は区別しない（安全側に倒す） */
function forms(p: string): string[] {
  const out = new Set<string>([path.resolve(p).toLowerCase()]);
  const c = canonicalPath(p);
  if (c !== null) out.add(c.toLowerCase());
  return [...out];
}

function isInside(child: string, root: string): boolean {
  if (child === root) return true;
  const r = root.endsWith(path.sep) ? root : root + path.sep;
  return child.startsWith(r);
}

/**
 * DB のファイルの指定を検査し、開くパス（記号リンクを解いた形）を返す。拒むときは固定のエラー。
 * 許すのは :memory:（試験）と、拡張子が .db で、Z3（~/tsubuyaki-z3 と VGDD_Z3_DIR）の下でなく、
 * 題材のアプリの DB（data/tsubuyaki.db と TSUBUYAKI_DB_PATH）と一致しない指定だけ。
 */
export function resolveDbPath(raw: string | undefined, opts: PathCheckOptions = {}): string {
  const reject = () => new RequirementsStoreError("db_path_rejected");
  if (raw === MEMORY_DB) return MEMORY_DB;
  const cwd = opts.cwd ?? process.cwd();
  const spec = raw === undefined || raw === "" ? DEFAULT_DB_RELATIVE : raw;
  if (spec.includes("\0")) throw reject();
  const abs = path.resolve(cwd, spec);
  const real = canonicalPath(abs);
  if (real === null) throw reject();
  if (path.extname(abs) !== ".db" || path.extname(real) !== ".db") throw reject();

  const targets = [abs.toLowerCase(), real.toLowerCase()];

  const appDb = "appDbPath" in opts ? opts.appDbPath : process.env.TSUBUYAKI_DB_PATH;
  const appDbs = [path.resolve(cwd, "data", "tsubuyaki.db")];
  if (appDb !== undefined && appDb !== "") appDbs.push(path.resolve(cwd, appDb));
  for (const a of appDbs) {
    for (const f of forms(a)) {
      if (targets.includes(f)) throw reject();
    }
  }

  const homeDir = opts.homeDir ?? os.homedir();
  const z3Dir = "z3Dir" in opts ? opts.z3Dir : process.env.VGDD_Z3_DIR;
  const z3Roots = [path.join(homeDir, "tsubuyaki-z3")];
  if (z3Dir !== undefined && z3Dir !== "") z3Roots.push(path.resolve(cwd, z3Dir));
  for (const root of z3Roots) {
    for (const r of forms(root)) {
      if (targets.some((t) => isInside(t, r))) throw reject();
    }
  }
  return real;
}

// ---------- 保存 ----------

export type StoreFailure = "not_found" | "invalid" | "version_conflict" | "too_large";
export type StoreResult<T> = { ok: true; value: T } | { ok: false; code: StoreFailure };

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS requirement_records (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  answers_version INTEGER NOT NULL,
  suggestions_json TEXT NOT NULL,
  decisions_json TEXT NOT NULL,
  suggestions_version INTEGER NOT NULL,
  linked_ticket_id TEXT
)`;

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 記録の ID の形か（形が違う ID は「存在しない記録」として扱う） */
export function isRecordId(v: string): boolean {
  return ID_PATTERN.test(v);
}

type Row = Record<string, unknown>;

/** 保存してある行を記録に戻す。壊れていれば例外（呼び出し側は固定の内部エラーにする） */
function rowToRecord(row: Row): RequirementRecord {
  const answers = parseAnswers(JSON.parse(String(row.answers_json)));
  const suggestions = JSON.parse(String(row.suggestions_json)) as unknown;
  const decisions = JSON.parse(String(row.decisions_json)) as unknown;
  if (answers === null || !Array.isArray(suggestions) || !Array.isArray(decisions)) throw new Error("corrupt");
  if (suggestions.length !== decisions.length) throw new Error("corrupt");
  const linked = row.linked_ticket_id;
  return {
    id: String(row.id),
    title: String(row.title),
    created_at: String(row.created_at),
    answers,
    answers_version: Number(row.answers_version),
    suggestions: suggestions as Suggestion[],
    decisions: decisions as Decision[],
    suggestions_version: Number(row.suggestions_version),
    linked_ticket_id: linked === null || linked === undefined ? null : String(linked),
  };
}

export class RequirementsStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec("PRAGMA busy_timeout = 2000");
    this.db.exec(SCHEMA_SQL);
  }

  close(): void {
    this.db.close();
  }

  /** 1つのトランザクションで fn を行う。例外のときは戻す */
  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // 戻せないときも元の例外を返す
      }
      throw e;
    }
  }

  private row(id: string): Row | undefined {
    return this.db.prepare("SELECT * FROM requirement_records WHERE id = ?").get(id) as Row | undefined;
  }

  list(): RecordListItem[] {
    const rows = this.db
      .prepare("SELECT id, title, created_at, answers_json FROM requirement_records ORDER BY created_at DESC, rowid DESC")
      .all() as Row[];
    return rows.map((r) => {
      const answers = parseAnswers(JSON.parse(String(r.answers_json)));
      if (answers === null) throw new Error("corrupt");
      return { id: String(r.id), title: String(r.title), created_at: String(r.created_at), ready: completeness(answers).ready };
    });
  }

  get(id: string): RequirementRecord | null {
    if (!isRecordId(id)) return null;
    const r = this.row(id);
    return r === undefined ? null : rowToRecord(r);
  }

  /** 題だけで作る。title は parseCreateBody を通したもの */
  create(title: string): RequirementRecord {
    const rec: RequirementRecord = {
      id: randomUUID(),
      title,
      created_at: nowJst(),
      answers: {},
      answers_version: 0,
      suggestions: [],
      decisions: [],
      suggestions_version: 0,
      linked_ticket_id: null,
    };
    this.db
      .prepare(
        `INSERT INTO requirement_records
          (id, title, created_at, answers_json, answers_version, suggestions_json, decisions_json, suggestions_version, linked_ticket_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(rec.id, rec.title, rec.created_at, "{}", 0, "[]", "[]", 0, null);
    return rec;
  }

  /**
   * 回答の保存。版の比較・更新・版の加算を1つのトランザクションで行う。今の answers_version と違えば version_conflict。
   * 回答が変わったときは、前の AI の提案と採否を無効にし（空にし）、suggestions_version を1つ増やす。
   */
  saveAnswers(id: string, body: PutBody): StoreResult<RequirementRecord> {
    if (!isRecordId(id)) return { ok: false, code: "not_found" };
    return this.tx((): StoreResult<RequirementRecord> => {
      const r = this.row(id);
      if (r === undefined) return { ok: false, code: "not_found" };
      const cur = rowToRecord(r);
      if (cur.answers_version !== body.answers_version) return { ok: false, code: "version_conflict" };
      const changed = !sameAnswers(cur.answers, body.answers);
      const next: RequirementRecord = {
        ...cur,
        answers: body.answers,
        answers_version: cur.answers_version + 1,
        suggestions: changed ? [] : cur.suggestions,
        decisions: changed ? [] : cur.decisions,
        suggestions_version: changed ? cur.suggestions_version + 1 : cur.suggestions_version,
        linked_ticket_id: body.linked_ticket_id,
      };
      const res = this.db
        .prepare(
          `UPDATE requirement_records
              SET answers_json = ?, answers_version = ?, suggestions_json = ?, decisions_json = ?,
                  suggestions_version = ?, linked_ticket_id = ?
            WHERE id = ? AND answers_version = ?`,
        )
        .run(
          JSON.stringify(next.answers),
          next.answers_version,
          JSON.stringify(next.suggestions),
          JSON.stringify(next.decisions),
          next.suggestions_version,
          next.linked_ticket_id,
          id,
          body.answers_version,
        );
      if (Number(res.changes) !== 1) return { ok: false, code: "version_conflict" };
      return { ok: true, value: next };
    });
  }

  /**
   * AI の提案の取り込み。トランザクションの中で、最新の記録（record_id と answers_version）に対して検証し直して保存する。
   * 合わなければ invalid。前の提案と採否は置き換え、採否はすべて未決定にし、suggestions_version を1つ増やす。
   */
  importSuggestions(id: string, payload: unknown): StoreResult<RequirementRecord> {
    if (!isRecordId(id)) return { ok: false, code: "not_found" };
    return this.tx((): StoreResult<RequirementRecord> => {
      const r = this.row(id);
      if (r === undefined) return { ok: false, code: "not_found" };
      const cur = rowToRecord(r);
      const suggestions = parseAiSuggestions(payload, cur);
      if (suggestions === null) return { ok: false, code: "invalid" };
      const sj = JSON.stringify(suggestions);
      if (utf8Bytes(sj) > SUGGESTIONS_JSON_MAX_BYTES) return { ok: false, code: "too_large" };
      const decisions: Decision[] = suggestions.map(() => "pending");
      const res = this.db
        .prepare(
          `UPDATE requirement_records
              SET suggestions_json = ?, decisions_json = ?, suggestions_version = ?
            WHERE id = ? AND answers_version = ? AND suggestions_version = ?`,
        )
        .run(sj, JSON.stringify(decisions), cur.suggestions_version + 1, id, cur.answers_version, cur.suggestions_version);
      if (Number(res.changes) !== 1) return { ok: false, code: "version_conflict" };
      return { ok: true, value: { ...cur, suggestions, decisions, suggestions_version: cur.suggestions_version + 1 } };
    });
  }

  /** 提案ごとの採否の更新。answers_version・suggestions_version のどちらかが古ければ version_conflict。成功すると suggestions_version を1つ増やす */
  decide(
    id: string,
    d: { answers_version: number; suggestions_version: number; index: number; decision: Decision },
  ): StoreResult<RequirementRecord> {
    if (!isRecordId(id)) return { ok: false, code: "not_found" };
    return this.tx((): StoreResult<RequirementRecord> => {
      const r = this.row(id);
      if (r === undefined) return { ok: false, code: "not_found" };
      const cur = rowToRecord(r);
      if (cur.answers_version !== d.answers_version || cur.suggestions_version !== d.suggestions_version) {
        return { ok: false, code: "version_conflict" };
      }
      if (d.index >= cur.suggestions.length) return { ok: false, code: "invalid" };
      const decisions = [...cur.decisions];
      decisions[d.index] = d.decision;
      const res = this.db
        .prepare(
          `UPDATE requirement_records SET decisions_json = ?, suggestions_version = ?
            WHERE id = ? AND answers_version = ? AND suggestions_version = ?`,
        )
        .run(JSON.stringify(decisions), cur.suggestions_version + 1, id, d.answers_version, d.suggestions_version);
      if (Number(res.changes) !== 1) return { ok: false, code: "version_conflict" };
      return { ok: true, value: { ...cur, decisions, suggestions_version: cur.suggestions_version + 1 } };
    });
  }
}

/** DB の指定を検査してから開く。拒むときは RequirementsStoreError（db_path_rejected） */
export function openRequirementsStore(raw: string | undefined, opts: PathCheckOptions = {}): RequirementsStore {
  const p = resolveDbPath(raw, opts);
  if (p !== MEMORY_DB) fs.mkdirSync(path.dirname(p), { recursive: true });
  return new RequirementsStore(new DatabaseSync(p));
}

let shared: RequirementsStore | null = null;

/** API が使う共有の保存。VGDD_REQUIREMENTS_DB_PATH（なければ data/vgdd-requirements.db）を開く */
export function getRequirementsStore(): RequirementsStore {
  if (shared === null) shared = openRequirementsStore(process.env.VGDD_REQUIREMENTS_DB_PATH);
  return shared;
}

/** 共有の保存を閉じる（試験で記録を空からやり直すときに使う） */
export function closeRequirementsStore(): void {
  if (shared !== null) {
    shared.close();
    shared = null;
  }
}

// ---------- API の入口の検査 ----------

export interface GuardFailure {
  status: 400 | 403 | 413 | 415;
  error: "forbidden_host" | "forbidden_origin" | "unsupported_media_type" | "payload_too_large" | "invalid_body";
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Host の形：localhost・127.0.0.1・[::1] に、任意のポート（数字1〜5桁）。ポートは問わない */
const LOOPBACK_HOST_HEADER = /^(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?$/;

/**
 * ローカルの要求だけを通す。要求の URL と Host の両方が loopback でなければ 403。Host が欠けている・形が違うときも 403。
 * すべてのメソッドで、記録の存在の確認・本文の読み取りより前に呼ぶ。
 */
export function checkLoopback(req: Request): GuardFailure | null {
  const deny: GuardFailure = { status: 403, error: "forbidden_host" };
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return deny;
  }
  if (!LOOPBACK_HOSTNAMES.has(url.hostname)) return deny;
  const host = req.headers.get("host");
  if (host === null) return deny;
  if (!LOOPBACK_HOST_HEADER.test(host.toLowerCase())) return deny;
  return null;
}

/**
 * 更新（POST・PUT）の見出しの検査。Origin が欠けている・同じ origin でないときは 403、Content-Type が application/json でないときは 415。
 * 同じ origin は、要求の URL の origin と、Host から作った origin の両方と一致すること。CORS の許可は返さない。
 */
export function checkUpdateHeaders(req: Request): GuardFailure | null {
  const origin = req.headers.get("origin");
  if (origin === null || origin === "" || origin === "null") return { status: 403, error: "forbidden_origin" };
  let o: URL;
  let u: URL;
  try {
    o = new URL(origin);
    u = new URL(req.url);
  } catch {
    return { status: 403, error: "forbidden_origin" };
  }
  const host = (req.headers.get("host") ?? "").toLowerCase();
  // Origin は origin の直列化そのもの（パス・利用者の情報などを含まない）であること
  if (o.origin !== origin) return { status: 403, error: "forbidden_origin" };
  if (o.origin !== u.origin || o.host !== host) return { status: 403, error: "forbidden_origin" };

  const ct = req.headers.get("content-type");
  if (ct === null) return { status: 415, error: "unsupported_media_type" };
  const [type, ...params] = ct.split(";").map((s) => s.trim().toLowerCase());
  if (type !== "application/json") return { status: 415, error: "unsupported_media_type" };
  for (const p of params) {
    if (p.startsWith("charset=") && p !== "charset=utf-8" && p !== 'charset="utf-8"') {
      return { status: 415, error: "unsupported_media_type" };
    }
  }
  return null;
}

/**
 * 本文を読みながら UTF-8 のバイト数を数え、limit を超えた時点で読むのをやめて 413。Content-Length は見ない。
 * UTF-8 として正しくない・JSON でない・本文がないときは 400。
 */
export async function readJsonBody(
  req: Request,
  limit: number = BODY_MAX_BYTES,
): Promise<{ ok: true; value: unknown } | { ok: false; failure: GuardFailure }> {
  const bad = { ok: false as const, failure: { status: 400 as const, error: "invalid_body" as const } };
  const body = req.body;
  if (body === null) return bad;
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => {});
        return { ok: false, failure: { status: 413, error: "payload_too_large" } };
      }
      chunks.push(value);
    }
  } catch {
    return bad;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // 解放できなくても結果は変えない
    }
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return bad;
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return bad;
  }
}
