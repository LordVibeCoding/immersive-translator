import { browser } from 'wxt/browser';

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
}

export const SETTINGS_KEY = 'settings';

export const DEFAULT_SETTINGS: Settings = {
  llm: { baseURL: '', apiKey: '', model: '' },
  autoTranslate: true,
  neverSites: [],
  mode: 'dual',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
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
    neverSites: Array.isArray(obj.neverSites)
      ? obj.neverSites.filter((s): s is string => typeof s === 'string')
      : d.neverSites,
    mode: obj.mode === 'dual' || obj.mode === 'only' ? obj.mode : d.mode,
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
