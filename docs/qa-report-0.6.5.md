# Aria 0.6.5 QA 报告

日期：2026-11-09  
环境：Windows 11 / Node 24.15.0 / Electron 43 / x64

## 修复与验证

| 问题 | 修复 | 验证 |
| --- | --- | --- |
| 部分网易云歌曲点击后没有声音（《爱我还是他》《Cherry Candy》《ninelie》等） | 启动快照恢复 `neteaseTracks` 时不再丢弃 `streamUrl`；`trimTrackCache` 用带流地址的新副本覆盖同 ID 旧快照；`chooseTrack` 同步把可播放副本写回曲库；活动曲目解析优先选择带 `streamUrl` 的候选 | 浏览器实测三首歌均设置 `audio.src` 且 `currentTime` 前进；`aria-player-state` 快照包含流地址；真实账号 `150432` / `3451570714` / `409872504` 的无损流代理返回 206，FLAC 头 `664c6143`，mpv `--ao=null` 解码退出码 0 |
| 歌手页显示 543 首但曲目列表为 0 | 混合歌手的 `providerId` 可能来自 QQ 音乐，旧逻辑固定按网易云请求。`ArtistSummary` 新增 `providerSource`，歌手曲目/详情/专辑按 ID 所属平台路由 | 浏览器实测：Aimer 网易云 50 首、Lisse Aimer QQ 音乐 27 首、chelly 网易云 22 首均正常渲染，请求命中正确音源的 artist 接口 |
| 网易云搜索偶发“操作频繁，请稍候再试” | `callNetease` 与搜索重试路径识别 405/“操作频繁”并退避重试；最终失败映射为 429 与友好文案 | 连续 12 次网易云歌手搜索无错误；类型检查与单测覆盖 |
| 桌面 SMTC 集成测试偶发误报 | 测试在重新加载后等待渲染器与 mpv 解码器就绪，并在 gapless/repeat 阶段先还原窗口 | 开发态与 `release/win-unpacked/resources` 打包态各完成一次全量通过 |

## 功能回归

- 网易云：《爱我还是他》《Cherry Candy》《ninelie》搜索、点击、播放、歌词与队列正常。
- 歌手：网易云歌手、QQ 歌手与混合歌手的曲目列表均可见；专辑/详情请求来源正确。
- 歌词：ninelie 播放页加载 28 行同步歌词与翻译，首曲不再空白。
- QQ 音乐：搜索、歌手曲目（27 首）、播放与红心相关路径保持正常。
- 沉浸模式与左下角浮球图标：沿用 0.6.4 的 Aria 自制 SVG，构建后 DOM 保持 28px/36px 规格。

## 自动化

- `npx tsc -b`：通过
- `npm test`：43 个测试文件 / 275 项通过
- `npm run build:desktop`：通过
- 开发态桌面集成测试：通过（全部 11 项）
- 安装包态桌面集成测试：通过（全部 11 项）

## 安装包

- 文件：`release/Aria-0.6.5-x64.exe`
- 大小：164,149,721 bytes（约 156.55 MiB）
- SHA256：`5E086382C1972C9A594B906153847BB7F72F0761D21DA212B88B7B12540C80E8`
