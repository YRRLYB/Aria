# Aria 0.6.0 多播放源架构方案

> 结论先行：**0.6.0 采用“一个主程序 + 内置模块化播放源”，不做每个平台一个独立安装包。**
> 网易云、QQ 音乐、B站、YouTube 共用一套曲库、搜索、队列、播放器、歌词、缓存和设置；
> 各源只实现自己的协议。0.6.0 先完成插件契约和网易云无感迁移，再以 QQ 音乐作为第二个
> 参考实现验证架构，B站和 YouTube 随后按同一契约接入。

## 1. 为什么不拆成四个安装包

| 方案 | 优点 | 主要问题 | 结论 |
| --- | --- | --- | --- |
| 每源一个安装包 | 包内最简单 | Electron、Chromium、mpv、React、播放器界面会被复制四份；四套设置、曲库索引、缓存和更新通道；跨源搜索/队列无法实现 | 不采用 |
| 一个安装包 + 内置源模块 | 单进程、单曲库、单队列、单套更新；可按需加载，体积增加很小 | 需要先定义稳定契约 | **0.6.0 采用** |
| 一个安装包 + 可下载源插件 | 单曲库；源可独立更新 | 仍要处理签名、权限、沙箱和兼容性，首版成本过高 | 0.7 以后再评估 |

Aria 的体积主要来自 Electron/Chromium、mpv、音频原生模块和 React，而不是一个平台的 API
客户端。四个独立安装包会把这部分重复四遍。真正需要隔离的是 **协议、凭据、签名和网络策略**，
不是整个桌面程序。

需要注意：B站和 YouTube 的资源形态与音乐平台差别很大，但差异应由源适配器吸收，而不是
让每个页面都写一套 `if (source === ...)`。

## 2. 目标与非目标

### 0.6.0 目标

- 网易云现有功能保持行为一致，先完成无感重构。
- 统一资源 ID、搜索、播放地址、封面、歌词、队列和错误模型。
- 播放源能力可声明，界面按能力显示入口，不再按“是不是网易云”推断。
- 内置源按需加载；启动时不导入未启用源的客户端。
- 每个源有独立网络策略、超时、限流、缓存和登录状态。
- 至少接入 QQ 音乐，跑通“搜索 → 播放 → 歌词 → 加入队列”的完整链路。
- 为 B站、YouTube 留出播放描述与多段流能力，避免二次破坏契约。

### 非目标

- 0.6.0 不开放安装任意第三方 Node 插件。
- 不做 DRM 绕过，不内置账号、Cookie、付费内容或版权规避能力。
- 不保证平台私有接口永久稳定；源模块必须可独立降级和关闭。
- 不在首版实现跨平台歌单双向写入。跨源歌单先只读聚合或本地歌单。

## 3. 目标结构

```text
server/providers/
  registry.ts                 # manifest 注册与懒加载
  contract.ts                 # 通用接口、错误、DTO
  netease/
    manifest.ts               # 名称、能力、图标、设置 schema
    client.ts                 # API/鉴权/流地址
    mapper.ts                 # 平台 DTO -> 通用 DTO
  qq/
  bilibili/
  youtube/
src/sources/
  registry.ts                 # 能力与 UI 描述，不包含协议实现
  useSource.ts                # 当前源状态
```

`manifest.ts` 必须很轻，启动时只读取 manifest；`client.ts` 使用动态 `import()`，第一次搜索、
打开该源或播放时才加载。这样即使装了四个源，也不会拖慢冷启动。

## 4. 核心契约

```ts
type ProviderId = "netease" | "qq" | "bilibili" | "youtube";

type SourceCapabilities = {
  search: boolean;
  playback: boolean;
  lyrics: boolean;
  account: boolean;
  liked: boolean;
  playlistsRead: boolean;
  playlistsWrite: boolean;
  recommendations: boolean;
  qualitySelection: boolean;
  encyclopedia: boolean;
};

type SourceManifest = {
  id: ProviderId;
  name: string;
  version: string;
  contract: 1;
  capabilities: SourceCapabilities;
  allowedArtworkHosts: string[];
  networkPolicy: "direct" | "source-proxy";
};

interface MusicSource {
  manifest: SourceManifest;
  search(query: SourceSearchQuery, signal?: AbortSignal): Promise<SourceSearchPage>;
  resolveStream(track: SourceTrackRef, options: StreamOptions, signal?: AbortSignal): Promise<StreamDescriptor>;
  getLyrics?(track: SourceTrackRef, signal?: AbortSignal): Promise<LyricLine[]>;
  getAccount?(signal?: AbortSignal): Promise<SourceAccount>;
  getLikedTracks?(signal?: AbortSignal): Promise<SourceTrack[]>;
  getPlaylists?(signal?: AbortSignal): Promise<SourcePlaylist[]>;
}
```

