// 用途：Worker 的綁定與設定型別（對應 wrangler.toml）。

export interface Env {
  AI: Ai;
  VECTORS: VectorizeIndex;
  DB: D1Database;

  // vars
  EMBED_MODEL: string;      // "@cf/google/embeddinggemma-300m"
  ANSWER_MODEL: string;     // "claude-sonnet-5-5"（以教材附錄 B 現值為準）
  SITE_URL: string;         // "https://tw-ytp.github.io/vocabuddy/"
  MAX_PER_HOUR: string;     // "10"
  MAX_PER_DAY: string;      // "40"
  TA_ROLE_ID?: string;      // 呼叫助教時 @ 的身分組；留空則只寫「請助教留意」
  MIN_VEC_SCORE: string;    // "0.45"：向量最高分低於此且 FTS 無命中 → 視為「教材沒寫到」
  SERVICE_OPEN: string;     // "1" 開放；"0" 關閉（競賽日政策：關閉）

  // secrets
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APP_ID: string;
  DISCORD_BOT_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  ADMIN_TOKEN: string;
}

export interface ChunkRow {
  id: string;
  source: string;
  tier: number;
  page_id: string | null;
  url: string | null;
  title: string;
  section: string;
  kind: string;
  lab: number | null;
  part: string;
  text: string;
  version: string;
  sha: string;
}
