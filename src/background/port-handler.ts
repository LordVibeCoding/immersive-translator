import { BATCH_MAX_CHARS, BATCH_MAX_ITEMS, BATCH_WAIT_MS } from '../shared/constants';
import { isTranslateRequest, type TranslateResult } from '../shared/messages';
import { isLlmConfigured, type LlmConfig } from '../shared/settings';
import { createBatcher, type Semaphore } from './batching';
import { cacheKey, type TranslationCache } from './cache';

export interface PortLike {
  postMessage(message: TranslateResult): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export type TranslateFn = (
  config: LlmConfig,
  pageTitle: string,
  texts: readonly string[],
  onItem: (index: number, text: string) => void,
) => Promise<void>;

export interface PortHandlerDeps {
  readonly getConfig: () => Promise<LlmConfig>;
  readonly cache: TranslationCache;
  readonly semaphore: Semaphore;
  readonly translate: TranslateFn;
  readonly reportError: (message: string) => void;
}

interface Job {
  readonly text: string;
  readonly key: string;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** 处理一个标签页的长连接：查缓存 → 攒批 → 流式精翻 → 回推并写缓存 */
export function handlePort(port: PortLike, deps: PortHandlerDeps): void {
  let connected = true;
  let pageTitle = '';
  let config: LlmConfig | null = null;
  const waiting = new Map<string, readonly string[]>(); // 原文 → 等待它的段落 id

  const post = (id: string, text: string) => {
    if (connected) port.postMessage({ type: 'result', id, text });
  };

  const deliver = (job: Job, text: string) => {
    (waiting.get(job.text) ?? []).forEach((id) => post(id, text));
    waiting.delete(job.text);
    deps.cache.set(job.key, text).catch((err) => console.warn('[沉浸翻译] 写缓存失败', err));
  };

  const onItem = (batch: readonly Job[]) => (index: number, text: string) => {
    const job = batch[index];
    if (job) deliver(job, text);
  };

  const runBatch = (batch: readonly Job[], cfg: LlmConfig) =>
    deps.semaphore
      .run(() => deps.translate(cfg, pageTitle, batch.map((j) => j.text), onItem(batch)))
      .catch((err: unknown) => deps.reportError(errorMessage(err)))
      .finally(() => batch.forEach((job) => waiting.delete(job.text)));

  const batcher = createBatcher<Job>({
    maxItems: BATCH_MAX_ITEMS,
    maxChars: BATCH_MAX_CHARS,
    waitMs: BATCH_WAIT_MS,
    size: (job) => job.text.length,
    flush: (batch) => {
      if (config) void runBatch(batch, config);
    },
  });

  const enqueue = async (cfg: LlmConfig, id: string, text: string) => {
    const key = await cacheKey(cfg.model, text);
    const cached = await deps.cache.get(key).catch((err: unknown) => {
      console.warn('[沉浸翻译] 读缓存失败', err);
      return undefined;
    });
    if (!connected) return;
    if (cached) return post(id, cached);
    const queued = waiting.get(text);
    waiting.set(text, [...(queued ?? []), id]);
    if (!queued) batcher.push({ text, key });
  };

  port.onMessage.addListener((message) => {
    if (!isTranslateRequest(message)) return;
    void (async () => {
      const cfg = await deps.getConfig();
      if (!isLlmConfigured(cfg)) return;
      config = cfg;
      pageTitle = message.pageTitle;
      for (const item of message.items) await enqueue(cfg, item.id, item.text);
    })().catch((err: unknown) => deps.reportError(errorMessage(err)));
  });

  port.onDisconnect.addListener(() => {
    connected = false;
    batcher.dispose();
    waiting.clear();
  });
}
