-- つぶやき業務ログ：SQLite スキーマ（node:sqlite）
-- 時刻はすべて JST の ISO 8601 文字列（例 2026-11-03T13:05:00+09:00）で保存する。
-- CREATE IF NOT EXISTS だけで構成し、起動のたびに適用できる（版管理はしない：13 §3）。

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 固定の架空ユーザー（認証なし。デモ用）
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,                 -- 'newcomer_a' | 'newcomer_b' | 'senior_c'
  display_name  TEXT NOT NULL,                    -- 画面表示名（新人A など）
  role          TEXT NOT NULL CHECK (role IN ('newcomer', 'senior'))
);

-- 作業セッション（M1 開始 / M3 終了）
CREATE TABLE IF NOT EXISTS work_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES users(id),
  task_name     TEXT NOT NULL,                    -- 正規化した作業名（M1-4 は完全一致で照合）
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  duration_min  INTEGER,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON work_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_task ON work_sessions(task_name, started_at);

-- 作業中のメモ（M2）。kind：memo＝つぶやき、known/unknown＝開始時の「分かっていること／分からないこと」（D-40⑥）、answer＝追加の質問への答え（M4-5）
CREATE TABLE IF NOT EXISTS notes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL REFERENCES work_sessions(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  body          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'memo' CHECK (kind IN ('memo', 'known', 'unknown', 'answer')),
  created_at    TEXT NOT NULL,
  flags_json    TEXT                              -- M6 の検出結果（JSON）。警告なしは NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_session ON notes(session_id, id);

-- AI 整理の結果（M4 が埋める。M1-4① はここから「つまずき」を読む）
CREATE TABLE IF NOT EXISTS session_summaries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL REFERENCES work_sessions(id),
  json          TEXT NOT NULL,                    -- 固定スキーマ（M4-1）の JSON
  model         TEXT,                             -- 使ったモデル名。デモモードは 'demo'
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_summaries_session ON session_summaries(session_id, id);

-- チームの承認済み知識（M9 が埋める。M1-4② はここから読む）
CREATE TABLE IF NOT EXISTS shared_knowledge (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_name     TEXT NOT NULL,
  user_id       TEXT NOT NULL REFERENCES users(id),  -- 記録者（表示名で出す）
  session_id    INTEGER REFERENCES work_sessions(id),
  body          TEXT NOT NULL,                    -- 承認後の本文（原文のメモは含まない）
  approved_at   TEXT NOT NULL,
  withdrawn_at  TEXT                              -- 取り下げ（M9-5）
);
CREATE INDEX IF NOT EXISTS idx_knowledge_task ON shared_knowledge(task_name, approved_at);
