/** 一个文字节点的替换记录：用于把原文换回来 */
export interface SwapRecord {
  readonly node: Text;
  readonly original: string;
  readonly written: string;
}

const LEADING_SPACE = /^\s*/;
const TRAILING_SPACE = /\s*$/;

/**
 * 只看译文模式：把译文原地写进段落中最长的那个文字节点，其余文字节点清空。
 * 只改文字、不动元素，表单控件、图标、链接等结构和布局都保持原样。
 * 目标节点保留原有首尾空白，避免和相邻元素粘连。
 */
export function swapText(nodes: readonly Text[], translation: string): readonly SwapRecord[] {
  if (nodes.length === 0) return [];
  const target = nodes.reduce((a, b) => (b.data.trim().length > a.data.trim().length ? b : a));
  return nodes.map((node) => {
    const original = node.data;
    const written =
      node === target
        ? `${LEADING_SPACE.exec(original)![0]}${translation}${TRAILING_SPACE.exec(original)![0]}`
        : '';
    node.data = written;
    return { node, original, written };
  });
}

/** 换回原文；网站自己改过的节点（内容已不是我们写入的）保持网站的新内容 */
export function restoreText(records: readonly SwapRecord[]): void {
  records.forEach(({ node, original, written }) => {
    if (node.data === written) node.data = original;
  });
}
