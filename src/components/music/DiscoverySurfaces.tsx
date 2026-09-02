import { useMemo, useState } from "react";
import { Globe2, HardDrive, Play, Search, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CopyableTrackText, CoverArt, EmptyState, Metric, ArtistAvatar } from "@/components/music/shared";
import { artistSourceLabel, type ArtistSummary } from "@/lib/artists";
import { formatAudioDetail, mergeTracks } from "@/lib/playerPresentation";
import { sourceLabel } from "@/lib/trackLabels";
import { cn } from "@/lib/utils";
import type { Track } from "@/data/music";

export function SearchSurface({
  query,
  loading,
  localTracks,
  neteaseTracks,
  artists,
  artistAvatarCache,
  onPickTrack,
  onPickArtist,
}: {
  query: string;
  loading: boolean;
  localTracks: Track[];
  neteaseTracks: Track[];
  artists: ArtistSummary[];
  artistAvatarCache: Record<string, string | null>;
  onPickTrack: (id: string, queue?: Track[]) => void;
  onPickArtist: (artist: ArtistSummary) => void;
}) {
  const tracks = useMemo(() => mergeTracks([...localTracks, ...neteaseTracks]).slice(0, 36), [localTracks, neteaseTracks]);
  const localQueue = useMemo(() => tracks.filter((track) => track.source === "local"), [tracks]);
  const neteaseQueue = useMemo(() => tracks.filter((track) => track.source === "netease"), [tracks]);

  return (
    <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(340px,0.92fr)]">
      <section className="glass min-h-0 overflow-hidden rounded-[1.5rem] p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Badge>{loading ? "搜索中" : "Search"}</Badge>
            <h1 className="mt-3 truncate text-3xl font-semibold">搜索：{query}</h1>
            <p className="mt-2 text-sm text-neutral-500">本地音乐和网易云结果会合并显示，点击歌曲直接播放。</p>
          </div>
          <Search className="size-6 shrink-0 text-neutral-400" />
        </div>
        <div className="no-scrollbar mt-5 grid max-h-[calc(100%-6.5rem)] gap-2 overflow-y-auto pr-1">
          {tracks.map((track) => (
            <button
              key={track.id}
              className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[1.2rem] bg-white/50 p-3 text-left shadow-sm transition hover:bg-white"
              onClick={() =>
                onPickTrack(
                  track.id,
                  track.source === "netease" ? neteaseQueue : track.source === "local" ? localQueue : [track],
                )
              }
            >
              <CoverArt track={track} className="size-14 rounded-2xl" />
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  <CopyableTrackText track={track} field="title">{track.title}</CopyableTrackText>
                </p>
                <p className="truncate text-sm text-neutral-500">
                  <CopyableTrackText track={track} field="artist">{track.artist}</CopyableTrackText>
                </p>
                <p className="mt-1 truncate text-xs text-neutral-400">{track.album}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge>{sourceLabel[track.source]}</Badge>
                <span className="text-xs text-neutral-500">{formatAudioDetail(track)}</span>
              </div>
            </button>
          ))}
          {!tracks.length && <EmptyState text={loading ? "正在搜索曲库和网易云。" : "没有找到相关歌曲。"} />}
        </div>
      </section>

      <section className="glass min-h-0 overflow-hidden rounded-[1.5rem] p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-neutral-400">Artists</p>
            <h2 className="mt-1 text-2xl font-semibold">歌手</h2>
          </div>
          <Badge>{artists.length}</Badge>
        </div>
        <div className="no-scrollbar mt-5 grid max-h-[calc(100%-5rem)] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          {artists.map((artist) => (
            <ArtistCard
              key={artist.id}
              artist={artist}
              avatarUrl={artist.avatarUrl ?? artistAvatarCache[artist.name.toLowerCase()] ?? null}
              onPick={onPickArtist}
            />
          ))}
          {!artists.length && <EmptyState text={loading ? "正在查找歌手头像和资料。" : "没有找到相关歌手。"} />}
        </div>
      </section>
    </div>
  );
}

