# Aria 0.6.0 多播放源交接文档

> 写给下一次对话 / 接手人。目标：读完全文即可继续开发，不需要重新考古。
> 配套：`docs/multi-source-plan-0.6.0.md`（架构取舍）、`docs/multi-source-impl-0.6.0.md`
> （原重构版里程碑 + 顶部"0.6.0 实际执行路径"定稿小节）、`CHANGELOG.md` 0.6.0 段。
> 本文档截至：**0.6.0 安装包已构建，QQ 登录改为应用内窗口扫码（Web 授权链在无浏览器环境不可靠），QQ 播放待真实 Cookie 验证。**

## 0. 安装包信息

- 文件：`release/Aria-0.6.0-x64.exe`（约 156 MB，未做正式代码签名，本机 signtool 签名）
- SHA256：`E8769E1D887443F4E0397089A17F0E1002B2F9702D57A2D62C505044AEC817C3`（含窗口扫码登录 + 完整 Cookie 回传；服务端授权链五次修复一并保留）
- 测试基线：38 个测试文件 / 220 项全绿（构建前最后一次确认）

---

## 1. 一句话现状

0.6.0 采用**薄标准层路线**（非完整重构）：`server/sources/` 建立了统一源契约与泛型路由，
QQ 音乐作为第一个新源接入（搜索/歌词/封面/扫码登录可用），网易云完全无破坏；
B站/YouTube 尚未接入，但契约已为其预留。全部 215 项测试绿，安装包已出。

## 2. 架构速览（接手必读）

### 2.1 后端标准层（全部在 `server/sources/`）

| 文件 | 职责 |
| --- | --- |
| `contract.ts` | `SourceId`（netease/qq/bilibili/youtube，后两个已预留）、TrackKey 编解码、`SourceError`（6 错误码→HTTP 映射）、`MusicSource` 接口、超时常量（搜索 8s / 流解析 12s / 歌词 8s） |
| `streamProxy.ts` | 通用音频流转发（Range/206/`x-aria-*` 头，从原网易路由原样抽出）。**核心设计**：接受 `resolve(attempt)` 回调，上游 403/410 自动重取一次并按原 Range 续传——QQ purl、B站 DASH、YouTube googlevideo 的过期问题都在这一处解决 |
| `registry.ts` | manifest 纯数据 + 动态 `import()` 懒加载 + `getSource(id)`；未知源 → `SourceError("UNAVAILABLE")` |
| `qq/client.ts` | QQ 客户端（零 npm 依赖，纯 fetch）：搜索 `client_search_cgi`、播放地址 `GetEVkey`、LRC 歌词、Cookie 解析/校验、purl 20min TTL 缓存 |
| `qq/qrLogin.ts` | 服务端扫码登录（保留为接口兜底）：xlogin → ptqrshow → ptqrlogin 轮询 → check_sig → 跟随跳转链（`login_jump` 的 200 页面从脚本里解析带签名 authorize 地址继续跟随）取授权 code（Location 头或 JS/meta 跳转页内），不再强制 p_skey；空值 `p_skey=` 视为未签名；链路无 code 且无签名 Cookie 时才用 p_skey/skey 手动签名 authorize 兜底；失败提示带 Cookie 名 + 跳转链摘要 → `QQConnectLogin.QQLogin` 换取 `musicid/musickey`；会话内存态（10min TTL）。**实测：纯 HTTP 复刻在真实账号上始终拿不到 code（login_jump 脚本页无法复刻），因此 UI 主路径改用应用内窗口登录** |
| `netease/source.ts` | 网易云薄适配器（search/lyrics/stream/account 委托 `neteaseClient`） |

**新接一个源要做的全部事情**：写 `manifest.ts`（纯数据）+ `source.ts`（实现 `MusicSource` 接口）
+ `client.ts`（协议实现）→ 在 `registry.ts` 的 manifests/loaders 里注册 → 完事。
路由、前端 API 块、搜索芯片全部自动生效。

### 2.2 TrackKey 约定（不要破坏）

