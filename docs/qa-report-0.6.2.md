# Aria 0.6.2 QA 报告

日期：2026-11-08  
环境：Windows 11 / Node 24.15.0 / Electron 43 / x64

## 1. 自动化测试

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npx tsc -b` | 通过 |
| 单元测试 | `npm test` | 43 个文件 / 272 项通过 |
| 后端构建 | `npm run build:server` | 通过 |
| 前端构建 | `npm run build:web` | 通过 |
| 桌面集成（开发态） | `node scripts/test-desktop.cjs` | 通过 |
| 桌面集成（安装包态） | `node scripts/test-desktop.cjs --resources release/win-unpacked/resources` | 通过 |
| NSIS 安装包 | `npm run dist:beta` | 通过 |

桌面集成覆盖：本地封面/内嵌封面提取与多尺寸缓存、SMTC 媒体卡片、播放/暂停、上一首/下一首、队列、后台播放、音量标准化开关持久化、WASAPI 系统/共享/独占输出、mpv 原生播放、无缝切歌、单曲循环。

## 2. QQ 音乐在线接口冒烟

通过本地后端真实请求验证：

| 功能 | 接口 | 结果 |
| --- | --- | --- |
| 单曲搜索 | `/api/sources/qq/search?mode=tracks` | 200，返回歌曲与分页 |
| 歌手搜索 | `/api/sources/qq/search?mode=artists` | 200（频控时自动退避） |
| 专辑搜索 | `/api/sources/qq/search?mode=albums` | 200（频控时自动退避） |
| 歌单搜索 | `/api/sources/qq/search?mode=playlists` | 200 |
| 歌手详情 | `/api/sources/qq/artists/:mid` | 200，昵称/简介/曲目数 |
| 歌手曲目 | `/api/sources/qq/artists/:mid/tracks` | 200，返回曲目和分页 |
| 歌手专辑 | `/api/sources/qq/artists/:mid/albums` | 200，返回专辑和分页 |
| 专辑详情 | `/api/sources/qq/albums/:mid` | 200，专辑信息 + 21 首曲目 |
| 公开歌单 | `/api/providers/qq/playlists/:id/tracks` | 匿名读取 244 首成功 |
| 每日推荐 | `/api/sources/qq/daily` | 200，真实推荐失败时回落榜单 |
| 私人漫游 | `/api/sources/qq/roam` | 200，优先官方雷达 `GetRadarSong` |

说明：QQ 匿名请求会触发 2001 频控；客户端已做 300/600/1200ms 退避、20 秒同词同页缓存和账号资料 30 秒缓存。登录 Cookie 下稳定性更高。

## 3. 本轮功能清单

- QQ 搜索：单曲 / 歌手 / 专辑 / 歌单，全部支持分页“加载更多”。
- QQ 歌手页：详情、简介、曲目、专辑、专辑详情跳转。
- QQ 专辑页：详情、完整曲目、播放。
- QQ 歌单：搜索、公开歌单匿名读取、我创建/收藏歌单读取、我喜欢双向写入。
- QQ 推荐：每日推荐优先 `RecommendFeed`，私人漫游优先 `GetRadarSong`，均可回落官方榜单。
- QQ 红心：`PlaylistDetailWrite/AddSonglist|DelSonglist` + zzc 签名 + ag-1 加密。
- 网易云播放：空 URL 不缓存、档位逐级回退、错误原因可见。
- 频谱：WASAPI 旁路取样按真实档位选择并自动回退。
- 首页人物 / 浮球 SVG 图标 / 新手教程 QQ 提示。

## 4. 当前限制

- QQ 歌单编辑（新建、改名、加歌、删歌、排序）仍为只读，避免在未做完整写后校验前修改账号。
- QQ 用户搜索、歌词片段搜索、评论、相似歌曲、云盘没有接入。
- QQ 加密格式（mflac/mgg）按项目红线不解密；VIP 音质取决于账号权限。
- QQ 每日推荐/雷达依赖账号权限；未登录时自动使用官方榜单兜底。

## 5. 安装包

- 文件：`release/Aria-0.6.2-x64.exe`
- 大小：164,148,687 bytes（约 156.54 MiB）
- SHA256：`882ECB14B0A7414FAFFF0A85B6A6835A6335E3D0E4949E802A2795849A3AE1E2`
