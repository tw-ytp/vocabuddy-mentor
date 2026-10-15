# vocabuddy-mentor｜Mentor 問答機器人

YTP2026H2 黑客松的 AI 助教。以自學教材《YTP VocaBuddy 開發者之路》為唯一事實來源，進駐 Discord，回答時指到教材哪一節（附深連結），不替學生打指令；教材沒寫到的就明說，並記下來給助教。

- 教材：<https://tw-ytp.github.io/vocabuddy/>（原始檔 [tw-ytp/vocabuddy](https://github.com/tw-ytp/vocabuddy)）
- Labs 實作紀錄與勘誤：[ytp26h2/ytp26h2-labs](https://github.com/ytp26h2/ytp26h2-labs)
- 規劃提案：專案知識庫《Mentor 問答機器人 規劃提案》

## 學生怎麼用

| 指令 | 做什麼 |
|---|---|
| `/ask 問題或錯誤訊息` | 三段式回答：這是哪個 Lab 哪一節 → 原因 → 你要做的那一步 → 出處連結 |
| 對任一則訊息右鍵 → 應用程式 → **問 Mentor** | 把那則訊息（例如貼了錯誤訊息的那則）當問題 |
| `/lab 7` | 該 Lab 的目標、時間、前置、驗收清單與連結（Sprint 1–4 = Lab 5–8） |
| `/errata 關鍵字` 或 `/errata E-009` | 查 32 條勘誤 |
| 答案下方「解決了」「呼叫助教」 | 回報結果；呼叫助教會在頻道貼摘要並 @ 助教 |

限制：每人每小時 10 題、每日 40 題；全站每日 400 題。訊息裡的金鑰會被自動遮蔽並提醒撤銷。

## 它怎麼運作

```
Discord 互動（HTTP） → Cloudflare Worker
   ├─ 混合檢索：Vectorize（EmbeddingGemma，768 維）＋ D1 FTS5 trigram（關鍵字／錯誤訊息）→ RRF 合併，急救表與勘誤加權
   ├─ Claude（附錄 B 指定型號）依七條行為準則生成三段式答案
   └─ D1 紀錄：問題、取用的塊、按鈕回饋、「找不到」旗標 → /admin/notfound 供紀錄組彙整
知識庫：scripts/build_kb.py 把教材 HTML（62 頁）、Labs 倉庫、勘誤表切成約 775 塊；GitHub Actions 每日重建並跑檢索評測。
```

三個設計原則（承襲教材附錄 D 與助教守則）：**指路不代打**、**會過期的只引附錄 B**、**缺口回流教材**。完整準則見 `src/prompts.ts`。

## 開發

```bash
npm install
npm test                 # 本機單元測試（純函式：檢索合併、金鑰遮蔽、簽章驗證）
npx tsc --noEmit
npm run kb:build         # 需要 ../vocabuddy 與 ../ytp26h2-labs
npm run kb:upload        # MENTOR_URL、ADMIN_TOKEN
npm run eval             # 檢索命中率；加 --llm 跑真實回答
```

部署與設定步驟：[`docs/SETUP.md`](docs/SETUP.md)。專案規矩：[`CLAUDE.md`](CLAUDE.md)。

## 目錄

```
src/          Worker：index.ts（路由）、discord.ts、rag.ts、rank.ts、llm.ts、prompts.ts、safety.ts、db.ts
scripts/      build_kb.py（切塊）、upload_kb.mjs、register_commands.mjs、eval.mjs
migrations/   D1 schema（chunks、chunks_fts、qa_log、rate）
kb/           產出的 chunks.jsonl、eval_auto.jsonl、vocabuddy-pages.md；internal/ 放主辦白名單文件（不進版控）
eval/         golden.jsonl 手寫評測題
docs/         SETUP.md
```

## 授權

MIT（程式碼）。知識庫內容沿用教材授權 CC BY-NC-SA 4.0。
