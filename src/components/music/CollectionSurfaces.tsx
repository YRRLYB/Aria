import { useMemo, useRef, useState } from "react";
import { Cloud, Heart, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Track } from "@/data/music";
import type { ProviderPlaylist } from "@/lib/api";
import { formatAudioDetail } from "@/lib/playerPresentation";
import { useVirtualRows } from "@/lib/virtualRows";
import { cn } from "@/lib/utils";
import { ArtworkImage } from "./ArtworkImage";
import { PlaylistDetail } from "./PlaylistDetail";
import { AddToPlaylistButton } from "./PlaylistActions";
import { CopyableTrackText, CoverArt, EmptyState } from "./shared";

export function CollectionSurface({
  title,
  subtitle,
  icon,
  tracks,
  refreshing = false,
  onRefresh,
  onPickTrack,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  tracks: Track[];
  refreshing?: boolean;
  onRefresh?: () => void;
  onPickTrack: (id: string) => void;
}) {
  return (
    <div className="glass flex h-full min-h-[620px] flex-col overflow-hidden rounded-[1.5rem] p-5 sm:p-8">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">{icon}</div>
          <div className="min-w-0">
            <Badge>Collection</Badge>
            <h1 className="mt-3 truncate text-4xl font-semibold sm:text-6xl">{title}</h1>
            <p className="mt-3 text-neutral-500">{subtitle}</p>
          </div>
        </div>
        {onRefresh && (
          <Button variant="glass" size="sm" disabled={refreshing} onClick={onRefresh}>
            <RefreshCw className={cn(refreshing && "animate-spin")} />
            {refreshing ? "刷新中" : "刷新"}
          </Button>
        )}
      </div>
      <VirtualTrackList
        className="mt-8"
        tracks={tracks}
        emptyText="暂无曲目，先同步网易云或扫描本地音乐。"
        onPickTrack={onPickTrack}
      />
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
        <LikedColumn title="网易云我喜欢" subtitle="扫码或 Cookie 登录后读取" tracks={neteaseTracks} onPickTrack={onPickTrack} />
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
  const virtual = useVirtualRows({ count: tracks.length, rowHeight: 72, overscan: 10 });

  return (
    <section className="flex min-h-0 flex-col rounded-[1.25rem] bg-white/52 p-4 shadow-sm">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>
        </div>
        <Badge>{tracks.length} 首</Badge>
      </div>
      <div ref={virtual.containerRef} className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="relative" style={{ height: virtual.totalHeight }}>
          {virtual.rows.map(({ index, offsetTop }) => {
            const track = tracks[index];
            if (!track) return null;
            return (
              <button
                key={track.id}
                className="absolute left-0 right-0 grid h-16 w-full grid-cols-[3rem_minmax(0,1fr)_1.75rem] items-center gap-3 rounded-[1rem] p-2 text-left transition hover:bg-white/75"
                style={{ top: offsetTop }}
                onClick={() => onPickTrack(track.id)}
              >
                <CoverArt track={track} className="size-12 rounded-xl" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    <CopyableTrackText track={track} field="title">{track.title}</CopyableTrackText>
                  </p>
                  <p className="truncate text-xs text-neutral-500">
                    <CopyableTrackText track={track} field="artist">{track.artist}</CopyableTrackText>
                  </p>
                </div>
                <span className="flex size-7 items-center justify-center rounded-full bg-white/70">
                  <Heart className="size-4 fill-neutral-950" />
                </span>
              </button>
            );
          })}
        </div>
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
  canCreatePlaylist,
  onCreatePlaylist,
  onRequireLogin,
  onOpenPlaylist,
  onClosePlaylist,
  onPickTrack,
  error,
  onUpdatePlaylist,
  onUploadCover,
  onRemoveTracks,
  onReorderTracks,
  onSubscribe,
}: {
  playlists: ProviderPlaylist[];
  selectedPlaylist: ProviderPlaylist | null;
  tracks: Track[];
  playCounts: Record<string, number>;
  loading: boolean;
  canCreatePlaylist: boolean;
  onCreatePlaylist: (name: string, isPrivate: boolean) => Promise<ProviderPlaylist>;
  onRequireLogin: () => void;
  onOpenPlaylist: (playlist: ProviderPlaylist) => void;
  onClosePlaylist: () => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
  error: string | null;
  onUpdatePlaylist: (id: string, fields: { name?: string; description?: string }) => Promise<void>;
  onUploadCover: (id: string, file: File) => Promise<void>;
  onRemoveTracks: (id: string, tracks: Track[]) => Promise<void>;
  onReorderTracks: (id: string, tracks: Track[]) => Promise<void>;
  onSubscribe: (id: string, subscribed: boolean) => Promise<void>;
}) {
  const [playlistFilter, setPlaylistFilter] = useState<"all" | "owned" | "saved">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const createPendingRef = useRef(false);

  async function submitPlaylist(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreatePlaylist || createPendingRef.current) return;
    const name = playlistName.trim();
    if (!name) {
      setCreateError("请输入歌单名称");
      return;
    }
    createPendingRef.current = true;
    setCreating(true);
    setCreateError(null);
    try {
      await onCreatePlaylist(name, isPrivate);
      setPlaylistFilter("owned");
      setCreateOpen(false);
      setPlaylistName("");
      setIsPrivate(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "创建失败，请稍后重试");
    } finally {
      createPendingRef.current = false;
      setCreating(false);
    }
  }
  const visiblePlaylists = useMemo(() => {
    if (playlistFilter === "owned") return playlists.filter((playlist) => playlist.owned ?? !playlist.subscribed);
    if (playlistFilter === "saved") return playlists.filter((playlist) => playlist.subscribed || playlist.owned === false);
    return playlists;
  }, [playlistFilter, playlists]);

  if (selectedPlaylist) {
    return <PlaylistDetail key={selectedPlaylist.id} playlist={selectedPlaylist} tracks={tracks} loading={loading} error={error} connected={canCreatePlaylist} playCounts={playCounts}
      onBack={onClosePlaylist} onRetry={() => onOpenPlaylist(selectedPlaylist)} onPickTrack={onPickTrack}
      onUpdate={(fields) => onUpdatePlaylist(selectedPlaylist.id, fields)} onUploadCover={(file) => onUploadCover(selectedPlaylist.id, file)}
      onRemove={(items) => onRemoveTracks(selectedPlaylist.id, items)} onReorder={(items) => onReorderTracks(selectedPlaylist.id, items)}
      onSubscribe={(subscribed) => onSubscribe(selectedPlaylist.id, subscribed)} onRequireLogin={onRequireLogin} />;
  }

  return (
    <div className="glass no-scrollbar h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Badge>Playlist</Badge>
          <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">歌单</h1>
        </div>
        <Button onClick={() => {
          setCreateError(null);
          setCreateOpen((current) => !current);
        }} aria-expanded={createOpen} aria-controls="create-playlist-form" disabled={creating}>
          <Plus />
          新建
        </Button>
      </div>
      {createOpen && (
        <section id="create-playlist-form" className="mt-6 rounded-2xl border border-white/70 bg-white/65 p-5">
          <h2 className="text-lg font-semibold">新建网易云歌单</h2>
          {!canCreatePlaylist ? (
            <div className="mt-3 flex items-center justify-between gap-4">
              <p className="text-sm text-neutral-500">登录网易云后即可创建歌单，并同步到你的账号。</p>
              <Button size="sm" onClick={onRequireLogin}>前往登录</Button>
            </div>
          ) : (
            <form className="mt-4 space-y-4" onSubmit={submitPlaylist} aria-busy={creating}>
              <label className="block text-sm font-medium" htmlFor="playlist-name">歌单名称</label>
              <input
                id="playlist-name"
                value={playlistName}
                onChange={(event) => {
                  setPlaylistName(event.target.value);
                  if (createError) setCreateError(null);
                }}
                placeholder="为新歌单起个名字"
                maxLength={40}
                autoFocus
                required
                disabled={creating}
                aria-invalid={Boolean(createError)}
                aria-describedby={createError ? "playlist-create-error" : undefined}
                className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-soft)] disabled:opacity-60"
              />
              <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-600">
                <input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} disabled={creating} className="size-4 accent-[var(--accent)]" />
                私密歌单，只有自己可见
              </label>
              {createError && <p id="playlist-create-error" role="alert" className="text-sm text-red-600">{createError}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" disabled={creating} onClick={() => setCreateOpen(false)}>取消</Button>
                <Button type="submit" size="sm" disabled={creating || !playlistName.trim()}>
                  {creating && <LoaderCircle className="animate-spin" />}
                  {creating ? "创建中…" : "创建歌单"}
                </Button>
              </div>
            </form>
          )}
        </section>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        {[
          ["all", "全部歌单"],
          ["owned", "我创建"],
          ["saved", "我收藏"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm transition",
              playlistFilter === value ? "border-neutral-950 bg-neutral-950 text-white" : "border-white/70 bg-white/65 text-neutral-500 hover:bg-white",
            )}
            onClick={() => setPlaylistFilter(value as typeof playlistFilter)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {visiblePlaylists.map((playlist) => (
          <button
            key={playlist.id}
            className="min-h-48 overflow-hidden rounded-[1.75rem] bg-white/52 p-5 text-left shadow-sm transition hover:-translate-y-1 hover:bg-white"
            onClick={() => onOpenPlaylist(playlist)}
          >
            {playlist.coverUrl ? (
              <ArtworkImage
                src={playlist.coverUrl}
                cacheSize={160}
                alt=""
                loading="lazy"
                decoding="async"
                fetchPriority="low"
                draggable={false}
                className="size-16 rounded-2xl object-cover shadow-sm"
              />
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

export function StatsSurface({ tracks, playCounts }: { tracks: Track[]; playCounts: Record<string, number> }) {
  const mostPlayed = useMemo(
    () =>
      [...tracks]
        .filter((track) => (playCounts[track.id] ?? 0) > 0)
        .sort((left, right) => (playCounts[right.id] ?? 0) - (playCounts[left.id] ?? 0))
        .slice(0, 20),
    [playCounts, tracks],
  );
  const localCount = useMemo(() => tracks.filter((track) => track.source === "local").length, [tracks]);
  const neteaseCount = useMemo(() => tracks.filter((track) => track.source === "netease").length, [tracks]);
  const playedTrackCount = useMemo(
    () => tracks.filter((track) => (playCounts[track.id] ?? 0) > 0).length,
    [playCounts, tracks],
  );
  const totalPlays = useMemo(
    () => tracks.reduce((sum, track) => sum + (playCounts[track.id] ?? 0), 0),
    [playCounts, tracks],
  );
  const firstLocal = tracks.find((track) => track.source === "local")?.title ?? "暂无歌曲";
  const firstNetease = tracks.find((track) => track.source === "netease")?.title ?? "暂无歌曲";

  return (
    <div className="glass h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
      <Badge>Stats</Badge>
      <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">听歌统计</h1>
      <div className="mt-10 grid gap-3">
        {[
          ["累计播放", String(totalPlays), mostPlayed[0]?.title ?? "暂无记录"],
          ["听过曲目", String(playedTrackCount), `${playedTrackCount} 首有播放记录`],
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
          <h2 className="text-xl font-semibold">常听排行</h2>
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
                <p className="truncate text-sm font-semibold">
                  <CopyableTrackText track={track} field="title">{track.title}</CopyableTrackText>
                </p>
                <p className="truncate text-xs text-neutral-500">
                  <CopyableTrackText track={track} field="artist">{track.artist}</CopyableTrackText>
                </p>
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

function VirtualTrackList({
  tracks,
  emptyText,
  className,
  onPickTrack,
  renderMeta,
}: {
  tracks: Track[];
  emptyText: string;
  className?: string;
  onPickTrack: (id: string) => void;
  renderMeta?: (track: Track) => React.ReactNode;
}) {
  const virtual = useVirtualRows({ count: tracks.length, rowHeight: 88, overscan: 10 });

  return (
    <div ref={virtual.containerRef} className={cn("no-scrollbar min-h-0 flex-1 overflow-y-auto pr-1", className)}>
      <div className="relative" style={{ height: virtual.totalHeight }}>
        {virtual.rows.map(({ index, offsetTop }) => {
          const track = tracks[index];
          if (!track) return null;
          return (
            <div
              key={track.id}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onPickTrack(track.id); } }}
              className="absolute left-0 right-0 grid h-20 grid-cols-[2rem_3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-[1.1rem] bg-white/52 p-3 text-left shadow-sm transition hover:bg-white"
              style={{ top: offsetTop }}
              onClick={() => onPickTrack(track.id)}
            >
              <span className="text-center text-sm text-neutral-400">{index + 1}</span>
              <CoverArt track={track} className="size-14 rounded-2xl" />
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  <CopyableTrackText track={track} field="title">{track.title}</CopyableTrackText>
                </p>
                <p className="truncate text-sm text-neutral-500">
                  <CopyableTrackText track={track} field="artist">{track.artist}</CopyableTrackText>
                </p>
              </div>
              <span className="flex flex-wrap justify-end gap-2">{renderMeta ? renderMeta(track) : <Badge>{formatAudioDetail(track)}</Badge>}<AddToPlaylistButton track={track} /></span>
            </div>
          );
        })}
      </div>
      {!tracks.length && <EmptyState text={emptyText} />}
    </div>
  );
}
