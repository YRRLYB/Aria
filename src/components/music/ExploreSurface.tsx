import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import {
  ChevronRight,
  Compass,
  Disc3,
  Flame,
  ListMusic,
  LoaderCircle,
  Play,
  RefreshCw,
  Trophy,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Track } from "@/data/music";
import type { ProviderPlaylist } from "@/lib/api";
import { formatAudioDetail } from "@/lib/playerPresentation";
import { cn } from "@/lib/utils";
import { useVirtualRows } from "@/lib/virtualRows";
import { ArtworkImage } from "./ArtworkImage";
import { SourceToggle } from "./SourceLogos";
import { CopyableTrackText, CoverArt, EmptyState } from "./shared";

export type YoutubeExploreDiscovery = {
  quickPicks: Track[];
  trendingTracks: Track[];
  charts: ProviderPlaylist[];
  playlists: ProviderPlaylist[];
  moods: Array<{ id: string; name: string; query: string }>;
};

export type ExploreStyle = {
  id: string;
  name: string;
  coverUrl?: string | null;
};

export type ExploreStyleGroup = {
  id: string;
  name: string;
  styles: ExploreStyle[];
};

export type ExploreSelectedStyle = ExploreStyle & {
  description?: string | null;
};

export type ExploreTab = "discover" | "styles";

