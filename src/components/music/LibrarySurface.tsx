import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Album, Disc3, FolderOpen, Languages, ListMusic, RefreshCw, X } from "lucide-react";
import type { LyricCandidate, Track } from "@/data/music";
import { api } from "@/lib/api";
import { formatAudioDetail } from "@/lib/playerPresentation";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CoverArt, CopyableTrackText, EmptyState } from "./shared";

type LibrarySurfaceProps = {
  folderName: string;
  onChooseFolder: () => void;
  tracks: Track[];
  localTrackCount: number;
  libraryMeta: { roots: number; updatedAt: string | null };
  activeTrackId: string;
  onPickTrack: (id: string, queue?: Track[]) => void;
  onScanPath: (folderPath: string) => Promise<void>;
  onScanCd: () => Promise<void>;
  onLyricsBound: (trackId: string, lyrics: Track["lyrics"]) => void;
  onArtworkBound: (trackId: string, coverUrl?: string | null) => void;
};

type LocalAlbumGroup = {
  key: string;
  title: string;
  artist: string;
  coverTrack: Track;
  tracks: Track[];
  totalDuration: string;
  mediaKind: Track["mediaKind"];
};

export function LibrarySurface({
  folderName,
  onChooseFolder,
  tracks: libraryTracks,
  localTrackCount,
  libraryMeta,
  activeTrackId,
  onPickTrack,
  onScanPath,
  onScanCd,
  onLyricsBound,
  onArtworkBound,
}: LibrarySurfaceProps) {
  const [lookupOpen, setLookupOpen] = useState(false);
  const [boundCandidateId, setBoundCandidateId] = useState<string | null>(null);
  const [scanPath, setScanPath] = useState("");
  const [scanState, setScanState] = useState<"idle" | "scanning" | "error">("idle");
  const [cdScanState, setCdScanState] = useState<"idle" | "scanning" | "error">("idle");
  const [mode, setMode] = useState<"tracks" | "albums">("albums");
  const albums = useMemo(() => createAlbumGroups(libraryTracks), [libraryTracks]);
  const [selectedAlbumKey, setSelectedAlbumKey] = useState<string | null>(null);
  const selectedAlbum = useMemo(
    () => albums.find((album) => album.key === selectedAlbumKey) ?? albums[0] ?? null,
    [albums, selectedAlbumKey],
  );
  const candidateTarget = libraryTracks.find((track) => track.lyricStatus !== "linked") ?? libraryTracks[0];

  async function submitScanPath() {
    if (!scanPath.trim()) return;
    setScanState("scanning");
    try {
      await onScanPath(scanPath.trim());
      setScanState("idle");
      setMode("albums");
    } catch {
      setScanState("error");
    }
  }

  async function submitCdScan() {
    setCdScanState("scanning");
    try {
      await onScanCd();
      setCdScanState("idle");
      setMode("albums");
    } catch {
      setCdScanState("error");
    }
  }

  return (
    <div className="glass no-scrollbar h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <Badge>Library</Badge>
          <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">本地音乐</h1>
          <p className="mt-3 text-neutral-500">{folderName}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="glass" onClick={() => setLookupOpen((value) => !value)}>
            {lookupOpen ? <X /> : <Languages />}
            {lookupOpen ? "收起搜词" : "联网搜词"}
          </Button>
          <Button variant="glass" onClick={submitCdScan} disabled={cdScanState === "scanning"}>
            <Disc3 className={cn(cdScanState === "scanning" && "animate-spin")} />
            {cdScanState === "scanning" ? "扫描光盘中" : "扫描光盘"}
          </Button>
          <Button onClick={onChooseFolder}>
            <FolderOpen />
            选择文件夹
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-4">
        <LibraryInfoCard label="专辑" value={`${albums.length} 张`} />
        <LibraryInfoCard label="索引曲目" value={`${localTrackCount} 首`} />
        <LibraryInfoCard label="目录数量" value={`${libraryMeta.roots} 个`} />
        <LibraryInfoCard
          label="更新时间"
          value={libraryMeta.updatedAt ? new Date(libraryMeta.updatedAt).toLocaleString() : "尚未扫描"}
        />
      </div>

      <div className="mt-5 rounded-[1.25rem] bg-white/52 p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-400">Backend Scan</p>
            <input
              value={scanPath}
              onChange={(event) => setScanPath(event.target.value)}
              placeholder="输入本机音乐目录路径，例如 E:\\Music"
              className="mt-2 w-full rounded-full border border-white/70 bg-white/70 px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:border-neutral-300"
            />
          </div>
          <Button onClick={submitScanPath} disabled={scanState === "scanning"}>
            <RefreshCw className={cn(scanState === "scanning" && "animate-spin")} />
            {scanState === "scanning" ? "扫描中" : "扫描目录"}
          </Button>
        </div>
        {scanState === "error" && (
          <p className="mt-3 text-sm text-neutral-500">扫描失败，请确认路径存在且后端服务正在运行。</p>
        )}
        {cdScanState === "error" && (
          <p className="mt-3 text-sm text-neutral-500">没有读取到音频光盘曲目，或当前光驱不支持枚举。</p>
        )}
      </div>

      <AnimatePresence initial={false}>
        {lookupOpen && candidateTarget && (
          <LyricLookupPanel
            track={candidateTarget}
            boundCandidateId={boundCandidateId}
            onBind={setBoundCandidateId}
            onLyricsBound={onLyricsBound}
            onArtworkBound={onArtworkBound}
          />
        )}
      </AnimatePresence>

      <div className="mt-7 flex items-center justify-between gap-3">
        <div className="rounded-full border border-white/70 bg-white/52 p-1 shadow-sm">
          <button
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-neutral-500 transition",
              mode === "albums" && "bg-neutral-950 text-white",
            )}
            onClick={() => setMode("albums")}
          >
            <Album className="size-4" />
            专辑
          </button>
          <button
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-neutral-500 transition",
              mode === "tracks" && "bg-neutral-950 text-white",
            )}
            onClick={() => setMode("tracks")}
          >
            <ListMusic className="size-4" />
            曲目
          </button>
        </div>
        <Badge>{mode === "albums" ? "点击专辑进入曲目" : "按专辑顺序排列"}</Badge>
      </div>

      {mode === "albums" ? (
        <AlbumLibraryView
          albums={albums}
          selectedAlbum={selectedAlbum}
          activeTrackId={activeTrackId}
          onSelectAlbum={setSelectedAlbumKey}
          onPickTrack={onPickTrack}
        />
      ) : (
        <TrackListView tracks={libraryTracks} activeTrackId={activeTrackId} onPickTrack={onPickTrack} />
      )}
    </div>
  );
}

