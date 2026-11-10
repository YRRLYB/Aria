import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ListMusic, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Track } from "@/data/music";
import { createLocalTrackSearchIndex, searchLocalTrackIndex } from "@/lib/localSearch";
import type { LocalPlaylist } from "@/lib/localPlaylists";
import { resolveLocalPlaylistTracks } from "@/lib/localPlaylists";
import { sourceLabel } from "@/lib/trackLabels";
import { useVirtualRows } from "@/lib/virtualRows";
import { cn } from "@/lib/utils";
import { CoverArt, EmptyState } from "./shared";

export type LocalPlaylistSurfaceProps = {
  playlists: LocalPlaylist[];
  allTracks: Track[];
  selectedPlaylist: LocalPlaylist | null;
  selectedTracks: Track[];
  storageError: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  onCreate: (name: string, tracks?: Track[]) => LocalPlaylist;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onAdd: (id: string, tracks: Track[]) => void;
  onRemove: (id: string, tracks: Track[]) => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
};

export function LocalPlaylistSurface(props: LocalPlaylistSurfaceProps & { onOpenNetease: () => void }) {
  if (props.selectedPlaylist) {
    return <LocalPlaylistDetail {...props} playlist={props.selectedPlaylist} />;
  }
  return <LocalPlaylistGallery {...props} />;
}

function SourceTabs({ onOpenNetease }: { onOpenNetease: () => void }) {
  return (
    <div className="flex w-fit rounded-full border border-white/70 bg-white/52 p-1 shadow-sm" aria-label="歌单来源">
      <button type="button" className="rounded-full px-4 py-2 text-sm font-medium text-neutral-500 transition hover:bg-white" onClick={onOpenNetease}>网易云</button>
      <button type="button" aria-current="page" className="rounded-full bg-neutral-950 px-4 py-2 text-sm font-medium text-white">本地</button>
    </div>
  );
}

