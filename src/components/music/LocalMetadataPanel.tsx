import { useMemo, useState } from "react";
import { Check, RotateCcw, Search, Sparkles } from "lucide-react";
import type { Track } from "@/data/music";
import { api, type ApiScannedTrack } from "@/lib/api";
import { isUnknownTag, type LocalMetadataApplyOptions, type LocalMetadataPreview } from "@/lib/localMetadata";
import { removeCachedLyrics, writeCachedLyrics } from "@/lib/playerPresentation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArtworkImage } from "./ArtworkImage";

export type LocalMetadataUpdated = (tracks: ApiScannedTrack[], bindings: Record<string, string>) => void;

type LyricSnapshot = Pick<Track, "lyrics" | "lyricStatus">;
const undoStorageKey = "aria-local-metadata-last-undo";
function readLastUndo(): { undoId: string | null; lyrics: Record<string, LyricSnapshot> } {
  try {
    const raw = window.localStorage.getItem(undoStorageKey);
    return raw ? JSON.parse(raw) : { undoId: null, lyrics: {} };
  } catch { return { undoId: null, lyrics: {} }; }
}
function saveLastUndo(undoId: string | null, lyrics: Record<string, LyricSnapshot>) {
  try {
    if (undoId) window.localStorage.setItem(undoStorageKey, JSON.stringify({ undoId, lyrics }));
    else window.localStorage.removeItem(undoStorageKey);
  } catch { /* Current-session undo remains available if storage is full. */ }
}

