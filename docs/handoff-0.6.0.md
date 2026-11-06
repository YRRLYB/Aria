# Aria 0.6.0 多播放源交接文档

> 写给下一次对话 / 接手人。目标：读完全文即可继续开发，不需要重新考古。
> 配套：`docs/multi-source-plan-0.6.0.md`（架构取舍）、`docs/multi-source-impl-0.6.0.md`
> （原重构版里程碑 + 顶部"0.6.0 实际执行路径"定稿小节）、`CHANGELOG.md` 0.6.0 段。
> 本文档截至：**QQ 播放已用真实 Cookie 端到端验证并修正（见 §9），QQ 收藏/歌单只读同步已接入，macOS 适配补全（含原生 Now Playing）。0.6.0 尚未重新出包。**

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
| `src/components/music/SettingsPanels.tsx` | `QqSourceCard`：扫码登录（服务端二维码）+ 窗口扫码 + Cookie 备用 + 退出登录；`AccountPanel` 的「播放源」列表；`OnboardingDialog` 第 2 步双源登录、第 3 步登录汇总 |
| `src/lib/trackLabels.ts` | `sourceLabel` 穷举 Record——**加新源必须在这里加条目**，否则 TS 编译失败（这是故意的保险丝） |

播放引擎（`useAudioEngine`、mpv）**完全源无关**：`track.streamUrl` 是后端代理的完整 URL，
mpv/HTML5 直接放。唯一源相关逻辑是 `?level=` 音质参数追加，`netease` 与 `qq` 都会追加
（`useAudioEngine` 两个 memo 都按 `source !== "netease" && source !== "qq"` 提前返回）。

### 2.4.0 账号显示（多源）

`src/App.tsx` 在 App 里保存 `qqAccount: SourceAccountSummary`（`GET /api/sources/qq/account`），
挂载时、`activeView` 变化时和窗口 `focus` 时刷新（也作为 `onSourceAccountChange` 传给设置与引导）。
右上角只有一个账号按钮：`primaryAccount = neteaseConnected ? neteaseAccount : qqConnected ? qqAccount : null`，
因此只登录 QQ 时头像与昵称来自 QQ（实测 `https://thirdqq.qlogo.cn/...`）。点开的 `AccountPanel`
会列出「播放源」两行（各自的 未登录 / 昵称）并提供「管理账号」跳到设置。

`getQqAccount()`（`server/sources/qq/client.ts`）必须用 **android comm**：`ct:11, cv:20090008,
v:20090008, chid:"10003505", qq:<musicid>, authst:<musickey>, tmeAppID:"qqmusic", guid:…,
tmeLoginType:2`，batch key 是 `req_0`，UA `QQMusic 20090008(android 14)`，Cookie 带
`uin/qqmusic_uin/qm_keyst/qqmusic_key/guid`。**旧的 web comm（`ct:24` / `platform:"yqq.json"`）会返回
`500003/860100001`**，`music.UserInfo.userInfo/GetUserInfo` 这条老接口也不要再用；
用 `music.UserInfo.userInfoServer/GetLoginUserInfo`（`req_0.data.info.nick|logo`）。
备用路径是 `https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?cid=205360838&userid=<uin>&reqfrom=1&g_tk=5381&format=json`
（`data.creator.nick|headpic`）——原来的 `rfc/fcg_get_profile` 已 404。

### 2.4.1 QQ 扫码登录（网页端 = 服务端二维码，桌面端另有窗口兜底）

主路径是服务端二维码：`SettingsPanels.tsx` `startQrLogin()` 调 `POST /api/settings/qq-qr/start`
拿 base64 二维码渲染，前端每 2s `GET /api/settings/qq-qr/check?key=…` 轮询状态
（66 等待 / 67 已扫码 / 65 过期 / 0 成功），成功后后端已写好凭据，前端只刷新账号状态。
浏览器访问 Web 版时同样可用，不依赖 Electron。

`server/sources/qq/qrLogin.ts` 的正确协议（2026-11 按 L-1124/QQMusicApi、
Cosmosuperbaka/qqmusic-api-enhanced、yakult-green-tea/qq-music-api 三方实现核对）：

