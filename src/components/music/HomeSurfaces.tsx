import { useMemo } from "react";
import { ListMusic, Pause, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyableTrackText, CoverArt, EmptyState, StatTile } from "@/components/music/shared";
import { formatAudioDetail } from "@/lib/playerPresentation";
import type { PlayHistoryEntry } from "@/lib/playHistory";
import { sourceLabel } from "@/lib/trackLabels";

export function HomeSidePanel({
  history,
  onOpenHistory,
  onPickTrack,
}: {
  history: PlayHistoryEntry[];
  onOpenHistory: () => void;
  onPickTrack: (id: string) => void;
}) {
  const recent = history.slice(0, 8);

  return (
    <aside className="glass hidden min-h-0 flex-col rounded-[1.5rem] p-4 lg:flex">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-neutral-400">History</p>
          <h2 className="mt-1 text-xl font-semibold">最近播放</h2>
        </div>
        <Button variant="ghost" size="icon" aria-label="打开播放历史" onClick={onOpenHistory}>
          <ListMusic />
        </Button>
      </div>

      <div className="no-scrollbar mt-5 grid min-h-0 gap-2 overflow-y-auto pr-1">
        {recent.map((entry) => (
          <button
            key={`${entry.track.id}-${entry.playedAt}`}
            className="grid grid-cols-[3rem_1fr_auto] items-center gap-3 rounded-[1.15rem] bg-white/54 p-2.5 text-left shadow-sm transition hover:bg-white"
            onClick={() => onPickTrack(entry.track.id)}
          >
            <CoverArt track={entry.track} className="size-12 rounded-2xl" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                <CopyableTrackText track={entry.track} field="title">{entry.track.title}</CopyableTrackText>
              </span>
              <span className="block truncate text-xs text-neutral-500">
                <CopyableTrackText track={entry.track} field="artist">{entry.track.artist}</CopyableTrackText>
              </span>
            </span>
            <Badge>{entry.count} 次</Badge>
          </button>
        ))}
        {!recent.length && <EmptyState text="播放过歌曲后，这里会显示最近记录。" />}
      </div>
    </aside>
  );
}

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
  const recentHistory = playHistory.slice(0, 8);

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
                <span className="text-sm text-neutral-500">{new Date(entry.playedAt).toLocaleDateString()}</span>
              </button>
            ))}
            {!recentHistory.length && <EmptyState text="播放过歌曲后，这里会显示最近记录。" />}
          </div>
        </div>
      </section>
    </div>
  );
}

export function HistorySurface({
  history,
  onPickTrack,
}: {
  history: PlayHistoryEntry[];
  onPickTrack: (id: string) => void;
}) {
  const totalPlays = history.reduce((sum, entry) => sum + entry.count, 0);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayCount = history.filter((entry) => entry.playedAt >= todayStart.getTime()).length;

  return (
    <div className="glass h-full min-h-[620px] overflow-hidden rounded-[1.5rem] p-5 sm:p-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Badge>History</Badge>
          <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">播放历史</h1>
          <p className="mt-3 text-neutral-500">最近听过的歌曲会按播放时间保留在这里。</p>
        </div>
        <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-3">
          <StatTile label="记录" value={String(history.length)} />
          <StatTile label="播放" value={String(totalPlays)} />
          <StatTile label="今天" value={String(todayCount)} />
        </div>
      </div>

      <div className="no-scrollbar mt-8 grid max-h-[calc(100%-10rem)] gap-3 overflow-y-auto pr-1">
        {history.map((entry, index) => (
          <button
            key={`${entry.track.id}-${entry.playedAt}`}
            className="grid grid-cols-[2.5rem_3.75rem_minmax(0,1fr)_auto] items-center gap-4 rounded-[1.35rem] bg-white/48 p-3 text-left shadow-sm transition hover:bg-white/78"
            onClick={() => onPickTrack(entry.track.id)}
          >
            <span className="text-center text-sm font-semibold text-neutral-400">{String(index + 1).padStart(2, "0")}</span>
            <CoverArt track={entry.track} className="size-14 rounded-2xl" />
            <span className="min-w-0">
              <span className="block truncate font-semibold">
                <CopyableTrackText track={entry.track} field="title">{entry.track.title}</CopyableTrackText>
              </span>
              <span className="mt-1 block truncate text-sm text-neutral-500">
                <CopyableTrackText track={entry.track} field="artist">{entry.track.artist}</CopyableTrackText> · {entry.track.album}
              </span>
            </span>
            <span className="hidden flex-col items-end gap-2 sm:flex">
              <Badge>{sourceLabel[entry.track.source]}</Badge>
              <span className="text-xs text-neutral-500">
                {new Date(entry.playedAt).toLocaleString()} · {entry.count} 次
              </span>
            </span>
          </button>
        ))}
        {!history.length && <EmptyState text="还没有播放历史，播放一首歌后这里会开始记录。" />}
      </div>
    </div>
  );
}


