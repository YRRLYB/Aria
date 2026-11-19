# Aria

<p align="center">
  <img src="./logo.png" width="112" alt="Aria logo" />
</p>

<p align="center">
  <strong>一个把本地无损、网易云、QQ 音乐和 B站放一起听的桌面播放器 ♪</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/v0.7.4-8b5cf6?style=flat-square" alt="version 0.7.4" />
  <img src="https://img.shields.io/badge/Windows%20%7C%20macOS-6366f1?style=flat-square" alt="Windows and macOS" />
  <img src="https://img.shields.io/badge/WASAPI%20%7C%20Hi--Res-ec4899?style=flat-square" alt="WASAPI and Hi-Res Audio" />
</p>

<p align="center">
  <a href="https://github.com/YRRLYB/Aria/releases/latest">去下载最新版 (.exe / 发布页)</a> ·
  <a href="#features">看看它都能干嘛 ↓</a> ·
  <a href="CHANGELOG.md">翻翻改动记录 →</a> ·
  <a href="https://github.com/YRRLYB/Aria-Mobile">配套安卓端 Aria-Mobile ↗</a> ·
  <a href="#sponsor">请作者喝杯奶茶 ↓</a>
</p>

写 Aria 的原因挺简单的：听歌的时候老要在本地文件夹、网易云、QQ 音乐和 B站之间来回切窗口，有点烦。不如自己做一个桌面小播放器，把平时常听的源都凑到一张桌面上，打开就能接着昨天那首继续放 (･ω･)ﾉ