export function LocalMetadataPanel({ tracks, onMetadataUpdated }: { tracks: Track[]; onMetadataUpdated: LocalMetadataUpdated }) {
  const [scope, setScope] = useState<"missing" | "all">("missing");
  const localTracks = useMemo(() => tracks.filter((track) => track.source === "local" && track.mediaKind !== "audio-cd"), [tracks]);
  const targets = useMemo(() => scope === "all" ? localTracks : localTracks.filter((track) => !track.coverUrl || track.lyricStatus !== "linked" || isUnknownTag(track.artist) || isUnknownTag(track.album)), [localTracks, scope]);
  const [preview, setPreview] = useState<LocalMetadataPreview | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"preview" | "apply" | "undo" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [undoId, setUndoId] = useState<string | null>(() => readLastUndo().undoId);
  const [beforeLastBatch, setBeforeLastBatch] = useState<Record<string, LyricSnapshot>>(() => readLastUndo().lyrics);
  const [options, setOptions] = useState<LocalMetadataApplyOptions>({ info: true, artwork: true, lyrics: true, replaceExisting: false });
  const nextBatch = targets.filter((track) => !reviewed.has(track.id)).slice(0, 20);

  async function search(useCurrent = false) {
    const batch = useCurrent && preview ? preview.rows.map((row) => row.trackId) : nextBatch.map((track) => track.id);
    if (!batch.length) return;
    setBusy("preview");
    setMessage(null);
    try {
      const result = await api.previewLocalMetadata(batch);
      setPreview(result);
      setSelected(Object.fromEntries(result.rows.map((row) => [row.trackId, row.candidates[0]?.id ?? ""])));
      setChecked(new Set(result.rows.filter((row) => row.candidates[0]?.confidence === "high" && (row.candidates.length === 1 || row.candidates[0].score - row.candidates[1].score >= 3)).map((row) => row.trackId)));
      setCompleted(new Set());
      setReviewed((previous) => new Set([...previous, ...batch]));
      if (result.rows.every((row) => !row.candidates.length)) setMessage("这一批没有可用候选，可重新预览或换一批。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "匹配失败，请稍后重试。");
    } finally { setBusy(null); }
  }

  async function apply() {
    if (!preview) return;
    const entries = preview.rows.filter((row) => checked.has(row.trackId) && selected[row.trackId] && !completed.has(row.trackId)).map((row) => {
      const track = localTracks.find((item) => item.id === row.trackId);
      return { trackId: row.trackId, candidateId: selected[row.trackId], hasArtwork: Boolean(track?.coverUrl), hasLyrics: track?.lyricStatus === "linked" };
    });
    if (!entries.length) return;
    setBusy("apply");
    setMessage(null);
    try {
      const result = await api.applyLocalMetadata(preview.previewId, entries, options);
      onMetadataUpdated(result.tracks, result.lyricBindings);
      if (result.undoId) {
        setUndoId(result.undoId);
        const snapshot: Record<string, LyricSnapshot> = {};
        for (const updated of result.tracks) {
          const old = localTracks.find((track) => track.id === updated.id);
          if (old) snapshot[updated.id] = { lyrics: old.lyrics, lyricStatus: old.lyricStatus };
        }
        setBeforeLastBatch(snapshot);
        saveLastUndo(result.undoId, snapshot);
      }
      setCompleted((previous) => new Set([...previous, ...result.tracks.map((track) => track.id)]));
      setMessage(`已补全 ${result.tracks.length} 首${result.failed.length ? `，${result.failed.length} 首失败，可重试` : "，原音频文件保持原样"}。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "应用失败，请重新预览。");
    } finally { setBusy(null); }
  }

  async function undo() {
    if (!undoId) return;
    setBusy("undo");
    try {
      const result = await api.undoLocalMetadata(undoId);
      for (const track of result.tracks) {
        if (!result.restoredLyrics.includes(track.id)) continue;
        const previous = beforeLastBatch[track.id];
        if (!previous) continue;
        if (previous.lyricStatus === "linked") writeCachedLyrics(track.id, previous.lyrics);
        else removeCachedLyrics(track.id);
      }
      onMetadataUpdated(result.tracks, result.lyricBindings);
      setCompleted((previous) => new Set([...previous].filter((id) => !result.tracks.some((track) => track.id === id))));
      setUndoId(null);
      saveLastUndo(null, {});
      setMessage(`已撤销 ${result.tracks.length} 首${result.skipped.length ? `，${result.skipped.length} 首已被重新修改，保留最新结果` : ""}。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "撤销失败，请稍后重试。");
    } finally { setBusy(null); }
  }

  const selectedCount = [...checked].filter((id) => !completed.has(id)).length;

  return (
    <section className="mt-5 rounded-[1.35rem] border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">批量补全</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">预览歌曲资料、封面和歌词，改选候选后再应用。每批最多 20 首。</p>
        </div>
        <div className="flex gap-2">
          <select aria-label="补全范围" value={scope} onChange={(event) => { setScope(event.target.value as "missing" | "all"); setReviewed(new Set()); }} disabled={Boolean(busy)} className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 text-sm">
            <option value="missing">缺少资料的歌曲</option><option value="all">全部本地歌曲</option>
          </select>
          <Button variant="subtle" onClick={() => void search()} disabled={Boolean(busy) || !nextBatch.length}>
            <Search className={busy === "preview" ? "animate-pulse" : undefined} />{busy === "preview" ? "匹配中" : `预览 ${nextBatch.length} 首`}
          </Button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--text-secondary)]">
        {([ ["info", "歌曲资料"], ["artwork", "封面"], ["lyrics", "歌词"], ["replaceExisting", "替换已有封面和歌词"] ] as const).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2"><input type="checkbox" checked={options[key]} disabled={Boolean(busy)} onChange={(event) => setOptions((current) => ({ ...current, [key]: event.target.checked }))} className="accent-[var(--accent)]" />{label}</label>
        ))}
      </div>
      <p className="mt-2 text-xs text-[var(--text-muted)]">自动勾选高置信且候选明确的结果；其它结果由你选择。默认保留已有封面和歌词。</p>
      {undoId && !preview && <Button className="mt-3" size="sm" variant="ghost" onClick={() => void undo()} disabled={Boolean(busy)}><RotateCcw />撤销上次补全</Button>}
      {message && <p role="status" className="mt-3 text-sm text-[var(--accent)]">{message}</p>}
      {!targets.length && !preview && <p className="mt-4 text-sm text-[var(--text-secondary)]">当前范围没有需要补全的歌曲，可切换为全部本地歌曲。</p>}
      {preview && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void apply()} disabled={Boolean(busy) || !selectedCount || (!options.info && !options.artwork && !options.lyrics)}><Sparkles />{busy === "apply" ? "正在补全" : `应用 ${selectedCount} 首`}</Button>
            <Button size="sm" variant="ghost" onClick={() => void search(true)} disabled={Boolean(busy)}><Search />重新预览</Button>
            {undoId && <Button size="sm" variant="ghost" onClick={() => void undo()} disabled={Boolean(busy)}><RotateCcw />撤销上次补全</Button>}
            <span className="ml-auto text-xs text-[var(--text-muted)]">已预览 {reviewed.size} 首 · {targets.length} 首在范围内</span>
          </div>
          <div className="mt-3 max-h-[380px] space-y-2 overflow-y-auto pr-1">
            {preview.rows.map((row) => {
              const match = row.candidates.find((candidate) => candidate.id === selected[row.trackId]);
              const done = completed.has(row.trackId);
              return (
                <article key={row.trackId} className="flex items-start gap-3 rounded-2xl bg-[var(--surface-muted)] p-3">
                  <input type="checkbox" aria-label={`选择 ${row.title}`} checked={checked.has(row.trackId)} disabled={Boolean(busy) || !match || done} onChange={(event) => setChecked((current) => { const next = new Set(current); if (event.target.checked) next.add(row.trackId); else next.delete(row.trackId); return next; })} className="mt-5 accent-[var(--accent)]" />
                  {match?.coverUrl && <ArtworkImage src={api.getNeteaseCoverUrl(match.coverUrl)} cacheSize={128} alt={`${match.title} 候选封面`} className="size-14 shrink-0 rounded-xl object-cover" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={`${row.title} · ${row.artist}`}>{row.title} <span className="font-normal text-[var(--text-muted)]">· {row.artist}</span></p>
                    {match ? (
                      <>
                        <select aria-label={`${row.title} 匹配候选`} value={selected[row.trackId]} disabled={Boolean(busy) || done} onChange={(event) => setSelected((current) => ({ ...current, [row.trackId]: event.target.value }))} className="mt-1 w-full max-w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] p-1.5 text-xs">
                          {row.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title} · {candidate.artist} · {candidate.album}（{candidate.score}）</option>)}
                        </select>
                        <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{match.preview.join(" / ") || "暂无歌词预览"}</p>
                      </>
                    ) : <p className="mt-1 text-xs text-[var(--text-muted)]">{row.error ?? "未找到候选"}</p>}
                  </div>
                  {done ? <Badge><Check className="mr-1 size-3" />已应用</Badge> : match && <Badge className="shrink-0">{match.confidence === "high" ? "高置信" : match.confidence === "medium" ? "中置信" : "需确认"} · {match.score}</Badge>}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
