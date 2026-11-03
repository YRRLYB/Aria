# Aria 0.6.0 多播放源实现方案（可执行版）

> 配套文档：`docs/multi-source-plan-0.6.0.md`（架构取舍与平台差异）。
> 本文只回答一件事：**按什么顺序、改哪些文件、每步怎么验收。**
> 版本线：0.6.0-alpha1（契约 + 网易云迁移）→ alpha2（QQ）→ beta（B站）→ 0.6.0 正式（收尾）。
> 目标形态仍是**一个安装包 + 内置按需加载源模块**，不拆包、不做第三方插件市场。

---

## 0.6.0 实际执行路径（2026-10-29 定稿）

> 本节记录 0.6.0 最终采用的**薄标准路线**，与下文原重构版里程碑（M1–M5）的差异。
> 决策背景：完整契约重构成本偏高，改为“标准先行、嵌入在后、存量不动”。

### 已实施（对应下文 M1/M3 的最小子集）

- **标准层**（全部新文件）：
  - `server/sources/contract.ts`：`SourceId`、TrackKey 编解码（`源前缀:` + 源自有 rest，
    兼容将来 `bilibili:BV1xx:cid` 多段 ID）、`SourceError`（六种错误码 → 统一 HTTP 映射）、
    `MusicSource` 窄接口（search / resolveStreamMeta / getLyrics? / getAccount? / saveCookie?），
    DTO 沿用现有 `ProviderTrack`；超时约定：搜索 8s、流解析 12s、歌词 8s。
  - `server/sources/streamProxy.ts`：原网易云流路由（Range/206/`x-aria-*`）抽出为通用转发；
    接受 `resolve(attempt)` 回调，上游 403/410 自动重取一次并按原 Range 续传
    （同时覆盖 QQ purl、B站 DASH、YouTube googlevideo 的过期问题）。
  - `server/sources/registry.ts`：manifest 纯数据 + 动态 `import()` 懒加载；
  - `server/routes/sources.ts`：`GET /api/sources` 与
    `/api/sources/:sourceId/search|tracks/:trackId/stream-meta|stream|lyrics|account|cover`；
    `stream-meta` 不下发 upstream headers（Cookie 不出后端）。
  - `server/remoteCoverCache.ts`：host 白名单 / 缩放策略 / 错误码前缀参数化
    （默认值 = 原网易行为，`covers-qq` 目录 + `gtimg.cn` 白名单）。
- **网易云**：薄适配器 `server/sources/netease/source.ts`（search/lyrics/stream/account 委托
  `neteaseClient`）；其余 25+ 条特有路由与播放链路全部保持旧路由，行为零变化。
- **QQ 音乐**：`server/sources/qq/`（零 npm 依赖，纯 fetch）。搜索 `client_search_cgi`、
  播放地址 `music.vkey.GetEVkey/CgiGetEVkey`（匿名可用；一次请求携带全部档位 filename，
  purl 20 分钟 TTL 缓存，过期/403 走 streamProxy 重取）、LRC 歌词（复用
  `parseNeteaseLyrics` 合并翻译，实测《晴天》返回 63 行）、音质档位
  M500/M800/F000/RS01 → `standard/exhigh/lossless/hires` 自动降级、
  Cookie 登录（`uin` + `qqmusic_key`/`qm_keyst`，`POST /api/settings/qq-cookie`）。
  **扫码登录**（`server/sources/qq/qrLogin.ts`，与网易云同款交互）：ptlogin2 流程
  `xlogin → ptqrshow → ptqrlogin 轮询 → check_sig → oauth2.0/authorize →
  QQConnectLogin.LoginServer/QQLogin`，换取 `musicid/musickey` 即 `uin/qm_keyst` 后
  复用 `saveQqCookie` 入库；会话仅存内存（10 分钟 TTL），Cookie 不出后端。
  路由：`POST /api/settings/qq-qr/start`、`GET /api/settings/qq-qr/check`。
  实测：QR 生成与轮询（66 等待/67 已扫码/65 过期/0 成功）全部真实可用，
  扫码确认后的换凭据链路由测试覆盖（需用户实际扫码完成端到端验证）。
  **播放限制（2026-10 实测）**：旧 `GetVkeyServer` 对无签名请求一律 500003；
  `GetEVkey` 匿名返回 code 0 但只下发加密格式（mflac/mgg），明文 purl 需要登录 Cookie。
  Aria 按红线不做 DRM/加密流解密，因此 QQ 播放需要用户在设置页绑定 Cookie，
  未绑定时返回可操作的指引错误（`SOURCE_UNAVAILABLE`）。带真实 Cookie 的明文链路
  待用户验证；若腾讯后续要求签名，再评估完整 sign 链的移植。
