import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  ChevronRight,
  Disc3,
  LayoutGrid,
  ListMusic,
  LoaderCircle,
  Play,
  Radio,
  Sparkles,
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
import { CopyableTrackText, CoverArt, EmptyState } from "./shared";

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

export function ExploreSurface({
  styleGroups,
  selectedStyle,
  tracks,
  radioTracks,
  activeTab,
  selectedStyleId,
  stylesLoading,
  loading,
  loadingMore,
  radioLoading,
  styleError,
  radioError,
  discovery,
  discoveryLoading,
  discoveryError,
  selectedBpm,
  sort,
  onSelectStyle,
  onRetryStyles,
  onSortChange,
  onLoadMore,
  onLoadRadio,
  onLoadDiscovery,
  onRetryDiscovery,
  onSearchHot,
  onOpenPlaylist,
  onPickTrack,
  onTabChange,
}: {
  styleGroups: ExploreStyleGroup[];
  selectedStyle: ExploreSelectedStyle | null;
  tracks: Track[];
  radioTracks: Track[];
  activeTab: "styles" | "radio" | "discover";
  selectedStyleId: string | null;
  stylesLoading: boolean;
  loading: boolean;
  loadingMore: boolean;
  radioLoading: boolean;
  styleError: string | null;
  radioError: string | null;
  discovery: { hotSearches: string[]; rankings: ProviderPlaylist[]; playlists: ProviderPlaylist[] } | null;
  discoveryLoading: boolean;
  discoveryError: string | null;
  selectedBpm: number | null;
  sort: "hot" | "new";
  onSelectStyle: (id: string) => void;
  onRetryStyles: () => void;
  onSortChange: (sort: "hot" | "new") => void;
  onLoadMore?: () => void;
  onLoadRadio: (bpm: number) => void;
  onLoadDiscovery: () => void;
  onRetryDiscovery: () => void;
  onSearchHot: (value: string) => void;
  onOpenPlaylist: (playlist: ProviderPlaylist) => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
  onTabChange: (tab: "styles" | "radio" | "discover") => void;
}) {
  const [bpm, setBpm] = useState(100);
  const [bpmInput, setBpmInput] = useState("100");
  const tabId = useId();
  const tabListRef = useRef<HTMLDivElement | null>(null);

  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const tabs = ["styles", "radio", "discover"] as const;
    let tab: (typeof tabs)[number];
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const offset = event.key === "ArrowRight" ? 1 : -1;
      tab = tabs[(tabs.indexOf(activeTab) + offset + tabs.length) % tabs.length];
    } else if (event.key === "Home") tab = "styles";
    else if (event.key === "End") tab = "discover";
    else return;
    event.preventDefault();
    onTabChange(tab);
    tabListRef.current?.querySelector<HTMLButtonElement>(`[data-explore-tab="${tab}"]`)?.focus();
  }

  function updateBpm(value: number) {
    if (!Number.isFinite(value)) return;
    const next = Math.min(180, Math.max(60, Math.round(value)));
    setBpm(next);
    setBpmInput(String(next));
  }

  function requestRadio() {
    const value = bpmInput.trim() ? Number(bpmInput) : bpm;
    const next = Number.isFinite(value) ? Math.min(180, Math.max(60, Math.round(value))) : bpm;
    updateBpm(next);
    onLoadRadio(next);
  }

  function playTracks(items: Track[]) {
    const first = items[0];
    if (first) onPickTrack(first.id, items);
  }

  return (
    <section className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-[1.5rem] p-5 sm:p-7" aria-label="探索音乐">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <Badge className="gap-2"><Sparkles className="size-3.5" /> Explore</Badge>
          <h1 className="mt-4 truncate text-3xl font-semibold tracking-tight sm:text-4xl">探索</h1>
          <p className="mt-2 max-w-xl text-sm text-neutral-500">按曲风发现下一首，或用节拍打开一段新的播放序列。</p>
        </div>
        <div ref={tabListRef} onKeyDown={handleTabKeyDown} className="flex shrink-0 items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface-muted)] p-1" role="tablist" aria-label="探索模式">
          <button
            type="button"
            role="tab"
            id={`${tabId}-styles-tab`}
            data-explore-tab="styles"
            aria-controls={`${tabId}-styles-panel`}
            aria-selected={activeTab === "styles"}
            tabIndex={activeTab === "styles" ? 0 : -1}
            className={cn("inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm transition", activeTab === "styles" ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]")}
            onClick={() => onTabChange("styles")}
          >
            <Disc3 className="size-4" /> 曲风
          </button>
          <button
            type="button"
            role="tab"
            id={`${tabId}-radio-tab`}
            data-explore-tab="radio"
            aria-controls={`${tabId}-radio-panel`}
            aria-selected={activeTab === "radio"}
            tabIndex={activeTab === "radio" ? 0 : -1}
            className={cn("inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm transition", activeTab === "radio" ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]")}
            onClick={() => onTabChange("radio")}
          >
            <Radio className="size-4" /> 节拍电台
          </button>
          <button
            type="button"
            role="tab"
            id={`${tabId}-discover-tab`}
            data-explore-tab="discover"
            aria-controls={`${tabId}-discover-panel`}
            aria-selected={activeTab === "discover"}
            tabIndex={activeTab === "discover" ? 0 : -1}
            className={cn("inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm transition", activeTab === "discover" ? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]")}
            onClick={() => { onTabChange("discover"); onLoadDiscovery(); }}
          >
            <LayoutGrid className="size-4" /> 发现
          </button>
        </div>
      </header>

      <div id={`${tabId}-styles-panel`} role="tabpanel" aria-labelledby={`${tabId}-styles-tab`} hidden={activeTab !== "styles"} className={cn("mt-6 min-h-0 flex-1 flex-col gap-5 overflow-hidden", activeTab === "styles" ? "flex" : "hidden")}>
        {activeTab === "styles" && <>
          <div className="no-scrollbar max-h-[130px] shrink-0 space-y-3 overflow-y-auto pr-1" aria-busy={stylesLoading}>
            {stylesLoading && !styleGroups.length && <div className="flex items-center gap-2 py-3 text-sm text-neutral-400"><LoaderCircle className="size-4 animate-spin" /> 正在加载曲风</div>}
            {styleGroups.map((group) => (
              <div key={group.id} className="flex items-start gap-3">
                <span className="w-16 shrink-0 pt-2 text-xs font-semibold text-neutral-400">{group.name}</span>
                <div className="flex min-w-0 flex-wrap gap-2">
                  {group.styles.map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      aria-pressed={selectedStyleId === style.id}
                      className={cn("rounded-full border px-3 py-1.5 text-sm transition", selectedStyleId === style.id ? "border-neutral-950 bg-neutral-950 text-white" : "border-[var(--line)] bg-[var(--surface)] text-neutral-600 hover:bg-[var(--surface-muted)]")}
                      onClick={() => onSelectStyle(style.id)}
                    >
                      {style.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {!stylesLoading && !styleGroups.length && !styleError && <EmptyState text="暂无曲风数据" />}
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.25rem] border border-[var(--line)] bg-[var(--surface-muted)]/45">
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--line)] px-4 py-4 sm:px-5">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">Selected style</p>
                <h2 className="mt-1 truncate text-xl font-semibold">{selectedStyle?.name ?? "选择一个曲风"}</h2>
                {selectedStyle?.description && <p className="mt-1 line-clamp-2 text-sm text-neutral-500">{selectedStyle.description}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <div className="flex items-center gap-1 rounded-full bg-[var(--surface)] p-1" role="group" aria-label="曲风歌曲排序">
                  {(["hot", "new"] as const).map((value) => <button key={value} type="button" aria-pressed={sort === value} disabled={!selectedStyleId || loading || loadingMore} onClick={() => onSortChange(value)} className={cn("rounded-full px-3 py-1 text-xs transition disabled:opacity-45", sort === value ? "bg-neutral-950 text-white" : "text-neutral-500 hover:bg-[var(--surface-muted)]")}>{value === "hot" ? "热门" : "最新"}</button>)}
                </div>
                <Button variant="glass" size="sm" disabled={!tracks.length || loading} onClick={() => playTracks(tracks)}>
                  <Play className="fill-current" /> 播放全部
                </Button>
              </div>
            </div>
            {styleError && <ErrorMessage message={styleError} onRetry={onRetryStyles} disabled={stylesLoading || loading || loadingMore} />}
            <TrackList tracks={tracks} loading={loading} error={Boolean(styleError)} onPickTrack={onPickTrack} emptyText={selectedStyle ? "这个曲风暂时没有歌曲" : "从上方选择一个曲风"} />
            {onLoadMore && tracks.length > 0 && (
              <div className="shrink-0 border-t border-[var(--line)] px-4 py-3 text-center">
                <Button variant="ghost" size="sm" disabled={loading || loadingMore} onClick={onLoadMore}>
                  {loadingMore && <LoaderCircle className="animate-spin" />} {loadingMore ? "正在加载" : "加载更多"}
                </Button>
              </div>
            )}
          </div>
        </>}
      </div>
      <div id={`${tabId}-radio-panel`} role="tabpanel" aria-labelledby={`${tabId}-radio-tab`} hidden={activeTab !== "radio"} className={cn("mt-6 min-h-0 flex-1 flex-col gap-5 overflow-hidden", activeTab === "radio" ? "flex" : "hidden")}>
        {activeTab === "radio" && <>
          <div className="shrink-0 rounded-[1.25rem] border border-[var(--line)] bg-[var(--surface-muted)]/55 p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-400">Tempo radio</p>
                <h2 className="mt-1 text-xl font-semibold">按节拍开始</h2>
                <p className="mt-1 text-sm text-neutral-500">BPM 作为推荐偏好，曲目不保证严格匹配。</p>
              </div>
              <Button disabled={radioLoading} onClick={requestRadio}>
                {radioLoading ? <LoaderCircle className="animate-spin" /> : <Radio />} {selectedBpm == null ? "获取推荐" : "换一组"}
              </Button>
            </div>
            <div className="mt-5 flex items-center gap-4">
              <input
                aria-label="目标 BPM"
                type="range"
                min={60}
                max={180}
                value={bpm}
                onChange={(event) => updateBpm(Number(event.target.value))}
                className="min-w-0 flex-1 accent-[var(--accent)]"
              />
              <label className="flex h-10 w-24 shrink-0 items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm">
                <input aria-label="BPM 数值" type="number" min={60} max={180} value={bpmInput} onChange={(event) => setBpmInput(event.target.value)} onBlur={() => updateBpm(bpmInput.trim() ? Number(bpmInput) : bpm)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} className="w-12 bg-transparent text-right font-semibold outline-none" />
                <span className="text-xs text-neutral-400">BPM</span>
              </label>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.25rem] border border-[var(--line)] bg-[var(--surface-muted)]/45">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-4 sm:px-5">
              <div className="min-w-0"><div className="flex items-center gap-2"><ListMusic className="size-4 shrink-0 text-neutral-400" /><h2 className="truncate text-lg font-semibold">节拍推荐</h2></div>{selectedBpm != null && <p className="mt-1 text-xs text-neutral-400">当前推荐 · {selectedBpm} BPM 偏好</p>}</div>
              <Button variant="glass" size="sm" disabled={!radioTracks.length || radioLoading} onClick={() => playTracks(radioTracks)}><Play className="fill-current" /> 播放全部</Button>
            </div>
            {radioError && <ErrorMessage message={radioError} onRetry={requestRadio} disabled={radioLoading} />}
            <TrackList tracks={radioTracks} loading={radioLoading} error={Boolean(radioError)} onPickTrack={onPickTrack} emptyText={selectedBpm == null ? "点击“获取推荐”开始节拍电台" : "这次没有找到推荐歌曲，试试其他 BPM"} />
          </div>
        </>}
      </div>
      <div id={`${tabId}-discover-panel`} role="tabpanel" aria-labelledby={`${tabId}-discover-tab`} hidden={activeTab !== "discover"} className={cn("mt-6 min-h-0 flex-1 flex-col gap-5 overflow-hidden", activeTab === "discover" ? "flex" : "hidden")}>
        {activeTab === "discover" && <>
          {discoveryError && <ErrorMessage message={discoveryError} onRetry={onRetryDiscovery} disabled={discoveryLoading} />}
          {discoveryLoading && !discovery && <div className="flex min-h-40 items-center justify-center text-sm text-neutral-400"><LoaderCircle className="mr-2 size-4 animate-spin" /> 正在加载发现内容</div>}
          {discovery && <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <section className="rounded-[1.25rem] border border-[var(--line)] bg-[var(--surface-muted)]/45 p-4 sm:p-5">
              <div className="flex items-center gap-2"><Sparkles className="size-4 text-[var(--accent)]" /><h2 className="text-lg font-semibold">热搜趋势</h2><span className="text-xs text-neutral-400">点击搜索</span></div>
              <div className="mt-4 flex flex-wrap gap-2">
                {discovery.hotSearches.map((term, index) => <button key={`${term}-${index}`} type="button" className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-sm transition hover:border-[var(--accent)] hover:text-[var(--accent)]" onClick={() => onSearchHot(term)}>{index < 3 && <span className="mr-1.5 text-xs text-[var(--accent)]">0{index + 1}</span>}{term}</button>)}
                {!discovery.hotSearches.length && <p className="text-sm text-neutral-400">暂无热搜数据</p>}
              </div>
            </section>
            <div className="mt-5 grid min-h-0 gap-5 xl:grid-cols-2">
              <DiscoveryPlaylistSection title="实时榜单" icon={<Trophy className="size-4" />} playlists={discovery.rankings} onOpenPlaylist={onOpenPlaylist} emptyText="暂无榜单数据" />
              <DiscoveryPlaylistSection title="歌单广场" icon={<ListMusic className="size-4" />} playlists={discovery.playlists} onOpenPlaylist={onOpenPlaylist} emptyText="暂无歌单数据" />
            </div>
          </div>}
        </>}
      </div>
    </section>
  );
}

function DiscoveryPlaylistSection({
  title,
  icon,
  playlists,
  onOpenPlaylist,
  emptyText,
}: {
  title: string;
  icon: ReactNode;
  playlists: ProviderPlaylist[];
  onOpenPlaylist: (playlist: ProviderPlaylist) => void;
  emptyText: string;
}) {
  return <section className="min-h-0 rounded-[1.25rem] border border-[var(--line)] bg-[var(--surface-muted)]/45 p-4 sm:p-5">
    <div className="flex items-center gap-2"><span className="text-neutral-400">{icon}</span><h2 className="text-lg font-semibold">{title}</h2><span className="text-xs text-neutral-400">{playlists.length} 个</span></div>
    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {playlists.map((playlist) => <button key={playlist.id} type="button" className="group min-w-0 text-left" onClick={() => onOpenPlaylist(playlist)} title={playlist.name}>
        <ArtworkImage src={playlist.coverUrl} alt="" className="aspect-square w-full rounded-xl object-cover shadow-sm transition group-hover:scale-[1.02]" />
        <span className="mt-2 block truncate text-sm font-semibold">{playlist.name}</span>
        <span className="mt-0.5 block truncate text-xs text-neutral-400">{playlist.description || `${playlist.trackCount} 首歌曲`}</span>
      </button>)}
      {!playlists.length && <p className="col-span-full py-6 text-center text-sm text-neutral-400">{emptyText}</p>}
    </div>
  </section>;
}

function TrackList({
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
  const virtual = useVirtualRows({ count: tracks.length, rowHeight: 72, overscan: 8 });
  const firstTrackId = tracks[0]?.id;

  useEffect(() => {
    virtual.containerRef.current?.scrollTo({ top: 0 });
  }, [firstTrackId, virtual.containerRef]);

  return (
    <div ref={virtual.containerRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-2 sm:p-3" aria-busy={loading}>
      {loading && !tracks.length && <div className="flex min-h-40 items-center justify-center text-sm text-neutral-400"><LoaderCircle className="mr-2 size-4 animate-spin" /> 正在加载</div>}
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
            className="group absolute inset-x-0 grid h-[72px] grid-cols-[1.5rem_3.5rem_minmax(0,1fr)_auto_1rem] items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-[var(--surface)]"
            onClick={() => onPickTrack(track.id, tracks)}
          >
            <span className="text-center text-xs text-neutral-400">{index + 1}</span>
            <CoverArt track={track} className="size-12 rounded-xl" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold"><CopyableTrackText track={track} field="title">{track.title}</CopyableTrackText></span>
              <span className="mt-1 block truncate text-xs text-neutral-500"><CopyableTrackText track={track} field="artist">{track.artist}</CopyableTrackText></span>
            </span>
            <span className="hidden max-w-28 truncate text-xs text-neutral-400 sm:block">{formatAudioDetail(track)}</span>
            <ChevronRight className="size-4 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-neutral-600" />
          </button>
          );
        })}
      </div>
    </div>
  );
}

function ErrorMessage({ message, onRetry, disabled }: { message: string; onRetry: () => void; disabled: boolean }) {
  return <div role="alert" className="mx-3 mt-3 flex shrink-0 items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"><p className="min-w-0">{message}</p><Button variant="ghost" size="sm" disabled={disabled} onClick={onRetry}>重试</Button></div>;
}
