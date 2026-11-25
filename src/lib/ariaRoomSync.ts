import type { Track } from "@/data/music";
import {
  api,
  type AriaRoomMember,
  type AriaRoomPlaybackState,
  type AriaRoomSyncEvent,
  type AriaRoomTrackPayload,
} from "./api";

export type ClockSample = {
  t0: number;
  t1: number;
  t2: number;
  t3: number;
};

export type ClockMeasurement = {
  rttMs: number;
  offsetMs: number;
};

export function computeClockMeasurement(sample: ClockSample): ClockMeasurement {
  const rttMs = Math.max(1, sample.t3 - sample.t0 - (sample.t2 - sample.t1));
  const offsetMs = (sample.t1 - sample.t0 + (sample.t2 - sample.t3)) / 2;
  return { rttMs, offsetMs };
}

export class ClockSyncTracker {
  private samples: ClockMeasurement[] = [];
  private readonly maxSamples: number;

  constructor(maxSamples = 8) {
    this.maxSamples = maxSamples;
  }

  record(sample: ClockSample): { rttMs: number; offsetMs: number } {
    const next = computeClockMeasurement(sample);
    this.samples.push(next);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
    return this.getBestEstimate();
  }

  getBestEstimate(): { rttMs: number; offsetMs: number } {
    if (this.samples.length === 0) return { rttMs: 0, offsetMs: 0 };
    const sorted = [...this.samples].sort((a, b) => a.rttMs - b.rttMs);
    const minRtt = sorted[0].rttMs;
    const lowRttSamples = sorted
      .filter((s) => s.rttMs <= minRtt * 2 + 25)
      .slice(0, 3);
    const bestSlice = lowRttSamples.length > 0 ? lowRttSamples : [sorted[0]];
    const avgOffset = bestSlice.reduce((sum, s) => sum + s.offsetMs, 0) / bestSlice.length;
    return {
      rttMs: Math.round(minRtt),
      offsetMs: Math.round(avgOffset),
    };
  }

  hasSamples(): boolean {
    return this.samples.length > 0;
  }

  reset(): void {
    this.samples = [];
  }
}

export function computeScheduledStartDelayMs(params: {
  startAtHostMs: number;
  localNowMs: number;
  clockOffsetMs: number;
}): number {
  const targetLocalMs = params.startAtHostMs - params.clockOffsetMs;
  return Math.max(0, Math.min(3_000, Math.round(targetLocalMs - params.localNowMs)));
}

export type AriaDriftAction = "none" | "speed" | "seek";

export type AriaDriftEvaluation = {
  driftMs: number;
  action: AriaDriftAction;
  speed: number;
  shouldSeek: boolean;
  targetSec: number;
};

export function evaluateAriaRoomDrift(params: {
  expectedSec: number;
  actualSec: number;
  playing: boolean;
}): AriaDriftEvaluation {
  const driftMs = Math.round((params.actualSec - params.expectedSec) * 1000);
  const absDrift = Math.abs(driftMs);
  const targetSec = Math.max(0, params.expectedSec);

  if (!params.playing) {
    const shouldSeek = absDrift >= 500;
    return {
      driftMs,
      action: shouldSeek ? "seek" : "none",
      speed: 1,
      shouldSeek,
      targetSec,
    };
  }

  if (absDrift < 350) {
    return {
      driftMs,
      action: "none",
      speed: 1,
      shouldSeek: false,
      targetSec,
    };
  }

  if (absDrift <= 1_200) {
    return {
      driftMs,
      action: "speed",
      speed: driftMs < 0 ? 1.015 : 0.985,
      shouldSeek: false,
      targetSec,
    };
  }

  if (absDrift <= 3_500) {
    return {
      driftMs,
      action: "speed",
      speed: driftMs < 0 ? 1.03 : 0.97,
      shouldSeek: false,
      targetSec,
    };
  }

  if (absDrift <= 10_000) {
    return {
      driftMs,
      action: "speed",
      speed: driftMs < 0 ? 1.05 : 0.95,
      shouldSeek: false,
      targetSec,
    };
  }

  return {
    driftMs,
    action: "seek",
    speed: 1,
    shouldSeek: true,
    targetSec,
  };
}

