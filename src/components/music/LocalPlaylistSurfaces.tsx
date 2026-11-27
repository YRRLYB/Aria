import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, GripVertical, Link2, ListMusic, LoaderCircle, Pencil, Plus, RefreshCw, Search, Sparkles, Trash2, X } from "lucide-react";
import { AriaSelect } from "@/components/ui/aria-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Track } from "@/data/music";
import { api } from "@/lib/api";
import type { LocalPlaylist, LocalPlaylistRemoteRef, PlaylistInsertPosition } from "@/lib/localPlaylists";
import { resolveLocalPlaylistTracks } from "@/lib/localPlaylists";
import { findPlaylistDuplicates } from "@/lib/playlistDedup";
import { providerTrackToUiTrack } from "@/lib/trackMappers";
import { formatAudioDetail } from "@/lib/playerPresentation";
import { useVirtualRows } from "@/lib/virtualRows";
import { PlaylistTrackBrowser, type PickerPlaylistCatalog } from "./PlaylistTrackBrowser";
import { CopyableTrackText, CoverArt, EmptyState } from "./shared";
import { SourceBadge } from "./SourceLogos";
import { useTrackContextMenu } from "./TrackContextMenu";

export type LocalPlaylistSurfaceProps = {
  playlists: LocalPlaylist[];
  allTracks: Track[];
  selectedPlaylist: LocalPlaylist | null;
  selectedTracks: Track[];
  storageError: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  onCreate: (name: string, tracks?: Track[], remoteRef?: LocalPlaylistRemoteRef) => LocalPlaylist;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onAdd: (id: string, tracks: Track[], position?: PlaylistInsertPosition) => void;
  onRemove: (id: string, tracks: Track[]) => void;
  onReorder?: (id: string, orderedTracks: Track[]) => void;
  onSyncReference: (id: string, tracks: Track[], title?: string) => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
  pickerCatalog?: Omit<PickerPlaylistCatalog, "allTracks">;
  headerTabs?: ReactNode;
};

export function LocalPlaylistSurface(props: LocalPlaylistSurfaceProps) {
  if (props.selectedPlaylist) {
    return <LocalPlaylistDetail {...props} playlist={props.selectedPlaylist} />;
  }
  return <LocalPlaylistGallery {...props} />;
}

