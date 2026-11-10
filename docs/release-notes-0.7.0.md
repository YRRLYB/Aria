## Aria 0.7.0

- 新增 B站（哔哩哔哩）第三音源：匿名搜索、视频详情、DASH 音轨、B站封面与 CC 字幕歌词。
- 新增“视频 / 封面”双模式：B站视频可在播放页和沉浸页直接观看，切回封面后继续高音质音频播放。
- 播放源能力系统：设置页可逐源启用/禁用，界面按能力隐藏不支持的搜索类型、红心、歌单写入等入口。
- Aria 歌单支持混合来源：本地歌单可加入网易云、QQ 音乐和 B站歌曲，远程曲目保存紧凑快照，重启后仍可播放。
- “我喜欢”新增全部来源聚合视图，保留本地/网易云/QQ 单来源筛选与来源徽章。
- 接入 electron-updater：设置 → 版本与更新支持检查、下载进度与重启安装；Windows 安装包附带 latest.yml 与 blockmap；更新检查优先走系统代理，不可用时自动回退直连。
- macOS 继续提供 Intel x64 与 Apple Silicon arm64 两个 DMG；未签名版本暂不启用自动更新，请手动下载新版。
- 回归：45 个测试文件 / 282 项单测通过，Windows 开发态与安装包态桌面集成测试通过。

安装包 SHA256 见下方 Release 资产。

- Windows：`Aria-0.7.0-x64.exe` — `5C3C7BD663852B5BE875A9F755EB58AE121D94B4DE47CF819CC21DD163A0D6AB`
- macOS Intel：`Aria-0.7.0-x64.dmg` — `BB7AB6F7D5898BD2430757EDD4285D03A75552E1E86F54F19B262B5BC999E121`
- macOS Apple Silicon：`Aria-0.7.0-arm64.dmg` — `3E3823DFA82956E9FBE4D5B6F73376CA4B8D311B558677BD2B4BC1D1E9B71A6C`
- Windows 自动更新：请同时保留 Release 中的 `latest.yml` 与 `Aria-0.7.0-x64.exe.blockmap`；后续版本发布时更新这两个文件即可。
- macOS 未签名版本暂不启用自动更新；首次打开需右键 → 打开，或执行 `xattr -dr com.apple.quarantine /Applications/Aria.app`。
