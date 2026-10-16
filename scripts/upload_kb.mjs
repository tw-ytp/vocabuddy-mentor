#!/usr/bin/env node
// 用途：把 kb/chunks.jsonl 分批送進 Worker 的 /admin/reindex，最後呼叫 /admin/finish 刪掉這次沒上傳的塊（換版本、改檔名、刪檔都會清）。
// 環境變數：MENTOR_URL（例 https://vocabuddy-mentor.<帳號>.workers.dev）、ADMIN_TOKEN
// 參數：--sources vocabuddy,labs（只重建這些來源並只清這些來源的舊版本；預設全部）
import fs from "node:fs";

const url = process.env.MENTOR_URL?.replace(/\/$/, "");
const token = process.env.ADMIN_TOKEN;
if (!url || !token) {
  console.error("請設定 MENTOR_URL 與 ADMIN_TOKEN");
  process.exit(1);
}
const argSources = (process.argv.find((a) => a.startsWith("--sources=")) ?? "").split("=")[1];
const sources = argSources ? argSources.split(",") : null;
const BATCH = 20;

const lines = fs.readFileSync("kb/chunks.jsonl", "utf8").split("\n").filter(Boolean);
let chunks = lines.map((l) => JSON.parse(l));
if (sources) chunks = chunks.filter((c) => sources.includes(c.source));
const version = chunks[0]?.version;
console.log(`上傳 ${chunks.length} 塊（版本 ${version}）到 ${url}`);

const post = async (path, body) => {
  const res = await fetch(url + path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
};

let done = 0;
for (let i = 0; i < chunks.length; i += BATCH) {
  const slice = chunks.slice(i, i + BATCH);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await post("/admin/reindex", { chunks: slice });
      break;
    } catch (e) {
      if (attempt === 3) throw e;
      console.warn(`第 ${i / BATCH + 1} 批失敗，重試 ${attempt}/3：${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  done += slice.length;
  if (done % 100 < BATCH) console.log(`  ${done}/${chunks.length}`);
}
const fin = await post("/admin/finish", { keep_ids: chunks.map((c) => c.id), sources: sources ?? undefined });
console.log("完成：", JSON.stringify(fin));
