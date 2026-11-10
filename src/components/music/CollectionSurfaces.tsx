import { useEffect, useMemo, useRef, useState } from "react";
import { Cloud, Heart, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Track } from "@/data/music";
import type { ProviderPlaylist } from "@/lib/api";
import { formatAudioDetail, mergeTracks } from "@/lib/playerPresentation";
import { sourceLabel } from "@/lib/trackLabels";
import { useVirtualRows } from "@/lib/virtualRows";
import { cn } from "@/lib/utils";
import { SourceLogo, SourceToggle, type SourceToggleOption } from "./SourceLogos";
import { ArtworkImage } from "./ArtworkImage";
import { PlaylistDetail } from "./PlaylistDetail";
import { AddToPlaylistButton } from "./PlaylistActions";
import { LocalPlaylistSurface, type LocalPlaylistSurfaceProps } from "./LocalPlaylistSurfaces";
import { CopyableTrackText, CoverArt, EmptyState } from "./shared";

export function CollectionSurface({
  title,
  subtitle,
  icon,
  tracks,
  refreshing = false,
  onRefresh,
  onPickTrack,
  sourceToggle,
  emptyText,
  loading = false,
  error = null,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  tracks: Track[];
  refreshing?: boolean;
  onRefresh?: () => void;
  onPickTrack: (id: string) => void;
  /** 双源切换:每日推荐/私人漫游等聚合页按 logo 切换网易云与 QQ。 */
  sourceToggle?: { value: "netease" | "qq"; onChange: (source: "netease" | "qq") => void };
  emptyText?: string;
  loading?: boolean;
  error?: string | null;
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
      {sourceToggle && (
        <div className="mt-5 shrink-0">
          <SourceToggle
            value={sourceToggle.value}
            onChange={(source) => {
              // 本切换器只提供在线双源选项，SourceToggle 的联合类型里还有 local。
              if (source !== "local") sourceToggle.onChange(source);
            }}
            options={["netease", "qq"]}
            ariaLabel="推荐来源"
          />
        </div>
      )}
      {error && (
        <div role="alert" className="mt-4 flex shrink-0 items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          {onRefresh && (
            <Button variant="ghost" size="sm" onClick={onRefresh}>
              重试
            </Button>
          )}
        </div>
      )}
      {loading && !tracks.length ? (
        <div className="mt-6 flex min-h-0 flex-1 items-center justify-center text-sm text-neutral-400">
          <LoaderCircle className="mr-2 size-4 animate-spin" /> 正在载入…
        </div>
      ) : (
        <VirtualTrackList
          className={sourceToggle ? "mt-5" : "mt-8"}
          tracks={tracks}
          emptyText={emptyText ?? "暂无曲目，先扫描本地音乐或登录后同步红心。"}
          onPickTrack={onPickTrack}
        />
      )}
    </div>
  );
}

