import { describe, expect, it } from 'vitest';
import { isEnglishPage, isUppercaseLabel, normalizeText, shouldTranslate } from '@/src/content/text-filter';

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
    // 全大写的短标签（徽章、缩写）不翻译
    ['NEW', false],
    ['FREE', false],
    ['US ONLY', false],
    ['TRY ME', false],
    ['TTL', false],
    ['Advanced DNS', true],
    ['READ THE FULL RELEASE NOTES', true],
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

describe('isUppercaseLabel', () => {
  it('被样式设成全大写显示的短文字视为标签', () => {
    expect(isUppercaseLabel('New', 'uppercase')).toBe(true);
    expect(isUppercaseLabel('Try me', 'uppercase')).toBe(true);
  });

  it('普通样式或较长的文字不算标签', () => {
    expect(isUppercaseLabel('New', 'none')).toBe(false);
    expect(isUppercaseLabel('Read the full release notes', 'uppercase')).toBe(false);
  });
});