1. `GET ssl.ptlogin2.qq.com/ptqrshow?...`（appid 716027609 / daid 383 / pt_3rd_aid 100497308），
   只保留 `qrsig`。**不要调用 `xlogin`**：它下发的 `pt4_token`/`supertoken`/`oauthtoken` 会让
   `check_sig` 返回 `p_skey_forbid` + 空的 `p_skey`，授权接口于是退回确认页。
2. 轮询 `ssl.ptlogin2.qq.com/ptqrlogin`，Cookie **只发** `qrsig=…`，`ptqrtoken=hash33(qrsig,0)`，
   `js_ver=20102616`，不发 `login_sig`。
3. `ptuiCB` 返回 code 0 时的 args[2] 是完整 `check_sig` URL：原样重放、**零 Cookie**、
   `redirect:"manual"`；从它的 302 `Set-Cookie` 里按 Domain 作用域取 `p_uin`/`p_skey`/`pt_oauth_token`
   三个（缺任一即失败），不要合并跳转链上的其它 Cookie。
4. GET 该 302 的 Location（`graph.qq.com/oauth2.0/login_jump`）丢弃响应体。
5. `POST graph.qq.com/oauth2.0/authorize`（form-urlencoded，Cookie 带上面三个，
   `g_tk=hash33(p_skey)`，`redirect_uri=https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=…`），
   从 302 Location 取 `code`；裸 GET 只会拿到 `oauth2.0/show` 授权确认页。
6. `POST musicu.fcg` `QQConnectLogin.LoginServer` / `QQLogin {code}` → `musicid`+`musickey`，
   存成 `uin=o<musicid>; qm_keyst=…; qqmusic_key=…`。

Cookie 作用域由 `server/sources/qq/cookieJar.ts` 负责（Domain/Path/Max-Age 解析、空值视为缺失、
按 host+path 匹配并按路径长度排序），配套测试在 `cookieJar.test.ts`。

桌面端另有兜底：`loginInWindow()` → `window.ariaDesktop.qqLoginWindow()` →
`electron/main.cjs` `ipcMain.handle("aria:qq-login-window")` 开 480×760 窗口加载 `https://y.qq.com/`
（session 分区 `aria:qq-login`），每 1.2s 读会话 Cookie，拿到非空 `qm_keyst` + `uin` 后把
`qq.com` 域下的整组 Cookie 回传（只回 `uin + qm_keyst` 会被 `getQqAccount` 判成未登录），
再 `api.saveQqCookie(cookie)` 入库；界面文案按 `account.connected` 区分成功/未确认。

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
- 扫码登录：服务端 QR 生成（真实 PNG）、轮询（真实 66 等待响应）可用；授权链已按三方实现重写
  （见 §2.4.1），**真实手机扫码已由用户实测通过**（store.json 里已写入 `qqCookie`）；
  桌面端窗口扫码与 Cookie 粘贴为备用路径
- 账号信息：`getQqAccount()` 用 android comm 实测返回 `connected:true, nickname:"YRRLYB"`、
  QQ 头像 URL（见 §2.4.0），右上角头像与账号面板据此显示；退出登录走 `DELETE /api/settings/qq-cookie`
- Cookie 解析：`uin` + `qqmusic_key`/`qm_keyst` 两种名字都认

### 3.2 播放地址的实测结论 ⚠️

- 旧模块 `music.vkey.GetVkeyServer` 对所有无签名请求一律返回 **500003**（连未知模块也是
  这个码 → 是鉴权/签名问题，不是参数问题）。
- 现用 `music.vkey.GetEVkey / CgiGetEVkey`：**匿名返回 code 0**，但 `msg` 提示
  "必须请求加密文件"——即匿名只下发 mflac/mgg **加密流**，明文 purl 需要登录 Cookie。
- **Aria 红线：不做 DRM/加密流解密**（方案文档明确）。因此播放设计为：绑定 Cookie 后可用，
  未绑定返回可操作指引（404 `SOURCE_UNAVAILABLE`，文案指向设置页）。

