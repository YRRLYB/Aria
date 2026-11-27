import { useState } from "react";
import {
  ArrowLeft,
  Disc3,
  ListEnd,
  ListMusic,
  ListPlus,
  LoaderCircle,
  Play,
  RefreshCw,
} from "lucide-react";
import type { Track } from "@/data/music";
import {
  api,
  type ProviderAlbum,
  type ProviderPlaylist,
  type ProviderUser,
} from "@/lib/api";
import { formatAudioDetail } from "@/lib/playerPresentation";
import {
  ArtistAvatar,
  CopyableTrackText,
  CoverArt,
  EmptyState,
} from "./shared";
import { SourceBadge } from "./SourceLogos";
import { ArtworkImage } from "./ArtworkImage";
import { AddToPlaylistButton, usePlaylistActions } from "./PlaylistActions";
import { useTrackContextMenu } from "./TrackContextMenu";

export function DiscoveryError({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      <span className="min-w-0 break-words">{error}</span>
      <button
        type="button"
        onClick={onRetry}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 font-medium"
      >
        <RefreshCw className="size-3.5" />
        重试
      </button>
    </div>
  );
}

export function DiscoveryLoadMore({
  loading,
  more,
  onLoadMore,
}: {
  loading: boolean;
  more: boolean;
  onLoadMore: () => void;
}) {
  if (!loading && !more) return null;
  return (
    <div className="flex justify-center py-4">
      <button
        type="button"
        disabled={loading}
        onClick={onLoadMore}
        className="inline-flex items-center gap-2 rounded-full bg-white/80 px-5 py-2 text-sm font-medium shadow-sm disabled:text-neutral-400"
      >
        {loading && <LoaderCircle className="size-4 animate-spin" />}
        {loading ? "正在加载…" : "加载更多"}
      </button>
    </div>
  );
}