- **前端**：`Track.source` 联合加 `"qq"`；`trackLabels` 加 QQ；`providerTrackToUiTrack`
  按 source 参数化 id 前缀与封面；`coverUrl.ts` 支持 gtimg（路径内尺寸改写 + QQ 封面缓存）；
  `api.ts` 新增 sourceApi 泛型块（listSources/searchSource/getSourceStreamUrl/lyrics/account/
  coverUrl/saveQqCookie）；搜索“全部”并行请求网易云 + QQ（单源失败独立提示）；
  设置页新增“播放源 · QQ 音乐”卡片（Cookie 粘贴登录 + 在线状态）。

### 与原里程碑的差异（记账到 0.7）

- 原 M1 的“29 条旧路由全量迁移”“AppStore v2”“能力系统”“17 处 netease 特判清理”**未做**；
  触发条件：B站/YouTube 接入或 QQ 需要歌单写入时按需推进。
- 音质档位选择菜单仍为网易云专属（`qualitySelection` 未抽象）；QQ 首版按请求档位自动降级。
- QQ 歌单写入、每日推荐、逐字歌词（QRC）不在 0.6.0。
- 歌手页来源分组仍假设 netease/local 二值，QQ 曲目在歌手页计入本地分组（仅展示层）。
- 回归基线：209 项测试全绿（新增 contract / qq client / sources 路由 三组）。

---

## 0. 现状盘点（动手前必须知道的 6 个事实）

| 事实 | 位置 | 对方案的影响 |
| --- | --- | --- |
| 后端路由是单体：`server/index.ts` 共 45 条路由（595 行），其中 29 条带 `/api/providers/netease` 前缀 | `server/index.ts:1-595` | 不能一次性重写；先抽契约层，新老路由并存，逐条迁移 |
| 已有一层很薄的来源抽象，但只覆盖账号/喜欢/歌单/每日/漫游 | `server/providers/musicProvider.ts:120-128`、`server/providers/neteaseProvider.ts`、`server/providers/index.ts` | 直接扩成 `MusicSource`，不要另起一套；现有 5 个方法保留为“扩展能力” |
| 流代理已具备 Range/206 透传与 `x-aria-*` 头 | `server/index.ts:351-392` | 抽成通用 `proxyStream()`，各源只产出 `StreamDescriptor` |
| 前端 `Track` 把来源写成字面量联合，并靠 `providerId` 猜平台 | `src/data/music.ts:16-51`（`source: "local" \| "cloud" \| "netease"`） | 改为 `"local" \| SourceId` + `externalId`，`providerId` 退化为兼容字段 |
| 网易云 ID 约定是 `netease:<songId>`，歌词缓存键也用它 | `src/lib/trackMappers.ts:73,76`、`server/lyrics.ts:31,55` | **保持该格式不变**即零迁移成本；新源按 `qq:<mid>` 等并列扩展 |
| 有 17 处 `source === "netease"` 特判（10 个文件），另有 18 处 `netease:` 字面量拼接 | `src/App.tsx:553,565,1009,1894,2201`、`src/components/music/CollectionSurfaces.tsx:363,373`、`DiscoverySurfaces.tsx:85,382,388`、`PlaybackQueue.tsx:20`、`PlayerViews.tsx:119,260`、`PlaylistActions.tsx:40`、`src/lib/artists.ts:19,75`、`playerPresentation.ts:216`、`SongEncyclopediaDialog.tsx:15`、`trackLabels.ts:6`、`trackMappers.ts:73,76`、`CloudSurface.tsx:27` | 每处都要换成能力查询或 ref 编解码，是 alpha1.5 的验收硬指标 |

设置持久化在 `server/store.ts`（`AppStore`，见 `server/types.ts:51-56`），当前只有 `neteaseCookie` / `neteaseAccount` / `lyricBindings` / `libraryAutoScanEnabled`。
0.6.0 需要加 `sources` 分区，并按版本号做一次迁移。

