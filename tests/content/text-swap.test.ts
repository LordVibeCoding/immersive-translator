import { beforeEach, describe, expect, it } from 'vitest';
import { restoreText, swapText } from '@/src/content/text-swap';
import { ownTextNodes } from '@/src/content/scanner';

const byId = (id: string) => document.getElementById(id)!;

describe('swapText / restoreText', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('译文写进最长的文字节点，其余清空；元素结构保持不变', () => {
    document.body.innerHTML = '<p id="p">Hi <a id="a" href="#">there</a>, welcome to the docs.</p>';
    const records = swapText(ownTextNodes(byId('p')), '你好，欢迎阅读文档。');
    expect(byId('p').textContent).toBe('你好，欢迎阅读文档。');
    expect(byId('a').textContent).toBe('');
    expect(byId('p').querySelector('a')).toBe(byId('a'));
    restoreText(records);
    expect(byId('p').textContent).toBe('Hi there, welcome to the docs.');
  });

  it('保留目标节点原有的首尾空白，避免和相邻元素粘连', () => {
    document.body.innerHTML = '<button id="b"><i>✎</i> Edit </button>';
    swapText(ownTextNodes(byId('b')), '编辑');
    expect(byId('b').textContent).toBe(' 编辑 ');
  });

  it('网站自己改过的节点不被还原覆盖', () => {
    document.body.innerHTML = '<p id="p">Hello world</p>';
    const records = swapText(ownTextNodes(byId('p')), '你好世界');
    byId('p').firstChild!.textContent = 'Updated by site';
    restoreText(records);
    expect(byId('p').textContent).toBe('Updated by site');
  });

  it('没有文字节点时什么都不做', () => {
    expect(swapText([], '你好')).toEqual([]);
  });
});
