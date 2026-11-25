import express from "express";
import { z } from "zod";
import {
  createListenTogetherRoom,
  endListenTogetherRoom,
  getListenTogetherInvites,
  getListenTogetherRoomState,
  getListenTogetherStatus,
  joinListenTogetherRoom,
  sendListenTogetherHeartbeat,
  sendListenTogetherInviteMessage,
  sendListenTogetherPlayCommand,
  syncListenTogetherPlaylist,
} from "../sources/netease/listenTogether";

export function createListenTogetherRouter() {
  const router = express.Router();

  router.get("/status", async (_req, res, next) => {
    try {
      res.json(await getListenTogetherStatus());
    } catch (error) {
      next(error);
    }
  });

  router.get("/invites", async (req, res, next) => {
    try {
      const forceRefreshContacts = req.query.refresh === "1" || req.query.refresh === "true";
      res.json(await getListenTogetherInvites({ forceRefreshContacts }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/rooms", async (req, res, next) => {
    try {
      const body = z
        .object({
          songId: z.string().regex(/^\d+$/).optional(),
          trackIds: z.array(z.string().regex(/^\d+$/)).max(10_000).optional(),
          progressMs: z.number().min(0).optional(),
          playStatus: z.enum(["PLAY", "PAUSE"]).optional(),
        })
        .parse(req.body ?? {});
      res.json(await createListenTogetherRoom(body));
    } catch (error) {
      next(error);
    }
  });

  router.post("/join", async (req, res, next) => {
    try {
      const body = z
        .object({
          input: z.string().max(1000).optional(),
          roomId: z.string().max(160).optional(),
          inviterId: z.string().max(40).optional(),
        })
        .parse(req.body ?? {});
      res.json(await joinListenTogetherRoom(body));
    } catch (error) {
      next(error);
    }
  });

  router.get("/rooms/:roomId/state", async (req, res, next) => {
    try {
      const includePlaylist = req.query.includePlaylist === "1" || req.query.includePlaylist === "true";
      res.json(await getListenTogetherRoomState(req.params.roomId, includePlaylist));
    } catch (error) {
      next(error);
    }
  });

  router.post("/rooms/:roomId/heartbeat", async (req, res, next) => {
    try {
      const body = z
        .object({
          songId: z.string().min(1),
          playStatus: z.enum(["PLAY", "PAUSE"]),
          progressMs: z.number().min(0),
        })
        .parse(req.body ?? {});
      res.json(await sendListenTogetherHeartbeat({ roomId: req.params.roomId, ...body }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/rooms/:roomId/command", async (req, res, next) => {
    try {
      const body = z
        .object({
          commandType: z.enum(["PLAY", "PAUSE", "SEEK", "GOTO"]),
          progressMs: z.number().min(0),
          playStatus: z.enum(["PLAY", "PAUSE"]),
          formerSongId: z.string().optional(),
          targetSongId: z.string().min(1),
          clientSeq: z.number().int().min(0),
        })
        .parse(req.body ?? {});
      res.json(await sendListenTogetherPlayCommand({ roomId: req.params.roomId, ...body }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/rooms/:roomId/playlist", async (req, res, next) => {
    try {
      const body = z
        .object({
          commandType: z.enum(["REPLACE", "PLAYMODE_CHANGE"]).optional(),
          version: z.number().int().min(1),
          displayList: z.array(z.string().regex(/^\d+$/)).max(10_000),
          randomList: z.array(z.string().regex(/^\d+$/)).max(10_000).optional(),
        })
        .parse(req.body ?? {});
      res.json(await syncListenTogetherPlaylist({ roomId: req.params.roomId, ...body }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/rooms/:roomId/invite-message", async (req, res, next) => {
    try {
      const body = z
        .object({
          targetUserId: z.string().regex(/^\d+$/),
          shareUrl: z.string().max(1000).optional(),
          songId: z.string().regex(/^\d+$/).optional(),
          songTitle: z.string().max(200).optional(),
          mode: z.enum(["song_card", "short_link"]).optional(),
        })
        .parse(req.body ?? {});
      res.json(await sendListenTogetherInviteMessage({ roomId: req.params.roomId, ...body }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/rooms/:roomId/end", async (req, res, next) => {
    try {
      res.json(await endListenTogetherRoom(req.params.roomId));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