export function resolveSyncAnchorMs(event: AriaRoomSyncEvent): number {
  return event.kind === "play_at" && event.startAtHostMs > 0
    ? event.startAtHostMs
    : event.serverTimeMs;
}

export function applyPlaybackSyncToState(
  playback: AriaRoomPlaybackState,
  event: AriaRoomSyncEvent,
): AriaRoomPlaybackState {
  if (event.seq <= playback.serverSeq) return playback;
  if (event.nonce && playback.nonce && event.nonce !== playback.nonce) {
    return playback;
  }
  return {
    ...playback,
    serverSeq: event.seq,
    positionSec: Math.max(0, event.positionSec),
    updatedAtMs: resolveSyncAnchorMs(event),
    playing:
      event.kind === "play_at"
        ? true
        : event.kind === "pause"
          ? false
          : playback.playing,
  };
}

export function mergeIncomingPlaybackState(
  current: AriaRoomPlaybackState,
  incoming: AriaRoomPlaybackState,
): AriaRoomPlaybackState {
  if (
    incoming.nonce &&
    incoming.nonce === current.nonce &&
    incoming.serverSeq < current.serverSeq
  ) {
    return {
      ...incoming,
      playing: current.playing,
      positionSec: current.positionSec,
      updatedAtMs: current.updatedAtMs,
      serverSeq: current.serverSeq,
    };
  }
  return incoming;
}

export function computeExpectedPlaybackSec(params: {
  playback: AriaRoomPlaybackState;
  localNowMs: number;
  clockOffsetMs: number;
  clockSynced: boolean;
  maxDurationSec?: number;
}): number {
  if (!params.playback.playing) {
    return Math.max(0, params.playback.positionSec);
  }
  if (!params.clockSynced || params.playback.updatedAtMs <= 0) {
    return Math.max(0, params.playback.positionSec);
  }
  const elapsedSec = Math.max(
    0,
    (params.localNowMs + params.clockOffsetMs - params.playback.updatedAtMs) / 1000,
  );
  const raw = Math.max(0, params.playback.positionSec + elapsedSec);
  if (
    params.maxDurationSec &&
    Number.isFinite(params.maxDurationSec) &&
    params.maxDurationSec > 0
  ) {
    return Math.min(raw, params.maxDurationSec);
  }
  return raw;
}

export function rankRelayCandidates(
  members: AriaRoomMember[],
  source: AriaRoomTrackPayload["source"],
  hostPeerId: string | null,
): AriaRoomMember[] {
  const scoreMember = (m: AriaRoomMember): number => {
    const caps = m.capabilities;
    let tier = 0;
    if (source === "netease" || source === "cloud") {
      tier = caps?.netease === "vip" ? 30 : caps?.netease === "free" ? 20 : 10;
    } else if (source === "qq") {
      tier = caps?.qq === "vip" ? 30 : caps?.qq === "free" ? 20 : 10;
    } else if (source === "bilibili") {
      tier = caps?.bilibili === "vip" ? 30 : caps?.bilibili === "free" ? 20 : 10;
    } else if (source === "youtube") {
      tier = caps?.youtube === "reachable" ? 30 : 0;
    } else {
      tier = m.peerId === hostPeerId ? 30 : 10;
    }
    if (m.peerId === hostPeerId) tier += 5;
    return tier;
  };

  return members
    .filter((m) => m.shareEnabled !== false)
    .sort((a, b) => {
      const diff = scoreMember(b) - scoreMember(a);
      if (diff !== 0) return diff;
      return a.joinedAt - b.joinedAt;
    });
}

export type ParsedAriaJoinInput =
  | { kind: "cloudflare"; roomId: string }
  | { kind: "direct"; host: string; port: number; token: string };