export function ArtistsSurface({
  artists,
  selectedArtist,
  tracks,
  artistAvatarCache,
  onPickArtist,
  onBack,
  onPickTrack,
}: {
  artists: ArtistSummary[];
  selectedArtist: ArtistSummary | null;
  tracks: Track[];
  artistAvatarCache: Record<string, string | null>;
  onPickArtist: (artist: ArtistSummary) => void;
  onBack: () => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
}) {
  const featuredArtists = artists.slice(0, 80);

  if (selectedArtist) {
    const avatarUrl = selectedArtist.avatarUrl ?? artistAvatarCache[selectedArtist.name.toLowerCase()] ?? null;
    return (
      <ArtistDetailView
        key={selectedArtist.id}
        artist={selectedArtist}
        avatarUrl={avatarUrl}
        tracks={tracks}
        onBack={onBack}
        onPickTrack={onPickTrack}
      />
    );
  }

  return (
    <section className="glass h-full min-h-0 overflow-hidden rounded-[1.5rem] p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Badge>Artists</Badge>
          <h1 className="mt-3 text-3xl font-semibold">歌手</h1>
          <p className="mt-2 text-sm text-neutral-500">本地与网易云曲库合并统计，头像会从线上轻量补全。</p>
        </div>
        <UserRound className="size-7 text-neutral-400" />
      </div>
      <div className="no-scrollbar mt-5 grid max-h-[calc(100%-6.5rem)] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {featuredArtists.map((artist) => (
          <ArtistCard
            key={artist.id}
            artist={artist}
            avatarUrl={artist.avatarUrl ?? artistAvatarCache[artist.name.toLowerCase()] ?? null}
            onPick={onPickArtist}
          />
        ))}
        {!featuredArtists.length && <EmptyState text="导入音乐或同步网易云后会生成歌手页。" />}
      </div>
    </section>
  );
}

function ArtistDetailView({
  artist,
  avatarUrl,
  tracks,
  onBack,
  onPickTrack,
}: {
  artist: ArtistSummary;
  avatarUrl: string | null;
  tracks: Track[];
  onBack: () => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
}) {
  const [sourceFilter, setSourceFilter] = useState<"all" | "netease" | "local">("all");
  const localTracks = useMemo(() => tracks.filter((track) => track.source === "local"), [tracks]);
  const neteaseTracks = useMemo(() => tracks.filter((track) => track.source === "netease"), [tracks]);
  const groups = {
    all: [
      { key: "netease", title: "网易云流媒体", description: "点击这里始终使用网络音源", icon: <Globe2 className="size-4" />, tracks: neteaseTracks },
      { key: "local", title: "本地文件", description: "仅播放已扫描的本地文件", icon: <HardDrive className="size-4" />, tracks: localTracks },
    ],
    netease: [
      { key: "netease", title: "网易云流媒体", description: "点击这里始终使用网络音源", icon: <Globe2 className="size-4" />, tracks: neteaseTracks },
    ],
    local: [
      { key: "local", title: "本地文件", description: "仅播放已扫描的本地文件", icon: <HardDrive className="size-4" />, tracks: localTracks },
    ],
  } as const;
  const visibleGroups = groups[sourceFilter];
  const playAllQueue = sourceFilter === "local" ? localTracks : sourceFilter === "netease" ? neteaseTracks : tracks;
  const playAllTrack = playAllQueue[0];

  return (
    <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(420px,0.82fr)_minmax(0,1.18fr)]">
      <section className="glass relative min-h-0 overflow-hidden rounded-[1.5rem] p-6">
        <div className="absolute inset-0 bg-gradient-to-br from-white/80 via-white/30 to-neutral-200/45" />
        <div className="relative z-10 flex h-full min-h-0 flex-col">
          <button
            className="w-fit rounded-full bg-white/70 px-4 py-2 text-sm font-medium shadow-sm transition hover:bg-white"
            onClick={onBack}
          >
            返回歌手墙
          </button>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-8 text-center">
            <ArtistAvatar
              name={artist.name}
              avatarUrl={avatarUrl}
              className="size-64 rounded-[2.4rem] 2xl:size-80"
            />
            <Badge className="mt-7">{artistSourceLabel(artist.source)}</Badge>
            <h1 className="mt-4 max-w-[26rem] break-words text-4xl font-semibold leading-tight 2xl:text-5xl">{artist.name}</h1>
            <div className="mt-6 grid w-full max-w-sm grid-cols-2 gap-3">
              <Metric value={String(tracks.length || artist.trackCount || 0)} label="曲目" />
              <Metric value={String(artist.albumCount ?? 0)} label="专辑" />
            </div>
          </div>
        </div>
      </section>
      <section className="glass min-h-0 overflow-hidden rounded-[1.5rem] p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-neutral-400">Tracks</p>
            <h2 className="mt-1 text-2xl font-semibold">按来源播放</h2>
          </div>
          <div className="flex items-center gap-2">
            {playAllTrack && (
              <button
                className="flex items-center gap-1.5 rounded-full bg-neutral-950 px-3.5 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-neutral-800"
                onClick={() => onPickTrack(playAllTrack.id, playAllQueue)}
              >
                <Play className="size-3.5 fill-current" />
                播放全部
              </button>
            )}
            <Badge>{tracks.length}</Badge>
          </div>
        </div>
        <div className="mt-4 flex w-fit items-center gap-1 rounded-full bg-white/60 p-1 shadow-sm">
          {(
            [
              { key: "all", label: "全部", count: tracks.length },
              { key: "netease", label: "网易云", count: neteaseTracks.length },
              { key: "local", label: "本地", count: localTracks.length },
            ] as const
          ).map((option) => (
            <button
              key={option.key}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-medium transition",
                sourceFilter === option.key
                  ? "bg-neutral-950 text-white shadow-sm"
                  : "text-neutral-500 hover:text-neutral-950",
              )}
              onClick={() => setSourceFilter(option.key)}
            >
              {option.label} {option.count}
            </button>
          ))}
        </div>
        <div className="no-scrollbar mt-4 grid max-h-[calc(100%-9rem)] gap-5 overflow-y-auto pr-1">
          {visibleGroups.map((group) => (
            <ArtistTrackGroup
              key={group.key}
              title={group.title}
              description={group.description}
              icon={group.icon}
              tracks={group.tracks}
              onPickTrack={onPickTrack}
            />
          ))}
          {!tracks.length && <EmptyState text="正在整理这个歌手的歌曲。" />}
        </div>
      </section>
    </div>
  );
}