- 格式：`<source>:<externalId>`，如 `netease:123`、`qq:0039MnYb0qxYhV`、`bilibili:BV1xx:cid`。
- 契约只负责**第一个冒号前切分**；rest 归源自己解析（多段 ID 无需改契约）。
- 旧数据（历史/队列/本地歌单 localStorage 里的 `netease:xxx`）**原样保留，永远不做批量改写**。

### 2.3 路由

```
GET  /api/sources                                  # manifest 列表（前端来源芯片数据源）
GET  /api/sources/:id/search?q=&mode=&limit=&offset=
GET  /api/sources/:id/tracks/:trackId/stream-meta   # 不下发 upstream headers（Cookie 不出后端）
GET  /api/sources/:id/tracks/:trackId/stream        # 走 streamProxy，支持 Range/HEAD
GET  /api/sources/:id/tracks/:trackId/lyrics
GET  /api/sources/:id/account
GET  /api/sources/:id/cover?url=&size=              # 按 manifest 白名单校验 host
POST /api/settings/qq-cookie                        # Cookie 粘贴登录
POST /api/settings/qq-qr/start                      # 扫码登录开始
GET  /api/settings/qq-qr/check?key=                 # 扫码登录轮询（66 等待/67 已扫/65 过期/0 成功）
```

网易云特有的 25+ 条路由（歌单 CRUD/喜欢/每日/漫游/云盘/百科/风格/电台）**全部保持旧路径
`/api/providers/netease/*` 不变**——这是有意为之（见 §4 决策），不是遗漏。

### 2.4 前端接入点

| 文件 | 内容 |
| --- | --- |
| `src/lib/api.ts` | 尾部 `sourceApi` 泛型块：listSources / searchSource / getSourceStreamUrl / getSourceStreamMetaUrl / getSourceLyrics / getSourceAccount / getSourceCoverUrl / saveQqCookie / startQqQrLogin / checkQqQrLogin；`Window.ariaDesktop.qqLoginWindow` 类型声明（:83） |
| `src/data/music.ts:28` | `Track.source` 联合：`"local" \| "cloud" \| "netease" \| "qq"` |
| `src/lib/trackMappers.ts` | `providerTrackToUiTrack` 按 source 参数化 id 前缀与封面路由 |
| `src/lib/coverUrl.ts` | gtimg.cn 域名 → `/api/sources/qq/cover`（尺寸在路径内改写 `T002R{W}x{H}M000`） |
| `src/hooks/useDiscovery.ts` | 搜索"全部"并行请求网易云 + QQ（`Promise.allSettled`，QQ 失败独立 `searchQqError` 通道） |
| `src/hooks/useLyricsSync.ts` | QQ 分支：`api.getSourceLyrics("qq", providerId)` |
| `src/components/music/SettingsPanels.tsx` | `QqSourceCard`：窗口扫码登录 + Cookie 备用 + 在线状态 |
| `src/lib/trackLabels.ts` | `sourceLabel` 穷举 Record——**加新源必须在这里加条目**，否则 TS 编译失败（这是故意的保险丝） |

播放引擎（`useAudioEngine`、mpv）**完全源无关**：`track.streamUrl` 是后端代理的完整 URL，
mpv/HTML5 直接放。唯一源相关逻辑是 `?level=` 音质参数追加，目前 netease-only。

### 2.4.1 QQ 应用内窗口登录（主路径）

服务端纯 HTTP 复刻 QQ 网页授权链在真实账号上无法拿到 `code`（`login_jump` 页面靠 JS 跳转，
`authorize` 一律 302 到 `oauth2.0/show`），所以登录改成在 Electron 里开真实 Chromium 窗口：