export function decodeAriaJoinInput(raw: string): ParsedAriaJoinInput | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^aria-direct:\/\//i.test(trimmed)) {
    try {
      const normalized = trimmed.replace(/^aria-direct:\/\//i, "http://");
      const url = new URL(normalized);
      let host = (url.searchParams.get("host")?.trim() ?? "").replace(/^\[(.*)\]$/, "$1");
      let port = Number(url.searchParams.get("port") || 3639);
      const token = url.searchParams.get("token")?.trim() ?? "";
      // Handle accidental ipv4:port or domain:port inside host query param without touching IPv6 literals.
      const singleColonIdx = host.indexOf(":");
      if (singleColonIdx > 0 && host.indexOf(":", singleColonIdx + 1) === -1) {
        const maybePort = Number(host.slice(singleColonIdx + 1));
        if (Number.isInteger(maybePort) && maybePort >= 1024 && maybePort <= 65535) {
          host = host.slice(0, singleColonIdx).trim();
          port = maybePort;
        }
      }
      if (host && token && Number.isFinite(port) && port >= 1024 && port <= 65535) {
        return { kind: "direct", host, port: Math.floor(port), token };
      }
      return null;
    } catch {
      return null;
    }
  }

  // Format: [host]:port#token or host:port#token
  const hashIdx = trimmed.indexOf("#");
  if (hashIdx > 0) {
    const addrPart = trimmed.slice(0, hashIdx).trim();
    const token = trimmed.slice(hashIdx + 1).trim();
    if (!token) return null;

    const ipv6Match = /^\[([^\]]+)\]:(\d{2,5})$/.exec(addrPart);
    if (ipv6Match) {
      const port = Number(ipv6Match[2]);
      if (port >= 1024 && port <= 65535) {
        return { kind: "direct", host: ipv6Match[1], port, token };
      }
      return null;
    }

    const lastColon = addrPart.lastIndexOf(":");
    if (lastColon > 0) {
      const host = addrPart.slice(0, lastColon).trim();
      const port = Number(addrPart.slice(lastColon + 1));
      if (host && Number.isFinite(port) && port >= 1024 && port <= 65535) {
        return { kind: "direct", host, port, token };
      }
    }
    return null;
  }

  const cleanCode = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleanCode.length >= 4 && cleanCode.length <= 12) {
    return { kind: "cloudflare", roomId: cleanCode };
  }
  return null;
}

export function createTrackNonce(trackId: string): string {
  const safeSlug = trackId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12) || "trk";
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 12);
  return `${safeSlug}_${rand}`;
}

export function normalizePortableApiUrl(raw?: string | null): string | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.startsWith("/api/")) return trimmed;
  const localMatch = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/api\/.*)$/i.exec(trimmed);
  if (localMatch?.[1]) return localMatch[1];
  return trimmed;
}

export function canonicalTrackId(
  track: Pick<Track, "id" | "source" | "providerId" | "originTrackId">,
): string {
  const origin = track.originTrackId?.trim();
  if (origin && !origin.startsWith("aria-room:")) {
    return origin;
  }
  const pid = track.providerId?.trim();
  if (
    pid &&
    (track.source === "netease" ||
      track.source === "qq" ||
      track.source === "bilibili" ||
      track.source === "youtube")
  ) {
    return `${track.source}:${pid}`;
  }
  return track.id;
}

export function trackToAriaPayload(
  track: Track,
  nonce = createTrackNonce(track.id),
  addedBy?: { peerId: string; nickname: string },
): AriaRoomTrackPayload {
  const stableId = canonicalTrackId(track);
  return {
    nonce,
    id: stableId,
    providerId: track.providerId,
    source: track.source,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    quality: track.quality,
    bitrate: track.bitrate ?? null,
    sampleRate: track.sampleRate ?? null,
    currentLevel: track.currentLevel ?? null,
    ...(track.availableLevels?.length ? { availableLevels: track.availableLevels } : {}),
    coverUrl: normalizePortableApiUrl(track.coverUrl),
    streamUrl: normalizePortableApiUrl(track.streamUrl),
    addedByPeerId: addedBy?.peerId,
    addedByName: addedBy?.nickname,
  };
}

export function formatAriaBitrateKbps(bitrate?: number | null): string | null {
  if (typeof bitrate !== "number" || !Number.isFinite(bitrate) || bitrate <= 0) return null;
  const kbps = bitrate >= 10_000 ? Math.round(bitrate / 1000) : Math.round(bitrate);
  return `${kbps} kbps`;
}

