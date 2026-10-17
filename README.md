# 沉浸翻译（自用）

英文网页双语对照翻译：Chrome 内置本地翻译秒出初稿，大模型后台流式精翻并替换。

## 安装

1. `pnpm install && pnpm build`
2. 打开 `chrome://extensions`，开启「开发者模式」，点「加载已解压的扩展程序」，选择 `.output/chrome-mv3`
3. 点插件图标 → 「下载本地翻译模型」（只需一次）
   - 弹窗里显示的是扩展自身的状态；Chrome 为防指纹按网站分别报告本地翻译是否可用，所以**每个网站第一次需要在页面上点一下（或按任意键）**才会启用本地翻译，之后该网站不再需要
4. （可选）插件图标 → 设置：填写 OpenAI 兼容接口的地址、API Key、模型，点「测试连接」

## 使用

| 操作 | 快捷键 |
| --- | --- |
| 开关当前页翻译 | Alt+A（macOS 为 Option+A） |
| 双语对照 ⇄ 只看译文 | Alt+S（macOS 为 Option+S） |

快捷键可在 `chrome://extensions/shortcuts` 修改。半透明的是本地初稿，变成正常颜色说明大模型精翻已完成。

每个网站第一次打开时，本地初稿要等你在页面上点击一次（或按任意键）后才会出现；此前已在屏幕上、还没精翻完成的段落会随即补上初稿。

## 开发

- `pnpm dev`：开发模式（自动打开带插件的浏览器，热更新）
- `pnpm test` / `pnpm test:coverage`：单元与集成测试
- `pnpm test:e2e`：端到端测试（模拟大模型）

## 本地翻译的验证结论

设计上最大的不确定项是：Chrome 内置的 `Translator` API 能不能在内容脚本的隔离世界里用。已用 [Chrome for Testing](https://developer.chrome.com/blog/chrome-for-testing)（与正版 Chrome 同内核，官方明确允许 `--load-extension` 命令行加载，版本 155.0.8059.84）自动化验证过一次：

- 扩展能正常加载（service worker、popup、内容脚本都工作正常）
- 内容脚本里 `'Translator' in self` 为 `true`，**API 本身确实暴露在内容脚本的隔离世界中**
- 点击「下载本地翻译模型」后，连续观察 23 分钟（分两轮，共约 1400 秒），`Translator.availability()` 一直停在 `downloadable`，从未变成 `downloading`/`available`，弹窗文案也从未变化——判断是 Chrome for Testing 本身不具备下载机载翻译模型所需的组件（它是面向自动化测试的精简发行版），不是插件的 bug

注意：命令行加载扩展这件事只在 Chrome for Testing 上验证通过——用 Playwright 正常启动**正版 Google Chrome**（即使去掉 Playwright 默认附加的 `--disable-extensions` 参数）仍然加载失败，判断正版 Chrome 对命令行加载未打包扩展有自己的拦截策略，这与 Playwright 的默认参数无关。这**不影响**手工走「开发者模式 → 加载已解压的扩展程序」的正常安装方式（那是 Chrome 官方长期支持、面向普通用户的路径，没有被限制）。

也因此，本地模型下载到底耗时多久、下载完成后译文能否正常出现，仍然只能在真实的正版 Chrome 环境里手动确认一次（Chrome for Testing 验证不了这一步）：

1. `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择 `.output/chrome-mv3`
2. 点插件图标，若本地翻译显示「模型未下载」，点「下载本地翻译模型」，等待下载完成
3. 打开任一英文网页，在页面上点击一次（每个网站首次需要），确认随即出现半透明译文
4. 若本地译文始终不出现：在该网页的控制台执行 `'Translator' in self`（预期为 `true`，若为 `false` 说明当前设备/Chrome 版本不支持，当前版本没有退路，即设计文档 4.3 提到的 offscreen document 方案未实现，本地翻译在该环境下不可用，仅大模型精翻可用）

## 已知限制

- 仅英译中；仅正版 Chrome 138+
- 每个网站第一次需要在页面上点一下才有本地初稿（Chrome 按网站报告本地翻译可用性，创建翻译器需要页面上的用户操作）
- 本地模型首次下载耗时未知（真机实测待定），下载失败或耗时过长时请按上文手动确认
- 译文中不保留段内链接/加粗（双语模式可点原文链接）
- 精翻缓存不自动清理
