import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyMode,
  clearTranslation,
  injectStyles,
  isRendered,
  renderTranslation,
  showInPlace,
  showOriginal,
} from '@/src/content/renderer';
import { readUnit } from '@/src/content/scanner';

const byId = (id: string) => document.getElementById(id)!;
const trOf = (el: Element) => el.querySelector(':scope > it-tr');

describe('renderer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.className = '';
  });

  it('译文插在锚点之后、嵌套块之前', () => {
    document.body.innerHTML = '<ul><li id="outer">Outer text <ul id="nested"><li>Inner</li></ul></li></ul>';
    const unit = readUnit(byId('outer'))!;
    expect(renderTranslation(unit, '外层文字', 'final')).toBe(true);
    const tr = trOf(byId('outer'))!;
    expect(tr.textContent).toBe('外层文字');
    expect(tr.nextElementSibling).toBe(byId('nested'));
  });

  it('draft 带半透明类，final 覆盖 draft 并去掉该类', () => {
    document.body.innerHTML = '<p id="p">Hello world</p>';
    const unit = readUnit(byId('p'))!;
    renderTranslation(unit, '初稿', 'draft');
    expect(trOf(byId('p'))!.classList.contains('it-draft')).toBe(true);
    expect(renderTranslation(unit, '终稿', 'final')).toBe(true);
    expect(trOf(byId('p'))!.textContent).toBe('终稿');
    expect(trOf(byId('p'))!.classList.contains('it-draft')).toBe(false);
    expect(byId('p').querySelectorAll('it-tr')).toHaveLength(1);
  });

  it('低等级结果不能覆盖高等级结果', () => {
    document.body.innerHTML = '<p id="p">Hello world</p>';
    const unit = readUnit(byId('p'))!;
    renderTranslation(unit, '终稿', 'final');
    expect(renderTranslation(unit, '初稿', 'draft')).toBe(false);
    expect(renderTranslation(unit, '另一个终稿', 'final')).toBe(false);
    expect(trOf(byId('p'))!.textContent).toBe('终稿');
  });

  it('译文节点被移除后 isRendered 为 false；clearTranslation 清理干净', () => {
    document.body.innerHTML = '<p id="p">Hello world</p>';
    renderTranslation(readUnit(byId('p'))!, '你好', 'final');
    expect(isRendered(byId('p'))).toBe(true);
    trOf(byId('p'))!.remove();
    expect(isRendered(byId('p'))).toBe(false);
    clearTranslation(byId('p'));
    expect(byId('p').hasAttribute('data-it-level')).toBe(false);
  });

  it('applyMode 切换 html 上的类', () => {
    applyMode(document, true, 'dual');
    expect(document.documentElement.className).toBe('it-on');
    applyMode(document, true, 'only');
    expect(document.documentElement.classList.contains('it-only')).toBe(true);
    applyMode(document, false, 'only');
    expect(document.documentElement.classList.contains('it-on')).toBe(false);
  });

  it('injectStyles 只注入一次', () => {
    injectStyles(document);
    injectStyles(document);
    expect(document.querySelectorAll('#it-styles')).toHaveLength(1);
  });

  it('只看译文模式下渲染：译文原地替换文字，元素保持不变；showOriginal 恢复原文', () => {
    document.body.innerHTML = '<p id="p">Hello there <b id="b">friend</b></p>';
    applyMode(document, true, 'only');
    renderTranslation(readUnit(byId('p'))!, '你好朋友', 'final');
    expect(byId('p').firstChild!.textContent).toBe('你好朋友 ');
    expect(byId('b').textContent).toBe('');
    expect(trOf(byId('p'))!.textContent).toBe('你好朋友');

    showOriginal(byId('p'));
    expect(byId('p').firstChild!.textContent).toBe('Hello there ');
    expect(byId('b').textContent).toBe('friend');
  });

  it('只看译文模式下初稿升级为终稿时，原地文字同步更新', () => {
    document.body.innerHTML = '<p id="p">Hello world</p>';
    applyMode(document, true, 'only');
    const unit = readUnit(byId('p'))!;
    renderTranslation(unit, '初稿', 'draft');
    renderTranslation(unit, '终稿', 'final');
    expect(byId('p').firstChild!.textContent).toBe('终稿');
    showOriginal(byId('p'));
    expect(byId('p').firstChild!.textContent).toBe('Hello world');
  });

  it('双语模式下渲染不改动原文；之后 showInPlace 才替换', () => {
    document.body.innerHTML = '<p id="p">Hello world</p>';
    applyMode(document, true, 'dual');
    renderTranslation(readUnit(byId('p'))!, '你好世界', 'final');
    expect(byId('p').firstChild!.textContent).toBe('Hello world');
    showInPlace(byId('p'));
    expect(byId('p').firstChild!.textContent).toBe('你好世界');
  });

  it('clearTranslation 会先恢复原文；未渲染的块 showInPlace 什么都不做', () => {
    document.body.innerHTML = '<p id="p">Hello world</p><p id="q">Other text</p>';
    applyMode(document, true, 'only');
    renderTranslation(readUnit(byId('p'))!, '你好世界', 'final');
    clearTranslation(byId('p'));
    expect(byId('p').textContent).toBe('Hello world');
    showInPlace(byId('q'));
    expect(byId('q').textContent).toBe('Other text');
  });
});
