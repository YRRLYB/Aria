import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  GripVertical,
  Layers,
  ListMusic,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Track } from "@/data/music";
import { api } from "@/lib/api";
import {
  resolveLocalPlaylistTracks,
  type LocalPlaylist,
  type LocalPlaylistSuperMix,
  type PlaylistInsertPosition,
  type SuperMixSourceRef,
  type SuperMixStrategy,
} from "@/lib/localPlaylists";
import { formatAudioDetail } from "@/lib/playerPresentation";
import { countTrackSources, mixSuperMixTracks, type SuperMixBucket } from "@/lib/superMix";
import { providerTrackToUiTrack } from "@/lib/trackMappers";
import { cn } from "@/lib/utils";
import { useVirtualRows } from "@/lib/virtualRows";
import { ArtworkImage } from "./ArtworkImage";
import { LocalTrackPickerDialog } from "./LocalPlaylistSurfaces";
import { PlaylistTrackBrowser, type PickerPlaylistCatalog } from "./PlaylistTrackBrowser";
import { CopyableTrackText, CoverArt, EmptyState } from "./shared";
import { SourceBadge, SourceLogo } from "./SourceLogos";

export const SUPER_MIX_ALL_LOCAL_ID = "__all_local__";

export type SuperMixSurfaceProps = {
  playlists: LocalPlaylist[];
  localPlaylists: LocalPlaylist[];
  allTracks: Track[];
  selectedPlaylist: LocalPlaylist | null;
  selectedTracks: Track[];
  storageError: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  onCreate: (name: string, tracks: Track[], superMix: LocalPlaylistSuperMix) => LocalPlaylist;
  onUpdateMix: (id: string, tracks: Track[], superMix: LocalPlaylistSuperMix, name?: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onAdd: (id: string, tracks: Track[], position?: PlaylistInsertPosition) => void;
  onRemove: (id: string, tracks: Track[]) => void;
  onReorder?: (id: string, orderedTracks: Track[]) => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
  pickerCatalog?: Omit<PickerPlaylistCatalog, "allTracks">;
  headerTabs?: ReactNode;
};

const SOURCE_COLOR: Record<Track["source"], { label: string; color: string }> = {
  netease: { label: "网易云", color: "#E60026" },
  qq: { label: "QQ 音乐", color: "#0DAF52" },
  bilibili: { label: "B站", color: "#00AEEC" },
  youtube: { label: "YouTube", color: "#FF0033" },
  local: { label: "本地", color: "#6E5AD6" },
  cloud: { label: "云盘", color: "#4F6EF7" },
};

const STRATEGY_LABEL: Record<SuperMixStrategy, string> = {
  interleave: "交错轮播",
  shuffle: "均衡随机",
  sequential: "顺序合并",
};

function SuperMixMosaicCover({
  tracks,
  className,
}: {
  tracks: Track[];
  className?: string;
}) {
  const tiles = useMemo(() => {
    const picked: Track[] = [];
    const seenSources = new Set<Track["source"]>();
    const seenIds = new Set<string>();
    for (const track of tracks) {
      if (picked.length >= 4) break;
      if (!track.coverUrl || seenIds.has(track.id) || seenSources.has(track.source)) continue;
      seenSources.add(track.source);
      seenIds.add(track.id);
      picked.push(track);
    }
    for (const track of tracks) {
      if (picked.length >= 4) break;
      if (seenIds.has(track.id)) continue;
      seenIds.add(track.id);
      picked.push(track);
    }
    return picked;
  }, [tracks]);

  if (!tiles.length) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#E60026]/85 via-[#0DAF52]/80 to-[#7C5CE6]/85 text-white shadow-sm",
          className,
        )}
      >
        <Layers className="size-6" />
      </span>
    );
  }

  if (tiles.length === 1) {
    return <CoverArt track={tiles[0]} className={cn("shrink-0 rounded-2xl", className)} />;
  }

  return (
    <div
      className={cn(
        "grid shrink-0 grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden rounded-2xl bg-neutral-200/70 p-0.5 shadow-sm ring-1 ring-black/5",
        className,
      )}
    >
      {Array.from({ length: 4 }, (_, index) => {
        const track = tiles[index % tiles.length];
        return <CoverArt key={`${track.id}-${index}`} track={track} className="size-full rounded-[6px]" />;
      })}
    </div>
  );
}