export function LikedSurface({
  localTracks,
  neteaseTracks,
  qqTracks,
  neteaseConnected,
  qqConnected,
  refreshing = false,
  onRefresh,
  onPickTrack,
}: {
  localTracks: Track[];
  neteaseTracks: Track[];
  qqTracks: Track[];
  neteaseConnected: boolean;
  qqConnected: boolean;
  refreshing?: boolean;
  onRefresh?: (source: "all" | SourceToggleOption) => void;
  onPickTrack: (id: string) => void;
}) {
  // 全部来源聚合是默认视图；来源按钮仍可单独查看。
  const [likedSource, setLikedSource] = useState<"all" | SourceToggleOption>("all");
  const connectionRef = useRef({ neteaseConnected, qqConnected });
  useEffect(() => {
    const previous = connectionRef.current;
    if (!previous.qqConnected && qqConnected && !neteaseConnected && likedSource === "netease") setLikedSource("qq");
    if (!previous.neteaseConnected && neteaseConnected && !qqConnected && likedSource === "qq") setLikedSource("netease");
    connectionRef.current = { neteaseConnected, qqConnected };
  }, [neteaseConnected, qqConnected, likedSource]);

  const allTracks = useMemo(
    () => mergeTracks([...localTracks, ...neteaseTracks, ...qqTracks]),
    [localTracks, neteaseTracks, qqTracks],
  );
  const columns: Record<"all" | SourceToggleOption, { title: string; subtitle: string; emptyText: string; tracks: Track[] }> = {
    all: {
      title: "全部喜欢",
      subtitle: `本地、网易云与 QQ 音乐共 ${allTracks.length} 首`,
      emptyText: "还没有红心歌曲；在播放页点亮红心后会出现在这里。",
      tracks: allTracks,
    },
    local: {
      title: "本地我喜欢",
      subtitle: "来自本地音乐库的红心歌曲",
      emptyText: "暂无本地红心歌曲，在播放页点亮红心后会出现在这里。",
      tracks: localTracks,
    },
    netease: {
      title: "网易云我喜欢",
      subtitle: neteaseConnected ? `网易云账号已同步 ${neteaseTracks.length} 首` : "扫码或 Cookie 登录后读取",
      emptyText: neteaseConnected ? "网易云账号暂无红心歌曲。" : "登录网易云后即可同步红心歌曲。",
      tracks: neteaseTracks,
    },
    qq: {
      title: "QQ 音乐我喜欢",
      subtitle: qqConnected
        ? qqTracks.length
          ? `QQ 音乐账号已同步 ${qqTracks.length} 首`
          : "QQ 音乐账号暂无红心歌曲"
        : "登录 QQ 音乐后读取",
      emptyText: qqConnected
        ? "QQ 音乐账号暂无红心歌曲；如果刚在手机上点过红心，点右上角「同步红心」再试一次。"
        : "登录 QQ 音乐后即可同步红心歌曲。",
      tracks: qqTracks,
    },
  };
  const active = columns[likedSource];

  return (
    <div className="glass flex h-full min-h-[620px] flex-col overflow-hidden rounded-[1.5rem] p-5 sm:p-8">
      <div className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge>Favorite</Badge>
          <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">我喜欢</h1>
          <p className="mt-3 text-neutral-500">全部来源聚合在一起，也可以按来源单独查看。</p>
        </div>
        <Button
          variant="glass"
          onClick={() => onRefresh?.(likedSource)}
          disabled={likedSource === "local" || refreshing}
          title={likedSource === "local" ? "本地红心由播放页维护" : likedSource === "all" ? "同时同步网易云与 QQ 音乐" : "重新同步当前音源的喜欢列表"}
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} />
          {refreshing ? "同步中…" : "同步红心"}
        </Button>
      </div>

      <div className="mt-6 flex shrink-0 flex-wrap items-center gap-2">
        {(
          [
            ["all", "全部", allTracks.length, null],
            ["local", "本地", localTracks.length, "local"],
            ["netease", "网易云", neteaseTracks.length, "netease"],
            ["qq", "QQ 音乐", qqTracks.length, "qq"],
          ] as const
        ).map(([source, label, count, logo]) => {
          const activeSource = likedSource === source;
          return (
            <button
              key={source}
              type="button"
              aria-pressed={activeSource}
              onClick={() => setLikedSource(source)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                activeSource
                  ? "border-neutral-950 bg-neutral-950 text-white"
                  : "border-white/70 bg-white/60 text-neutral-500 hover:bg-white",
              )}
            >
              {logo && <SourceLogo source={logo} className="size-3.5" />}
              {label} {count}
            </button>
          );
        })}
      </div>

      <div className="mt-5 grid min-h-0 flex-1">
        <LikedColumn title={active.title} subtitle={active.subtitle} emptyText={active.emptyText} tracks={active.tracks} onPickTrack={onPickTrack} />
      </div>
    </div>
  );
}

