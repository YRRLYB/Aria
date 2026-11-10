# Aria 0.7.0 QA 报告

日期：2026-11-10  
环境：Windows 11 / Node 24.15.0 / Electron 43 / x64；macOS x64/arm64 由 GitHub Actions 构建

## 新增与验证

| 功能 | 实现 | 验证 |
| --- | --- | --- |
| B站第三音源 | `server/sources/bilibili/`：匿名搜索、视频详情、DASH 音轨、可选 CC 字幕歌词、B站封面缓存 | 真实接口：搜索返回 3 首；音频代理 206 `audio/mp4`；视频代理 206 `video/mp4`；封面 200 `image/png` |
| 视频 / 封面双模式 | 播放页与沉浸页可切换；视频模式播放 muxed MP4，封面模式回到高音质音频流 | 浏览器实测：视频播放进度前进；切回封面后音频从同一秒继续 |
| 能力系统 + 播放源开关 | manifest 增加 `capabilities`；设置页逐源启用/禁用；搜索按能力跳过不支持的源 | 浏览器设置页渲染网易云/QQ/B站开关；关闭后搜索芯片刷新 |
| 混合来源 Aria 歌单 | 本地歌单支持网易云、QQ、B站歌曲；远程曲目保存紧凑快照，重启后恢复 | 创建“测试混合”并加入 B站 + QQ 歌曲；重启后 2 首均可播放；localStorage 中不保存 data URL/歌词 |
| 我喜欢聚合 | 默认“全部”视图，本地 + 网易云 + QQ 聚合，保留单来源筛选和来源徽章 | 浏览器显示全部 398 首，来源筛选正常 |
| 自动更新 | `electron-updater` + GitHub Releases；设置页检查/下载/重启安装；Windows 生成 latest.yml 与 blockmap | 安装包态 `updates.getState()` 返回 supported=true；检查请求已到达 GitHub Release。实际升级演练需等 v0.7.1 发布 |
| macOS 签名/更新 | 保留 Apple 证书/公证配置；无证书时 macOS 自动更新关闭并提示手动下载 | 本机无 Developer ID 证书，macOS 自动更新按设计显示 unsupported |

## 自动化

- `npx tsc -b`：通过
- `npm test`：45 个测试文件 / 282 项通过（新增 B站客户端、Mach-O、混合歌单用例）
- Windows 开发态桌面集成测试：通过（11/11）
- Windows 安装包态桌面集成测试：通过（11/11）
- macOS CI：`macos-15-intel` 与 `macos-15` 两个 job 通过，`afterPack` 逐架构校验 Electron/mpv/Now Playing/sharp

## 已知限制

- macOS 安装包未签名/未公证；自动更新仅在签名版本启用（`ARIA_MAC_AUTO_UPDATE=1`）。
- B站视频模式使用 Chromium 视频解码与系统混音，不经过 mpv 独占输出/均衡器；音频模式仍走原高音质链路。
- B站匿名视频流通常为 360P，部分视频可到 720P；更高清晰度需要 B站登录（本版未接入 B站账号）。
- B站暂不支持歌手页、红心、云端歌单写入；这些入口由能力系统隐藏。

## 安装包

### Windows

- 文件：`release/Aria-0.7.0-x64.exe`
- 大小：140,749,276 bytes（约 134.23 MiB）
- SHA256：`13EE7EED6A95D9D845AD536832757274CC37088379AB17A8E2054CF0BDC0E26A`
- 自动更新元数据：`release/latest.yml`（含 exe sha512/大小）与 `Aria-0.7.0-x64.exe.blockmap`

### macOS

由 GitHub Actions `Build macOS DMG` 生成（运行 `42764917002`，两个 job 均通过）：

- `Aria-0.7.0-x64.dmg`（Intel）
  - 大小：196,279,382 bytes（约 187.19 MiB）
  - SHA256：`1B3F2EFC55821812117A78DD2C2BD60DC9F32A2C2A937DA93A37EEBDDDD9F3D9`
- `Aria-0.7.0-arm64.dmg`（Apple Silicon）
  - 大小：187,490,473 bytes（约 178.81 MiB）
  - SHA256：`B8D4B1CEA8A61AE1DDC6C83AAB2FEA8C20DE9529E34C395F1CBA4FFD22CA5288`
- 默认未签名；首次打开需右键 → 打开，或 `xattr -dr com.apple.quarantine /Applications/Aria.app`
