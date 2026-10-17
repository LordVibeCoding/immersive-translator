import { SOURCE_LANG, TARGET_LANG } from '../shared/constants';

export type LocalAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported';

export interface TextTranslator {
  translate(text: string): Promise<string>;
}

interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void;
}

interface TranslatorApi {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (monitor: DownloadMonitor) => void;
  }): Promise<TextTranslator>;
}

const LANGS = { sourceLanguage: SOURCE_LANG, targetLanguage: TARGET_LANG };
const KNOWN_STATES = ['available', 'downloadable', 'downloading', 'unavailable'] as const;

function getApi(scope: object): TranslatorApi | undefined {
  return (scope as { Translator?: TranslatorApi }).Translator;
}

export async function localAvailability(scope: object = globalThis): Promise<LocalAvailability> {
  const api = getApi(scope);
  if (!api) return 'unsupported';
  try {
    const result = await api.availability(LANGS);
    return KNOWN_STATES.find((s) => s === result) ?? 'unavailable';
  } catch (err) {
    console.warn('[沉浸翻译] 查询本地翻译可用性失败', err);
    return 'unavailable';
  }
}

/** 仅在模型已就绪时创建（下载需要用户手势，由 popup 触发） */
export async function createLocalEngine(scope: object = globalThis): Promise<TextTranslator | null> {
  if ((await localAvailability(scope)) !== 'available') return null;
  try {
    return await getApi(scope)!.create(LANGS);
  } catch (err) {
    console.warn('[沉浸翻译] 创建本地翻译器失败', err);
    return null;
  }
}

export async function downloadLocalModel(
  onProgress: (ratio: number) => void,
  scope: object = globalThis,
): Promise<void> {
  const api = getApi(scope);
  if (!api) throw new Error('当前浏览器不支持本地翻译（需要 Chrome 138+）');
  await api.create({
    ...LANGS,
    monitor: (m) => m.addEventListener('downloadprogress', (e) => onProgress(e.loaded)),
  });
}
