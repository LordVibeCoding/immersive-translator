import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '沉浸翻译（自用）',
    description: '英文网页双语对照：本地翻译秒出初稿，大模型后台精翻',
    permissions: ['storage'],
    host_permissions: ['<all_urls>'],
    commands: {
      'toggle-translate': { suggested_key: { default: 'Alt+A' }, description: '开关当前页翻译' },
      'toggle-mode': { suggested_key: { default: 'Alt+S' }, description: '切换双语对照 / 只看译文' },
    },
  },
});