### 3.3 待验证（按顺序做）

1. ~~**用户真实扫码**~~ 已完成：设置 → 播放源 · QQ 音乐 → 扫码登录 → 手机 QQ 确认，
   `store.json` 出现 `qqCookie`，`GET /api/sources/qq/account` 返回昵称与头像。
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

**新增**：`server/sources/{contract,registry,streamProxy}.ts`、`server/sources/qq/{manifest,client,qrLogin,cookieJar,source}.ts(+tests)`、
`server/sources/netease/{manifest,source}.ts`、`server/routes/sources.ts(+test)`、`docs/*`（5 份）、
`scripts/`（mac/linux 打包配置在 `package.json` build 段）
**修改**：`server/index.ts`（挂载 + qq 路由 + SourceError 处理 + 流路由改调 streamProxy）、
`server/{types,store}.ts`（qqCookie 字段）、`server/remoteCoverCache.ts`（白名单参数化）、
`server/routes/remoteCover.ts`（抽出 handleCoverRequest）、
`src/lib/{api,coverUrl,trackLabels,trackMappers}.ts`、`src/data/music.ts`、
`src/hooks/{useDiscovery,useLyricsSync,useAudioEngine}.ts`、`src/main.tsx`（记录 platform）、`src/theme.css`（macOS 头部留白）、
`src/lib/playerPresentation.ts`（QQ 音质档位）、`src/components/music/{DiscoverySurfaces,CollectionSurfaces,SettingsPanels,PlayerViews,PlayerSidePanels,HomeSurfaces}.tsx`、
`src/App.tsx`（qqAccount/账号按钮/引导双源）、`electron/{main,preload,mpvEngine}.cjs`、
`package.json`（0.6.0 + mac/linux 打包）、`CHANGELOG.md`、`README.md`

**测试**：`server/sources/contract.test.ts`（key 往返/多段 ID/错误映射）、
`server/sources/qq/client.test.ts`（搜索映射/档位降级/purl 缓存与刷新/歌词/Cookie）、
`server/sources/qq/qrLogin.test.ts`（hash33/QR 全链路/凭据入库/授权失败分支）、
`server/sources/qq/cookieJar.test.ts`（Domain 作用域/空值/过期删除/路径优先级）、
`server/routes/sources.test.ts`（泛型路由/206 重取/白名单/错误码）

## 9. 2026-11-04 更新：QQ 播放实测、收藏/歌单接入、mac 适配

### 9.1 QQ 播放实测结论（替换 §3.2/§3.3 的待验证状态）

真实账号（扫码登录，免费/无 VIP 账号）端到端验证：**登录 Cookie 下 GetEVkey 可以返回明文 purl，但放行哪个格式不稳定**：

- `M500<media_mid>.mp3`（128k MP3）与 `C400<media_mid>.m4a`（AAC）交替放行，同一会话内多轮观察两种都出现过 purl；`M800/F000/RS01` 明文对无 VIP 账号始终为空。
- VIP 曲目（如晴天）连 C400/M500 都为空——与账号绿钻权限相关，属预期行为；错误文案已区分"可能需要 VIP 或登录过期"。
- **客户端对策**：`QQ_FILE_SPECS` 每个档位声明多个格式候选，一次 GetEVkey 请求带全部 filename，按档位从高到低、同档位按声明顺序取第一个有 purl 的格式。若腾讯将来对授权账号恢复明文高档位，自动生效。
- 实测比特率按 `filesize*8/duration` 推导（搜索时缓存 `interval`）；音质标签如实为 `128K`（M500）/`AAC`（C400），`quality` 联合类型扩了这两档。
- 拉流验证：purl 拼接 `sip[0]` + `Referer: https://y.qq.com/` 后 206/Range 正常；浏览器 `<audio>` 经 `/api/sources/qq/tracks/:id/stream` 播放、进度推进、`level` 参数降级均正常。

### 9.2 搜索结果播放的关键修复（易踩）

