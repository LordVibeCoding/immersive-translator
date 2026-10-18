import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_SETTINGS,
  isLlmConfigured,
  isValidBaseURL,
  loadSettings,
  normalizeSettings,
  saveSettings,
  shouldAutoTranslate,
  toggleNeverSite,
} from '@/src/shared/settings';

describe('normalizeSettings', () => {
  it('空值返回默认设置', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('非法字段回落默认值，字符串去首尾空白', () => {
    const s = normalizeSettings({
      mode: 'weird',
      autoTranslate: 'yes',
      neverSites: ['a.com', 1],
      llm: { baseURL: ' https://x.com/v1 ', apiKey: 5 },
    });
    expect(s.mode).toBe('dual');
    expect(s.autoTranslate).toBe(true);
    expect(s.neverSites).toEqual(['a.com']);
    expect(s.llm).toEqual({ baseURL: 'https://x.com/v1', apiKey: '', model: '' });
  });

  it('保留合法值', () => {
    const s = normalizeSettings({ mode: 'only', autoTranslate: false });
    expect(s.mode).toBe('only');
    expect(s.autoTranslate).toBe(false);
  });

  it('悬浮球：隐藏站点列表过滤非字符串，位置限制在 0~1 之间', () => {
    expect(normalizeSettings({ ballHiddenSites: ['a.com', 2] }).ballHiddenSites).toEqual(['a.com']);
    expect(normalizeSettings({ ballTop: 0.3 }).ballTop).toBe(0.3);
    expect(normalizeSettings({ ballTop: 5 }).ballTop).toBe(1);
    expect(normalizeSettings({ ballTop: -1 }).ballTop).toBe(0);
    expect(normalizeSettings({ ballTop: 'x' }).ballTop).toBe(DEFAULT_SETTINGS.ballTop);
  });
});

describe('isLlmConfigured', () => {
  it('三项都填才算配置', () => {
    expect(isLlmConfigured({ baseURL: 'https://a', apiKey: 'k', model: 'm' })).toBe(true);
    expect(isLlmConfigured({ baseURL: 'https://a', apiKey: '', model: 'm' })).toBe(false);
  });
});

describe('isValidBaseURL', () => {
  it('只接受 http/https', () => {
    expect(isValidBaseURL('https://api.deepseek.com/v1')).toBe(true);
    expect(isValidBaseURL('http://127.0.0.1:8080/v1')).toBe(true);
    expect(isValidBaseURL('ftp://x')).toBe(false);
    expect(isValidBaseURL('not a url')).toBe(false);
  });
});

describe('站点规则', () => {
  it('自动翻译开启且不在黑名单时才自动翻译', () => {
    const s = { ...DEFAULT_SETTINGS, neverSites: ['b.com'] };
    expect(shouldAutoTranslate(s, 'a.com')).toBe(true);
    expect(shouldAutoTranslate(s, 'b.com')).toBe(false);
    expect(shouldAutoTranslate({ ...s, autoTranslate: false }, 'a.com')).toBe(false);
  });

  it('toggleNeverSite 返回新数组且不修改入参', () => {
    const sites = ['a.com'];
    expect(toggleNeverSite(sites, 'b.com')).toEqual(['a.com', 'b.com']);
    expect(toggleNeverSite(sites, 'a.com')).toEqual([]);
    expect(sites).toEqual(['a.com']);
  });
});

describe('loadSettings / saveSettings', () => {
  beforeEach(() => fakeBrowser.reset());

  it('未保存时读到默认值', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('保存部分字段后可读回，其余保持默认', async () => {
    const saved = await saveSettings({ mode: 'only' });
    expect(saved.mode).toBe('only');
    expect(await loadSettings()).toEqual({ ...DEFAULT_SETTINGS, mode: 'only' });
    expect(DEFAULT_SETTINGS.mode).toBe('dual');
  });
});
