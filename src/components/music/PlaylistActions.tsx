import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ListPlus, LoaderCircle, Search, X } from "lucide-react";
import type { Track } from "@/data/music";
import { api, type ProviderPlaylist } from "@/lib/api";
import { providerTrackToUiTrack } from "@/lib/trackMappers";
import { Button } from "@/components/ui/button";
import { CoverArt, EmptyState } from "./shared";

const PlaylistActionsContext = createContext<{ openAdd: (tracks: Track[], playlistId?: string) => void } | null>(null);

export function PlaylistActionsProvider({ openAdd, children }: { openAdd: (tracks: Track[], playlistId?: string) => void; children: ReactNode }) {
  return <PlaylistActionsContext.Provider value={{ openAdd }}>{children}</PlaylistActionsContext.Provider>;
}

export function usePlaylistActions() { return useContext(PlaylistActionsContext); }

export function AddToPlaylistButton({ track, compact = true }: { track: Track; compact?: boolean }) {
  const actions = usePlaylistActions();
  if (!actions || track.source !== "netease") return null;
  return <Button type="button" variant="ghost" size={compact ? "icon" : "sm"} aria-label={`将 ${track.title} 加入歌单`} title="加入歌单" onClick={(event) => {
    event.stopPropagation();
    actions.openAdd([track]);
  }}><ListPlus />{!compact && "加入歌单"}</Button>;
}

export function AddToPlaylistDialog({ initialTracks, initialPlaylistId, playlists, connected, onClose, onRequireLogin, onAdd, onCreate }: {
  initialTracks: Track[];
  initialPlaylistId?: string;
  playlists: ProviderPlaylist[];
  connected: boolean;
  onClose: () => void;
  onRequireLogin: () => void;
  onAdd: (playlistId: string, tracks: Track[]) => Promise<void>;
  onCreate: (name: string, isPrivate: boolean) => Promise<ProviderPlaylist>;
}) {
  const ownedPlaylists = playlists.filter((playlist) => playlist.owned === true);
  const [playlistId, setPlaylistId] = useState(initialPlaylistId ?? ownedPlaylists[0]?.id ?? "");
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const [selected, setSelected] = useState<Track[]>(initialTracks.filter((track) => track.source === "netease"));
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectedIds = new Set(selected.map((track) => track.id));

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    if (!keyword.trim()) { setResults([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    setError(null);
    const timer = window.setTimeout(() => {
      api.searchLibraryAndStream(keyword.trim(), 30, "tracks").then((result) => {
        if (!cancelled) setResults(result.neteaseTracks.map(providerTrackToUiTrack));
      }).catch((reason: unknown) => {
        if (!cancelled) { setResults([]); setError(reason instanceof Error ? reason.message : "搜索失败，请重试"); }
      }).finally(() => { if (!cancelled) setSearching(false); });
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [keyword]);

  async function submit() {
    if (!connected || busyRef.current || !selected.length || (!playlistId && !createOpen)) return;
    busyRef.current = true;
    setSaving(true);
    setError(null);
    try {
      let targetId = playlistId;
      if (createOpen) {
        const created = await onCreate(newName.trim(), false);
        targetId = created.id;
        setPlaylistId(targetId);
        setCreateOpen(false);
      }
      await onAdd(targetId, selected);
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "加入歌单失败，请重试"); }
    finally { busyRef.current = false; setSaving(false); }
  }

  return <dialog ref={dialogRef} aria-labelledby="add-playlist-title" onCancel={(event) => { event.preventDefault(); if (!busyRef.current) onClose(); }} className="fixed inset-0 m-auto flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-black/25 p-8 backdrop-blur-sm backdrop:bg-transparent" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="add-playlist-title" className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/70 bg-[#faf9fd] p-6 shadow-2xl">
      <div className="flex items-center justify-between gap-4"><h2 id="add-playlist-title" className="text-xl font-semibold">加入歌单</h2><Button variant="ghost" size="icon" disabled={saving} aria-label="关闭加入歌单" onClick={onClose}><X /></Button></div>
      {!connected ? <div className="mt-6"><EmptyState text="登录网易云后，可以将歌曲加入自己的歌单。" /><Button className="mt-4" onClick={onRequireLogin}>前往登录</Button></div> : <>
        <label className="mt-4 text-sm font-medium" htmlFor="target-playlist">目标歌单</label>
        <div className="mt-2 flex gap-2"><select id="target-playlist" value={playlistId} onChange={(event) => { setPlaylistId(event.target.value); setCreateOpen(false); }} disabled={saving || createOpen} className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm">
          {!ownedPlaylists.length && <option value="">暂无可编辑歌单</option>}
          {ownedPlaylists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name}</option>)}
        </select><Button size="sm" variant="glass" disabled={saving} onClick={() => setCreateOpen((value) => !value)}>{createOpen ? "取消新建" : "新建歌单"}</Button></div>
        {createOpen && <input autoFocus aria-label="新歌单名称" maxLength={40} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="新歌单名称" disabled={saving} className="mt-3 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm outline-none" />}
        {!initialTracks.length && <div className="mt-4 flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2"><Search className="size-4 text-neutral-400" /><input autoFocus value={keyword} onChange={(event) => setKeyword(event.target.value)} aria-label="搜索要加入的歌曲" placeholder="搜索歌曲或歌手，可多选" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></div>}
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {!initialTracks.length && keyword.trim() && <p className="mb-2 text-xs text-neutral-500">{searching ? "搜索中…" : `搜索结果 ${results.length} 首`}</p>}
          {(initialTracks.length ? initialTracks : results).map((track) => <button type="button" key={track.id} disabled={saving} aria-pressed={selectedIds.has(track.id)} onClick={() => setSelected((current) => current.some((item) => item.id === track.id) ? current.filter((item) => item.id !== track.id) : [...current, track])} className="mb-2 flex w-full items-center gap-3 rounded-xl bg-white px-3 py-2 text-left hover:bg-violet-50">
            <CoverArt track={track} className="size-10 rounded-lg" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{track.title}</span><span className="block truncate text-xs text-neutral-500">{track.artist}</span></span><span className={`flex size-5 items-center justify-center rounded border ${selectedIds.has(track.id) ? "border-violet-500 bg-violet-500 text-white" : "border-neutral-300"}`}>{selectedIds.has(track.id) && <Check className="size-3" />}</span>
          </button>)}
          {!initialTracks.length && !keyword.trim() && <EmptyState text="搜索并选择要加入歌单的网易云歌曲。" />}
          {!searching && keyword.trim() && !results.length && !error && <EmptyState text="没有找到相关歌曲，换个关键词试试。" />}
        </div>
        <p className="mt-3 text-xs text-neutral-500">已选择 {selected.length} 首{!initialTracks.length && selected.length > 0 && <button className="ml-3 text-violet-600" onClick={() => setSelected([])} disabled={saving}>清空选择</button>}</p>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" size="sm" disabled={saving} onClick={onClose}>取消</Button><Button size="sm" disabled={saving || !selected.length || (createOpen ? !newName.trim() : !playlistId)} onClick={() => void submit()}>{saving && <LoaderCircle className="animate-spin" />}{saving ? "正在同步…" : `加入 ${selected.length} 首`}</Button></div>
      </>}
    </section>
  </dialog>;
}