function LikedColumn({
  title,
  subtitle,
  emptyText,
  tracks,
  onPickTrack,
}: {
  title: string;
  subtitle: string;
  emptyText: string;
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
                className="absolute left-0 right-0 grid h-16 w-full grid-cols-[3rem_minmax(0,1fr)_auto_1.75rem] items-center gap-3 rounded-[1rem] p-2 text-left transition hover:bg-white/75"
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
                    <span className="text-neutral-400"> · {sourceLabel[track.source]}</span>
                  </p>
                </div>
                <Badge className="hidden sm:inline-flex">{formatAudioDetail(track)}</Badge>
                <span className="flex size-7 items-center justify-center rounded-full bg-white/70">
                  <Heart className="size-4 fill-neutral-950" />
                </span>
              </button>
            );
          })}
        </div>
        {!tracks.length && <EmptyState text={emptyText} />}
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
  onDeletePlaylist,
  local,
  qq,
  initialSource = null,
}: {
  playlists: ProviderPlaylist[];
  local: LocalPlaylistSurfaceProps;
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
  onDeletePlaylist: (id: string) => Promise<void>;
  qq: {
    connected: boolean;
    playlists: ProviderPlaylist[];
    selectedPlaylist: ProviderPlaylist | null;
    tracks: Track[];
    loading: boolean;
    error: string | null;
    onOpen: (playlist: ProviderPlaylist) => void;
    onClose: () => void;
    onPickTrack: (id: string, queue?: Track[]) => void;
  };
  /** 从搜索/探索直接打开某个来源的歌单时强制初始标签。 */
  initialSource?: "netease" | "local" | "qq" | null;
}) {
  const [playlistFilter, setPlaylistFilter] = useState<"all" | "owned" | "saved">("all");
  const [playlistSource, setPlaylistSource] = useState<"netease" | "local" | "qq">(() =>
    initialSource ?? (qq.connected && !canCreatePlaylist ? "qq" : "netease"),
  );
  const playlistConnectionRef = useRef({ netease: canCreatePlaylist, qq: qq.connected });
  useEffect(() => {
    const previous = playlistConnectionRef.current;
    if (!previous.qq && qq.connected && !canCreatePlaylist) setPlaylistSource("qq");
    if (!previous.netease && canCreatePlaylist && !qq.connected) setPlaylistSource("netease");
    playlistConnectionRef.current = { netease: canCreatePlaylist, qq: qq.connected };
  }, [canCreatePlaylist, qq.connected]);
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

  if (playlistSource === "local") {
    return <LocalPlaylistSurface {...local} onOpenNetease={() => setPlaylistSource("netease")} />;
  }

  if (playlistSource === "qq") {
    if (qq.selectedPlaylist) {
      const selectedPlaylist = qq.selectedPlaylist;
      return <PlaylistDetail key={selectedPlaylist.id} playlist={selectedPlaylist} tracks={qq.tracks} loading={qq.loading} error={qq.error} connected={false} showSubscribe={false} playCounts={playCounts}
        onBack={qq.onClose} onRetry={() => qq.onOpen(selectedPlaylist)} onPickTrack={qq.onPickTrack}
        onUpdate={async () => {}} onUploadCover={async () => {}} onRemove={async () => {}} onReorder={async () => {}}
        onSubscribe={async () => {}} onDelete={async () => {}} onRequireLogin={onRequireLogin} />;
    }
    return (
      <div className="glass no-scrollbar h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Badge>Playlist</Badge>
            <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">QQ 音乐歌单</h1>
            <p className="mt-3 text-sm text-neutral-500">只读同步：播放你 QQ 音乐账号里的歌单，整理请前往 QQ 音乐。</p>
          </div>
        </div>
        {qq.error && (
          <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            <span>{qq.error}</span>
            <Button size="sm" onClick={onRequireLogin}>前往登录</Button>
          </div>
        )}
        <SourceTabs playlistSource="qq" onSelect={setPlaylistSource} />
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {qq.playlists.map((playlist) => (
            <button
              key={playlist.id}
              className="min-h-48 overflow-hidden rounded-[1.75rem] bg-white/52 p-5 text-left shadow-sm transition hover:-translate-y-1 hover:bg-white"
              onClick={() => qq.onOpen(playlist)}
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
              <p className="mt-2 text-sm text-neutral-500">{playlist.trackCount ? `${playlist.trackCount} 首` : "在 QQ 音乐中查看"}</p>
              <Badge className="mt-5">{playlist.owned ? "创建歌单" : "收藏歌单"}</Badge>
            </button>
          ))}
        </div>
        {!qq.playlists.length && !qq.error && <EmptyState text={qq.connected ? "还没有可同步的 QQ 音乐歌单。" : "登录 QQ 音乐后即可同步“我喜欢”和你的歌单。"} />}
      </div>
    );
  }

  if (selectedPlaylist) {
    return <PlaylistDetail key={selectedPlaylist.id} playlist={selectedPlaylist} tracks={tracks} loading={loading} error={error} connected={canCreatePlaylist} playCounts={playCounts}
      onBack={onClosePlaylist} onRetry={() => onOpenPlaylist(selectedPlaylist)} onPickTrack={onPickTrack}
      onUpdate={(fields) => onUpdatePlaylist(selectedPlaylist.id, fields)} onUploadCover={(file) => onUploadCover(selectedPlaylist.id, file)}
      onRemove={(items) => onRemoveTracks(selectedPlaylist.id, items)} onReorder={(items) => onReorderTracks(selectedPlaylist.id, items)}
      onSubscribe={(subscribed) => onSubscribe(selectedPlaylist.id, subscribed)} onDelete={() => onDeletePlaylist(selectedPlaylist.id)} onRequireLogin={onRequireLogin} />;
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
      <SourceTabs playlistSource={playlistSource} onSelect={(source) => { setCreateOpen(false); setPlaylistSource(source); }} />
      <div className="mt-4 flex flex-wrap gap-2">
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

function SourceTabs({ playlistSource, onSelect }: {
  playlistSource: "netease" | "local" | "qq";
  onSelect: (source: "netease" | "local" | "qq") => void;
}) {
  return (
    <div className="mt-6">
      <SourceToggle value={playlistSource} onChange={onSelect} options={["netease", "qq", "local"]} ariaLabel="歌单来源" />
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
