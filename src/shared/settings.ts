import { browser } from 'wxt/browser';
import { BALL_DEFAULT_TOP } from './constants';

export type DisplayMode = 'dual' | 'only';

export interface LlmConfig {
  readonly baseURL: string;
  readonly apiKey: string;
  readonly model: string;
}

export interface Settings {
  readonly llm: LlmConfig;
  readonly autoTranslate: boolean;
  readonly neverSites: readonly string[];
  readonly mode: DisplayMode;
  /** 隐藏悬浮球的网站（hostname） */
  readonly ballHiddenSites: readonly string[];
  /** 悬浮球中心的垂直位置，占视口高度的比例（0~1） */
  readonly ballTop: number;
}

export const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS: Settings = {
  llm: { baseURL: '', apiKey: '', model: '' },
  autoTranslate: true,
  neverSites: [],
  mode: 'dual',
  ballHiddenSites: [],
  ballTop: BALL_DEFAULT_TOP,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asStringList(value: unknown, fallback: readonly string[]): readonly string[] {
  return Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string') : fallback;
}

function asRatio(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function asTrimmedString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

/** 校验从存储读出的数据，非法字段回落到默认值 */
export function normalizeSettings(raw: unknown): Settings {
  const obj = asRecord(raw);
  const llm = asRecord(obj.llm);
  const d = DEFAULT_SETTINGS;
  return {
    llm: {
      baseURL: asTrimmedString(llm.baseURL, d.llm.baseURL),
      apiKey: asTrimmedString(llm.apiKey, d.llm.apiKey),
      model: asTrimmedString(llm.model, d.llm.model),
    },
    autoTranslate: typeof obj.autoTranslate === 'boolean' ? obj.autoTranslate : d.autoTranslate,
    neverSites: asStringList(obj.neverSites, d.neverSites),
    mode: obj.mode === 'dual' || obj.mode === 'only' ? obj.mode : d.mode,
    ballHiddenSites: asStringList(obj.ballHiddenSites, d.ballHiddenSites),
    ballTop: asRatio(obj.ballTop, d.ballTop),
  };
}

export function isLlmConfigured(llm: LlmConfig): boolean {
  return Boolean(llm.baseURL && llm.apiKey && llm.model);
}

export function isValidBaseURL(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

export function shouldAutoTranslate(settings: Settings, hostname: string): boolean {
  return settings.autoTranslate && !settings.neverSites.includes(hostname);
}

/** 在站点列表中添加或移除 hostname（本站不自动翻译、本站隐藏悬浮球共用） */
export function toggleNeverSite(sites: readonly string[], hostname: string): string[] {
  return sites.includes(hostname) ? sites.filter((s) => s !== hostname) : [...sites, hostname];
}

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await loadSettings()), ...patch });
  await browser.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
