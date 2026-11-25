import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Cloud, Disc3, Heart, Link2, LoaderCircle, Play, Plus, Radio, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { AriaIcon } from "@/components/icons/aria";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Track } from "@/data/music";
import type { ProviderPlaylist } from "@/lib/api";
import { api } from "@/lib/api";
import type { LocalPlaylist, LocalPlaylistRemoteRef, PlaylistInsertPosition } from "@/lib/localPlaylists";
import { computeListeningInsights, formatListeningDuration } from "@/lib/listeningStats";
import type { PlayHistoryEntry } from "@/lib/playHistory";
import { formatAudioDetail, mergeTracks } from "@/lib/playerPresentation";
import { providerTrackToUiTrack } from "@/lib/trackMappers";
import { useVirtualRows } from "@/lib/virtualRows";
import { cn } from "@/lib/utils";
import { SourceBadge, SourceLogo, SourceToggle, type SourceToggleOption } from "./SourceLogos";
import { ArtworkImage } from "./ArtworkImage";
import { PlaylistDetail } from "./PlaylistDetail";
import { AddToPlaylistButton } from "./PlaylistActions";
import { BilibiliLinkDialog, LocalPlaylistDetail, LocalPlaylistSurface, type LocalPlaylistSurfaceProps } from "./LocalPlaylistSurfaces";
import type { PickerPlaylistCatalog } from "./PlaylistTrackBrowser";
import { SuperMixSurface, type SuperMixSurfaceProps } from "./SuperMixSurfaces";
import { CopyableTrackText, CoverArt, EmptyState } from "./shared";