- 渲染进程：`SettingsPanels.tsx` `loginInWindow()` → `window.ariaDesktop.qqLoginWindow()`；
- 主进程：`electron/main.cjs` `ipcMain.handle("aria:qq-login-window")` 开 480×760 窗口加载
  `https://y.qq.com/`（session 分区 `aria:qq-login`，UA 固定为 Chrome 131），每 1.2s 读一次会话 Cookie，
  拿到非空 `qm_keyst`（或 `qqmusic_key`）+ 4 位以上 `uin` 后关闭窗口并返回**完整 Cookie 头**：
  `uin=o<uin>` 加上 `qq.com` 域下所有非空 Cookie（`qm_keyst`、`p_skey`、`pt4_token` 等）。
  ⚠️ 只回传 `uin + qm_keyst` 时账号信息接口会判定未登录（`getQqAccount` 返回 disconnected），
  所以必须带上整组登录 Cookie；`uin`/`p_uin` 先剔除再统一写成 `uin=o<数字>`，避免重复键；
- 渲染进程拿到后调 `api.saveQqCookie(cookie)` 走现有 `POST /api/settings/qq-cookie` 入库；
  界面文案按 `account.connected` 决定：成功才显示"登录成功"，否则状态与提示都写明"未确认登录状态"，
  不再出现"登录成功"与"未确认"同时出现的情况；
- 桥接声明在 `src/lib/api.ts:83`（`qqLoginWindow?: () => Promise<{ ok: boolean; cookie?: string; message?: string }>`），
  `electron/preload.cjs` 暴露同名方法；窗口关闭/加载失败返回 `{ ok:false, message }`，前端提示改用 Cookie 粘贴。

服务端 `server/sources/qq/qrLogin.ts` 的二维码链路保留未删（接口仍在，可能有其他场景复用），
但 UI 已不再调用 `startQqQrLogin`/`checkQqQrLogin`。

### 2.5 打包注意

- 后端 esbuild 打包为单 CJS（`--external:NeteaseCloudMusicApi --external:sharp`），
  这两个包经 `scripts/copy-ncm-runtime.cjs` 复制到 `dist-server/node_modules`。
  **新源客户端必须零 npm 依赖**（纯 fetch），否则要扩这个外置清单。
- esbuild CJS 下动态 `import()` 的模块体在首次调用时才执行——registry 懒加载语义成立。
- Electron 主进程已固定全局 `no-proxy-server`（`electron/main.cjs:142` 有注释扩展点），
  未来某源需要代理只能在源模块内用专用 dispatcher，**绝不能重开全局代理**（会弄坏网易云直连）。

## 3. QQ 音乐现状（最重要的一节）

### 3.1 已实测可用 ✅

- 搜索：真实 API 返回正确映射（`晴天 → 周杰伦 / 叶惠美 / FLAC / availableLevels`）
- 歌词：LRC + 翻译合并（实测《晴天》63 行）
- 封面：gtimg 代理 + 缓存
- 扫码登录：服务端 QR 生成（真实 PNG）、轮询（真实 66 等待响应）可用；**实际登录用应用内窗口扫码**（见 §2.4.1），Cookie 粘贴登录也可用
- Cookie 解析：`uin` + `qqmusic_key`/`qm_keyst` 两种名字都认

### 3.2 播放地址的实测结论 ⚠️

- 旧模块 `music.vkey.GetVkeyServer` 对所有无签名请求一律返回 **500003**（连未知模块也是
  这个码 → 是鉴权/签名问题，不是参数问题）。
- 现用 `music.vkey.GetEVkey / CgiGetEVkey`：**匿名返回 code 0**，但 `msg` 提示
  "必须请求加密文件"——即匿名只下发 mflac/mgg **加密流**，明文 purl 需要登录 Cookie。
- **Aria 红线：不做 DRM/加密流解密**（方案文档明确）。因此播放设计为：绑定 Cookie 后可用，
  未绑定返回可操作指引（404 `SOURCE_UNAVAILABLE`，文案指向设置页）。

### 3.3 待验证（按顺序做）

1. **用户真实扫码**：设置 → 播放源 · QQ 音乐 → 生成二维码 → 手机 QQ 扫码确认。
   成功后 `store.json` 应出现 `qqCookie`，账号显示昵称。
