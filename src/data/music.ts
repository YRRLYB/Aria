import {
  BarChart3,
  Cloud,
  Compass,
  FolderSearch,
  Heart,
  History,
  Home,
  Music2,
  Radar,
} from "lucide-react";

export type LyricLine = {
  time: string;
  text: string;
  translation?: string;
};

export type Track = {
  id: string;
  providerId?: string;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string | null;
  duration: string;
  quality: "Hi-Res" | "FLAC" | "Lossless" | "320K";
  source: "local" | "cloud" | "netease";
  streamUrl?: string;
  coverUrl?: string;
  trackNumber?: number | null;
  discNumber?: number | null;
  bitrate?: number | null;
  sampleRate?: number | null;
  bpm?: number | null;
  libraryRoot?: string;
  mediaKind?: "file" | "audio-cd";
  nativeDevice?: string | null;
  nativeStart?: string | null;
  nativeEnd?: string | null;
  cdReadQuality?: "high" | "low";
  requiresNativePlayback?: boolean;
  likedAt?: number | null;
  currentLevel?: "standard" | "higher" | "exhigh" | "lossless" | "hires" | "jymaster" | null;
  availableLevels?: Array<"standard" | "higher" | "exhigh" | "lossless" | "hires" | "jymaster">;
  cover: string;
  accent: string;
  waveform: number[];
  lyrics: LyricLine[];
  lyricStatus: "linked" | "searchable" | "missing";
};

export type LyricCandidate = {
  id: string;
  source: "网易云" | "QQ音乐" | "酷狗";
  title: string;
  artist: string;
  album: string;
  coverUrl?: string | null;
  score: number;
  preview: string[];
};

export type ViewId =
  | "home"
  | "player"
  | "local"
  | "liked"
  | "history"
  | "playlists"
  | "artists"
  | "daily"
  | "radar"
  | "cloud"
  | "stats"
  | "settings";

export const navItems = [
  { id: "home" as const, label: "主页", icon: Home },
  { id: "player" as const, label: "现在播放", icon: Music2 },
  { id: "local" as const, label: "本地音乐", icon: FolderSearch },
  { id: "liked" as const, label: "我喜欢", icon: Heart },
  { id: "history" as const, label: "播放历史", icon: History },
  { id: "playlists" as const, label: "歌单", icon: Cloud },
  { id: "artists" as const, label: "歌手", icon: Music2 },
  { id: "daily" as const, label: "每日推荐", icon: Compass },
  { id: "radar" as const, label: "私人漫游", icon: Radar },
  { id: "cloud" as const, label: "音乐云盘", icon: Cloud },
  { id: "stats" as const, label: "听歌统计", icon: BarChart3 },
];

export const tracks: Track[] = [
  {
    id: "velvet",
    title: "Velvet Horizon",
    artist: "Astra Room",
    album: "Quiet Signals",
    duration: "04:18",
    quality: "Hi-Res",
    source: "local",
    cover: "linear-gradient(135deg, #ced8ee 0%, #5976b4 46%, #191d2b 100%)",
    accent: "#5976b4",
    waveform: [18, 46, 32, 72, 54, 88, 42, 66, 92, 58, 38, 76],
    lyricStatus: "linked",
    lyrics: [
      { time: "00:12", text: "把房间里的噪声慢慢调低" },
      { time: "00:28", text: "蓝色的边界落在唱针附近" },
      { time: "00:43", text: "每一次呼吸都像重新校准" },
      { time: "01:05", text: "让我在天亮之前停靠在你心里" },
      { time: "01:26", text: "Velvet horizon, carry me home" },
    ],
  },
  {
    id: "mirror",
    title: "Mirror Drive",
    artist: "Lin & The Satellites",
    album: "Chrome Sleep",
    duration: "03:42",
    quality: "FLAC",
    source: "netease",
    cover: "linear-gradient(135deg, #f2c8bd 0%, #b66e5f 48%, #26201e 100%)",
    accent: "#b66e5f",
    waveform: [42, 62, 88, 50, 34, 76, 95, 68, 48, 84, 56, 72],
    lyricStatus: "searchable",
    lyrics: [
      { time: "00:09", text: "车窗映出两条相反的路" },
      { time: "00:31", text: "霓虹在后视镜里慢慢变旧" },
      { time: "00:52", text: "如果回声知道出口在哪里" },
      { time: "01:18", text: "请替我把夜色开到尽头" },
    ],
  },
  {
    id: "orbit",
    title: "Low Orbit Cafe",
    artist: "Hana Field",
    album: "Soft Machines",
    duration: "05:06",
    quality: "Lossless",
    source: "cloud",
    cover: "linear-gradient(135deg, #c7eee7 0%, #4c9f8f 52%, #152826 100%)",
    accent: "#4c9f8f",
    waveform: [34, 54, 44, 82, 60, 72, 40, 90, 64, 48, 78, 52],
    lyricStatus: "linked",
    lyrics: [
      { time: "00:16", text: "低轨道咖啡还留着余温" },
      { time: "00:38", text: "云端的旧歌单轻轻翻身" },
      { time: "01:02", text: "你说收藏夹也会记得清晨" },
      { time: "01:24", text: "于是我把月光同步到云层" },
    ],
  },
  {
    id: "rain",
    title: "After Rain Session",
    artist: "Northline",
    album: "Room Tone",
    duration: "03:58",
    quality: "320K",
    source: "netease",
    cover: "linear-gradient(135deg, #dad4f1 0%, #7d7aa8 45%, #202436 100%)",
    accent: "#7d7aa8",
    waveform: [24, 38, 74, 56, 92, 62, 36, 78, 86, 44, 68, 58],
    lyricStatus: "missing",
    lyrics: [
      { time: "00:21", text: "雨后电台还在试音" },
      { time: "00:46", text: "潮湿的鼓点贴着玻璃" },
      { time: "01:10", text: "如果明天暂时没有回信" },
      { time: "01:35", text: "就把沉默留给这段间奏" },
    ],
  },
];

export const playlists = [
  { name: "红心备份", count: 382, tag: "自动保护灰歌" },
  { name: "深夜白噪", count: 79, tag: "本地 + 云盘" },
  { name: "Hi-Fi 试音", count: 46, tag: "FLAC / Hi-Res" },
];

export const lyricCandidates: LyricCandidate[] = [
  {
    id: "netease-rain",
    source: "网易云",
    title: "After Rain Session",
    artist: "Northline",
    album: "Room Tone",
    score: 96,
    preview: ["雨后电台还在试音", "潮湿的鼓点贴着玻璃", "如果明天暂时没有回信"],
  },
  {
    id: "qq-rain",
    source: "QQ音乐",
    title: "After Rain Session",
    artist: "Northline",
    album: "Room Tone Live",
    score: 88,
    preview: ["雨声落在合成器边缘", "你把回忆调成低频", "然后在间奏里停留"],
  },
  {
    id: "kugou-rain",
    source: "酷狗",
    title: "After Rain",
    artist: "Northline",
    album: "Room Tone",
    score: 81,
    preview: ["雨后房间逐渐安静", "旧唱片轻轻旋转", "电台开始试音"],
  },
];

export const capabilities = [
  { title: "Cookie 登录", desc: "读取账号信息、喜欢、收藏歌单与推荐内容。" },
  { title: "音质优先", desc: "为极高、无损、Hi-Res 链接预留选择策略。" },
  { title: "本地索引", desc: "选择文件夹后扫描音频元数据，未来支持局域网路径。" },
  { title: "云盘管理", desc: "批量上传、下载、同步私有音乐库。" },
];
