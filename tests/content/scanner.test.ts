import { beforeEach, describe, expect, it } from 'vitest';
import { findBlocks, readUnit } from '@/src/content/scanner';

const byId = (id: string) => document.getElementById(id)!;
const ids = (els: Element[]) => els.map((e) => e.id);

describe('scanner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('段落内的行内元素归属于段落', () => {
    document.body.innerHTML = '<p id="p">Hello <a href="#">world</a> and <b>more</b>.</p>';
    expect(ids(findBlocks(document.body))).toEqual(['p']);
    expect(readUnit(byId('p'))?.text).toBe('Hello world and more.');
  });

  it('跳过代码块、可编辑区与 notranslate', () => {
    document.body.innerHTML =
      '<pre>code here</pre><div contenteditable="true">edit me</div>' +
      '<div class="notranslate">keep</div><p id="p">Real text</p>';
    expect(ids(findBlocks(document.body))).toEqual(['p']);
  });

  it('不把插件插入的译文当作原文', () => {
    document.body.innerHTML = '<p id="p">Hello there<it-tr>你好</it-tr></p>';
    expect(readUnit(byId('p'))?.text).toBe('Hello there');
  });

  it('混合块只取自身文字，锚点在嵌套块之前', () => {
    document.body.innerHTML = '<ul><li id="outer">Outer text <ul><li id="inner">Inner text</li></ul></li></ul>';
    expect(ids(findBlocks(document.body))).toEqual(['outer', 'inner']);
    const unit = readUnit(byId('outer'))!;
    expect(unit.text).toBe('Outer text');
    expect(unit.anchor).toBe(byId('outer').firstChild);
  });

  it('没有自身文字的块返回 null', () => {
    document.body.innerHTML = '<div id="d"><p>Only child</p></div>';
    expect(readUnit(byId('d'))).toBeNull();
  });

  it('Twitter 式 div>span 结构整体是一个段落', () => {
    document.body.innerHTML =
      '<div id="t" data-testid="tweetText"><span>Just shipped</span><span> a new feature</span></div>';
    expect(ids(findBlocks(document.body))).toEqual(['t']);
    expect(readUnit(byId('t'))?.text).toBe('Just shipped a new feature');
  });

  it('从段落内部节点开始扫描时仍返回外层段落', () => {
    document.body.innerHTML = '<p id="p">Hello <span id="s">dear <b>friend</b></span></p>';
    expect(ids(findBlocks(byId('s')))).toEqual(['p']);
  });

  it('锚点是包含最后一段文字的直接子节点', () => {
    document.body.innerHTML = '<p id="p">Read <a id="a" href="#">the docs</a></p>';
    expect(readUnit(byId('p'))?.anchor).toBe(byId('a'));
  });

  it('行内 <code> 的文字保留在段落里；pre > code 仍跳过', () => {
    document.body.innerHTML = '<p id="p">Use <code>x</code> now</p><pre><code>a</code></pre>';
    expect(ids(findBlocks(document.body))).toEqual(['p']);
    expect(readUnit(byId('p'))?.text).toBe('Use x now');
  });

  it('kbd/var/samp/del/ins/wbr 视为行内元素', () => {
    document.body.innerHTML =
      '<p id="p">Press <kbd>Ctrl</kbd> and <var>n</var>, <samp>ok</samp>, <del>old</del>, <ins>new</ins>, long<wbr>word</p>';
    expect(ids(findBlocks(document.body))).toEqual(['p']);
    expect(readUnit(byId('p'))?.text).toBe('Press Ctrl and n, ok, old, new, longword');
  });

  describe('按实际渲染样式判断是否独立成段', () => {
    it('被设成块级的 <a>（如下拉菜单项）各自成段，不合并成一整段', () => {
      document.body.innerHTML =
        '<div id="menu"><a id="i1" style="display:block">SSL Certificates</a><a id="i2" style="display:flex">Domain Privacy</a></div>';
      expect(ids(findBlocks(document.body))).toEqual(['i1', 'i2']);
      expect(readUnit(byId('i1'))?.text).toBe('SSL Certificates');
      expect(readUnit(byId('menu'))).toBeNull();
    });

    it('绝对定位的小标签（如 New 徽章）单独成段，不并进菜单项文字', () => {
      document.body.innerHTML =
        '<ul><li id="li"><a href="#">Security <span id="badge" style="position:absolute">New</span></a></li></ul>';
      expect(readUnit(byId('li'))?.text).toBe('Security');
      expect(readUnit(byId('badge'))?.text).toBe('New');
    });

    it('inline-block 的 span 徽章单独成段', () => {
      document.body.innerHTML = '<p id="p">Account <span id="b" style="display:inline-block">New</span></p>';
      expect(readUnit(byId('p'))?.text).toBe('Account');
      expect(readUnit(byId('b'))?.text).toBe('New');
    });

    it('inline-block 的 kbd/code 仍属于段落正文', () => {
      document.body.innerHTML =
        '<p id="p">Press <kbd style="display:inline-block">Ctrl</kbd> and run <code style="display:inline-block">ls</code> now</p>';
      expect(ids(findBlocks(document.body))).toEqual(['p']);
      expect(readUnit(byId('p'))?.text).toBe('Press Ctrl and run ls now');
    });

    it('display:inline 的 div 并进所在段落', () => {
      document.body.innerHTML = '<div id="p">Hello <div style="display:inline">dear</div> friend</div>';
      expect(readUnit(byId('p'))?.text).toBe('Hello dear friend');
    });
  });
});
