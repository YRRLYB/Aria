import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Library,
  ListMusic,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import type { Track } from "@/data/music";
import { api, type ProviderPlaylist } from "@/lib/api";
import {
  resolveLocalPlaylistTracks,
  type LocalPlaylist,
  type PlaylistInsertPosition,
} from "@/lib/localPlaylists";
import { createLocalTrackSearchIndex, searchLocalTrackIndex } from "@/lib/localSearch";
import { providerTrackToUiTrack } from "@/lib/trackMappers";
import { useVirtualRows } from "@/lib/virtualRows";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ArtworkImage } from "./ArtworkImage";
import { CoverArt, EmptyState } from "./shared";
import { SourceBadge } from "./SourceLogos";

export type PickerPlaylistCatalog = {
  neteasePlaylists?: ProviderPlaylist[];
  localPlaylists?: LocalPlaylist[];
  qqPlaylists?: ProviderPlaylist[];
  bilibiliPlaylists?: ProviderPlaylist[];
  youtubePlaylists?: ProviderPlaylist[];
  allTracks: Track[];
};

type BrowserTab = "playlists" | "library" | "search";

type UnifiedSourcePlaylist = {
  key: string;
  id: string;
  name: string;
  source: "local" | "netease" | "qq" | "bilibili" | "youtube";
  trackCount: number;
  coverUrl?: string | null;
  coverTrack?: Track;
  coverColor?: string;
  localPlaylist?: LocalPlaylist;
};

function mergeDedupeTracks(groups: Track[][]): Track[] {
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const group of groups) {
    for (const track of group) {
      if (!track?.id || seen.has(track.id)) continue;
      seen.add(track.id);
      out.push(track);
    }
  }
  return out;
}

