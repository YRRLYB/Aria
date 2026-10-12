# 网易云 API 能力与下一步建议

盘点日期：2026-10-12。对应 Aria `0.4.0-beta.6`，依据项目代码、已安装的 `NeteaseCloudMusicApi 4.32.0` 及本地接口文档核查。

## 接入数量

| 统计口径 | 数量 |
| --- | ---: |
| 依赖提供的接口模块 | 377 |
| `neteaseClient.ts` 使用的不同模块 | 26 |
| 整个 `server` 使用的不同模块 | **31** |
| 尚未接入、可继续评估的模块 | **346** |

统计扫描非测试代码中的 `neteaseApi.<接口>(...)`、`callNetease("接口", ...)`，并计入通过类型转换取得的 `like`。同一接口重复调用、增加搜索模式均只计一次。

**346 表示待评估接口模块，不代表 346 个保证可用的功能。** 一个产品功能可能需要多个接口，实际结果也受登录状态、会员权益、版权、隐私设置和上游接口状态影响。

已接入的模块：

```text
album                 artist_album          artist_desc
artist_detail         artist_top_song       cloudsearch
like                  likelist              login_qr_check
login_qr_create       login_qr_key          login_status
lyric                 personal_fm           playlist_cover_update
playlist_create       playlist_desc_update  playlist_detail
playlist_name_update  playlist_subscribe    playlist_tags_update
playlist_track_all    playlist_tracks       recommend_songs
search_suggest        song_detail           song_order_update
song_url_v1           user_account          user_detail
user_playlist
```

## 已经完成的体验

| 功能 | 当前接入范围 |
| --- | --- |
| 搜索增强 | 单曲、歌手、歌单、用户、专辑、歌词六种模式；输入联想；按当前模式请求与加载更多；歌词结果展示匹配片段 |
| 用户与公开歌单 | 搜索普通用户，查看公开资料、创建或收藏的可见歌单，再进入歌单查看与播放 |
| 完整歌单管理 | 新建公开或私密歌单；自己创建的歌单可增删歌曲、改名、修改介绍、调整歌曲顺序、上传封面；他人的歌单可收藏或取消收藏 |
| 专辑与歌手详情 | 专辑信息与完整曲目；歌手简介、介绍段落、热门曲目和专辑列表 |
| 推荐与播放 | 每日推荐、私人漫游、喜欢歌曲、普通同步歌词及翻译、实际取流音质与原始/臻品档位 |

六种搜索共用 `cloudsearch`，对应 `type=1 / 100 / 1000 / 1002 / 10 / 1006`；`1002` 是用户，`100` 是歌手。用户搜索与公开详情不强制登录；用户歌单列表仅显示当前会话有权访问的内容。

歌单写操作要求登录，编辑前重新检查歌单所有权。“我喜欢的音乐”的名称和封面由网易云管理。排序需要完整歌曲集合，歌单已变化或超过当前读取上限时会提示重新打开；上游拒绝会显示错误。歌单标签接口也已接入后端，界面暂未提供标签编辑。

## 下一步优先级

以下为仍未完成的功能，按桌面播放器的日常价值和现有代码可复用程度排序。

| 排名 | 建议功能 | 可用接口 | 实际改善 |
| --- | --- | --- | --- |
| 1 | 智能接续与场景漫游 | `playmode_intelligence_list`、`simi_song`、`personal_fm_mode`；复用 `personal_fm` | 队列结束自动接着听相似歌曲；结合最近播放、跳过反馈去重；提供专注、探索等模式 |
| 2 | 逐字歌词 | `lyric_new`；复用 `lyric` | 有逐字数据时逐词高亮，缺失时回退到普通同步歌词 |
| 3 | 本地曲库补全 | `search_match`；复用 `song_detail`、`lyric` | 利用标题、歌手、专辑、时长等资料匹配缺失封面与歌词，提供候选确认 |
| 4 | 歌单体检与音质诊断 | `check_music`、`song_music_detail`；复用 `song_detail`、`song_url_v1` | 找出重复、失效及受限歌曲，区分歌曲支持的音质与当前账号实际拿到的音质 |
| 5 | 歌曲档案与创作者 | `song_wiki_summary`、`song_creators` | 展示作词、作曲、制作等信息；专辑与歌手详情已有，此项补全歌曲资料 |
| 6 | 云端历史与听歌报告 | `record_recent_song`、`user_record`、`scrobble`、`listen_data_today_song`、`listen_data_total` | 导入网易云最近播放并合并本地历史；由用户开启播放记录上报 |
| 7 | 专辑、歌手收藏 | `album_sub`、`artist_sub` | 直接收藏完整专辑和歌手；歌单收藏已完成 |
| 8 | 网易云云盘曲库 | `user_cloud`、`user_cloud_detail`、`cloud` | 先浏览并播放自己的云盘歌曲，再增加文件上传 |
| 9 | 歌单导入 | `playlist_import_name_task_create`、`playlist_import_task_status` | 从文字或支持的链接导入歌单，显示任务进度和未匹配歌曲 |
| 10 | MV 与副歌试听 | `mv_detail`、`mv_url`、`song_chorus` | 歌曲详情打开 MV；进度条标记副歌位置，便于主动试听 |

下一版建议优先做 **智能接续队列 → 逐字歌词 → 本地曲库补全**。智能接续可以先使用网易云推荐接口，加上 Aria 的去重、近期播放过滤和跳过反馈，不需要额外接入大模型。

云盘、收藏、个人历史及播放记录上报需要登录；部分听歌报告可能需要会员。体检接口的“可用”结果需要结合实际取流判断，不能直接推断完整歌曲或目标音质一定可播放。歌单导入的链接支持范围和匹配率也需要单独实测。

优先级较低的选项还有排行榜与新专辑（`toplist`、`toplist_detail`、`album_newest`），歌曲评论（`comment_music`、`comment_hot`），以及由用户主动发起的资源分享（`share_resource`）。

## 验证范围

用户搜索、用户公开资料与歌单、专辑搜索与详情、歌手简介与专辑、搜索建议、歌词搜索已使用匿名请求验证真实返回结构，并通过实际 `NeteaseClient` 流程检查。验证使用隔离的 Aria 数据目录，没有修改真实账号中的内容。

歌单写操作使用模拟接口测试，覆盖所有权检查、特殊歌单限制、完整排序集合、封面转码、缓存失效与上游错误；没有对真实账号执行增删、改名、上传或收藏测试。待接能力只确认本地模块和文档存在，尚未逐个在线验证。

核查来源为 `server/clients/neteaseClient.ts`、`server/services/neteaseService.ts`、`server/lyrics.ts`，以及本地依赖中的 `module/*.js`、`public/docs/home.md`。封面缓存、标题布局、快捷键、无缝播放和睡眠定时器属于 Aria 本地能力，不增加网易云接口种类。
