import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, GripVertical, Heart, ImagePlus, ListPlus, LoaderCircle, Pencil, Play, Save, Trash2, X } from "lucide-react";
import type { Track } from "@/data/music";
import type { ProviderPlaylist } from "@/lib/api";
import { useVirtualRows } from "@/lib/virtualRows";
import { formatAudioDetail } from "@/lib/playerPresentation";
import { Button } from "@/components/ui/button";
import { ArtworkImage } from "./ArtworkImage";
import { CoverArt, EmptyState } from "./shared";
import { usePlaylistActions } from "./PlaylistActions";

export function PlaylistDetail({ playlist, tracks, loading, error, connected, playCounts, onBack, onRetry, onPickTrack, onUpdate, onUploadCover, onRemove, onReorder, onSubscribe, onDelete, onRequireLogin }: {
  playlist: ProviderPlaylist;
  tracks: Track[];
  loading: boolean;
  error: string | null;
  connected: boolean;
  playCounts: Record<string, number>;
  onBack: () => void;
  onRetry: () => void;
  onPickTrack: (id: string, queue?: Track[]) => void;
  onUpdate: (fields: { name?: string; description?: string }) => Promise<void>;
  onUploadCover: (file: File) => Promise<void>;
  onRemove: (tracks: Track[]) => Promise<void>;
  onReorder: (tracks: Track[]) => Promise<void>;
  onSubscribe: (subscribed: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
  onRequireLogin: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(playlist.name);
  const [description, setDescription] = useState(playlist.description ?? "");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [orderDraft, setOrderDraft] = useState<Track[] | null>(null);
  const [sort, setSort] = useState<"original" | "title" | "artist" | "plays">("original");
  const [filter, setFilter] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(false);
  const draggedId = useRef<string | null>(null);
  const actions = usePlaylistActions();
  const canEditTracks = connected && playlist.owned === true;
  const canEditDetails = connected && playlist.canEdit === true;

  async function deleteCurrentPlaylist() {
    if (!canEditDetails || busy) return;
    if (!window.confirm(`确定删除歌单“${playlist.name}”吗？此操作无法撤销。`)) return;
    await run(onDelete, "歌单已删除");
  }

  useEffect(() => {
    setName(playlist.name);
    setDescription(playlist.description ?? "");
  }, [playlist.name, playlist.description]);
  const trackIdsSignature = tracks.map((track) => track.id).join("|");
  useEffect(() => { setSelectedIds(new Set()); setOrderDraft(null); }, [trackIdsSignature]);

  const orderedTracks = orderDraft ?? tracks;
  const visibleTracks = useMemo(() => {
    const list = orderedTracks.filter((track) => `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(filter.trim().toLowerCase()));
    if (sort === "title") return list.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    if (sort === "artist") return list.sort((a, b) => a.artist.localeCompare(b.artist, "zh-CN"));
    if (sort === "plays") return list.sort((a, b) => (playCounts[b.id] ?? 0) - (playCounts[a.id] ?? 0));
    return list;
  }, [orderedTracks, filter, sort, playCounts]);
  const selection = tracks.filter((track) => selectedIds.has(track.id));
  const virtual = useVirtualRows({ count: visibleTracks.length, rowHeight: 76, overscan: 8 });
  const canReorder = canEditTracks && sort === "original" && !filter.trim();

  async function run(work: () => Promise<void>, message: string) {
    if (pendingRef.current) return;
    pendingRef.current = true; setBusy(true); setActionError(null); setSuccess(null);
    try { await work(); setSuccess(message); return true; }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "操作失败，请重试"); return false; }
    finally { pendingRef.current = false; setBusy(false); }
  }

  function moveTrack(id: string, destination: number) {
    if (busy || !canReorder) return;
    const from = orderedTracks.findIndex((track) => track.id === id);
    if (from < 0 || destination < 0 || destination >= orderedTracks.length || from === destination) return;
    const next = [...orderedTracks];
    const [moving] = next.splice(from, 1);
    next.splice(destination, 0, moving);
    setOrderDraft(next);
    setSuccess(null);
  }

  return <div className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-[1.5rem] p-6">
    <div className="flex shrink-0 items-center justify-between gap-4"><Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft />返回歌单</Button>{loading && <span className="flex items-center gap-2 text-xs text-neutral-500"><LoaderCircle className="size-4 animate-spin" />读取中</span>}</div>
    <div className="mt-4 flex shrink-0 items-start gap-5">
      <div className="relative size-28 shrink-0 overflow-hidden rounded-2xl" style={{ background: playlist.coverColor }}>
        {playlist.coverUrl && <ArtworkImage src={playlist.coverUrl} cacheSize={320} alt="歌单封面" className="size-full object-cover" />}
        {canEditDetails && <button className="absolute inset-x-0 bottom-0 flex justify-center gap-1 bg-black/45 py-2 text-xs text-white hover:bg-black/65" disabled={busy} onClick={() => fileRef.current?.click()}><ImagePlus className="size-3.5" />换封面</button>}
      </div>
      <div className="min-w-0 flex-1"><h1 title={playlist.name} className="line-clamp-2 text-3xl font-semibold leading-snug">{playlist.name}</h1><p className="mt-2 text-xs text-neutral-500">{playlist.creatorName || (playlist.owned ? "我创建" : "网易云歌单")} · {loading ? playlist.trackCount : tracks.length} 首</p>{playlist.description && <p title={playlist.description} className="mt-2 line-clamp-2 text-sm leading-relaxed text-neutral-500">{playlist.description}</p>}
        <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" disabled={loading || !tracks.length} onClick={() => { const first = visibleTracks.find((track) => track.streamUrl); if (first) onPickTrack(first.id, visibleTracks); }}><Play />播放全部</Button>
          {canEditTracks && <Button size="sm" variant="glass" disabled={busy || loading} onClick={() => actions?.openAdd([], playlist.id)}><ListPlus />添加歌曲</Button>}
          {canEditDetails && <><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing((value) => !value); setActionError(null); }}><Pencil />编辑歌单</Button><Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" disabled={busy} onClick={() => void deleteCurrentPlaylist()}><Trash2 />删除歌单</Button></>}
          {!playlist.owned && <Button size="sm" variant="glass" disabled={busy || loading} onClick={() => connected ? void run(() => onSubscribe(!playlist.subscribed), playlist.subscribed ? "已取消收藏" : "已收藏歌单") : onRequireLogin()}><Heart className={playlist.subscribed ? "fill-violet-500 text-violet-500" : ""} />{playlist.subscribed ? "取消收藏" : "收藏歌单"}</Button>}
        </div>
      </div>
    </div>
    <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; if (file.size > 8 * 1024 * 1024) { setActionError("封面图片不能超过 8 MB"); return; } void run(() => onUploadCover(file), "封面已更新"); }} />
    {editing && <form className="mt-4 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-xl bg-white/70 p-4" onSubmit={(event) => { event.preventDefault(); void run(() => onUpdate({ name: name.trim(), description: description.trim() }), "歌单信息已保存").then((saved) => { if (saved) setEditing(false); }); }}>
      <div className="space-y-2"><input aria-label="歌单名称" value={name} maxLength={40} required disabled={busy} onChange={(event) => setName(event.target.value)} className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none" /><textarea aria-label="歌单简介" placeholder="添加歌单简介" value={description} maxLength={1000} disabled={busy} onChange={(event) => setDescription(event.target.value)} rows={2} className="block w-full resize-none rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none" /></div><div className="flex flex-col gap-2"><Button type="submit" size="sm" disabled={busy || !name.trim()}><Save />保存</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}><X />取消</Button></div>
    </form>}
    {error && <div role="alert" className="mt-4 flex shrink-0 items-center justify-between gap-3 rounded-xl bg-red-50 p-3 text-sm text-red-600"><p>{error}</p><Button variant="ghost" size="sm" onClick={onRetry}>重试</Button></div>}
    {(actionError || success) && <p role={actionError ? "alert" : "status"} className={`mt-3 shrink-0 text-sm ${actionError ? "text-red-600" : "text-violet-600"}`}>{actionError || success}</p>}
    <div className="mt-4 flex shrink-0 flex-wrap items-center gap-2">
      <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="歌单内查找" aria-label="歌单内查找" className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white/70 px-3 py-2 text-sm outline-none" />
      <select aria-label="歌单显示顺序" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="rounded-xl border border-neutral-200 bg-white/70 px-3 py-2 text-sm"><option value="original">歌单原始顺序</option><option value="title">歌曲名称</option><option value="artist">歌手名称</option><option value="plays">聆听次数</option></select>
      {orderDraft && <><Button size="sm" disabled={busy} onClick={() => void run(() => onReorder(orderDraft), "顺序已同步到网易云").then((saved) => { if (saved) setOrderDraft(null); })}><Save />保存顺序</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setOrderDraft(null)}>撤销排序</Button></>}
    </div>
    {canEditTracks && <div className="mt-3 flex shrink-0 items-center gap-3 text-xs text-neutral-500"><label className="flex items-center gap-2"><input type="checkbox" aria-label="选择所有显示歌曲" disabled={busy || loading || !visibleTracks.length} checked={visibleTracks.length > 0 && visibleTracks.every((track) => selectedIds.has(track.id))} onChange={(event) => setSelectedIds(event.target.checked ? new Set(visibleTracks.map((track) => track.id)) : new Set())} className="accent-violet-500" />已选 {selection.length} 首</label>{selection.length > 0 && <><Button size="sm" variant="ghost" disabled={busy} onClick={() => actions?.openAdd(selection)}><ListPlus />加入其他歌单</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => onRemove(selection), `已移除 ${selection.length} 首`).then((saved) => { if (saved) setSelectedIds(new Set()); })}><Trash2 />从歌单移除</Button></>}<span className="ml-auto">{canReorder ? "拖动歌曲调整顺序，保存后同步" : "切回原始顺序并清空查找可排序"}</span></div>}
    <div ref={virtual.containerRef} className="mt-3 min-h-0 flex-1 overflow-y-auto">
      <div className="relative" style={{ height: virtual.totalHeight }}>{virtual.rows.map(({ index, offsetTop }) => { const track = visibleTracks[index]; if (!track) return null; return <div key={track.id} draggable={canReorder && !busy} onDragStart={(event) => { draggedId.current = track.id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", track.id); }} onDragEnd={() => { draggedId.current = null; }} onDragOver={(event) => { if (canReorder && draggedId.current) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => { event.preventDefault(); if (draggedId.current) moveTrack(draggedId.current, index); draggedId.current = null; }} className="absolute inset-x-0 flex h-[70px] items-center gap-3 rounded-xl bg-white/60 px-3 hover:bg-white" style={{ top: offsetTop }}>
        {canEditTracks && <input type="checkbox" aria-label={`选择 ${track.title}`} checked={selectedIds.has(track.id)} disabled={busy} onChange={() => setSelectedIds((current) => { const next = new Set(current); if (next.has(track.id)) next.delete(track.id); else next.add(track.id); return next; })} className="shrink-0 accent-violet-500" />}
        {canReorder ? <GripVertical className="size-4 shrink-0 cursor-grab text-neutral-400" /> : <span className="w-5 shrink-0 text-center text-xs text-neutral-400">{index + 1}</span>}
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => onPickTrack(track.id, visibleTracks)}><CoverArt track={track} className="size-12 rounded-xl" /><span className="min-w-0"><span title={track.title} className="block truncate text-sm font-semibold">{track.title}</span><span className="block truncate text-xs text-neutral-500">{track.artist} · {track.album}</span></span></button>
        <span className="shrink-0 text-xs text-neutral-400">{formatAudioDetail(track)}</span>
        {canReorder && <div className="flex shrink-0"><Button variant="ghost" size="icon" title="上移" aria-label={`上移 ${track.title}`} disabled={busy || index === 0} onClick={() => moveTrack(track.id, index - 1)}><ArrowUp className="size-3.5" /></Button><Button variant="ghost" size="icon" title="下移" aria-label={`下移 ${track.title}`} disabled={busy || index === orderedTracks.length - 1} onClick={() => moveTrack(track.id, index + 1)}><ArrowDown className="size-3.5" /></Button></div>}
      </div>; })}</div>
      {!visibleTracks.length && !loading && !error && <EmptyState text={filter.trim() ? "没有匹配的歌曲" : "歌单还是空的，可以从搜索结果或添加歌曲入口加入。"} />}
      {loading && !tracks.length && <div className="flex items-center justify-center gap-2 p-8 text-sm text-neutral-500"><LoaderCircle className="size-4 animate-spin" />正在读取歌单…</div>}
    </div>
  </div>;
}
