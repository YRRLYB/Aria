import { useCallback, useEffect, useRef, useState } from "react";
import type { Track } from "@/data/music";
import {
  api,
  type ListenTogetherContact,
  type ListenTogetherInvite,
  type ListenTogetherRoom,
  type ListenTogetherStateResponse,
} from "@/lib/api";
import {
  buildListenTogetherPlaySignature,
  evaluateRemotePlayInfoSync,
  type LocalSentPlaySnapshot,
} from "@/lib/listenTogetherSync";
import { providerTrackToUiTrack } from "@/lib/trackMappers";

export function useListenTogether(options: {
  connected: boolean;
  activeTrack: Track;
  playing: boolean;
  playQueueTracks: Track[];
  pageVisible: boolean;
  getPlaybackTime: () => number;
  onApplyRemoteTrack: (track: Track, queue: Track[], progressSeconds: number, shouldPlay: boolean) => void;
  onApplyRemotePlaying: (shouldPlay: boolean) => void;
  onApplyRemoteSeek: (seconds: number) => void;
  onApplyRemoteQueue: (tracks: Track[]) => void;
  onExecutePendingTrack: (track: Track, queue?: Track[]) => void;
  onNotice: (message: string) => void;
}) {
  const [room, setRoom] = useState<ListenTogetherRoom | null>(null);
  const [recoverableRoom, setRecoverableRoom] = useState<ListenTogetherRoom | null>(null);
  const [invites, setInvites] = useState<ListenTogetherInvite[]>([]);
  const [contacts, setContacts] = useState<ListenTogetherContact[]>([]);
  const [sharedTracks, setSharedTracks] = useState<Track[]>([]);
  const [playlistVersion, setPlaylistVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastDriftMs, setLastDriftMs] = useState<number | null>(null);
  const [incomingInvite, setIncomingInvite] = useState<ListenTogetherInvite | null>(null);
  const [pendingSourceExit, setPendingSourceExit] = useState<{ track: Track; queue?: Track[] } | null>(null);

  const roomRef = useRef<ListenTogetherRoom | null>(null);
  roomRef.current = room;
  const sharedTracksRef = useRef<Track[]>([]);
  sharedTracksRef.current = sharedTracks;
  const playlistVersionRef = useRef(0);
  playlistVersionRef.current = playlistVersion;

  const activeTrackRef = useRef(options.activeTrack);
  activeTrackRef.current = options.activeTrack;
  const playingRef = useRef(options.playing);
  playingRef.current = options.playing;
  const playQueueTracksRef = useRef(options.playQueueTracks);
  playQueueTracksRef.current = options.playQueueTracks;
  const pageVisibleRef = useRef(options.pageVisible);
  pageVisibleRef.current = options.pageVisible;
  const getPlaybackTimeRef = useRef(options.getPlaybackTime);
  getPlaybackTimeRef.current = options.getPlaybackTime;

  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const clientSeqRef = useRef(1);
  const suppressRemoteEchoUntilRef = useRef(0);
  const lastLocalCommandAtRef = useRef(0);
  const lastLocalSeekAtRef = useRef(0);
  const seekDebounceTimerRef = useRef<number | null>(null);
  const lastProcessedPlaySigRef = useRef<string | null>(null);
  const lastLocalSentRef = useRef<LocalSentPlaySnapshot | null>(null);
  const selfUserIdRef = useRef<string | null>(null);
  const seenInviteRoomsRef = useRef<Set<string>>(new Set());
  const dismissedInviteRoomsRef = useRef<Set<string>>(new Set());
  const initialInboxScannedRef = useRef(false);

  const resetRoomState = useCallback((notice?: string) => {
    roomRef.current = null;
    lastProcessedPlaySigRef.current = null;
    lastLocalSentRef.current = null;
    selfUserIdRef.current = null;
    setRoom(null);
    setSharedTracks([]);
    setPlaylistVersion(0);
    setLastDriftMs(null);
    setPendingSourceExit(null);
    if (notice) callbacksRef.current.onNotice(notice);
  }, []);

  const refreshInvites = useCallback(async (forceRefreshContacts = false) => {
    if (!options.connected) {
      setInvites([]);
      setContacts([]);
      setIncomingInvite(null);
      return;
    }
    try {
      const data = await api.getListenTogetherInvites(forceRefreshContacts);
      setInvites(data.invites);
      setContacts(data.contacts);

      const now = Date.now();
      const freshWindowMs = initialInboxScannedRef.current ? 10 * 60_000 : 5 * 60_000;
      if (!roomRef.current) {
        const sortedInvites = [...data.invites].sort((a, b) => (b.time || 0) - (a.time || 0));
        const candidate = sortedInvites.find((inv) => {
          if (seenInviteRoomsRef.current.has(inv.roomId)) return false;
          if (dismissedInviteRoomsRef.current.has(inv.roomId)) return false;
          if (!inv.time) return initialInboxScannedRef.current;
          return now - inv.time <= freshWindowMs;
        });
        for (const inv of data.invites) {
          seenInviteRoomsRef.current.add(inv.roomId);
        }
        if (candidate) {
          setIncomingInvite(candidate);
        }
      } else {
        for (const inv of data.invites) {
          seenInviteRoomsRef.current.add(inv.roomId);
        }
        setIncomingInvite(null);
      }
      initialInboxScannedRef.current = true;
    } catch {
      // Inbox scan is best-effort.
    }
  }, [options.connected]);

  // Scan for existing room & inbox invites when NetEase connects.
  useEffect(() => {
    if (!options.connected) {
      initialInboxScannedRef.current = false;
      seenInviteRoomsRef.current.clear();
      dismissedInviteRoomsRef.current.clear();
      resetRoomState();
      setRecoverableRoom(null);
      setInvites([]);
      setContacts([]);
      setIncomingInvite(null);
      return;
    }
    let cancelled = false;
    api
      .getListenTogetherStatus()
      .then((res) => {
        if (cancelled) return;
        if (res.inRoom && res.room && !roomRef.current) {
          setRecoverableRoom(res.room);
        } else if (!res.inRoom) {
          setRecoverableRoom(null);
        }
      })
      .catch(() => {});
    void refreshInvites(true);
    return () => {
      cancelled = true;
    };
  }, [options.connected, refreshInvites, resetRoomState]);

  // Real-time background inbox invite polling while connected and not already in a room.
  useEffect(() => {
    if (!options.connected || room?.roomId) return;
    let cancelled = false;
    let timer: number | null = null;
    const loop = () => {
      if (cancelled) return;
      const delay = pageVisibleRef.current ? 5000 : 15_000;
      timer = window.setTimeout(() => {
        if (cancelled) return;
        void refreshInvites(false).finally(() => {
          loop();
        });
      }, delay);
    };
    loop();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [options.connected, room?.roomId, refreshInvites]);

  const applyRemoteState = useCallback(
    (state: ListenTogetherStateResponse, rttMs: number, forceAlign = false) => {
      if (state.roomClosed || !state.inRoom || !state.room) {
        if (roomRef.current) {
          resetRoomState("网易云一起听房间已结束。");
        }
        setRecoverableRoom(null);
        return;
      }

      const nextRoom = state.room;
      roomRef.current = nextRoom;
      if (state.selfUserId) {
        selfUserIdRef.current = state.selfUserId;
      }
      setRoom(nextRoom);
      setRecoverableRoom(null);

      if (nextRoom.playInfo?.clientSeq) {
        clientSeqRef.current = Math.max(clientSeqRef.current, nextRoom.playInfo.clientSeq + 1);
      }

      const hydratedUi = state.sharedTracks.map((track, idx) => providerTrackToUiTrack(track, idx));
      let nextShared = sharedTracksRef.current;
      if (hydratedUi.length) {
        nextShared = hydratedUi;
        sharedTracksRef.current = hydratedUi;
        setSharedTracks(hydratedUi);
      }
      if (state.playlistVersion > 0 && state.playlistVersion !== playlistVersionRef.current) {
        setPlaylistVersion(state.playlistVersion);
        if (hydratedUi.length) {
          callbacksRef.current.onApplyRemoteQueue(hydratedUi);
        }
      }

      const remoteActiveTrack = state.activeTrack ? providerTrackToUiTrack(state.activeTrack, 0) : null;
      const playInfo = nextRoom.playInfo;
      if (!playInfo) return;

      const current = activeTrackRef.current;
      const currentNeteaseId = current.source === "netease" ? current.providerId ?? null : null;
      const syncDecision = evaluateRemotePlayInfoSync({
        room: nextRoom,
        rttMs,
        forceAlign,
        nowMs: Date.now(),
        lastLocalCommandAtMs: lastLocalCommandAtRef.current,
        lastProcessedPlaySig: lastProcessedPlaySigRef.current,
        lastLocalSent: lastLocalSentRef.current,
        selfUserId: selfUserIdRef.current,
        currentSongId: currentNeteaseId,
      });
      if (syncDecision.kind === "skip") {
        lastProcessedPlaySigRef.current = syncDecision.nextProcessedSig;
        if (syncDecision.clearDrift) setLastDriftMs(null);
        return;
      }

      const remotePlaying = playInfo.playStatus === "PLAY";
      const expectedMs = syncDecision.expectedMs;
      const expectedSec = syncDecision.expectedSec;

      const sameSong = Boolean(currentNeteaseId && playInfo.songId && currentNeteaseId === playInfo.songId);

      if (playInfo.songId && !sameSong) {
        const targetTrack =
          (remoteActiveTrack && remoteActiveTrack.providerId === playInfo.songId ? remoteActiveTrack : null) ??
          nextShared.find((t) => t.source === "netease" && t.providerId === playInfo.songId) ??
          playQueueTracksRef.current.find((t) => t.source === "netease" && t.providerId === playInfo.songId) ??
          null;
        if (!targetTrack) {
          // Wait for follow-up hydration rather than swallowing this signature.
          return;
        }
        lastProcessedPlaySigRef.current = syncDecision.nextProcessedSig;
        suppressRemoteEchoUntilRef.current = Date.now() + 1800;
        callbacksRef.current.onApplyRemoteTrack(
          targetTrack,
          nextShared.length ? nextShared : [targetTrack],
          expectedSec,
          remotePlaying,
        );
        setLastDriftMs(0);
        return;
      }

      lastProcessedPlaySigRef.current = syncDecision.nextProcessedSig;
      if (sameSong) {
        if (playingRef.current !== remotePlaying) {
          suppressRemoteEchoUntilRef.current = Date.now() + 1500;
          callbacksRef.current.onApplyRemotePlaying(remotePlaying);
        }

        const localMs = getPlaybackTimeRef.current() * 1000;
        const driftMs = localMs - expectedMs;
        setLastDriftMs(Math.round(driftMs));

        const seekSettled = forceAlign || Date.now() - lastLocalSeekAtRef.current > 2500;
        if (seekSettled && (forceAlign || Math.abs(driftMs) > 1800)) {
          suppressRemoteEchoUntilRef.current = Date.now() + 1500;
          callbacksRef.current.onApplyRemoteSeek(expectedSec);
        }
      }
    },
    [resetRoomState],
  );

  const pollRoomState = useCallback(
    async (roomId: string, includePlaylist = false, forceAlign = false) => {
      const started = performance.now();
      const state = await api.getListenTogetherRoomState(roomId, includePlaylist);
      const rtt = performance.now() - started;
      applyRemoteState(state, rtt, forceAlign);
      return state;
    },
    [applyRemoteState],
  );

  // Adaptive short-polling + 10s heartbeat loop while in room
  useEffect(() => {
    const activeRoomId = room?.roomId;
    if (!activeRoomId || !options.connected) return;

    let cancelled = false;
    let pollTimer: number | null = null;

    const schedulePoll = () => {
      if (cancelled) return;
      const delay = pageVisibleRef.current ? 1800 : 5000;
      pollTimer = window.setTimeout(() => {
        if (cancelled) return;
        const needPlaylist = playlistVersionRef.current === 0 || sharedTracksRef.current.length === 0;
        void pollRoomState(activeRoomId, needPlaylist, false)
          .then((state) => {
            if (
              !cancelled &&
              state.inRoom &&
              state.room &&
              ((state.playlistVersion > 0 && state.playlistVersion !== playlistVersionRef.current) ||
                (state.displayList.length > 0 && state.playlistVersion !== playlistVersionRef.current) ||
                (state.room.playInfo?.songId &&
                  !sharedTracksRef.current.some((t) => t.providerId === state.room?.playInfo?.songId) &&
                  !state.activeTrack))
            ) {
              return pollRoomState(activeRoomId, true, false);
            }
          })
          .catch(() => {})
          .finally(() => {
            schedulePoll();
          });
      }, delay);
    };
    schedulePoll();

    const heartbeatTimer = window.setInterval(() => {
      const current = activeTrackRef.current;
      const songId =
        current.source === "netease" && current.providerId
          ? current.providerId
          : roomRef.current?.playInfo?.songId;
      if (!songId) return;
      const playStatus = playingRef.current ? "PLAY" : "PAUSE";
      const progressMs = Math.max(0, Math.round(getPlaybackTimeRef.current() * 1000));
      void api
        .sendListenTogetherHeartbeat(activeRoomId, {
          songId,
          playStatus,
          progressMs,
        })
        .then((res) => {
          if (cancelled) return;
          if (res.roomClosed) {
            resetRoomState("网易云一起听房间已结束。");
            return;
          }
          const now = Date.now();
          lastLocalSentRef.current = {
            songId,
            playStatus,
            progressMs,
            clientSeq: clientSeqRef.current,
            sentAtMs: now,
          };
          if (res.playInfo) {
            const sig = buildListenTogetherPlaySignature(activeRoomId, res.playInfo);
            if (sig && sig !== lastProcessedPlaySigRef.current) {
              void pollRoomState(activeRoomId, false, false).catch(() => {});
            }
          }
        })
        .catch(() => {});
    }, 10_000);

    return () => {
      cancelled = true;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      window.clearInterval(heartbeatTimer);
    };
  }, [room?.roomId, options.connected, pollRoomState, resetRoomState]);

  async function createRoom() {
    if (!options.connected || loading) return;
    setLoading(true);
    setActionError(null);
    try {
      const current = activeTrackRef.current;
      const isCurrentNetease =
        current.source === "netease" && Boolean(current.providerId && /^\d+$/.test(current.providerId));
      const songId = isCurrentNetease ? current.providerId : undefined;
      const progressMs = isCurrentNetease
        ? Math.max(0, Math.round(getPlaybackTimeRef.current() * 1000))
        : 0;
      const playStatus: "PLAY" | "PAUSE" = isCurrentNetease && playingRef.current ? "PLAY" : "PAUSE";
      const trackIds = playQueueTracksRef.current
        .filter((t) => t.source === "netease" && t.providerId && /^\d+$/.test(t.providerId))
        .map((t) => t.providerId!);

      if (!isCurrentNetease && playingRef.current) {
        callbacksRef.current.onApplyRemotePlaying(false);
      }

      const now = Date.now();
      lastLocalCommandAtRef.current = now;
      const state = await api.createListenTogetherRoom({
        songId,
        trackIds,
        ...(songId ? { progressMs, playStatus } : {}),
      });
      setRoom(state.room);
      roomRef.current = state.room;
      if (state.selfUserId) {
        selfUserIdRef.current = state.selfUserId;
      }
      clientSeqRef.current = Math.max(clientSeqRef.current, (state.room?.playInfo?.clientSeq ?? 1) + 1);
      lastProcessedPlaySigRef.current = state.room
        ? buildListenTogetherPlaySignature(state.room.roomId, state.room.playInfo)
        : null;
      lastLocalSentRef.current = state.room?.playInfo
        ? {
            songId: state.room.playInfo.songId,
            playStatus: state.room.playInfo.playStatus,
            progressMs: state.room.playInfo.progressMs,
            clientSeq: state.room.playInfo.clientSeq,
            sentAtMs: Date.now(),
          }
        : null;
      setRecoverableRoom(null);
      setIncomingInvite(null);
      setSharedTracks(state.sharedTracks.map((t, i) => providerTrackToUiTrack(t, i)));
      setPlaylistVersion(state.playlistVersion);
      if (state.room?.shareUrl) {
        try {
          await navigator.clipboard?.writeText(state.room.shareUrl);
        } catch {
          // Clipboard write is optional.
        }
      }
      void refreshInvites();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "创建一起听房间失败");
    } finally {
      setLoading(false);
    }
  }

  async function joinRoom(payload: { input?: string; roomId?: string; inviterId?: string }) {
    if (!options.connected || loading) return;
    setLoading(true);
    setActionError(null);
    try {
      const started = performance.now();
      const state = await api.joinListenTogetherRoom(payload);
      const rtt = performance.now() - started;
      setIncomingInvite(null);
      applyRemoteState(state, rtt, true);
      void refreshInvites();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "加入一起听房间失败");
    } finally {
      setLoading(false);
    }
  }

  async function resumeRecoverableRoom() {
    if (!recoverableRoom || loading) return;
    setLoading(true);
    setActionError(null);
    try {
      await pollRoomState(recoverableRoom.roomId, true, true);
      setIncomingInvite(null);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "恢复一起听房间失败");
    } finally {
      setLoading(false);
    }
  }

  async function endRoomById(roomId: string, silent = false) {
    try {
      await api.endListenTogetherRoom(roomId);
    } catch {
      // Best-effort cleanup if already closed remotely.
    }
    if (recoverableRoom?.roomId === roomId) {
      setRecoverableRoom(null);
    }
    if (roomRef.current?.roomId === roomId) {
      resetRoomState(silent ? undefined : "已结束并退出一起听房间。");
    }
  }

  async function leaveRoom(opts: { silent?: boolean } = {}) {
    const active = roomRef.current;
    if (!active) return;
    setLoading(true);
    try {
      await endRoomById(active.roomId, opts.silent);
    } finally {
      setLoading(false);
    }
  }

  async function syncNow() {
    const active = roomRef.current;
    if (!active || loading) return;
    setLoading(true);
    setActionError(null);
    try {
      await pollRoomState(active.roomId, true, true);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "同步进度失败");
    } finally {
      setLoading(false);
    }
  }

  async function sendInviteToContact(targetUserId: string, mode: "song_card" | "short_link" = "song_card") {
    const active = roomRef.current;
    if (!active) return;
    const songId =
      activeTrackRef.current.source === "netease" && activeTrackRef.current.providerId
        ? activeTrackRef.current.providerId
        : active.playInfo?.songId ?? undefined;
    const songTitle = activeTrackRef.current.source === "netease" ? activeTrackRef.current.title : undefined;
    const result = await api.sendListenTogetherInviteMessage(active.roomId, {
      targetUserId,
      shareUrl: active.shareUrl,
      songId,
      songTitle,
      mode,
    });
    callbacksRef.current.onNotice(
      result.modeUsed === "song_card" ? "已发送当前歌曲音乐卡片与邀请短链" : "已发送一起听精简邀请短链",
    );
  }

  function dismissIncomingInvite(roomId: string) {
    dismissedInviteRoomsRef.current.add(roomId);
    setIncomingInvite((current) => (current?.roomId === roomId ? null : current));
  }

  async function acceptIncomingInvite(invite: ListenTogetherInvite) {
    dismissedInviteRoomsRef.current.add(invite.roomId);
    setIncomingInvite(null);
    await joinRoom({ roomId: invite.roomId, inviterId: invite.inviterId });
  }

  function nextSeq() {
    clientSeqRef.current += 1;
    return clientSeqRef.current;
  }

  function isSuppressedEcho() {
    return Date.now() < suppressRemoteEchoUntilRef.current;
  }

  function reportPlayPause(nextPlaying: boolean) {
    const active = roomRef.current;
    const current = activeTrackRef.current;
    if (!active || isSuppressedEcho() || current.source !== "netease" || !current.providerId) return;
    const now = Date.now();
    const seq = nextSeq();
    const playStatus = nextPlaying ? "PLAY" : "PAUSE";
    const progressMs = Math.max(0, Math.round(getPlaybackTimeRef.current() * 1000));
    lastLocalCommandAtRef.current = now;
    lastLocalSentRef.current = {
      songId: current.providerId,
      playStatus,
      progressMs,
      clientSeq: seq,
      sentAtMs: now,
    };
    void api
      .sendListenTogetherPlayCommand(active.roomId, {
        commandType: playStatus,
        playStatus,
        progressMs,
        targetSongId: current.providerId,
        formerSongId: current.providerId,
        clientSeq: seq,
      })
      .catch(() => {});
  }

  function reportTrackChange(nextTrack: Track, formerProviderId: string | null, nextQueueTracks?: Track[]) {
    const active = roomRef.current;
    if (!active || isSuppressedEcho() || nextTrack.source !== "netease" || !nextTrack.providerId) return;
    const now = Date.now();
    const seq = nextSeq();
    const targetId = nextTrack.providerId;
    lastLocalCommandAtRef.current = now;
    lastLocalSentRef.current = {
      songId: targetId,
      playStatus: "PLAY",
      progressMs: 0,
      clientSeq: seq,
      sentAtMs: now,
    };
    void api
      .sendListenTogetherPlayCommand(active.roomId, {
        commandType: "GOTO",
        playStatus: "PLAY",
        progressMs: 0,
        targetSongId: targetId,
        formerSongId: formerProviderId ?? "-1",
        clientSeq: seq,
      })
      .catch(() => {});

    if (nextQueueTracks?.length) {
      const displayList = nextQueueTracks
        .filter((t) => t.source === "netease" && t.providerId && /^\d+$/.test(t.providerId))
        .map((t) => t.providerId!);
      if (displayList.length) {
        const nextVersion = Math.max(1, playlistVersionRef.current + 1);
        setPlaylistVersion(nextVersion);
        void api
          .syncListenTogetherPlaylist(active.roomId, {
            commandType: "REPLACE",
            version: nextVersion,
            displayList,
          })
          .catch(() => {});
      }
    }
  }

  function reportSeek(seconds: number) {
    const active = roomRef.current;
    const current = activeTrackRef.current;
    if (!active || isSuppressedEcho() || current.source !== "netease" || !current.providerId) return;
    const now = Date.now();
    lastLocalSeekAtRef.current = now;
    lastLocalCommandAtRef.current = now;
    if (seekDebounceTimerRef.current !== null) window.clearTimeout(seekDebounceTimerRef.current);
    seekDebounceTimerRef.current = window.setTimeout(() => {
      seekDebounceTimerRef.current = null;
      const liveRoom = roomRef.current;
      const liveTrack = activeTrackRef.current;
      if (!liveRoom || liveTrack.source !== "netease" || !liveTrack.providerId) return;
      const seq = nextSeq();
      const progressMs = Math.max(0, Math.round(seconds * 1000));
      const playStatus = playingRef.current ? "PLAY" : "PAUSE";
      const sentAtMs = Date.now();
      lastLocalCommandAtRef.current = sentAtMs;
      lastLocalSentRef.current = {
        songId: liveTrack.providerId,
        playStatus,
        progressMs,
        clientSeq: seq,
        sentAtMs,
      };
      void api
        .sendListenTogetherPlayCommand(liveRoom.roomId, {
          commandType: "SEEK",
          playStatus,
          progressMs,
          targetSongId: liveTrack.providerId,
          formerSongId: liveTrack.providerId,
          clientSeq: seq,
        })
        .catch(() => {});
    }, 240);
  }

  /**
   * Guards track switching when a NetEase Listen Together session is active:
   * clicking any non-NetEase source pauses the transition and opens an exit
   * prompt so the user does not unintentionally break room sync.
   */
  function guardTrackSelection(track: Track, queue?: Track[]): boolean {
    if (!roomRef.current) return false;
    if (track.source === "netease") return false;
    setPendingSourceExit({ track, queue });
    return true;
  }

  async function confirmExitAndPlay() {
    const pending = pendingSourceExit;
    setPendingSourceExit(null);
    await leaveRoom({ silent: true });
    callbacksRef.current.onNotice("已退出网易云一起听，正在切换音源播放");
    if (pending) {
      callbacksRef.current.onExecutePendingTrack(pending.track, pending.queue);
    }
  }

  function cancelSourceExit() {
    setPendingSourceExit(null);
  }

  return {
    room,
    isActive: Boolean(room),
    recoverableRoom,
    invites,
    contacts,
    sharedTracks,
    playlistVersion,
    loading,
    actionError,
    lastDriftMs,
    incomingInvite,
    pendingSourceExit,
    refreshInvites,
    createRoom,
    joinRoom,
    acceptIncomingInvite,
    dismissIncomingInvite,
    resumeRecoverableRoom,
    endRoomById,
    leaveRoom,
    syncNow,
    sendInviteToContact,
    reportPlayPause,
    reportTrackChange,
    reportSeek,
    guardTrackSelection,
    confirmExitAndPlay,
    cancelSourceExit,
    clearError: () => setActionError(null),
  };
}
