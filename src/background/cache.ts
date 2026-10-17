import { createStore, get, set, type UseStore } from 'idb-keyval';
import { CACHE_DB_NAME, CACHE_STORE_NAME } from '@/src/shared/constants';

export interface TranslationCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export async function cacheKey(model: string, text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${model}\n${text}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createIdbCache(store: UseStore = createStore(CACHE_DB_NAME, CACHE_STORE_NAME)): TranslationCache {
  return {
    get: (key) => get<string>(key, store),
    set: (key, value) => set(key, value, store),
  };
}
