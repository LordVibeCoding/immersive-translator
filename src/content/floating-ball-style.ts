import { BALL_SIZE } from '../shared/constants';

const HALF = BALL_SIZE / 2;

/** 悬浮球内部的 Logo（与工具栏图标同款：蓝色渐变 +「译」） */
export const BALL_ICON = `
<svg viewBox="0 0 36 36" width="${BALL_SIZE}" height="${BALL_SIZE}" aria-hidden="true">
  <defs>
    <linearGradient id="it-ball-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#0ea5e9"/>
    </linearGradient>
  </defs>
  <circle cx="18" cy="18" r="18" fill="url(#it-ball-bg)"/>
  <text x="18" y="24.5" text-anchor="middle" font-size="17" font-weight="600" fill="#fff"
    font-family="'PingFang SC','Microsoft YaHei',sans-serif">译</text>
</svg>`;

/**
 * 平时只露出半个球贴在右边缘；鼠标移入（或拖动中）整体滑出并展开菜单。
 * :host 重置所有继承样式，避免被网站 CSS 影响。
 */
export const BALL_STYLES = `
:host {
  all: initial;
  position: fixed;
  right: 0;
  z-index: 2147483646;
  transform: translateY(-50%);
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  transform: translateX(${HALF}px);
  transition: transform .18s ease;
}
:host(:hover) .wrap, .wrap.dragging { transform: translateX(-6px); }
.menu {
  display: none;
  flex-direction: column;
  min-width: 150px;
  padding: 4px;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(15, 23, 42, .18);
}
:host(:hover) .wrap:not(.dragging) .menu { display: flex; }
.menu button {
  all: unset;
  padding: 7px 10px;
  border-radius: 6px;
  color: #1f2937;
  cursor: pointer;
  white-space: nowrap;
}
.menu button:hover { background: #eff6ff; color: #1d4ed8; }
.ball {
  all: unset;
  width: ${BALL_SIZE}px;
  height: ${BALL_SIZE}px;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(37, 99, 235, .35);
  touch-action: none;
  transition: filter .18s ease, opacity .18s ease;
}
.ball svg { display: block; }
.ball.off { filter: grayscale(1); opacity: .65; box-shadow: 0 2px 8px rgba(0, 0, 0, .2); }
.ball:focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; }
`;
