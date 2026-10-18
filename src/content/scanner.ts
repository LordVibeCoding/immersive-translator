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
  '[contenteditable=""]', '[contenteditable="true"]', TR_TAG,
].join(',');

/** 网站标记的「不要翻译」区域 */
const NO_TRANSLATE_SELECTOR = '[translate="no"], .notranslate';

/**
 * 是否位于网站标记的不翻译区域。加在 <html>/<body> 上的整页标记忽略：React/Next.js 网站常用它
 * 防止浏览器整页翻译改动 DOM 导致崩溃，并非内容不可翻译；本插件不删改网站元素，不受此影响。
 * 网页内部元素上的标记（品牌名、代码片段等）仍然尊重。
 */
function isOptedOut(el: Element): boolean {
  const hit = el.closest(NO_TRANSLATE_SELECTOR);
  const doc = el.ownerDocument;
  return hit !== null && hit !== doc.documentElement && hit !== doc.body;
}

/** 语义上属于正文的行内标签：网站常把它们设成 inline-block 做成小方块，仍应并进段落 */
const TEXT_LEVEL_TAGS: ReadonlySet<string> = new Set([
  'CODE', 'KBD', 'VAR', 'SAMP', 'ABBR', 'MARK', 'SUB', 'SUP', 'Q', 'CITE', 'TIME',
]);

/**
 * 是否属于所在段落的行内文字。按实际渲染样式判断：网站常把 <a>/<span> 设成块级菜单项、
 * 绝对定位的「New」徽章或 inline-block 的标签胶囊，它们在视觉上是独立的，应单独成段。
 * 拿不到计算样式时（未渲染或测试环境默认行内显示为空）按标签判断。
 */
function isInlineText(el: Element): boolean {
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style?.position === 'absolute' || style?.position === 'fixed') return false;
  const display = style?.display ?? '';
  if (display === 'inline' || display === 'contents') return true;
  if (display === 'inline-block' || display === 'inline-flex') return TEXT_LEVEL_TAGS.has(el.tagName);
  if (display) return false;
  return INLINE_TAGS.has(el.tagName);
}

/** 向上跳过行内元素，返回最近的块级祖先（含自身） */
export function nearestBlock(el: Element): Element {
  let current = el;
  while (isInlineText(current) && current.parentElement) current = current.parentElement;
  return current;
}

function isCandidateText(node: Node): boolean {
  const parent = node.parentElement;
  return Boolean(parent && node.textContent?.trim() && !parent.closest(SKIP_SELECTOR) && !isOptedOut(parent));
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
