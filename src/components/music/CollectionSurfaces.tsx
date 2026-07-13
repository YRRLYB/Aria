import { useMemo, useState } from "react";
import { ChevronDown, Cloud, Heart, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Track } from "@/data/music";
import { capabilities } from "@/data/music";
import type { ProviderPlaylist } from "@/lib/api";
import { formatAudioDetail } from "@/lib/playerPresentation";
import { cn } from "@/lib/utils";
import { CoverArt, EmptyState } from "./shared";

export function CollectionSurface({
  title,
  subtitle,
  icon,
  tracks,
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
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-full bg-white shadow-sm">{icon}</div>
        <div>
          <Badge>Collection</Badge>
          <h1 className="mt-3 text-4xl font-semibold sm:text-6xl">{title}</h1>
          <p className="mt-3 text-neutral-500">{subtitle}</p>
        </div>
      </div>
      <div className="mt-8 grid gap-3">
        {tracks.map((track, index) => (
          <button
            key={track.id}
            className="grid grid-cols-[2.5rem_3.5rem_minmax(0,1fr)_auto] items-center gap-4 rounded-[1.5rem] bg-white/45 p-3 text-left transition hover:bg-white/75"
            onClick={() => onPickTrack(track.id)}
          >
            <span className="text-center text-sm font-medium text-neutral-400">
              {String(index + 1).padStart(2, "0")}
            </span>
            <CoverArt track={track} className="size-14 rounded-2xl" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{track.title}</p>
              <p className="truncate text-sm text-neutral-500">{track.artist}</p>
            </div>
            <Badge>{formatAudioDetail(track)}</Badge>
          </button>
        ))}
        {!tracks.length && <EmptyState text="暂无曲目，先同步网易云或扫描本地音乐。" />}
      </div>
    </div>
  );
}

export function LikedSurface({
  localTracks,
  neteaseTracks,
  onPickTrack,
}: {
  localTracks: Track[];
  neteaseTracks: Track[];
  onPickTrack: (id: string) => void;
}) {
  return (
    <div className="glass flex h-full min-h-[620px] flex-col overflow-hidden rounded-[1.5rem] p-5 sm:p-8">
      <div className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge>Favorite</Badge>
          <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">我喜欢</h1>
          <p className="mt-3 text-neutral-500">本地红心和网易云红心分开收纳，同步时不混乱。</p>
        </div>
        <Button variant="glass">
          <Heart className="fill-current" />
          同步红心
        </Button>
      </div>

      <div className="mt-8 grid min-h-0 flex-1 gap-5 xl:grid-cols-2">
        <LikedColumn title="本地我喜欢" subtitle="来自本地音乐库" tracks={localTracks} onPickTrack={onPickTrack} />
        <LikedColumn title="网易云我喜欢" subtitle="Cookie 登录后读取" tracks={neteaseTracks} onPickTrack={onPickTrack} />
      </div>
    </div>
  );
}

function LikedColumn({
  title,
  subtitle,
  tracks,
  onPickTrack,
}: {
  title: string;
  subtitle: string;
  tracks: Track[];
  onPickTrack: (id: string) => void;
}) {
  return (
    <section className="flex min-h-0 flex-col rounded-[1.25rem] bg-white/52 p-4 shadow-sm">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
        </div>
        <Badge>{tracks.length} 首</Badge>
      </div>
      <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {tracks.map((track) => (
          <button
            key={track.id}
            className="grid w-full grid-cols-[3rem_minmax(0,1fr)_1.75rem] items-center gap-3 rounded-[1rem] p-2 text-left transition hover:bg-white/75"
            onClick={() => onPickTrack(track.id)}
          >
            <CoverArt track={track} className="size-12 rounded-xl" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{track.title}</p>
              <p className="truncate text-xs text-neutral-500">{track.artist}</p>
            </div>
            <span className="flex size-7 items-center justify-center rounded-full bg-white/70">
              <Heart className="size-4 fill-neutral-950" />
            </span>
          </button>
        ))}
        {!tracks.length && <EmptyState text="暂无歌曲，先点亮播放页里的红心。" />}
      </div>
    </section>
  );
}

