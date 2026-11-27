import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Track } from "@/data/music";
import {
  api,
  apiUrl,
  type AriaRoomConfigSnapshot,
  type AriaRoomControlMode,
  type AriaRoomNetworkMode,
  type AriaRoomSnapshot,
  type AriaRoomSyncEvent,
  type AriaRoomTrackPayload,
  type AriaSignalingProvider,
  type CloudflareIpProbeResult,
} from "@/lib/api";
import {
  appendAvatarHistory,
  clearSavedAriaRoomSession,
  compressAvatarFile,
  readAriaRoomProfile,
  readSavedAriaRoomSession,
  resolveAriaRoomIdentity,
  writeAriaRoomProfile,
  writeSavedAriaRoomSession,
  type AriaRoomProfile,
  type AriaSourceAccountSummary,
} from "@/lib/ariaRoomProfile";
import {
  ClockSyncTracker,
  applyPlaybackSyncToState,
  ariaPayloadToGuestTrack,
  ariaPayloadToHostTrack,
  canonicalTrackId,
  computeExpectedPlaybackSec,
  computeScheduledStartDelayMs,
  createTrackNonce,
  decodeAriaJoinInput,
  decodeMediaPacket,
  encodeMediaPacket,
  evaluateAriaRoomDrift,
  mergeIncomingPlaybackState,
  trackToAriaPayload,
} from "@/lib/ariaRoomSync";

const MAX_BUFFERED_BYTES = 1024 * 1024;
const LOW_WATERMARK_BYTES = 256 * 1024;
const P2P_CHUNK_SIZE = 64 * 1024;

type PeerBundle = {
  peerId: string;
  pc: RTCPeerConnection;
  controlChannel: RTCDataChannel | null;
  mediaChannel: RTCDataChannel | null;
  queuedNonces: Set<string>;
  pumpedNonces: Set<string>;
  pumping: boolean;
  currentPumpingNonce: string | null;
  pumpQueuedAgain: boolean;
  pumpAbort: AbortController | null;
  disconnectTimer: number | null;
  pendingCandidates: RTCIceCandidateInit[];
};

const EMPTY_SNAPSHOT: AriaRoomSnapshot = {
  active: false,
  role: null,
  roomId: null,
  myPeerId: null,
  maxMembers: 5,
  networkMode: "cloudflare",
  controlMode: "collaborative",
  signalingState: "idle",
  signalingConnectedIp: null,
  signalingLatencyMs: null,
  signalingError: null,
  directServer: {
    active: false,
    port: 3639,
    roomToken: null,
    lanAddresses: [],
    ipv6Addresses: [],
    publicHost: null,
    shareString: null,
    error: null,
  },
  guestDirectBaseUrl: null,
  guestDirectToken: null,
  members: [],
  playback: {
    nonce: null,
    track: null,
    nextTrack: null,
    queue: [],
    playing: false,
    positionSec: 0,
    updatedAtMs: 0,
    serverSeq: 0,
  },
  localCapabilities: {
    netease: "none",
    qq: "none",
    bilibili: "free",
    youtube: "unreachable",
  },
  shareEnabled: true,
  iceConfig: { iceServers: [] },
};

const DEFAULT_CONFIG: AriaRoomConfigSnapshot = {
  signalingProvider: "cloudflare",
  signalingUrl: "",
  selfHostedSignalingUrl: "",
  preferredIps: [],
  autoPreferredIp: true,
  selectedPreferredIp: null,
  directPort: 3639,
  publicHost: "",
  turnUrls: [],
  turnUsername: "",
  turnCredential: "",
};

async function waitChannelBackpressure(
  channel: RTCDataChannel,
  signal: AbortSignal,
): Promise<void> {
  if (channel.readyState !== "open" || channel.bufferedAmount < MAX_BUFFERED_BYTES) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      channel.removeEventListener("bufferedamountlow", onLow);
      channel.removeEventListener("close", onClose);
      signal.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve();
    };
    const onLow = () => done();
    const onClose = () => done(new Error("DataChannel closed"));
    const onAbort = () => done(new Error("Aborted"));
    const timer = window.setTimeout(() => done(), 4_000);

    channel.bufferedAmountLowThreshold = LOW_WATERMARK_BYTES;
    channel.addEventListener("bufferedamountlow", onLow);
    channel.addEventListener("close", onClose);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export type UseAriaRoomOptions = {
  activeTrack: Track | null;
  playQueueTracks: Track[];
  playing: boolean;
  durationSeconds: number;
  getPlaybackTime: () => number;
  accounts: AriaSourceAccountSummary[];
  onBeforeEnterAriaRoom?: () => Promise<void> | void;
  onApplyRemoteQueue?: (queue: Track[]) => void;
  onApplyRemoteTrack: (track: Track, queue: Track[], playing: boolean, positionSec: number) => void;
  onApplyRemotePlaying: (playing: boolean, positionSec?: number) => void;
  onApplyRemoteSeek: (positionSec: number) => void;
  onApplyPlaybackSpeed?: (rate: number) => void;
  onAutoAdvanceTrack?: () => void;
  onHostRelayStreamOverride?: (override: { trackId: string; streamUrl: string } | null) => void;
  onHostExecuteCommand?: (command: {
    fromPeerId: string;
    action: string;
    payload: unknown;
  }) => void;
  onNotice?: (message: string) => void;
};

