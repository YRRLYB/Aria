# Aria 0.6.0 —— Windows 桌面适配与验证记录

macOS / 多音源改造（`3479636`）与圆角图标（`6b2a2b5`）合入主线后，本文记录 Windows 桌面端的回归范围、验证方式与打包产物。结论：最新源码在 Windows 上不需要额外平台分支即可正常工作；本次只修了 3 处跨平台类型错误、1 个搜索分页丢源问题，并让桌面集成测试等待后端就绪。

## 1. 结论

- 最新 `origin/main`（`6b2a2b5`）在 Windows 11 x64 上完成构建、打包、安装与真机启动验证。
- macOS 适配新增的平台判断都带 `darwin` / `win32` 分支，Windows 专属能力保持原状：SMTC 系统媒体控制、任务栏缩略图按钮与缩略图预览、WASAPI 共享/独占输出、mpv 原生播放、CD 抓取、全局快捷键、托盘、自绘窗口按钮。
- 0.6.0 新功能在 Windows 上可用：QQ 音乐搜索 / 我喜欢 / 歌单 / 展示码率，设置内双音源登录，桌面端 QQ 窗口扫码（`window.ariaDesktop.qqLoginWindow()` 能打开真实 `y.qq.com` 登录窗口），圆角应用图标。
- 安装包：`release/Aria-0.6.0-x64.exe`，163,870,016 字节，SHA-256 `783087701541BEDD999B6CF6F2CF12E4E1F37473EAC5F31C6C1DF3685B8CEF6A`，未签名。

## 2. 验证环境

| 项 | 值 |
| --- | --- |
| 系统 | Windows 11 专业版，build 26200，x64 |
| CPU | Intel Core i5-14600KF |
| 音频设备 | Realtek High Definition Audio 及多路 USB/虚拟声卡 |
| Node / npm | v24.15.0 / 11.12.1 |
| Electron | 43.0.0 |
| 原生 mpv | `vendor/mpv/Aria.exe`，`mpv v0.41.0-dev-g41f6a6450`（FFmpeg `f853d12`） |
| 原生构建 | VS2022 BuildTools + Python 3.13（node-gyp） |

> Windows PowerShell 默认禁止执行 `npm.ps1`，本文所有命令都使用 `npm.cmd` / `npx.cmd`。

## 3. 平台相关路径复核

- 渲染层：`src/main.tsx` 写入 `document.documentElement.dataset.platform`；`src/App.tsx:2152` 仅在非 `darwin` 时渲染自绘最小化 / 最大化 / 关闭按钮；`src/theme.css:28` 只为 `darwin` 增加交通灯内边距；`src/components/music/SettingsPanels.tsx` 的 `isMac` 只影响输出档位文案（Windows 显示 WASAPI 共享 / 独占）。
- 主进程：Windows 使用 `frame: false` 自绘窗口；非 `darwin` 移除系统菜单；`syncTaskbarPlayback()` 里的 `setThumbnailToolTip()` 位于 `win32` 守卫之后（macOS 白屏修复未影响 Windows）；Windows 媒体会话、任务栏缩略图按钮与 `setAppDetails` 均走原有分支；QQ 窗口扫码复用 `aria:qq-login-window` IPC。
- `electron/mpvEngine.cjs`：Windows 使用 `Aria.exe`、`--ao=wasapi`、`--audio-exclusive` 与命名管道 `\\.\pipe\aria-mpv-*`；`--list-options` 参数探测只在非 Windows 执行；teardown 只清理 POSIX socket。
- `electron/preload.cjs`：`platform` 与 `nativeAudio.supported`（`win32 || darwin`）正常暴露。

## 4. 构建与打包

```powershell
npm.cmd test                 # 42 个测试文件 / 255 个测试
npx.cmd tsc -b               # 0 error（必须用 -b，见第 7 节）
node --check electron/main.cjs
npm.cmd run build:desktop    # chained: ensure:mpv + build:native + build:web + build:server
npm.cmd run dist:beta        # electron-builder --win nsis --x64
```