---

## 1. 目标产物（0.6.0 结束时必须成立）

1. 网易云功能与 0.5.1 行为一致，用户无感。
2. 播放源能力**声明式**：UI 按 `capabilities` 显示/隐藏入口，而不是按源 ID 判断。
3. 未启用的源：**不 import 客户端、不发任何请求**（可用测试证明）。
4. QQ 音乐跑通“搜索 → 播放 → 暂停/恢复 → 下一首 → 重启恢复 → 歌词”。
5. 混合队列（网易云 + QQ + 本地）切歌保持音质、进度和原生输出模式。
6. 单源失败只影响该源（错误码统一、可重试），不清空其它源。
7. 安装包数量仍为 1；源模块随主程序分发。

不在 0.6.0：第三方动态插件、DRM/版权绕过、跨平台歌单双向写入、按源拆包、每源独立更新通道。

---

## 2. 目录与模块边界

```text
server/providers/
  contract.ts            # 类型、错误码、ref 编解码（纯类型 + 纯函数，无网络）
  registry.ts            # manifest 静态表 + 动态 import + 启用开关 + 熔断
  streamProxy.ts         # 通用 Range/206 转发（从 server/index.ts:351-392 抽出）
  netease/
    manifest.ts          # 仅数据：id/name/version/capabilities/allowlist
    source.ts            # 实现 MusicSource，内部调用 ../clients/neteaseClient
    mapper.ts            # neteaseClient DTO -> SourceTrack/SourcePlaylist
  qq/
    manifest.ts
    source.ts
    mapper.ts
server/routes/
  sources.ts             # /api/sources/* 统一契约路由
src/sources/
  registry.ts            # 前端能力描述（不含协议）
  useSource.ts           # 当前源、启用状态、能力查询
  refs.ts                # trackKey/externalId 编解码与旧数据兼容
```

规则（评审时逐条检查）：

- `manifest.ts` **只能** import `contract.ts`。启动时只读 manifest，绝不 import `source.ts`。
- `source.ts` 通过 `registry.ts` 里的 `import()` 懒加载；未启用时该动态 import 不执行。
- 业务页面**不允许** import `server/*` 或任何源的协议细节；只经 `src/lib/api.ts`。
- 任何源模块抛错都必须在 `registry.ts` 被收敛成 `SourceError`，不得冒泡到全局错误中间件。

---

## 3. 契约（v1）

### 3.1 类型

