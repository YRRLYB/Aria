import type { Track } from "@/data/music";
import type { PlayHistoryEntry } from "@/lib/playHistory";
import { formatAudioDetail, parseDuration, splitArtistNames } from "@/lib/playerPresentation";

export type ListeningSourceStat = {
  source: Track["source"];
  label: string;
  libraryCount: number;
  playCount: number;
  share: number;
  color: string;
};

export type ListeningArtistStat = {
  name: string;
  playCount: number;
  trackCount: number;
  share: number;
  leadTrack: Track;
};

export type ListeningTrackStat = {
  track: Track;
  playCount: number;
  share: number;
  audioDetail: string;
};

export type HourlyListeningBucket = {
  hour: number;
  label: string;
  count: number;
  intensity: number;
};

export type ListeningInsights = {
  totalPlays: number;
  uniquePlayedTracks: number;
  libraryTotal: number;
  estimatedSeconds: number;
  activeDays: number;
  activeSourceCount: number;
  peakHour: number | null;
  personaLabel: string;
  personaDetail: string;
  hourly: HourlyListeningBucket[];
  sources: ListeningSourceStat[];
  topArtists: ListeningArtistStat[];
  topTracks: ListeningTrackStat[];
};

const SOURCE_CONFIG: Array<{ source: Track["source"]; label: string; color: string }> = [
  { source: "netease", label: "网易云音乐", color: "#E60026" },
  { source: "qq", label: "QQ 音乐", color: "#0DAF52" },
  { source: "bilibili", label: "哔哩哔哩", color: "#00AEEC" },
  { source: "local", label: "本地无损库", color: "#7C5CE6" },
  { source: "cloud", label: "音乐云盘", color: "#4F6EF7" },
];

export function formatListeningDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  if (safe < 60) return safe > 0 ? `${safe} 秒` : "0 分钟";
  const totalMinutes = Math.floor(safe / 60);
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
}

function classifyListeningPersona(peakHour: number | null, totalPlays: number) {
  if (totalPlays <= 0) {
    return {
      personaLabel: "等待第一段旋律",
      personaDetail: "开始播放歌曲后，将自动绘制你的昼夜听歌节律与声音偏好",
    };
  }
  if (peakHour === null) {
    return {
      personaLabel: "自由漫游者",
      personaDetail: "已记录累计播放次数，继续播放即可激活 24 小时节律分析",
    };
  }
  if (peakHour >= 5 && peakHour <= 10) {
    return {
      personaLabel: "清晨唤醒派",
      personaDetail: `高峰出现在 ${String(peakHour).padStart(2, "0")}:00，喜欢用旋律开启清晨`,
    };
  }
  if (peakHour >= 11 && peakHour <= 16) {
    return {
      personaLabel: "午后沉浸派",
      personaDetail: `高峰出现在 ${String(peakHour).padStart(2, "0")}:00，音乐常伴专注与午后时光`,
    };
  }
  if (peakHour >= 17 && peakHour <= 20) {
    return {
      personaLabel: "黄昏漫步派",
      personaDetail: `高峰出现在 ${String(peakHour).padStart(2, "0")}:00，在暮色与归途中切换心情`,
    };
  }
  return {
    personaLabel: "深夜漫游派",
    personaDetail: `高峰出现在 ${String(peakHour).padStart(2, "0")}:00，夜深人静时的情绪共鸣最高`,
  };
}