export function ExploreSurface({
  styleGroups,
  selectedStyle,
  tracks,
  activeTab,
  selectedStyleId,
  stylesLoading,
  loading,
  loadingMore,
  styleError,
  discovery,
  discoveryLoading,
  discoveryError,
  sort,
  onSelectStyle,
  onRetryStyles,
  onSortChange,
  onLoadMore,
  onLoadDiscovery,
  onRetryDiscovery,
  onSearchHot,
  onOpenPlaylist,
  onPickTrack,
  onTabChange,
  exploreSource = "netease",
  onExploreSourceChange,
  youtubeDiscovery = null,
  youtubeDiscoveryLoading = false,
  youtubeDiscoveryError = null,
  onRetryYoutubeDiscovery,
  onOpenYoutubePlaylist,
}: {
  styleGroups: ExploreStyleGroup[];
  selectedStyle: ExploreSelectedStyle | null;
  tracks: Track[];
  activeTab: ExploreTab;
  selectedStyleId: string | null;
  stylesLoading: boolean;
  loading: boolean;
  loadingMore: boolean;
  styleError: string | null;
  discovery: { hotSearches: string[]; rankings: ProviderPlaylist[]; playlists: ProviderPlaylist[] } | null;
  discoveryLoading: boolean;
  discoveryError: string | null;
  sort: "hot" | "new";
  onSelectStyle: (id: string) => void;
  onRetryStyles: () => void;
  onSortChange: (sort: "hot" | "new") => void;
  onLoadMore?: () => void;
  onLoadDiscovery: () => void;
  onRetryDiscovery: () => void;
  onSearchHot: (value: string) => void;
  onOpenPlaylist: (playlist: ProviderPlaylist) => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
  onTabChange: (tab: ExploreTab) => void;
  exploreSource?: "netease" | "youtube";
  onExploreSourceChange?: (source: "netease" | "youtube") => void;
  youtubeDiscovery?: YoutubeExploreDiscovery | null;
  youtubeDiscoveryLoading?: boolean;
  youtubeDiscoveryError?: string | null;
  onRetryYoutubeDiscovery?: () => void;
  onOpenYoutubePlaylist?: (playlist: ProviderPlaylist) => void;
}) {
  const tabId = useId();
  const tabListRef = useRef<HTMLDivElement | null>(null);

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const tabs: ExploreTab[] = ["discover", "styles"];
    let tab: ExploreTab;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const offset = event.key === "ArrowRight" ? 1 : -1;
      tab = tabs[(tabs.indexOf(activeTab) + offset + tabs.length) % tabs.length];
    } else if (event.key === "Home") {
      tab = "discover";
    } else if (event.key === "End") {
      tab = "styles";
    } else {
      return;
    }
    event.preventDefault();
    onTabChange(tab);
    if (tab === "discover") onLoadDiscovery();
    tabListRef.current?.querySelector<HTMLButtonElement>(`[data-explore-tab="${tab}"]`)?.focus();
  }

  function playTracks(items: Track[]) {
    const first = items[0];
    if (first) onPickTrack(first.id, items);
  }

  return (
    <section
      className="explore-surface aria-page-shell flex h-full min-h-0 flex-col overflow-hidden rounded-[1.5rem] p-5 sm:p-7"
      aria-label="探索音乐"
    >
      <header className="aria-page-header flex shrink-0 flex-wrap items-center justify-between gap-4 pb-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">探索发现</h1>
          <p className="mt-1 text-xs text-neutral-500">
            {exploreSource === "youtube"
              ? "YouTube Music · 为你推荐、心情流派与全球音乐榜单"
              : "网易云音乐 · 榜单风向、精选歌单与细分曲风漫游"}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          {onExploreSourceChange && (
            <SourceToggle
              value={exploreSource}
              onChange={(source) => {
                if (source === "netease" || source === "youtube") onExploreSourceChange(source);
              }}
              options={["netease", "youtube"]}
              ariaLabel="探索来源"
            />
          )}
          {exploreSource === "netease" && activeTab === "discover" && (
            <Button
              type="button"
              variant="glass"
              size="sm"
              className="size-9 px-0"
              aria-label="刷新探索推荐"
              title="刷新榜单与热搜"
              disabled={discoveryLoading}
              onClick={onRetryDiscovery}
            >
              <RefreshCw className={cn("size-3.5", discoveryLoading && "animate-spin")} />
            </Button>
          )}
          {exploreSource === "youtube" && onRetryYoutubeDiscovery && (
            <Button
              type="button"
              variant="glass"
              size="sm"
              className="size-9 px-0"
              aria-label="刷新 YouTube 探索推荐"
              title="刷新 YouTube Music 推荐"
              disabled={youtubeDiscoveryLoading}
              onClick={onRetryYoutubeDiscovery}
            >
              <RefreshCw className={cn("size-3.5", youtubeDiscoveryLoading && "animate-spin")} />
            </Button>
          )}
          {exploreSource === "netease" && (
            <div
              ref={tabListRef}
              onKeyDown={handleTabKeyDown}
              className="explore-tablist flex shrink-0 items-center gap-1 rounded-full border p-1"
              role="tablist"
              aria-label="探索模式"
            >
              <button
                type="button"
                role="tab"
                id={`${tabId}-discover-tab`}
                data-explore-tab="discover"
                aria-controls={`${tabId}-discover-panel`}
                aria-selected={activeTab === "discover"}
                tabIndex={activeTab === "discover" ? 0 : -1}
                className={cn(
                  "explore-tab inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition",
                  activeTab === "discover" && "is-active",
                )}
                onClick={() => {
                  onTabChange("discover");
                  onLoadDiscovery();
                }}
              >
                <Compass className="size-3.5" /> 榜单与精选
              </button>
              <button
                type="button"
                role="tab"
                id={`${tabId}-styles-tab`}
                data-explore-tab="styles"
                aria-controls={`${tabId}-styles-panel`}
                aria-selected={activeTab === "styles"}
                tabIndex={activeTab === "styles" ? 0 : -1}
                className={cn(
                  "explore-tab inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition",
                  activeTab === "styles" && "is-active",
                )}
                onClick={() => onTabChange("styles")}
              >
                <Disc3 className="size-3.5" /> 曲风漫游
              </button>
            </div>
          )}
        </div>
      </header>

      {exploreSource === "youtube" ? (
        <YoutubeDiscoveryPanel
          discovery={youtubeDiscovery}
          loading={youtubeDiscoveryLoading}
          error={youtubeDiscoveryError}
          onRetry={onRetryYoutubeDiscovery}
          onSearchMood={onSearchHot}
          onOpenPlaylist={onOpenYoutubePlaylist ?? onOpenPlaylist}
          onPickTrack={onPickTrack}
        />
      ) : (
        <>
          {/* Discover Tab */}
          <div
            id={`${tabId}-discover-panel`}
            role="tabpanel"
            aria-labelledby={`${tabId}-discover-tab`}
            hidden={activeTab !== "discover"}
            className={cn("mt-5 min-h-0 flex-1 flex-col gap-5 overflow-hidden", activeTab === "discover" ? "flex" : "hidden")}
          >
        {activeTab === "discover" && (
          <>
            {discoveryError && <ErrorMessage message={discoveryError} onRetry={onRetryDiscovery} disabled={discoveryLoading} />}
            {discoveryLoading && !discovery && (
              <div className="flex min-h-48 flex-1 items-center justify-center text-sm text-neutral-400">
                <LoaderCircle className="mr-2 size-4 animate-spin" /> 正在同步榜单与精选推荐…
              </div>
            )}
            {discovery && (
              <div className="no-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
                <section className="explore-section border-b pb-6">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="explore-icon-pill">
                        <Flame className="size-3.5" />
                      </span>
                      <h2 className="text-base font-semibold">热搜风向</h2>
                    </div>
                    <span className="text-[11px] text-neutral-400">点按直达全站搜索</span>
                  </div>
                  <div className="mt-3.5 flex flex-wrap gap-2">
                    {discovery.hotSearches.map((term, index) => (
                      <button
                        key={`${term}-${index}`}
                        type="button"
                        className={cn(
                          "explore-hot-chip inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                          index < 3 && "is-top",
                        )}
                        onClick={() => onSearchHot(term)}
                      >
                        <span className="explore-hot-rank tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                        <span>{term}</span>
                      </button>
                    ))}
                    {!discovery.hotSearches.length && <p className="text-sm text-neutral-400">暂无热搜数据</p>}
                  </div>
                </section>

                <DiscoveryPlaylistSection
                  title="实时榜单"
                  subtitle="热门流行与飙升榜"
                  icon={<Trophy className="size-4" />}
                  playlists={discovery.rankings}
                  onOpenPlaylist={onOpenPlaylist}
                  emptyText="暂无榜单数据"
                />

                <DiscoveryPlaylistSection
                  title="歌单广场"
                  subtitle="精选主题与编辑推荐"
                  icon={<ListMusic className="size-4" />}
                  playlists={discovery.playlists}
                  onOpenPlaylist={onOpenPlaylist}
                  emptyText="暂无歌单数据"
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Styles Tab */}
      <div
        id={`${tabId}-styles-panel`}
        role="tabpanel"
        aria-labelledby={`${tabId}-styles-tab`}
        hidden={activeTab !== "styles"}
        className={cn("mt-5 min-h-0 flex-1 flex-col gap-4 overflow-hidden", activeTab === "styles" ? "flex" : "hidden")}
      >
        {activeTab === "styles" && (
          <>
            <div className="explore-section no-scrollbar max-h-[144px] shrink-0 space-y-2.5 overflow-y-auto border-b pb-3.5" aria-busy={stylesLoading}>
              {stylesLoading && !styleGroups.length && (
                <div className="flex items-center gap-2 py-2 text-xs text-neutral-400">
                  <LoaderCircle className="size-3.5 animate-spin" /> 正在加载曲风分类…
                </div>
              )}
              {styleGroups.map((group) => (
                <div key={group.id} className="flex items-start gap-3">
                  <span className="w-14 shrink-0 pt-1.5 text-[11px] font-semibold text-neutral-400">{group.name}</span>
                  <div className="flex min-w-0 flex-wrap gap-1.5">
                    {group.styles.map((style) => {
                      const selected = selectedStyleId === style.id;
                      return (
                        <button
                          key={style.id}
                          type="button"
                          aria-pressed={selected}
                          className={cn(
                            "explore-style-chip rounded-full border px-2.5 py-1 text-xs font-medium transition",
                            selected && "is-active",
                          )}
                          onClick={() => onSelectStyle(style.id)}
                        >
                          {style.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {!stylesLoading && !styleGroups.length && !styleError && <EmptyState text="暂无曲风数据" />}
            </div>

            <div className="explore-section flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="explore-style-banner flex shrink-0 flex-wrap items-center justify-between gap-4 border-b pb-3">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-semibold">{selectedStyle?.name ?? "选择一个曲风"}</h2>
                  {selectedStyle?.description && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-neutral-500" title={selectedStyle.description}>
                      {selectedStyle.description}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  <div className="explore-sort-group flex items-center gap-1 rounded-full p-1" role="group" aria-label="曲风歌曲排序">
                    {(["hot", "new"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={sort === value}
                        disabled={!selectedStyleId || loading || loadingMore}
                        onClick={() => onSortChange(value)}
                        className={cn(
                          "explore-sort-btn rounded-full px-3 py-1 text-xs font-medium transition disabled:opacity-45",
                          sort === value && "is-active",
                        )}
                      >
                        {value === "hot" ? "热门" : "最新"}
                      </button>
                    ))}
                  </div>
                  <Button size="sm" disabled={!tracks.length || loading} onClick={() => playTracks(tracks)}>
                    <Play className="size-3.5 fill-current" /> 播放全部
                  </Button>
                </div>
              </div>
              {styleError && <ErrorMessage message={styleError} onRetry={onRetryStyles} disabled={stylesLoading || loading || loadingMore} />}
              <ExploreTrackList
                tracks={tracks}
                loading={loading}
                error={Boolean(styleError)}
                onPickTrack={onPickTrack}
                emptyText={selectedStyle ? "这个曲风暂时没有歌曲" : "从上方选择一个曲风"}
              />
              {onLoadMore && tracks.length > 0 && (
                <div className="explore-divider shrink-0 border-t px-4 py-2.5 text-center">
                  <Button variant="ghost" size="sm" disabled={loading || loadingMore} onClick={onLoadMore}>
                    {loadingMore && <LoaderCircle className="animate-spin" />} {loadingMore ? "正在加载…" : "加载更多曲目"}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
        </>
      )}
    </section>
  );
}

function YoutubeDiscoveryPanel({
  discovery,
  loading,
  error,
  onRetry,
  onSearchMood,
  onOpenPlaylist,
  onPickTrack,
}: {
  discovery: YoutubeExploreDiscovery | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  onSearchMood: (query: string) => void;
  onOpenPlaylist: (playlist: ProviderPlaylist) => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
}) {
  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col gap-5 overflow-hidden">
      {error && onRetry && <ErrorMessage message={error} onRetry={onRetry} disabled={loading} />}
      {loading && !discovery && (
        <div className="flex min-h-48 flex-1 items-center justify-center text-sm text-neutral-400">
          <LoaderCircle className="mr-2 size-4 animate-spin" /> 正在连接 YouTube Music 推荐与榜单…
        </div>
      )}
      {discovery && (
        <div className="no-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
          {discovery.moods.length > 0 && (
            <section className="explore-section border-b pb-6">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="explore-icon-pill">
                    <Disc3 className="size-3.5" />
                  </span>
                  <h2 className="text-base font-semibold">心情与流派</h2>
                </div>
                <span className="text-[11px] text-neutral-400">点击流派探索相关曲目</span>
              </div>
              <div className="mt-3.5 flex flex-wrap gap-2">
                {discovery.moods.map((mood) => (
                  <button
                    key={mood.id}
                    type="button"
                    className="explore-hot-chip inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition"
                    onClick={() => onSearchMood(mood.query)}
                  >
                    <span>{mood.name}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {discovery.quickPicks.length > 0 && (
            <YoutubeTrackGridSection
              title="为你推荐 · 快捷精选"
              subtitle="依据 YouTube Music 精选动态生成"
              icon={<Compass className="size-4" />}
              tracks={discovery.quickPicks}
              onPickTrack={onPickTrack}
            />
          )}

          {discovery.charts.length > 0 && (
            <DiscoveryPlaylistSection
              title="YouTube Charts 官方榜单"
              subtitle="热门单曲与全球风向榜"
              icon={<Trophy className="size-4" />}
              playlists={discovery.charts}
              onOpenPlaylist={onOpenPlaylist}
              emptyText="暂无 YouTube 官方榜单"
            />
          )}

          {discovery.playlists.length > 0 && (
            <DiscoveryPlaylistSection
              title="新发行与推荐歌单"
              subtitle="新专辑、单曲与精选合辑"
              icon={<ListMusic className="size-4" />}
              playlists={discovery.playlists}
              onOpenPlaylist={onOpenPlaylist}
              emptyText="暂无 YouTube 推荐歌单"
            />
          )}

          {discovery.trendingTracks.length > 0 && (
            <YoutubeTrackGridSection
              title="时下流行单曲"
              subtitle="YouTube Music 实时热门单曲"
              icon={<Flame className="size-4" />}
              tracks={discovery.trendingTracks}
              onPickTrack={onPickTrack}
            />
          )}

          {!discovery.moods.length &&
            !discovery.quickPicks.length &&
            !discovery.charts.length &&
            !discovery.playlists.length &&
            !discovery.trendingTracks.length && <EmptyState text="暂无 YouTube 推荐内容，请确认代理运行正常后点击右上角刷新。" />}
        </div>
      )}
    </div>
  );
}

function YoutubeTrackGridSection({
  title,
  subtitle,
  icon,
  tracks,
  onPickTrack,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  tracks: Track[];
  onPickTrack: (id: string, queue?: Track[]) => void;
}) {
  return (
    <section className="explore-section min-h-0 border-b pb-6 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="explore-icon-pill">{icon}</span>
          <div>
            <h2 className="text-base font-semibold leading-tight">{title}</h2>
            <p className="text-[11px] text-neutral-400">{subtitle}</p>
          </div>
        </div>
        <Button size="sm" variant="glass" onClick={() => tracks[0] && onPickTrack(tracks[0].id, tracks)}>
          <Play className="size-3.5 fill-current" /> 播放全部
        </Button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {tracks.slice(0, 12).map((track, index) => (
          <button
            key={`${track.id}-${index}`}
            type="button"
            className="aria-flat-row group grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2.5 py-2 text-left transition"
            onClick={() => onPickTrack(track.id, tracks)}
            aria-label={`播放 ${track.title}`}
          >
            <CoverArt track={track} className="size-12 rounded-xl" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold" title={track.title}>
                <CopyableTrackText track={track} field="title">{track.title}</CopyableTrackText>
              </span>
              <span className="mt-0.5 block truncate text-xs text-neutral-500">
                <CopyableTrackText track={track} field="artist">{track.artist}</CopyableTrackText>
              </span>
            </span>
            <span className="text-xs tabular-nums text-neutral-400">
              {track.duration !== "--:--" ? track.duration : "MV"}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function DiscoveryPlaylistSection({
  title,
  subtitle,
  icon,
  playlists,
  onOpenPlaylist,
  emptyText,
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  playlists: ProviderPlaylist[];
  onOpenPlaylist: (playlist: ProviderPlaylist) => void;
  emptyText: string;
}) {
  return (
    <section className="explore-section min-h-0 border-b pb-6 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="explore-icon-pill">{icon}</span>
          <div>
            <h2 className="text-base font-semibold leading-tight">{title}</h2>
            <p className="text-[11px] text-neutral-400">{subtitle}</p>
          </div>
        </div>
        <span className="text-xs text-neutral-400 tabular-nums">{playlists.length} 个</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {playlists.map((playlist) => (
          <button
            key={playlist.id}
            type="button"
            className="explore-playlist-card group flex min-w-0 flex-col rounded-2xl border p-2 text-left transition"
            onClick={() => onOpenPlaylist(playlist)}
            title={playlist.name}
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-neutral-900/5">
              <ArtworkImage
                src={playlist.coverUrl}
                alt=""
                className="size-full object-cover transition duration-300 group-hover:scale-105"
              />
              <span className="explore-card-play pointer-events-none absolute bottom-2 right-2 flex size-8 items-center justify-center rounded-full shadow-lg opacity-0 transition duration-200 group-hover:opacity-100">
                <Play className="size-3.5 fill-current" />
              </span>
            </div>
            <span className="mt-2.5 line-clamp-2 min-h-[2.25rem] text-xs font-semibold leading-snug">
              {playlist.name}
            </span>
            <span className="mt-1 truncate text-[11px] text-neutral-400">
              {playlist.trackCount > 0 ? `${playlist.trackCount} 首歌曲` : playlist.description || "精选推荐"}
            </span>
          </button>
        ))}
        {!playlists.length && <p className="col-span-full py-6 text-center text-sm text-neutral-400">{emptyText}</p>}
      </div>
    </section>
  );
}

function ExploreTrackList({
  tracks,
  loading,
  error,
  onPickTrack,
  emptyText,
}: {
  tracks: Track[];
  loading: boolean;
  error: boolean;
  onPickTrack: (id: string, queue?: Track[]) => void;
  emptyText: string;
}) {
  const virtual = useVirtualRows({ count: tracks.length, rowHeight: 70, overscan: 8 });
  const firstTrackId = tracks[0]?.id;

  useEffect(() => {
    virtual.containerRef.current?.scrollTo({ top: 0 });
  }, [firstTrackId, virtual.containerRef]);

  return (
    <div ref={virtual.containerRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-2.5 sm:p-3" aria-busy={loading}>
      {loading && !tracks.length && (
        <div className="flex min-h-40 items-center justify-center text-sm text-neutral-400">
          <LoaderCircle className="mr-2 size-4 animate-spin" /> 正在加载曲风歌曲…
        </div>
      )}
      {!loading && !error && !tracks.length && <EmptyState text={emptyText} />}
      <div className="relative" style={{ height: virtual.totalHeight }}>
        {virtual.rows.map(({ index, offsetTop }) => {
          const track = tracks[index];
          if (!track) return null;
          return (
            <button
              key={`${track.id}-${index}`}
              type="button"
              aria-label={`播放 ${track.title}`}
              style={{ top: offsetTop }}
              className="explore-track-row group absolute inset-x-0 grid h-[64px] grid-cols-[1.75rem_3rem_minmax(0,1fr)_auto_1rem] items-center gap-3 rounded-xl px-2.5 py-1.5 text-left transition"
              onClick={() => onPickTrack(track.id, tracks)}
            >
              <span className="text-center text-xs tabular-nums text-neutral-400">{String(index + 1).padStart(2, "0")}</span>
              <CoverArt track={track} className="size-11 rounded-xl" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold" title={track.title}>
                  <CopyableTrackText track={track} field="title">{track.title}</CopyableTrackText>
                </span>
                <span className="mt-0.5 block truncate text-xs text-neutral-500">
                  <CopyableTrackText track={track} field="artist">{track.artist}</CopyableTrackText>
                  {track.album && track.album !== track.title ? (
                    <span className="text-neutral-400"> · {track.album}</span>
                  ) : null}
                </span>
              </span>
              <Badge className="shrink-0 whitespace-nowrap">{formatAudioDetail(track)}</Badge>
              <ChevronRight className="size-4 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-neutral-600" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ErrorMessage({ message, onRetry, disabled }: { message: string; onRetry: () => void; disabled: boolean }) {
  return (
    <div role="alert" className="mx-3 mt-3 flex shrink-0 items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
      <p className="min-w-0">{message}</p>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={onRetry}>重试</Button>
    </div>
  );
}
