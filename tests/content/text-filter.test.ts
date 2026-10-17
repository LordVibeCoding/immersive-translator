import { describe, expect, it } from 'vitest';
import { isEnglishPage, normalizeText, shouldTranslate } from '@/src/content/text-filter';

describe('normalizeText', () => {
  it('折叠空白并去除首尾空格', () => {
    expect(normalizeText('  a \n\t b  ')).toBe('a b');
  });
});

describe('shouldTranslate', () => {
  it.each([
    ['The quick brown fox.', true],
    ['Install with npm i foo', true],
    ['OK', false],
    ['   ', false],
    ['12,345.67 %', false],
    ['https://example.com/path', false],
    ['www.example.com', false],
    ['这是一段中文内容，夹杂 React 一词', false],
    ['使用 TypeScript 编写', false],
  ])('%s → %s', (text, expected) => {
    expect(shouldTranslate(text)).toBe(expected);
  });
});

describe('isEnglishPage', () => {
  it('有 lang 属性时以其为准', () => {
    expect(isEnglishPage('en-US', '中文内容')).toBe(true);
    expect(isEnglishPage(' EN ', '')).toBe(true);
    expect(isEnglishPage('zh-CN', 'English text')).toBe(false);
  });

  it('无 lang 时按拉丁字母占比判断', () => {
    expect(isEnglishPage('', 'Mostly English words here 一点')).toBe(true);
    expect(isEnglishPage('', '大部分都是中文内容 a')).toBe(false);
    expect(isEnglishPage('', '')).toBe(false);
  });
});