function resolveAriaGuestCoverUrl(payload: AriaRoomTrackPayload, encodedNonce: string): string {
  if (
    payload.source === "youtube" &&
    (payload.coverDataUrl || payload.dispatch?.mode === "stream_proxy")
  ) {
    return api.resolveUrl(`/api/aria-room/guest/cover/${encodedNonce}`);
  }
  const rawCover = normalizePortableApiUrl(payload.coverUrl) ?? "";
  if (
    rawCover &&
    payload.source !== "local" &&
    (/^https?:\/\//i.test(rawCover) ||
      rawCover.startsWith("/api/providers/") ||
      rawCover.startsWith("/api/sources/"))
  ) {
    return rawCover.startsWith("/api/") ? api.resolveUrl(rawCover) : rawCover;
  }
  return api.resolveUrl(`/api/aria-room/guest/cover/${encodedNonce}`);
}

function resolveAriaFallbackCoverUrl(
  payload: AriaRoomTrackPayload,
  primaryCoverUrl: string,
  guestCoverEndpoint: string,
): string | undefined {
  if (primaryCoverUrl !== guestCoverEndpoint) {
    return guestCoverEndpoint;
  }
  const rawCover = normalizePortableApiUrl(payload.coverUrl) ?? "";
  if (
    rawCover &&
    payload.source !== "local" &&
    (/^https?:\/\//i.test(rawCover) ||
      rawCover.startsWith("/api/providers/") ||
      rawCover.startsWith("/api/sources/"))
  ) {
    return rawCover.startsWith("/api/") ? api.resolveUrl(rawCover) : rawCover;
  }
  return undefined;
}

function deriveCanonicalStreamUrl(payload: AriaRoomTrackPayload): string | null {
  const pid = payload.providerId?.trim() || "";
  if (payload.source === "netease" && pid) {
    return `/api/providers/netease/stream/${encodeURIComponent(pid)}`;
  }
  if (
    (payload.source === "qq" || payload.source === "bilibili" || payload.source === "youtube") &&
    pid
  ) {
    return `/api/sources/${payload.source}/tracks/${encodeURIComponent(pid)}/stream`;
  }
  if (payload.source === "local" && payload.id) {
    return `/api/library/tracks/${encodeURIComponent(payload.id)}/stream`;
  }
  return null;
}

export function canonicalizeTrackForLibrary(track: Track): Track {
  const id = canonicalTrackId(track);
  const derivedStream = deriveCanonicalStreamUrl({
    nonce: "",
    id,
    providerId: track.providerId,
    source: track.source,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    quality: track.quality,
  });
  const streamUrl =
    track.streamUrl && !track.streamUrl.includes("/api/aria-room/guest/stream/")
      ? track.streamUrl
      : derivedStream ?? track.streamUrl;
  const { originTrackId: _omitOrigin, coverFallbackUrl: _omitFallback, ...rest } = track;
  return {
    ...rest,
    id,
    ...(streamUrl ? { streamUrl } : {}),
  };
}

export function ariaPayloadToHostTrack(
  payload: AriaRoomTrackPayload,
  hostPeerId: string | null,
): Track {
  const encodedNonce = encodeURIComponent(payload.nonce);
  const ownedByOtherPeer = Boolean(payload.addedByPeerId && hostPeerId && payload.addedByPeerId !== hostPeerId);
  const relayedViaPeer = Boolean(
    payload.dispatch?.providerPeerId &&
      hostPeerId &&
      payload.dispatch.providerPeerId !== hostPeerId &&
      payload.dispatch.mode !== "resolve_local",
  );
  const needsRelayStream = relayedViaPeer || (payload.source === "local" && ownedByOtherPeer);

  const normalizedStream = normalizePortableApiUrl(payload.streamUrl);
  const usableOwnStream =
    normalizedStream && !normalizedStream.startsWith("/api/aria-room/guest/stream/")
      ? normalizedStream
      : null;
  const streamUrl = needsRelayStream
    ? `/api/aria-room/guest/stream/${encodedNonce}`
    : usableOwnStream ?? deriveCanonicalStreamUrl(payload) ?? `/api/aria-room/guest/stream/${encodedNonce}`;

  const guestCoverEndpoint = api.resolveUrl(`/api/aria-room/guest/cover/${encodedNonce}`);
  const coverUrl =
    payload.source === "local" && ownedByOtherPeer
      ? guestCoverEndpoint
      : resolveAriaGuestCoverUrl(payload, encodedNonce);
  const coverFallbackUrl = resolveAriaFallbackCoverUrl(payload, coverUrl, guestCoverEndpoint);

  return {
    id: payload.id,
    originTrackId: payload.id,
    providerId: payload.providerId,
    source: payload.source,
    title: payload.title,
    artist: payload.artist,
    album: payload.album,
    duration: payload.duration,
    quality: payload.quality,
    bitrate: payload.bitrate ?? null,
    sampleRate: payload.sampleRate ?? null,
    currentLevel: payload.currentLevel ?? null,
    availableLevels: payload.availableLevels,
    streamUrl,
    coverUrl,
    ...(coverFallbackUrl ? { coverFallbackUrl } : {}),
    cover: "linear-gradient(135deg, #4338ca 0%, #1e1b4b 100%)",
    accent: "#38bdf8",
    waveform: [],
    lyrics: [],
    lyricStatus: "searchable",
  };
}

