import { useMemo, useState } from "react";
import {
  Cloud,
  Disc3,
  FileText,
  Globe2,
  HardDrive,
  LayoutGrid,
  ListMusic,
  Music4,
  Play,
  Search,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ArtistAvatar } from "@/components/music/shared";
import { SourceLogo, type SourceToggleOption } from "./SourceLogos";
import { artistSourceLabel, type ArtistSummary } from "@/lib/artists";
import type { ProviderAlbum, ProviderPlaylist, ProviderUser } from "@/lib/api";
import { mergeTracks } from "@/lib/playerPresentation";
import { cn } from "@/lib/utils";
import type { Track } from "@/data/music";
import type { DiscoverySearchMode } from "@/hooks/useDiscovery";
import {
  AlbumDiscoveryCard,
  DiscoveryError,
  DiscoveryLoadMore,
  DiscoveryTrackRow,
  PlaylistDiscoveryCard,
  type DiscoveryArtistDetail,
} from "./DiscoveryDetails";

export function SearchSurface({
  query,
  loading,
  localTracks,
  neteaseTracks,
  qqTracks = [],
  bilibiliTracks = [],
  youtubeTracks = [],
  privateCloudTracks = [],
  qqError = null,
  bilibiliError = null,
  youtubeError = null,
  artists,
  playlists,
  users = [],
  albums = [],
  artistAvatarCache,
  mode = "tracks",
  onModeChange,
  error = null,
  total = 0,
  more = false,
  qqMore = false,
  bilibiliMore = false,
  youtubeMore = false,
  onRetry = () => {},
  onLoadMore = () => {},
  onPickTrack,
  onPickArtist,
  onPickPlaylist,
  onPickUser,
  onPickAlbum,
}: {
  query: string;
  loading: boolean;
  localTracks: Track[];
  neteaseTracks: Track[];
  qqTracks?: Track[];
  bilibiliTracks?: Track[];
  youtubeTracks?: Track[];
  privateCloudTracks?: Track[];
  qqError?: string | null;
  bilibiliError?: string | null;
  youtubeError?: string | null;
  artists: ArtistSummary[];
  playlists: ProviderPlaylist[];
  users?: ProviderUser[];
  albums?: ProviderAlbum[];
  artistAvatarCache: Record<string, string | null>;
  mode?: DiscoverySearchMode;
  onModeChange?: (mode: DiscoverySearchMode) => void;
  error?: string | null;
  total?: number;
  more?: boolean;
  /** QQ 搜索没有 total，用“上一页是否满页”推断是否还有下一页。 */
  qqMore?: boolean;
  bilibiliMore?: boolean;
  youtubeMore?: boolean;
  onRetry?: () => void;
  onLoadMore?: () => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
  onPickArtist: (artist: ArtistSummary) => void;
  onPickPlaylist: (playlist: ProviderPlaylist) => void;
  onPickUser?: (user: ProviderUser) => void;
  onPickAlbum?: (album: ProviderAlbum) => void;
}) {
  const tracks = useMemo(
    () => mergeTracks([...localTracks, ...neteaseTracks, ...qqTracks, ...bilibiliTracks, ...youtubeTracks, ...privateCloudTracks]),
    [localTracks, neteaseTracks, qqTracks, bilibiliTracks, youtubeTracks, privateCloudTracks],
  );
  // 融合但不同时铺开：来源芯片切到单一源时，只显示该源的结果。
  const [sourceFilter, setSourceFilter] = useState<"all" | SourceToggleOption | "bilibili" | "privateCloud">("all");
  const filteredTracks = useMemo(
    () =>
      sourceFilter === "all"
        ? tracks
        : sourceFilter === "privateCloud"
          ? tracks.filter((track) => track.source === "subsonic" || track.source === "webdav")
          : tracks.filter((track) => track.source === sourceFilter),
    [tracks, sourceFilter],
  );
  // 本地没有分页；QQ 没有 total，只能按“是否满页”判断。切到“全部”时
  // 任一源还有下一页就保留按钮，否则网易云翻完后 QQ 也会被一起藏掉。
  const effectiveMore =
    mode !== "tracks" && mode !== "lyrics"
      ? more || qqMore
      : sourceFilter === "local"
        ? false
        : sourceFilter === "qq"
          ? qqMore
          : sourceFilter === "bilibili"
            ? bilibiliMore
            : sourceFilter === "youtube"
              ? youtubeMore
              : sourceFilter === "netease"
                ? more
                : more || qqMore || bilibiliMore || youtubeMore;
  const localQueue = useMemo(
    () => tracks.filter((track) => track.source === "local"),
    [tracks],
  );
  const neteaseQueue = useMemo(
    () => tracks.filter((track) => track.source === "netease"),
    [tracks],
  );
  const qqQueue = useMemo(
    () => tracks.filter((track) => track.source === "qq"),
    [tracks],
  );
  const bilibiliQueue = useMemo(
    () => tracks.filter((track) => track.source === "bilibili"),
    [tracks],
  );
    const youtubeQueue = useMemo(
    () => tracks.filter((track) => track.source === "youtube"),
    [tracks],
  );
  const privateCloudQueue = useMemo(
    () => tracks.filter((track) => track.source === "subsonic" || track.source === "webdav"),
    [tracks],
  );
  const descriptions = {
    tracks: "本地、网易云、QQ 音乐、B站、YouTube 与私有云一起搜，点来源图标切换查看。",
    artists: "浏览歌手作品、专辑与简介。",
    playlists: "浏览公开歌单并播放完整曲目。",
    users: "搜索网易云用户，查看他们的公开歌单。",
    albums: "按专辑名称搜索，浏览完整曲目。",
    lyrics: "输入歌词片段，找回那首歌。",
  };
  const count =
    mode === "tracks" || mode === "lyrics"
      ? filteredTracks.length
      : mode === "artists"
        ? artists.length
        : mode === "playlists"
          ? playlists.length
          : mode === "users"
            ? users.length
            : albums.length;

  return (
    <section className="aria-page-shell flex h-full min-h-0 flex-col overflow-hidden rounded-[1.5rem] p-5 sm:p-7">
      <header className="flex shrink-0 items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl" title={query}>
            {query}
          </h1>
          <p className="mt-1 text-xs text-neutral-500">{descriptions[mode]}</p>
        </div>
        <Search className="size-5 shrink-0 text-neutral-300" />
      </header>
      <div className="aria-page-header mt-4 flex shrink-0 flex-wrap items-center justify-between gap-3 pb-3">
        <div
          role="tablist"
          aria-label="搜索类型"
          className="aria-segment flex flex-wrap items-center gap-1 rounded-full p-1"
        >
          {(
            [
              ["tracks", "歌曲", ListMusic],
              ["artists", "歌手", UserRound],
              ["playlists", "歌单", Cloud],
              ["users", "用户", UsersRound],
              ["albums", "专辑", Disc3],
              ["lyrics", "歌词", FileText],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              className={cn(
                "aria-segment-item inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
                mode === value && "is-active",
              )}
              onClick={() => onModeChange?.(value)}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-neutral-400">
          {loading
            ? "搜索中…"
            : total
              ? `已显示 ${count} 项 · 网易云共 ${total} 项`
              : `${count} 项结果`}
        </span>
      </div>
      {(mode === "tracks" || mode === "lyrics") && (
        <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2" aria-label="搜索结果来源">
          {(
            [
              ["all", "全部", null],
              ["netease", "网易云", "netease"],
              ["qq", "QQ 音乐", "qq"],
              ["bilibili", "B站", "bilibili"],
              ["youtube", "YouTube", "youtube"],
              ["privateCloud", "私有云", "subsonic"],
              ["local", "本地", "local"],
            ] as const
          ).map(([value, label, logo]) => {
            const active = sourceFilter === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                className={cn(
                  "aria-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium",
                  active && "is-active",
                )}
                onClick={() => setSourceFilter(value)}
              >
                {logo ? <SourceLogo source={logo} className="size-3.5" /> : <LayoutGrid className="size-3.5" />}
                {label}
              </button>
            );
          })}
        </div>
      )}
      <div
        role="tabpanel"
        className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-1"
      >
        <DiscoveryError error={error} onRetry={onRetry} />
        {mode === "tracks" && qqError && sourceFilter !== "qq" && (
          <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-2 text-xs text-amber-700">
            QQ音乐：{qqError}
          </p>
        )}
        {mode === "tracks" && bilibiliError && sourceFilter !== "bilibili" && (
          <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-2 text-xs text-amber-700">
            B站：{bilibiliError}
          </p>
        )}
        {mode === "tracks" && youtubeError && sourceFilter !== "youtube" && (
          <p className="mb-3 rounded-2xl bg-amber-50 px-4 py-2 text-xs text-amber-700">
            YouTube：{youtubeError}
          </p>
        )}
        {(mode === "tracks" || mode === "lyrics") && (
          <div className="grid gap-2">
            {filteredTracks.map((track) => (
              <DiscoveryTrackRow
                key={track.id}
                track={track}
                queue={
                  track.source === "local"
                    ? localQueue
                    : track.source === "qq"
                      ? qqQueue
                      : track.source === "bilibili"
                        ? bilibiliQueue
                        : track.source === "youtube"
                          ? youtubeQueue
                          : track.source === "subsonic" || track.source === "webdav"
                            ? privateCloudQueue
                            : neteaseQueue
                }
                onPickTrack={onPickTrack}
                showMatchedLyric={mode === "lyrics"}
              />
            ))}
          </div>
        )}
        {mode === "artists" && (
          <div className="grid gap-3 xl:grid-cols-3 2xl:grid-cols-4">
            {artists.map((artist) => (
              <ArtistCard
                key={artist.id}
                artist={artist}
                avatarUrl={
                  artist.avatarUrl ??
                  artistAvatarCache[artist.name.toLowerCase()] ??
                  null
                }
                onPick={onPickArtist}
              />
            ))}
          </div>
        )}
        {mode === "playlists" && (
          <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
            {playlists.map((playlist) => (
              <PlaylistDiscoveryCard
                key={playlist.id}
                playlist={playlist}
                onPick={onPickPlaylist}
              />
            ))}
          </div>
        )}
        {mode === "albums" && (
          <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
            {albums.map((album) => (
              <AlbumDiscoveryCard
                key={album.id}
                album={album}
                onPick={(selected) => onPickAlbum?.(selected)}
              />
            ))}
          </div>
        )}
        {mode === "users" && (
          <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
            {users.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => onPickUser?.(user)}
                className="flex min-w-0 items-center gap-3 rounded-2xl bg-white/55 p-4 text-left transition hover:bg-white"
              >
                <ArtistAvatar
                  name={user.nickname}
                  avatarUrl={user.avatarUrl}
                  className="size-16 rounded-full"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {user.nickname}
                  </span>
                  <span className="mt-1 block truncate text-xs text-neutral-500">
                    {user.signature || "暂无签名"}
                  </span>
                  <span className="mt-1.5 block text-xs text-neutral-400">
                    查看公开歌单
                    {user.playlistCount != null &&
                      ` · ${user.playlistCount} 个`}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        {!count && !error && (
          <EmptyState
            text={
              loading
                ? "正在查找相关结果。"
                : mode === "tracks" && sourceFilter !== "all" && tracks.length
                  ? "这个来源没有匹配结果，点其他来源图标或换个关键词试试。"
                  : "没有找到相关结果，换个关键词试试。"
            }
          />
        )}
        <DiscoveryLoadMore
          loading={loading && Boolean(count)}
          more={effectiveMore}
          onLoadMore={onLoadMore}
        />
      </div>
    </section>
  );
}

type ArtistDetailProps = {
  artistDetail?: DiscoveryArtistDetail | null;
  artistAlbums?: ProviderAlbum[];
  detailLoading?: boolean;
  detailError?: string | null;
  albumsMore?: boolean;
  onRetryDetail?: () => void;
  onLoadMoreAlbums?: () => void;
  onPickAlbum?: (album: ProviderAlbum) => void;
  tracksLoading?: boolean;
  tracksError?: string | null;
  onRetryTracks?: () => void;
  onPlayNext?: (id: string) => void;
};

export function ArtistsSurface({
  artists,
  selectedArtist,
  tracks,
  artistAvatarCache,
  onPickArtist,
  onBack,
  onPickTrack,
  ...detailProps
}: {
  artists: ArtistSummary[];
  selectedArtist: ArtistSummary | null;
  tracks: Track[];
  artistAvatarCache: Record<string, string | null>;
  onPickArtist: (artist: ArtistSummary) => void;
  onBack: () => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
} & ArtistDetailProps) {
  if (selectedArtist)
    return (
      <ArtistDetailView
        key={selectedArtist.id}
        artist={selectedArtist}
        avatarUrl={
          selectedArtist.avatarUrl ??
          artistAvatarCache[selectedArtist.name.toLowerCase()] ??
          null
        }
        tracks={tracks}
        onBack={onBack}
        onPickTrack={onPickTrack}
        {...detailProps}
      />
    );
  const featuredArtists = artists.slice(0, 80);
  return (
    <section className="aria-page-shell flex h-full min-h-0 flex-col overflow-hidden rounded-[1.5rem] p-5 sm:p-7">
      <header className="aria-page-header flex shrink-0 items-center justify-between pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">歌手</h1>
          <p className="mt-1 text-xs text-neutral-500">
            浏览本地、网易云与 QQ 音乐歌手，探索曲目、专辑和创作者资料。
          </p>
        </div>
        <UserRound className="size-6 text-neutral-400" />
      </header>
      <div className="no-scrollbar mt-5 grid min-h-0 flex-1 auto-rows-min gap-3 overflow-y-auto pr-1 xl:grid-cols-3 2xl:grid-cols-4">
        {featuredArtists.map((artist) => (
          <ArtistCard
            key={artist.id}
            artist={artist}
            avatarUrl={
              artist.avatarUrl ??
              artistAvatarCache[artist.name.toLowerCase()] ??
              null
            }
            onPick={onPickArtist}
          />
        ))}
        {!featuredArtists.length && (
          <EmptyState text="导入音乐或登录在线音源后会生成歌手页。" />
        )}
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
  artistDetail = null,
  artistAlbums = [],
  detailLoading = false,
  detailError = null,
  albumsMore = false,
  onRetryDetail = () => {},
  onLoadMoreAlbums = () => {},
  onPickAlbum,
  tracksLoading = false,
  tracksError = null,
  onRetryTracks = () => {},
  onPlayNext,
}: {
  artist: ArtistSummary;
  avatarUrl: string | null;
  tracks: Track[];
  onBack: () => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
} & ArtistDetailProps) {
  const [tab, setTab] = useState<"tracks" | "albums" | "about">("tracks");
  const [sourceFilter, setSourceFilter] = useState<
    "all" | "netease" | "qq" | "local"
  >("all");
  const localTracks = useMemo(
    () => tracks.filter((track) => track.source === "local"),
    [tracks],
  );
  const neteaseTracks = useMemo(
    () => tracks.filter((track) => track.source === "netease"),
    [tracks],
  );
  const qqTracks = useMemo(
    () => tracks.filter((track) => track.source === "qq"),
    [tracks],
  );
  const playAllQueue =
    sourceFilter === "local"
      ? localTracks
      : sourceFilter === "netease"
        ? neteaseTracks
        : sourceFilter === "qq"
          ? qqTracks
          : tracks;
  const sections = artistDetail?.sections ?? [];
  const description = artistDetail?.description ?? "";
  return (
    <section className="aria-page-shell flex h-full min-h-0 flex-col overflow-hidden rounded-[1.5rem] p-5 sm:p-7">
      <button
        type="button"
        onClick={onBack}
        className="aria-chip w-fit shrink-0 rounded-full px-4 py-1.5 text-xs font-medium"
      >
        返回歌手列表
      </button>
      <header className="my-4 flex shrink-0 items-center gap-5">
        <ArtistAvatar
          name={artist.name}
          avatarUrl={avatarUrl || artistDetail?.artist.avatarUrl || null}
          fallbackUrl={
            artist.fallbackCoverUrl ??
            tracks.find((track) => Boolean(track.coverUrl))?.coverUrl ??
            null
          }
          className="size-20 rounded-2xl"
        />
        <div className="min-w-0">
          <h1
            className="truncate text-2xl font-semibold sm:text-3xl"
            title={artist.name}
          >
            {artist.name}
          </h1>
          <p className="mt-1.5 text-xs text-neutral-500">
            {artistSourceLabel(artist.source)} ·{" "}
            {artistDetail?.artist.trackCount ||
              tracks.length ||
              artist.trackCount ||
              0}{" "}
            首曲目 · {artistDetail?.artist.albumCount ?? artist.albumCount ?? 0}{" "}
            张专辑
          </p>
        </div>
      </header>
      <div
        role="tablist"
        aria-label="歌手内容"
        className="aria-page-header flex shrink-0 gap-2 pb-3"
      >
        {(
          [
            ["tracks", "曲目"],
            ["albums", "专辑"],
            ["about", "简介"],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "aria-chip rounded-full px-4 py-1.5 text-xs font-medium",
              tab === value && "is-active",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-1"
      >
        {tab === "tracks" && (
          <>
            <DiscoveryError error={tracksError} onRetry={onRetryTracks} />
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="aria-segment flex gap-1 rounded-full p-1">
                {(
                  [
                    ["all", "全部", tracks.length],
                    ["netease", "网易云", neteaseTracks.length],
                    ["qq", "QQ 音乐", qqTracks.length],
                    ["local", "本地", localTracks.length],
                  ] as const
                ).map(([value, label, count]) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setSourceFilter(value)}
                    className={cn(
                      "aria-segment-item rounded-full px-3 py-1 text-xs font-medium",
                      sourceFilter === value && "is-active",
                    )}
                  >
                    {label} {count}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={!playAllQueue.length}
                className="flex items-center gap-2 rounded-full bg-neutral-950 px-4 py-2 text-xs text-white disabled:opacity-40"
                onClick={() =>
                  playAllQueue[0] &&
                  onPickTrack(playAllQueue[0].id, playAllQueue)
                }
              >
                <Play className="size-3.5 fill-current" />
                播放全部
              </button>
            </div>
            {sourceFilter !== "local" && sourceFilter !== "qq" && (
              <ArtistTrackGroup
                title="网易云流媒体"
                icon={<Globe2 className="size-4" />}
                tracks={neteaseTracks}
                onPickTrack={onPickTrack}
                onPlayNext={onPlayNext}
                loading={tracksLoading}
              />
            )}
            {sourceFilter !== "local" && sourceFilter !== "netease" && (
              <ArtistTrackGroup
                title="QQ 音乐"
                icon={<Music4 className="size-4" />}
                tracks={qqTracks}
                onPickTrack={onPickTrack}
                onPlayNext={onPlayNext}
                loading={tracksLoading}
              />
            )}
            {sourceFilter !== "netease" && sourceFilter !== "qq" && (
              <ArtistTrackGroup
                title="本地文件"
                icon={<HardDrive className="size-4" />}
                tracks={localTracks}
                onPickTrack={onPickTrack}
                onPlayNext={onPlayNext}
                loading={false}
              />
            )}
          </>
        )}
        {tab === "albums" && (
          <>
            <DiscoveryError error={detailError} onRetry={onRetryDetail} />
            <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
              {artistAlbums.map((album) => (
                <AlbumDiscoveryCard
                  key={album.id}
                  album={album}
                  onPick={(selected) => onPickAlbum?.(selected)}
                />
              ))}
            </div>
            {!artistAlbums.length && !detailError && (
              <EmptyState
                text={
                  detailLoading
                    ? "正在加载歌手专辑。"
                    : artist.providerId
                      ? "暂未找到该歌手的专辑。"
                      : "未匹配到线上歌手，暂时无法查看专辑。"
                }
              />
            )}
            <DiscoveryLoadMore
              loading={detailLoading}
              more={albumsMore}
              onLoadMore={onLoadMoreAlbums}
            />
          </>
        )}
        {tab === "about" && (
          <>
            <DiscoveryError error={detailError} onRetry={onRetryDetail} />
            {description && (
              <p className="max-w-4xl whitespace-pre-line text-sm leading-8 text-neutral-600">
                {description}
              </p>
            )}
            {sections.map((section, index) => (
              <section
                key={`${section.title}-${index}`}
                className="mt-6 max-w-4xl"
              >
                <h2 className="text-lg font-semibold">{section.title}</h2>
                <p className="mt-3 whitespace-pre-line text-sm leading-8 text-neutral-600">
                  {section.text}
                </p>
              </section>
            ))}
            {!description && !sections.length && !detailError && (
              <EmptyState
                text={detailLoading ? "正在加载歌手资料。" : "暂无歌手简介。"}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}

function ArtistTrackGroup({
  title,
  icon,
  tracks,
  onPickTrack,
  onPlayNext,
  loading,
}: {
  title: string;
  icon: React.ReactNode;
  tracks: Track[];
  onPickTrack: (id: string, queue?: Track[]) => void;
  onPlayNext?: (id: string) => void;
  loading: boolean;
}) {
  return (
    <section className="mb-5">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-600">
        {icon}
        {title}
        <span className="text-xs font-normal text-neutral-400">
          {tracks.length} 首
        </span>
      </div>
      <div className="grid gap-2">
        {tracks.map((track) => (
          <DiscoveryTrackRow
            key={track.id}
            track={track}
            queue={tracks}
            onPickTrack={onPickTrack}
            onPlayNext={onPlayNext}
          />
        ))}
      </div>
      {!tracks.length && (
        <p className="aria-flat-well rounded-xl px-4 py-4 text-xs text-neutral-400">
          {loading ? "正在加载歌曲…" : "暂无此来源的歌曲"}
        </p>
      )}
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
      type="button"
      className="aria-flat-tile group flex min-w-0 items-center gap-3 rounded-2xl p-3 text-left"
      onClick={() =>
        onPick({ ...artist, avatarUrl: artist.avatarUrl ?? avatarUrl })
      }
    >
      <ArtistAvatar
        name={artist.name}
        avatarUrl={avatarUrl}
        fallbackUrl={artist.fallbackCoverUrl ?? null}
        className="size-16 rounded-xl"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold group-hover:text-violet-700">
          {artist.name}
        </span>
        <span className="mt-1 block truncate text-xs text-neutral-500">
          {artistSourceLabel(artist.source)} · {artist.trackCount || 0} 首
        </span>
        <span className="mt-1 block truncate text-xs text-neutral-400">
          {artist.albumCount ?? 0} 张专辑
        </span>
      </span>
    </button>
  );
}
