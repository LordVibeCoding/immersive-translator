import { TR_TAG } from '../shared/constants';
import type { DisplayMode } from '../shared/settings';
import { INLINE_TAGS, type Unit } from './scanner';

export type Level = 'draft' | 'final';

const LEVEL_ATTR = 'data-it-level';
const STYLE_ID = 'it-styles';
const RANK: Record<Level, number> = { draft: 1, final: 2 };
const L = `[${LEVEL_ATTR}]`;
const INLINE = [...INLINE_TAGS].map((tag) => tag.toLowerCase()).join(', ');

/**
 * 关闭：隐藏全部译文；双语：译文显示在原文下方（显示/隐藏用 !important，防止网站 `.x > *` 之类规则干扰）；
 * 只看译文：只隐藏属于本段原文的部分——段落块 font-size:0 隐藏裸文本，隐藏行内子元素
 * （包含其它已翻译块的行内容器除外）；非行内子元素（嵌套块、pre、table 等）是独立段落或非正文，
 * 保持显示并用 --it-fs 恢复字号，这样尚未翻译的子段落仍能进入视口被翻译。
 * 译文用创建时记录的字号 --it-fs 恢复。
 */
const STYLES = `
html:not(.it-on) ${TR_TAG} { display: none !important; }
html.it-on ${TR_TAG} { display: block !important; white-space: normal; margin-top: .25em; }
html.it-on ${TR_TAG}.it-draft { opacity: .6; }
html.it-on.it-only ${L} { font-size: 0 !important; }
html.it-on.it-only ${L} > ${TR_TAG} { font-size: var(--it-fs) !important; margin-top: 0; }
html.it-on.it-only ${L} > :is(${INLINE}):not(:has(${L})) { display: none !important; }
html.it-on.it-only ${L} > :not(${TR_TAG}, ${INLINE}) { font-size: var(--it-fs); }
`;

export function injectStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLES;
  (doc.head ?? doc.documentElement).append(style);
}

export function applyMode(doc: Document, enabled: boolean, mode: DisplayMode): void {
  const classes = doc.documentElement.classList;
  classes.toggle('it-on', enabled);
  classes.toggle('it-only', mode === 'only');
}

function ownTr(block: Element): Element | null {
  return block.querySelector(`:scope > ${TR_TAG}`);
}

export function isRendered(block: Element): boolean {
  return block.hasAttribute(LEVEL_ATTR) && ownTr(block) !== null;
}

export function clearTranslation(block: Element): void {
  ownTr(block)?.remove();
  block.removeAttribute(LEVEL_ATTR);
}

/**
 * 段落渲染前的原始字号。只看译文模式下，段落若位于已翻译段落内部，可能继承到祖先被缩成的 0
 * （例如位于缩零的行内容器中）；此时改用最近已翻译祖先记录的 --it-fs，即该祖先缩零前的字号。
 */
function originalFontSize(block: Element): string {
  const size = getComputedStyle(block).fontSize;
  if (parseFloat(size) > 0) return size;
  for (let el = block.parentElement; el; el = el.parentElement) {
    const recorded = (el as HTMLElement).style?.getPropertyValue('--it-fs');
    if (recorded) return recorded;
  }
  return size;
}

function createTr(unit: Unit): Element {
  const { block, anchor } = unit;
  (block as HTMLElement).style?.setProperty('--it-fs', originalFontSize(block));
  const tr = block.ownerDocument.createElement(TR_TAG);
  if (anchor.parentNode === block) block.insertBefore(tr, anchor.nextSibling);
  else block.append(tr);
  return tr;
}

/** 渲染译文；质量等级只升不降，返回是否实际渲染 */
export function renderTranslation(unit: Unit, text: string, level: Level): boolean {
  const current = unit.block.getAttribute(LEVEL_ATTR) as Level | null;
  if (current && RANK[current] >= RANK[level]) return false;
  const tr = ownTr(unit.block) ?? createTr(unit);
  tr.textContent = text;
  tr.classList.toggle('it-draft', level === 'draft');
  unit.block.setAttribute(LEVEL_ATTR, level);
  return true;
}
