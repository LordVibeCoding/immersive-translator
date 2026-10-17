// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSemaphore } from '@/src/background/batching';
import { cacheKey, type TranslationCache } from '@/src/background/cache';
import { handlePort, type PortHandlerDeps, type PortLike, type TranslateFn } from '@/src/background/port-handler';
import type { TranslateResult } from '@/src/shared/messages';

const CONFIG = { baseURL: 'https://a.com/v1', apiKey: 'k', model: 'm' };

function fakePort() {
  const listeners: { message?: (m: unknown) => void; disconnect?: () => void } = {};
  const posted: TranslateResult[] = [];
  const port: PortLike = {
    postMessage: (m) => posted.push(m),
    onMessage: { addListener: (fn) => (listeners.message = fn) },
    onDisconnect: { addListener: (fn) => (listeners.disconnect = fn) },
  };
  return {
    port,
    posted,
    send: (m: unknown) => listeners.message!(m),
    disconnect: () => listeners.disconnect!(),
  };
}

function memoryCache(initial: Record<string, string> = {}): TranslationCache & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, get: async (k) => data[k], set: async (k, v) => void (data[k] = v) };
}

const echoTranslate: TranslateFn = async (_c, _t, texts, onItem) => texts.forEach((t, i) => onItem(i, `译:${t}`));

function setup(overrides: Partial<PortHandlerDeps> = {}) {
  const p = fakePort();
  const deps: PortHandlerDeps = {
    getConfig: async () => CONFIG,
    cache: memoryCache(),
    semaphore: createSemaphore(3),
    translate: vi.fn(echoTranslate),
    reportError: vi.fn(),
    ...overrides,
  };
  handlePort(p.port, deps);
  return { ...p, deps };
}

const request = (items: [string, string][]) => ({
  type: 'translate',
  pageTitle: 'Page',
  items: items.map(([id, text]) => ({ id, text })),
});

/**
 * `cacheKey` 内部真实调用 `crypto.subtle.digest`，其完成回调走 Node 真实事件循环，
 * 不受假定时器调度；而攒批计时器一到期 `vi.runAllTimersAsync()` 就会立即判定其"到期"，
 * 可能在同批次的后续条目完成真实摘要之前就把前面的条目单独 flush 出去，导致大模型被多次调用。
 * 这里先用多轮 0ms 假定时器推进，把真实微任务的空隙让出来，再整体冲洗剩余计时器，避免该竞态。
 */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
  await vi.runAllTimersAsync();
}

describe('handlePort', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('缓存命中直接回推，不调用大模型', async () => {
    const cache = memoryCache({ [await cacheKey('m', 'Hello')]: '你好' });
    const { send, posted, deps } = setup({ cache });
    send(request([['1', 'Hello']]));
    await flushAsync();
    expect(posted).toEqual([{ type: 'result', id: '1', text: '你好' }]);
    expect(deps.translate).not.toHaveBeenCalled();
  });

  it('未命中时攒批请求大模型，回推结果并写缓存', async () => {
    const cache = memoryCache();
    const { send, posted, deps } = setup({ cache });
    send(request([['1', 'Hello'], ['2', 'World']]));
    await flushAsync();
    expect(deps.translate).toHaveBeenCalledTimes(1);
    expect(posted).toEqual([
      { type: 'result', id: '1', text: '译:Hello' },
      { type: 'result', id: '2', text: '译:World' },
    ]);
    expect(cache.data[await cacheKey('m', 'World')]).toBe('译:World');
  });

  it('相同原文只请求一次，所有等待的段落都收到结果', async () => {
    const { send, posted, deps } = setup();
    send(request([['1', 'Same'], ['2', 'Same']]));
    await flushAsync();
    expect(vi.mocked(deps.translate).mock.calls[0]![2]).toEqual(['Same']);
    expect(posted.map((r) => r.id)).toEqual(['1', '2']);
  });

  it('大模型失败时上报错误', async () => {
    const { send, posted, deps } = setup({ translate: vi.fn(async () => Promise.reject(new Error('HTTP 401'))) });
    send(request([['1', 'Hello']]));
    await flushAsync();
    expect(deps.reportError).toHaveBeenCalledWith('HTTP 401');
    expect(posted).toEqual([]);
  });

  it('未配置大模型或消息非法时忽略', async () => {
    const { send, posted, deps } = setup({ getConfig: async () => ({ ...CONFIG, apiKey: '' }) });
    send(request([['1', 'Hello']]));
    send({ type: 'nonsense' });
    await flushAsync();
    expect(deps.translate).not.toHaveBeenCalled();
    expect(posted).toEqual([]);
  });

  it('断开连接后不再回推', async () => {
    const { send, posted, disconnect } = setup();
    send(request([['1', 'Hello']]));
    disconnect();
    await flushAsync();
    expect(posted).toEqual([]);
  });
});
