# CLAUDE.md｜vocabuddy-mentor 專案指示檔

## 這是什麼專案
- YTP2026H2 黑客松的 Discord 問答機器人「Mentor」：Cloudflare Worker（TypeScript，零執行期依賴）＋ Vectorize ＋ D1 ＋ Workers AI 向量 ＋ Anthropic Messages API。
- 唯一事實來源是教材 `tw-ytp/vocabuddy` 與 `ytp26h2/ytp26h2-labs`；知識庫由 `scripts/build_kb.py` 產生，不手寫內容。
- 行為準則在 `src/prompts.ts`（七條）；改準則要同步改 `eval/golden.jsonl` 的期望。

## 怎麼跑起來
- `npm install && npm test && npx tsc --noEmit`；`npx wrangler deploy --dry-run --outdir /tmp/dist` 可驗設定。
- 真實環境需要 Cloudflare 與 Discord 帳號，步驟見 `docs/SETUP.md`；本機沒有 Vectorize／AI 可用，所以檢索與生成只能對已部署的 Worker 用 `scripts/eval.mjs` 測。
- 切塊：`npm run kb:build`（需要 `../vocabuddy`、`../ytp26h2-labs`）。

## 程式碼慣例
- 2 空格縮排、雙引號、分號；`const` 優先；函式小駝峰、常數全大寫。
- 不引入執行期套件（Discord、Anthropic 都用 fetch）；純函式放 `rank.ts`／`safety.ts`，必須有 `test/*.test.mjs`。
- 每個新函式上方一行 `// 用途：…` 或 docstring。
- 模型名稱、向量模型、門檻都放 `wrangler.toml` 的 `[vars]`，不寫死在程式裡。
- 寫入 D1 的使用者識別一律雜湊；回答與紀錄前先 `redactSecrets`。

## 協作規矩
- GitHub Flow：分支 `feature/<短名>`、`fix/<短名>`；`main` 只收 PR；merge 進 `main` 即自動部署（`.github/workflows/deploy.yml`）。
- commit 訊息 `類型: 說明`（feat／fix／docs／test／refactor／chore），說明用繁體中文。
- 改了切塊邏輯要重跑 `kb:build` 並看 `kb/manifest.json` 的塊數與 `eval` 命中率沒有退步。

## 不要做的事
- 不要把任何金鑰、token、database_id 以外的帳號資訊寫進倉庫；secrets 只用 `wrangler secret put` 與 GitHub Secrets。
- 不要把 `kb/internal/*.md`（主辦內部文件）提交進公開倉庫。
- 不要讓 Mentor 產出整段 Lab 解答、force push／reset --hard 等紅線指令，或自己編造附錄 B 沒有的時效資訊——這是提案與 `prompts.ts` 的核心約束。
- 不要為了讓 CI 綠而降低 `eval` 門檻或刪題。
