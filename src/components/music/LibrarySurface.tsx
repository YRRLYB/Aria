import { useMemo, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Album, ArrowLeft, Disc3, FolderOpen, Languages, ListMusic, RefreshCw, X } from "lucide-react";
import type { LyricCandidate, Track } from "@/data/music";
import { api } from "@/lib/api";
import { formatAudioDetail } from "@/lib/playerPresentation";
import { useVirtualRows } from "@/lib/virtualRows";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CoverArt, CopyableTrackText, EmptyState } from "./shared";

type LibrarySurfaceProps = {
  folderName: string;
  onChooseFolder: () => void;
  tracks: Track[];
  libraryMeta: { roots: number; updatedAt: string | null };
  activeTrackId: string;
  onPickTrack: (id: string, queue?: Track[]) => void;
  onScanPath: (folderPath: string) => Promise<void>;
  onScanCd: (qualityMode: "high" | "low") => Promise<void>;
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
  const [cdReadQuality, setCdReadQuality] = useState<"high" | "low">("high");
  const [mode, setMode] = useState<"tracks" | "albums" | "cds">("albums");
  const fileTracks = useMemo(() => libraryTracks.filter((track) => track.mediaKind !== "audio-cd"), [libraryTracks]);
  const cdTracks = useMemo(() => libraryTracks.filter((track) => track.mediaKind === "audio-cd"), [libraryTracks]);
  const albums = useMemo(() => createAlbumGroups(fileTracks), [fileTracks]);
  const [selectedAlbumKey, setSelectedAlbumKey] = useState<string | null>(null);
  const selectedAlbum = useMemo(
    () => (selectedAlbumKey ? albums.find((album) => album.key === selectedAlbumKey) ?? null : null),
    [albums, selectedAlbumKey],
  );
  const candidateTarget = fileTracks.find((track) => track.lyricStatus !== "linked") ?? fileTracks[0];

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
      await onScanCd(cdReadQuality);
      setCdScanState("idle");
      setMode("cds");
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
          <Button onClick={onChooseFolder}>
            <FolderOpen />
            选择文件夹
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-4">
        <LibraryInfoCard label="专辑" value={`${albums.length} 张`} />
        <LibraryInfoCard label="本地曲目" value={`${fileTracks.length} 首`} />
        <LibraryInfoCard label="光盘曲目" value={`${cdTracks.length} 首`} />
        <LibraryInfoCard label="目录数量" value={`${libraryMeta.roots} 个`} />
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
            onClick={() => {
              setSelectedAlbumKey(null);
              setMode("tracks");
            }}
          >
            <ListMusic className="size-4" />
            曲目
          </button>
          <button
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-neutral-500 transition",
              mode === "cds" && "bg-neutral-950 text-white",
            )}
            onClick={() => {
              setSelectedAlbumKey(null);
              setMode("cds");
            }}
          >
            <Disc3 className="size-4" />
            光盘
          </button>
        </div>
        <Badge>{mode === "albums" ? "点击专辑进入曲目" : mode === "cds" ? "CD 独立管理" : "按专辑顺序排列"}</Badge>
      </div>

      {mode === "albums" ? (
        <AlbumLibraryView
          albums={albums}
          selectedAlbum={selectedAlbum}
          activeTrackId={activeTrackId}
          onSelectAlbum={setSelectedAlbumKey}
          onBack={() => setSelectedAlbumKey(null)}
          onPickTrack={onPickTrack}
        />
      ) : mode === "cds" ? (
        <CdLibraryView
          tracks={cdTracks}
          activeTrackId={activeTrackId}
          scanState={cdScanState}
          readQuality={cdReadQuality}
          onReadQualityChange={setCdReadQuality}
          onScanCd={submitCdScan}
          onPickTrack={onPickTrack}
        />
      ) : (
        <TrackListView tracks={fileTracks} activeTrackId={activeTrackId} onPickTrack={onPickTrack} />
      )}
    </div>
  );
}