function AlbumLibraryView({
  albums,
  selectedAlbum,
  activeTrackId,
  onSelectAlbum,
  onPickTrack,
}: {
  albums: LocalAlbumGroup[];
  selectedAlbum: LocalAlbumGroup | null;
  activeTrackId: string;
  onSelectAlbum: (key: string) => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
}) {
  if (!albums.length) return <EmptyState text="还没有本地专辑。选择文件夹或扫描光盘后，这里会按专辑自动整理。" />;

  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,0.96fr)_minmax(360px,0.74fr)]">
      <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {albums.map((album) => {
          const active = selectedAlbum?.key === album.key;
          return (
            <button
              key={album.key}
              className={cn(
                "group rounded-[1.25rem] bg-white/48 p-3 text-left shadow-sm transition hover:bg-white/75",
                active && "bg-white shadow-md",
              )}
              onClick={() => onSelectAlbum(album.key)}
            >
              <CoverArt track={album.coverTrack} className="aspect-square w-full rounded-[1rem]" />
              <div className="mt-3 min-w-0">
                <p className="line-clamp-2 font-semibold leading-tight">{album.title}</p>
                <p className="mt-1 truncate text-sm text-neutral-500">{album.artist}</p>
                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-neutral-500">
                  <span>{album.tracks.length} 首</span>
                  <span>{album.mediaKind === "audio-cd" ? "Audio CD" : album.totalDuration}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {selectedAlbum && (
        <section className="rounded-[1.35rem] bg-white/50 p-4 shadow-sm">
          <div className="flex gap-4">
            <CoverArt track={selectedAlbum.coverTrack} className="size-24 rounded-[1.15rem]" />
            <div className="min-w-0">
              <Badge>{selectedAlbum.mediaKind === "audio-cd" ? "Audio CD" : "Album"}</Badge>
              <h2 className="mt-3 line-clamp-2 text-2xl font-semibold leading-tight">{selectedAlbum.title}</h2>
              <p className="mt-1 truncate text-sm text-neutral-500">{selectedAlbum.artist}</p>
            </div>
          </div>
          <div className="mt-5 grid gap-2">
            {selectedAlbum.tracks.map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                index={index}
                active={activeTrackId === track.id}
                queue={selectedAlbum.tracks}
                onPickTrack={onPickTrack}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function TrackListView({
  tracks,
  activeTrackId,
  onPickTrack,
}: {
  tracks: Track[];
  activeTrackId: string;
  onPickTrack: (id: string, queue?: Track[]) => void;
}) {
  if (!tracks.length) return <EmptyState text="还没有扫描到本地音乐。你可以选择文件夹，或直接输入路径扫描。" />;
  return (
    <div className="mt-5 grid gap-3">
      {tracks.map((track, index) => (
        <TrackRow
          key={track.id}
          track={track}
          index={index}
          active={activeTrackId === track.id}
          queue={tracks}
          onPickTrack={onPickTrack}
        />
      ))}
    </div>
  );
}

function TrackRow({
  track,
  index,
  active,
  queue,
  onPickTrack,
}: {
  track: Track;
  index: number;
  active: boolean;
  queue: Track[];
  onPickTrack: (id: string, queue?: Track[]) => void;
}) {
  return (
    <button
      className={cn(
        "grid grid-cols-[2.5rem_3.5rem_minmax(0,1fr)_auto] items-center gap-4 rounded-[1.3rem] bg-white/45 p-3 text-left transition hover:bg-white/75",
        active && "bg-white shadow-sm",
      )}
      onClick={() => onPickTrack(track.id, queue)}
    >
      <span className="text-center text-sm font-medium text-neutral-400">{String(index + 1).padStart(2, "0")}</span>
      <CoverArt track={track} className="size-14 rounded-2xl" />
      <div className="min-w-0">
        <p className="truncate font-semibold">
          <CopyableTrackText track={track} field="title">
            {track.title}
          </CopyableTrackText>
        </p>
        <p className="truncate text-sm text-neutral-500">
          <CopyableTrackText track={track} field="artist">
            {track.artist}
          </CopyableTrackText>
          <span className="mx-1">·</span>
          <CopyableTrackText track={track} field="album">
            {track.album}
          </CopyableTrackText>
        </p>
      </div>
      <div className="hidden items-center gap-2 sm:flex">
        <Badge>{track.lyricStatus === "linked" ? "有歌词" : "待匹配"}</Badge>
        <Badge>{formatAudioDetail(track)}</Badge>
        <span className="w-12 text-right text-sm text-neutral-500">{track.duration}</span>
      </div>
    </button>
  );
}

function LibraryInfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.15rem] bg-white/52 p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.2em] text-neutral-400">{label}</p>
      <p className="mt-2 text-sm font-semibold text-neutral-700">{value}</p>
    </div>
  );
}

function LyricLookupPanel({
  track,
  boundCandidateId,
  onBind,
  onLyricsBound,
  onArtworkBound,
}: {
  track: Track;
  boundCandidateId: string | null;
  onBind: (id: string) => void;
  onLyricsBound: (trackId: string, lyrics: Track["lyrics"]) => void;
  onArtworkBound: (trackId: string, coverUrl?: string | null) => void;
}) {
  const [candidates, setCandidates] = useState<LyricCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchLyrics() {
    setLoading(true);
    setError(null);
    try {
      const result = await api.searchLyrics({
        title: track.title,
        artist: track.artist,
        album: track.album,
      });
      setCandidates(result.candidates);
    } catch {
      setCandidates([]);
      setError("歌词搜索失败，请确认后端服务正在运行。");
    } finally {
      setLoading(false);
    }
  }

  async function bindLyric(candidateId: string) {
    onBind(candidateId);
    onArtworkBound(track.id, candidates.find((candidate) => candidate.id === candidateId)?.coverUrl);
    try {
      const result = await api.bindLyric(track.id, candidateId);
      onLyricsBound(track.id, result.lyrics);
    } catch {
      setError("后端保存失败，歌词绑定未写入本地索引。");
    }
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: -10, filter: "blur(12px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -8, filter: "blur(10px)" }}
      transition={{ duration: 0.26 }}
      className="mt-5 rounded-[1.35rem] border border-white/70 bg-white/50 p-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-neutral-400">Online Lyrics</p>
          <h2 className="mt-1 truncate text-xl font-semibold">
            <CopyableTrackText track={track} field="title">
              {track.title}
            </CopyableTrackText>
          </h2>
          <p className="truncate text-sm text-neutral-500">
            <CopyableTrackText track={track} field="artist">
              {track.artist}
            </CopyableTrackText>
            <span className="mx-1">·</span>
            {track.album}
          </p>
        </div>
        <Button variant="subtle" size="sm" onClick={searchLyrics} disabled={loading}>
          <RefreshCw className={cn(loading && "animate-spin")} />
          {loading ? "搜索中" : "重新搜索"}
        </Button>
      </div>
      {error && <p className="mt-3 text-xs text-neutral-500">{error}</p>}

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {candidates.map((candidate) => (
          <LyricCandidateCard
            key={candidate.id}
            candidate={candidate}
            selected={boundCandidateId === candidate.id}
            onBind={() => bindLyric(candidate.id)}
          />
        ))}
      </div>
      {!candidates.length && !loading && <EmptyState text="暂无歌词候选，点击重新搜索获取网易云结果。" />}
    </motion.section>
  );
}

function LyricCandidateCard({
  candidate,
  selected,
  onBind,
}: {
  candidate: LyricCandidate;
  selected: boolean;
  onBind: () => void;
}) {
  return (
    <article
      className={cn("rounded-[1.15rem] bg-white/62 p-4 shadow-sm transition", selected && "bg-neutral-950 text-white")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Badge className={cn(selected && "border-white/20 bg-white/12 text-white")}>{candidate.source}</Badge>
          <h3 className="mt-3 truncate font-semibold">{candidate.title}</h3>
          <p className={cn("truncate text-xs", selected ? "text-white/64" : "text-neutral-500")}>
            {candidate.artist} · {candidate.album}
          </p>
        </div>
        <span className={cn("text-2xl font-semibold", selected ? "text-white" : "text-neutral-950")}>
          {candidate.score}
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {candidate.preview.map((line) => (
          <p key={line} className={cn("truncate text-sm", selected ? "text-white/72" : "text-neutral-600")}>
            {line}
          </p>
        ))}
      </div>
      <Button className="mt-4 w-full" variant={selected ? "subtle" : "default"} size="sm" onClick={onBind}>
        <Languages />
        {selected ? "已绑定" : "绑定歌词"}
      </Button>
    </article>
  );
}

function createAlbumGroups(tracks: Track[]): LocalAlbumGroup[] {
  const groups = new Map<string, Track[]>();
  for (const track of tracks) {
    const key = [
      track.libraryRoot ?? track.source,
      track.albumArtist || track.artist || "Unknown Artist",
      track.album || "Unknown Album",
    ].join("\u0000");
    const group = groups.get(key) ?? [];
    group.push(track);
    groups.set(key, group);
  }

  return Array.from(groups.entries())
    .map(([key, group]) => {
      const orderedTracks = [...group].sort(compareAlbumTracks);
      const fallbackTrack = orderedTracks[0]!;
      const coverTrack = orderedTracks.find((track) => Boolean(track.coverUrl)) ?? fallbackTrack;
      return {
        key,
        title: fallbackTrack.album || "Unknown Album",
        artist: fallbackTrack.albumArtist || fallbackTrack.artist || "Unknown Artist",
        coverTrack,
        tracks: orderedTracks,
        totalDuration: formatAlbumDuration(orderedTracks),
        mediaKind: orderedTracks.some((track) => track.mediaKind === "audio-cd") ? "audio-cd" : "file",
      };
    })
    .sort((a, b) => `${a.artist} ${a.title}`.localeCompare(`${b.artist} ${b.title}`, "zh-CN"));
}

function compareAlbumTracks(a: Track, b: Track) {
  const discCompare = (a.discNumber ?? 0) - (b.discNumber ?? 0);
  if (discCompare !== 0) return discCompare;
  const trackCompare = (a.trackNumber ?? 9999) - (b.trackNumber ?? 9999);
  if (trackCompare !== 0) return trackCompare;
  return a.title.localeCompare(b.title, "zh-CN");
}

function formatAlbumDuration(tracks: Track[]) {
  const total = tracks.reduce((sum, track) => sum + parseDisplayDuration(track.duration), 0);
  if (!total) return `${tracks.length} 首`;
  const minutes = Math.floor(total / 60);
  const hours = Math.floor(minutes / 60);
  if (!hours) return `${minutes} 分钟`;
  return `${hours} 小时 ${minutes % 60} 分钟`;
}

function parseDisplayDuration(value: string) {
  const parts = value.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}
