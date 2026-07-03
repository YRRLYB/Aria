import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  Cloud,
  Cookie,
  FolderOpen,
  Heart,
  Languages,
  ListMusic,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Repeat2,
  Search,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  UserRound,
  Volume2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  capabilities,
  lyricCandidates,
  navItems,
  playlists,
  tracks,
  type LyricCandidate,
  type Track,
  type ViewId,
} from "@/data/music";
import { api, type ApiScannedTrack, type NeteaseAccountSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

const sourceLabel: Record<Track["source"], string> = {
  local: "本地",
  cloud: "云盘",
  netease: "网易云",
};

const panelVariants = {
  initial: { opacity: 0, y: 18, filter: "blur(18px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -16, filter: "blur(16px)" },
};

const localCoverPalettes = [
  "linear-gradient(135deg, #d9e7f6 0%, #5e8ab8 48%, #182338 100%)",
  "linear-gradient(135deg, #f4d4ce 0%, #c6796d 50%, #241a1a 100%)",
  "linear-gradient(135deg, #d7f1e5 0%, #5aa894 50%, #172823 100%)",
  "linear-gradient(135deg, #e4ddf5 0%, #8680b4 50%, #202036 100%)",
];

function formatDuration(seconds: number | null) {
  if (!seconds || Number.isNaN(seconds)) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function normalizeQuality(quality: string): Track["quality"] {
  if (quality === "Hi-Res" || quality === "FLAC" || quality === "Lossless" || quality === "320K") {
    return quality;
  }
  return "320K";
}

function localTrackToUiTrack(track: ApiScannedTrack, index: number): Track {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: formatDuration(track.duration),
    quality: normalizeQuality(track.quality),
    source: "local",
    streamUrl: api.getTrackStreamUrl(track.id),
    cover: localCoverPalettes[index % localCoverPalettes.length],
    accent: ["#5e8ab8", "#c6796d", "#5aa894", "#8680b4"][index % 4],
    waveform: [28, 42, 64, 38, 72, 54, 46, 82, 58, 36, 68, 48],
    lyricStatus: "searchable",
    lyrics: [
      { time: "00:00", text: "本地歌词等待匹配" },
      { time: "00:15", text: "可以在本地音乐页联网搜词后绑定" },
      { time: "00:30", text: "绑定后会保存到本地索引" },
    ],
  };
}

export default function App() {
  const [activeView, setActiveView] = useState<ViewId>("home");
  const [activeTrackId, setActiveTrackId] = useState(tracks[0].id);
  const [playing, setPlaying] = useState(true);
  const [localTracks, setLocalTracks] = useState<Track[]>([]);
  const [libraryMeta, setLibraryMeta] = useState({ roots: 0, updatedAt: null as string | null });
  const [navOpen, setNavOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [neteaseConnected, setNeteaseConnected] = useState(false);
  const [query, setQuery] = useState("");
  const [folderName, setFolderName] = useState("未选择");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const navCloseTimer = useRef<number | null>(null);

  const allTracks = useMemo(() => [...localTracks, ...tracks], [localTracks]);
  const activeTrack = allTracks.find((track) => track.id === activeTrackId) ?? allTracks[0] ?? tracks[0];
  const visibleTracks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return allTracks;

    return allTracks.filter((track) =>
      [track.title, track.artist, track.album, track.quality, sourceLabel[track.source]]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [allTracks, query]);
  const visibleLocalTracks = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return localTracks;

    return localTracks.filter((track) =>
      [track.title, track.artist, track.album, track.quality].join(" ").toLowerCase().includes(normalized),
    );
  }, [localTracks, query]);

  useEffect(() => {
    api
      .getLibrary()
      .then((library) => {
        setLocalTracks(library.tracks.map(localTrackToUiTrack));
        setLibraryMeta({ roots: library.roots.length, updatedAt: library.updatedAt });
      })
      .catch(() => {
        setLibraryMeta({ roots: 0, updatedAt: null });
      });
  }, []);

  useEffect(() => {
    api
      .getSettings()
      .then((settings) => setNeteaseConnected(settings.neteaseAccount.connected))
      .catch(() => setNeteaseConnected(false));
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!activeTrack.streamUrl) {
      audio.pause();
      return;
    }

    if (audio.src !== new URL(activeTrack.streamUrl, window.location.href).href) {
      audio.src = activeTrack.streamUrl;
    }

    if (playing) {
      audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, [activeTrack, playing]);

  async function scanBackendPath(folderPath: string) {
    const result = await api.scanLibrary(folderPath);
    const nextTracks = result.library?.tracks ?? result.tracks;
    setLocalTracks(nextTracks.map(localTrackToUiTrack));
    setLibraryMeta({
      roots: result.library?.roots.length ?? 1,
      updatedAt: result.library?.updatedAt ?? new Date().toISOString(),
    });
    if (nextTracks[0]) setActiveTrackId(nextTracks[0].id);
    setActiveView("local");
  }

  function pickRelativeTrack(direction: 1 | -1) {
    if (!visibleTracks.length) return;
    const currentIndex = visibleTracks.findIndex((track) => track.id === activeTrack.id);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (safeIndex + direction + visibleTracks.length) % visibleTracks.length;
    setActiveTrackId(visibleTracks[nextIndex].id);
    setPlaying(true);
  }

  function chooseTrack(trackId: string) {
    setActiveTrackId(trackId);
    setPlaying(true);
  }

  return (
    <main className="relative h-screen overflow-hidden bg-[#f5f6f8] p-3 text-neutral-950 sm:p-4">
      <audio ref={audioRef} onEnded={() => pickRelativeTrack(1)} />
      <div className="noise" />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        // @ts-expect-error Chromium directory picker support.
        webkitdirectory=""
        onChange={(event) => {
          const file = event.target.files?.[0];
          const path = file?.webkitRelativePath || file?.name || "";
          setFolderName(path.split("/")[0] || "已选择");
          setActiveView("local");
        }}
      />

      <div className="app-shell relative z-10 mx-auto flex h-full w-full max-w-[1500px] flex-col overflow-hidden rounded-[2rem] border border-white/75 bg-white/58 shadow-[0_24px_90px_rgba(47,55,76,0.16)] backdrop-blur-3xl">
        <header className="flex h-18 shrink-0 items-center justify-between gap-3 border-b border-white/70 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex gap-2">
              <span className="size-3 rounded-full bg-[#ff5f57]" />
              <span className="size-3 rounded-full bg-[#ffbd2e]" />
              <span className="size-3 rounded-full bg-[#28c840]" />
            </div>
            <button
              className="hidden min-w-0 rounded-full px-3 py-2 text-left transition hover:bg-white/65 sm:block"
              onClick={() => setActiveView("home")}
            >
              <p className="truncate text-sm font-semibold">Musicbox</p>
              <p className="truncate text-xs text-neutral-500">本地与网易云统一音乐库</p>
            </button>
          </div>

          <nav className="hidden rounded-full border border-white/70 bg-white/45 p-1 shadow-sm backdrop-blur-xl xl:flex">
            {navItems.slice(0, 5).map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;

              return (
                <button
                  key={item.id}
                  className={cn(
                    "flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium text-neutral-500 transition hover:text-neutral-950",
                    active && "bg-white text-neutral-950 shadow-sm",
                  )}
                  onClick={() => setActiveView(item.id)}
                >
                  <Icon className="size-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-white/70 bg-white/58 px-3 py-2 shadow-sm sm:max-w-lg">
            <Search className="size-4 shrink-0 text-neutral-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索音乐、歌手、专辑"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
            />
            <Button variant="ghost" size="icon" aria-label="筛选">
              <Settings2 />
            </Button>
          </div>

          <div className="relative">
            <Button
              variant="glass"
              size="icon"
              aria-label="账号与设置"
              onClick={() => setAccountOpen((value) => !value)}
            >
              <UserRound />
            </Button>
            <span
              className={cn(
                "absolute right-0 top-0 size-2.5 rounded-full ring-2 ring-white",
                neteaseConnected ? "bg-[#28c840]" : "bg-neutral-300",
              )}
            />
            <AnimatePresence>
              {accountOpen && (
                <AccountPanel
                  onClose={() => setAccountOpen(false)}
                  onAccountChange={(account) => setNeteaseConnected(account.connected)}
                />
              )}
            </AnimatePresence>
          </div>
        </header>

        <section className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              variants={panelVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
              className="min-h-0 min-w-0"
            >
              {activeView === "home" && (
                <HomeSurface
                  activeTrack={activeTrack}
                  playing={playing}
                  onTogglePlay={() => setPlaying((value) => !value)}
                  onPickTrack={chooseTrack}
                  onOpenPlayer={() => setActiveView("player")}
                />
              )}
              {activeView === "player" && (
                <PlayerSurface
                  activeTrack={activeTrack}
                  playing={playing}
                  onTogglePlay={() => setPlaying((value) => !value)}
                  onNext={() => pickRelativeTrack(1)}
                  onPrevious={() => pickRelativeTrack(-1)}
                  onPickTrack={chooseTrack}
                />
              )}
              {activeView === "local" && (
                <LibrarySurface
                  folderName={folderName}
                  onChooseFolder={() => fileInputRef.current?.click()}
                  tracks={visibleLocalTracks}
                  localTrackCount={localTracks.length}
                  libraryMeta={libraryMeta}
                  activeTrackId={activeTrackId}
                  onPickTrack={chooseTrack}
                  onScanPath={scanBackendPath}
                />
              )}
              {activeView === "liked" && (
                <LikedSurface onPickTrack={chooseTrack} />
              )}
              {activeView === "playlists" && (
                <PlaylistSurface onPickTrack={chooseTrack} />
              )}
              {activeView === "daily" && (
                <CollectionSurface
                  title="每日推荐"
                  subtitle="30 首"
                  icon={<Sparkles className="size-5" />}
                  tracks={[tracks[1], tracks[3], tracks[0]]}
                  onPickTrack={chooseTrack}
                />
              )}
              {activeView === "radar" && (
                <CollectionSurface
                  title="私人雷达"
                  subtitle="基于最近偏好"
                  icon={<Radio className="size-5" />}
                  tracks={[tracks[2], tracks[0], tracks[3]]}
                  onPickTrack={chooseTrack}
                />
              )}
              {activeView === "cloud" && <CloudSurface />}
              {activeView === "stats" && <StatsSurface />}
            </motion.div>
          </AnimatePresence>

          <aside className="glass hidden min-h-0 flex-col rounded-[1.5rem] p-4 lg:flex">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.24em] text-neutral-400">
                  Queue
                </p>
                <h2 className="mt-1 text-xl font-semibold">下一首</h2>
              </div>
              <Button variant="ghost" size="icon" aria-label="展开队列">
                <ListMusic />
              </Button>
            </div>

            <div className="no-scrollbar relative mt-4 flex-1 space-y-2 overflow-y-auto">
              {visibleTracks.map((track) => (
                <button
                  key={track.id}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-3xl p-2 text-left transition hover:bg-white/65",
                    activeTrackId === track.id && "bg-white shadow-sm",
                  )}
                  onClick={() => {
                    chooseTrack(track.id);
                  }}
                >
                  <CoverArt track={track} className="size-14 rounded-2xl" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{track.title}</p>
                    <p className="truncate text-xs text-neutral-500">{track.artist}</p>
                  </div>
                  <Badge className="shrink-0">{track.quality}</Badge>
                </button>
              ))}
              <div className="pointer-events-none sticky bottom-0 h-10 bg-gradient-to-t from-white/70 to-transparent" />
            </div>

            <div className="mt-4 overflow-hidden rounded-[1.25rem] border border-white/70 bg-white/55 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-[0.22em] text-neutral-400">
                    Library
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold">本地与云端状态</p>
                </div>
                <Badge>Ready</Badge>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-neutral-500">
                <Metric value={String(allTracks.length)} label="曲目" />
                <Metric value={String(allTracks.filter((track) => track.lyricStatus === "linked").length)} label="歌词" />
                <Metric value={String(allTracks.filter((track) => track.quality !== "320K").length)} label="无损" />
              </div>

              <div className="mt-4 rounded-2xl bg-white/56 p-3">
                <div className="flex items-center justify-between text-xs text-neutral-500">
                  <span>歌词匹配</span>
                  <span>50%</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-950/8">
                  <div className="h-full w-1/2 rounded-full bg-neutral-950/55" />
                </div>
              </div>
            </div>
          </aside>
        </section>

        <FloatingNav
          activeView={activeView}
          open={navOpen}
          onOpenChange={(nextOpen) => {
            if (navCloseTimer.current) {
              window.clearTimeout(navCloseTimer.current);
              navCloseTimer.current = null;
            }
            setNavOpen(nextOpen);
          }}
          onRequestClose={() => {
            if (navCloseTimer.current) {
              window.clearTimeout(navCloseTimer.current);
            }
            navCloseTimer.current = window.setTimeout(() => {
              setNavOpen(false);
              navCloseTimer.current = null;
            }, 180);
          }}
          onPick={(id) => {
            setActiveView(id);
            setNavOpen(false);
          }}
        />
      </div>
    </main>
  );
}

function HomeSurface({
  activeTrack,
  playing,
  onTogglePlay,
  onPickTrack,
  onOpenPlayer,
}: {
  activeTrack: Track;
  playing: boolean;
  onTogglePlay: () => void;
  onPickTrack: (id: string) => void;
  onOpenPlayer: () => void;
}) {
  return (
    <div className="no-scrollbar flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <section className="glass grid min-h-[340px] overflow-hidden rounded-[1.5rem] lg:grid-cols-[1.1fr_0.9fr]">
        <div className="p-5 sm:p-7">
          <Badge>Home</Badge>
          <h1 className="mt-5 max-w-2xl text-4xl font-semibold leading-tight sm:text-6xl">
            今天想听点什么
          </h1>
          <p className="mt-3 max-w-xl text-neutral-500">
            把本地音乐、网易云喜欢、每日推荐和云盘放在同一个主页里。
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <StatTile label="今日播放" value="42" />
            <StatTile label="无损曲库" value="1.2k" />
            <StatTile label="红心同步" value="382" />
          </div>
        </div>
        <button
          className="relative m-4 min-h-72 overflow-hidden rounded-[1.35rem] p-5 text-left shadow-sm"
          style={{ background: activeTrack.cover }}
          onClick={onOpenPlayer}
        >
          <div className="absolute inset-0 bg-black/12" />
          <div className="relative flex h-full flex-col justify-between">
            <div className="flex justify-end">
              <Button size="icon" aria-label={playing ? "暂停" : "播放"} onClick={(event) => {
                event.stopPropagation();
                onTogglePlay();
              }}>
                {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
              </Button>
            </div>
            <div>
              <p className="text-sm text-white/75">正在播放</p>
              <h2 className="mt-2 text-3xl font-semibold text-white">{activeTrack.title}</h2>
              <p className="mt-1 text-white/75">{activeTrack.artist}</p>
            </div>
          </div>
        </button>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="glass rounded-[1.5rem] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">听歌排行</h2>
            <Badge>周榜</Badge>
          </div>
          <div className="mt-4 grid gap-2">
            {tracks.map((track, index) => (
              <button
                key={track.id}
                className="grid grid-cols-[2rem_3rem_1fr_auto] items-center gap-3 rounded-[1.1rem] p-2 text-left transition hover:bg-white/65"
                onClick={() => onPickTrack(track.id)}
              >
                <span className="text-center text-sm font-semibold text-neutral-400">{index + 1}</span>
                <CoverArt track={track} className="size-12 rounded-xl" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{track.title}</p>
                  <p className="truncate text-xs text-neutral-500">{track.artist}</p>
                </div>
                <span className="text-sm text-neutral-500">{track.duration}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="glass rounded-[1.5rem] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">每日混合</h2>
            <Badge>Radar</Badge>
          </div>
          <div className="mt-4 grid gap-3">
            {[tracks[2], tracks[1], tracks[3]].map((track, index) => (
              <button
                key={track.id}
                className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-3 rounded-[1.2rem] bg-white/52 p-3 text-left shadow-sm transition hover:bg-white"
                onClick={() => onPickTrack(track.id)}
              >
                <CoverArt track={track} className="size-14 rounded-2xl" />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{track.title}</p>
                  <p className="truncate text-xs text-neutral-500">
                    {index === 0 ? "私人雷达" : index === 1 ? "每日推荐" : "相似单曲"}
                  </p>
                </div>
                <Badge>{track.quality}</Badge>
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-[1.2rem] bg-neutral-950 p-4 text-white shadow-sm">
            <p className="text-xs uppercase tracking-[0.24em] text-white/45">Today</p>
            <p className="mt-2 text-2xl font-semibold">30</p>
            <p className="mt-1 text-sm text-white/58">首新鲜推荐等待同步</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.15rem] bg-white/58 p-4 shadow-sm">
      <p className="text-sm text-neutral-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
    </div>
  );
}

function PlayerSurface({
  activeTrack,
  playing,
  onTogglePlay,
  onNext,
  onPrevious,
  onPickTrack,
}: {
  activeTrack: Track;
  playing: boolean;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onPickTrack: (id: string) => void;
}) {
  const [lyricsFocus, setLyricsFocus] = useState(false);

  return (
    <div
      className="glass relative h-full min-h-[620px] overflow-hidden rounded-[1.5rem]"
      style={{ ["--track-accent" as string]: activeTrack.accent }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background: `radial-gradient(circle at 28% 32%, ${activeTrack.accent}38, transparent 24rem), radial-gradient(circle at 82% 78%, ${activeTrack.accent}24, transparent 18rem)`,
        }}
      />
      <div className="relative grid h-full min-h-[620px] lg:grid-cols-[0.95fr_1.05fr]">
        <div
          className="relative flex min-h-[420px] items-center justify-center overflow-hidden p-5 sm:p-7"
          style={{
            background: `linear-gradient(145deg, ${activeTrack.accent}33, rgba(255,255,255,0.48))`,
          }}
        >
          <div
            className="absolute inset-0 opacity-18 blur-3xl scale-110"
            style={{ background: activeTrack.cover }}
          />
          <div className={cn("player-orbit", playing && "is-playing")} />
          <div className={cn("player-glow", playing && "is-playing")} />
          <motion.div
            key={activeTrack.id}
            initial={{ opacity: 0, scale: 0.96, filter: "blur(18px)" }}
            animate={{
              opacity: lyricsFocus ? 0.58 : 1,
              scale: lyricsFocus ? 0.58 : 1,
              x: lyricsFocus ? "-28%" : "0%",
              y: lyricsFocus ? "26%" : "0%",
              filter: "blur(0px)",
            }}
            transition={{ duration: 0.42 }}
            className="album-breathe relative z-10 aspect-square w-[min(100%,calc(100vh-13rem))] max-w-[520px] rounded-[1.5rem] shadow-[0_28px_80px_rgba(20,24,35,0.22)]"
          >
            <CoverArt track={activeTrack} className="size-full rounded-[1.5rem]" large />
          </motion.div>
          <AnimatePresence>
            {lyricsFocus && (
              <motion.div
                initial={{ opacity: 0, x: 80, filter: "blur(16px)" }}
                animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, x: 60, filter: "blur(16px)" }}
                transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0 z-20 flex flex-col justify-start bg-gradient-to-r from-white/18 via-white/36 to-white/58 p-7 pt-10 backdrop-blur-sm"
              >
                <p className="mb-4 text-xs font-medium uppercase tracking-[0.28em] text-white/70">
                  Lyrics
                </p>
                <div className="no-scrollbar max-h-[82%] max-w-[26rem] space-y-3 overflow-y-auto">
                  {activeTrack.lyrics.slice(0, 5).map((line, index) => (
                    <p
                      key={`${line.time}-${line.text}-hero`}
                      className={cn(
                        "leading-tight drop-shadow-sm",
                        index === 1
                          ? "text-4xl font-semibold text-white sm:text-[3rem]"
                          : "text-2xl font-semibold text-white/64 sm:text-[1.9rem]",
                      )}
                    >
                      {line.text}
                    </p>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex flex-col justify-between p-5 sm:p-8">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{sourceLabel[activeTrack.source]}</Badge>
              <Badge>{activeTrack.quality}</Badge>
              <Badge>{activeTrack.duration}</Badge>
            </div>
            <h1 className="mt-8 max-w-xl text-5xl font-semibold leading-[1.02] text-neutral-950 sm:text-7xl">
              {activeTrack.title}
            </h1>
            <p className="mt-4 text-xl text-neutral-500">{activeTrack.artist}</p>
            <p className="mt-1 text-sm text-neutral-400">{activeTrack.album}</p>
          </div>

          <div className="mt-10">
            <div
              className="relative flex h-32 items-end gap-2 overflow-hidden rounded-[1.25rem] bg-white/58 p-4 shadow-sm"
              style={{
                boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.65), 0 18px 55px ${activeTrack.accent}18`,
              }}
            >
              <div className="absolute inset-x-4 top-4 h-px bg-gradient-to-r from-transparent via-neutral-950/10 to-transparent" />
              {activeTrack.waveform.map((height, index) => (
                <motion.div
                  key={`${activeTrack.id}-${index}`}
                  initial={{ height: 8 }}
                  animate={{ height: playing ? [`${height * 0.48}%`, `${height}%`, `${height * 0.64}%`] : `${height * 0.45}%` }}
                  transition={{
                    delay: index * 0.025,
                    duration: playing ? 1.1 + index * 0.035 : 0.35,
                    repeat: playing ? Infinity : 0,
                    repeatType: "mirror",
                    ease: "easeInOut",
                  }}
                  className="relative z-10 min-w-2 flex-1 rounded-full"
                  style={{ backgroundColor: activeTrack.accent }}
                />
              ))}
            </div>

            <div className="mt-6 flex flex-col gap-4 rounded-[1.25rem] bg-white/58 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center justify-center gap-2">
                <Button variant="ghost" size="icon" aria-label="随机播放">
                  <Shuffle />
                </Button>
                <Button variant="ghost" size="icon" aria-label="上一首" onClick={onPrevious}>
                  <SkipBack />
                </Button>
                <Button size="iconLg" aria-label={playing ? "暂停" : "播放"} onClick={onTogglePlay}>
                  {playing ? <Pause className="size-6 fill-current" /> : <Play className="size-6 fill-current" />}
                </Button>
                <Button variant="ghost" size="icon" aria-label="下一首" onClick={onNext}>
                  <SkipForward />
                </Button>
                <Button variant="ghost" size="icon" aria-label="循环播放">
                  <Repeat2 />
                </Button>
              </div>
              <div className="flex min-w-0 items-center gap-3 px-1">
                <Volume2 className="size-4 text-neutral-500" />
                <input
                  aria-label="音量"
                  type="range"
                  min="0"
                  max="100"
                  defaultValue="72"
                  className="h-1 w-full min-w-32 accent-neutral-950"
                />
              </div>
            </div>
          </div>

          <LyricsPanel
            track={activeTrack}
            focused={lyricsFocus}
            onToggleFocus={() => setLyricsFocus((value) => !value)}
          />
        </div>
      </div>
    </div>
  );
}

function LyricsPanel({
  track,
  focused,
  onToggleFocus,
}: {
  track: Track;
  focused: boolean;
  onToggleFocus: () => void;
}) {
  const statusText = {
    linked: "已匹配",
    searchable: "可联网搜索",
    missing: "未绑定",
  }[track.lyricStatus];

  return (
    <section className="mt-6 rounded-[1.25rem] bg-white/58 p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-neutral-400">
            Lyrics
          </p>
          <h2 className="mt-1 text-lg font-semibold">歌词</h2>
        </div>
        <Button variant={focused ? "default" : "ghost"} size="sm" onClick={onToggleFocus}>
          <Languages />
          {focused ? "封面模式" : "大字模式"}
        </Button>
      </div>
      <div className="no-scrollbar mt-4 max-h-[28rem] overflow-y-auto pr-1">
        {track.lyrics.map((line, index) => (
          <div
            key={`${line.time}-${line.text}`}
            className={cn(
              "grid grid-cols-[3.2rem_1fr] gap-3 border-b border-neutral-950/6 px-2 py-2 transition last:border-b-0",
              index === 1
                ? "rounded-2xl border-b-0 bg-white px-4 py-3 text-xl font-semibold text-neutral-950 shadow-sm"
                : "text-[0.95rem] text-neutral-500",
            )}
          >
            <span className="font-medium text-neutral-400">{line.time}</span>
            <span className="leading-7">{line.text}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-neutral-400">{statusText}</p>
    </section>
  );
}

function LibrarySurface({
  folderName,
  onChooseFolder,
  tracks: libraryTracks,
  localTrackCount,
  libraryMeta,
  activeTrackId,
  onPickTrack,
  onScanPath,
}: {
  folderName: string;
  onChooseFolder: () => void;
  tracks: Track[];
  localTrackCount: number;
  libraryMeta: { roots: number; updatedAt: string | null };
  activeTrackId: string;
  onPickTrack: (id: string) => void;
  onScanPath: (folderPath: string) => Promise<void>;
}) {
  const [lookupOpen, setLookupOpen] = useState(false);
  const [boundCandidateId, setBoundCandidateId] = useState<string | null>(null);
  const [scanPath, setScanPath] = useState("");
  const [scanState, setScanState] = useState<"idle" | "scanning" | "error">("idle");
  const candidateTarget =
    libraryTracks.find((track) => track.lyricStatus !== "linked") ?? libraryTracks[0];

  async function submitScanPath() {
    if (!scanPath.trim()) return;
    setScanState("scanning");
    try {
      await onScanPath(scanPath.trim());
      setScanState("idle");
    } catch {
      setScanState("error");
    }
  }

  return (
    <div className="glass h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge>Folder</Badge>
          <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">本地音乐</h1>
          <p className="mt-3 text-neutral-500">{folderName}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="glass" onClick={() => setLookupOpen((value) => !value)}>
            {lookupOpen ? <X /> : <Languages />}
            {lookupOpen ? "收起搜词" : "联网搜词"}
          </Button>
          <Button onClick={onChooseFolder}>
            <FolderOpen />
            选择文件夹
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-3">
        <LyricLookupCard label="索引曲目" value={`${localTrackCount} 首本地音乐`} />
        <LyricLookupCard label="目录数量" value={`${libraryMeta.roots} 个目录`} />
        <LyricLookupCard
          label="更新时间"
          value={libraryMeta.updatedAt ? new Date(libraryMeta.updatedAt).toLocaleString() : "尚未扫描"}
        />
      </div>

      <div className="mt-5 rounded-[1.25rem] bg-white/52 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-400">
              Backend Scan
            </p>
            <input
              value={scanPath}
              onChange={(event) => setScanPath(event.target.value)}
              placeholder="输入本机音乐目录路径，例如 E:\\Music"
              className="mt-2 w-full rounded-full border border-white/70 bg-white/70 px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-300"
            />
          </div>
          <Button onClick={submitScanPath} disabled={scanState === "scanning"}>
            <RefreshCw className={cn(scanState === "scanning" && "animate-spin")} />
            {scanState === "scanning" ? "扫描中" : "扫描目录"}
          </Button>
        </div>
        {scanState === "error" && (
          <p className="mt-3 text-sm text-neutral-500">扫描失败，请确认路径存在且后端服务正在运行。</p>
        )}
      </div>

      <AnimatePresence initial={false}>
        {lookupOpen && candidateTarget && (
          <LyricLookupPanel
            track={candidateTarget}
            boundCandidateId={boundCandidateId}
            onBind={setBoundCandidateId}
          />
        )}
      </AnimatePresence>

      <div className="mt-8 grid gap-3">
        {libraryTracks.map((track, index) => (
          <button
            key={track.id}
            className={cn(
              "grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 rounded-[1.5rem] bg-white/45 p-3 text-left transition hover:bg-white/75",
              activeTrackId === track.id && "bg-white shadow-sm",
            )}
            onClick={() => onPickTrack(track.id)}
          >
            <span className="text-center text-sm font-medium text-neutral-400">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold">{track.title}</p>
              <p className="truncate text-sm text-neutral-500">
                {track.artist} · {track.album}
              </p>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <Badge>{track.lyricStatus === "linked" ? "有歌词" : "待匹配"}</Badge>
              <Badge>{track.quality}</Badge>
              <span className="w-12 text-right text-sm text-neutral-500">{track.duration}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function LyricLookupCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.15rem] bg-white/52 p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-400">{label}</p>
      <p className="mt-2 text-sm font-semibold text-neutral-700">{value}</p>
    </div>
  );
}

function LyricLookupPanel({
  track,
  boundCandidateId,
  onBind,
}: {
  track: Track;
  boundCandidateId: string | null;
  onBind: (id: string) => void;
}) {
  const [candidates, setCandidates] = useState<LyricCandidate[]>(lyricCandidates);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchLyrics() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.searchLyrics({
        title: track.title,
        artist: track.artist,
        album: track.album,
      });
      setCandidates(result.candidates);
    } catch {
      setCandidates(lyricCandidates);
      setError("后端未连接，正在显示本地候选");
    } finally {
      setLoading(false);
    }
  }

  async function bindLyric(candidateId: string) {
    onBind(candidateId);
    try {
      await api.bindLyric(track.id, candidateId);
    } catch {
      setError("绑定已在前端模拟，后端保存失败");
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: -10, filter: "blur(12px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -8, filter: "blur(10px)" }}
      transition={{ duration: 0.26 }}
      className="mt-5 rounded-[1.35rem] border border-white/70 bg-white/50 p-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-neutral-400">
            Online Lyrics
          </p>
          <h2 className="mt-1 truncate text-xl font-semibold">{track.title}</h2>
          <p className="truncate text-sm text-neutral-500">
            {track.artist} · {track.album}
          </p>
        </div>
        <Button variant="subtle" size="sm" onClick={searchLyrics} disabled={loading}>
          <RefreshCw className={cn(loading && "animate-spin")} />
          {loading ? "搜索中" : "重新搜索"}
        </Button>
      </div>
      {error && <p className="mt-3 text-xs text-neutral-500">{error}</p>}

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {candidates.map((candidate) => (
          <LyricCandidateCard
            key={candidate.id}
            candidate={candidate}
            selected={boundCandidateId === candidate.id}
            onBind={() => bindLyric(candidate.id)}
          />
        ))}
      </div>
    </motion.section>
  );
}

function LyricCandidateCard({
  candidate,
  selected,
  onBind,
}: {
  candidate: LyricCandidate;
  selected: boolean;
  onBind: () => void;
}) {
  return (
    <article
      className={cn(
        "rounded-[1.15rem] bg-white/62 p-4 shadow-sm transition",
        selected && "bg-neutral-950 text-white",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Badge className={cn(selected && "border-white/20 bg-white/12 text-white")}>
            {candidate.source}
          </Badge>
          <h3 className="mt-3 truncate font-semibold">{candidate.title}</h3>
          <p className={cn("truncate text-xs", selected ? "text-white/64" : "text-neutral-500")}>
            {candidate.artist} · {candidate.album}
          </p>
        </div>
        <span className={cn("text-2xl font-semibold", selected ? "text-white" : "text-neutral-950")}>
          {candidate.score}
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {candidate.preview.map((line) => (
          <p
            key={line}
            className={cn(
              "truncate text-sm",
              selected ? "text-white/72" : "text-neutral-600",
            )}
          >
            {line}
          </p>
        ))}
      </div>
      <Button
        className="mt-4 w-full"
        variant={selected ? "subtle" : "default"}
        size="sm"
        onClick={onBind}
      >
        <Languages />
        {selected ? "已绑定" : "绑定歌词"}
      </Button>
    </article>
  );
}

function CollectionSurface({
  title,
  subtitle,
  icon,
  tracks: collectionTracks,
  onPickTrack,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  tracks: Track[];
  onPickTrack: (id: string) => void;
}) {
  return (
    <div className="glass h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
      <div className="flex items-center gap-4">
        <div className="flex size-14 items-center justify-center rounded-full bg-white shadow-sm">
          {icon}
        </div>
        <div>
          <p className="text-neutral-500">{subtitle}</p>
          <h1 className="text-4xl font-semibold sm:text-6xl">{title}</h1>
        </div>
      </div>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {collectionTracks.map((track) => (
          <button
            key={track.id}
            className="group overflow-hidden rounded-[1.75rem] bg-white/54 p-3 text-left shadow-sm transition hover:-translate-y-1 hover:bg-white"
            onClick={() => onPickTrack(track.id)}
          >
            <CoverArt track={track} className="aspect-square w-full rounded-[1.35rem]" />
            <div className="p-2">
              <p className="truncate font-semibold">{track.title}</p>
              <p className="truncate text-sm text-neutral-500">{track.artist}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function LikedSurface({ onPickTrack }: { onPickTrack: (id: string) => void }) {
  const localLiked = tracks.filter((track) => track.source === "local" || track.source === "cloud");
  const neteaseLiked = tracks.filter((track) => track.source === "netease");

  return (
    <div className="glass h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge>Favorite</Badge>
          <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">我喜欢</h1>
          <p className="mt-3 text-neutral-500">本地红心和网易云红心分开放，后面同步时不会混乱。</p>
        </div>
        <Button variant="glass">
          <Heart className="fill-current" />
          同步红心
        </Button>
      </div>

      <div className="mt-8 grid gap-5 xl:grid-cols-2">
        <LikedColumn title="本地我喜欢" subtitle="来自本地库与云盘" tracks={localLiked} onPickTrack={onPickTrack} />
        <LikedColumn title="网易云我喜欢" subtitle="Cookie 登录后读取" tracks={neteaseLiked} onPickTrack={onPickTrack} />
      </div>
    </div>
  );
}

function LikedColumn({
  title,
  subtitle,
  tracks: likedTracks,
  onPickTrack,
}: {
  title: string;
  subtitle: string;
  tracks: Track[];
  onPickTrack: (id: string) => void;
}) {
  return (
    <section className="rounded-[1.25rem] bg-white/52 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
        </div>
        <Badge>{likedTracks.length} 首</Badge>
      </div>
      <div className="mt-4 grid gap-2">
        {likedTracks.map((track) => (
          <button
            key={track.id}
            className="flex items-center gap-3 rounded-[1rem] p-2 text-left transition hover:bg-white/75"
            onClick={() => onPickTrack(track.id)}
          >
            <CoverArt track={track} className="size-12 rounded-xl" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{track.title}</p>
              <p className="truncate text-xs text-neutral-500">{track.artist}</p>
            </div>
            <Heart className="size-4 fill-neutral-950" />
          </button>
        ))}
      </div>
    </section>
  );
}

function PlaylistSurface({ onPickTrack }: { onPickTrack: (id: string) => void }) {
  return (
    <div className="glass h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Badge>Playlist</Badge>
          <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">歌单</h1>
        </div>
        <Button>
          <Plus />
          新建
        </Button>
      </div>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {playlists.map((playlist, index) => (
          <button
            key={playlist.name}
            className="min-h-48 rounded-[1.75rem] bg-white/52 p-5 text-left shadow-sm transition hover:-translate-y-1 hover:bg-white"
            onClick={() => onPickTrack(tracks[index % tracks.length].id)}
          >
            <Cloud className="size-6 text-neutral-500" />
            <h2 className="mt-8 text-2xl font-semibold">{playlist.name}</h2>
            <p className="mt-2 text-sm text-neutral-500">{playlist.count} 首</p>
            <Badge className="mt-5">{playlist.tag}</Badge>
          </button>
        ))}
      </div>
    </div>
  );
}

function CloudSurface() {
  return (
    <div className="glass h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
      <Badge>Cloud</Badge>
      <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">音乐云盘</h1>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        {capabilities.map((item) => (
          <div key={item.title} className="rounded-[1.75rem] bg-white/54 p-5 shadow-sm">
            <h2 className="text-xl font-semibold">{item.title}</h2>
            <p className="mt-3 text-sm leading-6 text-neutral-500">{item.desc}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button>
          <Cloud />
          上传
        </Button>
        <Button variant="glass">
          <ChevronDown />
          下载
        </Button>
      </div>
    </div>
  );
}

function StatsSurface() {
  const rows = [
    ["周榜", "126", "Mirror Drive"],
    ["总榜", "4,982", "Velvet Horizon"],
    ["历史", "18,742", "Low Orbit Cafe"],
  ];

  return (
    <div className="glass h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
      <Badge>Stats</Badge>
      <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">听歌统计</h1>
      <div className="mt-10 grid gap-3">
        {rows.map(([label, count, top]) => (
          <div
            key={label}
            className="grid grid-cols-[5rem_1fr] gap-4 rounded-[1.75rem] bg-white/54 p-5 shadow-sm sm:grid-cols-[7rem_1fr_auto]"
          >
            <p className="font-semibold">{label}</p>
            <p className="text-neutral-500">{top}</p>
            <p className="text-3xl font-semibold">{count}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function FloatingNav({
  activeView,
  open,
  onOpenChange,
  onRequestClose,
  onPick,
}: {
  activeView: ViewId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequestClose: () => void;
  onPick: (id: ViewId) => void;
}) {
  const nodes = navItems.slice(5);
  const nodePositions = [
    { x: 74, y: 36 },
    { x: 142, y: 48 },
    { x: 172, y: 112 },
    { x: 102, y: 162 },
  ];
  const center = { x: 42, y: 178 };

  return (
    <div
      className="absolute bottom-9 left-7 z-40 h-[240px] w-[260px]"
      onMouseEnter={() => onOpenChange(true)}
      onMouseLeave={onRequestClose}
    >
      <button
        className="absolute z-30 flex size-16 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-950 shadow-[0_18px_50px_rgba(47,55,76,0.16)]"
        style={{ left: center.x - 32, top: center.y - 32 }}
        aria-label="副导航"
        onClick={() => onOpenChange(!open)}
      >
        <div
          className={cn(
            "grid size-7 grid-cols-2 gap-1 transition duration-200",
            open && "rotate-45 scale-[0.85]",
          )}
        >
          {[0, 1, 2, 3].map((dot) => (
            <span key={dot} className="rounded-full bg-neutral-950" />
          ))}
        </div>
      </button>

      <svg
        className={cn(
          "pointer-events-none absolute inset-0 h-full w-full overflow-visible transition duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
        aria-hidden="true"
      >
        {nodePositions.map((pos, index) => {
          const midX = (center.x + pos.x) / 2;
          const midY = (center.y + pos.y) / 2;
          const wave = index % 2 === 0 ? 14 : -14;
          const path = `M ${center.x} ${center.y} Q ${midX + wave} ${midY - 10} ${pos.x} ${pos.y}`;

          return (
            <g key={`${pos.x}-${pos.y}`}>
              <path
                d={path}
                className="nav-wave-base"
                style={{ transitionDelay: open ? `${index * 35}ms` : "0ms" }}
              />
              <path
                d={path}
                className="nav-wave-flow"
                style={{ animationDelay: `${index * 120}ms` }}
              />
            </g>
          );
        })}
      </svg>

      <div className={cn("absolute inset-0", !open && "pointer-events-none")}>
        {nodes.map((item, index) => {
          const pos = nodePositions[index];
          const Icon = item.icon;
          const active = activeView === item.id;

          return (
            <div key={item.id} className="absolute">
              <button
                className={cn(
                  "group absolute flex size-14 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-950 shadow-[0_14px_34px_rgba(47,55,76,0.13)] transition duration-200 hover:border-neutral-300 hover:bg-neutral-50",
                  open ? "scale-100 opacity-100" : "scale-50 opacity-0",
                  active && "!bg-neutral-950 !text-white hover:!bg-neutral-900",
                )}
                style={{
                  left: pos.x - 28,
                  top: pos.y - 28,
                  transitionDelay: open ? `${index * 35}ms` : "0ms",
                }}
                aria-label={item.label}
                onClick={() => onPick(item.id)}
              >
                <Icon className="size-5" />
                <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-full bg-neutral-950 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-sm transition group-hover:opacity-100">
                  {item.label}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AccountPanel({
  onClose,
  onAccountChange,
}: {
  onClose: () => void;
  onAccountChange?: (account: NeteaseAccountSummary) => void;
}) {
  const [cookie, setCookie] = useState("");
  const [account, setAccount] = useState<NeteaseAccountSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    api
      .getSettings()
      .then((settings) => {
        if (mounted) {
          setAccount(settings.neteaseAccount);
          onAccountChange?.(settings.neteaseAccount);
        }
      })
      .catch(() => {
        if (mounted) setMessage("后端未连接");
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function bindCookie() {
    if (!cookie.trim()) {
      setMessage("请先粘贴 Cookie");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const result = await api.saveNeteaseCookie(cookie.trim());
      setAccount(result.account);
      onAccountChange?.(result.account);
      setCookie("");
      setMessage("Cookie 已保存");
    } catch {
      setMessage("保存失败，请确认后端正在运行");
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.98, filter: "blur(12px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -8, scale: 0.98, filter: "blur(12px)" }}
      transition={{ duration: 0.22 }}
      className="glass absolute right-0 top-14 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-[1.4rem] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-full bg-neutral-950 text-white">
            <UserRound className="size-5" />
          </div>
          <div>
            <p className="font-semibold">网易云账号</p>
            <p className="mt-1 text-xs text-neutral-500">
              {account?.connected ? account.cookiePreview : "Cookie 未绑定"}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" aria-label="关闭账号面板" onClick={onClose}>
          <X />
        </Button>
      </div>

      <div className="mt-4 rounded-[1.1rem] bg-white/58 p-3 shadow-sm">
        <label className="text-xs font-medium text-neutral-500" htmlFor="cookie">
          网易云 Cookie
        </label>
        <textarea
          id="cookie"
          value={cookie}
          onChange={(event) => setCookie(event.target.value)}
          rows={4}
          placeholder="MUSIC_U=...; NMTID=..."
          className="mt-2 w-full resize-none rounded-[0.9rem] border border-white/70 bg-white/70 p-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-300"
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm">
            <Settings2 />
            设置
          </Button>
          <Button size="sm" onClick={bindCookie} disabled={saving}>
            <Cookie />
            {saving ? "保存中" : "绑定"}
          </Button>
        </div>
      </div>
      {message && <p className="mt-3 text-xs text-neutral-500">{message}</p>}

      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs text-neutral-500">
        <Metric value={account?.connected ? "ON" : "--"} label="状态" />
        <Metric value={account?.userId ?? "--"} label="用户" />
        <Metric value="28" label="歌单" />
      </div>
    </motion.div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-white/62 px-2 py-3">
      <p className="text-base font-semibold text-neutral-950">{value}</p>
      <p className="mt-1">{label}</p>
    </div>
  );
}

function CoverArt({
  track,
  className,
  large = false,
}: {
  track: Track;
  className?: string;
  large?: boolean;
}) {
  return (
    <div
      className={cn("relative shrink-0 overflow-hidden", className)}
      style={{ background: track.cover }}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_34%_22%,rgba(255,255,255,0.72),transparent_0.85rem),radial-gradient(circle_at_72%_68%,rgba(255,255,255,0.32),transparent_5rem)]" />
      <div className="absolute left-[18%] top-[16%] aspect-square w-[64%] rounded-full border border-white/35 bg-black/10 shadow-[inset_0_0_0_18px_rgba(255,255,255,0.08)]" />
      <div className="absolute left-1/2 top-1/2 size-[12%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/75" />
      {large && (
        <div className="absolute bottom-8 left-8 right-8">
          <p className="truncate text-2xl font-semibold text-white drop-shadow">{track.title}</p>
          <p className="mt-1 truncate text-sm text-white/75">{track.artist}</p>
        </div>
      )}
    </div>
  );
}
