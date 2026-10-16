# 從中途的 Lab 開始練習（跳過前面的 Lab、直接從 Lab N 開始、中途切入、起點在哪）

每個 Lab 的起點就是上一個 Lab 做完的樣子，而 `ytp26h2-labs` 倉庫每個 Lab 一個資料夾，裡面就是完成品。所以想直接從 Lab N 開始，拿 **Lab N−1 的資料夾**當起點即可，不必從 Lab 1 做起。

## 三步（以直接從 Lab 6 開始為例）

1. 把前一個 Lab 的完成品拿下來：`git clone https://github.com/ytp26h2/ytp26h2-labs.git`，起點檔案在 `labs/lab05-sprint1-mvp-review-queue/`（Lab 5 做完的 `index.html`）。也可以在 GitHub 網頁直接開那個資料夾下載檔案。
2. 放進**自己的**倉庫：新建資料夾 `ytp-vocabuddy`，把 `index.html` 複製進去，`git init && git add . && git commit -m "chore: 從 Lab 5 完成品起步"`；然後照教材 Lab 1 步驟 4–5 在 GitHub 建遠端並 push（Lab 9 部署時一定要有自己的 GitHub 倉庫，跳不掉）。
3. 打開教材該 Lab 開始做；驗收完再對照 `ytp26h2-labs` 對應資料夾的 `CHECKLIST.md`。

## 前一個 Lab 對照表（起點資料夾）

| 想從這裡開始 | 用這個資料夾當起點 |
|---|---|
| Lab 2 | `labs/lab01-first-commit/` |
| Lab 3（獨立 CLI） | 任一自己的倉庫即可 |
| Lab 5（Sprint 1） | `labs/lab02-branch-pr-conflict/` |
| Lab 6（Sprint 2） | `labs/lab05-sprint1-mvp-review-queue/` |
| Lab 7（Sprint 3） | `labs/lab06-sprint2-ai-example/` |
| Lab 8（Sprint 4） | `labs/lab07-sprint3-srs/` |
| Lab 9 | `labs/lab08-sprint4-smart-quiz/` |
| Lab 10 | `labs/lab09-ship-it/` |
| Lab 11–14（第五篇） | `labs/lab10-graduation/`（第四篇結束的 App；或任一你自己的倉庫） |

## 兩個提醒

- **Use this template 不是起點**：它複製的是整個倉庫 13 個資料夾且不帶歷史。單純切入用 clone 或下載該資料夾就好。
- 檢查點 tag（`git switch --detach sprint1-done` 等 13 個）是給想看整個倉庫在那個時間點的狀態、或想讀 PR 歷史的人用的；切入練習不需要。

出處：ytp26h2-labs README「怎麼使用」；教材附錄 D「範例 Repo 與檢查點建置指引」 https://tw-ytp.github.io/vocabuddy/#/guide
