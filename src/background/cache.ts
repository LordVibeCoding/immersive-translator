import { createStore, get, set, type UseStore } from 'idb-keyval';

export interface TranslationCache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

const DB_NAME = 'immersive-translator';
const STORE_NAME = 'translations';

export async function cacheKey(model: string, text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${model}\n${text}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createIdbCache(store: UseStore = createStore(DB_NAME, STORE_NAME)): TranslationCache {
  return {
    get: (key) => get<string>(key, store),
    set: (key, value) => set(key, value, store),
  };
}
