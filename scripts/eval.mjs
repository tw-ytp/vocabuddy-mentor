#!/usr/bin/env node
// 用途：跑 kb/eval_auto.jsonl（＋ eval/golden.jsonl 若存在）對 /admin/ask 做評測。
// 預設只測檢索（retrieve_only，不花模型費用）：期望的 page_id 或 E-NNN 是否出現在前 8 塊。
// 加 --llm 會真的生成答案並檢查答案裡有沒有期望的連結／勘誤編號（會花費用）。
// 環境變數：MENTOR_URL、ADMIN_TOKEN；參數：--llm、--limit=N、--threshold=0.85、--resume（接續上次中斷）
// 每題結果即時寫入 eval/results-<模式>.jsonl；連線失敗自動重試 3 次。
import fs from "node:fs";

const url = process.env.MENTOR_URL?.replace(/\/$/, "");
const token = process.env.ADMIN_TOKEN;
if (!url || !token) { console.error("請設定 MENTOR_URL 與 ADMIN_TOKEN"); process.exit(1); }
const useLlm = process.argv.includes("--llm");
const limit = Number((process.argv.find((a) => a.startsWith("--limit=")) ?? "").split("=")[1] || 0);
const threshold = Number((process.argv.find((a) => a.startsWith("--threshold=")) ?? "").split("=")[1] || 0.85);
const resume = process.argv.includes("--resume");
const outPath = `eval/results-${useLlm ? "llm" : "retrieve"}.jsonl`;

// 用途：POST /admin/ask，連線錯誤重試 3 次（手機熱點常掉線）。
async function ask(question, retrieveOnly) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url + "/admin/ask", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ question, retrieve_only: retrieveOnly }),
        signal: AbortSignal.timeout(90_000),
      });
      return res;
    } catch (e) {
      if (attempt === 3) throw e;
      process.stdout.write("r");
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

const load = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
let items = [...load("kb/eval_auto.jsonl"), ...load("eval/golden.jsonl")];
if (limit) items = items.slice(0, limit);

let hit = 0, n = 0;
const misses = [];
let skipped = 0;
const done = new Map();
if (resume && fs.existsSync(outPath)) {
  for (const l of fs.readFileSync(outPath, "utf8").split("\n").filter(Boolean)) { const r = JSON.parse(l); done.set(r.q, r); }
  console.log(`續跑：已完成 ${done.size} 題`);
} else if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
const record = (r) => fs.appendFileSync(outPath, JSON.stringify(r) + "\n");

for (const it of items) {
  if (!useLlm && !it.expect_page_id && !it.expect_errata) { skipped++; continue; }
  n++;
  if (done.has(it.q)) { const r = done.get(it.q); if (r.ok) hit++; else misses.push(r.miss); process.stdout.write(r.ok ? "." : "x"); continue; }
  const res = await ask(it.q, !useLlm);
  if (!res.ok) { const miss = { q: it.q, error: res.status }; misses.push(miss); record({ q: it.q, ok: false, miss }); process.stdout.write("x"); continue; }
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
  const miss = ok ? null : { q: it.q.slice(0, 80), expect: it.expect_page_id ?? it.expect_errata ?? it.expect_kind, got: useLlm ? (out.answer ?? "").slice(0, 120) : out.pages };
  if (ok) hit++; else misses.push(miss);
  record({ q: it.q, kind: it.kind, expect: it.expect_page_id ?? it.expect_errata ?? it.expect_kind, ok: !!ok, miss, answer: useLlm ? out.answer : undefined, pages: out.pages, notFound: out.notFound });
  process.stdout.write(ok ? "." : "x");
}
console.log(`\n命中 ${hit}/${n} = ${(hit / n * 100).toFixed(1)}%（門檻 ${threshold * 100}%）${skipped ? `，略過 ${skipped} 題（只能用 --llm 評）` : ""}`);
if (misses.length) console.log("未命中：", JSON.stringify(misses.slice(0, 30), null, 1));
console.log(`逐題結果（含完整答案）：${outPath}`);
process.exit(hit / n >= threshold ? 0 : 1);
