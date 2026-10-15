// 用途：混合檢索（Vectorize 向量 ＋ D1 FTS5 trigram）→ RRF 合併 → 取回塊文字。

import type { ChunkRow, Env } from "./types";
import { fuse, ftsQuery, type Hit, type ChunkMeta } from "./rank";

const EMBED_MAX_CHARS = 900; // 嵌入時只取前段（EmbeddingGemma 300m 輸入 512 token），全文仍由 FTS 與 LLM 看到

/** 用途：用 Workers AI 算文字向量；回傳 number[][]。 */
export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const run = (n: number) => env.AI.run(env.EMBED_MODEL as any, { text: texts.map((t) => t.slice(0, n)) } as any);
  let out: any;
  try {
    out = await run(EMBED_MAX_CHARS);
  } catch (e) {
    console.warn("embed retry with shorter input", String(e));
    out = await run(400); // 輸入超過模型上限時退一步
  }
  const data = out?.data ?? out?.embeddings ?? out;
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error("embed: unexpected output shape");
  return data as number[][];
}

export interface Retrieved {
  chunks: ChunkRow[];
  topVec: number;
  ftsHits: number;
  notFound: boolean;
  ids: string[];
}

/** 用途：對一個問題做混合檢索；lab 為加權用的 Lab 編號。 */
export async function retrieve(env: Env, question: string, lab: number | null, topN = 8): Promise<Retrieved> {
  // 1. 向量
  let vecHits: Hit[] = [];
  try {
    const [qv] = await embed(env, [question]);
    const r = await env.VECTORS.query(qv, { topK: 14, returnMetadata: "none" });
    vecHits = r.matches.map((m) => ({ id: m.id, score: m.score }));
  } catch (e) {
    console.warn("vector query failed", String(e));
  }
  // 2. FTS5 trigram
  let ftsHits: Hit[] = [];
  const fq = ftsQuery(question);
  if (fq) {
    try {
      const r = await env.DB.prepare(
        "SELECT id, bm25(chunks_fts) AS s FROM chunks_fts WHERE chunks_fts MATCH ?1 ORDER BY s LIMIT 14",
      ).bind(fq).all<{ id: string; s: number }>();
      ftsHits = (r.results ?? []).map((x) => ({ id: x.id, score: -x.s }));
    } catch (e) {
      console.warn("fts query failed", String(e));
    }
  }
  // 3. 取中繼資料並合併
  const ids = [...new Set([...vecHits, ...ftsHits].map((h) => h.id))];
  const meta = new Map<string, ChunkMeta>();
  const rows = new Map<string, ChunkRow>();
  if (ids.length) {
    const ph = ids.map((_, i) => `?${i + 1}`).join(",");
    const r = await env.DB.prepare(`SELECT * FROM chunks WHERE id IN (${ph})`).bind(...ids).all<ChunkRow>();
    for (const row of r.results ?? []) {
      rows.set(row.id, row);
      meta.set(row.id, { id: row.id, kind: row.kind, lab: row.lab, tier: row.tier, page_id: row.page_id });
    }
  }
  const ranked = fuse(vecHits, ftsHits, meta, { lab, topN });
  const chunks = ranked.map((r) => rows.get(r.id)).filter((x): x is ChunkRow => !!x);
  const topVec = vecHits.length ? Math.max(...vecHits.map((h) => h.score)) : 0;
  const minVec = parseFloat(env.MIN_VEC_SCORE || "0.45");
  const notFound = topVec < minVec; // FTS trigram 對中文幾乎永遠有命中，所以只看向量分數；最後由模型依準則 7 判斷
  return { chunks, topVec, ftsHits: ftsHits.length, notFound, ids: chunks.map((c) => c.id) };
}

/** 用途：某個 Lab 的導覽資料（/lab 指令）：教材頁首塊、驗收清單、Labs 倉庫 README 第一塊。 */
export async function labOverview(env: Env, lab: number) {
  const pageId = lab >= 5 && lab <= 8 ? `3-${lab - 4}` : `lab${lab}`;
  const r = await env.DB.prepare(
    "SELECT * FROM chunks WHERE page_id = ?1 AND source = 'vocabuddy' ORDER BY id LIMIT 40",
  ).bind(pageId).all<ChunkRow>();
  const rows = r.results ?? [];
  const first = rows.find((x) => x.section === "" && x.kind !== "checklist") ?? rows[0];
  const checklist = rows.find((x) => x.kind === "checklist");
  const labs = await env.DB.prepare(
    "SELECT * FROM chunks WHERE lab = ?1 AND source = 'labs' AND kind = 'lab-readme' ORDER BY id LIMIT 1",
  ).bind(lab).first<ChunkRow>();
  return { pageId, first, checklist, labs };
}

/** 用途：勘誤查詢（/errata）：關鍵字 FTS 限 errata 塊，或直接 E-NNN。 */
export async function findErrata(env: Env, q: string) {
  const m = q.match(/E-?(\d{3})/i);
  if (m) {
    const row = await env.DB.prepare("SELECT * FROM chunks WHERE id = ?1").bind(`labs:errata:E-${m[1]}`).first<ChunkRow>();
    return row ? [row] : [];
  }
  const fq = ftsQuery(q);
  if (!fq) return [];
  const r = await env.DB.prepare(
    "SELECT c.* FROM chunks_fts f JOIN chunks c ON c.id = f.id WHERE chunks_fts MATCH ?1 AND c.kind = 'errata' ORDER BY bm25(chunks_fts) LIMIT 3",
  ).bind(fq).all<ChunkRow>();
  return r.results ?? [];
}