QQ 搜索结果此前只存在于 `useDiscovery` 内部状态，App 级 `allTracks`/队列池解析不到 `qq:` id → 点击 QQ 行后 `requestedActiveTrack` 解析失败，播放悄悄落到别的轨道。修复：`useDiscovery` 新增 `onMergeQqTracks`，搜索成功后把 QQ 结果并入 App 的 `qqSearchTracks` 池（进 `allTracks`、`updateTrackRef` 的 applyTo 清单）。**新源接入时必须做同样的合并**，否则搜索结果不可播。

### 9.3 QQ 收藏/歌单（只读）

- 接口：个人主页 `fcg_get_profile_homepage`（`mymusic[0]` 即"我喜欢"，id 为 disstid；`mydiss` 为自建歌单）+ 歌单详情 `qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?disstid=`（曲目结构与搜索 song 一致，复用 `normalizeQqSong`/`rememberFileInfo`）。
- 服务端：`server/providers/qqProvider.ts`（实现 `MusicProvider` 的 getAccount/getLikedTracks/getPlaylists/getPlaylistTracks）；`MusicProvider` 接口新增可选 `getPlaylistTracks?`；`server/index.ts` 新增通用路由 `GET /api/providers/:providerId/playlists/:playlistId/tracks`（netease 专属路由在前仍优先匹配）。
- 未登录时返回 `AUTH_REQUIRED`（401），前端在歌单页 QQ 标签显示"前往登录"。
- 注意：搜索接口对短时间高频请求会软风控（code 0 但 list 为空）；**search 请求不要带 `comm` 块**（带上反而返回空列表），`musicu` 帮助函数保持无 comm 即可。
- 前端：`useQqData` hook（与 useNeteaseData 平行）；"我喜欢"页三栏；歌单页来源切换（网易云/QQ 音乐/本地），QQ 详情 `connected={false}` 走只读 PlaylistDetail。

### 9.4 macOS 适配补全

- `preload.cjs` `nativeAudio.supported` 改为 `win32 || darwin`；`useAudioEngine` 挂载时调 `isSupported()`（引擎检查 vendor 二进制存在性）二次确认，无 mpv 二进制自动回落 Web Audio。
- `main.cjs` 应用菜单平台守卫：darwin 设标准菜单（about/Edit roles/View/Window，恢复 Cmd+Q、Cmd+C/V），`mainWindow.removeMenu()` 仅非 darwin 执行。
- 新增 `electron/native/aria-nowplaying/`（ObjC++ N-API）：MPNowPlayingInfoCenter + MPRemoteCommandCenter（注意 mac 上访问器是 **`sharedCommandCenter`** 而非 iOS 风格的 `defaultCenter`——只有 MPNowPlayingInfoCenter 用 `defaultCenter`）。`scripts/build-native.cjs` 增加 darwin 分支（构建失败不阻塞出包）。`main.cjs` 复用 `aria:update-media-session` IPC 与 `sendPlaybackCommand`，生效时追加 `disable-features HardwareMediaKeyHandling`。
- `mpvEngine.test.js` 在 require 前把 `process.platform` 钉为 win32 再恢复（引擎的平台常量在 require 时捕获），非 Windows 平台测试全绿。
- `ensure-mpv.cjs` darwin 分支：探测 `/opt/homebrew/bin/mpv`、`/usr/local/bin/mpv` 并复制到 `vendor/mpv/mpv`，找不到只提示不报错。

### 9.5 验收基线（2026-11-04）

`tsc --noEmit` / `vitest run`（231 项全绿，含 mpvEngine 在 mac 上）/ `build:web` / `build:server` / `node --check electron/main.cjs` 全部通过；浏览器端到端：QQ 搜索→点击→播放（进度推进）→"我喜欢"三栏→歌单 QQ 标签页→只读详情。

### 9.6 2026-11-04 补充：macOS 打包版白屏修复 + 音源切换 UI