```ts
// server/providers/contract.ts
export type SourceId = "netease" | "qq" | "bilibili" | "youtube";
export type TrackKey = `${SourceId}:${string}`;   // 全局唯一：netease:123 / qq:003xxx / bilibili:BV1xx:cid

export type SourceTrackRef = {
  key: TrackKey;
  source: SourceId;
  externalId: string;                       // 平台主 ID
  parts?: Record<string, string>;           // B站 cid、YouTube itag 等
};

export type SourceTrack = {
  ref: SourceTrackRef;
  title: string;
  artist: string;
  album: string;
  albumRef?: { source: SourceId; externalId: string } | null;
  artistRefs?: Array<{ source: SourceId; externalId: string; name: string }>;
  durationSeconds: number;
  coverUrl?: string | null;
  quality?: string | null;                  // 展示用：无损 / Hi-Res / 320K …
  bitrate?: number | null;
  sampleRate?: number | null;
  level?: AriaLevel | null;                 // 统一档位，见 3.3
  availableLevels?: AriaLevel[];
};

export type StreamDescriptor = {
  url: string;
  mimeType?: string;
  codec?: string;
  bitrate?: number | null;
  sampleRate?: number | null;
  qualityLabel?: string;
  expiresAt?: number;                       // 到期必须重取，缓存不得越过
  requiresProxy?: boolean;                  // true 走后端转发（B站/YouTube）
  headers?: Record<string, string>;         // 仅后端使用，绝不下发 renderer
};

export type SourceLyrics = {
  lines: LyricLine[];
  format: "lrc" | "krc" | "plain";
  hasWordTiming: boolean;
};

export type SourceSearchQuery = {
  query: string;
  mode?: "tracks" | "albums" | "artists" | "playlists";
  cursor?: string | null;
  limit?: number;
};

export type SourceSearchPage = {
  tracks: SourceTrack[];
  albums?: SourceAlbum[];
  artists?: SourceArtist[];
  playlists?: SourcePlaylist[];
  cursor: string | null;
  more: boolean;
};

export type SourceCapabilities = {
  search: true;
  playback: true;
  lyrics: boolean;
  wordLyrics: boolean;
  account: boolean;
  liked: boolean;
  playlistsRead: boolean;
  playlistsWrite: boolean;
  recommendations: boolean;
  qualitySelection: boolean;
  encyclopedia: boolean;
  styles: boolean;
  cloudUpload: boolean;
};

export type SourceManifest = {
  id: SourceId;
  name: string;
  shortName: string;                        // 搜索筛选芯片文案
  version: string;
  contract: 1;
  capabilities: SourceCapabilities;
  allowedArtworkHosts: string[];            // 空数组 = 禁止代理任何封面
  networkPolicy: "direct" | "source-proxy"; // 0.6.0 只允许 direct
  defaultEnabled: boolean;
};

export type AriaLevel = "standard" | "higher" | "exhigh" | "lossless" | "hires" | "jymaster";

export interface MusicSource {
  manifest: SourceManifest;
  search(query: SourceSearchQuery, signal?: AbortSignal): Promise<SourceSearchPage>;
  resolveStream(ref: SourceTrackRef, options: { level?: AriaLevel }, signal?: AbortSignal): Promise<StreamDescriptor>;
  getLyrics?(ref: SourceTrackRef, signal?: AbortSignal): Promise<SourceLyrics | null>;
  getAccount?(signal?: AbortSignal): Promise<SourceAccount>;
  getLikedTracks?(signal?: AbortSignal): Promise<SourceTrack[]>;
  getPlaylists?(signal?: AbortSignal): Promise<SourcePlaylist[]>;
  getPlaylistTracks?(ref: SourcePlaylistRef, signal?: AbortSignal): Promise<{ tracks: SourceTrack[]; cursor: string | null }>;
  getDailyRecommendations?(signal?: AbortSignal): Promise<SourceTrack[]>;
  getPrivateRoaming?(limit: number, signal?: AbortSignal): Promise<SourceTrack[]>;
  resolveArtwork?(url: string, size: number, signal?: AbortSignal): Promise<{ url: string; headers?: Record<string, string> }>;
}
```

兼容策略：`server/providers/musicProvider.ts` 的 `ProviderTrack` 等旧类型保留为 `SourceTrack` 的别名，旧路由继续用，避免一次性改动 50 条路由和 200+ 处调用。

### 3.2 ref 编解码

```ts
export function formatTrackKey(source: SourceId, externalId: string, parts?: Record<string, string>): TrackKey;
export function parseTrackKey(key: string): SourceTrackRef | null;   // 非法返回 null，不抛错
export function legacyTrackKey(songId: string): TrackKey;            // "netease:" + songId
```

约定：

- `externalId` 禁止包含 `:`；B站用 `BV1xx`，`cid` 放 `parts`，key 形如 `bilibili:BV1xx:cid`。
- 旧数据（历史、队列快照、本地歌单里的 `netease:123`）经 `parseTrackKey` 可原样解析，**不做批量改写**。
- 任何 `id.startsWith("netease:")` / `source === "netease"` 的特判都要替换成 `parseTrackKey` 或能力查询。

### 3.3 统一音质档位

已存在的六档 `standard | higher | exhigh | lossless | hires | jymaster`（见 `src/data/music.ts:44`）作为通用枚举，各源自带映射表：

| Aria | 网易云 | QQ（示例） |
| --- | --- | --- |
| standard | standard(128k) | 128k |
| higher | higher(192k) | 192k |
| exhigh | exhigh(320k) | 320k |
| lossless | lossless | FLAC |
| hires | hires | Hi-Res |
| jymaster | jymaster | 臻品母带 |

源不支持某档：`availableLevels` 里不出现，前端只显示实际可选项；`qualitySelection: false` 时整块隐藏。

### 3.4 错误模型

