// DB 接続：Node 組み込みの node:sqlite（DatabaseSync）を使う。
// better-sqlite3 は sandbox でネイティブのビルドが失敗するため採用しない（docs/environment.md）。
// Node 25 では ExperimentalWarning が出る。README に記載する。
//
// サーバー側（Route Handler / Server Component）からだけ import する。

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export type UserRole = "newcomer" | "senior";
export interface User {
  id: string;
  display_name: string;
  role: UserRole;
}

/** 固定の架空ユーザー（認証なし。デモ用。実在の人物ではない） */
export const SEED_USERS: User[] = [
  { id: "newcomer_a", display_name: "新人A", role: "newcomer" },
  { id: "newcomer_b", display_name: "新人B", role: "newcomer" },
  { id: "senior_c", display_name: "先輩C", role: "senior" },
];

const SCHEMA_PATH = path.join(process.cwd(), "src", "lib", "db", "schema.sql");

/** DB ファイルの場所。環境変数で差し替え可。テストは ':memory:' を使う */
export function dbPath(): string {
  return process.env.TSUBUYAKI_DB_PATH || path.join(process.cwd(), "data", "tsubuyaki.db");
}

/** スキーマを適用し、固定ユーザーを投入する（何度呼んでも同じ結果） */
export function initializeDb(db: DatabaseSync): void {
  const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schema);
  const insert = db.prepare(
    "INSERT OR IGNORE INTO users (id, display_name, role) VALUES (?, ?, ?)",
  );
  for (const u of SEED_USERS) insert.run(u.id, u.display_name, u.role);
}

/** 新しい接続を開いて初期化する（テストや seed スクリプト用） */
export function openDb(file: string = dbPath()): DatabaseSync {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  initializeDb(db);
  return db;
}

// Next.js の開発サーバーはモジュールを再読み込みするので、接続は globalThis に1つだけ持つ
const g = globalThis as unknown as { __tsubuyakiDb?: DatabaseSync };

/** アプリ全体で共有する接続 */
export function getDb(): DatabaseSync {
  if (!g.__tsubuyakiDb) g.__tsubuyakiDb = openDb();
  return g.__tsubuyakiDb;
}

export function listUsers(db: DatabaseSync = getDb()): User[] {
  return db.prepare("SELECT id, display_name, role FROM users ORDER BY rowid").all() as unknown as User[];
}

export function getUser(id: string, db: DatabaseSync = getDb()): User | undefined {
  return db.prepare("SELECT id, display_name, role FROM users WHERE id = ?").get(id) as unknown as
    | User
    | undefined;
}