export function ariaPayloadToGuestTrack(payload: AriaRoomTrackPayload): Track {
  const encodedNonce = encodeURIComponent(payload.nonce);
  const coverUrl = resolveAriaGuestCoverUrl(payload, encodedNonce);
  const guestCoverEndpoint = api.resolveUrl(`/api/aria-room/guest/cover/${encodedNonce}`);
  const coverFallbackUrl = resolveAriaFallbackCoverUrl(payload, coverUrl, guestCoverEndpoint);
  return {
    id: `aria-room:${payload.nonce}`,
    originTrackId: payload.id,
    providerId: payload.providerId,
    source: payload.source,
    title: payload.title,
    artist: payload.artist,
    album: payload.album,
    duration: payload.duration,
    quality: payload.quality,
    bitrate: payload.bitrate ?? null,
    sampleRate: payload.sampleRate ?? null,
    currentLevel: payload.currentLevel ?? null,
    availableLevels: payload.availableLevels,
    streamUrl: `/api/aria-room/guest/stream/${encodedNonce}`,
    coverUrl,
    ...(coverFallbackUrl ? { coverFallbackUrl } : {}),
    cover: "linear-gradient(135deg, #4338ca 0%, #1e1b4b 100%)",
    accent: "#38bdf8",
    waveform: [],
    lyrics: [],
    lyricStatus: "searchable",
  };
}

export function buildDurationSeconds(durationStr: string): number {
  const parts = durationStr.split(":").map((n) => Number(n));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

export function encodeMediaPacket(
  header: {
    nonce: string;
    offset: number;
    totalBytes: number | null;
    eof: boolean;
    mimeType: string;
    bitrate: number | null;
    sampleRate: number | null;
    currentLevel: string | null;
  },
  chunk: ArrayBuffer,
): ArrayBuffer {
  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(JSON.stringify(header));
  const out = new Uint8Array(4 + headerBytes.byteLength + chunk.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, headerBytes.byteLength, false);
  out.set(headerBytes, 4);
  out.set(new Uint8Array(chunk), 4 + headerBytes.byteLength);
  return out.buffer;
}

export function decodeMediaPacket(packet: ArrayBuffer): {
  header: {
    nonce: string;
    offset: number;
    totalBytes: number | null;
    eof: boolean;
    mimeType: string;
    bitrate: number | null;
    sampleRate: number | null;
    currentLevel: string | null;
  };
  payload: Uint8Array;
} {
  if (packet.byteLength < 4) {
    throw new Error("Truncated media packet header");
  }
  const view = new DataView(packet);
  const headerLen = view.getUint32(0, false);
  if (4 + headerLen > packet.byteLength) {
    throw new Error("Invalid media packet header length");
  }
  const decoder = new TextDecoder();
  const headerJson = decoder.decode(new Uint8Array(packet, 4, headerLen));
  const header = JSON.parse(headerJson);
  const payload = new Uint8Array(packet, 4 + headerLen);
  return { header, payload };
}
