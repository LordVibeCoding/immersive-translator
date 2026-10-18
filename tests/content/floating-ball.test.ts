import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFloatingBall, type BallHandlers, type BallState } from '@/src/content/floating-ball';

const ON: BallState = { enabled: true, mode: 'dual', neverSite: false };

function setup(state: BallState = ON, top = 0.5) {
  const handlers: BallHandlers = {
    onToggle: vi.fn(),
    onToggleMode: vi.fn(),
    onToggleNeverSite: vi.fn(),
    onHide: vi.fn(),
    onMove: vi.fn(),
  };
  const ball = createFloatingBall(document, handlers, state, top);
  const root = ball.host.shadowRoot!;
  const $ = (sel: string) => root.querySelector<HTMLElement>(sel)!;
  return { ball, handlers, root, $ };
}

const pointer = (type: string, clientY: number) =>
  new PointerEvent(type, { clientY, bubbles: true, composed: true, pointerId: 1 });

describe('createFloatingBall', () => {
  afterEach(() => {
    document.querySelectorAll('it-ball').forEach((el) => el.remove());
  });

  it('挂在 <html> 下，内容放在 Shadow DOM 里，按比例定位', () => {
    const { ball } = setup(ON, 0.25);
    expect(ball.host.tagName.toLowerCase()).toBe('it-ball');
    expect(ball.host.parentElement).toBe(document.documentElement);
    expect(ball.host.shadowRoot).not.toBeNull();
    expect(ball.host.style.top).toBe('25%');
  });

  it('单击圆球 = 开关翻译', () => {
    const { $, handlers } = setup();
    $('.ball').click();
    expect(handlers.onToggle).toHaveBeenCalledTimes(1);
  });

  it('菜单项分别触发切换模式、本站不自动翻译、隐藏悬浮球', () => {
    const { $, handlers } = setup();
    $('[data-act="mode"]').click();
    $('[data-act="never"]').click();
    $('[data-act="hide"]').click();
    expect(handlers.onToggleMode).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleNeverSite).toHaveBeenCalledTimes(1);
    expect(handlers.onHide).toHaveBeenCalledTimes(1);
    expect(handlers.onToggle).not.toHaveBeenCalled();
  });

  it('update 反映开关状态、当前模式和本站设置', () => {
    const { ball, $ } = setup();
    expect($('.ball').classList.contains('off')).toBe(false);
    expect($('[data-act="mode"]').textContent).toBe('切换为：只看译文');
    expect($('[data-act="never"]').textContent).toBe('本站不自动翻译');

    ball.update({ enabled: false, mode: 'only', neverSite: true });
    expect($('.ball').classList.contains('off')).toBe(true);
    expect($('[data-act="mode"]').textContent).toBe('切换为：双语对照');
    expect($('[data-act="never"]').textContent).toBe('✓ 本站不自动翻译');
  });

  it('上下拖动后保存新位置，且不触发开关', () => {
    const { ball, $, handlers } = setup(ON, 0.5);
    const el = $('.ball');
    el.dispatchEvent(pointer('pointerdown', 100));
    el.dispatchEvent(pointer('pointermove', 200));
    el.dispatchEvent(pointer('pointerup', 200));
    el.click();
    const expected = (0.5 * window.innerHeight + 100) / window.innerHeight;
    expect(handlers.onMove).toHaveBeenCalledWith(expected);
    expect(handlers.onToggle).not.toHaveBeenCalled();
    expect(ball.host.style.top).toBe(`${expected * 100}%`);
  });

  it('移动距离很小时仍算点击', () => {
    const { $, handlers } = setup();
    const el = $('.ball');
    el.dispatchEvent(pointer('pointerdown', 100));
    el.dispatchEvent(pointer('pointermove', 102));
    el.dispatchEvent(pointer('pointerup', 102));
    el.click();
    expect(handlers.onMove).not.toHaveBeenCalled();
    expect(handlers.onToggle).toHaveBeenCalledTimes(1);
  });

  it('拖动位置限制在视口内', () => {
    const { $, handlers } = setup(ON, 0.9);
    const el = $('.ball');
    el.dispatchEvent(pointer('pointerdown', 0));
    el.dispatchEvent(pointer('pointermove', 5000));
    el.dispatchEvent(pointer('pointerup', 5000));
    expect(handlers.onMove).toHaveBeenCalledWith(1);
  });

  it('remove 移除悬浮球', () => {
    const { ball } = setup();
    ball.remove();
    expect(document.querySelector('it-ball')).toBeNull();
  });
});
