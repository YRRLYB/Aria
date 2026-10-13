import { useEffect, useRef, useState } from "react";
import { BookOpen, LoaderCircle, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { SongEncyclopedia } from "@/lib/songEncyclopedia";
import type { Track } from "@/data/music";

const cache = new Map<string, { expiresAt: number; value: SongEncyclopedia }>();
function cachedResult(id: string) {
  const entry = cache.get(id);
  return entry && entry.expiresAt > Date.now() ? entry.value : null;
}

export default function SongEncyclopediaDialog({ track, onClose }: { track: Track; onClose: () => void }) {
  const providerSongId = track.providerId ?? track.id.replace(/^netease:/, "");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<SongEncyclopedia | null>(() => cachedResult(track.id));
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    if (!revision && cachedResult(track.id)) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getSongEncyclopedia(providerSongId).then((result) => {
      if (cancelled) return;
      setData(result);
      if (!result.unavailable.length) {
        cache.delete(track.id);
        cache.set(track.id, { value: result, expiresAt: Date.now() + 24 * 60 * 60_000 });
        while (cache.size > 40) cache.delete(cache.keys().next().value!);
      }
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "歌曲资料加载失败，请重试");
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [track.id, providerSongId, revision]);

  const hasContent = Boolean(data && (data.sections.length || data.creators.length));
  return <dialog
    ref={dialogRef}
    aria-labelledby="song-encyclopedia-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    className="fixed inset-0 m-auto flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-black/25 p-8 backdrop-blur-sm backdrop:bg-transparent"
  >
    <section className="mx-auto flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/70 bg-[#faf9fd] shadow-2xl">
      <header className="flex shrink-0 items-start gap-4 border-b border-violet-100 px-7 py-5">
        <BookOpen className="mt-1 size-5 shrink-0 text-violet-500" />
        <div className="min-w-0 flex-1">
          <h2 id="song-encyclopedia-title" className="text-lg font-semibold text-neutral-900">歌曲百科</h2>
          <p className="mt-1 break-words text-sm font-medium text-neutral-700">{track.title}</p>
          <p className="mt-1 break-words text-xs text-neutral-500">{track.artist} · {track.album}</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="关闭歌曲百科" onClick={onClose}><X /></Button>
      </header>
      <div className="min-h-0 overflow-y-auto px-7 py-5" aria-busy={loading}>
        {loading && <p role="status" className="flex items-center gap-2 py-4 text-sm text-neutral-500"><LoaderCircle className="size-4 animate-spin" />正在读取歌曲资料…</p>}
        {data?.sections.map((section, index) => <section key={index} className="mb-6">
          <h3 className="mb-3 text-sm font-semibold text-neutral-900">{section.title}</h3>
          <dl className="divide-y divide-neutral-200/70">
            {section.items.map((item, itemIndex) => <div key={itemIndex} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-4 py-3 text-sm">
              <dt className="text-neutral-500">{item.label}</dt>
              <dd className="min-w-0 break-words leading-6 text-neutral-800">
                {item.values.length > 0 && <p>{item.values.join(" · ")}</p>}
                {item.descriptions.map((description, descriptionIndex) => <p key={descriptionIndex} className="mt-1 whitespace-pre-wrap text-neutral-600">{description}</p>)}
              </dd>
            </div>)}
          </dl>
        </section>)}
        {Boolean(data?.creators.length) && <section>
          <h3 className="mb-3 text-sm font-semibold text-neutral-900">创作者与制作人员</h3>
          <dl className="divide-y divide-neutral-200/70">
            {data!.creators.map((group, index) => <div key={index} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-4 py-3 text-sm">
              <dt className="text-neutral-500">{group.role}</dt>
              <dd className="min-w-0 break-words leading-6 text-neutral-800">{group.creators.map((creator) => creator.name).join(" / ")}</dd>
            </div>)}
          </dl>
        </section>}
        {!loading && !error && data && !hasContent && !data.unavailable.length && <p className="py-8 text-center text-sm text-neutral-500">这首歌暂未提供百科和制作人员资料。</p>}
        {(error || Boolean(data?.unavailable.length)) && <div className="mt-4 rounded-xl bg-violet-50 px-4 py-3 text-sm text-neutral-600">
          <p role="alert">{error ?? `部分资料暂时不可用（${data!.unavailable.map((part) => part === "wiki" ? "音乐百科" : "制作人员").join("、")}），已保留成功加载的内容。`}</p>
          <Button size="sm" variant="ghost" className="mt-2" disabled={loading} onClick={() => setRevision((value) => value + 1)}><RotateCw className="size-4" />重试</Button>
        </div>}
      </div>
      <footer className="shrink-0 border-t border-violet-100 px-7 py-3 text-[11px] leading-5 text-neutral-400">资料来自网易云音乐，内容完整程度随歌曲而异。</footer>
    </section>
  </dialog>;
}
