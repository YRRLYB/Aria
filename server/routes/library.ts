import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import express from "express";
import { z } from "zod";
import { clearLibrary, findTrack, readLibrary, replaceLibraryRoot } from "../libraryStore";
import { readOrExtractLocalCover, warmLocalCovers } from "../localCoverCache";
import { listCdDrives, scanCdDrives, scanMusicFolder } from "../musicScanner";
import type { ScannedTrack } from "../types";
import { HttpError } from "../utils/httpError";

export function createLibraryRouter() {
  const router = express.Router();

  router.post("/scan", async (req, res, next) => {
    try {
      const body = z
        .object({
          folderPath: z.string().min(1),
          persist: z.boolean().optional().default(true),
        })
        .parse(req.body);
      const tracks = await scanMusicFolder(body.folderPath);
      const library = body.persist ? await replaceLibraryRoot(body.folderPath, tracks) : null;
      void warmLocalCovers(tracks).catch(() => undefined);
      res.json({ tracks, library });
    } catch (error) {
      next(error);
    }
  });

  router.get("/cd-drives", async (_req, res, next) => {
    try {
      res.json({ drives: await listCdDrives() });
    } catch (error) {
      next(error);
    }
  });

  router.post("/scan-cd", async (req, res, next) => {
    try {
      const body = z
        .object({
          persist: z.boolean().optional().default(true),
          qualityMode: z.enum(["high", "low"]).optional().default("high"),
        })
        .parse(req.body ?? {});
      const { drives, tracks } = await scanCdDrives(body.qualityMode);
      let library = null;
      if (body.persist) {
        const groups = groupTracksByRoot(tracks);
        for (const [root, group] of groups) {
          library = await replaceLibraryRoot(root, group);
        }
      }
      res.json({ drives, tracks, library });
    } catch (error) {
      next(error);
    }
  });

  router.get("/", async (_req, res, next) => {
    try {
      res.json(await readLibrary());
    } catch (error) {
      next(error);
    }
  });

  router.delete("/", async (_req, res, next) => {
    try {
      res.json(await clearLibrary());
    } catch (error) {
      next(error);
    }
  });

  router.post("/tracks/covers/warmup", async (req, res, next) => {
    try {
      const body = z.object({ trackIds: z.array(z.string()).max(128) }).parse(req.body);
      const library = await readLibrary();
      const wanted = new Set(body.trackIds);
      const tracks = library.tracks.filter((track) => wanted.has(track.id));
      const warmed = await warmLocalCovers(tracks, 128);
      res.json({ ok: true, warmed });
    } catch (error) {
      next(error);
    }
  });

  router.get("/tracks/:trackId/cover", async (req, res, next) => {
    try {
      const track = await findTrack(req.params.trackId);
      if (!track) throw new HttpError(404, "Track not found", "TRACK_NOT_FOUND");

      const { body, contentType } = await readOrExtractLocalCover(track);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", String(body.byteLength));
      res.setHeader("Cache-Control", "public, max-age=604800, immutable");
      res.send(body);
    } catch (error) {
      next(error);
    }
  });

  router.get("/tracks/:trackId/stream", async (req, res, next) => {
    try {
      const track = await findTrack(req.params.trackId);
      if (!track) throw new HttpError(404, "Track not found", "TRACK_NOT_FOUND");
      if (track.requiresNativePlayback || track.mediaKind === "audio-cd") {
        throw new HttpError(409, "Track requires native playback", "NATIVE_PLAYBACK_REQUIRED");
      }

      const fileStat = await stat(track.path);
      const range = req.headers.range;
      const contentType = mimeFromFormat(track.format);
      const commonHeaders = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
        "Content-Type": contentType,
      };

      if (!range) {
        res.writeHead(200, {
          ...commonHeaders,
          "Content-Length": fileStat.size,
        });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        createReadStream(track.path).pipe(res);
        return;
      }

      const match = range.match(/bytes=(\d*)-(\d*)/);
      if (!match) throw new HttpError(416, "Invalid range", "INVALID_RANGE");

      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : fileStat.size - 1;
      if (start > end || end >= fileStat.size) {
        throw new HttpError(416, "Range not satisfiable", "RANGE_NOT_SATISFIABLE");
      }

      res.writeHead(206, {
        ...commonHeaders,
        "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
        "Content-Length": end - start + 1,
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(track.path, { start, end }).pipe(res);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function groupTracksByRoot(tracks: ScannedTrack[]) {
  const groups = new Map<string, ScannedTrack[]>();
  for (const track of tracks) {
    const root = track.libraryRoot ?? "cd:audio";
    const group = groups.get(root) ?? [];
    group.push(track);
    groups.set(root, group);
  }
  return groups;
}

function mimeFromFormat(format: string) {
  const normalized = format.toLowerCase();
  if (normalized.includes("flac")) return "audio/flac";
  if (normalized.includes("wav")) return "audio/wav";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "audio/mpeg";
  if (normalized.includes("mp4") || normalized.includes("m4a") || normalized.includes("aac")) return "audio/mp4";
  if (normalized.includes("ogg") || normalized.includes("opus")) return "audio/ogg";
  if (normalized.includes("ape")) return "audio/ape";
  return "application/octet-stream";
}