```ts
export class SourceError extends Error {
  constructor(
    readonly code: "AUTH_REQUIRED" | "RATE_LIMITED" | "UNAVAILABLE" | "UNSUPPORTED" | "TIMEOUT" | "UPSTREAM_FAILED",
    message: string,
    readonly source?: SourceId,
    readonly retryAfterMs?: number,
  ) { super(message); }
}
```

HTTP 映射（统一由 `server/routes/sources.ts` 处理）：

| 错误码 | 状态码 | 前端表现 |
| --- | --- | --- |
| AUTH_REQUIRED | 401 | 该源卡片显示“需要登录”，其它源不受影响 |
| UNSUPPORTED | 400 | 隐藏入口（正常不应触发） |
| RATE_LIMITED | 429 | 该源暂时灰显 + 倒计时 |
| UNAVAILABLE | 404 | 单曲不可用，跳过并提示 |
| TIMEOUT | 504 | 该源本次失败，可重试 |
| UPSTREAM_FAILED | 502 | 同上，记录 source 维度日志 |

---

## 4. API 设计

### 4.1 新增（契约路由，全部经 `server/routes/sources.ts`）

```text
GET  /api/sources                               # 启用的 manifest + 能力 + 最近账号状态（不联网）
GET  /api/sources/:sourceId/search?q=&mode=&cursor=&limit=
GET  /api/sources/:sourceId/tracks/:externalId?parts=<urlencoded json>
GET  /api/sources/:sourceId/tracks/:externalId/stream-meta?level=
GET  /api/sources/:sourceId/tracks/:externalId/stream?level=   # 支持 Range / HEAD
GET  /api/sources/:sourceId/tracks/:externalId/lyrics
GET  /api/sources/:sourceId/artwork?url=&size=
POST /api/sources/:sourceId/account/login                       # 网易云二维码 / QQ Cookie 各自实现
GET  /api/sources/:sourceId/account
```

要点：

- `:externalId` 单独占路径段，`parts` 走查询参数，避免 `:` 转义歧义。
- `GET /api/sources` 只读 manifest 与缓存的能力，不得触发任何平台请求（冷启动指标）。
- `stream` 复用抽出的 `proxyStream()`：透传 `206` / `Content-Range` / `Accept-Ranges` / `Content-Length`，并继续返回 `x-aria-bitrate`、`x-aria-sample-rate`、`x-aria-level`，前端无需改动解析逻辑。
- 所有路由统一 `AbortSignal.timeout()`：搜索 8000ms、流解析 12000ms、歌词 8000ms、封面 6000ms。
- 封面代理必须校验 host 白名单（`manifest.allowedArtworkHosts`），每次重定向重新校验；失败返回 403 而不是 502。

### 4.2 兼容路由（alpha1/alpha2 期间保留）

现有 `/api/providers/netease/*` 全部保留，但内部改为调用同一套 `netease/source.ts`，不再直接引 `neteaseClient`：

```ts
// 迁移完成后的旧路由样例，只做参数翻译
app.get("/api/providers/netease/tracks/:trackId/stream", (req, res, next) =>
  legacyStream("netease", req.params.trackId, req, res, next));
```

删除时机：beta 结束、前端全部切到 `/api/sources/*` 且回归通过后（0.6.0 正式版前）。

---

## 5. 注册表、开关与懒加载

```ts
// server/providers/registry.ts
const manifests: Record<SourceId, SourceManifest> = {
  netease: neteaseManifest, qq: qqManifest, bilibili: bilibiliManifest, youtube: youtubeManifest,
};

const loaders: Record<SourceId, () => Promise<MusicSource>> = {
  netease: () => import("./netease/source").then((m) => m.source),
  qq: () => import("./qq/source").then((m) => m.source),
  // bilibili / youtube 在 beta 再补
};

export async function getSource(id: SourceId): Promise<MusicSource>;   // 未启用 -> SourceError("UNAVAILABLE")
export function listEnabledManifests(): SourceManifest[];
```

- 启用状态存 `AppStore.sources[id].enabled`，默认：netease `true`，其余 `false`。
- 每个源一个 `Semaphore(3)` 和一个 `failureUntil` 熔断（连续 3 次失败熔断 30s，成功一次复位）。
- 源级缓存键统一 `sourceId + externalId`，禁止只用平台 ID（防跨平台碰撞）。
- 启动路径只 import manifest 表（纯对象），实测标准：`node --trace-require` 或单测断言 `source.ts` 未被加载。