export function useAriaRoom(options: UseAriaRoomOptions) {
  const [profile, setProfile] = useState<AriaRoomProfile>(() => readAriaRoomProfile());
  const [snapshot, setSnapshot] = useState<AriaRoomSnapshot>(EMPTY_SNAPSHOT);
  const [config, setConfig] = useState<AriaRoomConfigSnapshot>(DEFAULT_CONFIG);
  const [probeResults, setProbeResults] = useState<CloudflareIpProbeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [probingIps, setProbingIps] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [clockOffsetMs, setClockOffsetMs] = useState(0);
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [lastDriftMs, setLastDriftMs] = useState<number | null>(null);
  const [bufferProgress, setBufferProgress] = useState<{ downloadedBytes: number; totalBytes: number | null; completed: boolean } | null>(null);

  const identity = useMemo(
    () => resolveAriaRoomIdentity(profile, options.accounts),
    [profile, options.accounts],
  );

  const callbacksRef = useRef(options);
  callbacksRef.current = options;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const clockOffsetRef = useRef(clockOffsetMs);
  clockOffsetRef.current = clockOffsetMs;

  const peersRef = useRef<Map<string, PeerBundle>>(new Map());
  const clockTrackerRef = useRef(new ClockSyncTracker(8));
  const clockSyncedRef = useRef<boolean>(false);
  const lastDriftSeekAtRef = useRef<number>(0);
  const trackAppliedAtRef = useRef<number>(0);
  const lastDriftSampleRef = useRef<{
    actualSec: number;
    seekStreak: number;
    seekSign: number;
    speedStreak: number;
    speedSign: number;
    speedActive: boolean;
  }>({
    actualSec: 0,
    seekStreak: 0,
    seekSign: 0,
    speedStreak: 0,
    speedSign: 0,
    speedActive: false,
  });
  const lastAppliedNonceRef = useRef<string | null>(null);
  const lastAppliedSeqRef = useRef<number>(0);
  const syncTimerRef = useRef<number | null>(null);
  const suppressDriftUntilRef = useRef<number>(0);
  const pendingGuestPlayIntentRef = useRef<{
    playing: boolean;
    createdAt: number;
    expiresAt: number;
  } | null>(null);
  const pendingInitialAlignRef = useRef<{ trackId: string; nonce: string } | null>(null);
  const handledControlCmdIdsRef = useRef<Set<string>>(new Set());
  const trackIdNonceMapRef = useRef<Map<string, string>>(new Map());
  const lastAppliedQueueSigRef = useRef<string>("");
  const remotePayloadMetaRef = useRef<Map<string, AriaRoomTrackPayload>>(new Map());
  const guestChunkChainRef = useRef<Promise<void>>(Promise.resolve());
  const readyReportedNoncesRef = useRef<Set<string>>(new Set());
  const prefetchedNextNonceRef = useRef<string | null>(null);
  const autoRejoinAttemptedRef = useRef<boolean>(false);
  const lastSentPresenceRef = useRef<"active" | null>(null);

  const markControlCommandHandled = useCallback((commandId?: unknown): boolean => {
    if (typeof commandId !== "string" || !commandId) return true;
    const seen = handledControlCmdIdsRef.current;
    if (seen.has(commandId)) return false;
    seen.add(commandId);
    if (seen.size > 64) {
      const oldest = seen.values().next().value;
      if (oldest) seen.delete(oldest);
    }
    return true;
  }, []);

  const clearScheduledSyncTimer = () => {
    if (syncTimerRef.current !== null) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
  };

  const cleanupPeer = useCallback((peerId: string) => {
    const bundle = peersRef.current.get(peerId);
    if (!bundle) return;
    peersRef.current.delete(peerId);
    bundle.pumpAbort?.abort();
    if (bundle.disconnectTimer !== null) {
      window.clearTimeout(bundle.disconnectTimer);
    }
    try {
      bundle.controlChannel?.close();
      bundle.mediaChannel?.close();
      bundle.pc.close();
    } catch {
      // ignore
    }
  }, []);

  const cleanupAllPeers = useCallback(() => {
    for (const id of Array.from(peersRef.current.keys())) {
      cleanupPeer(id);
    }
  }, [cleanupPeer]);

  const sendControlChannelBroadcast = useCallback((payload: unknown) => {
    const encoded = JSON.stringify(payload);
    for (const bundle of peersRef.current.values()) {
      if (bundle.controlChannel?.readyState === "open") {
        try {
          bundle.controlChannel.send(encoded);
        } catch {
          // Fallback WS delivers it reliably.
        }
      }
    }
  }, []);

  const pumpQueuedNoncesToPeer = useCallback(async (bundle: PeerBundle) => {
    const snap = snapshotRef.current;
    if (!snap.active) return;
    const channel = bundle.mediaChannel;
    if (!channel || channel.readyState !== "open") return;
    if (bundle.pumping) {
      bundle.pumpQueuedAgain = true;
      return;
    }

    bundle.pumping = true;
    const controller = new AbortController();
    bundle.pumpAbort = controller;

    const streamOneTrack = async (nonce: string) => {
      bundle.currentPumpingNonce = nonce;
      let offset = 0;
      while (!controller.signal.aborted && channel.readyState === "open") {
        await waitChannelBackpressure(channel, controller.signal);
        if (controller.signal.aborted || channel.readyState !== "open") break;

        const res = await fetch(
          apiUrl(`/api/aria-room/host/tracks/${encodeURIComponent(nonce)}/slice?offset=${offset}&length=${P2P_CHUNK_SIZE}`),
          { signal: controller.signal },
        );
        if (!res.ok) {
          throw new Error(`Slice fetch failed (${res.status})`);
        }
        const rawBuf = await res.arrayBuffer();
        const eof = res.headers.get("X-Aria-Eof") === "1";
        const totalHeader = res.headers.get("X-Aria-Total-Bytes");
        const totalBytes = totalHeader ? Number(totalHeader) : null;
        const mimeType = res.headers.get("X-Aria-Mime-Type") || "application/octet-stream";
        const bitrate = res.headers.get("X-Aria-Bitrate") ? Number(res.headers.get("X-Aria-Bitrate")) : null;
        const sampleRate = res.headers.get("X-Aria-Sample-Rate") ? Number(res.headers.get("X-Aria-Sample-Rate")) : null;
        const currentLevel = res.headers.get("X-Aria-Level") || null;

        const packet = encodeMediaPacket(
          {
            nonce,
            offset,
            totalBytes: totalBytes && Number.isFinite(totalBytes) ? totalBytes : null,
            eof,
            mimeType,
            bitrate: bitrate && Number.isFinite(bitrate) ? bitrate : null,
            sampleRate: sampleRate && Number.isFinite(sampleRate) ? sampleRate : null,
            currentLevel,
          },
          rawBuf,
        );

        await waitChannelBackpressure(channel, controller.signal);
        channel.send(packet);
        offset += rawBuf.byteLength;
        if (eof) break;
        if (rawBuf.byteLength === 0) {
          await new Promise((r) => window.setTimeout(r, 120));
        }
      }
    };

    try {
      do {
        bundle.pumpQueuedAgain = false;
        const pending = Array.from(bundle.queuedNonces).filter((n) => !bundle.pumpedNonces.has(n));
        for (const nonce of pending) {
          if (controller.signal.aborted || channel.readyState !== "open") break;
          await streamOneTrack(nonce);
          if (!controller.signal.aborted && channel.readyState === "open") {
            bundle.pumpedNonces.add(nonce);
            bundle.queuedNonces.delete(nonce);
          }
        }
      } while (bundle.pumpQueuedAgain && !controller.signal.aborted && channel.readyState === "open");
    } catch {
      // Aborted or disconnected; ICE restart or reconnect resumes cleanly.
    } finally {
      bundle.pumping = false;
      bundle.currentPumpingNonce = null;
      if (bundle.pumpAbort === controller) {
        bundle.pumpAbort = null;
      }
    }
  }, []);

  const handleIncomingPlaybackSync = useCallback((event: AriaRoomSyncEvent) => {
    const currentSnap = snapshotRef.current;
    if (currentSnap.role !== "guest") return;
    if (event.nonce && currentSnap.playback.nonce && event.nonce !== currentSnap.playback.nonce) {
      return;
    }
    if (event.seq <= lastAppliedSeqRef.current) return;

    const intent = pendingGuestPlayIntentRef.current;
    if (intent) {
      if (Date.now() >= intent.expiresAt) {
        pendingGuestPlayIntentRef.current = null;
      } else {
        const matchesIntent =
          (event.kind === "pause" && !intent.playing) ||
          (event.kind === "play_at" && intent.playing);
        const opposesIntent =
          (event.kind === "play_at" && !intent.playing) ||
          (event.kind === "pause" && intent.playing);
        if (matchesIntent) {
          pendingGuestPlayIntentRef.current = null;
        } else if (opposesIntent) {
          const staleInFlight = clockSyncedRef.current
            ? event.serverTimeMs > 0 && event.serverTimeMs < intent.createdAt + clockOffsetRef.current - 50
            : Date.now() - intent.createdAt < 1_500;
          if (staleInFlight) {
            return;
          }
          pendingGuestPlayIntentRef.current = null;
        }
      }
    }

    lastAppliedSeqRef.current = event.seq;

    const updatedPlayback = applyPlaybackSyncToState(currentSnap.playback, event);
    if (updatedPlayback !== currentSnap.playback) {
      snapshotRef.current = { ...currentSnap, playback: updatedPlayback };
      setSnapshot((prev) =>
        prev.role === "guest"
          ? { ...prev, playback: applyPlaybackSyncToState(prev.playback, event) }
          : prev,
      );
    }

    clearScheduledSyncTimer();
    const cb = callbacksRef.current;

    if (event.kind === "pause") {
      lastDriftSeekAtRef.current = Date.now();
      suppressDriftUntilRef.current = Date.now() + 900;
      cb.onApplyPlaybackSpeed?.(1);
      cb.onApplyRemotePlaying(false, event.positionSec);
      return;
    }

    if (event.kind === "seek") {
      lastDriftSeekAtRef.current = Date.now();
      suppressDriftUntilRef.current = Date.now() + 900;
      cb.onApplyPlaybackSpeed?.(1);
      cb.onApplyRemoteSeek(event.positionSec);
      return;
    }

    if (event.kind === "play_at") {
      const clockReady = clockSyncedRef.current || clockTrackerRef.current.hasSamples();
      const delayMs = clockReady
        ? computeScheduledStartDelayMs({
            startAtHostMs: event.startAtHostMs,
            localNowMs: Date.now(),
            clockOffsetMs: clockOffsetRef.current,
          })
        : 0;

      const applyNow = () => {
        lastDriftSeekAtRef.current = Date.now();
        suppressDriftUntilRef.current = Date.now() + 900;
        const driftCorrectedPos =
          clockReady && delayMs === 0 && event.startAtHostMs > 0
            ? Math.max(0, event.positionSec + Math.max(0, (Date.now() + clockOffsetRef.current - event.startAtHostMs) / 1000))
            : event.positionSec;
        cb.onApplyRemotePlaying(true, driftCorrectedPos);
      };

      if (delayMs > 12) {
        suppressDriftUntilRef.current = Date.now() + delayMs + 900;
        syncTimerRef.current = window.setTimeout(applyNow, delayMs);
      } else {
        applyNow();
      }
    }
  }, []);

  const setupGuestChunkReceiver = useCallback((channel: RTCDataChannel) => {
    channel.binaryType = "arraybuffer";
    channel.onmessage = (evt) => {
      if (!(evt.data instanceof ArrayBuffer)) return;
      let decoded: ReturnType<typeof decodeMediaPacket>;
      try {
        decoded = decodeMediaPacket(evt.data);
      } catch {
        return;
      }

      const { header, payload } = decoded;
      guestChunkChainRef.current = guestChunkChainRef.current
        .then(async () => {
          const snap = snapshotRef.current;
          if (!snap.active) return;
          const activeNonce = snap.playback.nonce;
          const nextNonce = snap.playback.nextTrack?.nonce;
          if (
            activeNonce &&
            header.nonce !== activeNonce &&
            header.nonce !== nextNonce
          ) {
            return;
          }
          const resp = await fetch(apiUrl("/api/aria-room/guest/chunk"), {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "X-Aria-Nonce": header.nonce,
              "X-Aria-Offset": String(header.offset),
              "X-Aria-Eof": header.eof ? "1" : "0",
              ...(header.totalBytes !== null ? { "X-Aria-Total-Bytes": String(header.totalBytes) } : {}),
              ...(header.mimeType ? { "X-Aria-Mime-Type": header.mimeType } : {}),
              ...(header.bitrate ? { "X-Aria-Bitrate": String(header.bitrate) } : {}),
              ...(header.sampleRate ? { "X-Aria-Sample-Rate": String(header.sampleRate) } : {}),
              ...(header.currentLevel ? { "X-Aria-Level": header.currentLevel } : {}),
            },
            body: payload,
          });
          if (!resp.ok) return;
          const result = (await resp.json()) as {
            downloadedBytes: number;
            totalBytes: number | null;
            completed: boolean;
          };
          if (snapshotRef.current.playback.nonce === header.nonce) {
            setBufferProgress({
              downloadedBytes: result.downloadedBytes,
              totalBytes: result.totalBytes,
              completed: result.completed,
            });
          }
          if (
            (result.downloadedBytes >= P2P_CHUNK_SIZE || result.completed) &&
            !readyReportedNoncesRef.current.has(header.nonce)
          ) {
            readyReportedNoncesRef.current.add(header.nonce);
            void api.sendAriaRoomTrackReady(header.nonce, result.downloadedBytes).catch(() => undefined);
          }
        })
        .catch(() => undefined);
    };
  }, []);

  const setupControlChannel = useCallback(
    (channel: RTCDataChannel, remotePeerId: string) => {
      channel.onmessage = (evt) => {
        if (typeof evt.data !== "string") return;
        try {
          const msg = JSON.parse(evt.data) as {
            type?: string;
            event?: AriaRoomSyncEvent;
            action?: string;
            payload?: unknown;
          };
          if (msg.type === "playback_sync" && msg.event) {
            handleIncomingPlaybackSync(msg.event);
          } else if (
            msg.type === "control_request" &&
            msg.action &&
            snapshotRef.current.role === "host" &&
            snapshotRef.current.controlMode === "collaborative"
          ) {
            const cmdId = (msg.payload as Record<string, unknown> | undefined)?.commandId;
            if (!markControlCommandHandled(cmdId)) return;
            callbacksRef.current.onHostExecuteCommand?.({
              fromPeerId: remotePeerId,
              action: msg.action,
              payload: msg.payload,
            });
          }
        } catch {
          // ignore
        }
      };
    },
    [handleIncomingPlaybackSync, markControlCommandHandled],
  );

  const isPeerHealthyForReuse = (bundle: PeerBundle | undefined): bundle is PeerBundle => {
    if (!bundle) return false;
    const state = bundle.pc.connectionState;
    const iceState = bundle.pc.iceConnectionState;
    if (state === "closed" || state === "failed" || state === "disconnected") return false;
    if (iceState === "closed" || iceState === "failed") return false;
    if (bundle.pc.localDescription && bundle.mediaChannel?.readyState === "closed") return false;
    return true;
  };

  const ensurePeerConnection = useCallback(
    (remotePeerId: string, isInitiator: boolean): PeerBundle => {
      const existing = peersRef.current.get(remotePeerId);
      if (isPeerHealthyForReuse(existing)) {
        return existing;
      }
      if (existing) {
        cleanupPeer(remotePeerId);
      }

      const iceServers = snapshotRef.current.iceConfig.iceServers;
      const pc = new RTCPeerConnection({ iceServers });

      const bundle: PeerBundle = {
        peerId: remotePeerId,
        pc,
        controlChannel: null,
        mediaChannel: null,
        queuedNonces: new Set(),
        pumpedNonces: new Set(),
        pumping: false,
        currentPumpingNonce: null,
        pumpQueuedAgain: false,
        pumpAbort: null,
        disconnectTimer: null,
        pendingCandidates: [],
      };

      pc.onicecandidate = (evt) => {
        if (evt.candidate) {
          void api
            .sendAriaRoomSignal(remotePeerId, { candidate: evt.candidate.toJSON() })
            .catch(() => undefined);
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "disconnected" && isInitiator) {
          if (bundle.disconnectTimer !== null) window.clearTimeout(bundle.disconnectTimer);
          bundle.disconnectTimer = window.setTimeout(() => {
            if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed") {
              void triggerIceRestart(bundle);
            }
          }, 2_500);
        } else if (pc.iceConnectionState === "failed" && isInitiator) {
          void triggerIceRestart(bundle);
        } else if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
          if (bundle.disconnectTimer !== null) {
            window.clearTimeout(bundle.disconnectTimer);
            bundle.disconnectTimer = null;
          }
        }
      };

      // Always accept incoming DataChannels regardless of initiator flag to prevent ICE-before-offer deadlocks.
      pc.ondatachannel = (evt) => {
        if (evt.channel.label === "control") {
          bundle.controlChannel = evt.channel;
          setupControlChannel(evt.channel, remotePeerId);
        } else if (evt.channel.label === "media") {
          evt.channel.binaryType = "arraybuffer";
          evt.channel.bufferedAmountLowThreshold = LOW_WATERMARK_BYTES;
          bundle.mediaChannel = evt.channel;
          setupGuestChunkReceiver(evt.channel);
          evt.channel.onopen = () => {
            void pumpQueuedNoncesToPeer(bundle);
          };
          if (evt.channel.readyState === "open") {
            void pumpQueuedNoncesToPeer(bundle);
          }
        }
      };

      if (isInitiator) {
        const control = pc.createDataChannel("control", { ordered: true });
        const media = pc.createDataChannel("media", { ordered: true });
        media.binaryType = "arraybuffer";
        media.bufferedAmountLowThreshold = LOW_WATERMARK_BYTES;
        bundle.controlChannel = control;
        bundle.mediaChannel = media;

        setupControlChannel(control, remotePeerId);
        setupGuestChunkReceiver(media);
        media.onopen = () => {
          void pumpQueuedNoncesToPeer(bundle);
        };
      }

      peersRef.current.set(remotePeerId, bundle);
      return bundle;

      async function triggerIceRestart(target: PeerBundle) {
        if (target.pc.signalingState === "closed") return;
        try {
          if (typeof target.pc.restartIce === "function") target.pc.restartIce();
          const offer = await target.pc.createOffer({ iceRestart: true });
          await target.pc.setLocalDescription(offer);
          await api.sendAriaRoomSignal(remotePeerId, { sdp: target.pc.localDescription });
        } catch {
          // Will retry on next reconnect.
        }
      }
    },
    [cleanupPeer, pumpQueuedNoncesToPeer, setupControlChannel, setupGuestChunkReceiver],
  );

  const requestPumpToPeer = useCallback(
    async (targetPeerId: string, nonces: string[]) => {
      const snap = snapshotRef.current;
      if (!snap.active || snap.networkMode === "direct") return;
      if (!targetPeerId || targetPeerId === snap.myPeerId || nonces.length === 0) return;
      if (typeof RTCPeerConnection === "undefined") return;

      const existing = peersRef.current.get(targetPeerId);
      const bundle = isPeerHealthyForReuse(existing)
        ? existing
        : ensurePeerConnection(targetPeerId, true);

      let addedAny = false;
      for (const nonce of nonces) {
        if (nonce && !bundle.pumpedNonces.has(nonce) && !bundle.queuedNonces.has(nonce)) {
          bundle.queuedNonces.add(nonce);
          addedAny = true;
        }
      }
      if (!addedAny && bundle.queuedNonces.size === 0) return;

      if (bundle.mediaChannel?.readyState === "open") {
        void pumpQueuedNoncesToPeer(bundle);
        return;
      }

      if (bundle.pc.signalingState === "stable" && !bundle.pc.localDescription) {
        try {
          const offer = await bundle.pc.createOffer();
          await bundle.pc.setLocalDescription(offer);
          await api.sendAriaRoomSignal(targetPeerId, { sdp: bundle.pc.localDescription });
        } catch {
          // Ignore transient signaling errors.
        }
      }
    },
    [ensurePeerConnection, pumpQueuedNoncesToPeer],
  );

  const handleSignalEvent = useCallback(
    async (data: { fromPeerId?: string; payload?: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }) => {
      const fromPeerId = data.fromPeerId;
      const payload = data.payload;
      if (!fromPeerId || !payload || typeof RTCPeerConnection === "undefined") return;

      const isOffer = payload.sdp?.type === "offer";
      const existing = peersRef.current.get(fromPeerId);
      const bundle = existing && existing.pc.connectionState !== "closed"
        ? existing
        : ensurePeerConnection(fromPeerId, false);
      const pc = bundle.pc;

      try {
        if (payload.sdp) {
          if (isOffer && pc.signalingState !== "stable") {
            const isPolite = (snapshotRef.current.myPeerId ?? "") < fromPeerId;
            if (!isPolite) return;
            await pc.setLocalDescription({ type: "rollback" }).catch(() => undefined);
          }
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          for (const queued of bundle.pendingCandidates.splice(0)) {
            await pc.addIceCandidate(new RTCIceCandidate(queued)).catch(() => undefined);
          }
          if (payload.sdp.type === "offer") {
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await api.sendAriaRoomSignal(fromPeerId, { sdp: pc.localDescription });
          }
        } else if (payload.candidate) {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => undefined);
          } else {
            bundle.pendingCandidates.push(payload.candidate);
          }
        }
      } catch {
        // Ignore stale ICE/SDP collisions.
      }
    },
    [ensurePeerConnection],
  );

  const [initialStatusReady, setInitialStatusReady] = useState(false);

  // Initial status & SSE live updates
  useEffect(() => {
    let cancelled = false;
    void api
      .getAriaRoomStatus()
      .then((res) => {
        if (cancelled) return;
        setSnapshot(res.snapshot);
        setConfig(res.config);
        setProbeResults(res.probeResults);
        setInitialStatusReady(true);
      })
      .catch(() => {
        if (!cancelled) setInitialStatusReady(true);
      });

    if (typeof EventSource === "undefined") {
      return () => {
        cancelled = true;
      };
    }

    const es = new EventSource(apiUrl("/api/aria-room/events"));
    es.addEventListener("state", (evt) => {
      try {
        const rawSnap = JSON.parse((evt as MessageEvent).data) as AriaRoomSnapshot;
        const prevSnap = snapshotRef.current;
        const mergedPlayback =
          rawSnap.active && rawSnap.role === "guest" && prevSnap.active && prevSnap.role === "guest"
            ? mergeIncomingPlaybackState(prevSnap.playback, rawSnap.playback)
            : rawSnap.playback;
        const nextSnap: AriaRoomSnapshot =
          mergedPlayback === rawSnap.playback ? rawSnap : { ...rawSnap, playback: mergedPlayback };

        snapshotRef.current = nextSnap;
        setSnapshot(nextSnap);
        if (!nextSnap.active) {
          cleanupAllPeers();
          clearScheduledSyncTimer();
          lastAppliedNonceRef.current = null;
          lastAppliedSeqRef.current = 0;
          lastAppliedQueueSigRef.current = "";
          remotePayloadMetaRef.current.clear();
          prefetchedNextNonceRef.current = null;
          pendingGuestPlayIntentRef.current = null;
          pendingInitialAlignRef.current = null;
          clockSyncedRef.current = false;
          clockOffsetRef.current = 0;
          lastDriftSeekAtRef.current = 0;
          trackAppliedAtRef.current = 0;
          lastDriftSampleRef.current = {
            actualSec: 0,
            seekStreak: 0,
            seekSign: 0,
            speedStreak: 0,
            speedSign: 0,
            speedActive: false,
          };
          setBufferProgress(null);
          setLastDriftMs(null);
          readyReportedNoncesRef.current.clear();
          lastSentPresenceRef.current = null;
          callbacksRef.current.onApplyPlaybackSpeed?.(1);
          callbacksRef.current.onHostRelayStreamOverride?.(null);
        } else if (nextSnap.role === "host") {
          const trackPayload = nextSnap.playback.track;
          const dispatch = trackPayload?.dispatch;
          if (
            trackPayload &&
            dispatch &&
            dispatch.providerPeerId !== nextSnap.myPeerId &&
            dispatch.mode !== "resolve_local"
          ) {
            callbacksRef.current.onHostRelayStreamOverride?.({
              trackId: trackPayload.id,
              streamUrl: `/api/aria-room/guest/stream/${encodeURIComponent(trackPayload.nonce)}`,
            });
          } else {
            callbacksRef.current.onHostRelayStreamOverride?.(null);
          }
        } else if (nextSnap.role === "guest") {
          callbacksRef.current.onHostRelayStreamOverride?.(null);
          const guestQueue = nextSnap.playback.queue.map(ariaPayloadToGuestTrack);
          const queueSig = nextSnap.playback.queue.map((q) => q.nonce).join("|");
          if (queueSig !== lastAppliedQueueSigRef.current) {
            lastAppliedQueueSigRef.current = queueSig;
            callbacksRef.current.onApplyRemoteQueue?.(guestQueue);
          }
          const trackPayload = nextSnap.playback.track;
          if (trackPayload && lastAppliedNonceRef.current !== trackPayload.nonce) {
            lastAppliedNonceRef.current = trackPayload.nonce;
            trackAppliedAtRef.current = Date.now();
            lastDriftSampleRef.current = {
              actualSec: 0,
              seekStreak: 0,
              seekSign: 0,
              speedStreak: 0,
              speedSign: 0,
              speedActive: false,
            };
            setBufferProgress(null);
            callbacksRef.current.onApplyPlaybackSpeed?.(1);
            const guestTrack = ariaPayloadToGuestTrack(trackPayload);
            pendingGuestPlayIntentRef.current = null;
            pendingInitialAlignRef.current = {
              trackId: guestTrack.id,
              nonce: trackPayload.nonce,
            };
            const initialPos = computeExpectedPlaybackSec({
              playback: nextSnap.playback,
              localNowMs: Date.now(),
              clockOffsetMs: clockOffsetRef.current,
              clockSynced: clockSyncedRef.current || clockTrackerRef.current.hasSamples(),
            });
            lastDriftSeekAtRef.current = Date.now();
            suppressDriftUntilRef.current = Date.now() + 1_200;
            callbacksRef.current.onApplyRemoteTrack(
              guestTrack,
              guestQueue.length ? guestQueue : [guestTrack],
              nextSnap.playback.playing,
              initialPos,
            );
          }
        }
      } catch {
        // ignore invalid payload
      }
    });

    es.addEventListener("peer_left", (evt) => {
      try {
        const data = JSON.parse((evt as MessageEvent).data) as { peerId?: string };
        if (data.peerId) cleanupPeer(data.peerId);
      } catch {
        // ignore
      }
    });

    es.addEventListener("signal", (evt) => {
      try {
        const data = JSON.parse((evt as MessageEvent).data);
        void handleSignalEvent(data);
      } catch {
        // ignore
      }
    });

    es.addEventListener("clock_pong", (evt) => {
      try {
        const sample = JSON.parse((evt as MessageEvent).data) as {
          t0: number;
          t1: number;
          t2: number;
          t3: number;
        };
        const estimate = clockTrackerRef.current.record(sample);
        clockOffsetRef.current = estimate.offsetMs;
        clockSyncedRef.current = true;
        setRttMs(estimate.rttMs);
        setClockOffsetMs(estimate.offsetMs);
      } catch {
        // ignore
      }
    });

    es.addEventListener("playback_sync", (evt) => {
      try {
        const syncEvt = JSON.parse((evt as MessageEvent).data) as AriaRoomSyncEvent;
        handleIncomingPlaybackSync(syncEvt);
      } catch {
        // ignore
      }
    });

    es.addEventListener("proxy_serve_request", (evt) => {
      try {
        const data = JSON.parse((evt as MessageEvent).data) as { targetPeerId?: string; nonce?: string };
        if (data.targetPeerId && data.nonce) {
          void requestPumpToPeer(data.targetPeerId, [data.nonce]);
        }
      } catch {
        // ignore
      }
    });

    es.addEventListener("prefetch_next", (evt) => {
      try {
        const nextTrack = JSON.parse((evt as MessageEvent).data) as AriaRoomTrackPayload;
        const snap = snapshotRef.current;
        if (
          nextTrack?.nonce &&
          snap.active &&
          snap.networkMode !== "direct" &&
          nextTrack.dispatch?.mode === "stream_proxy" &&
          nextTrack.dispatch.providerPeerId === snap.myPeerId
        ) {
          for (const member of snap.members) {
            if (
              member.peerId !== snap.myPeerId &&
              member.connectedVia !== "direct" &&
              member.online !== false &&
              member.presence !== "offline"
            ) {
              void requestPumpToPeer(member.peerId, [nextTrack.nonce]);
            }
          }
        }
      } catch {
        // ignore
      }
    });

    es.addEventListener("all_candidates_failed", () => {
      if (snapshotRef.current.role === "host") {
        callbacksRef.current.onAutoAdvanceTrack?.();
      }
    });

    es.addEventListener("control_request", (evt) => {
      try {
        const cmd = JSON.parse((evt as MessageEvent).data) as {
          fromPeerId: string;
          action: string;
          payload: unknown;
        };
        const cmdId = (cmd.payload as Record<string, unknown> | undefined)?.commandId;
        if (!markControlCommandHandled(cmdId)) return;
        callbacksRef.current.onHostExecuteCommand?.(cmd);
      } catch {
        // ignore
      }
    });

    es.addEventListener("notice", (evt) => {
      try {
        const data = JSON.parse((evt as MessageEvent).data) as { code?: string; message?: string };
        if (
          data.code === "ROOM_CLOSED" ||
          data.code === "ROOM_NOT_FOUND" ||
          data.code === "ROOM_FULL" ||
          data.code === "ROOM_CODE_TAKEN" ||
          data.code === "KICKED_BY_HOST"
        ) {
          clearSavedAriaRoomSession();
        }
        if (data.message) callbacksRef.current.onNotice?.(data.message);
      } catch {
        // ignore
      }
    });

    return () => {
      cancelled = true;
      es.close();
    };
  }, [cleanupAllPeers, cleanupPeer, handleIncomingPlaybackSync, handleSignalEvent, requestPumpToPeer]);

  // On-demand star WebRTC push: only establish DataChannels when this peer is the
  // active/prefetched stream_proxy provider.
  useEffect(() => {
    if (!snapshot.active || !snapshot.myPeerId || snapshot.networkMode === "direct") return;
    const noncesToPush: string[] = [];
    const current = snapshot.playback.track;
    if (current?.nonce && current.dispatch?.mode === "stream_proxy" && current.dispatch.providerPeerId === snapshot.myPeerId) {
      noncesToPush.push(current.nonce);
    }
    const next = snapshot.playback.nextTrack;
    if (next?.nonce && next.dispatch?.mode === "stream_proxy" && next.dispatch.providerPeerId === snapshot.myPeerId) {
      noncesToPush.push(next.nonce);
    }
    if (noncesToPush.length === 0) return;

    for (const member of snapshot.members) {
      if (
        member.peerId !== snapshot.myPeerId &&
        member.connectedVia !== "direct" &&
        member.online !== false &&
        member.presence !== "offline"
      ) {
        void requestPumpToPeer(member.peerId, noncesToPush);
      }
    }
  }, [
    snapshot.active,
    snapshot.myPeerId,
    snapshot.networkMode,
    snapshot.members,
    snapshot.playback.track?.nonce,
    snapshot.playback.track?.dispatch?.mode,
    snapshot.playback.track?.dispatch?.providerPeerId,
    snapshot.playback.nextTrack?.nonce,
    snapshot.playback.nextTrack?.dispatch?.mode,
    snapshot.playback.nextTrack?.dispatch?.providerPeerId,
    requestPumpToPeer,
  ]);

  // Abort stale WebRTC pumps immediately when user skips past a track.
  useEffect(() => {
    if (!snapshot.active) return;
    const activeNonce = snapshot.playback.nonce;
    const nextNonce = snapshot.playback.nextTrack?.nonce ?? null;
    for (const bundle of peersRef.current.values()) {
      if (
        bundle.pumping &&
        bundle.currentPumpingNonce &&
        bundle.currentPumpingNonce !== activeNonce &&
        bundle.currentPumpingNonce !== nextNonce
      ) {
        bundle.pumpAbort?.abort();
      }
    }
  }, [snapshot.active, snapshot.playback.nonce, snapshot.playback.nextTrack?.nonce]);

  // Periodic Guest clock sync (30s, fast retry until calibrated) + smooth micro-speed drift calibration (5s)
  useEffect(() => {
    if (!snapshot.active || snapshot.role !== "guest") {
      clockTrackerRef.current.reset();
      clockSyncedRef.current = false;
      clockOffsetRef.current = 0;
      lastDriftSeekAtRef.current = 0;
      trackAppliedAtRef.current = 0;
      lastDriftSampleRef.current = {
        actualSec: 0,
        seekStreak: 0,
        seekSign: 0,
        speedStreak: 0,
        speedSign: 0,
        speedActive: false,
      };
      setRttMs(null);
      setClockOffsetMs(0);
      callbacksRef.current.onApplyPlaybackSpeed?.(1);
      return;
    }

    let lastPingAt = Date.now();
    // Immediate burst calibration (3 pings spaced 350ms apart)
    const t1 = window.setTimeout(() => void api.sendAriaRoomClockPing().catch(() => undefined), 100);
    const t2 = window.setTimeout(() => void api.sendAriaRoomClockPing().catch(() => undefined), 450);
    const t3 = window.setTimeout(() => void api.sendAriaRoomClockPing().catch(() => undefined), 850);

    const clockInterval = window.setInterval(() => {
      const now = Date.now();
      if (!clockSyncedRef.current || now - lastPingAt >= 30_000) {
        lastPingAt = now;
        void api.sendAriaRoomClockPing().catch(() => undefined);
      }
    }, 3_000);

    const resetDriftStreaks = () => {
      const s = lastDriftSampleRef.current;
      s.seekStreak = 0;
      s.seekSign = 0;
      s.speedStreak = 0;
      s.speedSign = 0;
    };

    const driftInterval = window.setInterval(() => {
      const snap = snapshotRef.current;
      const cb = callbacksRef.current;
      if (!snap.active || snap.role !== "guest" || !snap.playback.nonce) return;

      if (pendingGuestPlayIntentRef.current) {
        if (Date.now() < pendingGuestPlayIntentRef.current.expiresAt) {
          return;
        }
        pendingGuestPlayIntentRef.current = null;
      }

      const sample = lastDriftSampleRef.current;

      if (!snap.playback.playing) {
        if (cb.playing && Date.now() > suppressDriftUntilRef.current) {
          cb.onApplyPlaybackSpeed?.(1);
          resetDriftStreaks();
          sample.speedActive = false;
          sample.actualSec = 0;
          suppressDriftUntilRef.current = Date.now() + 900;
          lastDriftSeekAtRef.current = Date.now();
          cb.onApplyRemotePlaying(false, snap.playback.positionSec);
          return;
        }
        const evalPaused = evaluateAriaRoomDrift({
          expectedSec: snap.playback.positionSec,
          actualSec: cb.getPlaybackTime(),
          playing: false,
        });
        setLastDriftMs(evalPaused.driftMs);
        resetDriftStreaks();
        sample.speedActive = false;
        if (
          evalPaused.shouldSeek &&
          Date.now() > suppressDriftUntilRef.current &&
          Date.now() - lastDriftSeekAtRef.current >= 4_500
        ) {
          lastDriftSeekAtRef.current = Date.now();
          suppressDriftUntilRef.current = Date.now() + 1_200;
          cb.onApplyRemoteSeek(evalPaused.targetSec);
        }
        return;
      }

      if (!clockSyncedRef.current) {
        void api.sendAriaRoomClockPing().catch(() => undefined);
        return;
      }

      const expectedSec = computeExpectedPlaybackSec({
        playback: snap.playback,
        localNowMs: Date.now(),
        clockOffsetMs: clockOffsetRef.current,
        clockSynced: true,
        maxDurationSec: cb.durationSeconds > 0 ? cb.durationSeconds : undefined,
      });

      if (!cb.playing && Date.now() > suppressDriftUntilRef.current) {
        cb.onApplyPlaybackSpeed?.(1);
        resetDriftStreaks();
        sample.speedActive = false;
        sample.actualSec = 0;
        suppressDriftUntilRef.current = Date.now() + 900;
        lastDriftSeekAtRef.current = Date.now();
        cb.onApplyRemotePlaying(true, expectedSec);
        return;
      }

      // 3.5s startup grace so initial buffering never triggers warble or re-anchor seek.
      if (trackAppliedAtRef.current > 0 && Date.now() - trackAppliedAtRef.current < 3_500) {
        return;
      }

      const actualSec = cb.getPlaybackTime();
      // Buffering / stall guard: never seek or speed-warp an actively stalling stream.
      if (
        actualSec < 0.3 ||
        (sample.actualSec > 0 && Math.abs(actualSec - sample.actualSec) < 0.25)
      ) {
        sample.actualSec = actualSec;
        resetDriftStreaks();
        if (sample.speedActive) {
          sample.speedActive = false;
          cb.onApplyPlaybackSpeed?.(1);
        }
        return;
      }

      const evalRes = evaluateAriaRoomDrift({
        expectedSec,
        actualSec,
        playing: true,
      });
      setLastDriftMs(evalRes.driftMs);
      sample.actualSec = actualSec;

      if (evalRes.action === "none") {
        resetDriftStreaks();
        sample.speedActive = false;
        cb.onApplyPlaybackSpeed?.(1);
      } else if (evalRes.action === "speed") {
        const sign = evalRes.driftMs < 0 ? -1 : 1;
        sample.seekStreak = 0;
        sample.seekSign = 0;
        sample.speedStreak = sample.speedSign === sign ? sample.speedStreak + 1 : 1;
        sample.speedSign = sign;
        if (sample.speedActive || sample.speedStreak >= 2 || Math.abs(evalRes.driftMs) >= 600) {
          sample.speedActive = true;
          cb.onApplyPlaybackSpeed?.(evalRes.speed);
        }
      } else if (evalRes.action === "seek") {
        const sign = evalRes.driftMs < 0 ? -1 : 1;
        sample.speedStreak = 0;
        sample.speedSign = 0;
        sample.seekStreak = sample.seekSign === sign ? sample.seekStreak + 1 : 1;
        sample.seekSign = sign;
        if (
          sample.seekStreak >= 1 &&
          Date.now() > suppressDriftUntilRef.current &&
          Date.now() - lastDriftSeekAtRef.current >= 5_000
        ) {
          resetDriftStreaks();
          sample.speedActive = false;
          lastDriftSeekAtRef.current = Date.now();
          suppressDriftUntilRef.current = Date.now() + 1_500;
          cb.onApplyPlaybackSpeed?.(1);
          cb.onApplyRemoteSeek(evalRes.targetSec);
        }
      }
    }, 5_000);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearInterval(clockInterval);
      window.clearInterval(driftInterval);
      callbacksRef.current.onApplyPlaybackSpeed?.(1);
    };
  }, [snapshot.active, snapshot.role]);

  // Re-trigger immediate clock calibration whenever signaling becomes connected while uncalibrated
  useEffect(() => {
    if (!snapshot.active || snapshot.role !== "guest" || snapshot.signalingState !== "connected") return;
    if (clockSyncedRef.current) return;
    const t1 = window.setTimeout(() => void api.sendAriaRoomClockPing().catch(() => undefined), 80);
    const t2 = window.setTimeout(() => void api.sendAriaRoomClockPing().catch(() => undefined), 500);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [snapshot.active, snapshot.role, snapshot.signalingState]);

  const triggerHostPrefetchNext = useCallback(() => {
    const cb = callbacksRef.current;
    const snap = snapshotRef.current;
    if (!snap.active || snap.role !== "host" || !cb.activeTrack) return;
    const queue = cb.playQueueTracks;
    if (!queue.length) return;
    const idx = queue.findIndex((t) => t.id === cb.activeTrack!.id);
    const safeIndex = idx >= 0 ? idx : 0;
    const nextTrack = queue[(safeIndex + 1) % queue.length];
    if (!nextTrack || nextTrack.id === cb.activeTrack.id) return;

    let nextNonce = trackIdNonceMapRef.current.get(nextTrack.id);
    if (!nextNonce) {
      nextNonce = createTrackNonce(nextTrack.id);
      trackIdNonceMapRef.current.set(nextTrack.id, nextNonce);
    }
    if (
      prefetchedNextNonceRef.current === nextNonce ||
      snap.playback.nextTrack?.nonce === nextNonce
    ) {
      return;
    }

    prefetchedNextNonceRef.current = nextNonce;
    const nextPayload = trackToAriaPayload(nextTrack, nextNonce, {
      peerId: identity.peerId,
      nickname: identity.nickname,
    });
    void api.prefetchAriaRoomNext(nextPayload).catch(() => {
      if (prefetchedNextNonceRef.current === nextNonce) {
        prefetchedNextNonceRef.current = null;
      }
    });
  }, [identity.nickname, identity.peerId]);

  // Early warm prefetch (2s after starting a track) + 20s before EOF lookahead
  useEffect(() => {
    if (!snapshot.active || snapshot.role !== "host" || !options.playing) return;
    const earlyTimer = window.setTimeout(() => {
      triggerHostPrefetchNext();
    }, 2_000);
    const eofTimer = window.setInterval(() => {
      const cb = callbacksRef.current;
      if (!cb.playing || !cb.activeTrack) return;
      if (!Number.isFinite(cb.durationSeconds) || cb.durationSeconds <= 20) return;
      const remaining = cb.durationSeconds - cb.getPlaybackTime();
      if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 20) return;
      triggerHostPrefetchNext();
    }, 2_000);

    return () => {
      window.clearTimeout(earlyTimer);
      window.clearInterval(eofTimer);
    };
  }, [snapshot.active, snapshot.role, options.playing, options.activeTrack?.id, snapshot.playback.nonce, triggerHostPrefetchNext]);

  const updateProfile = useCallback((patch: Partial<AriaRoomProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...patch };
      writeAriaRoomProfile(next);
      return next;
    });
  }, []);

  const toggleShareEnabled = useCallback(async (enabled: boolean) => {
    updateProfile({ shareEnabled: enabled });
    try {
      const updated = await api.updateAriaRoomCapabilities({ shareEnabled: enabled });
      setSnapshot(updated);
    } catch {
      // Room may not be active yet; profile persistence handles next join/create.
    }
  }, [updateProfile]);

  const uploadCustomAvatar = useCallback(async (file: File) => {
    const dataUrl = await compressAvatarFile(file);
    setProfile((prev) => {
      const next: AriaRoomProfile = {
        ...prev,
        mode: "custom",
        customAvatarDataUrl: dataUrl,
        selectedAvatarUrl: dataUrl,
        avatarHistory: appendAvatarHistory(prev.avatarHistory, dataUrl),
      };
      writeAriaRoomProfile(next);
      return next;
    });
  }, []);

  const buildHostPayloads = useCallback(
    (track: Track | null, queue: Track[]) => {
      const snap = snapshotRef.current;
      const toHostPayload = (item: Track, nonce: string): AriaRoomTrackPayload => {
        const preserved = remotePayloadMetaRef.current.get(item.id);
        let base: AriaRoomTrackPayload;
        if (preserved) {
          base = trackToAriaPayload(item, nonce, {
            peerId: preserved.addedByPeerId || identity.peerId,
            nickname: preserved.addedByName || identity.nickname,
          });
          if (
            preserved.source === "local" &&
            preserved.addedByPeerId &&
            preserved.addedByPeerId !== identity.peerId &&
            preserved.streamUrl
          ) {
            base.streamUrl = preserved.streamUrl;
          }
        } else {
          base = trackToAriaPayload(item, nonce, {
            peerId: identity.peerId,
            nickname: identity.nickname,
          });
        }
        const prefetchedNext = snap.playback.nextTrack;
        if (
          prefetchedNext &&
          prefetchedNext.nonce === nonce &&
          prefetchedNext.dispatch
        ) {
          return {
            ...base,
            bitrate: prefetchedNext.bitrate ?? base.bitrate ?? null,
            sampleRate: prefetchedNext.sampleRate ?? base.sampleRate ?? null,
            quality: prefetchedNext.quality ?? base.quality,
            currentLevel: prefetchedNext.currentLevel ?? base.currentLevel ?? null,
            availableLevels: prefetchedNext.availableLevels ?? base.availableLevels,
            coverDataUrl: prefetchedNext.coverDataUrl ?? base.coverDataUrl ?? null,
            mimeType: prefetchedNext.mimeType ?? base.mimeType ?? null,
            dispatch: prefetchedNext.dispatch,
          };
        }
        return base;
      };

      const activeIdx = track ? queue.findIndex((item) => item.id === track.id) : -1;
      const winStart =
        queue.length > 200 && activeIdx >= 0
          ? Math.max(0, Math.min(activeIdx - 20, queue.length - 200))
          : 0;
      const slicedQueue = queue.slice(winStart, winStart + 200);

      const cleanQueue = slicedQueue.map((item) => {
        let nonce = trackIdNonceMapRef.current.get(item.id);
        if (!nonce) {
          nonce = createTrackNonce(item.id);
          trackIdNonceMapRef.current.set(item.id, nonce);
        }
        return toHostPayload(item, nonce);
      });

      let currentPayload: AriaRoomTrackPayload | null = null;
      let nextPayload: AriaRoomTrackPayload | null = null;
      if (track) {
        let nonce = trackIdNonceMapRef.current.get(track.id);
        if (!nonce) {
          nonce = createTrackNonce(track.id);
          trackIdNonceMapRef.current.set(track.id, nonce);
        }
        currentPayload =
          cleanQueue.find((q) => q.id === canonicalTrackId(track) || q.id === track.id) ??
          toHostPayload(track, nonce);

        const currentIndex = slicedQueue.findIndex((q) => q.id === track.id);
        if (currentIndex >= 0 && currentIndex + 1 < cleanQueue.length) {
          nextPayload = cleanQueue[currentIndex + 1];
        } else if (cleanQueue.length > 0 && currentIndex === -1) {
          nextPayload = cleanQueue[0];
        }
      }

      return { currentPayload, nextPayload, cleanQueue };
    },
    [identity.nickname, identity.peerId],
  );

  const createRoom = useCallback(
    async (params: {
      networkMode: AriaRoomNetworkMode;
      controlMode: AriaRoomControlMode;
      roomId?: string;
      rejoin?: boolean;
      directPort?: number;
      publicHost?: string;
    }) => {
      setLoading(true);
      setActionError(null);
      try {
        await callbacksRef.current.onBeforeEnterAriaRoom?.();
        trackIdNonceMapRef.current.clear();
        readyReportedNoncesRef.current.clear();
        lastAppliedQueueSigRef.current = "";
        remotePayloadMetaRef.current.clear();
        prefetchedNextNonceRef.current = null;
        const { currentPayload, nextPayload, cleanQueue } = buildHostPayloads(
          callbacksRef.current.activeTrack,
          callbacksRef.current.playQueueTracks,
        );
        const created = await api.createAriaRoom({
          peerId: identity.peerId,
          nickname: identity.nickname,
          avatarUrl: identity.avatarUrl,
          shareEnabled: profile.shareEnabled,
          networkMode: params.networkMode,
          controlMode: params.controlMode,
          ...(params.roomId?.trim() ? { roomId: params.roomId.trim() } : {}),
          ...(params.rejoin ? { rejoin: true } : {}),
          directPort: params.directPort,
          publicHost: params.publicHost,
          track: currentPayload,
          nextTrack: nextPayload,
          queue: cleanQueue,
          playing: callbacksRef.current.playing,
          positionSec: callbacksRef.current.getPlaybackTime(),
        });
        setSnapshot(created);
        writeSavedAriaRoomSession({
          role: "host",
          networkMode: created.networkMode,
          controlMode: created.controlMode,
          roomId: created.roomId,
          directPort: params.directPort ?? created.directServer.port ?? null,
          publicHost: params.publicHost ?? null,
          savedAt: Date.now(),
        });
        return created;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "创建 Aria 房间失败";
        setActionError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [buildHostPayloads, identity.avatarUrl, identity.nickname, identity.peerId, profile.shareEnabled],
  );

  const joinRoomByInput = useCallback(
    async (rawInput: string) => {
      const parsed = decodeAriaJoinInput(rawInput);
      if (!parsed) {
        setActionError("请输入有效的 Aria 房间码（3–24 位）或房主直连地址（含令牌）");
        return null;
      }
      setLoading(true);
      setActionError(null);
      try {
        await callbacksRef.current.onBeforeEnterAriaRoom?.();
        cleanupAllPeers();
        readyReportedNoncesRef.current.clear();
        lastAppliedNonceRef.current = null;
        lastAppliedSeqRef.current = 0;
        lastAppliedQueueSigRef.current = "";
        prefetchedNextNonceRef.current = null;
        pendingGuestPlayIntentRef.current = null;
        pendingInitialAlignRef.current = null;
        clockSyncedRef.current = false;
        clockOffsetRef.current = 0;
        lastDriftSeekAtRef.current = 0;
        trackAppliedAtRef.current = 0;
        lastDriftSampleRef.current = {
          actualSec: 0,
          seekStreak: 0,
          seekSign: 0,
          speedStreak: 0,
          speedSign: 0,
          speedActive: false,
        };
        const joined = await api.joinAriaRoom(
          parsed.kind === "cloudflare"
            ? {
                peerId: identity.peerId,
                nickname: identity.nickname,
                avatarUrl: identity.avatarUrl,
                shareEnabled: profile.shareEnabled,
                mode: "cloudflare",
                roomId: parsed.roomId,
              }
            : {
                peerId: identity.peerId,
                nickname: identity.nickname,
                avatarUrl: identity.avatarUrl,
                shareEnabled: profile.shareEnabled,
                mode: "direct",
                directHost: parsed.host,
                directPort: parsed.port,
                directToken: parsed.token,
              },
        );
        setSnapshot(joined);
        writeSavedAriaRoomSession({
          role: "guest",
          networkMode: parsed.kind === "direct" ? "direct" : joined.networkMode,
          controlMode: joined.controlMode,
          roomId: joined.roomId,
          directHost: parsed.kind === "direct" ? parsed.host : null,
          directPort: parsed.kind === "direct" ? parsed.port : null,
          directToken: parsed.kind === "direct" ? parsed.token : null,
          savedAt: Date.now(),
        });
        return joined;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "加入 Aria 房间失败";
        setActionError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [cleanupAllPeers, identity.avatarUrl, identity.nickname, identity.peerId, profile.shareEnabled],
  );

  const leaveRoom = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    clearSavedAriaRoomSession();
    clearScheduledSyncTimer();
    cleanupAllPeers();
    readyReportedNoncesRef.current.clear();
    lastSentPresenceRef.current = null;
    lastAppliedNonceRef.current = null;
    lastAppliedSeqRef.current = 0;
    lastAppliedQueueSigRef.current = "";
    prefetchedNextNonceRef.current = null;
    remotePayloadMetaRef.current.clear();
    pendingGuestPlayIntentRef.current = null;
    pendingInitialAlignRef.current = null;
    clockSyncedRef.current = false;
    clockOffsetRef.current = 0;
    lastDriftSeekAtRef.current = 0;
    trackAppliedAtRef.current = 0;
    lastDriftSampleRef.current = {
      actualSec: 0,
      seekStreak: 0,
      seekSign: 0,
      speedStreak: 0,
      speedSign: 0,
      speedActive: false,
    };
    callbacksRef.current.onApplyPlaybackSpeed?.(1);
    callbacksRef.current.onHostRelayStreamOverride?.(null);
    try {
      const left = await api.leaveAriaRoom();
      setSnapshot(left);
    } finally {
      setLoading(false);
    }
  }, [cleanupAllPeers]);

  // Persistent room membership: auto-rejoin saved session once on startup unless explicitly left.
  useEffect(() => {
    if (!initialStatusReady || autoRejoinAttemptedRef.current) return;
    autoRejoinAttemptedRef.current = true;
    if (snapshotRef.current.active) return;
    const saved = readSavedAriaRoomSession();
    if (!saved) return;
    const hasCloudSignaling = Boolean(
      (config.signalingProvider === "self-hosted"
        ? config.selfHostedSignalingUrl || config.signalingUrl
        : config.signalingUrl
      ).trim(),
    );
    if (saved.networkMode !== "direct" && !hasCloudSignaling && saved.networkMode === "cloudflare") {
      return;
    }

    const handlePermanentRejoinFailure = (err: unknown) => {
      const status = (err as { status?: number } | null)?.status;
      const msg = err instanceof Error ? err.message : "";
      if (
        status === 400 ||
        status === 403 ||
        status === 404 ||
        status === 409 ||
        /不存在|已结束|已满|占用/.test(msg)
      ) {
        clearSavedAriaRoomSession();
      }
    };

    if (saved.role === "host") {
      void createRoom({
        networkMode: saved.networkMode,
        controlMode: saved.controlMode,
        roomId: saved.roomId ?? undefined,
        rejoin: true,
        directPort: saved.directPort ?? undefined,
        publicHost: saved.publicHost ?? undefined,
      }).catch(handlePermanentRejoinFailure);
    } else if (saved.role === "guest") {
      const joinStr =
        saved.networkMode === "direct" && saved.directHost && saved.directToken
          ? `aria-direct://v1?host=${encodeURIComponent(saved.directHost)}&port=${encodeURIComponent(String(saved.directPort || 3639))}&token=${encodeURIComponent(saved.directToken)}`
          : saved.roomId;
      if (!joinStr) {
        clearSavedAriaRoomSession();
        return;
      }
      void joinRoomByInput(joinStr).catch(handlePermanentRejoinFailure);
    }
  }, [
    config.selfHostedSignalingUrl,
    config.signalingProvider,
    config.signalingUrl,
    createRoom,
    initialStatusReady,
    joinRoomByInput,
  ]);

  // Report "active" presence whenever connected so the user stays online
  // as long as the Aria process is running (regardless of focus or playback).
  useEffect(() => {
    if (!snapshot.active || snapshot.signalingState !== "connected") {
      lastSentPresenceRef.current = null;
      return;
    }
    if (lastSentPresenceRef.current === "active") return;
    lastSentPresenceRef.current = "active";
    void api.updateAriaRoomPresence("active").catch(() => undefined);
  }, [snapshot.active, snapshot.signalingState]);

  const probePreferredIps = useCallback(async (overrideUrl?: string, provider?: AriaSignalingProvider) => {
    setProbingIps(true);
    setActionError(null);
    try {
      const res = await api.probeAriaRoomIps(overrideUrl, provider);
      setProbeResults(res.results);
      setConfig(res.config);
      return res.results;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "优选 IP 测速失败");
      return [];
    } finally {
      setProbingIps(false);
    }
  }, []);

  const updateNetworkConfig = useCallback(async (patch: Partial<AriaRoomConfigSnapshot>) => {
    const saved = await api.updateAriaRoomConfig(patch);
    setConfig(saved);
    return saved;
  }, []);

  const setControlMode = useCallback(async (nextMode: AriaRoomControlMode) => {
    if (!snapshotRef.current.active || snapshotRef.current.role !== "host") return;
    try {
      await api.prepareAriaRoomHostState({
        track: snapshotRef.current.playback.track,
        nextTrack: snapshotRef.current.playback.nextTrack,
        queue: snapshotRef.current.playback.queue,
        playing: callbacksRef.current.playing,
        positionSec: callbacksRef.current.getPlaybackTime(),
        controlMode: nextMode,
      });
    } catch (err) {
      if ((err as { name?: string })?.name !== "AbortError") {
        setActionError(err instanceof Error ? err.message : "切换控场模式失败");
      }
    }
  }, []);

  const kickMember = useCallback(async (peerId: string) => {
    if (!snapshotRef.current.active || snapshotRef.current.role !== "host") return;
    try {
      await api.kickAriaRoomMember(peerId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "移出成员失败");
    }
  }, []);

  const importPlaylistTracks = useCallback(
    async (tracks: Track[]) => {
      if (!tracks.length) return;
      if (!snapshotRef.current.active) return;

      if (snapshotRef.current.role === "host") {
        prefetchedNextNonceRef.current = null;
        try {
          const { currentPayload, nextPayload, cleanQueue } = buildHostPayloads(tracks[0], tracks);
          await api.prepareAriaRoomHostState({
            track: currentPayload,
            nextTrack: nextPayload,
            queue: cleanQueue,
            playing: true,
            positionSec: 0,
          });
          callbacksRef.current.onHostExecuteCommand?.({
            fromPeerId: identity.peerId,
            action: "pick_track_local",
            payload: { track: tracks[0], queue: tracks },
          });
          const syncEvt = await api.syncAriaRoomHostPlayback({
            kind: "play_at",
            nonce: currentPayload?.nonce ?? null,
            positionSec: 0,
            startAtHostMs: Date.now() + 260,
          });
          sendControlChannelBroadcast({ type: "playback_sync", event: syncEvt });
        } catch (err) {
          if ((err as { name?: string })?.name !== "AbortError") {
            setActionError(err instanceof Error ? err.message : "导入歌单到房间失败");
          }
        }
      } else if (snapshotRef.current.controlMode === "collaborative") {
        const now = Date.now();
        const commandId = `cmd-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const payloads = tracks.slice(0, 120).map((t) =>
          trackToAriaPayload(t, createTrackNonce(t.id), {
            peerId: identity.peerId,
            nickname: identity.nickname,
          }),
        );
        const cmdPayload = { tracks: payloads, commandId };
        sendControlChannelBroadcast({ type: "control_request", action: "import_queue", payload: cmdPayload });
        await api.sendAriaRoomControlRequest("import_queue", cmdPayload);
      }
    },
    [buildHostPayloads, identity.nickname, identity.peerId, sendControlChannelBroadcast],
  );

  const hostPlayRoomPayload = useCallback(
    async (targetPayload: AriaRoomTrackPayload, overrideQueuePayloads?: AriaRoomTrackPayload[]) => {
      const snap = snapshotRef.current;
      if (!snap.active || snap.role !== "host") return;

      prefetchedNextNonceRef.current = null;

      const rememberRemoteMeta = (item: AriaRoomTrackPayload) => {
        if (item.addedByPeerId && item.addedByPeerId !== identity.peerId) {
          remotePayloadMetaRef.current.set(item.id, item);
        }
      };
      rememberRemoteMeta(targetPayload);
      overrideQueuePayloads?.forEach(rememberRemoteMeta);

      const prefetchedNext = snap.playback.nextTrack;
      const matchesPrefetched = Boolean(
        prefetchedNext &&
          (prefetchedNext.nonce === targetPayload.nonce || prefetchedNext.id === targetPayload.id),
      );
      const isSameActive = Boolean(targetPayload.nonce && targetPayload.nonce === snap.playback.nonce);
      const reuseWarmNonce = Boolean(
        !isSameActive &&
          (matchesPrefetched || (overrideQueuePayloads?.length && targetPayload.nonce)),
      );
      const targetNonce =
        matchesPrefetched && prefetchedNext?.nonce
          ? prefetchedNext.nonce
          : reuseWarmNonce && targetPayload.nonce
            ? targetPayload.nonce
            : createTrackNonce(targetPayload.id);
      trackIdNonceMapRef.current.set(targetPayload.id, targetNonce);

      const warmDispatch =
        matchesPrefetched && prefetchedNext?.dispatch
          ? prefetchedNext.dispatch
          : !isSameActive
            ? targetPayload.dispatch ?? null
            : null;

      const { dispatch: _ignoredDispatch, ...restTarget } = targetPayload;
      const cleanTarget: AriaRoomTrackPayload = {
        ...restTarget,
        nonce: targetNonce,
        ...(warmDispatch ? { dispatch: warmDispatch } : {}),
        ...(matchesPrefetched && prefetchedNext?.coverDataUrl && !restTarget.coverDataUrl
          ? { coverDataUrl: prefetchedNext.coverDataUrl }
          : {}),
      };

      let cleanQueue: AriaRoomTrackPayload[];
      if (overrideQueuePayloads?.length) {
        const idxInOverride = overrideQueuePayloads.findIndex(
          (item) => item.nonce === targetPayload.nonce || item.id === cleanTarget.id,
        );
        const startOffset =
          overrideQueuePayloads.length > 200 && idxInOverride >= 0
            ? Math.max(0, Math.min(idxInOverride - 20, overrideQueuePayloads.length - 200))
            : 0;
        const mapped = overrideQueuePayloads.slice(startOffset, startOffset + 200).map((item) => {
          const itemNonce = item.nonce || trackIdNonceMapRef.current.get(item.id) || createTrackNonce(item.id);
          trackIdNonceMapRef.current.set(item.id, itemNonce);
          return item.id === cleanTarget.id || item.nonce === cleanTarget.nonce
            ? cleanTarget
            : { ...item, nonce: itemNonce };
        });
        const hasTarget = mapped.some((q) => q.nonce === cleanTarget.nonce || q.id === cleanTarget.id);
        cleanQueue = hasTarget ? mapped : [cleanTarget, ...mapped].slice(0, 200);
      } else {
        cleanQueue = [
          cleanTarget,
          ...snap.playback.queue.filter(
            (item) => item.id !== cleanTarget.id && item.nonce !== cleanTarget.nonce,
          ),
        ].slice(0, 200);
      }

      const targetIndex = cleanQueue.findIndex((q) => q.nonce === cleanTarget.nonce);
      const nextPayload =
        targetIndex >= 0 && targetIndex + 1 < cleanQueue.length ? cleanQueue[targetIndex + 1] : null;

      try {
        const updatedSnap = await api.prepareAriaRoomHostState({
          track: cleanTarget,
          nextTrack: nextPayload,
          queue: cleanQueue,
          playing: true,
          positionSec: 0,
        });
        const resolvedTrack = updatedSnap.playback.track ?? cleanTarget;
        const resolvedQueue = updatedSnap.playback.queue.length ? updatedSnap.playback.queue : cleanQueue;

        if (
          resolvedTrack.dispatch &&
          resolvedTrack.dispatch.providerPeerId !== updatedSnap.myPeerId &&
          resolvedTrack.dispatch.mode !== "resolve_local"
        ) {
          callbacksRef.current.onHostRelayStreamOverride?.({
            trackId: resolvedTrack.id,
            streamUrl: `/api/aria-room/guest/stream/${encodeURIComponent(resolvedTrack.nonce)}`,
          });
        } else {
          callbacksRef.current.onHostRelayStreamOverride?.(null);
        }

        const hostUiTrack = ariaPayloadToHostTrack(resolvedTrack, updatedSnap.myPeerId);
        const hostUiQueue = resolvedQueue.map((item) =>
          ariaPayloadToHostTrack(item, updatedSnap.myPeerId),
        );
        callbacksRef.current.onHostExecuteCommand?.({
          fromPeerId: identity.peerId,
          action: "pick_track_local",
          payload: { track: hostUiTrack, queue: hostUiQueue },
        });

        const syncEvt = await api.syncAriaRoomHostPlayback({
          kind: "play_at",
          nonce: resolvedTrack.nonce,
          positionSec: 0,
          startAtHostMs: Date.now() + 220,
        });
        sendControlChannelBroadcast({ type: "playback_sync", event: syncEvt });
      } catch (err) {
        callbacksRef.current.onNotice?.(
          err instanceof Error ? err.message : "房间切换曲目失败，请稍后重试",
        );
      }
    },
    [identity.peerId, sendControlChannelBroadcast],
  );

  const hostImportRoomPayloads = useCallback(
    async (payloads: AriaRoomTrackPayload[], options?: { startTrackId?: string }) => {
      if (!payloads.length) return;
      const snap = snapshotRef.current;
      if (!snap.active || snap.role !== "host") return;

      const requestedIdx = options?.startTrackId
        ? payloads.findIndex(
            (item) => item.id === options.startTrackId || item.nonce === options.startTrackId,
          )
        : 0;
      const safeIdx = requestedIdx >= 0 ? requestedIdx : 0;
      const winStart =
        payloads.length > 120
          ? Math.max(0, Math.min(safeIdx - 20, payloads.length - 120))
          : 0;
      const prepared = payloads.slice(winStart, winStart + 120).map((item) => {
        const nonce = item.nonce || createTrackNonce(item.id);
        trackIdNonceMapRef.current.set(item.id, nonce);
        if (item.addedByPeerId && item.addedByPeerId !== identity.peerId) {
          remotePayloadMetaRef.current.set(item.id, { ...item, nonce });
        }
        return { ...item, nonce };
      });
      const startTarget =
        (options?.startTrackId
          ? prepared.find(
              (item) => item.id === options.startTrackId || item.nonce === options.startTrackId,
            )
          : undefined) ?? prepared[0];
      if (!startTarget) return;
      await hostPlayRoomPayload(startTarget, prepared);
    },
    [hostPlayRoomPayload, identity.peerId],
  );

  const reportQueueChange = useCallback(
    (nextQueue: Track[]) => {
      const snap = snapshotRef.current;
      if (!snap.active || snap.role !== "host") return;
      const { currentPayload, nextPayload, cleanQueue } = buildHostPayloads(
        callbacksRef.current.activeTrack,
        nextQueue,
      );
      void api
        .prepareAriaRoomHostState({
          track: snap.playback.track ?? currentPayload,
          nextTrack: nextPayload,
          queue: cleanQueue,
        })
        .catch(() => undefined);
    },
    [buildHostPayloads],
  );

  const reportTrackChange = useCallback(
    (track: Track, queue?: Track[], options?: { restartFromZero?: boolean }) => {
      const snap = snapshotRef.current;
      if (!snap.active) return;

      if (snap.role === "host") {
        prefetchedNextNonceRef.current = null;
        const activeQueue = queue ?? callbacksRef.current.playQueueTracks;
        const prefetchedNext = snap.playback.nextTrack;
        const canonId = canonicalTrackId(track);
        const matchesPrefetched = Boolean(
          !options?.restartFromZero &&
            prefetchedNext &&
            (prefetchedNext.id === canonId || prefetchedNext.id === track.id),
        );
        const chosenNonce =
          matchesPrefetched && prefetchedNext?.nonce
            ? prefetchedNext.nonce
            : createTrackNonce(track.id);
        trackIdNonceMapRef.current.set(track.id, chosenNonce);
        const { currentPayload, nextPayload, cleanQueue } = buildHostPayloads(track, activeQueue);
        void (async () => {
          try {
            await api.prepareAriaRoomHostState({
              track: currentPayload,
              nextTrack: nextPayload,
              queue: cleanQueue,
              playing: true,
              positionSec: 0,
            });
            if (callbacksRef.current.activeTrack?.id !== track.id) return;
            const livePos = Math.max(0, callbacksRef.current.getPlaybackTime());
            const syncPos = options?.restartFromZero || livePos > 2.5 ? 0 : livePos;
            const syncEvt = await api.syncAriaRoomHostPlayback({
              kind: "play_at",
              nonce: currentPayload?.nonce ?? null,
              positionSec: syncPos,
              startAtHostMs: Date.now() + (syncPos > 0.3 ? 120 : 220),
            });
            sendControlChannelBroadcast({ type: "playback_sync", event: syncEvt });
          } catch (err) {
            if ((err as { name?: string })?.name !== "AbortError") {
              setActionError(err instanceof Error ? err.message : "房间同步曲目失败");
            }
          }
        })();
      } else if (snap.controlMode === "collaborative") {
        pendingGuestPlayIntentRef.current = null;
        suppressDriftUntilRef.current = Date.now() + 4_000;
        if (track.id.startsWith("aria-room:")) {
          const nonce = track.id.slice("aria-room:".length);
          void api.sendAriaRoomControlRequest("pick_nonce", { nonce }).catch(() => undefined);
        } else {
          void api
            .sendAriaRoomControlRequest("add_and_play", {
              track: trackToAriaPayload(track, createTrackNonce(track.id), {
                peerId: identity.peerId,
                nickname: identity.nickname,
              }),
            })
            .catch(() => undefined);
        }
      }
    },
    [buildHostPayloads, identity.nickname, identity.peerId, sendControlChannelBroadcast],
  );

  const reportPlayPause = useCallback(
    (playing: boolean, positionSec: number) => {
      const snap = snapshotRef.current;
      if (!snap.active) return;

      if (snap.role === "host") {
        void api
          .syncAriaRoomHostPlayback({
            kind: playing ? "play_at" : "pause",
            nonce: snap.playback.nonce,
            positionSec,
            startAtHostMs: Date.now() + (playing ? 180 : 0),
          })
          .then((syncEvt) => {
            sendControlChannelBroadcast({ type: "playback_sync", event: syncEvt });
          })
          .catch(() => undefined);
      } else if (snap.controlMode === "collaborative") {
        const now = Date.now();
        const commandId = `cmd-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        clearScheduledSyncTimer();
        pendingGuestPlayIntentRef.current = {
          playing,
          createdAt: now,
          expiresAt: now + 6_000,
        };
        suppressDriftUntilRef.current = now + 6_000;
        const payload = { playing, positionSec, commandId };
        sendControlChannelBroadcast({ type: "control_request", action: "toggle_play", payload });
        void api.sendAriaRoomControlRequest("toggle_play", payload).catch(() => undefined);
      }
    },
    [sendControlChannelBroadcast],
  );

  const reportSeek = useCallback(
    (positionSec: number) => {
      const snap = snapshotRef.current;
      if (!snap.active) return;

      if (snap.role === "host") {
        void api
          .syncAriaRoomHostPlayback({
            kind: "seek",
            nonce: snap.playback.nonce,
            positionSec,
            startAtHostMs: Date.now() + 120,
          })
          .then((syncEvt) => {
            sendControlChannelBroadcast({ type: "playback_sync", event: syncEvt });
          })
          .catch(() => undefined);
      } else if (snap.controlMode === "collaborative") {
        const now = Date.now();
        const commandId = `cmd-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        suppressDriftUntilRef.current = now + 4_500;
        const payload = { positionSec, commandId };
        sendControlChannelBroadcast({ type: "control_request", action: "seek", payload });
        void api.sendAriaRoomControlRequest("seek", payload).catch(() => undefined);
      }
    },
    [sendControlChannelBroadcast],
  );

  const consumeGuestInitialAlignSec = useCallback(
    (trackId: string, durationSec?: number): number | null => {
      const snap = snapshotRef.current;
      const pending = pendingInitialAlignRef.current;
      if (!snap.active || snap.role !== "guest" || !pending) return null;
      if (pending.trackId !== trackId || snap.playback.nonce !== pending.nonce) return null;

      pendingInitialAlignRef.current = null;
      const now = Date.now();
      trackAppliedAtRef.current = now;
      suppressDriftUntilRef.current = Math.max(suppressDriftUntilRef.current, now + 2_500);
      lastDriftSeekAtRef.current = now;

      const expectedSec = computeExpectedPlaybackSec({
        playback: snap.playback,
        localNowMs: now,
        clockOffsetMs: clockOffsetRef.current,
        clockSynced: clockSyncedRef.current || clockTrackerRef.current.hasSamples(),
        maxDurationSec: durationSec && durationSec > 0 ? durationSec : undefined,
      });
      return expectedSec > 0.6 ? expectedSec : null;
    },
    [],
  );

  const guardTrackSelection = useCallback(
    (targetTrack: Track, preferredQueue?: Track[]): boolean => {
      const snap = snapshotRef.current;
      if (!snap.active) return false;
      if (snap.role === "host") return false;
      if (snap.controlMode === "host-only") {
        const msg = "当前房间开启了「仅房主控场」，只有房主可以切换曲目。";
        setActionError(msg);
        callbacksRef.current.onNotice?.(msg);
        return true;
      }
      const now = Date.now();
      const commandId = `cmd-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      pendingGuestPlayIntentRef.current = null;
      suppressDriftUntilRef.current = now + 4_500;
      if (targetTrack.id.startsWith("aria-room:")) {
        const nonce = targetTrack.id.slice("aria-room:".length);
        const payload = { nonce, commandId };
        sendControlChannelBroadcast({ type: "control_request", action: "pick_nonce", payload });
        void api.sendAriaRoomControlRequest("pick_nonce", payload).catch(() => undefined);
        return true;
      }
      const isSwitchingExternalPlaylist = Boolean(
        preferredQueue &&
          preferredQueue.length > 1 &&
          !preferredQueue.every((item) => item.id.startsWith("aria-room:")),
      );
      const canonId = canonicalTrackId(targetTrack);
      const existingInRoom = snap.playback.queue.find(
        (q) => q.id === canonId || q.id === targetTrack.id,
      );
      if (existingInRoom && !isSwitchingExternalPlaylist) {
        const payload = { nonce: existingInRoom.nonce, commandId };
        sendControlChannelBroadcast({ type: "control_request", action: "pick_nonce", payload });
        void api.sendAriaRoomControlRequest("pick_nonce", payload).catch(() => undefined);
        return true;
      }
      if (isSwitchingExternalPlaylist && preferredQueue) {
        const idx = preferredQueue.findIndex((t) => t.id === targetTrack.id);
        const start =
          preferredQueue.length > 120 && idx >= 0
            ? Math.max(0, Math.min(idx - 20, preferredQueue.length - 120))
            : 0;
        const payloads = preferredQueue.slice(start, start + 120).map((t) =>
          trackToAriaPayload(t, createTrackNonce(t.id), {
            peerId: identity.peerId,
            nickname: identity.nickname,
          }),
        );
        const cmdPayload = {
          tracks: payloads,
          startTrackId: canonId,
          replace: true,
          commandId,
        };
        sendControlChannelBroadcast({ type: "control_request", action: "import_queue", payload: cmdPayload });
        void api.sendAriaRoomControlRequest("import_queue", cmdPayload).catch(() => undefined);
        return true;
      }
      const trackPayload = trackToAriaPayload(targetTrack, createTrackNonce(targetTrack.id), {
        peerId: identity.peerId,
        nickname: identity.nickname,
      });
      const payload = { track: trackPayload, commandId };
      sendControlChannelBroadcast({ type: "control_request", action: "add_and_play", payload });
      void api.sendAriaRoomControlRequest("add_and_play", payload).catch(() => undefined);
      return true;
    },
    [identity.nickname, identity.peerId, sendControlChannelBroadcast],
  );

  const requestPickTrack = useCallback(
    (track: Track) => {
      const snap = snapshotRef.current;
      if (!snap.active) return;
      if (snap.role === "host") {
        const targetNonce = track.id.startsWith("aria-room:") ? track.id.slice("aria-room:".length) : null;
        const matched =
          (targetNonce ? snap.playback.queue.find((q) => q.nonce === targetNonce) : undefined) ??
          snap.playback.queue.find((q) => q.id === track.id || q.id === canonicalTrackId(track));
        if (matched) {
          void hostPlayRoomPayload(matched, snap.playback.queue);
          return;
        }
      }
      guardTrackSelection(track);
    },
    [guardTrackSelection, hostPlayRoomPayload],
  );

  return {
    snapshot,
    config,
    probeResults,
    profile,
    identity,
    isActive: snapshot.active,
    isHost: snapshot.role === "host",
    isGuest: snapshot.role === "guest",
    loading,
    probingIps,
    actionError,
    rttMs,
    clockOffsetMs,
    lastDriftMs,
    bufferProgress,
    clearError: () => setActionError(null),
    updateProfile,
    toggleShareEnabled,
    uploadCustomAvatar,
    createRoom,
    joinRoomByInput,
    leaveRoom,
    probePreferredIps,
    updateNetworkConfig,
    setControlMode,
    kickMember,
    importPlaylistTracks,
    hostPlayRoomPayload,
    hostImportRoomPayloads,
    reportQueueChange,
    reportTrackChange,
    reportPlayPause,
    reportSeek,
    consumeGuestInitialAlignSec,
    guardTrackSelection,
    requestPickTrack,
  };
}
