import { ENGLISH_PAGE_MIN_LATIN_RATIO, MAX_BADGE_WORDS, MAX_CJK_RATIO, MIN_TEXT_LENGTH } from '../shared/constants';

const LATIN_LETTER = /[A-Za-z]/g;
const LATIN_WORD = /[A-Za-z]+/g;
const CJK_CHAR = /[぀-ヿ㐀-䶿一-鿿가-힯]/g;
const URL_ONLY = /^(https?:\/\/|www\.)\S+$/i;

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 判断一段文字是否值得翻译 */
export function shouldTranslate(raw: string): boolean {
  const text = normalizeText(raw);
  if (text.length < MIN_TEXT_LENGTH || URL_ONLY.test(text)) return false;
  const words = count(text, LATIN_WORD);
  if (words === 0) return false;
  if (words <= MAX_BADGE_WORDS && !/[a-z]/.test(text)) return false; // 全大写短标签：徽章、缩写
  const cjk = count(text, CJK_CHAR);
  return cjk / (cjk + words) <= MAX_CJK_RATIO;
}

/** 被样式设成全大写显示（text-transform: uppercase）的短文字，视为徽章/标签，不翻译 */
export function isUppercaseLabel(text: string, textTransform: string): boolean {
  return textTransform === 'uppercase' && count(text, LATIN_WORD) <= MAX_BADGE_WORDS;
}

/** 判断页面是否为英文：优先看 <html lang>，没有则按正文抽样的字母占比 */
export function isEnglishPage(htmlLang: string, sample: string): boolean {
  const lang = htmlLang.trim().toLowerCase();
  if (lang) return lang.startsWith('en');
  const latin = count(sample, LATIN_LETTER);
  const cjk = count(sample, CJK_CHAR);
  return latin > 0 && latin / (latin + cjk) >= ENGLISH_PAGE_MIN_LATIN_RATIO;
}