export function PlaylistSurface({
  playlists,
  selectedPlaylist,
  tracks,
  playCounts,
  loading,
  onOpenPlaylist,
  onClosePlaylist,
  onPickTrack,
}: {
  playlists: ProviderPlaylist[];
  selectedPlaylist: ProviderPlaylist | null;
  tracks: Track[];
  playCounts: Record<string, number>;
  loading: boolean;
  onOpenPlaylist: (playlist: ProviderPlaylist) => void;
  onClosePlaylist: () => void;
  onPickTrack: (id: string) => void;
}) {
  const [sortMode, setSortMode] = useState<"added-desc" | "added-asc" | "title-asc" | "title-desc" | "plays-desc">("added-desc");
  const sortedTracks = useMemo(() => {
    const indexed = tracks.map((track, index) => ({ track, index }));
    switch (sortMode) {
      case "added-asc":
        return [...indexed].reverse().map((item) => item.track);
      case "title-asc":
        return [...indexed]
          .sort((left, right) => left.track.title.localeCompare(right.track.title, "zh-CN"))
          .map((item) => item.track);
      case "title-desc":
        return [...indexed]
          .sort((left, right) => right.track.title.localeCompare(left.track.title, "zh-CN"))
          .map((item) => item.track);
      case "plays-desc":
        return [...indexed]
          .sort((left, right) => {
            const byCount = (playCounts[right.track.id] ?? 0) - (playCounts[left.track.id] ?? 0);
            if (byCount !== 0) return byCount;
            return left.index - right.index;
          })
          .map((item) => item.track);
      default:
        return indexed.map((item) => item.track);
    }
  }, [playCounts, sortMode, tracks]);

  if (selectedPlaylist) {
    return (
      <div className="glass h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <Button variant="ghost" size="sm" onClick={onClosePlaylist}>
              <ChevronDown className="rotate-90" />
              返回歌单
            </Button>
            <h1 className="mt-4 truncate text-3xl font-semibold sm:text-5xl">{selectedPlaylist.name}</h1>
            <p className="mt-2 text-sm text-neutral-500">{tracks.length} 首 · 原始顺序来自歌单</p>
          </div>
          <Badge>{loading ? "读取中" : "Ready"}</Badge>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {[
            ["added-desc", "添加倒序"],
            ["added-asc", "添加正序"],
            ["title-asc", "名字 A-Z"],
            ["title-desc", "名字 Z-A"],
            ["plays-desc", "听的次数"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm transition",
                sortMode === value ? "border-neutral-950 bg-neutral-950 text-white" : "border-white/70 bg-white/65 text-neutral-500",
              )}
              onClick={() => setSortMode(value as typeof sortMode)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-6 grid gap-2">
          {sortedTracks.map((track, index) => (
            <button
              key={track.id}
              className="grid grid-cols-[2rem_3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[1.1rem] bg-white/52 p-3 text-left shadow-sm transition hover:bg-white"
              onClick={() => onPickTrack(track.id)}
            >
              <span className="text-center text-sm text-neutral-400">{index + 1}</span>
              <CoverArt track={track} className="size-14 rounded-2xl" />
              <div className="min-w-0">
                <p className="truncate font-semibold">{track.title}</p>
                <p className="truncate text-sm text-neutral-500">{track.artist}</p>
              </div>
              <span className="flex flex-wrap justify-end gap-2">
                <Badge>{playCounts[track.id] ?? 0} 次</Badge>
                <Badge>{formatAudioDetail(track)}</Badge>
              </span>
            </button>
          ))}
          {!tracks.length && !loading && <EmptyState text="这个歌单暂时没有读取到曲目。" />}
        </div>
      </div>
    );
  }

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
        {playlists.map((playlist) => (
          <button
            key={playlist.id}
            className="min-h-48 overflow-hidden rounded-[1.75rem] bg-white/52 p-5 text-left shadow-sm transition hover:-translate-y-1 hover:bg-white"
            onClick={() => onOpenPlaylist(playlist)}
          >
            {playlist.coverUrl ? (
              <img src={playlist.coverUrl} alt="" className="size-16 rounded-2xl object-cover shadow-sm" />
            ) : (
              <Cloud className="size-6 text-neutral-500" />
            )}
            <h2 className="mt-8 text-2xl font-semibold">{playlist.name}</h2>
            <p className="mt-2 text-sm text-neutral-500">{playlist.trackCount} 首</p>
            <Badge className="mt-5">{playlist.subscribed ? "收藏歌单" : "创建歌单"}</Badge>
          </button>
        ))}
      </div>
      {!playlists.length && <EmptyState text="暂无歌单数据，绑定有效网易云 Cookie 后同步。" />}
    </div>
  );
}

export function CloudSurface() {
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

export function StatsSurface({ tracks, playCounts }: { tracks: Track[]; playCounts: Record<string, number> }) {
  const mostPlayed = useMemo(
    () =>
      [...tracks]
        .sort((left, right) => (playCounts[right.id] ?? 0) - (playCounts[left.id] ?? 0))
        .slice(0, 3),
    [playCounts, tracks],
  );
  const localCount = useMemo(() => tracks.filter((track) => track.source === "local").length, [tracks]);
  const neteaseCount = useMemo(() => tracks.filter((track) => track.source === "netease").length, [tracks]);
  const firstLocal = tracks.find((track) => track.source === "local")?.title ?? "暂无歌曲";
  const firstNetease = tracks.find((track) => track.source === "netease")?.title ?? "暂无歌曲";

  return (
    <div className="glass h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
      <Badge>Stats</Badge>
      <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">听歌统计</h1>
      <div className="mt-10 grid gap-3">
        {[
          ["全部", String(tracks.length), tracks[0]?.title ?? "暂无歌曲"],
          ["本地", String(localCount), firstLocal],
          ["网易云", String(neteaseCount), firstNetease],
        ].map(([label, count, top]) => (
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
      <div className="mt-8 rounded-[1.5rem] bg-white/54 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">播放次数</h2>
          <Badge>{mostPlayed.length} 首</Badge>
        </div>
        <div className="mt-4 grid gap-3">
          {mostPlayed.map((track, index) => (
            <div
              key={track.id}
              className="grid grid-cols-[2rem_3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[1.15rem] bg-white/72 p-3"
            >
              <span className="text-center text-sm font-semibold text-neutral-400">{index + 1}</span>
              <CoverArt track={track} className="size-12 rounded-xl" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{track.title}</p>
                <p className="truncate text-xs text-neutral-500">{track.artist}</p>
              </div>
              <span className="text-sm font-medium text-neutral-500">{playCounts[track.id] ?? 0} 次</span>
            </div>
          ))}
          {!mostPlayed.length && <EmptyState text="先播放几首歌，统计就会开始累计。" />}
        </div>
      </div>
    </div>
  );
}
