// 用途：呼叫 Anthropic Messages API（fetch，不用 SDK）；系統提示標記為可快取。

export interface LlmResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  stopReason: string;
}

export async function askClaude(opts: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<LlmResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 1500,
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: opts.user }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`anthropic ${res.status}: ${body.slice(0, 500)}`);
  }
  const data: any = await res.json();
  // 回應的 content 是「區塊列表」，依 type 只挑文字（教材 2.5／E-009 同一個道理）
  const text = (data.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();
  return {
    text,
    model: data.model ?? opts.model,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    cacheRead: data.usage?.cache_read_input_tokens ?? 0,
    stopReason: data.stop_reason ?? "",
  };
}