export function DiscoveryArtwork({
  src,
  name,
  className,
  cacheSize = 320,
}: {
  src?: string | null;
  name: string;
  className?: string;
  cacheSize?: number;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-violet-100 via-white to-neutral-100 text-violet-300 ${className ?? ""}`}
    >
      <Disc3 className="size-1/3" />
      {src && failedSrc !== src && (
        <ArtworkImage
          src={src}
          cacheSize={cacheSize}
          alt={name}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      )}
    </span>
  );
}

export function PlaylistDiscoveryCard({
  playlist,
  onPick,
}: {
  playlist: ProviderPlaylist;
  onPick: (playlist: ProviderPlaylist) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(playlist)}
      className="aria-flat-tile group flex min-w-0 items-center gap-3 rounded-2xl p-3 text-left"
    >
      <DiscoveryArtwork
        src={playlist.coverUrl}
        name={playlist.name}
        className="size-20 rounded-xl"
        cacheSize={160}
      />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-semibold leading-relaxed group-hover:text-violet-700">
          {playlist.name}
        </span>
        <span className="mt-1.5 block text-xs text-neutral-500">
          {playlist.trackCount} 首 ·{" "}
          {playlist.subscribed ? "收藏歌单" : "公开歌单"}
        </span>
      </span>
    </button>
  );
}

export function AlbumDiscoveryCard({
  album,
  onPick,
}: {
  album: ProviderAlbum;
  onPick: (album: ProviderAlbum) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(album)}
      className="aria-flat-tile group flex min-w-0 items-center gap-3 rounded-2xl p-3 text-left"
    >
      <DiscoveryArtwork
        src={album.coverUrl}
        name={album.name}
        className="size-20 rounded-xl"
        cacheSize={160}
      />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-semibold leading-relaxed group-hover:text-violet-700">
          {album.name}
        </span>
        <span className="mt-1 block truncate text-xs text-neutral-500">
          {album.artist}
        </span>
        <span className="mt-1 block text-xs text-neutral-400">
          {album.publishTime
            ? new Date(album.publishTime).getFullYear()
            : "专辑"}
          {album.trackCount != null ? ` · ${album.trackCount} 首` : ""}
        </span>
      </span>
    </button>
  );
}

export function DiscoveryTrackRow({
  track,
  queue,
  onPickTrack,
  onPlayNext,
  index,
  showMatchedLyric = false,
}: {
  track: Track;
  queue: Track[];
  onPickTrack: (id: string, queue?: Track[]) => void;
  onPlayNext?: (id: string) => void;
  index?: number;
  showMatchedLyric?: boolean;
}) {
  const trackMenu = useTrackContextMenu();
  return (
    <div
      role="button"
      tabIndex={0}
      data-track-context-row="true"
      className="aria-flat-row flex min-w-0 cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5"
      onClick={() => onPickTrack(track.id, queue)}
      onContextMenu={(event) => trackMenu?.open(event, track, queue)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onPickTrack(track.id, queue);
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
        {index != null && (
          <span className="w-6 shrink-0 text-center text-xs tabular-nums text-neutral-400">
            {String(index + 1).padStart(2, "0")}
          </span>
        )}
        <CoverArt track={track} className="size-12 rounded-lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            <CopyableTrackText track={track} field="title">
              {track.title}
            </CopyableTrackText>
          </span>
          <span className="mt-1 block truncate text-xs text-neutral-500">
            <CopyableTrackText track={track} field="artist">
              {track.artist}
            </CopyableTrackText>{" "}
            · {track.album}
          </span>
          {showMatchedLyric && track.matchedLyric && (
            <span
              className="mt-1.5 block truncate text-xs text-violet-600"
              title={track.matchedLyric}
            >
              “{track.matchedLyric}”
            </span>
          )}
        </span>
        <span className="ml-2 flex shrink-0 flex-col items-end gap-1 text-xs text-neutral-400">
          <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
            {track.vip && (
              <span
                className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700"
                title="需要开通会员（VIP）才能播放整首歌；仅高音质受限的歌曲不会标记 VIP"
              >
                VIP
              </span>
            )}
            <span className="shrink-0 whitespace-nowrap">{formatAudioDetail(track)}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
            <SourceBadge source={track.source} compact />
            <span>{track.duration}</span>
          </span>
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
        {onPlayNext && (
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-full text-neutral-400 transition hover:bg-violet-50 hover:text-violet-600"
            title="下一首播放"
            aria-label={`下一首播放：${track.title}`}
            onClick={() => onPlayNext(track.id)}
          >
            <ListEnd className="size-4" />
          </button>
        )}
        <AddToPlaylistButton track={track} />
      </div>
    </div>
  );
}

export function UserDetailSurface({
  user,
  playlists,
  loading,
  error,
  more,
  onBack,
  onRetry,
  onLoadMore,
  onPickPlaylist,
}: {
  user: ProviderUser;
  playlists: ProviderPlaylist[];
  loading: boolean;
  error: string | null;
  more: boolean;
  onBack: () => void;
  onRetry: () => void;
  onLoadMore: () => void;
  onPickPlaylist: (playlist: ProviderPlaylist) => void;
}) {
  return (
    <section className="aria-page-shell flex h-full min-h-0 flex-col overflow-hidden rounded-[1.5rem] p-5 sm:p-7">
      <BackButton onBack={onBack} label="返回用户搜索" />
      <header className="aria-page-header my-4 flex shrink-0 items-center gap-5 pb-4">
        <ArtistAvatar
          name={user.nickname}
          avatarUrl={user.avatarUrl}
          className="size-20 rounded-full"
        />
        <div className="min-w-0">
          <p className="text-xs text-neutral-400">网易云用户</p>
          <h1
            className="mt-1 truncate text-2xl font-semibold sm:text-3xl"
            title={user.nickname}
          >
            {user.nickname}
          </h1>
          <p className="mt-2 max-w-3xl line-clamp-2 text-sm text-neutral-500">
            {user.signature || "这个用户还没有填写签名。"}
          </p>
          <p className="mt-2 text-xs text-neutral-400">
            {user.followCount != null && `关注 ${user.followCount}　`}
            {user.followerCount != null && `粉丝 ${user.followerCount}　`}
            {user.playlistCount != null && `歌单 ${user.playlistCount}`}
          </p>
        </div>
      </header>
      <h2 className="mb-3 text-lg font-semibold">公开歌单</h2>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
        <DiscoveryError error={error} onRetry={onRetry} />
        <div className="mt-2 grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
          {playlists.map((playlist) => (
            <PlaylistDiscoveryCard
              key={playlist.id}
              playlist={playlist}
              onPick={onPickPlaylist}
            />
          ))}
        </div>
        {!playlists.length && !error && (
          <EmptyState
            text={
              loading
                ? "正在读取用户资料和歌单。"
                : "这个用户没有可见的公开歌单。"
            }
          />
        )}
        <DiscoveryLoadMore
          loading={loading}
          more={more}
          onLoadMore={onLoadMore}
        />
      </div>
    </section>
  );
}

export function AlbumDetailSurface({
  album,
  tracks,
  loading,
  error,
  onBack,
  onRetry,
  onPickTrack,
  onPickArtist,
}: {
  album: ProviderAlbum;
  tracks: Track[];
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onRetry: () => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
  onPickArtist?: (artistId: string, name: string) => void;
}) {
  const playlistActions = usePlaylistActions();
  return (
    <section className="aria-page-shell flex h-full min-h-0 flex-col overflow-hidden rounded-[1.5rem] p-5 sm:p-7">
      <BackButton onBack={onBack} label="返回" />
      <div className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        <header className="aria-page-header flex items-center gap-6 pb-5">
          <DiscoveryArtwork
            src={album.coverUrl}
            name={album.name}
            cacheSize={512}
            className="size-36 rounded-2xl"
          />
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-2xl font-semibold leading-snug sm:text-3xl">
              {album.name}
            </h1>
            <button
              type="button"
              disabled={!album.artistId || !onPickArtist}
              onClick={() =>
                album.artistId && onPickArtist?.(album.artistId, album.artist)
              }
              className="mt-2 max-w-full truncate text-sm text-neutral-500 enabled:hover:text-violet-700"
            >
              {album.artist}
            </button>
            <p className="mt-2 text-xs text-neutral-400">
              {album.publishTime
                ? new Date(album.publishTime).toLocaleDateString("zh-CN")
                : "发行日期未知"}{" "}
              · {tracks.length || album.trackCount || 0} 首
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={!tracks.length}
                onClick={() => tracks[0] && onPickTrack(tracks[0].id, tracks)}
                className="flex items-center gap-2 rounded-full bg-neutral-950 px-4 py-2 text-xs font-medium text-white disabled:opacity-40"
              >
                <Play className="size-3.5 fill-current" />
                播放全部
              </button>
              {playlistActions && (
                <button
                  type="button"
                  disabled={!tracks.length}
                  onClick={() => playlistActions.openAdd(tracks)}
                  className="flex items-center gap-2 rounded-full bg-violet-50 px-4 py-2 text-xs font-medium text-violet-700 disabled:opacity-40"
                >
                  <ListPlus className="size-3.5" />
                  加入歌单
                </button>
              )}
            </div>
          </div>
        </header>
        {album.description && (
          <details className="aria-flat-well mt-5 rounded-xl px-4 py-3 text-sm text-neutral-600">
            <summary className="cursor-pointer font-medium">专辑介绍</summary>
            <p className="mt-3 whitespace-pre-line leading-7">
              {album.description}
            </p>
          </details>
        )}
        <div className="mt-5">
          <DiscoveryError error={error} onRetry={onRetry} />
        </div>
        <div className="my-4 flex items-center gap-2 text-sm font-semibold">
          <ListMusic className="size-4 text-neutral-400" />
          专辑曲目
          {loading && (
            <LoaderCircle className="size-4 animate-spin text-neutral-400" />
          )}
        </div>
        <div className="grid gap-2">
          {tracks.map((track, index) => (
            <DiscoveryTrackRow
              key={track.id}
              track={track}
              queue={tracks}
              index={index}
              onPickTrack={onPickTrack}
            />
          ))}
        </div>
        {!tracks.length && !error && (
          <EmptyState
            text={
              loading
                ? "正在加载完整专辑曲目。"
                : "该专辑暂时没有可播放的曲目。"
            }
          />
        )}
      </div>
    </section>
  );
}

function BackButton({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="aria-chip flex w-fit shrink-0 items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium"
    >
      <ArrowLeft className="size-3.5" />
      {label}
    </button>
  );
}

export type DiscoveryArtistDetail = Awaited<
  ReturnType<typeof api.getNeteaseArtistDetail>
>;
