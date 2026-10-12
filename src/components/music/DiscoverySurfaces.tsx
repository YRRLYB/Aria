import { useMemo, useState } from "react";
import {
  Cloud,
  Disc3,
  FileText,
  Globe2,
  HardDrive,
  ListMusic,
  Play,
  Search,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ArtistAvatar } from "@/components/music/shared";
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
  onRetry?: () => void;
  onLoadMore?: () => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
  onPickArtist: (artist: ArtistSummary) => void;
  onPickPlaylist: (playlist: ProviderPlaylist) => void;
  onPickUser?: (user: ProviderUser) => void;
  onPickAlbum?: (album: ProviderAlbum) => void;
}) {
  const tracks = useMemo(
    () => mergeTracks([...localTracks, ...neteaseTracks]),
    [localTracks, neteaseTracks],
  );
  const localQueue = useMemo(
    () => tracks.filter((track) => track.source === "local"),
    [tracks],
  );
  const neteaseQueue = useMemo(
    () => tracks.filter((track) => track.source === "netease"),
    [tracks],
  );
  const descriptions = {
    tracks: "搜索歌曲与本地音乐，可直接播放或加入歌单。",
    artists: "浏览歌手作品、专辑与简介。",
    playlists: "浏览公开歌单并播放完整曲目。",
    users: "搜索网易云用户，查看他们的公开歌单。",
    albums: "按专辑名称搜索，浏览完整曲目。",
    lyrics: "输入歌词片段，找回那首歌。",
  };
  const count =
    mode === "tracks" || mode === "lyrics"
      ? tracks.length
      : mode === "artists"
        ? artists.length
        : mode === "playlists"
          ? playlists.length
          : mode === "users"
            ? users.length
            : albums.length;

  return (
    <section className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-3xl p-5">
      <header className="flex shrink-0 items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs tracking-widest text-neutral-400">SEARCH</p>
          <h1 className="mt-2 truncate text-3xl font-semibold" title={query}>
            {query}
          </h1>
          <p className="mt-2 text-sm text-neutral-500">{descriptions[mode]}</p>
        </div>
        <Search className="size-6 shrink-0 text-neutral-300" />
      </header>
      <div className="mt-5 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-neutral-200/65 pb-3">
        <div
          role="tablist"
          aria-label="搜索类型"
          className="flex flex-wrap items-center gap-1"
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
                "inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition",
                mode === value
                  ? "bg-neutral-950 text-white"
                  : "text-neutral-500 hover:bg-white hover:text-neutral-950",
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
              ? `已显示 ${count} 项 · 共 ${total} 项`
              : `${count} 项结果`}
        </span>
      </div>
      <div
        role="tabpanel"
        className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-1"
      >
        <DiscoveryError error={error} onRetry={onRetry} />
        {(mode === "tracks" || mode === "lyrics") && (
          <div className="grid gap-2">
            {tracks.map((track) => (
              <DiscoveryTrackRow
                key={track.id}
                track={track}
                queue={track.source === "local" ? localQueue : neteaseQueue}
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
                : "没有找到相关结果，换个关键词试试。"
            }
          />
        )}
        <DiscoveryLoadMore
          loading={loading && Boolean(count)}
          more={more}
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
    <section className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-3xl p-5">
      <header className="flex shrink-0 items-center justify-between">
        <div>
          <Badge>Artists</Badge>
          <h1 className="mt-3 text-3xl font-semibold">歌手</h1>
          <p className="mt-2 text-sm text-neutral-500">
            浏览本地与网易云歌手，探索曲目、专辑和创作者资料。
          </p>
        </div>
        <UserRound className="size-7 text-neutral-400" />
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
          <EmptyState text="导入音乐或同步网易云后会生成歌手页。" />
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
}: {
  artist: ArtistSummary;
  avatarUrl: string | null;
  tracks: Track[];
  onBack: () => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
} & ArtistDetailProps) {
  const [tab, setTab] = useState<"tracks" | "albums" | "about">("tracks");
  const [sourceFilter, setSourceFilter] = useState<"all" | "netease" | "local">(
    "all",
  );
  const localTracks = useMemo(
    () => tracks.filter((track) => track.source === "local"),
    [tracks],
  );
  const neteaseTracks = useMemo(
    () => tracks.filter((track) => track.source === "netease"),
    [tracks],
  );
  const playAllQueue =
    sourceFilter === "local"
      ? localTracks
      : sourceFilter === "netease"
        ? neteaseTracks
        : tracks;
  const sections = artistDetail?.sections ?? [];
  const description = artistDetail?.description ?? "";
  return (
    <section className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-3xl p-6">
      <button
        type="button"
        onClick={onBack}
        className="w-fit shrink-0 rounded-full bg-white/70 px-4 py-2 text-xs font-medium text-neutral-600"
      >
        返回歌手列表
      </button>
      <header className="my-5 flex shrink-0 items-center gap-5">
        <ArtistAvatar
          name={artist.name}
          avatarUrl={avatarUrl || artistDetail?.artist.avatarUrl || null}
          className="size-24 rounded-2xl"
        />
        <div className="min-w-0">
          <Badge>{artistSourceLabel(artist.source)}</Badge>
          <h1
            className="mt-2 truncate text-3xl font-semibold"
            title={artist.name}
          >
            {artist.name}
          </h1>
          <p className="mt-2 text-xs text-neutral-500">
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
        className="flex shrink-0 gap-2 border-b border-neutral-200/60 pb-3"
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
              "rounded-full px-4 py-2 text-xs font-medium",
              tab === value
                ? "bg-neutral-950 text-white"
                : "text-neutral-500 hover:bg-white",
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
              <div className="flex gap-1 rounded-full bg-white/60 p-1">
                {(
                  [
                    ["all", "全部", tracks.length],
                    ["netease", "网易云", neteaseTracks.length],
                    ["local", "本地", localTracks.length],
                  ] as const
                ).map(([value, label, count]) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setSourceFilter(value)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs",
                      sourceFilter === value
                        ? "bg-neutral-900 text-white"
                        : "text-neutral-500",
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
            {sourceFilter !== "local" && (
              <ArtistTrackGroup
                title="网易云流媒体"
                icon={<Globe2 className="size-4" />}
                tracks={neteaseTracks}
                onPickTrack={onPickTrack}
                loading={tracksLoading}
              />
            )}
            {sourceFilter !== "netease" && (
              <ArtistTrackGroup
                title="本地文件"
                icon={<HardDrive className="size-4" />}
                tracks={localTracks}
                onPickTrack={onPickTrack}
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
  loading,
}: {
  title: string;
  icon: React.ReactNode;
  tracks: Track[];
  onPickTrack: (id: string, queue?: Track[]) => void;
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
          />
        ))}
      </div>
      {!tracks.length && (
        <p className="rounded-xl bg-white/40 px-4 py-5 text-xs text-neutral-400">
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
      className="group flex min-w-0 items-center gap-3 rounded-2xl bg-white/55 p-3 text-left transition hover:bg-white"
      onClick={() =>
        onPick({ ...artist, avatarUrl: artist.avatarUrl ?? avatarUrl })
      }
    >
      <ArtistAvatar
        name={artist.name}
        avatarUrl={avatarUrl}
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
