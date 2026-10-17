import { TR_TAG } from '../shared/constants';
import { normalizeText } from './text-filter';

/** 段落：块元素 + 它自身的文字 + 译文插入锚点 */
export interface Unit {
  readonly block: Element;
  readonly text: string;
  readonly anchor: Node;
}

const INLINE_TAGS = new Set([
  'A', 'B', 'STRONG', 'I', 'EM', 'SPAN', 'CODE', 'SMALL', 'SUP', 'SUB', 'MARK', 'ABBR',
  'TIME', 'LABEL', 'U', 'S', 'BR', 'IMG', 'FONT', 'CITE', 'Q',
]);

const SKIP_SELECTOR = [
  'pre', 'code', 'script', 'style', 'noscript', 'textarea', 'input', 'select', 'svg', 'math',
  '[contenteditable=""]', '[contenteditable="true"]', '[translate="no"]', '.notranslate', TR_TAG,
].join(',');

/** 向上跳过行内元素，返回最近的块级祖先（含自身） */
export function nearestBlock(el: Element): Element {
  let current = el;
  while (INLINE_TAGS.has(current.tagName) && current.parentElement) current = current.parentElement;
  return current;
}

function isCandidateText(node: Node): boolean {
  const parent = node.parentElement;
  return Boolean(parent && node.textContent?.trim() && !parent.closest(SKIP_SELECTOR));
}

function candidateTextNodes(root: Element): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (isCandidateText(node)) nodes.push(node as Text);
  }
  return nodes;
}

export function findBlocks(root: Element): Element[] {
  return [...new Set(candidateTextNodes(root).map((n) => nearestBlock(n.parentElement!)))];
}

function directChildOf(block: Element, node: Node): Node {
  let current = node;
  while (current.parentNode && current.parentNode !== block) current = current.parentNode;
  return current;
}

export function readUnit(block: Element): Unit | null {
  const own = candidateTextNodes(block).filter((n) => nearestBlock(n.parentElement!) === block);
  const last = own.at(-1);
  if (!last) return null;
  return {
    block,
    text: normalizeText(own.map((n) => n.textContent ?? '').join('')),
    anchor: directChildOf(block, last),
  };
}