---

## 6. 数据与设置迁移

### 6.1 设置结构

```ts
// server/types.ts
export type AppStoreV2 = AppStore & {
  storeVersion: 2;
  sources: Partial<Record<SourceId, { enabled: boolean; credentialPreview?: string | null }>>;
};
```

`server/store.ts` 读取时执行 `migrateStore(raw)`：

1. 无 `storeVersion` → 视为 v1。
2. 保留 `neteaseCookie` / `neteaseAccount` 原字段（现有代码直接用，先别动）。
3. 写入 `sources.netease = { enabled: true }`，`sources.qq = { enabled: false }`。
4. 幂等：重复迁移结果一致；迁移失败回退 v1 并记日志，不阻塞启动。

### 6.2 前端持久化

| 数据 | 位置 | 处理 |
| --- | --- | --- |
| 历史记录 | localStorage（`playHistory.ts`） | 只存 `id` 字符串，`netease:` 前缀不变，零迁移 |
| 队列快照 | `playQueue.ts` + 快照 | 同上；`mergeQueueTrackSources` 按 key 合并，逻辑可复用 |
| 本地歌单 | `localPlaylists.ts` | 存 `id`，零迁移 |
| 歌词缓存 | `netease:<id>` | 格式不变；新源用 `qq:<mid>`，互不覆盖 |
| 网易云启动快照 | `neteaseSnapshot.ts` | 0.6.0 只服务网易云；alpha2 之后按源拆分命名空间（`aria-source-snapshot-v2`） |

原则：**旧 key 一律不改写**，只新增命名空间。这样用户升级后历史、队列、歌单都能直接恢复。

---

## 7. 前端改造

### 7.1 模型

```ts
// src/data/music.ts
export type Track = {
  id: string;                 // TrackKey：netease:123 / qq:00xxxx / local:<hash>
  externalId?: string;        // 新字段；缺省时由 id 解析
  providerId?: string;        // 兼容期保留，alpha2 后标记 @deprecated
  source: "local" | SourceId;
  // …其余字段不变
};
```

配套 `src/sources/refs.ts`：

```ts
export function trackKeyOf(track: Track): string;
export function sourceOf(track: Track): SourceId | "local";
export function isPlayableSource(track: Track): boolean;
export function externalIdOf(track: Track): string | null;
```

### 7.2 能力驱动 UI

`src/sources/registry.ts` 输出每个源的展示描述（名称、颜色、芯片文案、支持的档位、是否有百科/歌单写入）。所有入口改成查能力：

| 现有特判 | 改法 |
| --- | --- |
| `src/components/music/PlayerViews.tsx:260`（`source === "netease" && 数字 ID` 才显示百科） | `capabilities.encyclopedia === true` |
| `src/components/music/SongEncyclopediaDialog.tsx:15`（`replace(/^netease:/, "")`） | `externalIdOf(track)` |
| `src/lib/trackLabels.ts:6`（写死 netease→网易云） | 由 `src/sources/registry.ts` 的 `shortName` 生成 |
| `src/App.tsx:2131`（歌手跳转时拼 `netease:`） | `formatTrackKey(sourceOf(track), id)` |
| `src/components/music/CloudSurface.tsx:27`（云盘 key 拼 `netease:`） | `trackKeyOf` |
| `src/lib/trackMappers.ts:73,76` | 保留 `netease:` 生成，但走 `formatTrackKey` |

### 7.3 搜索与筛选

- 搜索页顶部来源芯片：`全部 / 网易云 / QQ / 本地`，来自 `GET /api/sources`。
- “全部”并行请求多个源：`Promise.allSettled`，单源 8s 超时，单源失败只在该源分区显示错误条。
- 结果去重按 `TrackKey`；同曲多源共存时，播放优先用户当前选中的源。
- 队列/历史条目显示来源小徽章（复用 `trackLabels` 的能力描述）。

### 7.4 设置页

新增“播放源”区块（放在“外观主题”之前）：

- 每个源一行：名称、版本、能力芯片、登录状态、启用开关。
- 关闭开关立即生效：前端不再出现该源入口，后端 `getSource()` 拒绝，且不加载客户端。
- 未启用源不显示登录按钮（避免用户对着不可用源点登录）。

---