export function PlaylistTrackBrowser({
  mode,
  excludePlaylistId,
  existingIds,
  catalog,
  selected,
  onSelectedChange,
  insertPosition,
  onInsertPositionChange,
  initialOpenPlaylistKey,
  initialOpenPlaylistNonce,
  disabled = false,
}: {
  mode: "netease" | "all";
  excludePlaylistId?: string;
  existingIds: Set<string>;
  catalog: PickerPlaylistCatalog;
  selected: Track[];
  onSelectedChange: (next: Track[]) => void;
  insertPosition?: PlaylistInsertPosition;
  onInsertPositionChange?: (position: PlaylistInsertPosition) => void;
  initialOpenPlaylistKey?: string | null;
  initialOpenPlaylistNonce?: number;
  disabled?: boolean;
}) {
  const sourcePlaylists = useMemo<UnifiedSourcePlaylist[]>(() => {
    const items: UnifiedSourcePlaylist[] = [];
    for (const pl of catalog.localPlaylists ?? []) {
      if (pl.id === excludePlaylistId) continue;
      const resolved = resolveLocalPlaylistTracks(pl, catalog.allTracks);
      const neteaseTracks = resolved.filter((track) => track.source === "netease");
      if (mode === "netease" && !neteaseTracks.length) continue;
      const shown = mode === "netease" ? neteaseTracks : resolved;
      items.push({
        key: `local:${pl.id}`,
        id: pl.id,
        name: pl.name,
        source: "local",
        trackCount: mode === "netease" ? neteaseTracks.length : pl.trackIds.length,
        coverTrack: shown[0],
        coverColor: "#7c5ce6",
        localPlaylist: pl,
      });
    }
    for (const pl of catalog.neteasePlaylists ?? []) {
      if (pl.id === excludePlaylistId) continue;
      items.push({
        key: `netease:${pl.id}`,
        id: pl.id,
        name: pl.name,
        source: "netease",
        trackCount: pl.trackCount,
        coverUrl: pl.coverUrl,
        coverColor: pl.coverColor,
      });
    }
    if (mode === "all") {
      for (const pl of catalog.qqPlaylists ?? []) {
        if (pl.id === excludePlaylistId) continue;
        items.push({
          key: `qq:${pl.id}`,
          id: pl.id,
          name: pl.name,
          source: "qq",
          trackCount: pl.trackCount,
          coverUrl: pl.coverUrl,
          coverColor: pl.coverColor,
        });
      }
      for (const pl of catalog.bilibiliPlaylists ?? []) {
        if (pl.id === excludePlaylistId) continue;
        items.push({
          key: `bilibili:${pl.id}`,
          id: pl.id,
          name: pl.name,
          source: "bilibili",
          trackCount: pl.trackCount,
          coverUrl: pl.coverUrl,
          coverColor: pl.coverColor,
        });
      }
      for (const pl of catalog.youtubePlaylists ?? []) {
        if (pl.id === excludePlaylistId) continue;
        items.push({
          key: `youtube:${pl.id}`,
          id: pl.id,
          name: pl.name,
          source: "youtube",
          trackCount: pl.trackCount,
          coverUrl: pl.coverUrl,
          coverColor: pl.coverColor,
        });
      }
    }
    return items;
  }, [
    catalog.allTracks,
    catalog.bilibiliPlaylists,
    catalog.localPlaylists,
    catalog.neteasePlaylists,
    catalog.qqPlaylists,
    catalog.youtubePlaylists,
    excludePlaylistId,
    mode,
  ]);

  const hasLibraryForMode = useMemo(
    () => (mode === "netease" ? catalog.allTracks.some((track) => track.source === "netease") : catalog.allTracks.length > 0),
    [catalog.allTracks, mode],
  );
  const [tab, setTab] = useState<BrowserTab>(() =>
    sourcePlaylists.length ? "playlists" : hasLibraryForMode ? "library" : "search",
  );
  const [openedPlaylist, setOpenedPlaylist] = useState<UnifiedSourcePlaylist | null>(null);
  const [openedPlaylistTracks, setOpenedPlaylistTracks] = useState<Track[]>([]);
  const [openedPlaylistLoading, setOpenedPlaylistLoading] = useState(false);
  const [openedPlaylistError, setOpenedPlaylistError] = useState<string | null>(null);
  const [playlistFilter, setPlaylistFilter] = useState("");
  const playlistCacheRef = useRef(new Map<string, Track[]>());
  const appliedOpenRequestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialOpenPlaylistKey) return;
    const requestToken = `${initialOpenPlaylistNonce ?? 0}:${initialOpenPlaylistKey}`;
    if (appliedOpenRequestRef.current === requestToken) return;
    const matched = sourcePlaylists.find((item) => item.key === initialOpenPlaylistKey);
    if (!matched) return;
    appliedOpenRequestRef.current = requestToken;
    setTab("playlists");
    setOpenedPlaylist(matched);
    setPlaylistFilter("");
  }, [initialOpenPlaylistKey, initialOpenPlaylistNonce, sourcePlaylists]);

  const [libraryQuery, setLibraryQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | Track["source"]>("all");

  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const selectedIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    selected.forEach((track, index) => map.set(track.id, index + 1));
    return map;
  }, [selected]);

  const libraryPool = useMemo(() => {
    const base = mode === "netease" ? catalog.allTracks.filter((track) => track.source === "netease") : catalog.allTracks;
    if (mode === "all" && sourceFilter !== "all") {
      return base.filter((track) => track.source === sourceFilter);
    }
    return base;
  }, [catalog.allTracks, mode, sourceFilter]);

  const libraryIndex = useMemo(() => createLocalTrackSearchIndex(libraryPool), [libraryPool]);
  const visibleLibraryTracks = useMemo(
    () => (libraryQuery.trim() ? searchLocalTrackIndex(libraryPool, libraryIndex, libraryQuery, libraryPool.length) : libraryPool),
    [libraryPool, libraryIndex, libraryQuery],
  );
  const libraryVirtual = useVirtualRows({ count: visibleLibraryTracks.length, rowHeight: 68, overscan: 8 });

  const filteredOpenedTracks = useMemo(() => {
    const keyword = playlistFilter.trim().toLowerCase();
    if (!keyword) return openedPlaylistTracks;
    return openedPlaylistTracks.filter((track) =>
      `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(keyword),
    );
  }, [openedPlaylistTracks, playlistFilter]);
  const playlistVirtual = useVirtualRows({ count: filteredOpenedTracks.length, rowHeight: 68, overscan: 8 });

  useEffect(() => {
    if (!openedPlaylist) return;
    if (openedPlaylist.source === "local" && openedPlaylist.localPlaylist) {
      const resolved = resolveLocalPlaylistTracks(openedPlaylist.localPlaylist, catalog.allTracks);
      setOpenedPlaylistTracks(mode === "netease" ? resolved.filter((t) => t.source === "netease") : resolved);
      setOpenedPlaylistLoading(false);
      setOpenedPlaylistError(null);
      return;
    }
    const cached = playlistCacheRef.current.get(openedPlaylist.key);
    if (cached) {
      setOpenedPlaylistTracks(mode === "netease" ? cached.filter((t) => t.source === "netease") : cached);
      setOpenedPlaylistLoading(false);
      setOpenedPlaylistError(null);
      return;
    }
    let cancelled = false;
    setOpenedPlaylistLoading(true);
    setOpenedPlaylistError(null);
    setOpenedPlaylistTracks([]);

    const load =
      openedPlaylist.source === "netease"
        ? api.getNeteasePlaylistDetail(openedPlaylist.id).then((res) => res.tracks.map(providerTrackToUiTrack))
        : api
            .getSourcePlaylistTracks(openedPlaylist.source, openedPlaylist.id)
            .then((res) => res.tracks.map(providerTrackToUiTrack));

    load
      .then((loaded) => {
        if (cancelled) return;
        playlistCacheRef.current.set(openedPlaylist.key, loaded);
        setOpenedPlaylistTracks(mode === "netease" ? loaded.filter((t) => t.source === "netease") : loaded);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setOpenedPlaylistError(reason instanceof Error ? reason.message : "读取歌单歌曲失败，请重试");
      })
      .finally(() => {
        if (!cancelled) setOpenedPlaylistLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [openedPlaylist, catalog.allTracks, mode]);

  useEffect(() => {
    const trimmed = searchKeyword.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    const timer = window.setTimeout(() => {
      const localMatches =
        mode === "all" ? searchLocalTrackIndex(libraryPool, libraryIndex, trimmed, 20) : [];
      const requests = [
        api.searchLibraryAndStream(trimmed, 30, "tracks").then((res) => res.neteaseTracks.map(providerTrackToUiTrack)),
        ...(mode === "all"
          ? [
              api
                .searchSource("qq", trimmed, "tracks", 16)
                .then((res) => res.tracks.map(providerTrackToUiTrack))
                .catch(() => [] as Track[]),
              api
                .searchSource("youtube", trimmed, "tracks", 12)
                .then((res) => res.tracks.map(providerTrackToUiTrack))
                .catch(() => [] as Track[]),
              api
                .searchSource("bilibili", trimmed, "tracks", 12)
                .then((res) => res.tracks.map(providerTrackToUiTrack))
                .catch(() => [] as Track[]),
            ]
          : []),
      ];

      Promise.allSettled(requests)
        .then((settled) => {
          if (cancelled) return;
          const groups = [
            localMatches,
            ...settled.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : [])),
          ];
          const merged = mergeDedupeTracks(groups);
          setSearchResults(mode === "netease" ? merged.filter((t) => t.source === "netease") : merged);
          if (!merged.length && settled[0]?.status === "rejected") {
            const reason = settled[0].reason;
            setSearchError(reason instanceof Error ? reason.message : "搜索失败，请重试");
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 320);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchKeyword, mode, libraryPool, libraryIndex]);

  function toggleTrack(track: Track) {
    if (disabled || existingIds.has(track.id)) return;
    if (mode === "netease" && track.source !== "netease") return;
    if (selectedIndexMap.has(track.id)) {
      onSelectedChange(selected.filter((item) => item.id !== track.id));
    } else {
      onSelectedChange([...selected, track]);
    }
  }

  function moveSelected(index: number, delta: -1 | 1) {
    if (disabled) return;
    const target = index + delta;
    if (target < 0 || target >= selected.length) return;
    const next = [...selected];
    const [moving] = next.splice(index, 1);
    next.splice(target, 0, moving);
    onSelectedChange(next);
  }

  function selectAllFromList(list: Track[]) {
    if (disabled) return;
    const eligible = list.filter(
      (track) => !existingIds.has(track.id) && (mode === "all" || track.source === "netease"),
    );
    if (!eligible.length) return;
    const allChosen = eligible.every((track) => selectedIndexMap.has(track.id));
    if (allChosen) {
      const removeIds = new Set(eligible.map((track) => track.id));
      onSelectedChange(selected.filter((item) => !removeIds.has(item.id)));
      return;
    }
    const existingSelectedIds = new Set(selected.map((track) => track.id));
    const additions = eligible.filter((track) => !existingSelectedIds.has(track.id));
    onSelectedChange([...selected, ...additions]);
  }

  function renderTrackRow(track: Track, extraClassName?: string) {
    const existing = existingIds.has(track.id);
    const orderNum = selectedIndexMap.get(track.id);
    const checked = existing || Boolean(orderNum);
    return (
      <button
        type="button"
        key={track.id}
        disabled={disabled || existing}
        aria-pressed={checked}
        onClick={() => toggleTrack(track)}
        className={cn(
          "flex h-16 w-full items-center gap-3 rounded-xl bg-white px-3 py-2 text-left transition hover:bg-violet-50 disabled:opacity-55",
          checked && !existing && "bg-violet-50 ring-1 ring-violet-200",
          extraClassName,
        )}
      >
        <CoverArt track={track} className="size-11 shrink-0 rounded-lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-neutral-900" title={track.title}>
            {track.title}
          </span>
          <span className="block truncate text-xs text-neutral-500" title={`${track.artist} · ${track.album}`}>
            {track.artist} · {track.album}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-neutral-500">
          <SourceBadge source={track.source} compact />
          {existing && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px]">已在歌单</span>}
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums transition",
              existing
                ? "border-neutral-300 bg-neutral-200 text-neutral-500"
                : orderNum
                  ? "border-violet-500 bg-violet-600 text-white shadow-sm"
                  : "border-neutral-300 bg-white text-transparent",
            )}
          >
            {existing ? <Check className="size-3.5" /> : orderNum ?? ""}
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Mode tabs */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="选歌来源" className="inline-flex rounded-full bg-neutral-200/70 p-1 text-xs font-medium">
          {(
            [
              ["playlists", "从其他歌单", ListMusic],
              ["library", "曲库浏览", Library],
              ["search", "搜索添加", Search],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 transition",
                tab === id ? "bg-white text-neutral-950 shadow-sm" : "text-neutral-600 hover:text-neutral-950",
              )}
            >
              <Icon className="size-3.5" />
              {label}
              {id === "playlists" && sourcePlaylists.length > 0 && (
                <span className="rounded-full bg-violet-100 px-1.5 py-0.2 text-[10px] text-violet-700">
                  {sourcePlaylists.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {onInsertPositionChange && (
          <div role="group" aria-label="插入位置" className="inline-flex items-center rounded-full border border-neutral-200 bg-white p-0.5 text-[11px]">
            {(
              [
                ["top", "插到顶部"],
                ["bottom", "追加末尾"],
              ] as const
            ).map(([pos, label]) => (
              <button
                key={pos}
                type="button"
                aria-pressed={insertPosition === pos}
                onClick={() => onInsertPositionChange(pos)}
                className={cn(
                  "rounded-full px-2.5 py-1 transition",
                  insertPosition === pos ? "bg-neutral-950 font-medium text-white" : "text-neutral-500 hover:text-neutral-900",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tab 1: Pick from other playlists */}
      {tab === "playlists" && (
        <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
          {!openedPlaylist ? (
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
              {sourcePlaylists.length ? (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {sourcePlaylists.map((pl) => (
                    <button
                      key={pl.key}
                      type="button"
                      onClick={() => {
                        setOpenedPlaylist(pl);
                        setPlaylistFilter("");
                      }}
                      className="flex items-center gap-3 rounded-2xl border border-neutral-200/80 bg-white p-3 text-left transition hover:border-violet-300 hover:bg-violet-50/40"
                    >
                      {pl.coverTrack ? (
                        <CoverArt track={pl.coverTrack} className="size-14 shrink-0 rounded-xl" />
                      ) : pl.coverUrl ? (
                        <ArtworkImage
                          src={pl.coverUrl}
                          cacheSize={160}
                          alt=""
                          className="size-14 shrink-0 rounded-xl object-cover"
                        />
                      ) : (
                        <span
                          className="flex size-14 shrink-0 items-center justify-center rounded-xl text-white"
                          style={{ background: pl.coverColor ?? "#7c5ce6" }}
                        >
                          <ListMusic className="size-6" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-sm font-semibold leading-snug text-neutral-900">{pl.name}</span>
                        <span className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
                          <SourceBadge source={pl.source} compact />
                          <span>{pl.trackCount} 首</span>
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState
                  text={
                    mode === "netease"
                      ? "暂无其他可浏览的歌单，可切换到「曲库浏览」或「搜索添加」。"
                      : "还没有其他可导入的歌单，可切换到「曲库浏览」或「搜索添加」。"
                  }
                />
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setOpenedPlaylist(null)}>
                  <ArrowLeft />
                  返回歌单
                </Button>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <SourceBadge source={openedPlaylist.source} compact />
                  <span className="truncate text-sm font-semibold">{openedPlaylist.name}</span>
                </div>
                {filteredOpenedTracks.length > 0 && (
                  <Button
                    size="sm"
                    variant="glass"
                    disabled={disabled}
                    onClick={() => selectAllFromList(filteredOpenedTracks)}
                  >
                    全选本页可加歌曲
                  </Button>
                )}
              </div>
              <label className="mt-2 flex shrink-0 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 focus-within:border-violet-400">
                <Search className="size-4 shrink-0 text-neutral-400" />
                <input
                  value={playlistFilter}
                  onChange={(event) => setPlaylistFilter(event.target.value)}
                  placeholder="在当前歌单内筛选歌曲或歌手"
                  aria-label="筛选歌单内歌曲"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
                {playlistFilter && (
                  <button type="button" aria-label="清空筛选" onClick={() => setPlaylistFilter("")}>
                    <X className="size-4 text-neutral-400" />
                  </button>
                )}
              </label>
              {openedPlaylistError && (
                <p role="alert" className="mt-2 shrink-0 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">
                  {openedPlaylistError}
                </p>
              )}
              <div ref={playlistVirtual.containerRef} className="no-scrollbar mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
                {openedPlaylistLoading && !filteredOpenedTracks.length ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-neutral-500">
                    <LoaderCircle className="size-4 animate-spin" />
                    正在读取歌单曲目…
                  </div>
                ) : filteredOpenedTracks.length ? (
                  <div className="relative" style={{ height: playlistVirtual.totalHeight }}>
                    {playlistVirtual.rows.map(({ index, offsetTop }) => {
                      const track = filteredOpenedTracks[index];
                      if (!track) return null;
                      return (
                        <div key={track.id} className="absolute inset-x-0" style={{ top: offsetTop }}>
                          {renderTrackRow(track)}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyState
                    text={
                      mode === "netease"
                        ? "这个歌单里暂时没有可写入网易云歌单的网易云曲目。"
                        : "没有找到匹配的歌曲。"
                    }
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Browse existing library visually */}
      {tab === "library" && (
        <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <label className="flex min-w-[200px] flex-1 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 focus-within:border-violet-400">
              <Search className="size-4 shrink-0 text-neutral-400" />
              <input
                value={libraryQuery}
                onChange={(event) => setLibraryQuery(event.target.value)}
                placeholder="筛选曲库歌名、歌手、专辑"
                aria-label="筛选曲库歌曲"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
              {libraryQuery && (
                <button type="button" aria-label="清空搜索" onClick={() => setLibraryQuery("")}>
                  <X className="size-4 text-neutral-400" />
                </button>
              )}
            </label>
            {mode === "all" && (
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ["all", "全部"],
                    ["local", "本地"],
                    ["netease", "网易云"],
                    ["qq", "QQ"],
                    ["bilibili", "B站"],
                    ["youtube", "YT"],
                  ] as const
                ).map(([src, label]) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setSourceFilter(src)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition",
                      sourceFilter === src
                        ? "border-neutral-900 bg-neutral-900 text-white"
                        : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="mt-2 shrink-0 text-xs text-neutral-500">
            显示 {visibleLibraryTracks.length} 首（带封面直观多选，数字代表加入顺序）
          </p>
          <div ref={libraryVirtual.containerRef} className="no-scrollbar mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="relative" style={{ height: libraryVirtual.totalHeight }}>
              {libraryVirtual.rows.map(({ index, offsetTop }) => {
                const track = visibleLibraryTracks[index];
                if (!track) return null;
                return (
                  <div key={track.id} className="absolute inset-x-0" style={{ top: offsetTop }}>
                    {renderTrackRow(track)}
                  </div>
                );
              })}
            </div>
            {!visibleLibraryTracks.length && (
              <EmptyState
                text={
                  libraryPool.length
                    ? "没有匹配的歌曲，换个关键词或音源筛选试试。"
                    : mode === "netease"
                      ? "当前曲库暂无网易云曲目，请使用「搜索添加」。"
                      : "曲库为空，请先扫描本地文件夹或登录在线音源。"
                }
              />
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Search online & library tracks */}
      {tab === "search" && (
        <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden">
          <label className="flex shrink-0 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 focus-within:border-violet-400">
            <Search className="size-4 shrink-0 text-neutral-400" />
            <input
              autoFocus
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
              placeholder={mode === "netease" ? "搜索网易云歌曲或歌手，可多选" : "搜索本地与各在线音源歌曲，可多选"}
              aria-label="搜索要加入的歌曲"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            {searchKeyword && (
              <button type="button" aria-label="清空搜索词" onClick={() => setSearchKeyword("")}>
                <X className="size-4 text-neutral-400" />
              </button>
            )}
          </label>
          {searchKeyword.trim() && (
            <p className="mt-2 shrink-0 text-xs text-neutral-500">
              {searching ? "正在搜索…" : `找到 ${searchResults.length} 首匹配曲目`}
            </p>
          )}
          {searchError && (
            <p role="alert" className="mt-2 shrink-0 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">
              {searchError}
            </p>
          )}
          <div className="no-scrollbar mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
            {searchResults.map((track) => renderTrackRow(track))}
            {!searchKeyword.trim() && (
              <EmptyState
                text={
                  mode === "netease"
                    ? "输入歌名或歌手搜索网易云曲库，或直接切换到「从其他歌单」可视化勾选。"
                    : "输入歌名、歌手跨音源搜索，或切换到「从其他歌单 / 曲库浏览」可视化勾选。"
                }
              />
            )}
          </div>
        </div>
      )}

      {/* Ordered Selection Preview & Adjustment Bar */}
      {selected.length > 0 && (
        <div className="mt-3 shrink-0 rounded-2xl border border-violet-100 bg-violet-50/70 p-2.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-violet-950">
              待加入队列 · 已选 {selected.length} 首（按序号顺序加入）
            </span>
            <div className="flex items-center gap-2">
              {selected.length > 1 && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelectedChange([...selected].reverse())}
                  className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-medium text-violet-700 shadow-sm hover:bg-violet-100"
                >
                  <ArrowLeftRight className="size-3" />
                  反转顺序
                </button>
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelectedChange([])}
                className="text-[11px] text-neutral-500 hover:text-neutral-900"
              >
                清空
              </button>
            </div>
          </div>
          <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-0.5">
            {selected.map((track, idx) => (
              <div
                key={track.id}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-white/80 bg-white px-2 py-1 text-xs shadow-sm"
              >
                <span className="font-mono text-[10px] font-bold text-violet-600">{idx + 1}</span>
                <CoverArt track={track} className="size-6 rounded-md" />
                <span className="max-w-[110px] truncate font-medium text-neutral-800" title={track.title}>
                  {track.title}
                </span>
                {selected.length > 1 && (
                  <span className="flex items-center">
                    <button
                      type="button"
                      disabled={disabled || idx === 0}
                      aria-label={`前移 ${track.title}`}
                      onClick={() => moveSelected(idx, -1)}
                      className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30"
                    >
                      <ChevronLeft className="size-3" />
                    </button>
                    <button
                      type="button"
                      disabled={disabled || idx === selected.length - 1}
                      aria-label={`后移 ${track.title}`}
                      onClick={() => moveSelected(idx, 1)}
                      className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800 disabled:opacity-30"
                    >
                      <ChevronRight className="size-3" />
                    </button>
                  </span>
                )}
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`取消选择 ${track.title}`}
                  onClick={() => onSelectedChange(selected.filter((item) => item.id !== track.id))}
                  className="rounded p-0.5 text-neutral-400 hover:bg-rose-50 hover:text-rose-600"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
