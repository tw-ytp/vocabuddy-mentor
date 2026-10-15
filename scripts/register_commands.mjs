#!/usr/bin/env node
// 用途：向 Discord 註冊 Mentor 的指令（全域指令；也可用 GUILD_ID 只註冊到一個伺服器，立即生效）。
// 環境變數：DISCORD_APP_ID、DISCORD_BOT_TOKEN，選填 GUILD_ID
const appId = process.env.DISCORD_APP_ID;
const token = process.env.DISCORD_BOT_TOKEN;
const guild = process.env.GUILD_ID;
if (!appId || !token) {
  console.error("請設定 DISCORD_APP_ID 與 DISCORD_BOT_TOKEN");
  process.exit(1);
}

const commands = [
  {
    name: "ask",
    description: "問 Mentor：貼錯誤訊息或問教材問題，它會指到教材哪一節",
    type: 1,
    options: [{ name: "question", description: "你的問題或完整錯誤訊息", type: 3, required: true }],
  },
  {
    name: "lab",
    description: "某個 Lab 的目標、前置、驗收清單與連結（Sprint 1–4 = Lab 5–8）",
    type: 1,
    options: [{ name: "n", description: "Lab 編號 1–15", type: 4, required: true, min_value: 1, max_value: 15 }],
  },
  {
    name: "errata",
    description: "查教材勘誤（關鍵字或 E-001 這類編號）",
    type: 1,
    options: [{ name: "q", description: "關鍵字或編號", type: 3, required: true }],
  },
  { name: "問 Mentor", type: 3 }, // 訊息右鍵指令：對任一則訊息（例如貼了錯誤訊息的那則）發問
];

const url = guild
  ? `https://discord.com/api/v10/applications/${appId}/guilds/${guild}/commands`
  : `https://discord.com/api/v10/applications/${appId}/commands`;
const res = await fetch(url, {
  method: "PUT",
  headers: { "content-type": "application/json", authorization: `Bot ${token}` },
  body: JSON.stringify(commands),
});
console.log(res.status, (await res.text()).slice(0, 600));
if (!res.ok) process.exit(1);
console.log(guild ? "已註冊到指定伺服器（立即生效）" : "已註冊全域指令（Discord 可能需要最多一小時生效；要立刻測試請設 GUILD_ID）");
