# Mentor 部署步驟（給主辦／技術組）

目標：在 2026-10-17 01:00 前讓 `#ytp2026h2黑客松` 頻道可以用 `/ask`、`/lab`、`/errata` 與右鍵「問 Mentor」。
整個流程約 40–60 分鐘，全部在瀏覽器與一個終端機完成。需要：GitHub、Cloudflare、Discord Developer Portal、Anthropic Console（Max 方案連結）四個帳號。

> 原則：所有金鑰只用 `wrangler secret put` 或 GitHub Secrets 設定，不寫進任何檔案、不貼進聊天。

---

## 0. 本機準備（5 分鐘）

```bash
git clone https://github.com/tw-ytp/vocabuddy-mentor.git
cd vocabuddy-mentor
npm install
# 兩個知識來源放在同層目錄（切塊腳本預設路徑 ../vocabuddy、../ytp26h2-labs）
git clone https://github.com/tw-ytp/vocabuddy.git ../vocabuddy
git clone https://github.com/ytp26h2/ytp26h2-labs.git ../ytp26h2-labs
npm test            # 6 個本機測試應全過
```

需要 Node 22 以上、Python 3.9 以上。

---

## 1. Discord Application（10 分鐘）

1. 打開 <https://discord.com/developers/applications> → **New Application**，名稱 `Mentor`。
2. **General Information** 頁：記下 **Application ID** 與 **Public Key**（等一下要當 secret）。
   **Interactions Endpoint URL** 先留空——要等第 3 步部署完才填。
3. **Bot** 頁：**Reset Token** → 複製 **Bot Token**（只顯示一次）。
   Username 改成 `Mentor`。Privileged Gateway Intents 全部不用勾。
4. **Installation** 頁：Install Link 選 Discord Provided Link；
   Default Install Settings → Guild Install 勾 `applications.commands` 與 `bot`；
   Bot Permissions 勾 **Send Messages**、**Embed Links**、**Read Message History**。
5. 邀請連結（把 `APP_ID` 換掉）：
   `https://discord.com/oauth2/authorize?client_id=APP_ID&scope=bot%20applications.commands&permissions=83968`
   用伺服器管理員身分打開，選擇 YTP 伺服器，授權。
6. 在 Discord 開啟「開發者模式」（使用者設定 → 進階），對伺服器名稱右鍵 → **複製伺服器 ID**（`GUILD_ID`，註冊指令時立即生效用）。
   若要讓「呼叫助教」@ 助教身分組：對該身分組右鍵 → 複製 ID（`TA_ROLE_ID`）。

---

## 2. Anthropic API key（5 分鐘）

1. claude.ai → **Settings → Billing → API credits** → 連結一個 Console 組織（Max 5x 每月 $100 額度；新訂閱滿 7 天才可領）。
2. 到 <https://console.anthropic.com> 該組織 → **API Keys → Create Key**，名稱 `vocabuddy-mentor`，複製。
3. 建議在 Console 為 Mentor 建一個 **Workspace** 並設每月 spend limit（例如 $60），把 key 建在該 Workspace 下——這是額度的硬上限。

Mentor 的每人每小時、每日與全站每日題數上限都在 `wrangler.toml` 的 `MAX_PER_HOUR`、`MAX_PER_DAY`、`MAX_TOTAL_PER_DAY`（正式值 10／40／400；試用期 20／80／800）。

---

## 3. Cloudflare（15 分鐘）

```bash
npx wrangler login                       # 瀏覽器授權

# D1
npx wrangler d1 create vocabuddy-mentor  # 把輸出的 database_id 貼進 wrangler.toml 的 database_id
npx wrangler d1 migrations apply vocabuddy-mentor --remote

# Vectorize（768 維、cosine；對應 @cf/google/embeddinggemma-300m）
npx wrangler vectorize create vocabuddy-mentor --dimensions=768 --metric=cosine

# Secrets（逐一貼上，不會回顯）
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_APP_ID
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ADMIN_TOKEN       # 自己產生：openssl rand -hex 24

# 部署
npx wrangler deploy
```

部署完會印出網址，形如 `https://vocabuddy-mentor.<你的子網域>.workers.dev`。
打開 `<網址>/health` 應看到 `{"ok":true,...}`。

> 方案：Workers 免費方案即可跑（Workers AI 每日 10,000 neurons、Vectorize 與 D1 免費額度都夠本屆規模）。
> 若回答常超時或看到 CPU limit 錯誤，升級 Workers Paid（US$5／月）即可，不用改程式。
> 若 `migrations apply` 對 `tokenize = 'trigram'` 報錯，把 `migrations/0001_init.sql` 裡改成 `tokenize = 'unicode61'` 再跑（中文檢索會變差，但可用）。

