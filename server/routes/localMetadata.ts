import { randomUUID } from "node:crypto";
import express from "express";
import { z } from "zod";
import { metadataConfidence, metadataMatchScore, type LocalMetadataCandidate, type LocalMetadataOverride, type LocalMetadataPreview } from "../../src/lib/localMetadata";
import { readLibrary } from "../libraryStore";
import { searchLyricCandidates, resolveLyricLines } from "../lyrics";
import { localMetadataStore } from "../localMetadataStore";
import { readStore, updateStore } from "../store";
import { HttpError } from "../utils/httpError";

type PreviewSession = { expiresAt: number; rows: LocalMetadataPreview["rows"] };
const previews = new Map<string, PreviewSession>();
const requestSchema = z.object({ trackIds: z.array(z.string().min(1)).min(1).max(20) });
const applySchema = z.object({
  previewId: z.string().min(1),
  entries: z.array(z.object({ trackId: z.string().min(1), candidateId: z.string().min(1), hasArtwork: z.boolean().optional(), hasLyrics: z.boolean().optional() })).min(1).max(20),
  options: z.object({ info: z.boolean(), artwork: z.boolean(), lyrics: z.boolean(), replaceExisting: z.boolean() }),
});

export function createLocalMetadataRouter() {
  const router = express.Router();
  router.post("/preview", async (req, res, next) => {
    try {
      const { trackIds } = requestSchema.parse(req.body);
      const library = await readLibrary();
      const rows: LocalMetadataPreview["rows"] = [];
      // Two requests at a time, with failures isolated to the affected song.
      const unique = [...new Set(trackIds)];
      for (let offset = 0; offset < unique.length; offset += 2) {
        const chunk = await Promise.all(unique.slice(offset, offset + 2).map(async (trackId) => {
          const track = library.tracks.find((item) => item.id === trackId);
          if (!track) return { trackId, title: "歌曲已移除", artist: "", album: "", candidates: [], error: "请重新扫描后匹配" };
          const tags = { title: track.metadata?.title ?? track.title, artist: track.metadata?.artist ?? track.artist, album: track.metadata?.album ?? track.album };
          try {
            const found = await searchLyricCandidates(tags, { previewLimit: 1 });
            const candidates: LocalMetadataCandidate[] = found.map((candidate) => {
              const score = metadataMatchScore(tags, candidate);
              return { ...candidate, score, confidence: metadataConfidence(score) };
            }).sort((a, b) => b.score - a.score);
            return { trackId, ...tags, candidates };
          } catch {
            return { trackId, ...tags, candidates: [], error: "搜索失败，可重新预览" };
          }
        }));
        rows.push(...chunk);
      }
      const now = Date.now();
      for (const [id, preview] of previews) if (preview.expiresAt < now) previews.delete(id);
      while (previews.size >= 10) previews.delete(previews.keys().next().value!);
      const previewId = randomUUID();
      previews.set(previewId, { expiresAt: now + 15 * 60_000, rows });
      res.json({ previewId, rows } satisfies LocalMetadataPreview);
    } catch (error) { next(error); }
  });

  router.post("/apply", async (req, res, next) => {
    try {
      const body = applySchema.parse(req.body);
      const preview = previews.get(body.previewId);
      if (!preview || preview.expiresAt < Date.now()) throw new HttpError(409, "匹配预览已过期，请重新预览");
      if (!body.options.info && !body.options.artwork && !body.options.lyrics) throw new HttpError(400, "请至少选择一种补全内容");
      const library = await readLibrary();
      const overrides: Record<string, LocalMetadataOverride> = {};
      const failed: Array<{ trackId: string; error: string }> = [];
      const seen = new Set<string>();
      for (const entry of body.entries) {
        if (seen.has(entry.trackId)) continue;
        seen.add(entry.trackId);
        const track = library.tracks.find((item) => item.id === entry.trackId);
        const candidate = preview.rows.find((row) => row.trackId === entry.trackId)?.candidates.find((item) => item.id === entry.candidateId);
        if (!track || !candidate) { failed.push({ trackId: entry.trackId, error: "歌曲或候选不存在，请重新预览" }); continue; }
        try {
          const override: LocalMetadataOverride = { candidateId: candidate.id, updatedAt: new Date().toISOString() };
          if (body.options.info) Object.assign(override, { title: candidate.title, artist: candidate.artist, album: candidate.album });
          if (body.options.artwork && candidate.coverUrl && (body.options.replaceExisting || (!entry.hasArtwork && !track.hasCover && !track.metadata?.coverUrl))) {
            override.coverUrl = candidate.coverUrl;
            override.artworkUpdatedAt = override.updatedAt;
          }
          if (body.options.lyrics && (body.options.replaceExisting || (!entry.hasLyrics && !track.metadata?.lyrics?.length))) {
            const lyrics = await resolveLyricLines(candidate.id);
            if (lyrics.length) { override.lyrics = lyrics; override.lyricCandidateId = candidate.id; }
          }
          overrides[track.id] = override;
        } catch { failed.push({ trackId: entry.trackId, error: "读取歌词失败，本首未修改" }); }
      }
      if (!Object.keys(overrides).length) { res.json({ tracks: [], lyricBindings: (await readStore()).lyricBindings, failed, undoId: null }); return; }
      const originalStore = await readStore();
      const undoId = await localMetadataStore.apply(overrides, originalStore.lyricBindings);
      const store = await updateStore((current) => {
        const lyricBindings = { ...current.lyricBindings };
        for (const [id, override] of Object.entries(overrides)) if (override.lyrics?.length) lyricBindings[id] = override.candidateId;
        return { ...current, lyricBindings };
      });
      const updated = await readLibrary();
      res.json({ tracks: updated.tracks.filter((track) => Boolean(overrides[track.id])), lyricBindings: store.lyricBindings, failed, undoId });
    } catch (error) { next(error); }
  });

  router.post("/undo", async (req, res, next) => {
    try {
      const { undoId } = z.object({ undoId: z.string().min(1) }).parse(req.body);
      const result = await localMetadataStore.undo(undoId);
      if (!result) throw new HttpError(404, "该批次已撤销或不在最近 20 个批次中");
      const restoredLyrics: string[] = [];
      const store = await updateStore((current) => {
        const lyricBindings = { ...current.lyricBindings };
        for (const [id, snapshot] of Object.entries(result.restored)) {
          if (lyricBindings[id] !== snapshot.appliedBinding) continue;
          restoredLyrics.push(id);
          if (snapshot.previousBinding) lyricBindings[id] = snapshot.previousBinding;
          else delete lyricBindings[id];
        }
        return { ...current, lyricBindings };
      });
      const library = await readLibrary();
      res.json({ tracks: library.tracks.filter((track) => Boolean(result.restored[track.id])), lyricBindings: store.lyricBindings, skipped: result.skipped, restoredLyrics });
    } catch (error) { next(error); }
  });
  return router;
}
