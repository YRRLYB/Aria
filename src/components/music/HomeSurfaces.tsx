import { useMemo } from "react";
import { Pause, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyableTrackText, CoverArt, EmptyState, StatTile } from "@/components/music/shared";
import type { Track } from "@/data/music";
import { formatAudioDetail } from "@/lib/playerPresentation";
import type { PlayHistoryEntry } from "@/lib/playHistory";
import { sourceLabel } from "@/lib/trackLabels";

export function HomeSurface({
  activeTrack,
  tracks: homeTracks,
  playCounts,
  playHistory,
  playing,
  localTrackCount,
  neteaseLikedCount,
  playlistCount,
  onTogglePlay,
  onPickTrack,
  onOpenPlayer,
}: {
  activeTrack: Track;
  tracks: Track[];
  playCounts: Record<string, number>;
  playHistory: PlayHistoryEntry[];
  playing: boolean;
  localTrackCount: number;
  neteaseLikedCount: number;
  playlistCount: number;
  onTogglePlay: () => void;
  onPickTrack: (id: string) => void;
  onOpenPlayer: () => void;
}) {
  const rankedTracks = useMemo(
    () =>
      [...homeTracks]
        .sort((left, right) => {
          const byCount = (playCounts[right.id] ?? 0) - (playCounts[left.id] ?? 0);
          if (byCount !== 0) return byCount;
          return left.title.localeCompare(right.title, "zh-CN");
        })
        .slice(0, 20),
    [homeTracks, playCounts],
  );
  const recentHistory = playHistory.slice(0, 12);

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,0.86fr)_minmax(0,1.14fr)] gap-4 overflow-hidden">
      <section className="glass grid min-h-0 overflow-hidden rounded-[1.5rem] lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <div className="p-5 sm:p-7">
          <Badge>Home</Badge>
          <h1 className="mt-5 max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl">
            音乐从这里开始
          </h1>
          <p className="mt-3 max-w-xl text-neutral-500">
            把本地音乐、网易云喜欢、每日推荐和云盘放在同一个主页里。
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <StatTile label="本地曲库" value={String(localTrackCount)} />
            <StatTile label="网易云喜欢" value={String(neteaseLikedCount)} />
            <StatTile label="歌单" value={String(playlistCount)} />
          </div>
        </div>
        <button
          className="group relative m-4 min-h-72 overflow-hidden rounded-[1.65rem] border border-neutral-950/10 bg-neutral-950 p-0 text-left shadow-[0_24px_70px_rgba(20,24,35,0.18)]"
          onClick={onOpenPlayer}
        >
          <CoverArt track={activeTrack} className="absolute inset-0 size-full rounded-[1.65rem]" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/82 via-black/24 to-transparent" />
          <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.14),transparent_34%,rgba(0,0,0,0.24))]" />
          <div className="absolute left-5 top-5 z-20">
            <Badge className="border-white/30 bg-black/40 text-white shadow-none backdrop-blur-md">现在播放</Badge>
          </div>
          <div className="absolute right-5 top-5 z-20">
            <Button
              className="bg-white text-neutral-950 shadow-[0_14px_34px_rgba(0,0,0,0.18)] hover:bg-white/92"
              size="iconLg"
              aria-label={playing ? "pause" : "play"}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePlay();
              }}
            >
              {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
            </Button>
          </div>
          <div className="absolute bottom-5 left-5 right-5 z-20">
            <h2 className="line-clamp-2 text-3xl font-semibold leading-tight text-white drop-shadow">
              <CopyableTrackText track={activeTrack} field="title">{activeTrack.title}</CopyableTrackText>
            </h2>
            <p className="mt-2 truncate text-base font-medium text-white/84">
              <CopyableTrackText track={activeTrack} field="artist">{activeTrack.artist}</CopyableTrackText>
            </p>
            <p className="mt-1 truncate text-xs font-medium uppercase tracking-[0.16em] text-white/58">
              {activeTrack.album} · {sourceLabel[activeTrack.source]} · {formatAudioDetail(activeTrack)}
            </p>
          </div>
        </button>
      </section>

      <section className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <div className="glass min-h-0 overflow-hidden rounded-[1.5rem] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">听歌排行</h2>
            <Badge>周榜</Badge>
          </div>
          <div className="no-scrollbar mt-4 grid max-h-[calc(100%-3.5rem)] gap-2 overflow-y-auto pr-1">
            {rankedTracks.map((track, index) => (
              <button
                key={track.id}
                className="grid grid-cols-[2rem_3rem_1fr_auto] items-center gap-3 rounded-[1.1rem] p-2 text-left transition hover:bg-white/65"
                onClick={() => onPickTrack(track.id)}
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
                <span className="text-sm text-neutral-500">{playCounts[track.id] ? `${playCounts[track.id]} 次` : track.duration}</span>
              </button>
            ))}
            {!rankedTracks.length && <EmptyState text="扫描本地目录或绑定网易云 Cookie 后显示排行。" />}
          </div>
        </div>

        <div className="glass min-h-0 overflow-hidden rounded-[1.5rem] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">最近播放</h2>
            <Badge>History</Badge>
          </div>
          <div className="no-scrollbar mt-4 grid max-h-[calc(100%-3.5rem)] gap-2 overflow-y-auto pr-1">
            {recentHistory.map((entry) => (
              <button
                key={`${entry.track.id}-${entry.playedAt}`}
                className="grid grid-cols-[3rem_1fr_auto] items-center gap-3 rounded-[1.1rem] bg-white/52 p-2.5 text-left shadow-sm transition hover:bg-white"
                onClick={() => onPickTrack(entry.track.id)}
              >
                <CoverArt track={entry.track} className="size-12 rounded-xl" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    <CopyableTrackText track={entry.track} field="title">{entry.track.title}</CopyableTrackText>
                  </p>
                  <p className="truncate text-xs text-neutral-500">
                    <CopyableTrackText track={entry.track} field="artist">{entry.track.artist}</CopyableTrackText>
                  </p>
                </div>
                <span className="text-xs text-neutral-500">{new Date(entry.playedAt).toLocaleDateString()} · {entry.count} 次</span>
              </button>
            ))}
            {!recentHistory.length && <EmptyState text="播放过歌曲后，这里会显示最近记录。" />}
          </div>
        </div>
      </section>
    </div>
  );
}


