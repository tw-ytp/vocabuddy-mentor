// 用途：Mentor Worker 入口——Discord 互動端點、管理端點（重建索引、評測用問答）、健康檢查。

import type { ChunkRow, Env } from "./types";
import {
  CommandType, InteractionType, ResponseType, answerPayload, deferred, editOriginal, hashUser, json,
  postMessage, reply, userIdOf, verifyDiscordRequest,
} from "./discord";
import { cleanQuestion, detectLab, isMinorSensitive, redLine, redactSecrets } from "./safety";
import { embed, findErrata, labOverview, retrieve } from "./rag";
import { askClaude } from "./llm";
import { FOOTER, SYSTEM_PROMPT, buildUserMessage } from "./prompts";
import { checkRate, dailyTotal, getLog, insertLog, kbStats, pruneOldVersion, setFeedback, upsertChunks } from "./db";

const DAILY_CAP = 400; // 全站每日題數保險絲（Max 方案 $100/月額度的保護）

interface AnswerOut {
  answer: string;
  logId: number;
  footer: string;
  notFound: boolean;
  chunkIds: string[];
  topVec: number;
}

/** 用途：完整回答流程：清理 → 遮蔽 → 檢索 → 生成 → 紀錄。 */
async function answerQuestion(
  env: Env,
  q: { raw: string; userHash: string; guildId: string | null; channelId: string | null; via: string; detail?: boolean },
): Promise<AnswerOut> {
  const t0 = Date.now();
  const { text: question, redacted } = redactSecrets(cleanQuestion(q.raw));
  const lab = detectLab(question);
  const minor = isMinorSensitive(question);
  const red = redLine(question);
  const kbVersion = (await currentVersion(env)) ?? "v2.3";

  const retrieved = await retrieve(env, question, lab, 8);
  const user = buildUserMessage({
    question,
    context: retrieved.chunks.map((c) => ({ id: c.id, url: c.url, title: c.title, section: c.section, kind: c.kind, text: c.text })),
    kbVersion,
    notFound: retrieved.notFound,
    redacted,
    minor,
    redLine: red,
    lab,
    detail: q.detail,
  });
  let answer: string;
  let model = env.ANSWER_MODEL;
  try {
    const r = await askClaude({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANSWER_MODEL, system: SYSTEM_PROMPT, user, maxTokens: 2000 }); // thinking 的 token 也算在內（教材 E-011），不能設太小
    if (r.stopReason === "max_tokens") console.warn("answer truncated: stop_reason=max_tokens", r.outputTokens);
    answer = r.text || "（模型沒有回傳文字，請再問一次或呼叫助教）";
    model = r.model;
  } catch (e) {
    console.error("llm", String(e));
    answer = "Mentor 暫時連不上模型。你可以先看教材該 Lab 的「卡住了？」或「常見錯誤急救」，或按「呼叫助教」。";
  }
  if (redacted.length) {
    answer = `⚠️ 你的訊息裡有金鑰（${redacted.join("、")}），我已遮蔽；請立刻到發行它的網站撤銷重發（教材 4.4）。\n\n` + answer;
  }
  const logId = await insertLog(env, {
    userHash: q.userHash, guildId: q.guildId, channelId: q.channelId, question, answer,
    chunkIds: retrieved.ids, topScore: retrieved.topVec, notFound: retrieved.notFound,
    latencyMs: Date.now() - t0, model, kbVersion, via: q.via,
  });
  return { answer, logId, footer: FOOTER(kbVersion), notFound: retrieved.notFound, chunkIds: retrieved.ids, topVec: retrieved.topVec };
}

let versionCache: { v: string; at: number } | null = null;
async function currentVersion(env: Env): Promise<string | null> {
  if (versionCache && Date.now() - versionCache.at < 60_000) return versionCache.v;
  const rows = await kbStats(env);
  const v = rows.sort((a, b) => b.n - a.n)[0]?.version ?? null;
  if (v) versionCache = { v, at: Date.now() };
  return v;
}

/** 用途：/lab N 的導覽回覆。 */
async function labReply(env: Env, lab: number): Promise<string> {
  if (!(lab >= 1 && lab <= 15)) return "Lab 編號是 1–15（Sprint 1–4 對應 Lab 5–8）。";
  const o = await labOverview(env, lab);
  if (!o.first) return `知識庫裡還沒有 Lab ${lab} 的頁面。`;
  const head = o.first.text.split("\n").slice(0, 6).join("\n").slice(0, 700);
  const ck = o.checklist ? "\n\n**驗收清單**\n" + o.checklist.text.split("\n").filter((l) => l.startsWith("- [ ]")).slice(0, 7).join("\n").slice(0, 600) : "";
  const labsUrl = o.labs?.url ? `\n對照（做完再看）：${o.labs.url.replace(/\/README\.md$/, "/")}` : "";
  return `${head}${ck}\n\n教材：${env.SITE_URL}#/${o.pageId}${labsUrl}`.slice(0, 1950);
}