function SourceCompositionBar({
  sourceCounts,
  total,
}: {
  sourceCounts: Partial<Record<Track["source"], number>>;
  total: number;
}) {
  const entries = (Object.entries(sourceCounts) as Array<[Track["source"], number]>)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  if (!entries.length || total <= 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-black/[0.06]">
        {entries.map(([source, count]) => (
          <div
            key={source}
            title={`${SOURCE_COLOR[source].label} · ${count} 首`}
            style={{
              width: `${Math.max(4, (count / total) * 100)}%`,
              backgroundColor: SOURCE_COLOR[source].color,
            }}
            className="h-full transition-all"
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {entries.map(([source, count]) => (
          <span
            key={source}
            className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-medium text-neutral-600 ring-1 ring-black/5"
          >
            <SourceLogo source={source} className="size-3" />
            <span>{SOURCE_COLOR[source].label}</span>
            <span className="tabular-nums text-neutral-400">{count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

type CatalogMixCandidate = SuperMixSourceRef & {
  coverTrack?: Track;
};

function buildMixCandidates(
  catalog: Omit<PickerPlaylistCatalog, "allTracks"> | undefined,
  localPlaylists: LocalPlaylist[],
  allTracks: Track[],
  excludePlaylistId?: string,
): CatalogMixCandidate[] {
  const candidates: CatalogMixCandidate[] = [];
  const localOnlyTracks = allTracks.filter((track) => track.source === "local" || track.source === "cloud");
  if (localOnlyTracks.length > 0) {
    candidates.push({
      key: `local:${SUPER_MIX_ALL_LOCAL_ID}`,
      source: "local",
      playlistId: SUPER_MIX_ALL_LOCAL_ID,
      name: "全部本地 / 云盘音乐",
      trackCount: localOnlyTracks.length,
      coverTrack: localOnlyTracks[0],
    });
  }

  const standardLocal = (catalog?.localPlaylists ?? localPlaylists).filter(
    (pl) => pl.id !== excludePlaylistId && pl.kind !== "super-mix",
  );
  for (const pl of standardLocal) {
    const resolved = resolveLocalPlaylistTracks(pl, allTracks);
    candidates.push({
      key: `local:${pl.id}`,
      source: "local",
      playlistId: pl.id,
      name: pl.name,
      trackCount: pl.trackIds.length,
      coverTrack: resolved[0],
    });
  }

  for (const pl of catalog?.neteasePlaylists ?? []) {
    candidates.push({
      key: `netease:${pl.id}`,
      source: "netease",
      playlistId: pl.id,
      name: pl.name,
      trackCount: pl.trackCount,
      coverUrl: pl.coverUrl ?? null,
    });
  }
  for (const pl of catalog?.qqPlaylists ?? []) {
    candidates.push({
      key: `qq:${pl.id}`,
      source: "qq",
      playlistId: pl.id,
      name: pl.name,
      trackCount: pl.trackCount,
      coverUrl: pl.coverUrl ?? null,
    });
  }
  for (const pl of catalog?.bilibiliPlaylists ?? []) {
    candidates.push({
      key: `bilibili:${pl.id}`,
      source: "bilibili",
      playlistId: pl.id,
      name: pl.name,
      trackCount: pl.trackCount,
      coverUrl: pl.coverUrl ?? null,
    });
  }
  for (const pl of catalog?.youtubePlaylists ?? []) {
    candidates.push({
      key: `youtube:${pl.id}`,
      source: "youtube",
      playlistId: pl.id,
      name: pl.name,
      trackCount: pl.trackCount,
      coverUrl: pl.coverUrl ?? null,
    });
  }

  return candidates;
}

async function fetchSourcePlaylistTracksForMix(
  ref: SuperMixSourceRef,
  localPlaylists: LocalPlaylist[],
  allTracks: Track[],
): Promise<Track[]> {
  if (ref.source === "local") {
    if (ref.playlistId === SUPER_MIX_ALL_LOCAL_ID) {
      return allTracks.filter((track) => track.source === "local" || track.source === "cloud");
    }
    const found = localPlaylists.find((pl) => pl.id === ref.playlistId);
    return found ? resolveLocalPlaylistTracks(found, allTracks) : [];
  }
  if (ref.source === "netease") {
    const detail = await api.getNeteasePlaylistDetail(ref.playlistId);
    return detail.tracks.map(providerTrackToUiTrack);
  }
  const res = await api.getSourcePlaylistTracks(ref.source, ref.playlistId);
  return res.tracks.map(providerTrackToUiTrack);
}

async function resolveAndMixSources(options: {
  sources: SuperMixSourceRef[];
  strategy: SuperMixStrategy;
  dedupe: boolean;
  localPlaylists: LocalPlaylist[];
  allTracks: Track[];
  manualTracks?: Track[];
  existingPlaylist?: LocalPlaylist | null;
  onProgress?: (completed: number, total: number) => void;
}) {
  const {
    sources,
    strategy,
    dedupe,
    localPlaylists,
    allTracks,
    manualTracks: overrideManualTracks,
    existingPlaylist,
    onProgress,
  } = options;
  const fallbackManualIdSet = new Set(existingPlaylist?.superMix?.manualTrackIds ?? []);
  const effectiveManualTracks =
    overrideManualTracks !== undefined
      ? overrideManualTracks
      : fallbackManualIdSet.size
        ? resolveLocalPlaylistTracks(existingPlaylist, allTracks).filter((track) =>
            fallbackManualIdSet.has(track.id),
          )
        : [];

  if (!sources.length && !effectiveManualTracks.length) {
    throw new Error("请至少选择一个来源歌单或一首单曲");
  }

  let completed = 0;
  onProgress?.(0, sources.length);

  const settled = sources.length
    ? await Promise.allSettled(
        sources.map(async (ref) => {
          try {
            const tracks = await fetchSourcePlaylistTracksForMix(ref, localPlaylists, allTracks);
            return { ref, tracks } satisfies SuperMixBucket;
          } finally {
            completed += 1;
            onProgress?.(completed, sources.length);
          }
        }),
      )
    : [];

  const buckets: SuperMixBucket[] = [];
  const failedNames: string[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      buckets.push(result.value);
    } else {
      failedNames.push(sources[index]?.name ?? "未知歌单");
    }
  });

  if (sources.length > 0 && !buckets.length && !effectiveManualTracks.length) {
    throw new Error(`无法读取所选歌单（${failedNames.join("、")}），请确认登录状态或网络后重试`);
  }

  const mixed = mixSuperMixTracks(buckets, { strategy, dedupe, manualTracks: effectiveManualTracks });
  const preservedManualIds = effectiveManualTracks.map((track) => track.id);
  const now = Date.now();
  const nextSuperMix: LocalPlaylistSuperMix = {
    sources: buckets.map((bucket) => ({
      ...bucket.ref,
      trackCount: bucket.tracks.length,
    })),
    strategy,
    dedupe,
    ...(preservedManualIds.length ? { manualTrackIds: preservedManualIds } : {}),
    syncedAt: now,
    dedupedCount: mixed.dedupedCount,
    sourceCounts: mixed.sourceCounts,
  };

  return {
    tracks: mixed.tracks,
    superMix: nextSuperMix,
    failedNames,
  };
}

function SuperMixEditorDialog({
  initialName,
  initialSources,
  initialStrategy,
  initialDedupe,
  excludePlaylistId,
  existingPlaylist,
  localPlaylists,
  pickerCatalog,
  allTracks,
  submitLabel,
  onClose,
  onConfirm,
}: {
  initialName: string;
  initialSources: SuperMixSourceRef[];
  initialStrategy: SuperMixStrategy;
  initialDedupe: boolean;
  excludePlaylistId?: string;
  existingPlaylist?: LocalPlaylist | null;
  localPlaylists: LocalPlaylist[];
  pickerCatalog?: Omit<PickerPlaylistCatalog, "allTracks">;
  allTracks: Track[];
  submitLabel: string;
  onClose: () => void;
  onConfirm: (result: { name: string; tracks: Track[]; superMix: LocalPlaylistSuperMix; warning: string | null }) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(initialName);
  const [editorTab, setEditorTab] = useState<"playlists" | "tracks">("playlists");
  const [selectedRefs, setSelectedRefs] = useState<SuperMixSourceRef[]>(initialSources);
  const [pickedTracks, setPickedTracks] = useState<Track[]>(() => {
    const manualIds = existingPlaylist?.superMix?.manualTrackIds;
    if (!existingPlaylist || !manualIds?.length) return [];
    const manualSet = new Set(manualIds);
    return resolveLocalPlaylistTracks(existingPlaylist, allTracks).filter((track) =>
      manualSet.has(track.id),
    );
  });
  const [browsePlaylistRequest, setBrowsePlaylistRequest] = useState<{
    key: string;
    nonce: number;
  } | null>(null);
  const emptyExistingIds = useMemo(() => new Set<string>(), []);
  const [strategy, setStrategy] = useState<SuperMixStrategy>(initialStrategy);
  const [dedupe, setDedupe] = useState(initialDedupe);
  const [sourceFilter, setSourceFilter] = useState<"all" | SuperMixSourceRef["source"]>("all");
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const candidates = useMemo(
    () => buildMixCandidates(pickerCatalog, localPlaylists, allTracks, excludePlaylistId),
    [pickerCatalog, localPlaylists, allTracks, excludePlaylistId],
  );

  const selectedMap = useMemo(() => {
    const map = new Map<string, number>();
    selectedRefs.forEach((ref, index) => map.set(ref.key, index + 1));
    return map;
  }, [selectedRefs]);

  const filteredCandidates = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return candidates.filter((item) => {
      if (sourceFilter !== "all" && item.source !== sourceFilter) return false;
      if (!keyword) return true;
      return `${item.name} ${SOURCE_COLOR[item.source].label}`.toLowerCase().includes(keyword);
    });
  }, [candidates, search, sourceFilter]);

  function toggleCandidate(item: CatalogMixCandidate) {
    if (submitting) return;
    if (selectedMap.has(item.key)) {
      setSelectedRefs((current) => current.filter((ref) => ref.key !== item.key));
    } else {
      const { coverTrack: _coverTrack, ...ref } = item;
      setSelectedRefs((current) => [...current, ref]);
    }
  }

  const canSubmit = (selectedRefs.length > 0 || pickedTracks.length > 0) && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setProgress({ done: 0, total: selectedRefs.length });
    try {
      const resolved = await resolveAndMixSources({
        sources: selectedRefs,
        strategy,
        dedupe,
        localPlaylists,
        allTracks,
        manualTracks: pickedTracks,
        existingPlaylist,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      const warning = resolved.failedNames.length
        ? `部分歌单未能读取：${resolved.failedNames.join("、")}（其余已成功混合）`
        : null;
      onConfirm({
        name: name.trim() || "Super混合",
        tracks: resolved.tracks,
        superMix: resolved.superMix,
        warning,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "混合歌单失败，请稍后重试");
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="super-mix-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting) onClose();
      }}
      className="fixed inset-0 m-auto flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-black/30 p-4 backdrop-blur-sm backdrop:bg-transparent"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section className="flex h-[84vh] max-h-[820px] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/75 bg-[#faf9fd] p-5 shadow-2xl sm:p-6">
        <div className="flex shrink-0 items-start justify-between gap-3">
          <div>
            <h2 id="super-mix-editor-title" className="flex items-center gap-2 text-xl font-semibold">
              <Sparkles className="size-5 text-violet-600" />
              创建 / 配置 Super混合歌单
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              从网易云、QQ 音乐、B站、YouTube 与本地歌单中多选整张歌单，或翻进歌单挑选单曲混播。
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="关闭 Super混合配置" disabled={submitting} onClick={onClose}>
            <X />
          </Button>
        </div>

        <div className="mt-4 grid shrink-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="歌单名称，例如：Super混合 · 全平台收藏"
            aria-label="Super混合歌单名称"
            className="rounded-xl border border-neutral-200 bg-white px-3.5 py-2 text-sm outline-none focus:border-violet-400"
          />
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-neutral-200/80 bg-white p-1 text-xs">
            {(["interleave", "shuffle", "sequential"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setStrategy(item)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 font-medium transition",
                  strategy === item ? "bg-neutral-950 text-white" : "text-neutral-600 hover:bg-neutral-100",
                )}
              >
                {STRATEGY_LABEL[item]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2">
          <div role="tablist" aria-label="混合选择方式" className="inline-flex rounded-full bg-neutral-200/70 p-1 text-xs font-medium">
            <button
              type="button"
              role="tab"
              aria-selected={editorTab === "playlists"}
              onClick={() => setEditorTab("playlists")}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 transition",
                editorTab === "playlists" ? "bg-white text-neutral-950 shadow-sm" : "text-neutral-600 hover:text-neutral-950",
              )}
            >
              <Layers className="size-3.5" />
              选择整张歌单
              {selectedRefs.length > 0 && (
                <span className="rounded-full bg-violet-100 px-1.5 py-0.2 text-[10px] text-violet-700">
                  {selectedRefs.length}
                </span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={editorTab === "tracks"}
              onClick={() => setEditorTab("tracks")}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3.5 py-1.5 transition",
                editorTab === "tracks" ? "bg-white text-neutral-950 shadow-sm" : "text-neutral-600 hover:text-neutral-950",
              )}
            >
              <ListMusic className="size-3.5" />
              翻歌单挑单曲
              {pickedTracks.length > 0 && (
                <span className="rounded-full bg-violet-100 px-1.5 py-0.2 text-[10px] text-violet-700">
                  {pickedTracks.length}
                </span>
              )}
            </button>
          </div>

          <label className="flex cursor-pointer items-center gap-2 rounded-full bg-white px-3 py-1 text-xs text-neutral-600 ring-1 ring-black/8">
            <input
              type="checkbox"
              checked={dedupe}
              onChange={(event) => setDedupe(event.target.checked)}
              className="accent-violet-600"
            />
            <span>跨源自动去重（优选高音质）</span>
          </label>
        </div>

        {editorTab === "playlists" ? (
          <>
            <div className="mt-3 flex shrink-0 flex-wrap items-center gap-1.5">
              {(
                [
                  { id: "all", label: "全部来源" },
                  { id: "netease", label: "网易云" },
                  { id: "qq", label: "QQ 音乐" },
                  { id: "bilibili", label: "B站" },
                  { id: "youtube", label: "YouTube" },
                  { id: "local", label: "本地" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSourceFilter(tab.id)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition",
                    sourceFilter === tab.id
                      ? "bg-neutral-950 text-white"
                      : "bg-white text-neutral-600 ring-1 ring-black/8 hover:bg-neutral-50",
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative mt-3 shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="筛选各平台歌单名称…"
                className="w-full rounded-xl border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-violet-400"
              />
            </div>

            <div className="no-scrollbar mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
              {filteredCandidates.length ? (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {filteredCandidates.map((item) => {
                    const order = selectedMap.get(item.key);
                    const selected = order !== undefined;
                    const canBrowseTracks = item.playlistId !== SUPER_MIX_ALL_LOCAL_ID;
                    return (
                      <div
                        key={item.key}
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleCandidate(item)}
                        onKeyDown={(event) => {
                          if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                            event.preventDefault();
                            toggleCandidate(item);
                          }
                        }}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-2xl border p-3 text-left transition",
                          selected
                            ? "border-violet-500 bg-violet-50/70 shadow-sm"
                            : "border-neutral-200/80 bg-white hover:border-neutral-300",
                        )}
                      >
                        {item.coverUrl ? (
                          <ArtworkImage
                            src={item.coverUrl}
                            cacheSize={120}
                            alt=""
                            className="size-12 shrink-0 rounded-xl object-cover"
                          />
                        ) : item.coverTrack ? (
                          <CoverArt track={item.coverTrack} className="size-12 shrink-0 rounded-xl" />
                        ) : (
                          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500">
                            <ListMusic className="size-5" />
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-neutral-900" title={item.name}>
                            {item.name}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
                            <SourceBadge source={item.source} compact />
                            {item.trackCount != null && <span>{item.trackCount} 首</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {canBrowseTracks && (
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                setBrowsePlaylistRequest({ key: item.key, nonce: Date.now() });
                                setEditorTab("tracks");
                              }}
                              className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-[11px] font-medium text-neutral-600 transition hover:border-violet-300 hover:text-violet-700"
                              title="翻进该歌单挑选单曲"
                            >
                              挑单曲
                            </button>
                          )}
                          <span
                            className={cn(
                              "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                              selected
                                ? "bg-violet-600 text-white"
                                : "border border-neutral-300 bg-neutral-50 text-transparent",
                            )}
                          >
                            {selected ? order : <Check className="size-3.5" />}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState text="暂无可选歌单，请先扫描本地曲库或登录网易云 / QQ / B站 / YouTube 账号。" />
              )}
            </div>
          </>
        ) : (
          <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden">
            <PlaylistTrackBrowser
              mode="all"
              excludePlaylistId={excludePlaylistId}
              existingIds={emptyExistingIds}
              catalog={{ ...pickerCatalog, allTracks }}
              selected={pickedTracks}
              onSelectedChange={setPickedTracks}
              initialOpenPlaylistKey={browsePlaylistRequest?.key}
              initialOpenPlaylistNonce={browsePlaylistRequest?.nonce}
              disabled={submitting}
            />
          </div>
        )}

        {error && <p role="alert" className="mt-3 shrink-0 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}

        <div className="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-neutral-200/80 pt-3">
          <p className="text-xs text-neutral-500">
            {progress && progress.total > 0
              ? `正在混合拉取 ${progress.done} / ${progress.total} 个歌单…`
              : `已选 ${selectedRefs.length} 个来源歌单 · ${pickedTracks.length} 首单曲`}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={submitting} onClick={onClose}>
              取消
            </Button>
            <Button size="sm" disabled={!canSubmit} onClick={() => void handleSubmit()}>
              {submitting ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              {submitting
                ? "正在混合…"
                : `${submitLabel} (${selectedRefs.length ? `${selectedRefs.length}单` : ""}${selectedRefs.length && pickedTracks.length ? "+" : ""}${pickedTracks.length ? `${pickedTracks.length}曲` : selectedRefs.length ? "" : "0"})`}
            </Button>
          </div>
        </div>
      </section>
    </dialog>
  );
}

export function SuperMixSurface(props: SuperMixSurfaceProps) {
  const [editorOpen, setEditorOpen] = useState(false);

  if (props.selectedPlaylist) {
    return (
      <SuperMixDetail
        {...props}
        playlist={props.selectedPlaylist}
      />
    );
  }

  return (
    <div className="aria-page-shell no-scrollbar h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-7">
      <div className="aria-page-header flex flex-wrap items-center justify-between gap-4 pb-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            Super混合
            <Badge className="bg-violet-100 text-violet-700">全音源混播</Badge>
          </h1>
          <p className="mt-1 text-xs text-neutral-500">
            把网易云、QQ 音乐、B站、YouTube 与本地歌单自由混合成一张歌单，支持跨源高音质去重与一键同步。
          </p>
        </div>
        <Button size="sm" onClick={() => setEditorOpen(true)}>
          <Plus />
          新建 Super混合
        </Button>
      </div>
      {props.headerTabs}
      {props.storageError && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">
          浏览器存储空间不足，本次修改可能无法在重启后保留。
        </p>
      )}

      <div className="mt-5 grid gap-3.5 md:grid-cols-3">
        {props.playlists.map((playlist) => {
          const resolved = resolveLocalPlaylistTracks(playlist, props.allTracks);
          const sourceCounts = playlist.superMix?.sourceCounts ?? countTrackSources(resolved);
          return (
            <div key={playlist.id} className="group relative">
              <button
                type="button"
                className="aria-flat-tile flex h-full w-full flex-col rounded-2xl p-4 text-left"
                onClick={() => props.onOpen(playlist.id)}
              >
                <SuperMixMosaicCover tracks={resolved} className="size-16" />
                <h2 className="mt-4 line-clamp-2 break-words pr-8 text-lg font-semibold leading-snug">
                  {playlist.name}
                </h2>
                <p className="mt-1 text-xs text-neutral-500">
                  {playlist.trackIds.length} 首 · 混合 {playlist.superMix?.sources.length ?? 0} 个歌单 ·{" "}
                  {STRATEGY_LABEL[playlist.superMix?.strategy ?? "interleave"]}
                </p>
                <div className="mt-3">
                  <SourceCompositionBar sourceCounts={sourceCounts} total={resolved.length || playlist.trackIds.length} />
                </div>
              </button>
              <button
                type="button"
                aria-label={`删除 Super混合 ${playlist.name}`}
                title="删除 Super混合歌单（不会影响原平台歌单）"
                className="absolute right-4 top-4 z-10 flex size-9 items-center justify-center rounded-full bg-white/90 text-neutral-400 opacity-0 shadow-sm ring-1 ring-black/5 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  if (window.confirm(`删除 Super混合“${playlist.name}”？原平台歌单与本地音频不会被删除。`)) {
                    props.onDelete(playlist.id);
                  }
                }}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          );
        })}
      </div>

      {!props.playlists.length && (
        <div className="mt-8 flex flex-col items-center justify-center rounded-3xl border border-dashed border-neutral-300/80 bg-white/55 px-6 py-12 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#E60026]/85 via-[#0DAF52]/80 to-[#7C5CE6]/85 text-white shadow-sm">
            <Layers className="size-6" />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-neutral-900">还没有 Super混合歌单</h2>
          <p className="mt-1.5 max-w-md text-xs leading-5 text-neutral-500">
            将网易云「我喜欢的音乐」、QQ 音乐歌单、B站音乐收藏夹、YouTube 歌单或本地目录一次混成一张超级歌单。
          </p>
          <Button className="mt-5" size="sm" onClick={() => setEditorOpen(true)}>
            <Sparkles />
            创建你的第一个 Super混合
          </Button>
        </div>
      )}

      {editorOpen && (
        <SuperMixEditorDialog
          initialName={props.playlists.length ? `Super混合 ${props.playlists.length + 1}` : "Super混合"}
          initialSources={[]}
          initialStrategy="interleave"
          initialDedupe
          localPlaylists={props.localPlaylists}
          pickerCatalog={props.pickerCatalog}
          allTracks={props.allTracks}
          submitLabel="生成 Super混合"
          onClose={() => setEditorOpen(false)}
          onConfirm={({ name, tracks, superMix }) => {
            const created = props.onCreate(name, tracks, superMix);
            setEditorOpen(false);
            props.onOpen(created.id);
          }}
        />
      )}
    </div>
  );
}

function SuperMixDetail({
  playlist,
  localPlaylists,
  allTracks,
  selectedTracks,
  onClose,
  onRename,
  onDelete,
  onAdd,
  onRemove,
  onReorder,
  onUpdateMix,
  onPickTrack,
  pickerCatalog,
}: SuperMixSurfaceProps & { playlist: LocalPlaylist }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(playlist.name);
  const [sourceFilter, setSourceFilter] = useState<"all" | Track["source"]>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draggedId = useRef<string | null>(null);

  const sourceCounts = useMemo(() => countTrackSources(selectedTracks), [selectedTracks]);
  const filteredTracks = useMemo(
    () => (sourceFilter === "all" ? selectedTracks : selectedTracks.filter((track) => track.source === sourceFilter)),
    [selectedTracks, sourceFilter],
  );
  const selectedIds = useMemo(() => new Set(playlist.trackIds), [playlist.trackIds]);
  const virtual = useVirtualRows({ count: filteredTracks.length, rowHeight: 80, overscan: 8 });
  const strategy = playlist.superMix?.strategy ?? "interleave";

  useEffect(() => {
    setName(playlist.name);
    setSourceFilter("all");
    setNotice(null);
    setError(null);
  }, [playlist.id]);

  function saveName() {
    if (name.trim()) onRename(playlist.id, name);
    else setName(playlist.name);
    setRenaming(false);
  }

  function moveTrack(trackId: string, destination: number) {
    if (!onReorder || sourceFilter !== "all") return;
    const from = selectedTracks.findIndex((track) => track.id === trackId);
    if (from < 0 || destination < 0 || destination >= selectedTracks.length || from === destination) return;
    const next = [...selectedTracks];
    const [moving] = next.splice(from, 1);
    next.splice(destination, 0, moving);
    onReorder(playlist.id, next);
  }

  async function syncAllSources() {
    if (syncing || !playlist.superMix?.sources.length) return;
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const resolved = await resolveAndMixSources({
        sources: playlist.superMix.sources,
        strategy,
        dedupe: playlist.superMix.dedupe,
        localPlaylists,
        allTracks,
        existingPlaylist: playlist,
      });
      onUpdateMix(playlist.id, resolved.tracks, resolved.superMix);
      setNotice(
        resolved.failedNames.length
          ? `已同步部分来源（未读取：${resolved.failedNames.join("、")}）`
          : `已同步全部 ${resolved.superMix.sources.length} 个来源，共 ${resolved.tracks.length} 首`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "同步 Super混合失败，请重试");
    } finally {
      setSyncing(false);
    }
  }

  function switchStrategy(nextStrategy: SuperMixStrategy) {
    if (!playlist.superMix) return;
    const bucketsBySource = new Map<Track["source"], Track[]>();
    for (const track of selectedTracks) {
      const group = bucketsBySource.get(track.source) ?? [];
      group.push(track);
      bucketsBySource.set(track.source, group);
    }
    const buckets: SuperMixBucket[] = [...bucketsBySource.entries()].map(([source, list]) => ({
      ref: { key: `group:${source}`, source: source === "cloud" ? "local" : source, playlistId: source, name: source },
      tracks: list,
    }));
    const remixed = mixSuperMixTracks(buckets, {
      strategy: nextStrategy,
      dedupe: false,
    });
    onUpdateMix(playlist.id, remixed.tracks, {
      ...playlist.superMix,
      strategy: nextStrategy,
      sourceCounts: remixed.sourceCounts,
    });
  }

  return (
    <div className="aria-page-shell flex h-full min-h-[620px] flex-col overflow-hidden rounded-[1.5rem] p-5 sm:p-7">
      <div className="aria-page-header flex shrink-0 flex-col gap-4 pb-4">
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            <ArrowLeft />
            返回 Super混合
          </Button>
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-neutral-200/80 bg-white/80 p-1 text-xs">
            {(["interleave", "shuffle", "sequential"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => switchStrategy(item)}
                className={cn(
                  "rounded-lg px-2.5 py-1 font-medium transition",
                  strategy === item ? "bg-neutral-950 text-white" : "text-neutral-600 hover:bg-neutral-100",
                )}
              >
                {STRATEGY_LABEL[item]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <SuperMixMosaicCover tracks={selectedTracks} className="size-20" />
            <div className="min-w-0">
              {renaming ? (
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveName();
                  }}
                >
                  <input
                    autoFocus
                    maxLength={80}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    aria-label="重命名 Super混合歌单"
                    className="aria-flat-input min-w-0 rounded-xl px-3 py-1.5 text-xl font-semibold outline-none"
                  />
                  <Button type="submit" size="sm">保存</Button>
                </form>
              ) : (
                <button
                  type="button"
                  className="flex max-w-full items-center gap-2 text-left"
                  title="重命名歌单"
                  onClick={() => {
                    setName(playlist.name);
                    setRenaming(true);
                  }}
                >
                  <h1 className="break-words text-2xl font-semibold sm:text-3xl">{playlist.name}</h1>
                  <Pencil className="size-4 shrink-0 text-neutral-400" />
                </button>
              )}
              <p className="mt-1.5 text-xs text-neutral-500">
                Super混合 · {selectedTracks.length} 首可播放 · {playlist.superMix?.sources.length ?? 0} 个来源歌单
                {playlist.superMix?.manualTrackIds?.length ? ` · ${playlist.superMix.manualTrackIds.length} 首自选单曲` : ""}
                {playlist.superMix?.dedupedCount ? ` · 已跨源去重 ${playlist.superMix.dedupedCount} 首` : ""}
                {playlist.superMix?.syncedAt
                  ? ` · 上次同步 ${new Date(playlist.superMix.syncedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                  : ""}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            {selectedTracks.length > 0 && (
              <>
                <Button size="sm" onClick={() => onPickTrack(filteredTracks[0]?.id ?? selectedTracks[0].id, filteredTracks.length ? filteredTracks : selectedTracks)}>
                  <Play />
                  播放全部
                </Button>
                <Button
                  variant="glass"
                  size="sm"
                  onClick={() => {
                    const pool = filteredTracks.length ? filteredTracks : selectedTracks;
                    const randomTrack = pool[Math.floor(Math.random() * pool.length)];
                    if (randomTrack) onPickTrack(randomTrack.id, pool);
                  }}
                >
                  <Shuffle />
                  随机来一首
                </Button>
              </>
            )}
            {Boolean(playlist.superMix?.sources.length) && (
              <Button variant="glass" size="sm" disabled={syncing} onClick={() => void syncAllSources()}>
                {syncing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                {syncing ? "同步中" : "同步全部音源"}
              </Button>
            )}
            <Button variant="glass" size="sm" onClick={() => setEditorOpen(true)}>
              <SlidersHorizontal />
              编辑来源
            </Button>
            <Button variant="glass" size="sm" onClick={() => setPickerOpen(true)}>
              <Plus />
              翻歌单加单曲
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="删除 Super混合"
              onClick={() => {
                if (window.confirm(`删除 Super混合“${playlist.name}”？原平台歌单与本地音频不会被删除。`)) {
                  onDelete(playlist.id);
                }
              }}
            >
              <Trash2 />
              删除
            </Button>
          </div>
        </div>

        <div className="space-y-2.5">
          {playlist.superMix?.sources.length ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
              <span className="font-medium text-neutral-400">来源构成：</span>
              {playlist.superMix.sources.map((src) => (
                <span
                  key={src.key}
                  className="inline-flex items-center gap-1 rounded-lg bg-white/75 px-2 py-0.5 ring-1 ring-black/5"
                >
                  <SourceLogo source={src.source} className="size-3" />
                  <span className="max-w-[11rem] truncate">{src.name}</span>
                </span>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSourceFilter("all")}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition",
                sourceFilter === "all"
                  ? "bg-neutral-950 text-white"
                  : "bg-white/80 text-neutral-600 ring-1 ring-black/5 hover:bg-white",
              )}
            >
              全部 ({selectedTracks.length})
            </button>
            {(Object.entries(sourceCounts) as Array<[Track["source"], number]>)
              .filter(([, count]) => count > 0)
              .map(([source, count]) => (
                <button
                  key={source}
                  type="button"
                  onClick={() => setSourceFilter(source)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition",
                    sourceFilter === source
                      ? "bg-neutral-950 text-white"
                      : "bg-white/80 text-neutral-600 ring-1 ring-black/5 hover:bg-white",
                  )}
                >
                  <SourceLogo source={source} className="size-3.5" />
                  <span>{SOURCE_COLOR[source].label}</span>
                  <span className="tabular-nums opacity-75">{count}</span>
                </button>
              ))}
          </div>
        </div>

        {notice && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</p>}
        {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}
      </div>

      <div ref={virtual.containerRef} className="no-scrollbar mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="relative" style={{ height: virtual.totalHeight }}>
          {virtual.rows.map(({ index, offsetTop }) => {
            const track = filteredTracks[index];
            if (!track) return null;
            return (
              <div
                key={track.id}
                role="button"
                tabIndex={0}
                draggable={Boolean(onReorder && sourceFilter === "all")}
                onDragStart={(event) => {
                  draggedId.current = track.id;
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", track.id);
                }}
                onDragEnd={() => {
                  draggedId.current = null;
                }}
                onDragOver={(event) => {
                  if (onReorder && sourceFilter === "all" && draggedId.current) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedId.current) moveTrack(draggedId.current, index);
                  draggedId.current = null;
                }}
                onKeyDown={(event) => {
                  if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    onPickTrack(track.id, filteredTracks);
                  }
                }}
                className="aria-flat-row absolute inset-x-0 grid h-[4.5rem] grid-cols-[2rem_3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2.5 text-left"
                style={{ top: offsetTop }}
                onClick={() => onPickTrack(track.id, filteredTracks)}
              >
                {onReorder && sourceFilter === "all" ? (
                  <span className="flex items-center justify-center text-neutral-400" title="拖动调整顺序">
                    <GripVertical className="size-4 cursor-grab" />
                  </span>
                ) : (
                  <span className="text-center text-sm text-neutral-400">{index + 1}</span>
                )}
                <CoverArt track={track} className="size-12 rounded-xl" />
                <div className="min-w-0">
                  <p className="truncate font-semibold" title={track.title}>
                    <CopyableTrackText track={track} field="title">{track.title}</CopyableTrackText>
                  </p>
                  <p className="truncate text-sm text-neutral-500" title={`${track.artist} · ${track.album}`}>
                    {track.artist} · {track.album}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <SourceBadge source={track.source} compact />
                  <Badge className="hidden shrink-0 whitespace-nowrap md:inline-flex">{formatAudioDetail(track)}</Badge>
                  <span className="hidden shrink-0 text-sm tabular-nums text-neutral-500 sm:inline">{track.duration}</span>
                  {onReorder && sourceFilter === "all" && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="上移"
                        aria-label={`上移 ${track.title}`}
                        disabled={index === 0}
                        onClick={(event) => {
                          event.stopPropagation();
                          moveTrack(track.id, index - 1);
                        }}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="下移"
                        aria-label={`下移 ${track.title}`}
                        disabled={index === filteredTracks.length - 1}
                        onClick={(event) => {
                          event.stopPropagation();
                          moveTrack(track.id, index + 1);
                        }}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`从歌单移除 ${track.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(playlist.id, [track]);
                    }}
                  >
                    <X />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        {!filteredTracks.length && (
          <EmptyState text="该筛选条件下暂无歌曲。点击“编辑来源”或“手动加歌”来丰富这张 Super混合歌单。" />
        )}
      </div>

      {editorOpen && (
        <SuperMixEditorDialog
          initialName={playlist.name}
          initialSources={playlist.superMix?.sources ?? []}
          initialStrategy={playlist.superMix?.strategy ?? "interleave"}
          initialDedupe={playlist.superMix?.dedupe ?? true}
          excludePlaylistId={playlist.id}
          existingPlaylist={playlist}
          localPlaylists={localPlaylists}
          pickerCatalog={pickerCatalog}
          allTracks={allTracks}
          submitLabel="重新混合并保存"
          onClose={() => setEditorOpen(false)}
          onConfirm={({ name: nextName, tracks, superMix, warning }) => {
            onUpdateMix(playlist.id, tracks, superMix, nextName);
            setEditorOpen(false);
            if (warning) setNotice(warning);
          }}
        />
      )}

      {pickerOpen && (
        <LocalTrackPickerDialog
          tracks={allTracks}
          existingIds={selectedIds}
          currentPlaylistId={playlist.id}
          localPlaylists={localPlaylists}
          pickerCatalog={pickerCatalog}
          onClose={() => setPickerOpen(false)}
          onAdd={(pickedTracks, position) => {
            onAdd(playlist.id, pickedTracks, position);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
