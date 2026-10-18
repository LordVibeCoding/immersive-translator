import { BALL_DRAG_THRESHOLD, BALL_TAG } from '../shared/constants';
import type { DisplayMode } from '../shared/settings';
import { BALL_ICON, BALL_STYLES } from './floating-ball-style';

export interface BallState {
  readonly enabled: boolean;
  readonly mode: DisplayMode;
  /** 当前网站是否在「不自动翻译」名单里 */
  readonly neverSite: boolean;
}

export interface BallHandlers {
  onToggle(): void;
  onToggleMode(): void;
  onToggleNeverSite(): void;
  onHide(): void;
  /** 拖动结束，参数为新的垂直位置（占视口高度比例 0~1） */
  onMove(top: number): void;
}

export interface FloatingBall {
  readonly host: HTMLElement;
  update(state: BallState): void;
  remove(): void;
}

const MENU_HTML = `
<div class="menu" role="menu">
  <button data-act="mode" role="menuitem"></button>
  <button data-act="never" role="menuitem"></button>
  <button data-act="hide" role="menuitem">隐藏悬浮球（本站）</button>
</div>`;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function setTop(host: HTMLElement, ratio: number): void {
  host.style.top = `${ratio * 100}%`;
}

/** 拖动：超过阈值才算拖动，结束时回调新位置，并吞掉随后的那次 click */
function enableDrag(ball: HTMLElement, host: HTMLElement, wrap: HTMLElement, startTop: number, onMove: (top: number) => void) {
  let top = startTop;
  let drag: { readonly startY: number; readonly startTop: number; moved: boolean } | null = null;
  let suppressClick = false;

  ball.addEventListener('pointerdown', (e) => {
    drag = { startY: e.clientY, startTop: top, moved: false };
  });
  ball.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dy) < BALL_DRAG_THRESHOLD) return;
    drag.moved = true;
    wrap.classList.add('dragging');
    top = clamp01((drag.startTop * window.innerHeight + dy) / window.innerHeight);
    setTop(host, top);
  });
  ball.addEventListener('pointerup', () => {
    if (drag?.moved) {
      suppressClick = true;
      wrap.classList.remove('dragging');
      onMove(top);
    }
    drag = null;
  });
  return () => {
    const suppressed = suppressClick;
    suppressClick = false;
    return suppressed;
  };
}

/** 在页面右侧边缘创建悬浮球：单击开关翻译，悬停展开菜单，可上下拖动 */
export function createFloatingBall(doc: Document, handlers: BallHandlers, initial: BallState, top: number): FloatingBall {
  const host = doc.createElement(BALL_TAG);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${BALL_STYLES}</style><div class="wrap">${MENU_HTML}<button class="ball" aria-label="开关翻译" title="开关翻译（Alt+A）">${BALL_ICON}</button></div>`;
  const $ = (sel: string) => root.querySelector<HTMLElement>(sel)!;
  const ball = $('.ball');
  setTop(host, clamp01(top));

  const consumeDrag = enableDrag(ball, host, $('.wrap'), clamp01(top), handlers.onMove);
  ball.addEventListener('click', () => {
    if (!consumeDrag()) handlers.onToggle();
  });
  $('[data-act="mode"]').addEventListener('click', () => handlers.onToggleMode());
  $('[data-act="never"]').addEventListener('click', () => handlers.onToggleNeverSite());
  $('[data-act="hide"]').addEventListener('click', () => handlers.onHide());

  const update = (state: BallState) => {
    ball.classList.toggle('off', !state.enabled);
    ball.title = state.enabled ? '关闭翻译（Alt+A）' : '开启翻译（Alt+A）';
    $('[data-act="mode"]').textContent = state.mode === 'dual' ? '切换为：只看译文' : '切换为：双语对照';
    $('[data-act="never"]').textContent = `${state.neverSite ? '✓ ' : ''}本站不自动翻译`;
  };
  update(initial);
  doc.documentElement.append(host);

  return { host, update, remove: () => host.remove() };
}
