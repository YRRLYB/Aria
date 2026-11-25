import { describe, expect, it } from "vitest";
import {
  buildListenTogetherPlaySignature,
  evaluateRemotePlayInfoSync,
  type LocalSentPlaySnapshot,
} from "./listenTogetherSync";

const twoUsers = [
  { userId: "10001", nickname: "Host", avatarUrl: null },
  { userId: "10002", nickname: "Guest", avatarUrl: null },
];

const basePlayInfo = {
  songId: "186016",
  playStatus: "PLAY" as const,
  progressMs: 42_000,
  clientSeq: 3,
};

describe("listenTogetherSync", () => {
  it("never overrides or seeks a solo host while waiting for a friend", () => {
    const decision = evaluateRemotePlayInfoSync({
      room: {
        roomId: "room_1",
        roomUsers: [twoUsers[0]],
        playInfo: basePlayInfo,
      },
      rttMs: 40,
      forceAlign: false,
      nowMs: 100_000,
      lastLocalCommandAtMs: 0,
      lastProcessedPlaySig: null,
      lastLocalSent: null,
      selfUserId: "10001",
      currentSongId: "186016",
    });

    expect(decision).toEqual({
      kind: "skip",
      nextProcessedSig: buildListenTogetherPlaySignature("room_1", basePlayInfo),
      clearDrift: true,
    });
  });

  it("ignores repeated identical static NetEase snapshots instead of rubber-banding every poll", () => {
    const sig = buildListenTogetherPlaySignature("room_1", basePlayInfo);
    const decision = evaluateRemotePlayInfoSync({
      room: {
        roomId: "room_1",
        roomUsers: twoUsers,
        playInfo: basePlayInfo,
      },
      rttMs: 60,
      forceAlign: false,
      nowMs: 120_000,
      lastLocalCommandAtMs: 100_000,
      lastProcessedPlaySig: sig,
      lastLocalSent: null,
    });

    expect(decision).toEqual({
      kind: "skip",
      nextProcessedSig: sig,
      clearDrift: false,
    });
  });

  it("absorbs own recent heartbeat or command echoes without rewinding later polls", () => {
    const ownSent: LocalSentPlaySnapshot = {
      songId: "186016",
      playStatus: "PLAY",
      progressMs: 42_000,
      clientSeq: 3,
      sentAtMs: 99_000,
    };

    const decision = evaluateRemotePlayInfoSync({
      room: {
        roomId: "room_1",
        roomUsers: twoUsers,
        playInfo: basePlayInfo,
      },
      rttMs: 80,
      forceAlign: false,
      nowMs: 102_500,
      lastLocalCommandAtMs: 99_000,
      lastProcessedPlaySig: "room_1|186016|PLAY|32000|3|0|",
      lastLocalSent: ownSent,
    });

    expect(decision).toEqual({
      kind: "skip",
      nextProcessedSig: buildListenTogetherPlaySignature("room_1", basePlayInfo),
      clearDrift: false,
    });
  });

  it("applies genuine remote updates from partner and forceAlign requests", () => {
    const nextPlayInfo = { songId: "999001", playStatus: "PLAY" as const, progressMs: 65_000, clientSeq: 4 };
    const partnerUpdate = evaluateRemotePlayInfoSync({
      room: {
        roomId: "room_1",
        roomUsers: twoUsers,
        playInfo: nextPlayInfo,
      },
      rttMs: 100,
      forceAlign: false,
      nowMs: 120_000,
      lastLocalCommandAtMs: 100_000,
      lastProcessedPlaySig: buildListenTogetherPlaySignature("room_1", basePlayInfo),
      lastLocalSent: {
        songId: "186016",
        playStatus: "PLAY",
        progressMs: 42_000,
        clientSeq: 3,
        sentAtMs: 99_000,
      },
    });

    expect(partnerUpdate).toEqual({
      kind: "apply",
      nextProcessedSig: buildListenTogetherPlaySignature("room_1", nextPlayInfo),
      expectedMs: 65_050,
      expectedSec: 65.05,
    });

    const forced = evaluateRemotePlayInfoSync({
      room: {
        roomId: "room_1",
        roomUsers: twoUsers,
        playInfo: basePlayInfo,
      },
      rttMs: 40,
      forceAlign: true,
      nowMs: 100_100,
      lastLocalCommandAtMs: 100_050,
      lastProcessedPlaySig: buildListenTogetherPlaySignature("room_1", basePlayInfo),
      lastLocalSent: null,
    });

    expect(forced).toEqual({
      kind: "apply",
      nextProcessedSig: buildListenTogetherPlaySignature("room_1", basePlayInfo),
      expectedMs: 42_020,
      expectedSec: 42.02,
    });
  });

  it("immediately applies partner commands and track switches even inside the local grace window or before roomUsers refreshes", () => {
    const partnerPlayCmd = {
      songId: "999001",
      playStatus: "PLAY" as const,
      progressMs: 0,
      clientSeq: 4,
      operatorUserId: "10002",
      commandType: "GOTO",
    };

    const decision = evaluateRemotePlayInfoSync({
      room: {
        roomId: "room_1",
        roomUsers: [twoUsers[0]],
        playInfo: partnerPlayCmd,
      },
      rttMs: 50,
      forceAlign: false,
      nowMs: 100_500,
      lastLocalCommandAtMs: 100_000,
      lastProcessedPlaySig: buildListenTogetherPlaySignature("room_1", basePlayInfo),
      lastLocalSent: {
        songId: "186016",
        playStatus: "PLAY",
        progressMs: 42_000,
        clientSeq: 3,
        sentAtMs: 100_000,
      },
      selfUserId: "10001",
      currentSongId: "186016",
    });

    expect(decision).toEqual({
      kind: "apply",
      nextProcessedSig: buildListenTogetherPlaySignature("room_1", partnerPlayCmd),
      expectedMs: 25,
      expectedSec: 0.025,
    });

    const unnamedSwitch = {
      songId: "888777",
      playStatus: "PLAY" as const,
      progressMs: 1000,
      clientSeq: 5,
    };

    const switchDecision = evaluateRemotePlayInfoSync({
      room: {
        roomId: "room_1",
        roomUsers: twoUsers,
        playInfo: unnamedSwitch,
      },
      rttMs: 40,
      forceAlign: false,
      nowMs: 100_400,
      lastLocalCommandAtMs: 100_000,
      lastProcessedPlaySig: buildListenTogetherPlaySignature("room_1", basePlayInfo),
      lastLocalSent: {
        songId: "186016",
        playStatus: "PLAY",
        progressMs: 42_000,
        clientSeq: 3,
        sentAtMs: 100_000,
      },
      selfUserId: "10001",
      currentSongId: "186016",
    });

    expect(switchDecision).toEqual({
      kind: "apply",
      nextProcessedSig: buildListenTogetherPlaySignature("room_1", unnamedSwitch),
      expectedMs: 1020,
      expectedSec: 1.02,
    });
  });

  it("never resets playback at 3 seconds when NetEase echoes own GOTO command with higher serverSeq", () => {
    const serverEcho = {
      songId: "186016",
      playStatus: "PLAY" as const,
      progressMs: 0,
      clientSeq: 5,
      serverSeq: 128,
      commandType: "GOTO",
      operatorUserId: "10001",
    };

    const withOperator = evaluateRemotePlayInfoSync({
      room: {
        roomId: "room_1",
        roomUsers: twoUsers,
        playInfo: serverEcho,
      },
      rttMs: 40,
      forceAlign: false,
      nowMs: 103_600,
      lastLocalCommandAtMs: 100_000,
      lastProcessedPlaySig: "room_1|111|PLAY|50000|4|127|PLAY",
      lastLocalSent: {
        songId: "186016",
        playStatus: "PLAY",
        progressMs: 0,
        clientSeq: 5,
        sentAtMs: 100_000,
      },
      selfUserId: "10001",
      currentSongId: "186016",
    });

    expect(withOperator).toEqual({
      kind: "skip",
      nextProcessedSig: buildListenTogetherPlaySignature("room_1", serverEcho),
      clearDrift: false,
    });

    const echoWithoutOperator = {
      songId: "186016",
      playStatus: "PLAY" as const,
      progressMs: 0,
      clientSeq: 999,
      serverSeq: 999,
      commandType: "GOTO",
    };

    const withoutOperator = evaluateRemotePlayInfoSync({
      room: {
        roomId: "room_1",
        roomUsers: twoUsers,
        playInfo: echoWithoutOperator,
      },
      rttMs: 40,
      forceAlign: false,
      nowMs: 103_600,
      lastLocalCommandAtMs: 100_000,
      lastProcessedPlaySig: "room_1|111|PLAY|50000|4|127|PLAY",
      lastLocalSent: {
        songId: "186016",
        playStatus: "PLAY",
        progressMs: 0,
        clientSeq: 5,
        sentAtMs: 100_000,
      },
      selfUserId: "10001",
      currentSongId: "186016",
    });

    expect(withoutOperator).toEqual({
      kind: "skip",
      nextProcessedSig: buildListenTogetherPlaySignature("room_1", echoWithoutOperator),
      clearDrift: false,
    });
  });
});