/** 用途：/errata 的回覆。 */
async function errataReply(env: Env, q: string): Promise<string> {
  const rows = await findErrata(env, q);
  if (!rows.length) return "沒找到對應的勘誤。完整清單：https://github.com/ytp26h2/ytp26h2-labs/blob/main/docs/ERRATA.md";
  return rows.map((r) => r.text.slice(0, 600)).join("\n\n").slice(0, 1900) + "\n\n（勘誤皆已修入教材 v2.3，請看線上版）";
}

/** 用途：Discord 互動主流程。 */
async function handleInteraction(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await req.text();
  if (!(await verifyDiscordRequest(req, env.DISCORD_PUBLIC_KEY, body))) return new Response("bad signature", { status: 401 });
  const it: any = JSON.parse(body);
  if (it.type === InteractionType.PING) return json({ type: ResponseType.PONG });

  const userId = userIdOf(it);
  const userHash = await hashUser(userId, env.DISCORD_APP_ID);
  const guildId = it.guild_id ?? null;
  const channelId = it.channel_id ?? null;

  if (it.type === InteractionType.APPLICATION_COMMAND) {
    const name: string = it.data?.name ?? "";
    if (env.SERVICE_OPEN === "0") return reply("Mentor 目前暫停服務（競賽期間不開放）。請直接找助教。", true);

    // 一律先回「正在思考」（Discord 只給 3 秒，冷啟動時資料庫查詢會超時），實際工作放背景
    const finish = (payload: unknown) => editOriginal(env.DISCORD_APP_ID, it.token, payload);
    const textOnly = (content: string) => ({ content, allowed_mentions: { parse: [] } });

    if (name === "lab") {
      const n = Number(it.data.options?.[0]?.value ?? 0);
      ctx.waitUntil(labReply(env, n).then((t) => finish(textOnly(t))).catch((e) => { console.error("lab", String(e)); return finish(textOnly("查詢失敗，請再試一次。")); }));
      return deferred();
    }
    if (name === "errata") {
      const q = String(it.data.options?.[0]?.value ?? "");
      ctx.waitUntil(errataReply(env, q).then((t) => finish(textOnly(t))).catch((e) => { console.error("errata", String(e)); return finish(textOnly("查詢失敗，請再試一次。")); }));
      return deferred();
    }

    // /ask 與 右鍵「問 Mentor」
    let raw = "";
    let via = "slash";
    if (name === "ask") raw = String(it.data.options?.[0]?.value ?? "");
    else if (it.data?.type === CommandType.MESSAGE) {
      const msg = it.data.resolved?.messages?.[it.data.target_id];
      raw = msg?.content ?? "";
      via = "message";
      if (!raw.trim()) return reply("那則訊息沒有文字內容（圖片我還看不懂），請用 /ask 把錯誤訊息貼成文字。", true);
    } else return reply("不認識的指令。", true);

    ctx.waitUntil((async () => {
      try {
        const limited = await checkRate(env, userHash);
        if (limited) { await finish(textOnly(limited)); return; }
        if ((await dailyTotal(env)) >= DAILY_CAP) { await finish(textOnly("今天 Mentor 的額度用完了，請直接找助教，或明天再來。")); return; }
        const out = await answerQuestion(env, { raw, userHash, guildId, channelId, via });
        await finish(answerPayload({ question: raw, answer: out.answer, footer: out.footer, logId: out.logId }));
      } catch (e) {
        console.error("answer failed", String(e));
        await finish(textOnly("Mentor 出了點問題，請稍後再試或直接找助教。"));
      }
    })());
    return deferred();
  }

  if (it.type === InteractionType.MESSAGE_COMPONENT) {
    const [action, idStr] = String(it.data?.custom_id ?? "").split(":");
    const logId = Number(idStr);
    if (action === "solved") {
      ctx.waitUntil(setFeedback(env, logId, "solved"));
      const msg = it.message ?? {};
      const comps = (msg.components ?? []).map((row: any) => ({ ...row, components: row.components.map((c: any) => ({ ...c, disabled: true })) }));
      return json({ type: ResponseType.UPDATE_MESSAGE, data: { content: (msg.content ?? "") + "\n✅ 已標記為解決", embeds: msg.embeds ?? [], components: comps, allowed_mentions: { parse: [] } } });
    }
    if (action === "more") {
      // 追問：不計入每人題數，但計入全站每日保險絲（它是真的一次 API 呼叫）
      ctx.waitUntil((async () => {
        try {
          if ((await dailyTotal(env)) >= DAILY_CAP) { await editOriginal(env.DISCORD_APP_ID, it.token, { content: "今天 Mentor 的額度用完了，請直接找助教。" }); return; }
          const log = await getLog(env, logId);
          if (!log) { await editOriginal(env.DISCORD_APP_ID, it.token, { content: "找不到原本的問題，請重新 /ask。" }); return; }
          const out = await answerQuestion(env, { raw: log.question, userHash, guildId, channelId, via: "more", detail: true });
          await editOriginal(env.DISCORD_APP_ID, it.token, answerPayload({ question: log.question, answer: out.answer, footer: out.footer, logId: out.logId, allowMore: false }));
        } catch (e) {
          console.error("more failed", String(e));
          await editOriginal(env.DISCORD_APP_ID, it.token, { content: "Mentor 出了點問題，請稍後再試或直接找助教。" });
        }
      })());
      return deferred();
    }
    if (action === "help") {
      ctx.waitUntil((async () => {
        await setFeedback(env, logId, "help");
        const log = await getLog(env, logId);
        if (!channelId) return;
        const mention = env.TA_ROLE_ID ? `<@&${env.TA_ROLE_ID}> ` : "";
        const link = guildId && it.message?.id ? `https://discord.com/channels/${guildId}/${channelId}/${it.message.id}` : "";
        const summary = `${mention}<@${userId}> 需要助教協助。\n**問題**：${(log?.question ?? "").slice(0, 300)}\n**Mentor 已答**：${(log?.answer ?? "").replace(/\n+/g, " ").slice(0, 300)}…\n${link}`;
        await postMessage(env.DISCORD_BOT_TOKEN, channelId, { content: summary, allowed_mentions: { users: [userId], roles: env.TA_ROLE_ID ? [env.TA_ROLE_ID] : [] } });
      })());
      return reply("已通知助教，請在同一個討論裡等候；期間可以先把完整錯誤訊息貼出來。", true);
    }
    return reply("已記錄。", true);
  }
  return json({ error: "unsupported" }, 400);
}

