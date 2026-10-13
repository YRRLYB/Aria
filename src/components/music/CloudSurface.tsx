import { useMemo, useState } from "react";
import { Cloud, HardDrive, LoaderCircle, Play, RefreshCw, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Track } from "@/data/music";
import type { CloudLibraryState } from "@/hooks/useCloudLibrary";
import { formatAudioDetail } from "@/lib/playerPresentation";
import { useVirtualRows } from "@/lib/virtualRows";
import { cn } from "@/lib/utils";
import { AddToPlaylistButton } from "./PlaylistActions";
import { CopyableTrackText, CoverArt, EmptyState } from "./shared";

export function CloudSurface({
  cloudTracks, visibleTracks, items, count, size, maxSize, more, loaded,
  loading, error, accessExpired, query, setQuery, refreshCloud, loadMoreCloud, retryCloud,
  resolveCloudTrack, connected, activeTrackId, onPickTrack, onRequireLogin,
}: CloudLibraryState & {
  connected: boolean;
  activeTrackId: string;
  onPickTrack: (id: string, queue?: Track[]) => void;
  onRequireLogin: () => void;
}) {
  const [pendingTrackId, setPendingTrackId] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [failedTrack, setFailedTrack] = useState<Track | null>(null);
  const virtual = useVirtualRows({ count: visibleTracks.length, rowHeight: 78, overscan: 8 });
  const metadata = useMemo(() => new Map(items.map((item) => [`netease:${item.track.id}`, item])), [items]);
  const searching = Boolean(query.trim());
  const progress = maxSize && size != null ? Math.min(100, Math.max(0, size / maxSize * 100)) : null;

  async function playTrack(track: Track) {
    if (pendingTrackId) return;
    setPendingTrackId(track.id);
    setPlayError(null);
    setFailedTrack(null);
    try {
      const resolved = await resolveCloudTrack(track.id);
      onPickTrack(resolved.id, visibleTracks.map((item) => item.id === resolved.id ? resolved : item));
    } catch (cause) {
      setPlayError(cause instanceof Error ? cause.message : "这首云盘歌曲暂时无法读取，请刷新后重试");
      setFailedTrack(track);
    } finally {
      setPendingTrackId(null);
    }
  }

  return (
    <section className="glass flex h-full min-h-0 flex-col overflow-hidden rounded-[1.5rem] p-5 sm:p-8" aria-label="音乐云盘">
      <div className="flex shrink-0 items-start justify-between gap-5">
        <div className="min-w-0">
          <Badge>Cloud Library</Badge>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight">音乐云盘</h1>
          <p className="mt-3 text-sm text-neutral-500">{connected ? "听见你收藏的每一份原声。" : "登录网易云，随时播放你上传的音乐。"}</p>
        </div>
        {connected && (
          <Button variant="glass" size="sm" disabled={loading} onClick={() => { setPlayError(null); void refreshCloud(); }} aria-label="刷新云盘">
            <RefreshCw className={cn(loading && "animate-spin")} />
            刷新
          </Button>
        )}
      </div>

      {!connected ? (
        <div className="mt-10 flex min-h-0 flex-1 flex-col items-center justify-center gap-5 rounded-2xl bg-white/45 text-center">
          <Cloud className="size-12 text-[var(--accent)]" />
          <p className="text-neutral-500">连接网易云账号后即可读取音乐云盘。</p>
          <Button onClick={onRequireLogin}>登录网易云</Button>
        </div>
      ) : (
        <>
          <div className="mt-6 flex shrink-0 items-center gap-5 rounded-2xl bg-white/45 px-5 py-4">
            <HardDrive className="size-5 shrink-0 text-neutral-400" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{loaded ? `${count.toLocaleString()} 首歌曲` : "正在读取云盘"}</span>
                {size != null && <span className="text-xs text-neutral-500">{formatBytes(size)}{maxSize != null && ` / ${formatBytes(maxSize)}`}</span>}
              </div>
              {progress != null && <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/5" aria-label={`云盘已使用 ${Math.round(progress)}%`}><div className="h-full rounded-full bg-[var(--accent)]/60" style={{ width: `${progress}%` }} /></div>}
            </div>
          </div>

          <div className="mt-5 flex shrink-0 items-center gap-3">
            <label className="flex min-w-0 flex-1 items-center gap-3 rounded-xl bg-white/70 px-4 py-3 text-neutral-400">
              <Search className="size-4 shrink-0" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索云盘歌曲、歌手或文件名" aria-label="搜索云盘歌曲" maxLength={120} className="min-w-0 flex-1 bg-transparent text-sm text-neutral-800 outline-none placeholder:text-neutral-400" />
              {query && <button type="button" className="rounded-full p-1 hover:bg-black/5" onClick={() => setQuery("")} aria-label="清空云盘搜索"><X className="size-3.5" /></button>}
            </label>
            <Button size="sm" disabled={!visibleTracks.length || Boolean(pendingTrackId)} onClick={() => { const first = visibleTracks[0]; if (first) void playTrack(first); }}>
              <Play className="fill-current" /> 播放{searching ? "结果" : "全部"}
            </Button>
          </div>

          <div className="mt-3 flex shrink-0 items-center justify-between gap-3 px-1 text-xs text-neutral-400" aria-live="polite">
            <span>{searching ? `${visibleTracks.length} 首匹配 · 已检索 ${cloudTracks.length.toLocaleString()} / ${count.toLocaleString()} 首` : `已载入 ${cloudTracks.length.toLocaleString()} 首`}</span>
            {loading && <span className="flex items-center gap-1.5"><LoaderCircle className="size-3.5 animate-spin" />{searching ? "继续检索云盘…" : "正在载入…"}</span>}
          </div>

          {(error || playError) && <div role="alert" className="mt-4 flex shrink-0 items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"><span>{error || playError}</span><Button variant="ghost" size="sm" onClick={() => { if (accessExpired) onRequireLogin(); else if (error) void retryCloud(); else if (failedTrack) void playTrack(failedTrack); }}>{accessExpired ? "重新登录" : "重试"}</Button></div>}

          <div ref={virtual.containerRef} className="no-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="relative" style={{ height: virtual.totalHeight }}>
              {virtual.rows.map(({ index, offsetTop }) => {
                const track = visibleTracks[index];
                if (!track) return null;
                const file = metadata.get(track.id);
                const pending = pendingTrackId === track.id;
                return <div key={track.id} role="button" tabIndex={0} aria-label={`播放 ${track.title}`} aria-busy={pending} onClick={() => void playTrack(track)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); void playTrack(track); } }} className={cn("absolute left-0 right-0 grid h-[70px] grid-cols-[1.75rem_3rem_minmax(0,1fr)_minmax(7rem,0.5fr)_auto] items-center gap-3 rounded-xl px-3 text-left transition hover:bg-white/85", activeTrackId === track.id ? "bg-[var(--accent-soft)]" : "bg-white/40")} style={{ top: offsetTop }}>
                  <span className="flex justify-center text-xs text-neutral-400">{pending ? <LoaderCircle className="size-4 animate-spin" /> : index + 1}</span>
                  <CoverArt track={track} className="size-12 rounded-lg" />
                  <div className="min-w-0"><p className="truncate text-sm font-semibold"><CopyableTrackText track={track} field="title">{track.title}</CopyableTrackText></p><p className="mt-1 truncate text-xs text-neutral-500"><CopyableTrackText track={track} field="artist">{track.artist}</CopyableTrackText></p></div>
                  <div className="min-w-0 text-xs text-neutral-400"><p className="truncate" title={file?.fileName}>{file?.fileName || track.album}</p><p className="mt-1 truncate">{formatBytes(file?.fileSize)}{file?.uploadedAt ? ` · ${new Date(file.uploadedAt).toLocaleDateString("zh-CN")}` : ""}</p></div>
                  <span className="flex items-center gap-2"><Badge className="max-w-36 truncate">{formatAudioDetail(track)}</Badge><AddToPlaylistButton track={track} /></span>
                </div>;
              })}
            </div>
            {loaded && !loading && !visibleTracks.length && !error && <EmptyState text={searching ? "没有找到匹配的云盘歌曲，试试其他歌曲名、歌手或文件名。" : "云盘里还没有音乐。上传到网易云音乐云盘后，在这里刷新即可播放。"} />}
          </div>
          {more && !searching && <div className="flex shrink-0 justify-center pt-4"><Button variant="glass" size="sm" disabled={loading} onClick={() => void loadMoreCloud()}>{loading && <LoaderCircle className="animate-spin" />}加载更多 · {cloudTracks.length} / {count}</Button></div>}
        </>
      )}
    </section>
  );
}

function formatBytes(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "大小未知";
  if (value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index > 0 ? 1 : 0)} ${units[index]}`;
}