- `build:native` 用 node-gyp 重建 `electron/native/aria-thumbnail`（MSBuild Release x64），并把 `build/Release/aria_thumbnail.node` 复制到插件根目录。
- `build:web`：Vite 7.3.6，2116 个模块，`dist/assets/index-*.js` 761.56 kB、CSS 123.68 kB。
- `build:server`：esbuild 生成 `dist-server/index.cjs`（2.3 MB），`copy-ncm-runtime` 复制 189 个后端运行时依赖。
- `dist:beta`：electron-builder 26.15.3，输出 `release/win-unpacked/` 与 NSIS 安装包 `release/Aria-0.6.0-x64.exe`；`Aria.exe` ProductVersion `0.6.0.0`、FileVersion `0.6.0`；安装包未签名（`NotSigned`）。
- `vendor/mpv/Aria.exe` 与 `release/win-unpacked/resources/app.asar.unpacked/electron/native/aria-thumbnail/aria_thumbnail.node`（168,960 B）都正确进入安装包。

## 5. 桌面集成测试

`scripts/test-desktop.cjs` 是 Windows 专用端到端脚本：启动独立的 Electron 实例（独立 profile、`ARIA_API_PORT`、App ID），经 CDP 驱动界面，并通过 `scripts/windows-media-session.ps1` 读取真实的 Windows 媒体会话。覆盖内容：

- 本地封面：内嵌 ID3 提取，原图 3000×2000，`?size=320` → 320×213、`?size=768` → 768×512。
- 输出档位：`system` → `shared` → `exclusive` → `system`，逐档验证音量标准化开关及 `aria-audio-settings` 持久化。
- SMTC：标题 / 歌手 / 专辑 / 封面变化与清除、播放暂停幂等、上一首下一首、托盘后台控制。
- 原生播放：mpv 在 EOF 处的无缝切歌与单曲循环。

结果（打包态 `--resources release/win-unpacked/resources`，`.cache/desktop-smoke-oo7X5R`）：

```text
PASS local artwork: embedded extraction, original, 320px and 768px disk cache
PASS system: loudness toggle, persisted setting, active playback
PASS system: metadata, changed/missing artwork, play/pause, queue, background
PASS shared: loudness toggle, persisted setting, active playback
PASS shared: metadata, changed/missing artwork, play/pause, queue, background
PASS exclusive: loudness toggle, persisted setting, active playback
PASS exclusive: metadata, changed/missing artwork, play/pause, queue, background
PASS system: loudness toggle, persisted setting, active playback
PASS system: metadata, changed/missing artwork, play/pause, queue, background
PASS gapless advance: native EOF and media card
PASS repeat-one: native EOF and media card
```

`results.json` 里 `system` 档的原生引擎 `active: false`，`shared` / `exclusive` 档 `active: true` 且 `trackId` 为 `smtc-0`，与预期一致。开发态（`node scripts/test-desktop.cjs`）同样全绿（`.cache/desktop-smoke-3VRmTj`）。

> 2026-11-07 修复了测试自身的启动竞态：渲染层挂载时内置后端可能还在启动，脚本会立刻调用 `/api/library/scan` 而得到 `ECONNREFUSED`。现在先轮询 `/api/health` 再开始，慢机器上也能稳定通过。

## 6. 打包版真机冒烟

启动 `release/win-unpacked/Aria.exe --remote-debugging-port=9222`，经 CDP 检查：

- 页面地址 `file:///.../resources/app.asar/dist/index.html`，标题 `Aria`；`.app-navigation` / `.app-header` 存在；`document.documentElement.dataset.platform === "win32"`；`window.ariaDesktop.platform === "win32"`；`nativeAudio.supported === true`；自绘窗口按钮 3 个。
- `%APPDATA%\Aria\logs\desktop.log`：`Windows media session attached: true`、`iconic thumbnail addon attached: true`、任务栏按钮（上一首/播放/暂停/下一首，20×20）已挂载、`backend online: true`。
- `renderer.log`：`renderer mounted`，带上真实播放状态（`activeTrackId: netease:2100202477`、`queueLength: 395`、`nativePlaybackEnabled: true`）。
- 窗口行为：点击最大化后 `outerWidth=2560` 等于屏幕可用宽度，再次点击恢复到初始 1496×908；设置页（`aria-label="设置"`）可打开，包含返回、音量标准化开关、WASAPI 共享 / 独占文案与“播放源”设置。
- QQ 音乐：`window.ariaDesktop.qqLoginWindow()` 打开第二个 Chromium 页面，标题为“QQ音乐-千万正版音乐海量无损曲库新歌热歌天天畅听的高品质音乐平台！”，地址 `https://y.qq.com/`；关闭应用后无残留进程。
- 截图：`.cache/win-home.png`（主页与自绘窗口按钮）、`.cache/win-settings.png`（设置页）。