export function computeListeningInsights(
  tracks: Track[],
  playCounts: Record<string, number>,
  playHistory: PlayHistoryEntry[] = [],
): ListeningInsights {
  const trackById = new Map<string, Track>();
  for (const track of tracks) {
    if (track.id && track.id !== "idle") trackById.set(track.id, track);
  }
  for (const entry of playHistory) {
    if (entry.track?.id && entry.track.id !== "idle" && !trackById.has(entry.track.id)) {
      trackById.set(entry.track.id, entry.track);
    }
  }

  const effectivePlays = new Map<string, number>();
  for (const [id, count] of Object.entries(playCounts)) {
    if (id !== "idle" && count > 0 && trackById.has(id)) {
      effectivePlays.set(id, count);
    }
  }
  for (const entry of playHistory) {
    const id = entry.track?.id;
    if (!id || id === "idle") continue;
    const count = Math.max(1, entry.count || 1);
    const existing = effectivePlays.get(id) ?? 0;
    if (count > existing) effectivePlays.set(id, count);
  }

  let totalPlays = 0;
  let estimatedSeconds = 0;
  const playCountBySource = new Map<Track["source"], number>();
  const libraryCountBySource = new Map<Track["source"], number>();
  for (const track of tracks) {
    if (track.id === "idle") continue;
    libraryCountBySource.set(track.source, (libraryCountBySource.get(track.source) ?? 0) + 1);
  }

  const artistAcc = new Map<
    string,
    { name: string; playCount: number; trackIds: Set<string>; leadTrack: Track; leadPlays: number }
  >();
  const trackRows: Array<{ track: Track; playCount: number }> = [];

  for (const [id, count] of effectivePlays) {
    const track = trackById.get(id);
    if (!track || count <= 0) continue;
    totalPlays += count;
    const dur = parseDuration(track.duration);
    if (dur > 0) estimatedSeconds += dur * count;
    playCountBySource.set(track.source, (playCountBySource.get(track.source) ?? 0) + count);
    trackRows.push({ track, playCount: count });

    for (const artistName of splitArtistNames(track.artist)) {
      const key = artistName.toLowerCase();
      const existing = artistAcc.get(key);
      if (existing) {
        existing.playCount += count;
        existing.trackIds.add(track.id);
        if (count > existing.leadPlays) {
          existing.leadTrack = track;
          existing.leadPlays = count;
        }
      } else {
        artistAcc.set(key, {
          name: artistName,
          playCount: count,
          trackIds: new Set([track.id]),
          leadTrack: track,
          leadPlays: count,
        });
      }
    }
  }

  trackRows.sort((left, right) => right.playCount - left.playCount);
  const topTrackMax = trackRows[0]?.playCount ?? 0;
  const topTracks: ListeningTrackStat[] = trackRows.slice(0, 12).map(({ track, playCount }) => ({
    track,
    playCount,
    share: topTrackMax > 0 ? playCount / topTrackMax : 0,
    audioDetail: formatAudioDetail(track),
  }));

  const sortedArtists = [...artistAcc.values()].sort(
    (left, right) => right.playCount - left.playCount || right.trackIds.size - left.trackIds.size,
  );
  const topArtistMax = sortedArtists[0]?.playCount ?? 0;
  const topArtists: ListeningArtistStat[] = sortedArtists.slice(0, 6).map((item) => ({
    name: item.name,
    playCount: item.playCount,
    trackCount: item.trackIds.size,
    share: topArtistMax > 0 ? item.playCount / topArtistMax : 0,
    leadTrack: item.leadTrack,
  }));

  const hourBins = new Array<number>(24).fill(0);
  const dayKeys = new Set<string>();
  for (const entry of playHistory) {
    if (!Number.isFinite(entry.playedAt) || entry.playedAt <= 0) continue;
    const date = new Date(entry.playedAt);
    const hour = date.getHours();
    hourBins[hour] += Math.max(1, entry.count || 1);
    dayKeys.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`);
  }
  const maxHourCount = Math.max(0, ...hourBins);
  const peakHour = maxHourCount > 0 ? hourBins.indexOf(maxHourCount) : null;
  const hourly: HourlyListeningBucket[] = hourBins.map((count, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    count,
    intensity: maxHourCount > 0 ? count / maxHourCount : 0,
  }));

  const libraryTotal = tracks.filter((track) => track.id !== "idle").length;
  const shareDenominator = totalPlays > 0 ? totalPlays : libraryTotal;
  const sources: ListeningSourceStat[] = SOURCE_CONFIG.map(({ source, label, color }) => {
    const playCount = playCountBySource.get(source) ?? 0;
    const libraryCount = libraryCountBySource.get(source) ?? 0;
    const numerator = totalPlays > 0 ? playCount : libraryCount;
    return {
      source,
      label,
      libraryCount,
      playCount,
      share: shareDenominator > 0 ? (numerator / shareDenominator) * 100 : 0,
      color,
    };
  });

  const activeSourceCount = sources.filter((item) => item.playCount > 0 || item.libraryCount > 0).length;
  const persona = classifyListeningPersona(peakHour, totalPlays);

  return {
    totalPlays,
    uniquePlayedTracks: trackRows.length,
    libraryTotal,
    estimatedSeconds,
    activeDays: dayKeys.size,
    activeSourceCount,
    peakHour,
    ...persona,
    hourly,
    sources,
    topArtists,
    topTracks,
  };
}
