# Aria 0.6.0 —— macOS / 跨平台适配说明

本文记录 Aria 从「Windows 专用」到「Windows + macOS（+ Linux 预览）」的改造范围，以及各平台的能力差异和打包步骤。

## 1. 已适配

| 位置 | 改动 | 说明 |
| --- | --- | --- |
| `electron/main.cjs` | `resolveIcon()` 按平台返回 `build/icon.ico` / `build/icon.png` | 窗口、托盘、About 图标统一走这里 |
| `electron/main.cjs` | `BrowserWindow` 选项按平台切换 | macOS：`frame: true` + `titleBarStyle: "hiddenInset"` + `trafficLightPosition`，保留原生红黄绿；Windows/Linux 仍是 `frame: false` + 自绘窗口按钮 |
| `electron/main.cjs` | 新增 `window-all-closed` | macOS 关闭窗口后常驻 Dock，不退出进程 |
| `electron/preload.cjs` | 暴露 `platform: process.platform` | 渲染层据此渲染平台正确的外壳 |
| `src/main.tsx` | 写入 `document.documentElement.dataset.platform` | 供 CSS 使用 |
| `src/App.tsx` | `platform === "darwin"` 时隐藏自绘窗口按钮 | 避免与原生交通灯重复 |
| `src/theme.css` | `[data-platform="darwin"] .app-header { padding-left: 92px }` | 给交通灯留出空间 |
| `electron/mpvEngine.cjs` | 原生解码器可执行文件、音频输出、IPC 端点按平台切换 | Windows: `Aria.exe` + `--ao=wasapi` + 命名管道；macOS: `mpv` + `--ao=coreaudio` + `$TMPDIR` 下的 unix socket；Linux: `mpv` + `--ao=pipewire,pulse,alsa` |
| `electron/mpvEngine.cjs` | POSIX 下 teardown 删除 socket 文件 | mpv 不会自己清理 |
| `package.json` | 新增 `mac` / `dmg` / `linux` 打包配置与 `dist:mac`、`dist:linux` 脚本 | `appId com.yrrlyb.aria`、`category public.app-category.music`、x64 + arm64 DMG |

## 2. 打包

```powershell
# Windows
npm run dist:beta

# macOS（必须在 macOS 上执行，可交叉打 x64 + arm64）
npm run dist:mac

# Linux 预览
npm run dist:linux
```

产物在 `release/`：`Aria-<version>-<arch>.dmg` / `.exe` / `.AppImage`。

未签名说明：`dist:mac` 目前不签名、不公证。首次打开需要「系统设置 → 隐私与安全性 → 仍要打开」，或本地

```bash
xattr -dr com.apple.quarantine /Applications/Aria.app
```

如要正式分发，需要补 `CSC_LINK` / `CSC_KEY_PASSWORD`（或在 `build.mac` 里配置 `identity`）并执行 `notarytool` 公证。

## 3. 原生 mpv 解码器（可选）

Aria 有两套播放链路：Web Audio（默认，任何平台可用）和 mpv 原生引擎（低占用、独占输出、EQ 标签链）。

- 仓库里的 `vendor/mpv/Aria.exe` 是 Windows 版，由 `npm run ensure:mpv` 下载并改名。
- macOS 上 `ensure:mpv` 会跳过下载（脚本内已有平台判断）。此时 `MpvAudioEngine.isSupported()` 为 `false`，前端自动回落到 Web Audio，功能不缺，只是少了独占输出与更低的内存占用。
- 想启用原生引擎：把对应架构的 mpv 可执行文件放到 `vendor/mpv/mpv`（不要带扩展名，需 `chmod +x`）。打包时该目录通过 `asarUnpack` 原样落到 `Resources/app.asar.unpacked/vendor/mpv/`。

```bash
# 例：Homebrew 的 mpv 二进制（arm64）
cp "$(brew --prefix)/bin/mpv" vendor/mpv/mpv && chmod +x vendor/mpv/mpv
```

## 4. 平台能力差异

| 能力 | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Web Audio 播放 | ✅ | ✅ | ✅ |
| mpv 原生引擎 | ✅（WASAPI，独占/共享） | 放入二进制后 ✅（coreaudio） | 放入二进制后 ✅ |
| 系统级媒体控制（SMTC） | ✅ | ❌（后续接 MPNowPlayingInfoCenter） | ❌ |
| 任务栏缩略图按钮 / 图标缩略图 | ✅（原生插件） | ❌ | ❌ |
| CD 抓取 / 光驱识别 | ✅（PowerShell + WMI） | ❌（`listCdDrives` 直接返回空） | ❌ |
| 全局快捷键 | ✅ | ✅（需在系统设置里授权辅助功能） | ✅ |
| 后台托盘常驻 | ✅ | ✅（菜单栏图标） | ✅ |
| 自绘窗口按钮 | ✅ | ❌（原生交通灯） | ✅ |

## 5. 已知 TODO

1. macOS 媒体控制：需要 `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter`，可在 Electron 主进程通过 `native` 模块或 `electron-media-service` 类方案接入。
2. macOS CD 抓取：可用 `drutil`/`afconvert` 实现，优先级低（CD 为 Windows 老功能）。
3. Linux 打包未做运行验证，仅保证 `build:web` / `build:server` / 图标路径可用。
4. macOS 自动更新（`electron-updater`）尚未接入，目前与 Windows 一样为手动下载安装。
