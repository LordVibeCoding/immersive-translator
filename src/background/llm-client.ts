import type { LlmConfig } from '../shared/settings';
import { LLM_ERROR_DETAIL_MAX, LLM_TIMEOUT_MS } from '../shared/constants';
import { createItemParser, createSseDecoder } from './stream-parser';

export interface ChatMessage {
  readonly role: 'system' | 'user';
  readonly content: string;
}

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export function buildMessages(pageTitle: string, texts: readonly string[]): ChatMessage[] {
  const system = [
    '你是专业的英译中翻译引擎。把用户给出的每一段英文翻译成简体中文。',
    '规则：',
    '1. 每段以 [编号] 开头；输出时保持相同编号，每段占一行，格式为：[编号] 译文',
    '2. 只输出译文，不要解释，不要遗漏或合并编号',
    '3. 代码、命令、URL、专有名词、产品名保持原样',
    '4. 译文自然流畅，符合中文表达习惯',
    `页面标题（仅供理解语境）：${pageTitle}`,
  ].join('\n');
  const user = texts.map((t, i) => `[${i + 1}] ${t.replace(/\s+/g, ' ').trim()}`).join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function chatEndpoint(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/chat/completions`;
}

/** 超时信号触发时 fetch 或流读取抛出的错误（AbortSignal.timeout 为 TimeoutError） */
function isTimeout(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

/** 流式翻译一批段落，每完成一段回调 (0 起始下标, 译文)；超时抛出中文错误 */
export async function streamTranslate(
  config: LlmConfig,
  pageTitle: string,
  texts: readonly string[],
  onItem: (index: number, text: string) => void,
  fetchFn: FetchFn = (input, init) => fetch(input, init),
): Promise<void> {
  try {
    await requestAndStream(config, pageTitle, texts, onItem, fetchFn);
  } catch (err) {
    if (isTimeout(err)) throw new Error(`大模型请求超时（${LLM_TIMEOUT_MS / 1000} 秒）`);
    throw err;
  }
}

async function requestAndStream(
  config: LlmConfig,
  pageTitle: string,
  texts: readonly string[],
  onItem: (index: number, text: string) => void,
  fetchFn: FetchFn,
): Promise<void> {
  const res = await fetchFn(chatEndpoint(config.baseURL), {
    method: 'POST',
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      temperature: 0,
      messages: buildMessages(pageTitle, texts),
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`大模型请求失败 HTTP ${res.status}: ${detail.slice(0, LLM_ERROR_DETAIL_MAX)}`);
  }
  const items = createItemParser((n, text) => {
    if (n >= 1 && n <= texts.length) onItem(n - 1, text);
  });
  const sse = createSseDecoder((delta) => items.push(delta));
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    sse.push(chunk.value);
  }
  sse.end();
  items.end();
}
