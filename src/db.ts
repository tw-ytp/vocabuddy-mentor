// 用途：D1 存取：問答紀錄、頻率限制、知識庫寫入。

import type { ChunkRow, Env } from "./types";

export interface LogInput {
  userHash: string;
  guildId: string | null;
  channelId: string | null;
  question: string;
  answer: string;
  chunkIds: string[];
  topScore: number;
  notFound: boolean;
  latencyMs: number;
  model: string;
  kbVersion: string;
  via: string; // slash | message | admin
}

export async function insertLog(env: Env, l: LogInput): Promise<number> {
  const r = await env.DB.prepare(
    `INSERT INTO qa_log (ts, user_hash, guild_id, channel_id, question, answer, chunk_ids, top_score, not_found, latency_ms, model, kb_version, via)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
  )
    .bind(new Date().toISOString(), l.userHash, l.guildId, l.channelId, l.question, l.answer,
      JSON.stringify(l.chunkIds), l.topScore, l.notFound ? 1 : 0, l.latencyMs, l.model, l.kbVersion, l.via)
    .run();
  return Number(r.meta.last_row_id ?? 0);
}

export async function setFeedback(env: Env, logId: number, feedback: string) {
  await env.DB.prepare("UPDATE qa_log SET feedback = ?2 WHERE id = ?1").bind(logId, feedback).run();
}

export async function getLog(env: Env, logId: number) {
  return env.DB.prepare("SELECT * FROM qa_log WHERE id = ?1").bind(logId).first<any>();
}

/** 用途：每人每小時／每日上限；回傳 null 代表可以，否則回傳拒絕訊息。 */
export async function checkRate(env: Env, userHash: string): Promise<string | null> {
  const now = new Date();
  const hour = now.toISOString().slice(0, 13);
  const day = now.toISOString().slice(0, 10);
  const maxH = parseInt(env.MAX_PER_HOUR || "10", 10);
  const maxD = parseInt(env.MAX_PER_DAY || "40", 10);
  const rows = await env.DB.batch([
    env.DB.prepare("INSERT INTO rate (user_hash, bucket, n) VALUES (?1, ?2, 1) ON CONFLICT(user_hash, bucket) DO UPDATE SET n = n + 1 RETURNING n").bind(userHash, "h:" + hour),
    env.DB.prepare("INSERT INTO rate (user_hash, bucket, n) VALUES (?1, ?2, 1) ON CONFLICT(user_hash, bucket) DO UPDATE SET n = n + 1 RETURNING n").bind(userHash, "d:" + day),
  ]);
  const nH = Number((rows[0].results?.[0] as any)?.n ?? 0);
  const nD = Number((rows[1].results?.[0] as any)?.n ?? 0);
  if (nH > maxH) return `這一小時已經問了 ${maxH} 題，先把前面的答案做完再來。卡住的話可以在頻道直接貼完整錯誤訊息請助教看。`;
  if (nD > maxD) return `今天已經問了 ${maxD} 題。先休息一下，或直接找助教。`;
  return null;
}

/** 用途：全站每日題數（費用保險絲）。 */
export async function dailyTotal(env: Env): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM qa_log WHERE ts >= ?1").bind(day).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

/** 用途：寫入一批知識塊（chunks 與 FTS 同步）。 */
export async function upsertChunks(env: Env, rows: ChunkRow[]) {
  const stmts: D1PreparedStatement[] = [];
  for (const c of rows) {
    stmts.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO chunks (id, source, tier, page_id, url, title, section, kind, lab, part, text, version, sha)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`,
      ).bind(c.id, c.source, c.tier, c.page_id, c.url, c.title, c.section, c.kind, c.lab, c.part, c.text, c.version, c.sha),
    );
    stmts.push(env.DB.prepare("DELETE FROM chunks_fts WHERE id = ?1").bind(c.id));
    stmts.push(env.DB.prepare("INSERT INTO chunks_fts (id, text) VALUES (?1, ?2)").bind(c.id, c.text));
  }
  // D1 batch 上限 100 條敘述，分段送
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
}

/** 用途：刪掉這次上傳沒包含的塊（同版本換檔名、刪檔也會清掉）；回傳被刪的 id（給 Vectorize 同步）。 */
export async function pruneMissing(env: Env, keepIds: string[], sources?: string[]): Promise<string[]> {
  const src = sources && sources.length ? sources : ["vocabuddy", "labs", "internal", "faq"];
  const ph = src.map((_, i) => `?${i + 1}`).join(",");
  const r = await env.DB.prepare(`SELECT id FROM chunks WHERE source IN (${ph})`).bind(...src).all<{ id: string }>();
  const keep = new Set(keepIds);
  const ids = (r.results ?? []).map((x) => x.id).filter((id) => !keep.has(id));
  for (let i = 0; i < ids.length; i += 45) {
    const slice = ids.slice(i, i + 45);
    await env.DB.batch([
      ...slice.map((id) => env.DB.prepare("DELETE FROM chunks WHERE id = ?1").bind(id)),
      ...slice.map((id) => env.DB.prepare("DELETE FROM chunks_fts WHERE id = ?1").bind(id)),
    ]);
  }
  return ids;
}

export async function kbStats(env: Env) {
  const r = await env.DB.prepare("SELECT version, COUNT(*) AS n FROM chunks GROUP BY version").all<{ version: string; n: number }>();
  return r.results ?? [];
}
