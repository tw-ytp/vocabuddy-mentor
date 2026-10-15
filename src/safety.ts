// 用途：金鑰遮蔽、提問文字清理、簡單的紅線偵測（純函式，可在 Node 測試）

const KEY_PATTERNS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_\-]{20,}/g, "[Anthropic 金鑰已遮蔽]"],
  [/sk-[A-Za-z0-9]{32,}/g, "[API 金鑰已遮蔽]"],
  [/ghp_[A-Za-z0-9]{30,}/g, "[GitHub 權杖已遮蔽]"],
  [/github_pat_[A-Za-z0-9_]{30,}/g, "[GitHub 權杖已遮蔽]"],
  [/AKIA[0-9A-Z]{16}/g, "[AWS 金鑰已遮蔽]"],
  [/AIza[0-9A-Za-z\-_]{30,}/g, "[Google 金鑰已遮蔽]"],
  [/xox[baprs]-[0-9A-Za-z\-]{20,}/g, "[Slack 權杖已遮蔽]"],
];

export interface Redaction {
  text: string;
  redacted: string[];
}

/** 用途：把訊息裡的金鑰換成佔位字串，回傳遮蔽後文字與命中的類型。 */
export function redactSecrets(input: string): Redaction {
  let text = input;
  const redacted: string[] = [];
  for (const [re, label] of KEY_PATTERNS) {
    if (re.test(text)) {
      redacted.push(label);
      text = text.replace(re, label);
    }
    re.lastIndex = 0;
  }
  return { text, redacted };
}

/** 用途：清掉 Discord 提及、多餘空白，限制長度。 */
export function cleanQuestion(input: string, maxLen = 4000): string {
  let q = input.replace(/<@!?\d+>/g, "").replace(/\r/g, "").trim();
  if (q.length > maxLen) q = q.slice(0, maxLen) + "\n（提問超過長度上限，已截斷）";
  return q;
}

/** 用途：從問題裡抓 Lab／Sprint 編號，供檢索加權。Sprint n 對應 Lab 4+n。 */
export function detectLab(q: string): number | null {
  const m = q.match(/\bLab\s*(\d{1,2})\b/i) || q.match(/實驗\s*(\d{1,2})/);
  if (m) return parseInt(m[1], 10);
  const s = q.match(/\bSprint\s*([1-4])\b/i);
  if (s) return 4 + parseInt(s[1], 10);
  return null;
}

/** 用途：帳號／付款／年齡類問題 → 一律請與家長確認；回傳 true 代表命中。 */
export function isMinorSensitive(q: string): boolean {
  return /(信用卡|刷卡|付款|付費|年齡|幾歲|未成年|身分證|家長|監護|手機驗證|簡訊驗證)/.test(q);
}

/** 用途：四條紅線的直接請求（強制推送、重設歷史、刪分支…），回傳命中的描述。 */
export function redLine(q: string): string | null {
  if (/push\s+(-f\b|--force)|force\s*push|強制推送|強推/i.test(q)) return "強制推送";
  if (/reset\s+--hard|重設歷史|rewrite\s+history|filter-branch|filter-repo/i.test(q)) return "重設歷史";
  if (/branch\s+-D\b|刪(除)?分支|delete.*branch/i.test(q)) return "刪除分支";
  return null;
}
