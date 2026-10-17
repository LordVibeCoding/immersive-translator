// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildMessages, chatEndpoint, streamTranslate } from '@/src/background/llm-client';

const config = { baseURL: 'https://api.example.com/v1/', apiKey: 'sk-test', model: 'fast-model' };

function sseResponse(contents: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const content of contents) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('buildMessages', () => {
  it('每段折叠成单行并编号，system 中带页面标题', () => {
    const [system, user] = buildMessages('My Page', ['Hello\n  world', 'Second']);
    expect(system!.content).toContain('My Page');
    expect(user!.content).toBe('[1] Hello world\n[2] Second');
  });
});

describe('chatEndpoint', () => {
  it('去掉多余斜杠', () => {
    expect(chatEndpoint('https://a.com/v1///')).toBe('https://a.com/v1/chat/completions');
  });
});

describe('streamTranslate', () => {
  it('发送正确的请求并按 0 起始下标回调', async () => {
    const fetchFn = vi.fn(async () => sseResponse(['[1] 你好\n[2] 世', '界\n[9] 越界']));
    const out: [number, string][] = [];
    await streamTranslate(config, 'T', ['Hello', 'World'], (i, t) => out.push([i, t]), fetchFn);

    expect(out).toEqual([[0, '你好'], [1, '世界']]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'fast-model', stream: true, temperature: 0 });
  });

  it('非 2xx 抛出带状态码的错误', async () => {
    const fetchFn = vi.fn(async () => new Response('invalid key', { status: 401 }));
    await expect(streamTranslate(config, 'T', ['Hi'], () => {}, fetchFn)).rejects.toThrow('HTTP 401: invalid key');
  });
});