- **白屏根因**（打包版必读）：`syncTaskbarPlayback()` 在 `process.platform !== "win32"` 守卫**之前**调用了 `mainWindow.setThumbnailToolTip(...)`（Windows 专属 API）。macOS 上该函数不存在 → TypeError → async `createWindow` 在 `loadFile` 之前中断 → 窗口永久白屏。修复：Windows 专属 API 全部移到守卫之后。dev 模式与打包版均需真机验证（这次教训：0.6.0 的 mac 适配此前从未真机跑过打包版）。
- 音源 UI 按用户要求改为"融合但一次一源"：新组件 `src/components/music/SourceLogos.tsx`（`NeteaseLogo`/`QqLogo` 内联 SVG + `SourceToggle` logo 切换按钮）。"我喜欢"页三栏改为 logo 切换单栏；搜索结果新增来源筛选芯片（全部/网易云/QQ 音乐/本地，客户端按 `track.source` 过滤）；歌单页 `SourceTabs` 复用同一组件。
- **打包注意**：本机（x64 mac）`npm install` 只下载 x64 Electron，而 `build.electronDist` 固定指向 `node_modules/electron/dist`，导致 `dist:mac` 产出的 arm64 DMG 内嵌的也是 x64 Electron——**真 arm64 机器上不可用**。在 arm64 机器上出包，或按 arch 分开提供 electronDist（TODO）。x64 DMG / `release/mac/Aria.app` 已真机验证（renderer mounted + Now Playing attach + 零报错），并已覆盖安装到本机 /Applications。

### 9.7 2026-11-05/06 补充：网易云扫码登录 eapi 化 + 账号面板

- **网易云登录被风控的原因**：旧 SDK（4.32.0）的 weapi 链在 2025+ 风控下扫码确认后被拦截（-462/8821）。修复：`neteaseService.ts` 的 key/create/check 三调用改走 `crypto: "eapi"`，SDK 的 eapi 分支会把 cookie 里的 `deviceId/os/appver/osver` 写进 eapi header——因此 `neteaseDeviceId()` 首次生成 16 位 hex 持久化到 store（键 `neteaseDeviceId`），跨重启复用；`withEapiDevice()` 把设备 Cookie 打底、会话 Cookie（key/create 回传的 `__csrf`/`NMTID`）叠加。803 后只持久化网易回传的登录 Cookie（不混设备字段）。匿名轮询：会话丢失（进程重启）时用 `noCookie: true` 再查一次真实状态。规格测试 `server/services/neteaseQrLogin.test.ts`（另一会话编写）已全部满足。真实账号扫码验证通过。
- 账号面板（`AccountPanel`）：点头像显示两张**同样式**来源卡片（头像/昵称/登录态/logo），`sourceAccounts` 新增 `avatarUrl`。
- `SourceToggle` 改滑块式（深色滑块 transform 平移）。注意另一会话同期改动：`parseQqCookie` 返回 `loginType`（支持微信登录 wxuin/wxmusic_key）、`getQqPlaylists` 的 mydiss 字段改读 `dissid ?? tid`（dirid 是用户内文件夹号，歌单详情要全局 disstid）——测试已对齐。

### 9.8 2026-11-06 补充:GetEVkey 付费档毒化请求(关键)

- **实测发现**:GetEVkey 请求的 filename 列表里只要混入付费档位文件名(F000/M800/RS01),免费账号的**整个请求**都被拒——连 M500 明文都不给(对照实验:仅 [M500,C400] → M500 给 purl;混入付费档 → 全空)。此前的"多格式候选一次带全"设计正是免费歌时灵时不灵的根因。
- **修复**:请求按档位类别分开——免费歌(pay.play_play=0,搜索时缓存)永远只发 [M500,C400],请求档位再高也降级 128k;VIP 歌按会话级账号能力探测(vipProbeState):unknown 先免费档再付费探测,capable 直接付费档(单档单请求),incapable 直接报"需要 VIP"不再打接口。saveQqCookie/clearQqCookie 重置探测状态。测试 resetQqStreamStateForTests() 保证用例隔离。
- VIP 标识:QQ 搜索结果按 pay.play_play、网易云按 fee===1(含 privilege.fee)在 ProviderTrack.vip 上透传,搜索行显示 VIP 徽章。