/** 用途：管理端點（Bearer ADMIN_TOKEN）。 */
async function handleAdmin(req: Request, env: Env, path: string): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "unauthorized" }, 401);

  if (path === "/admin/reindex" && req.method === "POST") {
    const body: { chunks: ChunkRow[] } = await req.json();
    const rows = body.chunks ?? [];
    if (!rows.length) return json({ error: "no chunks" }, 400);
    await upsertChunks(env, rows);
    const vectors = await embed(env, rows.map((r) => r.text));
    await env.VECTORS.upsert(rows.map((r, i) => ({ id: r.id, values: vectors[i], metadata: { page_id: r.page_id ?? "", kind: r.kind, lab: r.lab ?? -1, source: r.source } })));
    return json({ ok: true, n: rows.length });
  }
  if (path === "/admin/finish" && req.method === "POST") {
    const { version, sources } = (await req.json()) as { version: string; sources?: string[] };
    const removed = await pruneOldVersion(env, version, sources);
    for (let i = 0; i < removed.length; i += 500) await env.VECTORS.deleteByIds(removed.slice(i, i + 500));
    versionCache = null;
    return json({ ok: true, removed: removed.length, stats: await kbStats(env) });
  }
  if (path === "/admin/ask" && req.method === "POST") {
    const { question, retrieve_only } = (await req.json()) as { question: string; retrieve_only?: boolean };
    const lab = detectLab(question);
    if (retrieve_only) {
      const r = await retrieve(env, redactSecrets(cleanQuestion(question)).text, lab, 8);
      return json({ ids: r.ids, topVec: r.topVec, ftsHits: r.ftsHits, notFound: r.notFound, pages: r.chunks.map((c) => c.page_id), kinds: r.chunks.map((c) => c.kind) });
    }
    const out = await answerQuestion(env, { raw: question, userHash: "admin", guildId: null, channelId: null, via: "admin" });
    return json(out);
  }
  if (path === "/admin/stats") {
    const day = new Date().toISOString().slice(0, 10);
    const r = await env.DB.prepare(
      "SELECT COUNT(*) AS n, SUM(not_found) AS not_found, SUM(feedback='solved') AS solved, SUM(feedback='help') AS help FROM qa_log WHERE ts >= ?1",
    ).bind(day).first();
    return json({ today: r, kb: await kbStats(env) });
  }
  if (path === "/admin/notfound") {
    const r = await env.DB.prepare("SELECT id, ts, question, answer FROM qa_log WHERE not_found = 1 OR feedback = 'help' ORDER BY id DESC LIMIT 100").all();
    return json(r.results);
  }
  return json({ error: "not found" }, 404);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return json({ ok: true, kb: await kbStats(env), open: env.SERVICE_OPEN !== "0" });
    if (url.pathname.startsWith("/admin/")) return handleAdmin(req, env, url.pathname);
    if (url.pathname === "/" && req.method === "POST") return handleInteraction(req, env, ctx);
    return new Response("Mentor is up. Discord interactions endpoint: POST /", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
