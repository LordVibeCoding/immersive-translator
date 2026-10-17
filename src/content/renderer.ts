import { TR_TAG } from '../shared/constants';
import type { DisplayMode } from '../shared/settings';
import type { Unit } from './scanner';

export type Level = 'draft' | 'final';

const LEVEL_ATTR = 'data-it-level';
const STYLE_ID = 'it-styles';
const RANK: Record<Level, number> = { draft: 1, final: 2 };
const L = `[${LEVEL_ATTR}]`;

/**
 * 关闭：隐藏全部译文；双语：译文显示在原文下方；
 * 只看译文：段落块 font-size:0 隐藏裸文本，隐藏非译文子元素（包含其它已翻译块的容器除外），
 * 译文用创建时记录的字号 --it-fs 恢复。
 */
const STYLES = `
${TR_TAG} { display: none; }
html.it-on ${TR_TAG} { display: block; white-space: normal; margin-top: .25em; }
html.it-on ${TR_TAG}.it-draft { opacity: .6; }
html.it-on.it-only ${L} { font-size: 0 !important; }
html.it-on.it-only ${L} > ${TR_TAG} { font-size: var(--it-fs) !important; margin-top: 0; }
html.it-on.it-only ${L} > :not(${TR_TAG}):not(${L}):not(:has(${L})) { display: none !important; }
html.it-on.it-only ${L} > :is(${L}, :has(${L})) { font-size: var(--it-fs); }
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

function createTr(unit: Unit): Element {
  const { block, anchor } = unit;
  (block as HTMLElement).style?.setProperty('--it-fs', getComputedStyle(block).fontSize);
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