原则：**搜索和播放是核心能力，其余全部可选。** 没有账号、没有每日推荐、没有逐字歌词的源
仍然可以是一个合格的播放源。

### 4.1 统一资源身份

不要继续把平台 ID 当 Aria ID：

```ts
type SourceTrackRef = {
  id: string;             // 全局唯一：netease:123 / qq:003... / bilibili:BV1..:cid
  provider: ProviderId;
  externalId: string;     // 平台主 ID
  parts?: Record<string, string>; // B站 cid、YouTube itag 等
};
```

前端 `Track.source` 从 `local | cloud | netease` 改为 `local | SourceProviderId`，并新增
`provider` 与 `externalId` 字段。迁移时把旧 `netease:` ID 原样保留，旧播放状态、历史和
歌单引用才能继续恢复。所有 `id.startsWith("netease:")`、`providerId` 特判都要删除。

### 4.2 播放描述

```ts
type StreamDescriptor = {
  url: string;
  mimeType?: string;
  codec?: string;
  bitrate?: number | null;
  sampleRate?: number | null;
  qualityLabel?: string;
  expiresAt?: number;
  requiresProxy?: boolean;
  headers?: Record<string, string>; // 仅后端使用，不下发 Cookie
};
```

B站 DASH 音轨、YouTube googlevideo 地址会过期，并可能需要 Referer/User-Agent。统一由后端
`/api/sources/:sourceId/tracks/:trackId/stream` 转发，保留 `200/206`、`Content-Range`、
`Accept-Ranges`。签名 URL 缓存不得超过 `expiresAt`。

### 4.3 能力与 UI

搜索页的来源筛选、歌曲页按钮、音质菜单、歌词入口都读取 `capabilities`：

- 没有 `playlistsWrite`：不显示“加入歌单”的远端写入入口。
- 没有 `liked`：不显示远端红心。
- 没有 `qualitySelection`：隐藏音质档位，只显示实际返回格式。
- 没有 `lyrics`：仍然可以播放，歌词区显示“该来源不提供歌词”。

## 5. API 设计

```text
GET  /api/sources
GET  /api/sources/:sourceId/search?q=&mode=&cursor=
GET  /api/sources/:sourceId/tracks/:trackId
GET  /api/sources/:sourceId/tracks/:trackId/stream-meta
GET  /api/sources/:sourceId/tracks/:trackId/stream
GET  /api/sources/:sourceId/tracks/:trackId/lyrics
GET  /api/sources/:sourceId/artwork?url=&size=
```

兼容期保留现有 `/api/providers/netease/...`，内部转调新契约；前端迁移完成后再删除旧路由。

所有路由必须：

- 校验 sourceId 与外部 ID 格式。
- 由源的 host 白名单校验封面、音频和重定向目标，防止 SSRF。
- 统一使用 `AbortSignal.timeout()`；搜索 8 秒、流解析 12 秒、封面 6 秒。
- 统一错误码：`AUTH_REQUIRED`、`RATE_LIMITED`、`UNAVAILABLE`、`UNSUPPORTED`、`TIMEOUT`。
- 账号状态按需加载，`GET /api/sources` 只返回 manifest 与已缓存能力，不等待四个平台登录检查。

## 6. 网络策略

网易云维持 0.5.1 的**全局直连**：Electron `direct`、后端不继承系统代理变量。

其它源不改变这个全局默认，而是在源适配器内声明：

```ts
networkPolicy: "direct" | "source-proxy";
```

未来如果 YouTube 需要单独代理，只允许在 `youtube` 模块内使用专用 dispatcher/agent，
不得重新给整个 Aria 挂系统代理，也不得影响网易云的国内直连。

## 7. 存储、缓存与安全