function LocalPlaylistGallery({
  playlists,
  allTracks,
  storageError,
  onOpen,
  onCreate,
  onDelete,
  onOpenNetease,
}: LocalPlaylistSurfaceProps & { onOpenNetease: () => void }) {
  const [name, setName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
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
    <div className="glass no-scrollbar h-full min-h-[620px] overflow-y-auto rounded-[1.5rem] p-5 sm:p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Badge>Aria playlist</Badge>
          <h1 className="mt-5 text-4xl font-semibold sm:text-6xl">Aria 歌单</h1>
          <p className="mt-3 text-neutral-500">保存在这台电脑，可混合本地、网易云、QQ 音乐和 B站歌曲。</p>
        </div>
        <Button onClick={() => setCreateOpen((current) => !current)} aria-expanded={createOpen} aria-controls="create-local-playlist-form">
          <Plus />新建
        </Button>
      </div>
      <div className="mt-6"><SourceTabs onOpenNetease={onOpenNetease} /></div>
      {storageError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-600">浏览器存储空间不足，本次修改可能无法在重启后保留。</p>}
      {createOpen && (
        <form id="create-local-playlist-form" className="mt-5 flex flex-col gap-3 rounded-2xl border border-white/70 bg-white/65 p-4 sm:flex-row" onSubmit={submit}>
          <input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：深夜歌单、通勤路上、周末循环" aria-label="Aria 歌单名称" className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm outline-none focus:border-violet-300" />
          <Button type="submit" size="sm" disabled={!name.trim()}>创建并添加歌曲</Button>
        </form>
      )}
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {playlists.map((playlist) => {
          const coverTrack = resolveLocalPlaylistTracks(playlist, fileTracks)[0];
          return (
            <div key={playlist.id} className="group relative min-h-48">
              <button type="button" className="h-full min-h-48 w-full overflow-hidden rounded-[1.75rem] bg-white/52 p-5 text-left shadow-sm transition hover:-translate-y-1 hover:bg-white" onClick={() => onOpen(playlist.id)}>
                {coverTrack ? <CoverArt track={coverTrack} className="size-16 rounded-2xl shadow-sm" /> : <span className="flex size-16 items-center justify-center rounded-2xl bg-violet-100 text-violet-600"><ListMusic className="size-7" /></span>}
                <h2 className="mt-8 break-words pr-10 text-2xl font-semibold">{playlist.name}</h2>
                <p className="mt-2 text-sm text-neutral-500">{playlist.trackIds.length} 首</p>
                <Badge className="mt-5">Aria 歌单</Badge>
              </button>
              <button
                type="button"
                aria-label={`删除 Aria 歌单 ${playlist.name}`}
                title="删除歌单（不会删除音频文件）"
                className="absolute right-4 top-4 z-10 flex size-9 items-center justify-center rounded-full bg-white/90 text-neutral-400 opacity-0 shadow-sm ring-1 ring-black/5 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  if (window.confirm(`删除 Aria 歌单“${playlist.name}”？音频文件不会被删除。`)) onDelete(playlist.id);
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

function LocalPlaylistDetail({
  playlist,
  allTracks,
  selectedTracks,
  onClose,
  onRename,
  onDelete,
  onAdd,
  onRemove,
  onPickTrack,
  onOpenNetease,
}: LocalPlaylistSurfaceProps & { playlist: LocalPlaylist; onOpenNetease: () => void }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(playlist.name);
  const virtual = useVirtualRows({ count: selectedTracks.length, rowHeight: 80, overscan: 8 });
  const selectedIds = useMemo(() => new Set(playlist.trackIds), [playlist.trackIds]);

  function saveName() {
    if (name.trim()) onRename(playlist.id, name);
    else setName(playlist.name);
    setRenaming(false);
  }

  return (
    <div className="glass flex h-full min-h-[620px] flex-col overflow-hidden rounded-[1.5rem] p-5 sm:p-8">
      <div className="flex shrink-0 flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={onClose}><ArrowLeft />返回 Aria 歌单</Button>
          <SourceTabs onOpenNetease={onOpenNetease} />
        </div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            {selectedTracks[0] ? <CoverArt track={selectedTracks[0]} className="size-20 shrink-0 rounded-2xl shadow-md" /> : <span className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-600"><ListMusic /></span>}
            <div className="min-w-0">
              <Badge>仅保存在本机</Badge>
              {renaming ? (
                <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); saveName(); }}>
                  <input autoFocus maxLength={80} value={name} onChange={(event) => setName(event.target.value)} aria-label="重命名 Aria 歌单" className="min-w-0 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xl font-semibold outline-none" />
                  <Button type="submit" size="sm">保存</Button>
                </form>
              ) : (
                <button type="button" className="mt-2 flex max-w-full items-center gap-2 text-left" title="重命名歌单" onClick={() => { setName(playlist.name); setRenaming(true); }}>
                  <h1 className="break-words text-3xl font-semibold sm:text-4xl">{playlist.name}</h1><Pencil className="size-4 shrink-0 text-neutral-400" />
                </button>
              )}
              <p className="mt-2 text-sm text-neutral-500">{selectedTracks.length} 首可播放{playlist.trackIds.length !== selectedTracks.length ? ` · ${playlist.trackIds.length - selectedTracks.length} 首文件暂不可用` : ""}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button onClick={() => setPickerOpen(true)}><Plus />添加歌曲</Button>
            <Button variant="ghost" size="sm" aria-label="删除 Aria 歌单" title="删除歌单（不会删除音频文件）" onClick={() => { if (window.confirm(`删除 Aria 歌单“${playlist.name}”？音频文件不会被删除。`)) onDelete(playlist.id); }}><Trash2 />删除歌单</Button>
          </div>
        </div>
      </div>
      <div ref={virtual.containerRef} className="no-scrollbar mt-6 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="relative" style={{ height: virtual.totalHeight }}>
          {virtual.rows.map(({ index, offsetTop }) => {
            const track = selectedTracks[index];
            if (!track) return null;
            return (
              <div key={track.id} role="button" tabIndex={0} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onPickTrack(track.id, selectedTracks); } }} className="absolute inset-x-0 grid h-[4.5rem] grid-cols-[2rem_3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl bg-white/52 p-2.5 text-left shadow-sm transition hover:bg-white" style={{ top: offsetTop }} onClick={() => onPickTrack(track.id, selectedTracks)}>
                <span className="text-center text-sm text-neutral-400">{index + 1}</span>
                <CoverArt track={track} className="size-12 rounded-xl" />
                <div className="min-w-0">
                  <p className="truncate font-semibold" title={track.title}>{track.title}</p>
                  <p className="truncate text-sm text-neutral-500" title={`${track.artist} · ${track.album}`}>{track.artist} · {track.album} <span className="text-neutral-400">· {sourceLabel[track.source]}</span></p>
                </div>
                <div className="flex items-center gap-2"><span className="hidden text-sm text-neutral-500 sm:inline">{track.duration}</span><Button variant="ghost" size="icon" aria-label={`从歌单移除 ${track.title}`} onClick={(event) => { event.stopPropagation(); onRemove(playlist.id, [track]); }}><X /></Button></div>
              </div>
            );
          })}
        </div>
        {!selectedTracks.length && <EmptyState text="歌单还是空的。点击“添加歌曲”，可从本地和在线曲库中挑选。" />}
      </div>
      {pickerOpen && <LocalTrackPickerDialog tracks={allTracks} existingIds={selectedIds} onClose={() => setPickerOpen(false)} onAdd={(tracks) => { onAdd(playlist.id, tracks); setPickerOpen(false); }} />}
    </div>
  );
}

function LocalTrackPickerDialog({ tracks, existingIds, onClose, onAdd }: {
  tracks: Track[];
  existingIds: Set<string>;
  onClose: () => void;
  onAdd: (tracks: Track[]) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const availableTracks = tracks;
  const searchIndex = useMemo(() => createLocalTrackSearchIndex(availableTracks), [availableTracks]);
  const visibleTracks = useMemo(() => query.trim() ? searchLocalTrackIndex(availableTracks, searchIndex, query, availableTracks.length) : availableTracks, [availableTracks, query, searchIndex]);
  const virtual = useVirtualRows({ count: visibleTracks.length, rowHeight: 68, overscan: 8 });

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function toggle(track: Track) {
    if (existingIds.has(track.id)) return;
    setPending((current) => {
      const next = new Set(current);
      if (next.has(track.id)) next.delete(track.id);
      else next.add(track.id);
      return next;
    });
  }

  return (
    <dialog ref={dialogRef} aria-labelledby="local-track-picker-title" onCancel={(event) => { event.preventDefault(); onClose(); }} className="fixed inset-0 m-auto flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-black/25 p-4 backdrop-blur-sm backdrop:bg-transparent" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="flex h-[78vh] max-h-[760px] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/70 bg-[#faf9fd] p-5 shadow-2xl sm:p-6">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <div><h2 id="local-track-picker-title" className="text-xl font-semibold">添加歌曲</h2><p className="mt-1 text-sm text-neutral-500">浏览全部 {availableTracks.length} 首歌曲，点击可多选。</p></div>
          <Button variant="ghost" size="icon" aria-label="关闭选歌窗口" onClick={onClose}><X /></Button>
        </div>
        <label className="mt-4 flex shrink-0 items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2.5 focus-within:border-violet-400">
          <Search className="size-4 shrink-0 text-neutral-400" />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索歌名、歌手、专辑或音质" aria-label="搜索歌曲" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
          {query && <button type="button" aria-label="清空搜索" onClick={() => setQuery("")}><X className="size-4 text-neutral-400" /></button>}
        </label>
        <p className="mt-2 shrink-0 text-xs text-neutral-500">{query.trim() ? `找到 ${visibleTracks.length} 首` : "全部歌曲"} · 已选择 {pending.size} 首</p>
        <div ref={virtual.containerRef} className="no-scrollbar mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="relative" style={{ height: virtual.totalHeight }}>
            {virtual.rows.map(({ index, offsetTop }) => {
              const track = visibleTracks[index];
              if (!track) return null;
              const existing = existingIds.has(track.id);
              const checked = existing || pending.has(track.id);
              return (
                <button type="button" key={track.id} disabled={existing} aria-pressed={checked} onClick={() => toggle(track)} className={cn("absolute inset-x-0 grid h-16 grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl bg-white px-3 py-2 text-left transition hover:bg-violet-50 disabled:opacity-60", checked && "bg-violet-50")} style={{ top: offsetTop }}>
                  <CoverArt track={track} className="size-11 rounded-lg" />
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold" title={track.title}>{track.title}</span><span className="block truncate text-xs text-neutral-500" title={`${track.artist} · ${track.album}`}>{track.artist} · {track.album} · {sourceLabel[track.source]}</span></span>
                  <span className="flex items-center gap-2 text-xs text-neutral-500">{existing && "已添加"}<span className={cn("flex size-5 items-center justify-center rounded border", checked ? "border-violet-500 bg-violet-500 text-white" : "border-neutral-300")}>{checked && <Check className="size-3" />}</span></span>
                </button>
              );
            })}
          </div>
          {!visibleTracks.length && <EmptyState text={availableTracks.length ? "没有找到相关歌曲，换个关键词试试。" : "曲库为空，请先扫描本地文件夹或登录在线音源。"} />}
        </div>
        <div className="mt-4 flex shrink-0 items-center justify-between gap-3">
          {pending.size > 0 && <button type="button" className="text-sm text-violet-600" onClick={() => setPending(new Set())}>清空选择</button>}
          <div className="ml-auto flex gap-2"><Button variant="ghost" size="sm" onClick={onClose}>取消</Button><Button size="sm" disabled={!pending.size} onClick={() => onAdd(availableTracks.filter((track) => pending.has(track.id)))}><Plus />加入 {pending.size} 首</Button></div>
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
        {playlists.length > 0 && <div className="mt-5"><label htmlFor="local-target-playlist" className="text-sm font-medium">目标歌单</label><div className="mt-2 flex gap-2"><select id="local-target-playlist" value={playlistId} onChange={(event) => setPlaylistId(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm">{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}（{playlist.trackIds.length} 首）</option>)}</select><Button size="sm" disabled={!playlistId} onClick={() => addTo(playlistId)}>加入</Button></div></div>}
        <form className="mt-5" onSubmit={(event) => { event.preventDefault(); if (!newName.trim()) return; const created = onCreate(newName); addTo(created.id); }}><label htmlFor="new-local-target-playlist" className="text-sm font-medium">或新建 Aria 歌单</label><div className="mt-2 flex gap-2"><input id="new-local-target-playlist" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={80} placeholder="新歌单名称" className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none" /><Button type="submit" size="sm" variant="glass" disabled={!newName.trim()}>新建并加入</Button></div></form>
        <p className="mt-4 text-xs text-neutral-500">歌单仅保存歌曲引用，不会复制或修改音频文件，也不会上传网易云。</p>
      </section>
    </dialog>
  );
}