function AlbumLibraryView({
  albums,
  selectedAlbum,
  activeTrackId,
  onSelectAlbum,
  onBack,
  onPickTrack,
}: {
  albums: LocalAlbumGroup[];
  selectedAlbum: LocalAlbumGroup | null;
  activeTrackId: string;
  onSelectAlbum: (key: string) => void;
  onBack: () => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
}) {
  if (!albums.length) return <EmptyState text="还没有本地专辑。选择文件夹或扫描光盘后，这里会按专辑自动整理。" />;
  if (selectedAlbum) {
    return (
      <AlbumDetailView
        album={selectedAlbum}
        activeTrackId={activeTrackId}
        onBack={onBack}
        onPickTrack={onPickTrack}
      />
    );
  }

  return (
    <div className="no-scrollbar mt-5 grid max-h-[calc(100vh-24rem)] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {albums.map((album) => (
        <button
          key={album.key}
          className="group grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 rounded-[1.25rem] bg-white/55 p-3 text-left shadow-sm transition hover:bg-white"
          onClick={() => onSelectAlbum(album.key)}
        >
          <CoverArt track={album.coverTrack} className="size-16 rounded-2xl" />
          <div className="min-w-0">
            <p className="truncate font-semibold group-hover:text-neutral-700">{album.title}</p>
            <p className="mt-1 truncate text-sm text-neutral-500">{album.artist}</p>
            <p className="mt-1 truncate text-xs text-neutral-400">
              {album.tracks.length} 首 · {album.totalDuration}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}

function AlbumDetailView({
  album,
  activeTrackId,
  onBack,
  onPickTrack,
}: {
  album: LocalAlbumGroup;
  activeTrackId: string;
  onBack: () => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
}) {
  const virtual = useVirtualRows({ count: album.tracks.length, rowHeight: 88, overscan: 10 });

  return (
    <div className="mt-5 grid h-[calc(100vh-24rem)] min-h-[420px] gap-4 xl:grid-cols-[minmax(360px,0.42fr)_minmax(0,1fr)]">
      <section className="relative min-h-0 overflow-hidden rounded-[1.5rem] bg-white/50 p-5 shadow-sm">
        <div className="absolute inset-0 bg-gradient-to-br from-white/80 via-white/20 to-neutral-200/35" />
        <div className="relative z-10 flex h-full min-h-0 flex-col">
          <Button className="w-fit" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft />
            返回专辑
          </Button>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center py-6 text-center">
            <CoverArt track={album.coverTrack} className="size-56 rounded-[2.2rem] shadow-lg 2xl:size-72" />
            <Badge className="mt-6">Album</Badge>
            <h2 className="mt-4 max-w-[25rem] break-words text-3xl font-semibold leading-tight 2xl:text-5xl">
              {album.title}
            </h2>
            <p className="mt-3 max-w-[24rem] truncate text-neutral-500">{album.artist}</p>
            <div className="mt-6 grid w-full max-w-sm grid-cols-2 gap-3 text-center">
              <LibraryInfoCard label="曲目" value={`${album.tracks.length} 首`} />
              <LibraryInfoCard label="时长" value={album.totalDuration} />
            </div>
          </div>
        </div>
      </section>

      <section className="min-h-0 overflow-hidden rounded-[1.5rem] bg-white/50 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-neutral-400">Tracks</p>
            <h3 className="mt-1 text-2xl font-semibold">歌曲</h3>
          </div>
          <Badge>{album.tracks.length}</Badge>
        </div>
        <div
          ref={virtual.containerRef}
          className="no-scrollbar mt-5 min-h-0 flex-1 overflow-y-auto pr-1"
          style={{ maxHeight: "calc(100vh - 28rem)" }}
        >
          <div className="relative" style={{ height: virtual.totalHeight }}>
            {virtual.rows.map(({ index, offsetTop }) => {
              const track = album.tracks[index];
              if (!track) return null;
              return (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={index}
                  active={activeTrackId === track.id}
                  queue={album.tracks}
                  onPickTrack={onPickTrack}
                  style={{ top: offsetTop }}
                />
              );
            })}
          </div>
        </div>
      </section>
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
  const virtual = useVirtualRows({ count: tracks.length, rowHeight: 88, overscan: 10 });

  if (!tracks.length) return <EmptyState text="还没有扫描到本地音乐。你可以选择文件夹，或直接输入路径扫描。" />;
  return (
    <div
      ref={virtual.containerRef}
      className="no-scrollbar mt-5 min-h-0 flex-1 overflow-y-auto pr-1"
      style={{ maxHeight: "calc(100vh - 24rem)" }}
    >
      <div className="relative" style={{ height: virtual.totalHeight }}>
        {virtual.rows.map(({ index, offsetTop }) => {
          const track = tracks[index];
          if (!track) return null;
          return (
            <TrackRow
              key={track.id}
              track={track}
              index={index}
              active={activeTrackId === track.id}
              queue={tracks}
              onPickTrack={onPickTrack}
              style={{ top: offsetTop }}
            />
          );
        })}
      </div>
    </div>
  );
}

function CdLibraryView({
  tracks,
  activeTrackId,
  scanState,
  readQuality,
  onReadQualityChange,
  onScanCd,
  onPickTrack,
}: {
  tracks: Track[];
  activeTrackId: string;
  scanState: "idle" | "scanning" | "error";
  readQuality: "high" | "low";
  onReadQualityChange: (quality: "high" | "low") => void;
  onScanCd: () => Promise<void>;
  onPickTrack: (id: string, queue?: Track[]) => void;
}) {
  const virtual = useVirtualRows({ count: tracks.length, rowHeight: 88, overscan: 10 });
  const albums = useMemo(() => createAlbumGroups(tracks), [tracks]);

  return (
    <section className="mt-5 rounded-[1.35rem] bg-white/50 p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-neutral-400">Audio CD</p>
          <h2 className="mt-1 text-2xl font-semibold">光盘音乐</h2>
          <p className="mt-2 text-sm text-neutral-500">扫描光盘只会更新 CD 曲目，不会清空已有本地音乐。</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">读取质量</span>
            <div className="flex items-center gap-1 rounded-full bg-white/60 p-1">
              {[
                { value: "high" as const, label: "高音质" },
                { value: "low" as const, label: "低音质" },
              ].map((option) => (
                <button
                  key={option.value}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium text-neutral-500 transition",
                    readQuality === option.value && "bg-neutral-950 text-white shadow-sm",
                  )}
                  onClick={() => onReadQualityChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <Button variant="glass" onClick={onScanCd} disabled={scanState === "scanning"}>
          <Disc3 className={cn(scanState === "scanning" && "animate-spin")} />
          {scanState === "scanning" ? "扫描光盘中" : "扫描光盘"}
        </Button>
      </div>

      {scanState === "error" && (
        <p className="mt-3 text-sm text-neutral-500">没有读取到音频光盘曲目，或当前光驱不支持枚举。</p>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(260px,0.44fr)_minmax(0,1fr)]">
        <div className="grid gap-3">
          {albums.map((album) => (
            <div key={album.key} className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3 rounded-[1.25rem] bg-white/55 p-3 shadow-sm">
              <CoverArt track={album.coverTrack} className="size-16 rounded-2xl" />
              <div className="min-w-0">
                <p className="truncate font-semibold">{album.title}</p>
                <p className="mt-1 truncate text-sm text-neutral-500">{album.artist}</p>
                <p className="mt-1 truncate text-xs text-neutral-400">{album.tracks.length} 首 CDDA</p>
              </div>
            </div>
          ))}
          {!albums.length && <EmptyState text="还没有光盘曲目。放入音频 CD 后点击扫描光盘。" />}
        </div>

        <div
          ref={virtual.containerRef}
          className="no-scrollbar min-h-0 overflow-y-auto pr-1"
          style={{ maxHeight: "calc(100vh - 28rem)" }}
        >
          <div className="relative" style={{ height: virtual.totalHeight }}>
            {virtual.rows.map(({ index, offsetTop }) => {
              const track = tracks[index];
              if (!track) return null;
              return (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={index}
                  active={activeTrackId === track.id}
                  queue={tracks}
                  onPickTrack={onPickTrack}
                  style={{ top: offsetTop }}
                />
              );
            })}
          </div>
          {!tracks.length && <EmptyState text="光盘曲目会单独显示在这里，不会和本地文件列表混在一起。" />}
        </div>
      </div>
    </section>
  );
}

function TrackRow({
  track,
  index,
  active,
  queue,
  onPickTrack,
  style,
}: {
  track: Track;
  index: number;
  active: boolean;
  queue: Track[];
  onPickTrack: (id: string, queue?: Track[]) => void;
  style?: CSSProperties;
}) {
  return (
    <button
      className={cn(
        "absolute left-0 right-0 grid h-20 grid-cols-[2.5rem_3.5rem_minmax(0,1fr)_auto] items-center gap-4 rounded-[1.3rem] bg-white/45 p-3 text-left transition hover:bg-white/75",
        active && "bg-white shadow-sm",
      )}
      style={style}
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
        mediaKind: (orderedTracks.some((track) => track.mediaKind === "audio-cd") ? "audio-cd" : "file") as Track["mediaKind"],
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


