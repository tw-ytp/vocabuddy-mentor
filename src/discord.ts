// 用途：Discord Interactions 的簽章驗證、回應格式與 REST 呼叫（不用任何套件）。

export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3 } as const;
export const CommandType = { CHAT_INPUT: 1, MESSAGE: 3 } as const;
export const ResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED_CHANNEL_MESSAGE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
} as const;
const EPHEMERAL = 1 << 6;
const API = "https://discord.com/api/v10";

function hex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 用途：驗證請求確實來自 Discord（Ed25519）。 */
export async function verifyDiscordRequest(req: Request, publicKeyHex: string, body: string): Promise<boolean> {
  const sig = req.headers.get("x-signature-ed25519");
  const ts = req.headers.get("x-signature-timestamp");
  if (!sig || !ts) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hex(publicKeyHex), { name: "Ed25519" }, false, ["verify"]);
    const data = new TextEncoder().encode(ts + body);
    return await crypto.subtle.verify("Ed25519", key, hex(sig), data);
  } catch (e) {
    console.error("verify failed", String(e));
    return false;
  }
}

export const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export const reply = (content: string, ephemeral = false) =>
  json({ type: ResponseType.CHANNEL_MESSAGE, data: { content, flags: ephemeral ? EPHEMERAL : 0 } });

export const deferred = () => json({ type: ResponseType.DEFERRED_CHANNEL_MESSAGE });

/** 用途：答案下方的兩個按鈕；custom_id 帶 qa_log 的 id。 */
export function feedbackRow(logId: number | string) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: "解決了", custom_id: `solved:${logId}` },
        { type: 2, style: 1, label: "呼叫助教", custom_id: `help:${logId}` },
      ],
    },
  ];
}

/** 用途：把長答案放進 embed（上限 4096 字），避免 2000 字的訊息上限。 */
export function answerPayload(opts: { question: string; answer: string; footer: string; logId?: number | string; disabled?: boolean }) {
  const desc = opts.answer.length > 4000 ? opts.answer.slice(0, 3990) + "\n（已截斷）" : opts.answer;
  const payload: any = {
    content: `> ${opts.question.replace(/\n/g, " ").slice(0, 180)}`,
    embeds: [{ description: desc, color: 0x0f766e, footer: { text: opts.footer } }],
    allowed_mentions: { parse: [] },
  };
  if (opts.logId != null) {
    payload.components = feedbackRow(opts.logId);
    if (opts.disabled) payload.components[0].components.forEach((c: any) => (c.disabled = true));
  }
  return payload;
}

/** 用途：deferred 之後補上正式回覆（編輯 @original）。 */
export async function editOriginal(appId: string, token: string, payload: unknown) {
  const res = await fetch(`${API}/webhooks/${appId}/${token}/messages/@original`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error("editOriginal", res.status, await res.text());
  return res.ok;
}

/** 用途：用 bot token 在頻道發訊息（呼叫助教）。 */
export async function postMessage(botToken: string, channelId: string, payload: unknown) {
  const res = await fetch(`${API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bot ${botToken}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) console.error("postMessage", res.status, await res.text());
  return res.ok;
}

/** 用途：從互動物件取出使用者 id（伺服器內是 member.user，私訊是 user）。 */
export function userIdOf(interaction: any): string {
  return interaction.member?.user?.id ?? interaction.user?.id ?? "anon";
}

/** 用途：使用者 id 經雜湊後才寫入紀錄（個資最小化）。 */
export async function hashUser(id: string, salt: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ":" + id));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}