现在还在一点点补功能、修细节，哪天要是不小心抽风了，欢迎带上截图或复现步骤去 [GitHub Issues](https://github.com/YRRLYB/Aria/issues) 留言，看到都会尽快安排上。

---

<a id="features"></a>
## 🎧 它现在都能做些什么

### 几个音源拼在一起听
- **本地无损曲库**：自动扫出标题、歌手、专辑、时长、真实码率、采样率和内嵌封面，带日文歌名/专辑乱码还原和目录增量监控，改了文件不用每次全盘重扫。
- **混合 Aria 歌单**：本地、网易云、QQ 音乐和 B站的歌可以直接混放进同一个歌单；在线曲目会顺手存一份精简快照，下次打开软件还能接着续播。
- **网易云音乐**：扫码登录、头像昵称、红心喜欢、每日推荐、私人漫游、云盘检索分页和实时榜单 / 精选歌单 / 曲风漫游都有，启动先秒开上次缓存再悄悄在后台同步。
- **QQ 音乐**：完整搜索、无损与 Hi-Res 音质、逐行/双语歌词以及手机 QQ 扫码登录。
- **B站音源 & 剧场模式**：免登录可搜，登录后自动同步个人私密「Aria」收藏夹，WBI 音画流解析支持大会员 FLAC / Dolby / 高码率音轨；切到 MV 或沉浸全屏时复用同一路画面不闪封面，鼠标停一会会自动淡出底部控制栏。
- **官方品牌图标与真实码率**：喜欢列表、队列、歌单和发现页统一用网易云 / QQ / B站官方矢量图标 + 彩色徽章区分来源，歌名再长也不会把后面的码率挤掉。

### 认真折腾过的声音部分
- **Hi-Res & WASAPI 直通**：支持系统默认输出、WASAPI 共享、WASAPI 独占以及无损无缝切歌（Gapless）。
- **硬核一点的科学 Hi-Fi 均衡器**：`31Hz – 16kHz` 十段 RBJ 双二阶滤波（Biquad），带实时总频响 Bode 曲线、单频点钟形响应叠加、削波余量监控（Headroom / Clipping）、A/B 旁路瞬间对比、多套内置预设和 JSON 导入导出，系统音频和 WASAPI 全链路生效。
- **跟拍更紧的 60fps 动态频谱**：`2048` 点 FFT 搭配 Mel 感知频率分布，紧了 WASAPI 与 mpv 的时间同步阈值，低频不会糊成一大块。

### 歌词、统计与平时顺手的小细节
- **逐字 & 配对双语歌词**：支持逐字推进和外文+中文译文成对排版，一键切换「仅原文 / 双语」；本地老歌还能联网补全封面、简介和歌词。
- **听歌方格 & 听歌洞察**：主页直接展示全年听歌方格图（点击放大看全图，不带丑丑的滚动条），也有重构过的「听歌洞察」统计页，方便回头看看最近都偏爱听什么。
- **亮暗双主题 & 手机协同**：浅色和深色主题实时切换，深色封面下会自动保底按钮文字对比度，不怕按钮隐身；平时也能通过局域网配对连上安卓端——[点这里去 Aria-Mobile 仓库](https://github.com/YRRLYB/Aria-Mobile) 看看配套客户端。

---

<a id="download"></a>
## 📦 去哪下载安装

- **Windows 版**：直接去 [Releases 发布页](https://github.com/YRRLYB/Aria/releases/latest) 下最新的 `Aria-x.x.x-x64.exe`；装好之后在应用里打开「设置 → 版本与更新」就能直接检查并自动升级。
- **macOS（Intel / Apple Silicon）**：两个架构都已经各自配好 DMG 打包流程，具体的构建和安装细节可以翻 [这篇 macOS 双架构说明](docs/macos-x64-arm64.md)。

---

<a id="dev"></a>
## 🛠️ 自己拉代码跑一跑 / 打包

本地需要 Node.js 20+（建议 22）和 npm。仓库本身不带 `node_modules`、`release/`、`vendor/mpv/` 和 `dist/`，拉完代码先装依赖：

```bash
npm install
npm run dev        # 编译本地后端，并一起拉起 Vite 和 Electron 桌面端
```

如果只想先在浏览器里看页面（后端由 `npm run dev:server` 跑着，网页打开 `http://127.0.0.1:5173`）：

```bash
npm run dev:server
npm run dev:web
```

平时常用的几个脚本：

```bash
npm test                # 跑一遍 Vitest 全部单测
npm run build:web       # 打包前端页面
npm run build:server    # 编译本地后端
npm run build:desktop   # 准备 vendor/mpv 与原生音频模块并打包桌面产物
npm run dist:beta       # 打出 Windows NSIS 安装包，输出到 release/
npm run dist:mac        # 打出 macOS DMG（自动按架构准备 mpv）
```

> **几个小提醒**：
> - `vendor/mpv/` 会在执行 `npm run build:desktop` 时自动准备；如果没有它，播放器会自动回退到系统音频输出，不会卡死。
> - `.musicbox/` 目录只存在你自己电脑里（里面是 Cookie、本地索引和配置），代码仓库和打出来的安装包都不带任何个人账号信息。

---

## 📂 目录和文档入口

- `src/`：React 界面、亮暗主题样式、实时频谱、Hi-Fi EQ 与播放状态管理
- `server/`：本地 Node / Express 服务、多音源聚合、扫码认证、曲库扫描与歌词解析
- `electron/`：桌面窗口控制、系统托盘、mpv WASAPI 原生音频桥接与自动更新
- `aria-icons/` & `build/`：应用图标套件与打包资源
- `scripts/`：构建、mpv 准备和安装包制作脚本
- **更多延伸阅读**：
  - [多音源是如何聚合设计的（架构笔记）](docs/multi-source-plan-0.6.0.md)
  - [macOS x64 / arm64 构建说明](docs/macos-x64-arm64.md)
  - [完整版本更新日志（CHANGELOG）](CHANGELOG.md)
  - [安卓伙伴 Aria-Mobile（GitHub 仓库）](https://github.com/YRRLYB/Aria-Mobile)

---

<a id="sponsor"></a>
## 🧋 请作者喝杯奶茶（赞助支持）

如果你正好用得顺手，觉得 Aria 陪你听歌还不错，欢迎扫下面任意一个收款码请我喝杯奶茶或咖啡～  
完全随缘不强求，顺手点颗 ⭐ Star 我也一样开心 (｡･ω･｡)ﾉ♡

<table align="center">
  <tr>
    <td align="center" width="260">
      <img src="./docs/sponsor-wechat.png" width="220" alt="微信收款码" /><br />
      <strong>💚 微信赞赏</strong>
    </td>
    <td align="center" width="260">
      <img src="./docs/sponsor-alipay.jpg" width="220" alt="支付宝收款码" /><br />
      <strong>💙 支付宝收款</strong>
    </td>
  </tr>
</table>

---

## 🔒 隐私和声明

网易云音乐、QQ 音乐与 B站的在线功能都需要登录你自己的账号。Aria 不会收集或内置任何账号凭据，所有 Cookie、本地播放历史、歌单快照和个人设置全都只保存在你自己的机器上。
