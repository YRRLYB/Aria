import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Cloud, Disc3, Heart, LoaderCircle, Play, Plus, Radio, RefreshCw, Sparkles } from "lucide-react";
import { AriaIcon } from "@/components/icons/aria";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Track } from "@/data/music";
import type { ProviderPlaylist } from "@/lib/api";
import { computeListeningInsights, formatListeningDuration } from "@/lib/listeningStats";
import type { PlayHistoryEntry } from "@/lib/playHistory";
import { formatAudioDetail, mergeTracks } from "@/lib/playerPresentation";
import { useVirtualRows } from "@/lib/virtualRows";
import { cn } from "@/lib/utils";
import { SourceBadge, SourceLogo, SourceToggle, type SourceToggleOption } from "./SourceLogos";
import { ArtworkImage } from "./ArtworkImage";
import { PlaylistDetail } from "./PlaylistDetail";
import { AddToPlaylistButton } from "./PlaylistActions";
import { LocalPlaylistSurface, type LocalPlaylistSurfaceProps } from "./LocalPlaylistSurfaces";
import { CopyableTrackText, CoverArt, EmptyState } from "./shared";

type LikedSource = "all" | SourceToggleOption | "bilibili";

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
  bilibiliTracks,
  neteaseConnected,
  qqConnected,
  bilibiliConnected,
  bilibiliError = null,
  refreshing = false,
  onRefresh,
  onVisibleTracksChange,
  onPickTrack,
}: {
  localTracks: Track[];
  neteaseTracks: Track[];
  qqTracks: Track[];
  bilibiliTracks: Track[];
  neteaseConnected: boolean;
  qqConnected: boolean;
  bilibiliConnected: boolean;
  bilibiliError?: string | null;
  refreshing?: boolean;
  onRefresh?: (source: LikedSource) => void;
  onVisibleTracksChange?: (tracks: Track[]) => void;
  onPickTrack: (id: string) => void;
}) {
  // 全部来源聚合是默认视图；来源按钮仍可单独查看。
  const [likedSource, setLikedSource] = useState<LikedSource>("all");
  const connectionRef = useRef({ neteaseConnected, qqConnected, bilibiliConnected });
  useEffect(() => {
    const previous = connectionRef.current;
    if (!previous.qqConnected && qqConnected && !neteaseConnected && likedSource === "netease") setLikedSource("qq");
    if (!previous.neteaseConnected && neteaseConnected && !qqConnected && likedSource === "qq") setLikedSource("netease");
    connectionRef.current = { neteaseConnected, qqConnected, bilibiliConnected };
  }, [neteaseConnected, qqConnected, bilibiliConnected, likedSource]);

  const allTracks = useMemo(
    () => mergeTracks([...localTracks, ...neteaseTracks, ...qqTracks, ...bilibiliTracks]),
    [localTracks, neteaseTracks, qqTracks, bilibiliTracks],
  );
  const columns: Record<LikedSource, { title: string; subtitle: string; emptyText: string; tracks: Track[] }> = {
    all: {
      title: "全部喜欢",
      subtitle: `本地、网易云、QQ 音乐与 B站共 ${allTracks.length} 首`,
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
    bilibili: {
      title: "B站收藏",
      subtitle: bilibiliConnected
        ? bilibiliError
          ? "B站收藏读取失败"
          : `B站「Aria」收藏夹已同步 ${bilibiliTracks.length} 首`
        : "扫码登录后读取「Aria」收藏夹",
      emptyText: bilibiliConnected
        ? bilibiliError ?? "B站「Aria」收藏夹暂无视频；在播放页点亮红心会自动创建并加入。"
        : "登录B站后即可同步「Aria」收藏夹。",
      tracks: bilibiliTracks,
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
          title={likedSource === "local" ? "本地红心由播放页维护" : likedSource === "all" ? "同时同步网易云、QQ 音乐与 B站" : "重新同步当前音源的喜欢列表"}
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
            ["bilibili", "B站", bilibiliTracks.length, "bilibili"],
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

      {bilibiliConnected && bilibiliError && (likedSource === "all" || likedSource === "bilibili") && (
        <p role="alert" className="mt-3 shrink-0 rounded-2xl bg-amber-50 px-4 py-2 text-xs text-amber-700">
          B站：{bilibiliError}
        </p>
      )}

      <div className="mt-5 grid min-h-0 flex-1">
        <LikedColumn
          title={active.title}
          subtitle={active.subtitle}
          emptyText={active.emptyText}
          tracks={active.tracks}
          onVisibleTracksChange={onVisibleTracksChange}
          onPickTrack={onPickTrack}
        />
      </div>
    </div>
  );
}

function LikedColumn({
  title,
  subtitle,
  emptyText,
  tracks,
  onVisibleTracksChange,
  onPickTrack,
}: {
  title: string;
  subtitle: string;
  emptyText: string;
  tracks: Track[];
  onVisibleTracksChange?: (tracks: Track[]) => void;
  onPickTrack: (id: string) => void;
}) {
  const virtual = useVirtualRows({ count: tracks.length, rowHeight: 72, overscan: 10 });
  const visibleTracks = useMemo(
    () => virtual.rows.map(({ index }) => tracks[index]).filter((track): track is Track => Boolean(track)),
    [tracks, virtual.rows],
  );
  const visibleSignature = useMemo(
    () => visibleTracks.map((track) => `${track.id}:${track.bitrate ?? ""}`).join("|"),
    [visibleTracks],
  );
  const onVisibleTracksChangeRef = useRef(onVisibleTracksChange);
  onVisibleTracksChangeRef.current = onVisibleTracksChange;
  useEffect(() => {
    if (!visibleTracks.length) return;
    onVisibleTracksChangeRef.current?.(visibleTracks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSignature]);

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
                  <p className="truncate text-sm font-semibold" title={track.title}>
                    <CopyableTrackText track={track} field="title">{track.title}</CopyableTrackText>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">
                    <CopyableTrackText track={track} field="artist">{track.artist}</CopyableTrackText>
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1.5">
                  <SourceBadge source={track.source} compact />
                  <Badge className="inline-flex shrink-0 whitespace-nowrap">{formatAudioDetail(track)}</Badge>
                </span>
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

export function StatsSurface({
  tracks,
  playCounts,
  playHistory = [],
  activeTrackId,
  playing = false,
  onPickTrack,
}: {
  tracks: Track[];
  playCounts: Record<string, number>;
  playHistory?: PlayHistoryEntry[];
  activeTrackId?: string;
  playing?: boolean;
  onPickTrack?: (id: string, queue?: Track[]) => void;
}) {
  const insights = useMemo(
    () => computeListeningInsights(tracks, playCounts, playHistory),
    [tracks, playCounts, playHistory],
  );
  const topTracksQueue = useMemo(() => insights.topTracks.map((item) => item.track), [insights.topTracks]);
  const leadArtist = insights.topArtists[0] ?? null;

  return (
    <div className="stats-surface glass no-scrollbar h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-[var(--accent)]">Listening Insights</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">听歌洞察</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">{insights.personaDetail}</p>
        </div>
        <div className="stats-persona-pill inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-xs font-semibold shadow-sm">
          <Sparkles className="size-3.5 text-[var(--accent)]" />
          <span>{insights.personaLabel}</span>
          {insights.activeDays > 0 && (
            <span className="text-[var(--text-secondary)]">· 活跃 {insights.activeDays} 天</span>
          )}
        </div>
      </div>

      <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="stats-kpi-card rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)]">
            <span>累计聆听时长</span>
            <Clock3 className="size-3.5 text-[var(--accent)]" />
          </div>
          <p className="mt-2.5 truncate text-2xl font-semibold tracking-tight tabular-nums">
            {formatListeningDuration(insights.estimatedSeconds)}
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
            {insights.uniquePlayedTracks > 0 ? `涵盖 ${insights.uniquePlayedTracks} 首曲目` : "播放后开始估算"}
          </p>
        </div>

        <div className="stats-kpi-card rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)]">
            <span>总播放次数</span>
            <Play className="size-3.5 text-[var(--accent)]" />
          </div>
          <p className="mt-2.5 truncate text-2xl font-semibold tracking-tight tabular-nums">
            {insights.totalPlays} <span className="text-sm font-medium text-[var(--text-secondary)]">次</span>
          </p>
          <p className="mt-1 truncate text-[11px] text-[var(--text-secondary)]">
            {insights.topTracks[0] ? `最常循环：${insights.topTracks[0].track.title}` : `曲库共 ${insights.libraryTotal} 首`}
          </p>
        </div>

        <div className="stats-kpi-card rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)]">
            <span>偏爱歌手</span>
            <Disc3 className="size-3.5 text-[var(--accent)]" />
          </div>
          <p className="mt-2.5 truncate text-2xl font-semibold tracking-tight">
            {leadArtist ? (
              <CopyableTrackText track={leadArtist.leadTrack} field="artist">
                {leadArtist.name}
              </CopyableTrackText>
            ) : (
              "暂无数据"
            )}
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
            {leadArtist ? `${leadArtist.playCount} 次播放 · ${leadArtist.trackCount} 首作品` : "等待你的第一张常听清单"}
          </p>
        </div>

        <div className="stats-kpi-card rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)]">
            <span>多音源曲库</span>
            <Radio className="size-3.5 text-[var(--accent)]" />
          </div>
          <p className="mt-2.5 truncate text-2xl font-semibold tracking-tight tabular-nums">
            {insights.libraryTotal} <span className="text-sm font-medium text-[var(--text-secondary)]">首</span>
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
            横跨 {insights.activeSourceCount} 个在线 / 本地音源
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="stats-panel rounded-[1.35rem] border border-[var(--line)] bg-[var(--surface)] p-5" aria-label="24 小时听歌节律">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">24 小时听歌节律</h2>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                {insights.peakHour !== null
                  ? `最活跃时段 ${String(insights.peakHour).padStart(2, "0")}:00 – ${String((insights.peakHour + 1) % 24).padStart(2, "0")}:00`
                  : "按一天 24 小时统计你的活跃波峰"}
              </p>
            </div>
            <Badge className="tabular-nums">
              {insights.peakHour !== null ? `${String(insights.peakHour).padStart(2, "0")}:00 PEAK` : "00–24H"}
            </Badge>
          </div>

          <div className="stats-rhythm-bars mt-5 flex h-28 items-end gap-1" role="list">
            {insights.hourly.map((bucket) => {
              const isPeak = insights.peakHour === bucket.hour && bucket.count > 0;
              const heightPct = bucket.count > 0 ? Math.max(12, Math.round(bucket.intensity * 100)) : 6;
              return (
                <div
                  key={bucket.hour}
                  role="listitem"
                  title={`${bucket.label} · ${bucket.count} 次`}
                  className="group relative flex h-full flex-1 items-end"
                >
                  <div
                    className={cn(
                      "w-full rounded-t-md transition-all duration-300",
                      bucket.count === 0
                        ? "bg-[var(--line)] opacity-60"
                        : isPeak
                          ? "bg-[var(--accent)] shadow-[0_0_12px_rgba(124,92,230,0.45)]"
                          : "bg-[var(--accent)]/45 group-hover:bg-[var(--accent)]/80",
                    )}
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] font-medium tabular-nums text-[var(--text-secondary)]">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>24:00</span>
          </div>
        </section>

        <section className="stats-panel rounded-[1.35rem] border border-[var(--line)] bg-[var(--surface)] p-5" aria-label="多音源聆听版图">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">多音源聆听版图</h2>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                {insights.totalPlays > 0 ? "按真实播放次数加权统计各音源占比" : "当前展示曲库分布，播放后自动切换为聆听占比"}
              </p>
            </div>
            <Badge>{insights.activeSourceCount} 源</Badge>
          </div>

          <div className="mt-5 flex h-3 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]">
            {insights.sources.map((item) =>
              item.share > 0 ? (
                <div
                  key={item.source}
                  title={`${item.label} ${Math.round(item.share)}%`}
                  style={{ width: `${item.share}%`, backgroundColor: item.color }}
                  className="h-full transition-all duration-300 first:rounded-l-full last:rounded-r-full"
                />
              ) : null,
            )}
          </div>

          <div className="mt-4 grid gap-2">
            {insights.sources.map((item) => (
              <div
                key={item.source}
                className="flex items-center gap-3 rounded-xl bg-[var(--surface-muted)]/60 px-3 py-2 text-xs"
              >
                <SourceLogo source={item.source} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                <span className="tabular-nums text-[var(--text-secondary)]">曲库 {item.libraryCount} 首</span>
                <span className="w-20 text-right font-semibold tabular-nums">
                  {item.playCount > 0 ? `${item.playCount} 次 (${Math.round(item.share)}%)` : `${Math.round(item.share)}%`}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section className="stats-panel rounded-[1.35rem] border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">常听歌手榜</h2>
            <Badge>{insights.topArtists.length} 位</Badge>
          </div>
          {insights.topArtists.length ? (
            <div className="mt-4 space-y-2.5">
              {insights.topArtists.map((artist, index) => (
                <div
                  key={artist.name}
                  className="rounded-xl bg-[var(--surface-muted)]/60 p-3 transition hover:bg-[var(--surface-muted)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums",
                          index === 0
                            ? "bg-[var(--accent)] text-white"
                            : "bg-[var(--surface)] text-[var(--text-secondary)]",
                        )}
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          <CopyableTrackText track={artist.leadTrack} field="artist">
                            {artist.name}
                          </CopyableTrackText>
                        </p>
                        <p className="truncate text-[11px] text-[var(--text-secondary)]">
                          覆盖 {artist.trackCount} 首 · 代表：{artist.leadTrack.title}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                      {artist.playCount} 次
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)]/80"
                      style={{ width: `${Math.max(8, Math.round(artist.share * 100))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState text="还没有歌手聆听记录，播几首歌这里就会立体起来。" />
            </div>
          )}
        </section>

        <section className="stats-panel rounded-[1.35rem] border border-[var(--line)] bg-[var(--surface)] p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">单曲循环榜</h2>
            <Badge>{insights.topTracks.length} 首</Badge>
          </div>
          {insights.topTracks.length ? (
            <div className="mt-4 space-y-2">
              {insights.topTracks.map((item, index) => {
                const isActive = activeTrackId === item.track.id;
                return (
                  <button
                    key={item.track.id}
                    type="button"
                    onClick={() => onPickTrack?.(item.track.id, topTracksQueue)}
                    className={cn(
                      "group grid w-full grid-cols-[1.6rem_2.75rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2.5 py-2 text-left transition",
                      isActive ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]/35" : "hover:bg-[var(--surface-muted)]",
                    )}
                  >
                    <span
                      className={cn(
                        "text-center text-xs font-bold tabular-nums",
                        index < 3 ? "text-[var(--accent)]" : "text-[var(--text-secondary)]",
                      )}
                    >
                      {index + 1}
                    </span>
                    <CoverArt track={item.track} className="size-11 rounded-lg" />
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0 truncate text-sm font-semibold">
                          <CopyableTrackText track={item.track} field="title">
                            {item.track.title}
                          </CopyableTrackText>
                        </span>
                        <SourceBadge source={item.track.source} compact />
                      </div>
                      <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                        <span className="truncate">
                          <CopyableTrackText track={item.track} field="artist">
                            {item.track.artist}
                          </CopyableTrackText>
                        </span>
                        {item.audioDetail && (
                          <span className="shrink-0 whitespace-nowrap opacity-70">· {item.audioDetail}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <div className="hidden w-16 sm:block">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
                          <div
                            className="h-full rounded-full bg-[var(--accent)]"
                            style={{ width: `${Math.max(10, Math.round(item.share * 100))}%` }}
                          />
                        </div>
                      </div>
                      <span className="w-12 text-right text-xs font-semibold tabular-nums text-[var(--text-secondary)]">
                        {item.playCount} 次
                      </span>
                      {isActive && playing ? (
                        <AriaIcon name="playing" className="size-4 shrink-0 text-[var(--accent)]" />
                      ) : (
                        <Play className="size-3.5 shrink-0 opacity-0 transition group-hover:opacity-80" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-4">
              <EmptyState text="先播放几首歌，单曲循环榜和听歌时间画像就会在这里呈现。" />
            </div>
          )}
        </section>
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
              <span className="flex shrink-0 flex-nowrap items-center justify-end gap-2">{renderMeta ? renderMeta(track) : <Badge className="shrink-0 whitespace-nowrap">{formatAudioDetail(track)}</Badge>}<AddToPlaylistButton track={track} /></span>
            </div>
          );
        })}
      </div>
      {!tracks.length && <EmptyState text={emptyText} />}
    </div>
  );
}