## 8. QQ 音乐接入细则（第二个参考实现）

目标链路：搜索 → 播放 → 暂停/恢复 → 下一首 → 重启恢复 → 歌词。范围外（0.7）：歌单写入、每日推荐、云盘。

需要实现的端点（内部接口，按现有网易云的调用风格封装，禁止在页面层出现）：

| 能力 | 平台接口要点 | 落地位置 |
| --- | --- | --- |
| 搜索 | `client_search_cgi`，返回 `songmid/title/singer/album/interval/albummid` | `qq/client.ts` + `mapper.ts` |
| 播放地址 | `musicu.fcg` 的 `vkey.GetVkeyServer`，需 `guid + songmid + 音质前缀`；返回 `purl` 会过期 | `qq/client.ts:resolveStream` |
| 歌词 | `music.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg`（LRC 或 QRC） | `qq/client.ts:getLyrics` |
| 封面 | `y.gtimg.cn/music/photo_new/T002R300x300M000<albummid>.jpg` | 写入 `allowedArtworkHosts` |
| 账号 | Cookie（`uin` + `qqmusic_key`），服务端保存，renderer 只拿昵称/头像 | `AppStore.sources.qq` |

关键约束：

- 播放地址必须走 `requiresProxy: true` 的后端转发（带 `Referer: https://y.qq.com/`），否则 403。
- `expiresAt` 必须写入缓存键；过期重取，不得把过期 URL 交给 `<audio>` 重试死循环。
- 音质档位映射见 3.3；`lossless` 不可用时 `availableLevels` 自动降级，前端档位条只显示可用项。
- 登录态失效返回 `AUTH_REQUIRED`，不抛 500。

---

## 9. B 站与 YouTube（预留，不在 alpha 阶段动手）

- 已在上文契约里预留 `parts`（`cid` / `itag`）与 `requiresProxy`，无需改契约即可接入。
- B站：`bvid + cid` 作为 key；`capabilities` 关闭 `liked` / `recommendations` / `playlistsWrite` / `encyclopedia`，`lyrics` 视字幕而定（`wordLyrics: false`）。
- YouTube：`videoId`；URL 快速过期 + 需要专用请求头，必须全程走后端转发；字幕转普通歌词，声明 `wordLyrics: false`。
- 两者都必须在 `manifest.allowedArtworkHosts` 里精确列出图床域名。

---

## 10. 测试矩阵

| 层 | 文件 | 必测点 |
| --- | --- | --- |
| 契约 | `server/providers/contract.test.ts` | key 往返、非法 key 返回 null、旧 `netease:` 兼容、错误码映射 |
| 注册表 | `server/providers/registry.test.ts` | 未启用源不 import、不 fetch；启用后只 import 一次；熔断与复位 |
| 路由 | `server/routes/sources.test.ts` | 206/Content-Range 透传、HEAD、416、超时→504、封面白名单→403、未知 sourceId→404 |
| 源实现 | `server/providers/qq/mapper.test.ts` | fixture 映射、档位降级、过期 URL 重取 |
| 前端模型 | `src/sources/refs.test.ts` | `trackKeyOf`/`sourceOf` 对旧数据、混合数据的解析 |
| 前端能力 | `src/sources/capabilities.test.ts` | 能力开关到 UI 入口的映射（百科、档位、歌词、歌单写入） |
| 回归 | 现有 34 个测试文件 | 全部保持通过，尤其 `neteaseClient.test.ts`、`playQueue.test.ts`、`playerPresentation.test.ts` |

统一验收命令（每阶段结束都必须全绿）：

```powershell
node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json
node_modules\.bin\vitest.cmd run
npm.cmd run build:web
npm.cmd run build:server
node --check electron/main.cjs
```

---

## 11. 里程碑与退出条件

### M1 · alpha1：契约与网易云迁移（约 3 天）

1. 建 `contract.ts`、`registry.ts`、`streamProxy.ts`；扩 `MusicProvider` → `MusicSource`。
2. 网易云 `manifest.ts` / `source.ts` / `mapper.ts`，旧路由改为委托。
3. `AppStore` v2 + 迁移函数；`GET /api/sources` 返回唯一启用源。
4. 契约/注册表/路由测试三件套。

