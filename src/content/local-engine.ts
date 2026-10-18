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

const GESTURE_EVENTS = ['pointerdown', 'keydown'] as const;

/** 创建并回调；返回是否成功 */
function createAndReport(api: TranslatorApi, onReady: (translator: TextTranslator) => void): Promise<boolean> {
  return api.create(LANGS).then(
    (translator) => {
      onReady(translator);
      return true;
    },
    (err: unknown) => {
      console.warn('[沉浸翻译] 创建本地翻译器失败', err);
      return false;
    },
  );
}

/** 当前是否处于用户激活状态（单独按修饰键、Esc 等不产生激活）；拿不到时视为已激活 */
const defaultIsActivated = () =>
  (globalThis.navigator as { userActivation?: { isActive: boolean } } | undefined)?.userActivation?.isActive ?? true;

/**
 * 创建本地翻译器，就绪后回调 onReady。
 * Chrome 为防指纹按来源（origin）报告可用性：即使模型已装好，新网站也报 downloadable；
 * 在该来源调用 create() 需要页面上的用户激活，模型已装好时会立即完成。因此：
 * - available：直接创建，返回的 Promise 在创建结束后才 resolve（调用方可借此让首批段落用上本地引擎）
 * - downloadable / downloading：在 target 上注册一次性的 pointerdown/keydown 监听（捕获阶段），
 *   第一次手势时移除全部监听，并在事件处理函数内同步调用 create()（用户激活只在此时有效）
 * - unavailable / unsupported：什么都不做
 */
export async function createLocalEngineOnGesture(
  onReady: (translator: TextTranslator) => void,
  scope: object = globalThis,
  target: EventTarget = globalThis,
  isActivated: () => boolean = defaultIsActivated,
): Promise<void> {
  const status = await localAvailability(scope);
  const api = getApi(scope);
  if (!api) return;
  if (status === 'available') {
    await createAndReport(api, onReady);
    return;
  }
  if (status !== 'downloadable' && status !== 'downloading') return;
  // 只有真正产生用户激活的操作才尝试创建；失败（如被浏览器拒绝）则继续等下一次操作
  const onGesture = () => {
    if (!isActivated()) return;
    stop();
    void createAndReport(api, onReady).then((ok) => {
      if (!ok) listen();
    });
  };
  const listen = () => GESTURE_EVENTS.forEach((type) => target.addEventListener(type, onGesture, true));
  const stop = () => GESTURE_EVENTS.forEach((type) => target.removeEventListener(type, onGesture, true));
  listen();
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
