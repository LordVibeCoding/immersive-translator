import { saveSettings, toggleNeverSite, type Settings } from '../shared/settings';
import { createFloatingBall, type BallState, type FloatingBall } from './floating-ball';
import { applyTabCommand, type CommandTarget } from './tab-commands';

export interface BallMount {
  /** 本页开关/模式变化后刷新悬浮球外观 */
  refresh(): void;
  /** 设置变化（站点名单、位置）后同步显示状态 */
  applySettings(settings: Settings): void;
}

/** 把悬浮球接到本页的翻译控制上；本站被隐藏时不显示 */
export function mountFloatingBall(target: CommandTarget, initial: Settings, hostname: string): BallMount {
  let settings = initial;
  let ball: FloatingBall | null = null;

  const state = (): BallState => ({ ...target.state, neverSite: settings.neverSites.includes(hostname) });
  const refresh = () => ball?.update(state());
  const save = (patch: Partial<Settings>) => {
    saveSettings(patch).catch((err: unknown) => console.warn('[沉浸翻译] 保存设置失败', err));
  };

  const handlers = {
    onToggle: () => {
      target.toggle();
      refresh();
    },
    onToggleMode: () => {
      applyTabCommand(target, { type: 'toggle-mode' }, (mode) => save({ mode }));
      refresh();
    },
    onToggleNeverSite: () => save({ neverSites: toggleNeverSite(settings.neverSites, hostname) }),
    onHide: () => save({ ballHiddenSites: toggleNeverSite(settings.ballHiddenSites, hostname) }),
    onMove: (top: number) => save({ ballTop: top }),
  };

  const applySettings = (next: Settings) => {
    settings = next;
    const visible = !settings.ballHiddenSites.includes(hostname);
    if (visible && !ball) ball = createFloatingBall(document, handlers, state(), settings.ballTop);
    if (!visible && ball) {
      ball.remove();
      ball = null;
    }
    refresh();
  };

  applySettings(initial);
  return { refresh, applySettings };
}