---

## 4. 回到 Discord 填 Interactions Endpoint（2 分鐘）

General Information → **Interactions Endpoint URL** 填 `https://vocabuddy-mentor.<子網域>.workers.dev/` → Save Changes。
Discord 會送一個 PING 驗證簽章；儲存成功代表 Worker 與 Public Key 都對了。失敗就檢查 `DISCORD_PUBLIC_KEY` 有沒有貼錯。

---

## 5. 建知識庫並上傳（10 分鐘）

```bash
# 內部文件白名單（可選）：把 Markdown 放進 kb/internal/ 再 build（見 kb/internal/README.md）
npm run kb:build                                  # 產生 kb/chunks.jsonl（約 775 塊）與 kb/eval_auto.jsonl（104 題）
export MENTOR_URL=https://vocabuddy-mentor.<子網域>.workers.dev
export ADMIN_TOKEN=<你在第 3 步產生的值>
npm run kb:upload                                 # 約 3–5 分鐘；最後會印出各版本塊數
npm run eval                                      # 檢索命中率（不花模型費）；門檻 85%
```

---

## 6. 註冊指令、實測（5 分鐘）

```bash
export DISCORD_APP_ID=<Application ID>
export DISCORD_BOT_TOKEN=<Bot Token>
export GUILD_ID=<伺服器 ID>        # 指定伺服器 → 立即生效；不設則為全域，最多等一小時
npm run commands:register
```

到頻道試：
- `/lab 1` → 應回 Lab 1 的目標／時間／前置／驗收清單與連結
- `/errata ThinkingBlock` → 應回 E-009
- `/ask 我 push 一直說 rejected: fetch first` → 幾秒後出現附兩個按鈕的回答，出處指向 `#/lab1`
- 對任何一則貼了錯誤訊息的訊息右鍵 → **應用程式 → 問 Mentor**
- 按「呼叫助教」→ 頻道出現一則摘要（設了 `TA_ROLE_ID` 會 @ 助教）

再跑一次 `npm run eval -- --llm --limit=20` 看真實回答（會花少量額度）。

---

## 7. GitHub Actions（自動部署與每日重建知識庫，5 分鐘）

倉庫 **Settings → Secrets and variables → Actions** 新增：

| Secret | 來源 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → 用 **Edit Cloudflare Workers** 範本建立 |
| `CLOUDFLARE_ACCOUNT_ID` | Workers & Pages 頁右側 |
| `MENTOR_URL` | 第 3 步的網址 |
| `ADMIN_TOKEN` | 第 3 步的值 |

之後：push 到 `main` → 自動 `wrangler deploy`；每天 03:10（台北）自動重抓兩個教材倉庫、重建索引、跑檢索評測（低於 85% 不切換）。
也可在 Actions 頁手動按 **Run workflow**。教材倉庫若要 merge 後立刻觸發，在 `tw-ytp/vocabuddy` 加一個 workflow 發 `repository_dispatch`（範例見 `.github/workflows/reindex.yml` 檔尾註解）。

---

## 8. 競賽日（12/12）關閉

```bash
npx wrangler deploy --var SERVICE_OPEN:0      # 關閉：所有指令回「暫停服務」
npx wrangler deploy --var SERVICE_OPEN:1      # 賽後恢復
```

---

## 9. 日常查看

- `GET <網址>/admin/stats`（header `Authorization: Bearer <ADMIN_TOKEN>`）：今日題數、自助解決、呼叫助教、找不到。
- `GET <網址>/admin/notfound`：最近 100 題「教材沒寫到」或「呼叫助教」的題目——紀錄組每週彙整成教材 issue 的來源。
- Cloudflare Dashboard → Workers → vocabuddy-mentor → Logs：即時錯誤。

## 疑難排解

| 症狀 | 處理 |
|---|---|
| Discord 儲存 Endpoint 失敗 | `/health` 打得開嗎？Public Key 貼對了嗎（General Information 頁那把，不是 Bot Token）？ |
| 指令沒出現 | 用 `GUILD_ID` 重新註冊；或等全域指令生效（最多 1 小時）；bot 有沒有被邀進伺服器 |
| `/ask` 一直「Mentor 正在思考」然後消失 | Worker Logs 看錯誤；多半是 `ANTHROPIC_API_KEY` 無效或額度為零（Console 看 Billing） |
| 回答說「教材沒寫到」但明明有 | `npm run eval` 看命中率；`MIN_VEC_SCORE` 可降到 0.4；確認 kb:upload 最後印出的塊數正確 |
| 回答裡出現舊的模型名稱或方案 | 這是知識庫跟著教材附錄 B 走；改教材附錄 B → 隔天自動重建，或手動 `npm run kb:build && npm run kb:upload` |