// 我喜欢页的来源筛选。YouTube v1 不提供账号收藏（capabilities.liked=false），
// 因此这里显式列出四源，不随 SourceToggleOption 自动扩展。
type LikedSource = "all" | "local" | "netease" | "qq" | "bilibili" | "youtube";

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
  onPickTrack: (id: string, queue?: Track[]) => void;
  /** 多源切换:每日推荐/私人漫游等聚合页按 logo 切换网易云、QQ 与 YouTube。*/
  sourceToggle?: { value: "netease" | "qq" | "youtube"; onChange: (source: "netease" | "qq" | "youtube") => void };
  emptyText?: string;
  loading?: boolean;
  error?: string | null;
}) {
  return (
    <div className="aria-page-shell flex h-full min-h-[620px] flex-col overflow-hidden rounded-[1.5rem] p-5 sm:p-7">
      <div className="aria-page-header flex shrink-0 items-center justify-between gap-3 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="aria-flat-well flex size-10 shrink-0 items-center justify-center rounded-xl">{icon}</div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
            <p className="mt-1 text-xs text-neutral-500">{subtitle}</p>
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
              if (source === "netease" || source === "qq" || source === "youtube") sourceToggle.onChange(source);
            }}
            options={["netease", "qq", "youtube"]}
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
  youtubeTracks = [],
  neteaseConnected,
  qqConnected,
  bilibiliConnected,
  youtubeConnected = false,
  bilibiliError = null,
  youtubeError = null,
  refreshing = false,
  onRefresh,
  onVisibleTracksChange,
  onPickTrack,
}: {
  localTracks: Track[];
  neteaseTracks: Track[];
  qqTracks: Track[];
  bilibiliTracks: Track[];
  youtubeTracks?: Track[];
  neteaseConnected: boolean;
  qqConnected: boolean;
  bilibiliConnected: boolean;
  youtubeConnected?: boolean;
  bilibiliError?: string | null;
  youtubeError?: string | null;
  refreshing?: boolean;
  onRefresh?: (source: LikedSource) => void;
  onVisibleTracksChange?: (tracks: Track[]) => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
}) {
  // 全部来源聚合是默认视图；来源按钮仍可单独查看。
  const [likedSource, setLikedSource] = useState<LikedSource>("all");
  const connectionRef = useRef({ neteaseConnected, qqConnected, bilibiliConnected, youtubeConnected });
  useEffect(() => {
    const previous = connectionRef.current;
    if (!previous.qqConnected && qqConnected && !neteaseConnected && likedSource === "netease") setLikedSource("qq");
    if (!previous.neteaseConnected && neteaseConnected && !qqConnected && likedSource === "qq") setLikedSource("netease");
    connectionRef.current = { neteaseConnected, qqConnected, bilibiliConnected, youtubeConnected };
  }, [neteaseConnected, qqConnected, bilibiliConnected, youtubeConnected, likedSource]);

  const allTracks = useMemo(
    () => mergeTracks([...localTracks, ...neteaseTracks, ...qqTracks, ...bilibiliTracks, ...youtubeTracks]),
    [localTracks, neteaseTracks, qqTracks, bilibiliTracks, youtubeTracks],
  );
  const columns: Record<LikedSource, { title: string; subtitle: string; emptyText: string; tracks: Track[] }> = {
    all: {
      title: "全部喜欢",
      subtitle: `本地、网易云、QQ 音乐、B站、YouTube 共 ${allTracks.length} 首`,
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
      subtitle: neteaseConnected ? `网易云账号已同步 ${neteaseTracks.length} 首` : "扫码或 Cookie 登录后读取。",
      emptyText: neteaseConnected ? "网易云账号暂无红心歌曲。" : "登录网易云后即可同步红心歌曲。",
      tracks: neteaseTracks,
    },
    qq: {
      title: "QQ 音乐我喜欢",
      subtitle: qqConnected
        ? qqTracks.length
          ? `QQ 音乐账号已同步 ${qqTracks.length} 首`
          : "QQ 音乐账号暂无红心歌曲"
        : "登录 QQ 音乐后读取。",
      emptyText: qqConnected
        ? "QQ 音乐账号暂无红心歌曲；如果刚在手机上点过红心，点右上角「同步红心」再试一次。"
        : "登录 QQ 音乐后即可同步红心歌曲。",
      tracks: qqTracks,
    },
    youtube: {
      title: "YouTube 赞过的音乐",
      subtitle: youtubeConnected
        ? youtubeError
          ? "YouTube 喜欢的音乐读取失败。"
          : `YouTube Music 已同步 ${youtubeTracks.length} 首`
        : "登录 YouTube 账号后读取「赞过的音乐」",
      emptyText: youtubeConnected
        ? youtubeError ?? "YouTube「赞过的音乐」暂无曲目；在 YouTube Music 或播放页点亮红心后会同步到这里。"
        : "在设置里登录 YouTube 后即可同步喜欢的音乐。",
      tracks: youtubeTracks,
    },
    bilibili: {
      title: "B站收藏",
      subtitle: bilibiliConnected
        ? bilibiliError
          ? "B站收藏读取失败。"
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
    <div className="aria-page-shell flex h-full min-h-[620px] flex-col overflow-hidden rounded-[1.5rem] p-5 sm:p-7">
      <div className="aria-page-header flex shrink-0 flex-col gap-4 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">我喜欢</h1>
          <p className="mt-1 text-xs text-neutral-500">全部来源聚合在一起，也可以按来源单独查看。</p>
        </div>
        <Button
          variant="glass"
          size="sm"
          onClick={() => onRefresh?.(likedSource)}
          disabled={likedSource === "local" || refreshing}
          title={likedSource === "local" ? "本地红心由播放页维护" : likedSource === "all" ? "同时同步网易云、QQ 音乐、B站与 YouTube" : "重新同步当前音源的喜欢列表"}
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
            ["youtube", "YouTube", youtubeTracks.length, "youtube"],
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
                "aria-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
                activeSource && "is-active",
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
      {youtubeConnected && youtubeError && (likedSource === "all" || likedSource === "youtube") && (
        <p role="alert" className="mt-3 shrink-0 rounded-2xl bg-amber-50 px-4 py-2 text-xs text-amber-700">
          YouTube：{youtubeError}
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
  onPickTrack: (id: string, queue?: Track[]) => void;
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
    <section className="flex min-h-0 flex-col">
      <div className="aria-section-divider flex shrink-0 items-center justify-between gap-3 border-b pb-2.5">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <p className="text-xs text-neutral-500">{subtitle}</p>
        </div>
        <span className="text-xs text-neutral-400 tabular-nums">{tracks.length} 首</span>
      </div>
      <div ref={virtual.containerRef} className="no-scrollbar mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="relative" style={{ height: virtual.totalHeight }}>
          {virtual.rows.map(({ index, offsetTop }) => {
            const track = tracks[index];
            if (!track) return null;
            return (
              <button
                key={track.id}
                className="aria-flat-row absolute left-0 right-0 grid h-16 w-full grid-cols-[3rem_minmax(0,1fr)_auto_1.75rem] items-center gap-3 rounded-xl px-2.5 text-left"
                style={{ top: offsetTop }}
                onClick={() => onPickTrack(track.id, tracks)}
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

export type PlaylistSourceTab = "super-mix" | "netease" | "local" | "qq" | "bilibili" | "youtube";

/** YouTube Music 歌单标签的数据包：账号播放列表（只读）。*/
export type PlaylistSurfacePropsYoutube = {
  connected: boolean;
  playlists: ProviderPlaylist[];
  loading: boolean;
  error: string | null;
  selectedPlaylist: ProviderPlaylist | null;
  tracks: Track[];
  tracksLoading: boolean;
  tracksError: string | null;
  onOpen: (playlist: ProviderPlaylist) => void;
  onClose: () => void;
  onRefresh: () => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
  onRequireLogin: () => void;
};

export type BilibiliPlaylistTabProps = {
  connected: boolean;
  playlists: ProviderPlaylist[];
  loading: boolean;
  error: string | null;
  selectedPlaylist: ProviderPlaylist | null;
  tracks: Track[];
  tracksLoading: boolean;
  tracksError: string | null;
  playCounts: Record<string, number>;
  /** 通过链接引用进来的B站收藏夹/合集镜像（存在 Aria 歌单里）。*/
  referencedPlaylists: LocalPlaylist[];
  onOpen: (playlist: ProviderPlaylist) => void;
  onClose: () => void;
  onRefresh: () => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
  onRequireLogin: () => void;
  onCreateReference: (name: string, tracks: Track[], remoteRef: LocalPlaylistRemoteRef) => LocalPlaylist;
  onSyncReference: (id: string, tracks: Track[], title?: string) => void;
  onOpenReferenced: (id: string) => void;
  onDeleteReferenced?: (id: string) => void;
  selectedReferencedPlaylist?: LocalPlaylist | null;
  selectedReferencedTracks?: Track[];
  allTracks?: Track[];
  onCloseReferenced?: () => void;
  onRenameReferenced?: (id: string, name: string) => void;
  onAddReferenced?: (id: string, tracks: Track[], position?: PlaylistInsertPosition) => void;
  onRemoveReferenced?: (id: string, tracks: Track[]) => void;
  onReorderReferenced?: (id: string, orderedTracks: Track[]) => void;
};

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
  superMix,
  local,
  qq,
  bilibili,
  youtube,
  initialSource = null,
  sourceRequest = null,
}: {
  playlists: ProviderPlaylist[];
  superMix?: SuperMixSurfaceProps;
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
  bilibili: BilibiliPlaylistTabProps;
  youtube: PlaylistSurfacePropsYoutube;
  /** 从搜索/探索直接打开某个来源的歌单时强制初始标签。*/
  initialSource?: PlaylistSourceTab | null;
  /**
   * 页面已停留在歌单页时，父组件临时下发的来源切换请求（比如从B站标签点开
   * 引用镜像后跳回 Aria 歌单页）。nonce 保证同一来源的重复请求也会生效。"
   */
  sourceRequest?: { source: PlaylistSourceTab; nonce: number } | null;
}) {
  const [playlistFilter, setPlaylistFilter] = useState<"all" | "owned" | "saved">("all");
  const [playlistSource, setPlaylistSource] = useState<PlaylistSourceTab>(() =>
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

  // 父组件（如B站标签）在页面停留期间请求切换来源标签。"
  useEffect(() => {
    if (sourceRequest) setPlaylistSource(sourceRequest.source);
  }, [sourceRequest]);

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

  const pickerCatalog = useMemo<Omit<PickerPlaylistCatalog, "allTracks">>(() => ({
    neteasePlaylists: playlists,
    localPlaylists: [...local.playlists, ...bilibili.referencedPlaylists],
    qqPlaylists: qq.playlists,
    bilibiliPlaylists: bilibili.playlists,
    youtubePlaylists: youtube.playlists,
  }), [playlists, local.playlists, bilibili.referencedPlaylists, qq.playlists, bilibili.playlists, youtube.playlists]);

  if (playlistSource === "super-mix" && superMix) {
    return (
      <SuperMixSurface
        {...superMix}
        pickerCatalog={pickerCatalog}
        headerTabs={<SourceTabs playlistSource="super-mix" onSelect={(source) => { setCreateOpen(false); setPlaylistSource(source); }} />}
      />
    );
  }

  if (playlistSource === "local") {
    return (
      <LocalPlaylistSurface
        {...local}
        pickerCatalog={pickerCatalog}
        headerTabs={<SourceTabs playlistSource="local" onSelect={(source) => { setCreateOpen(false); setPlaylistSource(source); }} />}
      />
    );
  }

  if (playlistSource === "bilibili") {
    return <BilibiliPlaylistTab bilibili={bilibili} playCounts={playCounts} pickerCatalog={pickerCatalog} onRequireLogin={onRequireLogin} onSelectSource={setPlaylistSource} />;
  }

  if (playlistSource === "youtube") {
    return <YoutubePlaylistTab youtube={youtube} playCounts={playCounts} onRequireLogin={onRequireLogin} onSelectSource={setPlaylistSource} />;
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
      <div className="aria-page-shell no-scrollbar h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-7">
        <div className="aria-page-header flex items-center justify-between gap-4 pb-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">QQ 音乐歌单</h1>
            <p className="mt-1 text-xs text-neutral-500">只读同步：播放你 QQ 音乐账号里的歌单，整理请前往 QQ 音乐。</p>
          </div>
        </div>
        {qq.error && (
          <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            <span>{qq.error}</span>
            <Button size="sm" onClick={onRequireLogin}>前往登录</Button>
          </div>
        )}
        <SourceTabs playlistSource="qq" onSelect={setPlaylistSource} />
        <div className="mt-5 grid gap-3.5 md:grid-cols-3">
          {qq.playlists.map((playlist) => (
            <button
              key={playlist.id}
              className="aria-flat-tile flex flex-col rounded-2xl p-4 text-left"
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
                  className="size-14 rounded-xl object-cover"
                />
              ) : (
                <Cloud className="size-6 text-neutral-500" />
              )}
              <h2 className="mt-5 line-clamp-2 text-lg font-semibold leading-snug">{playlist.name}</h2>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-neutral-500">
                <span>{playlist.trackCount ? `${playlist.trackCount} 首` : "在 QQ 音乐中查看"}</span>
                <span>{playlist.owned ? "创建歌单" : "收藏歌单"}</span>
              </div>
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
    <div className="aria-page-shell no-scrollbar h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-7">
      <div className="aria-page-header flex items-center justify-between gap-4 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">歌单</h1>
        </div>
        <Button size="sm" onClick={() => {
          setCreateError(null);
          setCreateOpen((current) => !current);
        }} aria-expanded={createOpen} aria-controls="create-playlist-form" disabled={creating}>
          <Plus />
          新建
        </Button>
      </div>
      {createOpen && (
        <section id="create-playlist-form" className="aria-flat-well mt-5 rounded-2xl p-5">
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
                className="aria-flat-input w-full rounded-xl px-4 py-2.5 text-sm outline-none disabled:opacity-60"
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
              "aria-chip rounded-full px-3 py-1.5 text-xs font-medium",
              playlistFilter === value && "is-active",
            )}
            onClick={() => setPlaylistFilter(value as typeof playlistFilter)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-3.5 md:grid-cols-3">
        {visiblePlaylists.map((playlist) => (
          <button
            key={playlist.id}
            className="aria-flat-tile flex flex-col rounded-2xl p-4 text-left"
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
                className="size-14 rounded-xl object-cover"
              />
            ) : (
              <Cloud className="size-6 text-neutral-500" />
            )}
            <h2 className="mt-5 line-clamp-2 text-lg font-semibold leading-snug">{playlist.name}</h2>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-neutral-500">
              <span>{playlist.trackCount} 首</span>
              <span>{playlist.subscribed ? "收藏歌单" : "创建歌单"}</span>
            </div>
          </button>
        ))}
      </div>
      {!playlists.length && <EmptyState text="暂无歌单数据，绑定有效网易云 Cookie 后同步。" />}
    </div>
  );
}

function SourceTabs({ playlistSource, onSelect }: {
  playlistSource: PlaylistSourceTab;
  onSelect: (source: PlaylistSourceTab) => void;
}) {
  return (
    <div className="mt-6">
      <SourceToggle value={playlistSource} onChange={onSelect} options={["super-mix", "netease", "qq", "bilibili", "youtube", "local"]} ariaLabel="歌单来源" />
    </div>
  );
}

/**
 * YouTube Music 歌单标签：登录账号的音乐播放列表（含固定置顶的「喜欢的音乐」），
 * 全部只读——整理请前往 YouTube Music"
 */
function YoutubePlaylistTab({
  youtube,
  playCounts,
  onRequireLogin,
  onSelectSource,
}: {
  youtube: PlaylistSurfacePropsYoutube;
  playCounts: Record<string, number>;
  onRequireLogin: () => void;
  onSelectSource: (source: PlaylistSourceTab) => void;
}) {
  if (youtube.selectedPlaylist) {
    const selectedPlaylist = youtube.selectedPlaylist;
    return (
      <PlaylistDetail
        key={selectedPlaylist.id}
        playlist={selectedPlaylist}
        tracks={youtube.tracks}
        loading={youtube.tracksLoading}
        error={youtube.tracksError}
        connected={false}
        showSubscribe={false}
        playCounts={playCounts}
        onBack={youtube.onClose}
        onRetry={() => youtube.onOpen(selectedPlaylist)}
        onPickTrack={youtube.onPickTrack}
        onUpdate={async () => {}}
        onUploadCover={async () => {}}
        onRemove={async () => {}}
        onReorder={async () => {}}
        onSubscribe={async () => {}}
        onDelete={async () => {}}
        onRequireLogin={onRequireLogin}
      />
    );
  }

  return (
    <div className="aria-page-shell no-scrollbar h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-7">
      <div className="aria-page-header flex items-center justify-between gap-4 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">YouTube 歌单</h1>
          <p className="mt-1 text-xs text-neutral-500">
            登录后同步你账号里的音乐播放列表；「喜欢的音乐」固定排在最前面。
          </p>
        </div>
        {youtube.connected && (
          <Button variant="glass" size="sm" onClick={youtube.onRefresh} disabled={youtube.loading} aria-label="刷新 YouTube 歌单列表">
            {youtube.loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            同步歌单
          </Button>
        )}
      </div>
      {!youtube.connected && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-rose-50/70 px-4 py-3 text-sm text-neutral-600">
          <span>登录 YouTube 后即可在这里看到你的音乐歌单；搜索与播放无需登录。</span>
          <Button size="sm" onClick={onRequireLogin}>前往登录</Button>
        </div>
      )}
      {youtube.error && (
        <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{youtube.error}</span>
          <Button size="sm" onClick={onRequireLogin}>前往登录</Button>
        </div>
      )}
      <SourceTabs playlistSource="youtube" onSelect={onSelectSource} />
      <div className="mt-5 grid gap-3.5 md:grid-cols-3">
        {youtube.playlists.map((playlist) => (
          <button
            key={playlist.id}
            className="aria-flat-tile flex flex-col rounded-2xl p-4 text-left"
            onClick={() => youtube.onOpen(playlist)}
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
                className="size-14 rounded-xl object-cover"
              />
            ) : (
              <span className="flex size-14 items-center justify-center rounded-xl bg-[#ffe0e6] text-[#FF0033]">
                <SourceLogo source="youtube" className="size-6" />
              </span>
            )}
            <h2 className="mt-5 line-clamp-2 break-words text-lg font-semibold leading-snug">{playlist.name}</h2>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-neutral-500">
              <span>{playlist.trackCount ? `${playlist.trackCount} 首` : playlist.id === "FEmusic_liked_songs" ? "喜欢的音乐" : "打开查看曲目"}</span>
              <span>YouTube Music</span>
            </div>
          </button>
        ))}
      </div>
      {!youtube.playlists.length && !youtube.loading && (
        <EmptyState
          text={youtube.connected
            ? "还没有可同步的播放列表。在 YouTube Music 里创建或收藏歌单后，点上方「同步歌单」。"
            : "登录 YouTube 后，你的音乐歌单会自动同步到这里。"}
        />
      )}
    </div>
  );
}

/**
 * B站歌单 tab：登录账号的收藏夹自动同步成只读歌单；粘贴链接可引入
 * 别人的公开收藏夹或合集（存在 Aria 歌单里的同步镜像，随时刷新）。"
 */
function BilibiliPlaylistTab({
  bilibili,
  playCounts,
  pickerCatalog,
  onRequireLogin,
  onSelectSource,
}: {
  bilibili: BilibiliPlaylistTabProps;
  playCounts: Record<string, number>;
  pickerCatalog?: Omit<PickerPlaylistCatalog, "allTracks">;
  onRequireLogin: () => void;
  onSelectSource: (source: PlaylistSourceTab) => void;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function refreshMirror(playlist: LocalPlaylist) {
    if (!playlist.remoteRef || syncingId) return;
    setSyncingId(playlist.id);
    setSyncError(null);
    try {
      const resolved = await api.resolveSourceLink("bilibili", playlist.remoteRef.url);
      bilibili.onSyncReference(
        playlist.id,
        resolved.tracks.map((track, index) => providerTrackToUiTrack(track, index)),
        resolved.title,
      );
    } catch (reason) {
      setSyncError(reason instanceof Error ? reason.message : "同步B站歌单失败，请稍后重试");
    } finally {
      setSyncingId(null);
    }
  }

  if (bilibili.selectedPlaylist) {
    const selectedPlaylist = bilibili.selectedPlaylist;
    return (
      <PlaylistDetail
        key={selectedPlaylist.id}
        playlist={selectedPlaylist}
        tracks={bilibili.tracks}
        loading={bilibili.tracksLoading}
        error={bilibili.tracksError}
        connected={false}
        showSubscribe={false}
        playCounts={playCounts}
        onBack={bilibili.onClose}
        onRetry={() => bilibili.onOpen(selectedPlaylist)}
        onPickTrack={bilibili.onPickTrack}
        onUpdate={async () => {}}
        onUploadCover={async () => {}}
        onRemove={async () => {}}
        onReorder={async () => {}}
        onSubscribe={async () => {}}
        onDelete={async () => {}}
        onRequireLogin={onRequireLogin}
      />
    );
  }

  if (bilibili.selectedReferencedPlaylist) {
    const referencedPlaylist = bilibili.selectedReferencedPlaylist;
    return (
      <LocalPlaylistDetail
        key={referencedPlaylist.id}
        playlists={bilibili.referencedPlaylists}
        allTracks={bilibili.allTracks ?? []}
        selectedPlaylist={referencedPlaylist}
        selectedTracks={bilibili.selectedReferencedTracks ?? []}
        storageError={false}
        playlist={referencedPlaylist}
        backLabel="返回B站歌单"
        onOpen={bilibili.onOpenReferenced}
        onClose={() => bilibili.onCloseReferenced?.()}
        onCreate={(name, tracks = [], remoteRef) => (remoteRef ? bilibili.onCreateReference(name, tracks, remoteRef) : referencedPlaylist)}
        onRename={(id, name) => bilibili.onRenameReferenced?.(id, name)}
        onDelete={(id) => {
          bilibili.onDeleteReferenced?.(id);
          bilibili.onCloseReferenced?.();
        }}
        onAdd={(id, tracks, position) => bilibili.onAddReferenced?.(id, tracks, position)}
        onRemove={(id, tracks) => bilibili.onRemoveReferenced?.(id, tracks)}
        onReorder={bilibili.onReorderReferenced}
        pickerCatalog={pickerCatalog}
        onSyncReference={bilibili.onSyncReference}
        onPickTrack={bilibili.onPickTrack}
      />
    );
  }

  return (
    <div className="aria-page-shell no-scrollbar h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-7">
      <div className="aria-page-header flex items-center justify-between gap-4 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">B站歌单</h1>
          <p className="mt-1 text-xs text-neutral-500">
            登录后自动同步你的收藏夹；粘贴链接可以引入别人的公开收藏夹或合集。
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {bilibili.connected && (
            <Button variant="glass" size="sm" onClick={bilibili.onRefresh} disabled={bilibili.loading} aria-label="刷新B站收藏夹列表">
              {bilibili.loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              同步收藏夹
            </Button>
          )}
          <Button size="sm" onClick={() => setImportOpen(true)}>
            <Link2 />引入B站歌单
          </Button>
        </div>
      </div>
      {!bilibili.connected && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-violet-50/70 px-4 py-3 text-sm text-neutral-600">
          <span>登录B站后，你的收藏夹会自动出现在这里；也可以先粘贴公开链接引入别人的歌单。</span>
          <Button size="sm" onClick={onRequireLogin}>前往登录</Button>
        </div>
      )}
      {bilibili.error && (
        <div role="alert" className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{bilibili.error}</span>
          <Button size="sm" onClick={onRequireLogin}>前往登录</Button>
        </div>
      )}
      {syncError && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{syncError}</p>}
      <SourceTabs playlistSource="bilibili" onSelect={onSelectSource} />
      <section className="aria-section-divider mt-6 border-b pb-6" aria-labelledby="bilibili-own-playlists">
        <div className="flex items-center justify-between gap-3">
          <h2 id="bilibili-own-playlists" className="text-base font-semibold">我的收藏夹</h2>
          <span className="text-xs text-neutral-400">登录账号实时读取 · 只读</span>
        </div>
        <div className="mt-3 grid gap-3.5 md:grid-cols-3">
          {bilibili.playlists.map((playlist) => (
            <button
              key={playlist.id}
              className="aria-flat-tile flex flex-col rounded-2xl p-4 text-left"
              onClick={() => bilibili.onOpen(playlist)}
            >
              <span className="flex size-12 items-center justify-center rounded-xl bg-[#e6f7ff] text-[#00AEEC]">
                <SourceLogo source="bilibili" className="size-6" />
              </span>
              <h3 className="mt-4 line-clamp-2 break-words text-lg font-semibold leading-snug">{playlist.name}</h3>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-neutral-500">
                <span>{playlist.trackCount ? `${playlist.trackCount} 首` : "空收藏夹"}</span>
                <span>B站收藏夹</span>
              </div>
            </button>
          ))}
        </div>
        {!bilibili.playlists.length && !bilibili.loading && (
          <EmptyState
            text={bilibili.connected
              ? "还没有可同步的收藏夹。在B站里把视频加入收藏夹后，点上方「同步收藏夹」。"
              : "登录B站后，你的收藏夹会自动同步到这里。"}
          />
        )}
      </section>
      <section className="mt-6" aria-labelledby="bilibili-referenced-playlists">
        <div className="flex items-center justify-between gap-3">
          <h2 id="bilibili-referenced-playlists" className="text-base font-semibold">引入的B站歌单</h2>
          <span className="text-xs text-neutral-400">别人的收藏夹 / 合集 · 可刷新同步</span>
        </div>
        <div className="mt-3 grid gap-3.5 md:grid-cols-3">
          {bilibili.referencedPlaylists.map((playlist) => (
            <div key={playlist.id} className="group relative">
              <button
                type="button"
                className="aria-flat-tile flex h-full w-full flex-col rounded-2xl p-4 text-left"
                onClick={() => bilibili.onOpenReferenced(playlist.id)}
              >
                <span className="flex size-12 items-center justify-center rounded-xl bg-[#e6f7ff] text-[#00AEEC]">
                  <SourceLogo source="bilibili" className="size-6" />
                </span>
                <h3 className="mt-4 line-clamp-2 break-words pr-12 text-lg font-semibold leading-snug">{playlist.name}</h3>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
                  <span>{playlist.trackIds.length} 首</span>
                  <span>
                    {playlist.remoteRef?.kind === "playlist" ? "B站合集镜像" : "B站收藏夹镜像"}
                    {playlist.remoteRef?.syncedAt ? ` · ${new Date(playlist.remoteRef.syncedAt).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}` : ""}
                  </span>
                </div>
              </button>
              <div className="absolute right-4 top-4 z-10 flex gap-1.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  aria-label={`刷新 ${playlist.name}`}
                  title="从B站重新同步这份歌单"
                  disabled={syncingId === playlist.id}
                  className="flex size-9 items-center justify-center rounded-full bg-white/90 text-neutral-400 shadow-sm ring-1 ring-black/5 transition hover:bg-violet-50 hover:text-violet-600 disabled:opacity-60"
                  onClick={(event) => {
                    event.stopPropagation();
                    void refreshMirror(playlist);
                  }}
                >
                  {syncingId === playlist.id ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                </button>
                {bilibili.onDeleteReferenced && (
                  <button
                    type="button"
                    aria-label={`删除 ${playlist.name}`}
                    title="删除这份镜像歌单（不影响B站收藏夹）"
                    className="flex size-9 items-center justify-center rounded-full bg-white/90 text-neutral-400 shadow-sm ring-1 ring-black/5 transition hover:bg-red-50 hover:text-red-600"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (window.confirm(`删除镜像歌单“${playlist.name}”？B站收藏夹本身不会被修改。`)) bilibili.onDeleteReferenced?.(playlist.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {!bilibili.referencedPlaylists.length && (
          <EmptyState text="把别人的B站收藏夹或合集链接粘贴到「引入B站歌单」，就会在这里生成一份可刷新的镜像歌单。" />
        )}
      </section>
      {importOpen && (
        <BilibiliLinkDialog
          mode="reference"
          onClose={() => setImportOpen(false)}
          onReference={(resolved) => {
            const created = bilibili.onCreateReference(
              resolved.title ?? (resolved.kind === "playlist" ? "B站合集" : "B站收藏夹"),
              resolved.tracks,
              {
                source: "bilibili",
                url: resolved.url,
                kind: resolved.kind,
                ...(resolved.title ? { title: resolved.title } : {}),
              },
            );
            setImportOpen(false);
            bilibili.onOpenReferenced(created.id);
          }}
        />
      )}
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
          {/* listening insights heading */}
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">听歌洞察</h1>
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
                  : "按一年 24 小时统计你的活跃波峰"}
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
          <div className="mt-2 flex items-center justify-between text-[11px] font-medium tabular-nums text-[var(--text-secondary)]">
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
              <EmptyState text="还没有歌手聆听记录，播几首歌这里就会立体起来。"/>
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
              <EmptyState text="先播放几首歌，单曲循环榜和听歌时间画像就会在这里呈现。"/>
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
  onPickTrack: (id: string, queue?: Track[]) => void;
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
              onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onPickTrack(track.id, tracks); } }}
              className="aria-flat-row absolute left-0 right-0 grid h-20 grid-cols-[2rem_3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 text-left"
              style={{ top: offsetTop }}
              onClick={() => onPickTrack(track.id, tracks)}
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
