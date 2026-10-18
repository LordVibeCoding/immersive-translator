import { TR_TAG } from '../shared/constants';
import type { DisplayMode } from '../shared/settings';
import { ownTextNodes, type Unit } from './scanner';
import { restoreText, swapText, type SwapRecord } from './text-swap';

export type Level = 'draft' | 'final';

const LEVEL_ATTR = 'data-it-level';
const STYLE_ID = 'it-styles';
const RANK: Record<Level, number> = { draft: 1, final: 2 };
/** 只看译文模式下各段落的原文替换记录，用于换回原文 */
const swaps = new WeakMap<Element, readonly SwapRecord[]>();

/**
 * 关闭：隐藏全部译文；双语：译文显示在原文下方（显示/隐藏用 !important，防止网站 `.x > *` 之类规则干扰）；
 * 只看译文：译文块隐藏，译文由 showInPlace 原地写进原文的文字节点——只改文字不动元素，
 * 表单控件、图标、按钮和表格布局都保持原样。
 */
const STYLES = `
html:not(.it-on) ${TR_TAG} { display: none !important; }
html.it-on ${TR_TAG} { display: block !important; white-space: normal; margin-top: .25em; }
html.it-on ${TR_TAG}.it-draft { opacity: .6; }
html.it-on.it-only ${TR_TAG} { display: none !important; }
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

/** 只看译文：把本段译文原地写进原文（先换回旧的替换，保证可重复调用） */
export function showInPlace(block: Element): void {
  showOriginal(block);
  const text = ownTr(block)?.textContent;
  if (text) swaps.set(block, swapText(ownTextNodes(block), text));
}

/** 换回本段原文 */
export function showOriginal(block: Element): void {
  const records = swaps.get(block);
  if (!records) return;
  restoreText(records);
  swaps.delete(block);
}

function isInPlaceActive(doc: Document): boolean {
  const classes = doc.documentElement.classList;
  return classes.contains('it-on') && classes.contains('it-only');
}

export function clearTranslation(block: Element): void {
  showOriginal(block);
  ownTr(block)?.remove();
  block.removeAttribute(LEVEL_ATTR);
}

function createTr(unit: Unit): Element {
  const { block, anchor } = unit;
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
  if (isInPlaceActive(unit.block.ownerDocument)) showInPlace(unit.block);
  return true;
}