2. **扫码后播放**：搜索任一歌曲 → 播放。关注三点：
   - 明文 purl 是否放行（应该可以，GetEVkey 对带 Cookie 的明文 filename 未验证）；
   - 128k/320k/FLAC 各档位实际可用性（无 VIP 时 hires/RS01 大概率空）；
   - 播放中拖动进度条（Range 续传）、播完切歌、重启恢复队列。
3. **若 Cookie 路径也被拒**（比如腾讯强制签名）：两个选项，需要用户拍板——
   - a) 移植完整 sign 链（社区有 Node 实现，但那是**从腾讯产品里抽出的混淆字节码**，
     法律灰 + 维护脆，作为分发软件不轻）；
   - b) 把 QQ 播放降级为"实验性"，先做 B站（匿名全链路可用，见 §5）。

### 3.4 QQ 协议备忘

- 音质档位 → filename 前缀：`standard→M500.mp3`、`exhigh→M800.mp3`、`lossless→F000.flac`、
  `hires→RS01.flac`（尽力而为）。一次 vkey 请求带全部档位 filename，按可用性降级取 purl。
- 搜索返回的 `file.media_mid` **不等于 songmid**，filename 必须用 media_mid
  （`fileInfoCache` 在搜索时缓存，流解析时使用；无缓存时回退 songmid）。
- purl 是相对路径时拼接 `sip[0]`（如 `http://ws.stream.qqmusic.qq.com/`）。
- 上游音频请求必须带 `Referer: https://y.qq.com/`（已在 `resolveQqStreamMeta` 的 headers 里声明）。

## 4. 关键决策记录（不要再讨论一遍）

| 决策 | 结论 | 理由 |
| --- | --- | --- |
| 架构形态 | 单安装包 + 内置模块化源 | 拆包 = 体积×4 + 数据割裂；插件 = 签名/沙箱/市场基建，Node 无真沙箱 |
| 重构深度 | 薄标准层，**不做**完整契约重构 | 用户拍板：先满足"能加源"，29 条旧路由迁移等记到 0.7 |
| 运行时 | 0.6.x 维持 Electron | Tauri 要 Rust 重写 ~8000 行后端；Electrobun 2026 年才支持 Windows 且太年轻；契约层正是未来换壳的前提 |
| QQ 匿名播放 | 拒绝解密 mflac | DRM 红线，方案文档明令禁止 |
| vkey 模块 | GetEVkey（非 GetVkeyServer） | 实测：后者 500003 前者 code 0 |
| 版本号 | package.json 已升 **0.6.0**，CHANGELOG 已加 0.6.0 段 | dist 脚本叫 dist:beta，出包即 `release/Aria-0.6.0-x64.exe` |

## 5. 后续路线图

### P0（拿到本包后立即做）
1. 按 §3.3 顺序验证 QQ 扫码 → 播放。
2. 验证网易云/本地音乐无回归（重点：网易云播放、喜欢、歌单、每日推荐、均衡器、WASAPI）。
3. 混合队列冒烟：网易云 + QQ + 本地混排切歌、重启恢复。

### P1：B站接入（推荐下一个源，匿名全链路可用）
- 走 §2.1 的标准流程建 `server/sources/bilibili/`。
- 搜索：`api.bilibili.com/x/web-interface/search/type?search_type=video`（无需登录，
  带浏览器 UA；注意风控，首次需先 GET 主页拿 buvid cookie）。
- 播放：`/x/player/playurl?bvid=&cid=&fnval=16` 返回 DASH，**取 `dash.audio[]` 里
  bandwidth 最高的音轨**；URL 有效期约 2 小时（streamProxy 的 403 重取正好覆盖）。
- TrackKey：`bilibili:BV1xx:cid`（cid 放 rest，契约已支持多段）。
- 上游请求头：`Referer: https://www.bilibili.com/` + 浏览器 UA（manifest/streamMeta 声明）。
- 能力裁剪：无歌词（或字幕转歌词）、无账号、无喜欢/歌单写入——接口全是可选方法，不实现即可。
- 前端：`trackLabels` 加 `bilibili: "B站"`（编译器会逼你加）、`Track.source` 联合加 `"bilibili"`、
  mapper 加分支。`GET /api/sources` 会自动把它带进搜索芯片。

