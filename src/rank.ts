// 用途：混合檢索的合併與加權（RRF），以及 FTS5 trigram 查詢字串的組法。純函式，可在 Node 測試。

export interface Hit {
  id: string;
  score: number; // 原始分數：向量為 cosine，FTS 為 -bm25（越大越好）
}

export interface ChunkMeta {
  id: string;
  kind: string;
  lab: number | null;
  tier: number;
  page_id: string | null;
}

export interface Ranked {
  id: string;
  rrf: number;
  vec?: number;
  fts?: number;
}

const KIND_BOOST: Record<string, number> = {
  rescue: 1.5,   // 「常見錯誤急救」「卡住了？」
  errata: 1.5,   // ERRATA 一條一塊
  checklist: 1.1,
  step: 1.1,
  fresh: 1.2,    // 附錄 B 時效資訊
  code: 0.8,
  changelog: 0.8,
  faq: 1.6,      // 主辦補充問答：教材沒寫、專門回答缺口的題
  internal: 0.9, // 內部文件：有倉庫版本就讓倉庫版本贏
};

/**
 * 用途：Reciprocal Rank Fusion。兩路名次各取 1/(k+rank)，相加後乘以塊型與 Lab 加權。
 * 加權是乘在 RRF 分數上，所以只改排序，不會讓沒命中的塊憑空出現。
 */
export function fuse(
  vec: Hit[],
  fts: Hit[],
  meta: Map<string, ChunkMeta>,
  opts: { k?: number; lab?: number | null; topN?: number } = {},
): Ranked[] {
  const k = opts.k ?? 60;
  const acc = new Map<string, Ranked>();
  const add = (hits: Hit[], key: "vec" | "fts") => {
    hits.forEach((h, i) => {
      const r = acc.get(h.id) ?? { id: h.id, rrf: 0 };
      r.rrf += 1 / (k + i + 1);
      r[key] = h.score;
      acc.set(h.id, r);
    });
  };
  add(vec, "vec");
  add(fts, "fts");
  const out: Ranked[] = [];
  for (const r of acc.values()) {
    const m = meta.get(r.id);
    let w = m ? (KIND_BOOST[m.kind] ?? 1) : 1;
    if (opts.lab != null && m && m.lab === opts.lab) w *= 1.3;
    if (m && m.tier === 1) w *= 1.05;
    out.push({ ...r, rrf: r.rrf * w });
  }
  out.sort((a, b) => b.rrf - a.rrf);
  return out.slice(0, opts.topN ?? 8);
}

/**
 * 用途：把自然語言問題變成 FTS5 trigram 的 MATCH 字串。
 * trigram tokenizer 是子字串比對：每個詞用雙引號包起來、以 OR 連接；
 * 英文與錯誤訊息保留原字（含 . : _ - '），中文依標點切段、長段再切成 4 字片。
 * 回傳 null 代表沒有可查的詞（全部短於 3 字元）。
 */
export function ftsQuery(q: string): string | null {
  const terms = new Set<string>();
  const ascii = q.match(/[A-Za-z0-9_][A-Za-z0-9_.:'\-\/]{2,}/g) ?? [];
  for (const t of ascii) {
    const s = t.replace(/[.:'\-\/]+$/, "");
    if (s.length >= 3) terms.add(s);
  }
  const cjkRuns = q.match(/[一-鿿㐀-䶿]+/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length < 3) continue;
    if (run.length <= 6) { terms.add(run); continue; }
    for (let i = 0; i + 4 <= run.length; i += 3) terms.add(run.slice(i, i + 4));
    terms.add(run.slice(-4));
  }
  if (terms.size === 0) return null;
  return [...terms].slice(0, 24).map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR ");
}