## 7. 本次改动

| 文件 | 改动 | 原因 |
| --- | --- | --- |
| `src/components/music/CollectionSurfaces.tsx` | `SourceToggle` 的 `onChange` 回调过滤 `"local"` 后再转发 | 该切换器只提供网易云 / QQ 两个在线源，而 `SourceToggleOption` 联合类型还包含 `"local"` |
| `src/components/music/CollectionSurfaces.tsx` | QQ 歌单详情的 `selectedPlaylist` 先收窄为局部常量再进闭包 | 闭包里直接读 `qq.selectedPlaylist` 会丢失非空收窄，`onRetry` 存在 `ProviderPlaylist \| null` |
| `src/hooks/useDiscovery.ts` | `loadMoreSearch()` 的 `setSearchBundle` 保留 `qqTracks: current.qqTracks` | 分页只追加网易云结果，原实现会丢掉已加载的 QQ 搜索结果（运行时 bug） |
| `src/lib/theme.test.ts` | storage mock 显式 `as unknown as Storage` | 测试 mock 只有 `getItem` / `setItem`，不满足 `Storage` 结构 |
| `scripts/test-desktop.cjs` | 渲染层就绪后轮询 `/api/health` | 避免后端尚未监听时扫描接口报 `ECONNREFUSED` 的偶发失败 |
| `docs/windows-0.6.0.md` | 新增本文 | Windows 适配与验证记录 |
| `CHANGELOG.md` / `README.md` | 补充 Windows 回归说明与链接 | 与 macOS 适配文档对齐 |

类型检查说明：仓库根 `tsconfig.json` 只有 `"files": []` 和 project references，`tsc --noEmit -p tsconfig.json` 不会检查任何文件；真正生效的是 `npx tsc -b`（检查 `tsconfig.app.json` 的 `src` 与 `tsconfig.node.json`）。本次修复的 9 个错误均由 `tsc -b` 发现，不影响 Vite/esbuild 出包，但属于项目验收基线。

## 8. 已知限制

1. 安装包未签名，Windows SmartScreen 首次运行会提示；正式分发需配置代码签名证书。
2. QQ 音乐匿名请求只给加密流，播放需在设置里登录；部分音质需要 VIP，无权限时会给出明确提示。
3. 本次只验证了 Windows 11 x64；Windows 10 与 arm64 未测（`dist:beta` 固定 `--x64`）。
4. CD 抓取与全局快捷键依赖真实硬件/系统级按键，未纳入自动化测试；相关 Windows 代码本次未改动。
5. 原生 mpv 依赖 `vendor/mpv/Aria.exe`；缺失时渲染层自动回落到 Web Audio（安装包已内置）。
6. 集成测试会创建独立 Electron profile 与随机端口，结束后清理进程；如需保留日志查看 `.cache/desktop-smoke-*`。

## 9. 复现步骤

```powershell
git fetch origin
git merge --ff-only origin/main      # 6b2a2b5
npm.cmd install
npm.cmd test                         # 42 files / 255 tests
npx.cmd tsc -b
node --check electron/main.cjs
npm.cmd run dist:beta                # → release/Aria-0.6.0-x64.exe
node scripts/test-desktop.cjs
node scripts/test-desktop.cjs --resources release/win-unpacked/resources
```

平台能力差异（HTML 音频 / mpv / SMTC / Now Playing / CD 等）见 [macOS 适配说明](macos-0.6.0.md) 第 4 节。