- 凭据按源隔离；Electron 下优先使用 `safeStorage` 加密，退化为本机用户目录文件时明确提示。
- Cookie/Token 永远不经 Renderer，不下发到 `<audio>` URL。
- 搜索、流地址、歌词、封面缓存按 `sourceId + externalId` 分区，避免不同平台 ID 碰撞。
- 封面缓存接受源声明的 host 白名单；每次重定向都重新校验。
- 每个源有独立限流器：搜索建议、歌词、封面预热不得共享同一个无界队列。
- 插件错误必须降级为单源错误，不能让 B站接口失败清空网易云首屏。

## 8. 平台接入难点

### QQ 音乐（第二个源，优先）

- 模型最接近网易云：歌曲、专辑、歌手、歌单、歌词齐全。
- 重点处理 `songmid`、登录 Cookie、播放 URL 签名与音质映射。
- 适合作为契约的第二个实现，验证前端不再假设网易云。

### B站

- 资源是视频，不一定是音乐；标识为 `bvid + cid`。
- 作者映射为 UP 主，专辑可为空；DASH 音轨可能需要单独选择。
- 没有统一的喜欢歌曲/每日推荐语义，这些 capability 关闭。
- 音频请求通常需要 Referer/User-Agent，URL 会过期。

### YouTube

- 使用 `videoId`，保留频道信息。
- 播放器客户端和签名规则经常变化，是四个源里维护成本最高的。
- googlevideo URL 会快速过期，必须处理后端转发、Range 和过期重取。
- 字幕可转为普通歌词，不应假装提供逐字歌词。
- 需要单独评估所在地区的可访问性与合规要求。

## 9. 版本拆分

### 0.6.0-alpha 1：契约与网易云迁移

- 建立 `contract.ts`、manifest、懒加载 registry。
- 统一 Track ID 与 StreamDescriptor。
- 新路由为网易云提供与旧路由完全一致的结果。
- 旧 ID、历史、队列缓存迁移。
- 契约测试：ID 往返、Range、错误、超时、封面白名单。

验收：除内部日志外，用户看不到行为变化；测试全绿。

### 0.6.0-alpha 2：QQ 音乐

- manifest、Cookie 登录、搜索、流、歌词、封面。
- 搜索页来源筛选与单源错误态。
- 队列中混合网易云、QQ 和本地歌曲。
- 跨源搜索可并行请求，但单源失败不阻塞其它源。

验收：QQ 搜索 → 播放 → 暂停/恢复 → 下一首 → 重启恢复全部通过。

### 0.6.0-beta：B站

- 视频搜索、音频流选择、UP 主与封面。
- 明确展示“视频音轨”与时长/格式；关闭不支持的账号能力。
- 验证 206 拖动、URL 过期重取和专用请求头。

### 0.6.0：收尾

- 性能回归：冷启动、首屏封面、混合队列切歌。
- 每个源可单独关闭；关闭后不加载客户端、不发起网络请求。
- 安装包保持一个；源模块随主程序分发，不增加安装步骤。

YouTube 若受接口变化或地区条件影响，可以顺延到 0.6.x，但**不能为了赶版本破坏已经稳定的
契约**。建议顺序始终是：网易云迁移 → QQ → B站 → YouTube。

## 10. 验收指标

- 冷启动窗口出现时间不被任何音乐源网络请求阻塞。
- 网易云登录后首批歌曲不再等待私人漫游接口。
- 未启用源不产生请求、不加载客户端代码。
- 混合队列切歌保持播放位置、音质和原生输出模式。
- 单源 4xx/5xx/超时只影响该源，错误可重试且不清空其它源。
- 搜索、封面缓存键在四个源之间无碰撞。
- 安装包不按源拆分，更新一次即可修复任一内置源。

## 11. 风险与决策记录

| 风险 | 处理 |
| --- | --- |
| 平台接口随时变化 | 内置源独立版本号、独立开关、快速热修复主程序 |
| 第三方插件执行任意代码 | 0.6.0 不做第三方动态插件；只做内置受信模块 |
| B站/YouTube 流协议复杂 | StreamDescriptor + 后端转发 + 能力声明，不污染核心 |
| 四个源让界面臃肿 | 能力驱动 UI；未启用源不出现在搜索和导航 |
| 代理策略影响国内网易云 | 全局保持 direct；代理只能在单源内声明 |
| 版权/地区限制 | 只播放用户有权访问的内容，不实现下载、破解或 DRM 绕过 |
