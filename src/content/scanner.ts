import { TR_TAG } from '../shared/constants';
import { normalizeText } from './text-filter';

/** 段落：块元素 + 它自身的文字 + 译文插入锚点 */
export interface Unit {
  readonly block: Element;
  readonly text: string;
  readonly anchor: Node;
}

/** 行内标签（大写 tagName）；renderer 用它生成「只看译文」模式的隐藏选择器，保持两处一致 */
const INLINE_TAGS: ReadonlySet<string> = new Set([
  'A', 'B', 'STRONG', 'I', 'EM', 'SPAN', 'CODE', 'SMALL', 'SUP', 'SUB', 'MARK', 'ABBR',
  'TIME', 'LABEL', 'U', 'S', 'BR', 'IMG', 'FONT', 'CITE', 'Q', 'KBD', 'VAR', 'SAMP', 'DEL', 'INS', 'WBR',
]);

/** 行内 <code> 属于段落正文，不跳过；代码块由 'pre' 跳过（含 pre > code） */
const SKIP_SELECTOR = [
  'pre', 'script', 'style', 'noscript', 'textarea', 'input', 'select', 'svg', 'math',
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

/** 段落自身的文字节点（不含嵌套块、跳过区域和插件插入的译文） */
export function ownTextNodes(block: Element): Text[] {
  return candidateTextNodes(block).filter((n) => nearestBlock(n.parentElement!) === block);
}

export function readUnit(block: Element): Unit | null {
  const own = ownTextNodes(block);
  const last = own.at(-1);
  if (!last) return null;
  return {
    block,
    text: normalizeText(own.map((n) => n.textContent ?? '').join('')),
    anchor: directChildOf(block, last),
  };
}