**退出条件**：新旧路由对同一请求返回完全一致的结果（含 Range 与 `x-aria-*` 头）；用户无感；测试全绿。

### M2 · alpha1.5：前端统一身份与能力 UI（约 3 天）

1. `Track` 加 `externalId`、`source` 改为 `SourceId`；`src/sources/refs.ts`。
2. 清掉 17 处 `source === "netease"` 特判（第 0 节表格）与其余 `netease:` 字面量拼接。
3. 搜索页来源芯片 + 单源错误条（此时只有网易云，先验证布局不塌）。
4. 设置页“播放源”区块（含启用开关）。

**退出条件**：全仓 `grep 'source === "netease"'` 为 0；`grep "netease:"` 只出现在 ref 编解码（`src/sources/refs.ts`）、测试 fixture 与网易云源模块内部。

### M3 · alpha2：QQ 音乐（约 5 天）

1. manifest / client / mapper / 登录 Cookie。
2. 搜索、流（代理）、歌词、封面；档位映射与降级。
3. 混合队列与重启恢复；单源失败隔离。

**退出条件**：QQ 搜索→播放→暂停→恢复→下一首→重启恢复；网易云同时在线互不影响；断网/401/429 三种错误只影响该源。

### M4 · beta：B站（约 4 天）

1. 视频搜索、音频流选择、`cid` 放 `parts`。
2. 关闭不支持的能力；UI 明确标注“视频音轨”。
3. 206 拖动与 URL 过期重取。

**退出条件**：拖动进度条不中断；URL 过期后自动重取一次成功；能力缺失的入口确实消失。

### M5 · 正式版：收尾（约 2 天）

1. 删除旧 `/api/providers/netease/*` 中已迁移的路由（保留真正网易云特有的百科/风格/云盘）。
2. 性能回归：冷启动、首屏封面、混合队列切歌。
3. 关闭某源后 `GET /api/sources` 不返回它、后端不加载、前端无入口。
4. `npm.cmd run dist:beta` 出包，`release/Aria-0.6.0-x64.exe`，记录 SHA256。

---

## 12. 风险与回滚

| 风险 | 概率 | 处理 |
| --- | --- | --- |
| 重构把网易云搞坏 | 中 | 新老路由并存 + 双跑对比测试；alpha1 不删任何旧代码 |
| 动态 import 拖慢冷启动 | 低 | manifest 纯数据；单测断言未启用源不加载 |
| QQ 播放地址 403 / 过期 | 高 | 强制后端代理 + `expiresAt` 缓存 + 单次重取 |
| 前端大改引入回归 | 中 | 身份改动与 UI 改动分两个 PR；先加字段后切行为 |
| 契约设计漏掉 B站/YouTube | 中 | `parts` + `requiresProxy` + 可选方法已预留；beta 前不再改核心签名 |
| 用户数据丢失 | 低 | 只新增命名空间、不改旧 key；`store.json` 迁移幂等且失败回退 |

回滚开关：`ARIA_SOURCES_V2=0` 环境变量或设置项 `sourcesV2: false` 时，`server/index.ts` 继续挂旧路由实现，新路由返回 404 —— beta 之前一直保留。

---

## 13. 交付物清单

- 代码：第 2 节目录结构 + 第 4 节路由 + 第 7 节前端改造。
- 文档：本文 + `docs/multi-source-plan-0.6.0.md`；`CHANGELOG.md` 增加 0.6.0 段。
- 测试：第 10 节新增 6 个测试文件，现有 181 项保持通过。
- 发布：`release/Aria-0.6.0-x64.exe`（单包），附 SHA256 与冷启动对比数据。

---

## 14. 一页执行清单（贴在看板上）

```
[ ] contract.ts / registry.ts / streamProxy.ts
[ ] netease manifest+source+mapper；旧路由委托
[ ] AppStore v2 迁移 + /api/sources
[ ] 契约·注册表·路由 三组测试
[ ] Track.externalId + src/sources/refs.ts
[ ] 清 17 处 netease 特判
[ ] 搜索来源芯片 + 单源错误条
[ ] 设置页“播放源”区块
[ ] QQ client/mapper/登录/搜索/流/歌词/封面
[ ] 混合队列 + 重启恢复
[ ] B站 搜索/音轨/代理/过期重取
[ ] 下线旧路由、性能回归、出包
```
