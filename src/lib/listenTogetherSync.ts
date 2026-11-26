import type { ListenTogetherPlayInfo, ListenTogetherRoom } from "./api";

export type LocalSentPlaySnapshot = {
  songId: string | null;
  formerSongId?: string | null;
  playStatus: "PLAY" | "PAUSE";
  progressMs: number;
  clientSeq: number;
  sentAtMs: number;
};

export function buildListenTogetherPlaySignature(
  roomId: string,
  playInfo: ListenTogetherPlayInfo | null | undefined,
): string | null {
  if (!playInfo) return null;
  return `${roomId}|${playInfo.songId ?? ""}|${playInfo.playStatus}|${playInfo.progressMs}|${playInfo.clientSeq}|${playInfo.serverSeq ?? 0}|${playInfo.commandType ?? ""}`;
}

export type RemoteSyncEvaluation =
  | { kind: "skip"; nextProcessedSig: string | null; clearDrift: boolean }
  | { kind: "apply"; nextProcessedSig: string; expectedMs: number; expectedSec: number };

function isOwnRecentEcho(
  playInfo: ListenTogetherPlayInfo,
  lastLocalSent: LocalSentPlaySnapshot | null,
  nowMs: number,
  isExplicitPartnerCommand: boolean,
  isExplicitOwnCommand: boolean,
): boolean {
  if (isExplicitPartnerCommand || !lastLocalSent) return false;
  if (playInfo.songId !== lastLocalSent.songId) return false;
  if (playInfo.playStatus !== lastLocalSent.playStatus) return false;
  if (isExplicitOwnCommand) return true;
  if (nowMs - lastLocalSent.sentAtMs > 15_000) return false;
  // Server echoes of our fresh GOTO / PLAY command at 0:00 may carry a higher serverSeq.
  if (playInfo.progressMs === 0 && lastLocalSent.progressMs === 0) return true;
  if (playInfo.clientSeq > 0 && playInfo.clientSeq > lastLocalSent.clientSeq) return false;
  return Math.abs(playInfo.progressMs - lastLocalSent.progressMs) <= 3000;
}

export function evaluateRemotePlayInfoSync(options: {
  room: Pick<ListenTogetherRoom, "roomId" | "roomUsers" | "playInfo">;
  rttMs: number;
  forceAlign: boolean;
  nowMs: number;
  lastLocalCommandAtMs: number;
  lastProcessedPlaySig: string | null;
  lastLocalSent: LocalSentPlaySnapshot | null;
  selfUserId?: string | null;
  currentSongId?: string | null;
}): RemoteSyncEvaluation {
  const {
    room,
    rttMs,
    forceAlign,
    nowMs,
    lastLocalCommandAtMs,
    lastProcessedPlaySig,
    lastLocalSent,
    selfUserId,
    currentSongId,
  } = options;
  const playInfo = room.playInfo;
  if (!playInfo) {
    return { kind: "skip", nextProcessedSig: lastProcessedPlaySig, clearDrift: false };
  }

  const playSig = buildListenTogetherPlaySignature(room.roomId, playInfo)!;
  const partnerJoined = room.roomUsers.length >= 2;
  const isExplicitOwnCommand = Boolean(
    playInfo.operatorUserId && selfUserId && playInfo.operatorUserId === selfUserId,
  );
  const isExplicitPartnerCommand = Boolean(
    playInfo.operatorUserId && selfUserId && playInfo.operatorUserId !== selfUserId,
  );
  const isStalePreSwitchEcho = Boolean(
    !isExplicitPartnerCommand &&
      nowMs - lastLocalCommandAtMs < 3500 &&
      lastLocalSent?.formerSongId &&
      playInfo.songId === lastLocalSent.formerSongId &&
      playInfo.clientSeq < lastLocalSent.clientSeq,
  );
  const isRemoteSongSwitch = Boolean(
    !isExplicitOwnCommand &&
      !isStalePreSwitchEcho &&
      playInfo.songId &&
      playInfo.songId !== lastLocalSent?.songId &&
      playInfo.songId !== currentSongId,
  );

  // Never rewind or override our own explicit echoed command when polling passively.
  if (!forceAlign && isExplicitOwnCommand && !isRemoteSongSwitch) {
    return { kind: "skip", nextProcessedSig: playSig, clearDrift: false };
  }

  // Solo host mode: do not override host playback while waiting alone, unless
  // a partner explicitly sent a command or switched the room's song.
  if (!forceAlign && !partnerJoined && !isExplicitPartnerCommand && !isRemoteSongSwitch) {
    return { kind: "skip", nextProcessedSig: playSig, clearDrift: true };
  }

  // Own echo guard: absorb our own command or heartbeat echo so subsequent polls don't rewind local playback.
  if (
    !forceAlign &&
    isOwnRecentEcho(playInfo, lastLocalSent, nowMs, isExplicitPartnerCommand, isExplicitOwnCommand)
  ) {
    return { kind: "skip", nextProcessedSig: playSig, clearDrift: false };
  }

  // Short grace window right after issuing a local command, unless the incoming
  // snapshot is clearly a partner command or partner track switch.
  if (!forceAlign && !isExplicitPartnerCommand && !isRemoteSongSwitch && nowMs - lastLocalCommandAtMs < 2600) {
    return { kind: "skip", nextProcessedSig: lastProcessedPlaySig, clearDrift: false };
  }

  // NetEase endpoints return static snapshots rather than ticking progress server-side.
  if (!forceAlign && playSig === lastProcessedPlaySig) {
    return { kind: "skip", nextProcessedSig: playSig, clearDrift: false };
  }

  const remotePlaying = playInfo.playStatus === "PLAY";
  const halfRttMs = remotePlaying ? Math.min(Math.max(0, rttMs) / 2, 1200) : 0;
  const expectedMs = Math.max(0, playInfo.progressMs + halfRttMs);

  return {
    kind: "apply",
    nextProcessedSig: playSig,
    expectedMs,
    expectedSec: expectedMs / 1000,
  };
}
