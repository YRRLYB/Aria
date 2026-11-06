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

## 3. 原生 mpv 解码器

Aria 有两套播放链路：Web Audio（默认，任何平台可用）和 mpv 原生引擎（低占用、共享/独占输出、EQ 标签链）。

- 仓库里的 `vendor/mpv/Aria.exe` 是 Windows 版，由 `npm run ensure:mpv` 下载并改名。
- macOS 上 `ensure:mpv` 会自动下载并解压 mpv：Intel + macOS 14（Sonoma）使用社区 All-in-One 构建（macOS 11+，带完整 dylib），Intel + macOS 15+ 使用官方 `macos-15-intel`，Apple Silicon 按 macOS 14 / 15 / 26 选择官方对应构建。二进制与 `lib/` 一起放到 `vendor/mpv/`，打包时通过 `asarUnpack` 原样落到 `Resources/app.asar.unpacked/vendor/mpv/`。
- 下载失败会自动回退到本机安装的 mpv（Homebrew / MacPorts / mpv.app / `PATH`），都没有时提示后跳过（不报错）。此时 `MpvAudioEngine.isSupported()` 为 `false`，前端自动回落到 Web Audio，功能不缺，只是少了原生输出与更低的内存占用。
- 原生引擎启动前会执行一次 `mpv --list-options`，只传该二进制确实支持的参数（例如旧版 mac 构建没有 `--media-controls` / `--audio-set-media-role`）。此前把 Windows 参数原样传给 macOS mpv，会让 mpv 在创建 IPC socket 前直接退出，表现就是“mac 上 mpv 不能用”。现在已修复。
- 想手动替换：把对应架构的 mpv 可执行文件和 `lib/` 放到 `vendor/mpv/`（可执行文件不要带扩展名，需 `chmod +x`），或直接 `brew install mpv`。渲染层在挂载时通过 `aria:native-audio:supported` 二次确认二进制存在性，再决定是否启用 mpv 输出模式。

```bash
# 重新准备 mpv（会按当前 macOS 版本和 CPU 架构下载兼容构建）
npm run ensure:mpv
```

设置页在检测不到 mpv 时会显示“播放走浏览器音频引擎”的提示。

## 3.1 没有声音 / 只能用浏览器播放时怎么查

按顺序排查，基本都是"没有可播放的流"，而不是 macOS 音频栈的问题：

1. **未登录 + VIP 曲目**：网易云未登录时免费曲目可以正常播放（自动降级到能拿到的档位），VIP 曲目会返回 `该歌曲暂无可播放的音频链接：可能需要网易云会员，或登录已过期`。登录后重试即可。
2. **QQ 音乐**：匿名请求只下发加密流，Aria 不做解密，必须在 设置 → 播放源 → QQ 音乐 绑定 Cookie（扫码或粘贴）。未绑定时表现为曲目能搜到但点播放报"需要 VIP 或登录已过期"。
3. **网易云"环境异常"**：网易云对海外 / 云主机出口 IP 会返回 460 与"环境异常"。设置 → 播放源 → 网易云 → 网络环境补偿，填一个国内出口 IP（等价于环境变量 `ARIA_NETEASE_REAL_IP`），会以 `X-Real-IP` 形式传给网易云；扫码登录的 Cookie 也会贯穿 `login_qr_key → login_qr_create → login_qr_check` 整条链路，避免轮询被当成陌生设备。
4. **原生输出档位点不动**：说明没有找到 mpv，见上一节。此时"系统音频"档位就是浏览器音频引擎，声音正常，只是没有独占输出。
5. 想看服务端到底返回了什么：`curl -s "http://127.0.0.1:3636/api/sources/netease/tracks/<id>/stream-meta?level=lossless"`，能拿到 `url` 即后端正常；Electron 主进程日志在 `~/Library/Logs/Aria/`。

## 4. 平台能力差异

| 能力 | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Web Audio 播放 | ✅ | ✅ | ✅ |
| mpv 原生引擎 | ✅（WASAPI，独占/共享） | ✅（coreaudio，`ensure:mpv` 自动准备） | 放入二进制后 ✅ |
| 系统级媒体控制（SMTC） | ✅ | ✅（原生 Now Playing 模块：锁屏/控制中心封面与媒体键；模块缺失时回落 Chromium 媒体会话） | ❌ |
| 任务栏缩略图按钮 / 图标缩略图 | ✅（原生插件） | ❌ | ❌ |
| CD 抓取 / 光驱识别 | ✅（PowerShell + WMI） | ❌（`listCdDrives` 直接返回空） | ❌ |
| 全局快捷键 | ✅ | ✅（需在系统设置里授权辅助功能） | ✅ |
| 后台托盘常驻 | ✅ | ✅（菜单栏图标） | ✅ |
| 自绘窗口按钮 | ✅ | ❌（原生交通灯） | ✅ |

## 5. 已知 TODO

1. ~~macOS 媒体控制~~ ✅ 已接入：`electron/native/aria-nowplaying/`（ObjC++ N-API 模块）挂 `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter`，构建走 `npm run build:native`（darwin 分支，失败不阻塞出包）；主进程复用 `aria:update-media-session` IPC 与 `aria:playback-command` 命令通道，媒体键生效时禁用 Chromium 的 `HardwareMediaKeyHandling` 防双控。未做：播放进度时间轴（需渲染层推送 duration/position）。
2. macOS CD 抓取：可用 `drutil`/`afconvert` 实现，优先级低（CD 为 Windows 老功能）。
3. Linux 打包未做运行验证，仅保证 `build:web` / `build:server` / 图标路径可用。
4. macOS 自动更新（`electron-updater`）尚未接入，目前与 Windows 一样为手动下载安装。
