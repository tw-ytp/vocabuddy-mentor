#!/usr/bin/env node
// 用途：跑 kb/eval_auto.jsonl（＋ eval/golden.jsonl 若存在）對 /admin/ask 做評測。
// 預設只測檢索（retrieve_only，不花模型費用）：期望的 page_id 或 E-NNN 是否出現在前 8 塊。
// 加 --llm 會真的生成答案並檢查答案裡有沒有期望的連結／勘誤編號（會花費用）。
// 環境變數：MENTOR_URL、ADMIN_TOKEN；參數：--llm、--limit=N、--threshold=0.85
import fs from "node:fs";

const url = process.env.MENTOR_URL?.replace(/\/$/, "");
const token = process.env.ADMIN_TOKEN;
if (!url || !token) { console.error("請設定 MENTOR_URL 與 ADMIN_TOKEN"); process.exit(1); }
const useLlm = process.argv.includes("--llm");
const limit = Number((process.argv.find((a) => a.startsWith("--limit=")) ?? "").split("=")[1] || 0);
const threshold = Number((process.argv.find((a) => a.startsWith("--threshold=")) ?? "").split("=")[1] || 0.85);

const load = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
let items = [...load("kb/eval_auto.jsonl"), ...load("eval/golden.jsonl")];
if (limit) items = items.slice(0, limit);

let hit = 0, n = 0;
const misses = [];
let skipped = 0;
for (const it of items) {
  if (!useLlm && !it.expect_page_id && !it.expect_errata) { skipped++; continue; }
  n++;
  const res = await fetch(url + "/admin/ask", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ question: it.q, retrieve_only: !useLlm }),
  });
  if (!res.ok) { misses.push({ q: it.q, error: res.status }); continue; }
  const out = await res.json();
  let ok;
  if (!useLlm) {
    const pages = out.pages ?? [];
    const ids = out.ids ?? [];
    ok = (it.expect_page_id && pages.includes(it.expect_page_id)) ||
         (it.expect_errata && ids.includes(`labs:errata:${it.expect_errata}`));
  } else {
    const a = out.answer ?? "";
    ok = (it.expect_page_id && a.includes(`#/${it.expect_page_id}`)) ||
         (it.expect_errata && a.includes(it.expect_errata)) ||
         (it.expect_contains && it.expect_contains.every((s) => a.includes(s))) ||
         (it.expect_kind === "refuse" && /家長|不建議|紅線|救援/.test(a)) ||
         (it.expect_kind === "notfound" && /沒寫到|找不到|留白/.test(a));
  }
  if (ok) hit++; else misses.push({ q: it.q.slice(0, 80), expect: it.expect_page_id ?? it.expect_errata ?? it.expect_kind, got: useLlm ? (out.answer ?? "").slice(0, 120) : out.pages });
  process.stdout.write(ok ? "." : "x");
}
console.log(`\n命中 ${hit}/${n} = ${(hit / n * 100).toFixed(1)}%（門檻 ${threshold * 100}%）${skipped ? `，略過 ${skipped} 題（只能用 --llm 評）` : ""}`);
if (misses.length) console.log("未命中：", JSON.stringify(misses.slice(0, 30), null, 1));
process.exit(hit / n >= threshold ? 0 : 1);
