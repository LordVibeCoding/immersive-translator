// @vitest-environment node
import 'fake-indexeddb/auto';
import { createStore } from 'idb-keyval';
import { describe, expect, it } from 'vitest';
import { cacheKey, createIdbCache } from '@/src/background/cache';

describe('cacheKey', () => {
  it('相同输入得到相同的 64 位十六进制 key，模型不同则不同', async () => {
    const a = await cacheKey('m1', 'Hello');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await cacheKey('m1', 'Hello')).toBe(a);
    expect(await cacheKey('m2', 'Hello')).not.toBe(a);
  });
});

describe('createIdbCache', () => {
  it('写入后可读出，未写入的为 undefined', async () => {
    const cache = createIdbCache(createStore('test-db', 'test-store'));
    await cache.set('k', '你好');
    expect(await cache.get('k')).toBe('你好');
    expect(await cache.get('missing')).toBeUndefined();
  });
});