function ArtistTrackGroup({
  title,
  description,
  icon,
  tracks,
  onPickTrack,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  tracks: Track[];
  onPickTrack: (id: string, queue?: Track[]) => void;
}) {
  return (
    <section className="min-w-0 rounded-[1.15rem] border border-white/70 bg-white/42 p-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/75 text-neutral-500">{icon}</span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">{title}</h3>
            <p className="truncate text-xs text-neutral-400">{description}</p>
          </div>
        </div>
        <Badge>{tracks.length}</Badge>
      </div>
      <div className="mt-3 grid gap-2">
        {tracks.map((track) => (
          <button
            key={track.id}
            className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[1rem] bg-white/58 p-2.5 text-left transition hover:bg-white"
            onClick={() => onPickTrack(track.id, tracks)}
          >
            <CoverArt track={track} className="size-14 rounded-2xl" />
            <div className="min-w-0">
              <p className="truncate font-semibold">
                <CopyableTrackText track={track} field="title">{track.title}</CopyableTrackText>
              </p>
              <p className="truncate text-sm text-neutral-500">{track.album}</p>
            </div>
            <div className="flex min-w-0 flex-col items-end gap-1">
              <Badge>{track.source === "netease" ? "网易云" : "本地"}</Badge>
              <span className="whitespace-nowrap text-xs text-neutral-500">{formatAudioDetail(track)}</span>
            </div>
          </button>
        ))}
        {!tracks.length && <p className="px-2 py-3 text-xs text-neutral-400">暂无此来源的歌曲</p>}
      </div>
    </section>
  );
}

function ArtistCard({
  artist,
  avatarUrl,
  onPick,
}: {
  artist: ArtistSummary;
  avatarUrl: string | null;
  onPick: (artist: ArtistSummary) => void;
}) {
  return (
    <button
      className="group grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 rounded-[1.25rem] bg-white/55 p-3 text-left shadow-sm transition hover:bg-white"
      onClick={() => onPick({ ...artist, avatarUrl: artist.avatarUrl ?? avatarUrl })}
    >
      <ArtistAvatar name={artist.name} avatarUrl={avatarUrl} className="size-16 rounded-2xl" />
      <div className="min-w-0">
        <p className="truncate font-semibold group-hover:text-neutral-700">{artist.name}</p>
        <p className="mt-1 truncate text-xs text-neutral-500">
          {artistSourceLabel(artist.source)} · {artist.trackCount || 0} 首
        </p>
        <p className="mt-1 truncate text-xs text-neutral-400">{artist.albumCount ?? 0} 张专辑</p>
      </div>
    </button>
  );
}