### P1：QQ 播放视 §3.3 结果决定
播放 OK → 补充 QRC 逐字歌词（0.7）或直接收尾；被拒 → 见 §3.3 的 a/b 选项。

### P2 记账清单（原重构版遗留，触发条件到了再做）
- [ ] 29 条 `/api/providers/netease/*` 旧路由迁到统一契约（触发：QQ 需要歌单写入时）
- [ ] 能力系统 `capabilities`（触发：第三个源需要差异化 UI 时；当前靠 17 处
  `source === "netease"` 特判硬编码，新源没有的功能自动隐藏，暂时够用）
- [ ] AppStore v2 迁移 + 每源凭据分区（触发：第二个需要登录的源上线时）
- [ ] 源开关 UI（设置页逐源启用/禁用）
- [ ] 歌手页来源分组仍是 netease/local 二值假设（`App.tsx:553` 附近），QQ 歌曲计入本地分组（仅展示）
- [ ] 音质档位选择菜单 netease-only（`PlayerViews.tsx:119`），QQ 显示实际返回档位

## 6. 调试教训（省你半小时）

- **Git Bash 里 `kill $PID` 杀不掉 Windows node.exe**——后台冒烟测试后必须
  `taskkill //PID <pid> //F`，并用 `netstat -ano | grep :3637` 确认端口已释放，
  否则你会一直测到旧进程的旧代码（本次就踩过：改了模块名但测试结果不变）。
- QQ 对请求指纹有一定容忍度（Node undici 和 python 都能过 musicu.fcg），
  但匿名 vkey 只认 GetEVkey；不要再用 GetVkeyServer 调试。
- 冒烟测试命令：`ARIA_API_PORT=3637 ARIA_DATA_DIR=/tmp/aria-smoke node dist-server/index.cjs`，
  数据目录用临时目录避免污染真实用户数据。

## 7. 常用命令

```powershell
node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json   # 类型检查
node_modules\.bin\vitest.cmd run                      # 全量测试（215 项）
npm.cmd run build:web                                 # 前端构建
npm.cmd run build:server                              # 后端 esbuild + 外置包复制
npm.cmd run dist:beta                                 # 出包 → release/Aria-<version>-x64.exe
npm.cmd run dev                                       # 本地开发（web + electron）
```

验收基线：五项全绿（tsc / vitest / build:web / build:server / node --check electron/main.cjs）。

## 8. 本次 0.6.0 变更文件地图

**新增**：`server/sources/{contract,registry,streamProxy}.ts`、`server/sources/qq/{manifest,client,qrLogin,source}.ts(+tests)`、
`server/sources/netease/{manifest,source}.ts`、`server/routes/sources.ts(+test)`、`docs/*`（4 份）
**修改**：`server/index.ts`（挂载 + qq 路由 + SourceError 处理 + 流路由改调 streamProxy）、
`server/{types,store}.ts`（qqCookie 字段）、`server/remoteCoverCache.ts`（白名单参数化）、
`server/routes/remoteCover.ts`（抽出 handleCoverRequest）、
`src/lib/{api,coverUrl,trackLabels,trackMappers}.ts`、`src/data/music.ts`、
`src/hooks/{useDiscovery,useLyricsSync}.ts`、
`src/components/music/{DiscoverySurfaces,SettingsPanels}.tsx`、`package.json`（0.6.0）、`CHANGELOG.md`

**测试**：`server/sources/contract.test.ts`（key 往返/多段 ID/错误映射）、
`server/sources/qq/client.test.ts`（搜索映射/档位降级/purl 缓存与刷新/歌词/Cookie）、
`server/sources/qq/qrLogin.test.ts`（hash33/QR 全链路/凭据入库）、
`server/routes/sources.test.ts`（泛型路由/206 重取/白名单/错误码）
