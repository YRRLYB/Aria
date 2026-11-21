# Aria 0.8.0 发布说明

> 主题：跨越的一代 —— **YouTube Music 第四音源 · 按源代理 · B站歌单统一 · 年度声迹重做**
> 详细设计与验证记录：[docs/plan-0.8.0.md](plan-0.8.0.md)

## 一句话介绍

0.8.0 把 YouTube Music 搬进了 Aria，并解决了聚合播放器的代理矛盾：**只有 YouTube 走你配置的代理端口**（设置 → 播放源 → YouTube，如 Clash 的 `7890`），网易云 / QQ / B站永远直连，国内体验分毫不动。登录 YouTube 账号（Cookie 绑定）后，歌单页会出现统一的 YouTube 标签，同步你的音乐播放列表，「喜欢的音乐」固定置顶。

## 本版亮点

1. **YouTube Music 音源**：免登录搜索（music.youtube.com innertube）与播放（多客户端上下文回退链 + AAC/Opus 档位自适应），搜索页新增 YouTube 来源芯片与红色官方徽章。
2. **按源代理**：基于 undici ProxyAgent，代理设置即改即生效；音频流与封面经同一代理出口（googlevideo 地址绑定解析出口）；死代理 6ms 内快速失败并给出专属文案。
3. **YouTube 账号与统一歌单页**：Cookie 登录后歌单页五标签（网易云 / QQ / B站 / **YouTube** / Aria歌单），账号歌单只读同步 + 喜欢的音乐置顶 + 自动翻页。
4. **B站歌单**：登录自动同步「我的收藏夹」（私密可读、只读），粘贴公开收藏夹/合集/b23.tv 链接引入可刷新镜像；刷新只替换 B站部分，手动混入的其它来源歌曲保留。
5. **年度声迹重做**：放大后严格 1月1日–12月31日（支持 ‹ 年份切换 ›）；首页不点开只显示当前月；新增按天聆听日志修复全年热力图失真根因。

## 验证

- `npx tsc -b` 通过；60 个测试文件 / **378 项单测全绿**（较 0.7.4 新增 39 项）。
- `build:web` / `build:server` 通过（undici 纯 JS 直接打包）。
- 后端冒烟：YouTube 能力上报、代理规范化/校验/清除、死代理快速失败、Cookie 登录保存/拒绝/退出、B站与 YouTube 歌单鉴权文案全部符合预期。
- Windows 打包版桌面集成测试（`scripts/test-desktop.cjs --resources release/win-unpacked/resources`）通过。

## 安装包 SHA256

| 平台 | 文件 | SHA256 |
| --- | --- | --- |
| Windows x64 | `Aria-0.8.0-x64.exe` | `BFE6A724B835E4973FB08A26A4BE501880ABF0FB7110AC4C23538A8D84F44581` |

> Windows 自动更新：请同时保留 Release 中的 `latest.yml` 与 `Aria-0.8.0-x64.exe.blockmap`。
> 本哈希对应最终版安装包（含 YouTube 窗口登录、首页固定画布与账号面板四源卡片）。

## 已知边界

- YouTube 播放地址解析依赖上游策略演化（PO Token 风控），多客户端回退链覆盖大部分场景；持续失败时 Aria 会建议更换代理出口。
- YouTube 窗口登录依赖 Google 对嵌入式浏览器登录的容忍度（已使用标准 Chrome UA 缓解）；若 Google 拦截“此浏览器或应用可能不安全”，可退回 Cookie 备用绑定。登录态探测依赖 player 响应的 `loggedin` 字段；探测不可达时按「已保存未确认」处理。账号昵称/头像解析列入 0.8.x。
- 代理目前仅支持 HTTP/HTTPS（undici ProxyAgent 能力范围），socks5 在路线图中。