function LocalPlaylistGallery({
  playlists,
  allTracks,
  storageError,
  onOpen,
  onCreate,
  onDelete,
  headerTabs,
}: LocalPlaylistSurfaceProps) {
  const [name, setName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const confirm = useConfirm();
  const fileTracks = useMemo(() => allTracks, [allTracks]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const created = onCreate(name);
    setName("");
    setCreateOpen(false);
    onOpen(created.id);
  }

  return (
    <div className="aria-page-shell no-scrollbar h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-7">
      <div className="aria-page-header flex items-center justify-between gap-4 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Aria 歌单</h1>
          <p className="mt-1 text-xs text-neutral-500">保存在这台电脑的自建歌单，可自由添加本地与各音源曲目。</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" onClick={() => setCreateOpen((current) => !current)} aria-expanded={createOpen} aria-controls="create-local-playlist-form">
            <Plus />新建
          </Button>
        </div>
      </div>
      {headerTabs}
      {storageError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">浏览器存储空间不足，本次修改可能无法在重启后保留。</p>}
      {createOpen && (
        <form id="create-local-playlist-form" className="aria-flat-well mt-4 flex flex-col gap-3 rounded-2xl p-4 sm:flex-row" onSubmit={submit}>
          <input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：深夜歌单、通勤路上、周末循环" aria-label="Aria 歌单名称" className="aria-flat-input min-w-0 flex-1 rounded-xl px-4 py-2.5 text-sm outline-none" />
          <Button type="submit" size="sm" disabled={!name.trim()}>创建并添加歌曲</Button>
        </form>
      )}
      <div className="mt-5 grid gap-3.5 md:grid-cols-3">
        {playlists.map((playlist) => {
          const coverTrack = resolveLocalPlaylistTracks(playlist, fileTracks)[0];
          return (
            <div key={playlist.id} className="group relative">
              <button type="button" className="aria-flat-tile flex h-full w-full flex-col rounded-2xl p-4 text-left" onClick={() => onOpen(playlist.id)}>
                {coverTrack ? <CoverArt track={coverTrack} className="size-14 rounded-xl" /> : <span className="flex size-14 items-center justify-center rounded-xl bg-violet-100 text-violet-600"><ListMusic className="size-6" /></span>}
                <h2 className="mt-5 line-clamp-2 break-words pr-8 text-lg font-semibold leading-snug">{playlist.name}</h2>
                <div className="mt-2 flex items-center justify-between gap-2 text-xs text-neutral-500">
                  <span>{playlist.trackIds.length} 首</span>
                  <span>{playlist.remoteRef ? "B站同步歌单" : "Aria 歌单"}</span>
                </div>
              </button>
              <button
                type="button"
                aria-label={`删除 Aria 歌单 ${playlist.name}`}
                title="删除歌单（不会删除音频文件）"
                className="absolute right-4 top-4 z-10 flex size-9 items-center justify-center rounded-full bg-white/90 text-neutral-400 opacity-0 shadow-sm ring-1 ring-black/5 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  void (async () => {
                    if (await confirm({ title: `删除 Aria 歌单“${playlist.name}”？`, description: "音频文件不会被删除。", confirmLabel: "删除歌单", tone: "danger" })) {
                      onDelete(playlist.id);
                    }
                  })();
                }}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
      {!playlists.length && <EmptyState text={fileTracks.length ? "还没有 Aria 歌单。点击“新建”，然后从本地或在线曲库中挑选歌曲。" : "先扫描本地文件夹或登录在线音源，再创建只属于你的 Aria 歌单。"} />}
    </div>
  );
}

export function LocalPlaylistDetail({
  playlists,
  playlist,
  allTracks,
  selectedTracks,
  onClose,
  onRename,
  onDelete,
  onAdd,
  onRemove,
  onReorder,
  onSyncReference,
  onPickTrack,
  pickerCatalog,
  backLabel = "返回 Aria 歌单",
}: LocalPlaylistSurfaceProps & { playlist: LocalPlaylist; backLabel?: string }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(playlist.name);
  const confirm = useConfirm();
  const trackMenu = useTrackContextMenu();
  const draggedId = useRef<string | null>(null);
  const virtual = useVirtualRows({ count: selectedTracks.length, rowHeight: 80, overscan: 8 });
  const selectedIds = useMemo(() => new Set(playlist.trackIds), [playlist.trackIds]);
  const dedup = useMemo(() => findPlaylistDuplicates(selectedTracks), [selectedTracks]);

  function moveTrack(trackId: string, destination: number) {
    if (!onReorder) return;
    const from = selectedTracks.findIndex((track) => track.id === trackId);
    if (from < 0 || destination < 0 || destination >= selectedTracks.length || from === destination) return;
    const next = [...selectedTracks];
    const [moving] = next.splice(from, 1);
    next.splice(destination, 0, moving);
    onReorder(playlist.id, next);
  }

  async function syncReference() {
    if (!playlist.remoteRef || syncing) return;
    setSyncing(true);
    setSyncError(null);
    try {
      const resolved = await api.resolveSourceLink("bilibili", playlist.remoteRef.url);
      onSyncReference(
        playlist.id,
        resolved.tracks.map((track, index) => providerTrackToUiTrack(track, index)),
        resolved.title,
      );
    } catch (reason) {
      setSyncError(reason instanceof Error ? reason.message : "同步B站歌单失败，请稍后重试");
    } finally {
      setSyncing(false);
    }
  }

  function saveName() {
    if (name.trim()) onRename(playlist.id, name);
    else setName(playlist.name);
    setRenaming(false);
  }

  return (
    <div className="aria-page-shell flex h-full min-h-[620px] flex-col overflow-hidden rounded-[1.5rem] p-5 sm:p-7">
      <div className="aria-page-header flex shrink-0 flex-col gap-4 pb-4">
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={onClose}><ArrowLeft />{backLabel}</Button>
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            {selectedTracks[0] ? <CoverArt track={selectedTracks[0]} className="size-20 shrink-0 rounded-2xl" /> : <span className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-600"><ListMusic /></span>}
            <div className="min-w-0">
              {renaming ? (
                <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); saveName(); }}>
                  <input autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} aria-label="重命名 Aria 歌单" className="aria-flat-input min-w-0 rounded-xl px-3 py-1.5 text-xl font-semibold outline-none" />
                  <Button type="submit" size="sm">保存</Button>
                </form>
              ) : (
                <button type="button" className="flex max-w-full items-center gap-2 text-left" title="重命名歌单" onClick={() => { setName(playlist.name); setRenaming(true); }}>
                  <h1 className="break-words text-2xl font-semibold sm:text-3xl">{playlist.name}</h1><Pencil className="size-4 shrink-0 text-neutral-400" />
                </button>
              )}
              <p className="mt-1.5 text-xs text-neutral-500">{playlist.remoteRef ? "引用自B站 · 可同步" : "本机歌单"} · {selectedTracks.length} 首可播放{playlist.trackIds.length !== selectedTracks.length ? ` · ${playlist.trackIds.length - selectedTracks.length} 首文件暂不可用` : ""}{playlist.remoteRef?.syncedAt ? ` · 上次同步 ${new Date(playlist.remoteRef.syncedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" onClick={() => setPickerOpen(true)}><Plus />添加歌曲</Button>
            {dedup.removableTracks.length > 0 && (
              <Button
                variant="glass"
                size="sm"
                title="保留高音质版本，移除重复曲目（支持 10 秒撤销）"
                onClick={() => onRemove(playlist.id, dedup.removableTracks)}
              >
                <Sparkles />
                去重 ({dedup.removableTracks.length})
              </Button>
            )}
            {playlist.remoteRef && (
              <Button variant="glass" size="sm" onClick={() => void syncReference()} disabled={syncing}>
                {syncing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                {syncing ? "同步中" : "刷新B站歌单"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              aria-label="删除 Aria 歌单"
              title="删除歌单（不会删除音频文件）"
              onClick={() => {
                void (async () => {
                  if (await confirm({ title: `删除 Aria 歌单“${playlist.name}”？`, description: "音频文件不会被删除。", confirmLabel: "删除歌单", tone: "danger" })) {
                    onDelete(playlist.id);
                  }
                })();
              }}
            >
              <Trash2 />删除歌单
            </Button>
          </div>
        </div>
        {syncError && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{syncError}</p>}
      </div>
      <div ref={virtual.containerRef} className="no-scrollbar mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="relative" style={{ height: virtual.totalHeight }}>
          {virtual.rows.map(({ index, offsetTop }) => {
            const track = selectedTracks[index];
            if (!track) return null;
            return (
              <div
                key={track.id}
                role="button"
                tabIndex={0}
                draggable={Boolean(onReorder)}
                onDragStart={(event) => {
                  draggedId.current = track.id;
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", track.id);
                }}
                onDragEnd={() => { draggedId.current = null; }}
                onDragOver={(event) => {
                  if (onReorder && draggedId.current) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedId.current) moveTrack(draggedId.current, index);
                  draggedId.current = null;
                }}
                onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onPickTrack(track.id, selectedTracks); } }}
                className="aria-flat-row absolute inset-x-0 grid h-[4.5rem] grid-cols-[2rem_3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2.5 text-left"
                style={{ top: offsetTop }}
                data-track-context-row="true"
                onClick={() => onPickTrack(track.id, selectedTracks)}
                onContextMenu={(event) => trackMenu?.open(event, track, selectedTracks)}
              >
                {onReorder ? (
                  <span className="flex items-center justify-center text-neutral-400" title="拖动调整顺序">
                    <GripVertical className="size-4 cursor-grab" />
                  </span>
                ) : (
                  <span className="text-center text-sm text-neutral-400">{index + 1}</span>
                )}
                <CoverArt track={track} className="size-12 rounded-xl" />
                <div className="min-w-0">
                  <p className="truncate font-semibold" title={track.title}><CopyableTrackText track={track} field="title">{track.title}</CopyableTrackText></p>
                  <p className="truncate text-sm text-neutral-500" title={`${track.artist} · ${track.album}`}>{track.artist} · {track.album}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <SourceBadge source={track.source} compact />
                  <Badge className="hidden shrink-0 whitespace-nowrap md:inline-flex">{formatAudioDetail(track)}</Badge>
                  <span className="hidden shrink-0 text-sm tabular-nums text-neutral-500 sm:inline">{track.duration}</span>
                  {onReorder && (
                    <>
                      <Button variant="ghost" size="icon" title="上移" aria-label={`上移 ${track.title}`} disabled={index === 0} onClick={(event) => { event.stopPropagation(); moveTrack(track.id, index - 1); }}><ArrowUp className="size-3.5" /></Button>
                      <Button variant="ghost" size="icon" title="下移" aria-label={`下移 ${track.title}`} disabled={index === selectedTracks.length - 1} onClick={(event) => { event.stopPropagation(); moveTrack(track.id, index + 1); }}><ArrowDown className="size-3.5" /></Button>
                    </>
                  )}
                  <Button variant="ghost" size="icon" aria-label={`从歌单移除 ${track.title}`} onClick={(event) => { event.stopPropagation(); onRemove(playlist.id, [track]); }}><X /></Button>
                </div>
              </div>
            );
          })}
        </div>
        {!selectedTracks.length && <EmptyState text="歌单还是空的。点击“添加歌曲”，可从其他歌单或曲库中可视化挑选。" />}
      </div>
      {pickerOpen && (
        <LocalTrackPickerDialog
          tracks={allTracks}
          existingIds={selectedIds}
          currentPlaylistId={playlist.id}
          localPlaylists={playlists}
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

export function BilibiliLinkDialog({ onClose, onAdd, onReference, mode = "add" }: {
  onClose: () => void;
  onAdd?: (tracks: Track[]) => void;
  onReference?: (resolved: { url: string; kind: "folder" | "playlist"; title?: string; tracks: Track[] }) => void;
  mode?: "add" | "reference";
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; kind: "video" | "folder" | "playlist"; title?: string; tracks: Track[] } | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  async function resolve() {
    const value = url.trim();
    if (!value || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const resolved = await api.resolveSourceLink("bilibili", value);
      setResult({
        url: value,
        kind: resolved.kind,
        title: resolved.title,
        tracks: resolved.tracks.map((track, index) => providerTrackToUiTrack(track, index)),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "解析B站链接失败，请检查链接后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="bilibili-link-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="fixed inset-0 m-auto flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-black/25 p-4 backdrop-blur-sm backdrop:bg-transparent"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section className="w-full max-w-lg rounded-3xl border border-white/70 bg-[#faf9fd] p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="bilibili-link-title" className="text-xl font-semibold">{mode === "reference" ? "引用B站歌单" : "从B站链接添加"}</h2>
            <p className="mt-1 text-sm text-neutral-500">
              {mode === "reference"
                ? "粘贴别人的公开收藏夹或合集链接，创建可随时刷新的同步歌单。"
                : "支持视频链接、BV 号、收藏夹/合集链接。收藏夹也可以粘贴别人的公开链接。"}
            </p>
          </div>
          <Button variant="ghost" size="icon" aria-label="关闭B站链接导入" onClick={onClose}><X /></Button>
        </div>
        <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); void resolve(); }}>
          <input
            autoFocus
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.bilibili.com/video/BV... 或收藏夹链接"
            aria-label="B站链接"
            className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-violet-400"
          />
          <Button type="submit" disabled={!url.trim() || loading}>
            {loading ? <LoaderCircle className="animate-spin" /> : <Link2 />}
            {loading ? "解析中" : "解析"}
          </Button>
        </form>
        {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}
        {result && (
          <div className="mt-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold" title={result.title}>{result.title ?? (result.kind === "video" ? "B站视频" : "B站收藏夹")}</p>
                <p className="mt-1 text-xs text-neutral-500">
                  {result.kind === "video" ? "单个视频" : "收藏夹"} · {result.tracks.length} 首
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {onAdd && (
                  <Button size="sm" variant="glass" onClick={() => onAdd(result.tracks)}>加入歌单</Button>
                )}
                {onReference && result.kind !== "video" && (
                  <Button
                    size="sm"
                    onClick={() => onReference({ url: result.url, kind: result.kind as "folder" | "playlist", title: result.title, tracks: result.tracks })}
                  >
                    <RefreshCw />引用并同步
                  </Button>
                )}
              </div>
            </div>
            <div className="mt-3 max-h-40 space-y-1 overflow-y-auto pr-1">
              {result.tracks.slice(0, 8).map((track) => (
                <p key={track.id} className="truncate text-xs text-neutral-500">{track.title} · {track.artist}</p>
              ))}
              {result.tracks.length > 8 && <p className="text-xs text-neutral-400">还有 {result.tracks.length - 8} 首…</p>}
            </div>
          </div>
        )}
        <p className="mt-4 text-[11px] leading-5 text-neutral-400">
          收藏夹必须公开，或先在设置里登录B站；私密收藏夹只有登录账号能读取。
        </p>
      </section>
    </dialog>
  );
}

const INSERT_POSITION_STORAGE_KEY = "aria-playlist-insert-position";

function readPreferredInsertPosition(): PlaylistInsertPosition {
  try {
    return window.localStorage.getItem(INSERT_POSITION_STORAGE_KEY) === "bottom" ? "bottom" : "top";
  } catch {
    return "top";
  }
}

export function LocalTrackPickerDialog({
  tracks,
  existingIds,
  currentPlaylistId,
  localPlaylists,
  pickerCatalog,
  onClose,
  onAdd,
}: {
  tracks: Track[];
  existingIds: Set<string>;
  currentPlaylistId: string;
  localPlaylists: LocalPlaylist[];
  pickerCatalog?: Omit<PickerPlaylistCatalog, "allTracks">;
  onClose: () => void;
  onAdd: (tracks: Track[], position: PlaylistInsertPosition) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<Track[]>([]);
  const [insertPosition, setInsertPosition] = useState<PlaylistInsertPosition>(readPreferredInsertPosition);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function updateInsertPosition(next: PlaylistInsertPosition) {
    setInsertPosition(next);
    try {
      window.localStorage.setItem(INSERT_POSITION_STORAGE_KEY, next);
    } catch {
      // Best-effort preference persistence.
    }
  }

  return (
    <dialog ref={dialogRef} aria-labelledby="local-track-picker-title" onCancel={(event) => { event.preventDefault(); onClose(); }} className="fixed inset-0 m-auto flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-black/25 p-4 backdrop-blur-sm backdrop:bg-transparent" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="flex h-[82vh] max-h-[780px] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/70 bg-[#faf9fd] p-5 shadow-2xl sm:p-6">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <div>
            <h2 id="local-track-picker-title" className="text-xl font-semibold">添加歌曲到歌单</h2>
            <p className="mt-1 text-xs text-neutral-500">可从其他歌单、已有曲库或跨源搜索中可视化挑选，点击顺序即为加入顺序。</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="关闭选歌窗口" onClick={onClose}><X /></Button>
        </div>
        <PlaylistTrackBrowser
          mode="all"
          excludePlaylistId={currentPlaylistId}
          existingIds={existingIds}
          catalog={{
            ...pickerCatalog,
            localPlaylists: pickerCatalog?.localPlaylists ?? localPlaylists,
            allTracks: tracks,
          }}
          selected={selected}
          onSelectedChange={setSelected}
          insertPosition={insertPosition}
          onInsertPositionChange={updateInsertPosition}
        />
        <div className="mt-4 flex shrink-0 items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" disabled={!selected.length} onClick={() => onAdd(selected, insertPosition)}>
            <Plus />
            {insertPosition === "top" ? `插到顶部 (${selected.length} 首)` : `追加末尾 (${selected.length} 首)`}
          </Button>
        </div>
      </section>
    </dialog>
  );
}

export function AddToLocalPlaylistDialog({ tracks, playlists, onClose, onCreate, onAdd }: {
  tracks: Track[];
  playlists: LocalPlaylist[];
  onClose: () => void;
  onCreate: (name: string, tracks?: Track[]) => LocalPlaylist;
  onAdd: (id: string, tracks: Track[]) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [playlistId, setPlaylistId] = useState(playlists[0]?.id ?? "");
  const [newName, setNewName] = useState("");
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function addTo(id: string) {
    if (!id) return;
    onAdd(id, tracks);
    onClose();
  }

  return (
    <dialog ref={dialogRef} aria-labelledby="add-local-playlist-title" onCancel={(event) => { event.preventDefault(); onClose(); }} className="fixed inset-0 m-auto flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-black/25 p-4 backdrop-blur-sm backdrop:bg-transparent" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="w-full max-w-md rounded-3xl border border-white/70 bg-[#faf9fd] p-6 shadow-2xl">
        <div className="flex items-center justify-between"><h2 id="add-local-playlist-title" className="text-xl font-semibold">加入 Aria 歌单</h2><Button variant="ghost" size="icon" aria-label="关闭" onClick={onClose}><X /></Button></div>
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-white p-3"><CoverArt track={tracks[0]} className="size-12 rounded-xl" /><div className="min-w-0"><p className="truncate text-sm font-semibold">{tracks[0]?.title}</p><p className="text-xs text-neutral-500">{tracks.length > 1 ? `等 ${tracks.length} 首歌曲` : tracks[0]?.artist}</p></div></div>
        {playlists.length > 0 && <div className="mt-5"><label htmlFor="local-target-playlist" className="text-sm font-medium">目标歌单</label><div className="mt-2 flex gap-2"><AriaSelect id="local-target-playlist" ariaLabel="目标歌单" value={playlistId} onChange={setPlaylistId} className="min-w-0 flex-1" options={playlists.map((playlist) => ({ value: playlist.id, label: `${playlist.name}（${playlist.trackIds.length} 首）` }))} /><Button size="sm" disabled={!playlistId} onClick={() => addTo(playlistId)}>加入</Button></div></div>}
        <form className="mt-5" onSubmit={(event) => { event.preventDefault(); if (!newName.trim()) return; const created = onCreate(newName); addTo(created.id); }}><label htmlFor="new-local-target-playlist" className="text-sm font-medium">或新建 Aria 歌单</label><div className="mt-2 flex gap-2"><input id="new-local-target-playlist" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={80} placeholder="新歌单名称" className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none" /><Button type="submit" size="sm" variant="glass" disabled={!newName.trim()}>新建并加入</Button></div></form>
        <p className="mt-4 text-xs text-neutral-500">歌单仅保存歌曲引用，不会复制或修改音频文件，也不会上传网易云。</p>
      </section>
    </dialog>
  );
}
