-- Mentor 知識庫與紀錄（D1 / SQLite）
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,          -- vocabuddy | labs | internal
  tier INTEGER NOT NULL,         -- 1 教材正文 2 實作紀錄 3 內部文件
  page_id TEXT,                  -- 教材頁 id（深連結尾碼）
  url TEXT,
  title TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,            -- body step scene key checklist rescue quiz fresh glossary changelog lab-readme code errata labs-doc internal
  lab INTEGER,
  part TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  version TEXT NOT NULL,         -- 教材版本（v2.3）
  sha TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_page ON chunks(page_id);
CREATE INDEX IF NOT EXISTS idx_chunks_lab ON chunks(lab);
CREATE INDEX IF NOT EXISTS idx_chunks_version ON chunks(version);

-- 關鍵字檢索：trigram 讓中文與錯誤訊息都能子字串比對
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(id UNINDEXED, text, tokenize = 'trigram');

CREATE TABLE IF NOT EXISTS qa_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  user_hash TEXT NOT NULL,       -- 使用者 id 雜湊，不存暱稱
  guild_id TEXT,
  channel_id TEXT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  chunk_ids TEXT NOT NULL,       -- JSON array
  top_score REAL,
  not_found INTEGER NOT NULL DEFAULT 0,
  feedback TEXT,                 -- solved | help | NULL
  latency_ms INTEGER,
  model TEXT,
  kb_version TEXT,
  via TEXT                       -- slash | message | admin
);
CREATE INDEX IF NOT EXISTS idx_qa_ts ON qa_log(ts);

CREATE TABLE IF NOT EXISTS rate (
  user_hash TEXT NOT NULL,
  bucket TEXT NOT NULL,          -- h:YYYY-MM-DDTHH | d:YYYY-MM-DD
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_hash, bucket)
);
