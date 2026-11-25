import crypto from "node:crypto";
import type { EventEmitter } from "node:events";
import http from "node:http";
import os from "node:os";
import net from "node:net";
import type { Request, Response } from "express";
import { getNeteaseAccountSummary, peekNeteaseAccountSummary } from "../services/neteaseService";
import { peekBilibiliCapability, resolveBilibiliCapability } from "../sources/bilibili/client";
import { readSourceEnabledMap } from "../sources/registry";
import { readStore, updateStore } from "../store";
import type { AriaRoomStoredConfig } from "../types";
import { HttpError } from "../utils/httpError";
import {
  TrackByteCache,
  resolveExternalUpstream,
  sanitizeSafeHeaders,
  type AriaRoomCapabilities,
  type AriaRoomDeliveryMode,
  type AriaRoomTrackDispatch,
  type AriaRoomTrackPayload,
  type BufferedTrackEntry,
} from "./byteCache";

export type { AriaRoomCapabilities, AriaRoomDeliveryMode, AriaRoomTrackDispatch };
export { sanitizeSafeHeaders };
import {
  AriaWebSocket,
  acceptWebSocketUpgrade,
  connectWebSocket,
  isSelfHostedSignalingUrl,
  normalizeWebSocketUrl,
  probeCloudflareIps,
  probeSingleEndpoint,
  type CloudflareIpProbeResult,
} from "./wsProtocol";

export const MAX_ARIA_ROOM_MEMBERS = 5;
export const DEFAULT_ARIA_ROOM_DIRECT_PORT = 3639;
const LEGACY_PLACEHOLDER_SIGNALING_URL = "https://signal.aria-listen.workers.dev";
export type AriaSignalingProvider = "cloudflare" | "self-hosted";

export const DEFAULT_ARIA_SIGNALING_URL =
  normalizeSignalingUrlInput(process.env.ARIA_SIGNALING_URL, "cloudflare") || "";

function sanitizeSignalingUrl(raw: string | undefined | null): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed === LEGACY_PLACEHOLDER_SIGNALING_URL) return "";
  return trimmed;
}

export function normalizeSignalingUrlInput(
  raw: string | undefined | null,
  provider?: AriaSignalingProvider,
): string {
  const trimmed = sanitizeSignalingUrl(raw).replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^(?:https?|wss?):\/\//i.test(trimmed)) return trimmed;
  const hostPart = trimmed.split("/")[0]?.trim() ?? "";
  const isLocalOrIp =
    /^localhost(?::\d+)?$/i.test(hostPart) ||
    /^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(hostPart) ||
    hostPart.startsWith("[");
  const scheme = provider === "self-hosted" || isLocalOrIp ? "http://" : "https://";
  return `${scheme}${trimmed}`;
}

export function parseDirectPublicHost(
  raw: string | undefined | null,
): { host: string; port: number | null } | null {
  let cleaned = (raw ?? "").trim();
  if (!cleaned) return null;
  cleaned = cleaned.replace(/^(?:https?|wss?):\/\//i, "");
  cleaned = cleaned.split(/[/?#]/)[0]?.trim() ?? "";
  if (!cleaned) return null;

  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(cleaned);
  if (bracketed) {
    const innerHost = bracketed[1]?.trim() ?? "";
    const parsedPort = bracketed[2] ? Number(bracketed[2]) : null;
    const port = parsedPort && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : null;
    return innerHost ? { host: innerHost, port } : null;
  }

  if (net.isIPv6(cleaned)) {
    return { host: cleaned, port: null };
  }

  const firstColon = cleaned.indexOf(":");
  if (firstColon > 0 && cleaned.indexOf(":", firstColon + 1) === -1) {
    const host = cleaned.slice(0, firstColon).trim();
    const rawPort = Number(cleaned.slice(firstColon + 1));
    const port = Number.isInteger(rawPort) && rawPort >= 1 && rawPort <= 65535 ? rawPort : null;
    return host ? { host, port } : null;
  }

  return firstColon === -1 ? { host: cleaned, port: null } : null;
}

export type AriaRoomNetworkMode = "cloudflare" | "direct" | "hybrid";
export type AriaRoomControlMode = "host-only" | "collaborative";

export type AriaRoomMember = {
  peerId: string;
  nickname: string;
  avatarUrl: string | null;
  role: "host" | "guest";
  joinedAt: number;
  connectedVia: "direct" | "webrtc" | "ws";
  readyNonce?: string | null;
  shareEnabled?: boolean;
  capabilities?: AriaRoomCapabilities;
};

export type RelayResolveOutcome = {
  ok: boolean;
  directUrl?: string | null;
  safeHeaders?: Record<string, string>;
  mimeType?: string | null;
  bitrate?: number | null;
  sampleRate?: number | null;
  quality?: AriaRoomTrackPayload["quality"] | null;
  currentLevel?: AriaRoomTrackPayload["currentLevel"];
  availableLevels?: AriaRoomTrackPayload["availableLevels"];
  coverDataUrl?: string | null;
  isTrial?: boolean;
  reason?: string;
};

const RESOLVE_TIMEOUT_MS = 3_000;

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

export type AriaRoomPlaybackState = {
  nonce: string | null;
  track: AriaRoomTrackPayload | null;
  nextTrack: AriaRoomTrackPayload | null;
  queue: AriaRoomTrackPayload[];
  playing: boolean;
  positionSec: number;
  updatedAtMs: number;
  serverSeq: number;
};

export type AriaRoomSyncEvent = {
  seq: number;
  kind: "play_at" | "pause" | "seek" | "track_change";
  nonce: string | null;
  positionSec: number;
  startAtHostMs: number;
  serverTimeMs: number;
};

export type AriaRoomConfigSnapshot = {
  signalingProvider: AriaSignalingProvider;
  signalingUrl: string;
  selfHostedSignalingUrl: string;
  preferredIps: string[];
  autoPreferredIp: boolean;
  selectedPreferredIp: string | null;
  directPort: number;
  publicHost: string;
  turnUrls: string[];
  turnUsername: string;
  turnCredential: string;
};

export type AriaRoomSnapshot = {
  active: boolean;
  role: "host" | "guest" | null;
  roomId: string | null;
  myPeerId: string | null;
  maxMembers: number;
  networkMode: AriaRoomNetworkMode;
  controlMode: AriaRoomControlMode;
  signalingState: "idle" | "connecting" | "connected" | "reconnecting" | "error";
  signalingConnectedIp: string | null;
  signalingLatencyMs: number | null;
  signalingError: string | null;
  directServer: {
    active: boolean;
    port: number;
    roomToken: string | null;
    lanAddresses: string[];
    ipv6Addresses: string[];
    publicHost: string | null;
    shareString: string | null;
    publicShareString?: string | null;
    ipv4ShareString?: string | null;
    ipv6ShareString?: string | null;
    resolvedPublicEndpoint?: { host: string; port: number } | null;
    error: string | null;
  };
  guestDirectBaseUrl: string | null;
  guestDirectToken: string | null;
  members: AriaRoomMember[];
  playback: AriaRoomPlaybackState;
  localCapabilities: AriaRoomCapabilities;
  shareEnabled: boolean;
  iceConfig: {
    iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  };
};

type CreateRoomInput = {
  peerId: string;
  nickname: string;
  avatarUrl?: string | null;
  shareEnabled?: boolean;
  capabilities?: AriaRoomCapabilities;
  networkMode: AriaRoomNetworkMode;
  controlMode?: AriaRoomControlMode;
  directPort?: number;
  publicHost?: string | null;
  signalingUrl?: string | null;
  preferredIp?: string | null;
  track?: AriaRoomTrackPayload | null;
  nextTrack?: AriaRoomTrackPayload | null;
  queue?: AriaRoomTrackPayload[];
  playing?: boolean;
  positionSec?: number;
};

type JoinRoomInput = {
  peerId: string;
  nickname: string;
  avatarUrl?: string | null;
  shareEnabled?: boolean;
  capabilities?: AriaRoomCapabilities;
  mode: "cloudflare" | "direct";
  roomId?: string | null;
  directHost?: string | null;
  directPort?: number | null;
  directToken?: string | null;
  signalingUrl?: string | null;
  preferredIp?: string | null;
};

type DirectAuthAttemptRecord = {
  fails: number;
  windowStart: number;
  blockedUntil: number;
};

const EMPTY_PLAYBACK: AriaRoomPlaybackState = {
  nonce: null,
  track: null,
  nextTrack: null,
  queue: [],
  playing: false,
  positionSec: 0,
  updatedAtMs: 0,
  serverSeq: 0,
};

function generateRoomCode(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.randomBytes(6);
  let out = "";
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

function generateRoomToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function normalizeRemoteIp(raw: string | undefined | null): string {
  const trimmed = (raw ?? "").trim();
  return trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed || "unknown";
}

function extractBearerOrQueryToken(req: http.IncomingMessage, url: URL): string | null {
  const authHeader = String(req.headers.authorization ?? "").trim();
  if (/^Bearer\s+/i.test(authHeader)) {
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (token) return token;
  }
  const queryToken = url.searchParams.get("token")?.trim();
  return queryToken || null;
}

export function timingSafeTokenMatch(expected: string | null, provided: string | null): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.byteLength !== b.byteLength) return false;
  return crypto.timingSafeEqual(a, b);
}

function interfacePriorityRank(ifName: string): number {
  const lower = ifName.trim().toLowerCase();
  if (
    /^(?:utun|awdl|llw|bridge|docker|veth|br-|lo|gif|stf|anpi|vethernet|vmware|virtualbox|vbox|tailscale|zerotier|clash|mihomo|meta|sing-box|wintun|wireguard|wg\d*|tun\d*|tap\d*|hyper-v|loopback)/i.test(
      lower,
    ) ||
    /(?:wsl|virtual|vmware|vbox|loopback|pseudo|npcap|bluetooth|蓝牙)/i.test(lower)
  ) {
    return 2;
  }
  if (/^(?:en\d+|eth\d+|wlan\d*|wi-?fi|ethernet|以太网|无线网络|本地连接)/i.test(lower)) return 0;
  return 1;
}

export function extractNetworkAddresses(
  nets: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
): { lanAddresses: string[]; ipv6Addresses: string[] } {
  const ipv4Candidates: Array<{ address: string; rank: number }> = [];
  const ipv6Candidates: Array<{ address: string; rank: number }> = [];

  for (const [ifName, entries] of Object.entries(nets)) {
    if (!entries) continue;
    const rank = interfacePriorityRank(ifName);
    for (const item of entries) {
      if (item.internal) continue;
      if (item.family === "IPv4") {
        if (!item.address.startsWith("169.254.")) {
          const effectiveRank =
            item.address.startsWith("198.18.") || item.address.startsWith("198.19.") ? 3 : rank;
          ipv4Candidates.push({ address: item.address, rank: effectiveRank });
        }
      } else if (item.family === "IPv6") {
        const lower = item.address.toLowerCase();
        if (!lower.startsWith("fe80:") && !lower.startsWith("::1") && !lower.startsWith("fc") && !lower.startsWith("fd")) {
          ipv6Candidates.push({ address: item.address, rank });
        }
      }
    }
  }

  ipv4Candidates.sort((a, b) => a.rank - b.rank);
  ipv6Candidates.sort((a, b) => a.rank - b.rank);
  return {
    lanAddresses: Array.from(new Set(ipv4Candidates.map((item) => item.address))),
    ipv6Addresses: Array.from(new Set(ipv6Candidates.map((item) => item.address))),
  };
}

export function detectLocalNetworkAddresses(): { lanAddresses: string[]; ipv6Addresses: string[] } {
  return extractNetworkAddresses(os.networkInterfaces());
}

export function formatHostForUrl(host: string): string {
  const trimmed = host.trim();
  const unbracketed = trimmed.replace(/^\[(.*)\]$/, "$1");
  if (net.isIPv6(unbracketed)) {
    return `[${unbracketed}]`;
  }
  return trimmed;
}

export function buildDirectShareString(params: {
  host: string;
  port: number;
  roomToken: string;
}): string {
  const query = new URLSearchParams({
    host: params.host,
    port: String(params.port),
    token: params.roomToken,
  });
  return `aria-direct://v1?${query.toString()}`;
}

export function buildSignalingWsUrl(
  baseUrl: string,
  roomId: string,
  peerId: string,
  role: "host" | "guest",
): string {
  const parsed = new URL(baseUrl.trim());
  if (parsed.protocol === "https:") parsed.protocol = "wss:";
  else if (parsed.protocol === "http:") parsed.protocol = "ws:";
  if (!parsed.pathname || parsed.pathname === "/") {
    parsed.pathname = "/ws";
  }
  parsed.searchParams.set("room", roomId);
  parsed.searchParams.set("peer", peerId);
  parsed.searchParams.set("role", role);
  return parsed.toString();
}

export function computeHeartbeatClockSample(sample: {
  t0: number;
  t1: number;
  t2: number;
  t3: number;
}): { rttMs: number; offsetMs: number } {
  const rttMs = Math.max(1, sample.t3 - sample.t0 - (sample.t2 - sample.t1));
  const offsetMs = (sample.t1 - sample.t0 + (sample.t2 - sample.t3)) / 2;
  return { rttMs, offsetMs };
}

class HeartbeatClockTracker {
  private samples: Array<{ rttMs: number; offsetMs: number }> = [];
  private readonly maxSamples: number;

  constructor(maxSamples = 8) {
    this.maxSamples = maxSamples;
  }

  record(sample: { t0: number; t1: number; t2: number; t3: number }): {
    rttMs: number;
    offsetMs: number;
  } {
    const next = computeHeartbeatClockSample(sample);
    this.samples.push(next);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
    const sorted = [...this.samples].sort((a, b) => a.rttMs - b.rttMs);
    const minRtt = sorted[0].rttMs;
    const lowRttSamples = sorted.filter((s) => s.rttMs <= minRtt * 2 + 25).slice(0, 3);
    const bestSlice = lowRttSamples.length > 0 ? lowRttSamples : [sorted[0]];
    const avgOffset = bestSlice.reduce((sum, s) => sum + s.offsetMs, 0) / bestSlice.length;
    return {
      rttMs: Math.round(minRtt),
      offsetMs: Math.round(avgOffset),
    };
  }

  reset(): void {
    this.samples = [];
  }
}

export class AriaRoomManager {
  private readonly localApiPort: number;
  private readonly customLocalResolver?: (track: AriaRoomTrackPayload) => Promise<RelayResolveOutcome>;
  private byteCache = new TrackByteCache();
  private sseClients = new Set<Response>();

  private active = false;
  private role: "host" | "guest" | null = null;
  private roomId: string | null = null;
  private myPeerId: string | null = null;
  private myProfile: { nickname: string; avatarUrl: string | null } = { nickname: "Aria 听众", avatarUrl: null };
  private myShareEnabled = true;
  private myCapabilities: AriaRoomCapabilities = {
    netease: "none",
    qq: "none",
    bilibili: "free",
    youtube: "reachable",
  };
  private networkMode: AriaRoomNetworkMode = "cloudflare";
  private controlMode: AriaRoomControlMode = "collaborative";
  private playback: AriaRoomPlaybackState = { ...EMPTY_PLAYBACK };
  private members = new Map<string, AriaRoomMember>();
  private pendingResolves = new Map<
    string,
    { resolve: (res: RelayResolveOutcome) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private proxyFallbackRequestedNonces = new Set<string>();
  private fallbackServingNonces = new Set<string>();

  // Signaling WebSocket (Host or Guest -> Cloudflare Worker, OR Guest -> Host Direct WS)
  private signalingWs: AriaWebSocket | null = null;
  private signalingState: AriaRoomSnapshot["signalingState"] = "idle";
  private signalingConnectedIp: string | null = null;
  private signalingLatencyMs: number | null = null;
  private signalingError: string | null = null;
  private signalingHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private signalingReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private signalingLastPongAt = 0;
  private signalingConsecutiveFailures = 0;
  private signalingTargetUrl: string | null = null;
  private manualLeave = false;
  private serverClockTracker = new HeartbeatClockTracker();
  private serverClockSynced = false;
  private serverClockOffsetMs = 0;
  private serverClockRttMs: number | null = null;
  private serverSupportsClockPong: boolean | null = null;
  private playbackAnchorUsesServerClock = false;
  private signalingBurstTimers: ReturnType<typeof setTimeout>[] = [];
  private firstPongResolvers: Array<() => void> = [];

  // Host Direct Server
  private directServer: http.Server | null = null;
  private directPort = DEFAULT_ARIA_ROOM_DIRECT_PORT;
  private directRoomToken: string | null = null;
  private directPublicHost: string | null = null;
  private directServerError: string | null = null;
  private directSockets = new Set<net.Socket>();
  private directWsClients = new Map<AriaWebSocket, { peerId: string | null }>();
  private directAuthAttempts = new Map<string, DirectAuthAttemptRecord>();
  private allowedNonces = new Set<string>();

  // Guest Direct Connection metadata
  private guestDirectBaseUrl: string | null = null;
  private guestDirectToken: string | null = null;

  // Config cache + IP probes
  private config: AriaRoomConfigSnapshot = {
    signalingProvider: "cloudflare",
    signalingUrl: DEFAULT_ARIA_SIGNALING_URL,
    selfHostedSignalingUrl: "",
    preferredIps: [],
    autoPreferredIp: true,
    selectedPreferredIp: null,
    directPort: DEFAULT_ARIA_ROOM_DIRECT_PORT,
    publicHost: "",
    turnUrls: [],
    turnUsername: "",
    turnCredential: "",
  };
  private lastProbeResults: CloudflareIpProbeResult[] = [];
  private configLoaded = false;

  constructor(options: {
    localApiPort: number;
    localResolver?: (track: AriaRoomTrackPayload) => Promise<RelayResolveOutcome>;
  }) {
    this.localApiPort = options.localApiPort;
    this.customLocalResolver = options.localResolver;
  }

  async detectLocalCapabilities(): Promise<AriaRoomCapabilities> {
    try {
      const [store, neteasePeek, bilibiliPeek, enabledSources] = await Promise.all([
        readStore().catch(() => null),
        peekNeteaseAccountSummary().catch(() => null),
        peekBilibiliCapability().catch(() => ({ tier: "free" as const, resolved: true })),
        readSourceEnabledMap().catch(() => ({} as Record<string, boolean>)),
      ]);
      const neteaseCap: AriaRoomCapabilities["netease"] = neteasePeek?.connected
        ? neteasePeek.isVip
          ? "vip"
          : "free"
        : store?.neteaseCookie
          ? "free"
          : "none";
      const qqEnabled = enabledSources.qq !== false;
      const qqCap: AriaRoomCapabilities["qq"] = !qqEnabled
        ? "none"
        : store?.qqCookie
          ? "vip"
          : "none";
      const bilibiliEnabled = enabledSources.bilibili !== false;
      const bilibiliCap: AriaRoomCapabilities["bilibili"] = !bilibiliEnabled
        ? "none"
        : bilibiliPeek.tier;
      const youtubeCap: AriaRoomCapabilities["youtube"] = enabledSources.youtube !== false ? "reachable" : "unreachable";

      this.myCapabilities = {
        netease: neteaseCap,
        qq: qqCap,
        bilibili: bilibiliCap,
        youtube: youtubeCap,
      };
      if (neteasePeek?.connected && neteasePeek.isVip === undefined) {
        void getNeteaseAccountSummary()
          .then((fresh) => {
            if (!fresh?.connected) return;
            const nextNetease: AriaRoomCapabilities["netease"] = fresh.isVip ? "vip" : "free";
            if (nextNetease !== this.myCapabilities.netease) {
              this.myCapabilities = { ...this.myCapabilities, netease: nextNetease };
              if (this.active) this.updateShareAndCapabilities(this.myShareEnabled, this.myCapabilities);
            }
          })
          .catch(() => undefined);
      }
      if (bilibiliEnabled && !bilibiliPeek.resolved) {
        void resolveBilibiliCapability()
          .then((nextBilibili) => {
            if (nextBilibili !== this.myCapabilities.bilibili) {
              this.myCapabilities = { ...this.myCapabilities, bilibili: nextBilibili };
              if (this.active) this.updateShareAndCapabilities(this.myShareEnabled, this.myCapabilities);
            }
          })
          .catch(() => undefined);
      }
    } catch {
      // Keep default capabilities if store read fails.
    }
    return this.myCapabilities;
  }

  updateShareAndCapabilities(
    shareEnabled: boolean,
    capabilities?: Partial<AriaRoomCapabilities>,
  ): AriaRoomSnapshot {
    this.myShareEnabled = Boolean(shareEnabled);
    if (capabilities) {
      this.myCapabilities = { ...this.myCapabilities, ...capabilities };
    }
    if (this.active && this.myPeerId && this.members.has(this.myPeerId)) {
      const me = this.members.get(this.myPeerId)!;
      this.members.set(this.myPeerId, {
        ...me,
        shareEnabled: this.myShareEnabled,
        capabilities: this.myCapabilities,
      });
      this.signalingWs?.sendJson({
        type: "update_capabilities",
        roomId: this.roomId,
        peerId: this.myPeerId,
        shareEnabled: this.myShareEnabled,
        capabilities: this.myCapabilities,
      });
      if (this.role === "host") {
        this.broadcastRoomState();
      }
      this.emitSse("state", this.getSnapshot());
    }
    return this.getSnapshot();
  }

  getActiveSignalingUrl(): string {
    return this.config.signalingProvider === "self-hosted"
      ? this.config.selfHostedSignalingUrl
      : this.config.signalingUrl;
  }

  async ensureConfigLoaded(): Promise<AriaRoomConfigSnapshot> {
    if (this.configLoaded) return this.config;
    const store = await readStore().catch(() => null);
    const saved: AriaRoomStoredConfig = store?.ariaRoomConfig ?? {};
    const rawCloudflare = normalizeSignalingUrlInput(saved.signalingUrl, "cloudflare");
    let rawSelfHosted = normalizeSignalingUrlInput(saved.selfHostedSignalingUrl, "self-hosted");
    let cloudflareUrl = rawCloudflare || DEFAULT_ARIA_SIGNALING_URL;
    let provider: AriaSignalingProvider =
      saved.signalingProvider === "self-hosted" ? "self-hosted" : "cloudflare";

    // Legacy config migration: if the old single field held a self-hosted IP/HTTP URL,
    // move it into selfHostedSignalingUrl while restoring the Cloudflare URL.
    if (!rawSelfHosted && rawCloudflare && isSelfHostedSignalingUrl(rawCloudflare)) {
      rawSelfHosted = normalizeSignalingUrlInput(rawCloudflare, "self-hosted");
      cloudflareUrl = DEFAULT_ARIA_SIGNALING_URL;
      if (!saved.signalingProvider) {
        provider = "self-hosted";
      }
    }

    this.config = {
      signalingProvider: provider,
      signalingUrl: cloudflareUrl,
      selfHostedSignalingUrl: rawSelfHosted,
      preferredIps: Array.isArray(saved.preferredIps) ? saved.preferredIps.filter(Boolean) : [],
      autoPreferredIp: saved.autoPreferredIp !== false,
      selectedPreferredIp: this.config.selectedPreferredIp,
      directPort: Number(saved.directPort) > 0 ? Number(saved.directPort) : DEFAULT_ARIA_ROOM_DIRECT_PORT,
      publicHost: saved.publicHost?.trim() || "",
      turnUrls: Array.isArray(saved.turnUrls) ? saved.turnUrls.filter(Boolean) : [],
      turnUsername: saved.turnUsername ?? "",
      turnCredential: saved.turnCredential ?? "",
    };
    this.configLoaded = true;
    return this.config;
  }

  async updateConfig(patch: Partial<AriaRoomConfigSnapshot>): Promise<AriaRoomConfigSnapshot> {
    await this.ensureConfigLoaded();
    const nextProvider: AriaSignalingProvider =
      patch.signalingProvider !== undefined
        ? patch.signalingProvider === "self-hosted"
          ? "self-hosted"
          : "cloudflare"
        : this.config.signalingProvider;

    const nextCloudflareUrl =
      patch.signalingUrl !== undefined
        ? normalizeSignalingUrlInput(patch.signalingUrl, "cloudflare")
        : this.config.signalingUrl;
    const nextSelfHostedUrl =
      patch.selfHostedSignalingUrl !== undefined
        ? normalizeSignalingUrlInput(patch.selfHostedSignalingUrl, "self-hosted")
        : this.config.selfHostedSignalingUrl;

    const cloudflareUrlChanged =
      patch.signalingUrl !== undefined && nextCloudflareUrl !== this.config.signalingUrl;
    const selfHostedUrlChanged =
      patch.selfHostedSignalingUrl !== undefined &&
      nextSelfHostedUrl !== this.config.selfHostedSignalingUrl;
    const providerChanged =
      patch.signalingProvider !== undefined && nextProvider !== this.config.signalingProvider;

    if (cloudflareUrlChanged || selfHostedUrlChanged || providerChanged) {
      this.lastProbeResults = [];
    }

    const next: AriaRoomConfigSnapshot = {
      signalingProvider: nextProvider,
      signalingUrl: nextCloudflareUrl,
      selfHostedSignalingUrl: nextSelfHostedUrl,
      preferredIps:
        patch.preferredIps !== undefined
          ? patch.preferredIps.map((x) => x.trim()).filter(Boolean)
          : this.config.preferredIps,
      autoPreferredIp: patch.autoPreferredIp !== undefined ? Boolean(patch.autoPreferredIp) : this.config.autoPreferredIp,
      selectedPreferredIp:
        patch.selectedPreferredIp !== undefined
          ? patch.selectedPreferredIp?.trim() || null
          : cloudflareUrlChanged || nextProvider === "self-hosted" || isSelfHostedSignalingUrl(nextCloudflareUrl)
            ? null
            : this.config.selectedPreferredIp,
      directPort:
        patch.directPort !== undefined && Number(patch.directPort) >= 1024 && Number(patch.directPort) <= 65535
          ? Math.floor(Number(patch.directPort))
          : this.config.directPort,
      publicHost: patch.publicHost !== undefined ? patch.publicHost.trim() : this.config.publicHost,
      turnUrls: patch.turnUrls !== undefined ? patch.turnUrls.map((x) => x.trim()).filter(Boolean) : this.config.turnUrls,
      turnUsername: patch.turnUsername !== undefined ? patch.turnUsername.trim() : this.config.turnUsername,
      turnCredential: patch.turnCredential !== undefined ? patch.turnCredential.trim() : this.config.turnCredential,
    };
    this.config = next;
    if (patch.publicHost !== undefined) {
      this.directPublicHost = next.publicHost || null;
    }
    if (patch.directPort !== undefined && !this.directServer) {
      this.directPort = next.directPort;
    }
    await updateStore((store) => ({
      ...store,
      ariaRoomConfig: {
        signalingProvider: next.signalingProvider,
        signalingUrl: next.signalingUrl || undefined,
        selfHostedSignalingUrl: next.selfHostedSignalingUrl || undefined,
        preferredIps: next.preferredIps,
        autoPreferredIp: next.autoPreferredIp,
        directPort: next.directPort,
        publicHost: next.publicHost || undefined,
        turnUrls: next.turnUrls,
        turnUsername: next.turnUsername || undefined,
        turnCredential: next.turnCredential || undefined,
      },
    }));
    if (this.active && (patch.publicHost !== undefined || patch.directPort !== undefined)) {
      this.emitSse("state", this.getSnapshot());
      if (this.role === "host") {
        this.broadcastRoomState();
      }
    }
    return next;
  }

  async probePreferredIps(
    overrideUrl?: string | null,
    provider?: AriaSignalingProvider,
  ): Promise<CloudflareIpProbeResult[]> {
    await this.ensureConfigLoaded();
    const effectiveProvider =
      provider ??
      (overrideUrl && isSelfHostedSignalingUrl(normalizeSignalingUrlInput(overrideUrl, "self-hosted"))
        ? "self-hosted"
        : overrideUrl
          ? "cloudflare"
          : this.config.signalingProvider);

    const targetUrl =
      normalizeSignalingUrlInput(overrideUrl, effectiveProvider) ||
      (effectiveProvider === "self-hosted"
        ? this.config.selfHostedSignalingUrl
        : this.config.signalingUrl);

    if (!targetUrl) {
      throw new HttpError(
        400,
        effectiveProvider === "self-hosted"
          ? "请先填入自建信令节点地址（例如 http://你的服务器IP:8787）"
          : "请先在网络设置填入已部署的 Aria 信令地址",
        "SIGNALING_URL_NOT_CONFIGURED",
      );
    }
    if (effectiveProvider === "self-hosted" || isSelfHostedSignalingUrl(targetUrl)) {
      const normalized = normalizeWebSocketUrl(targetUrl);
      const directResult = await probeSingleEndpoint(normalized, null, 2_800, "自建节点直连");
      this.lastProbeResults = [directResult];
      if (this.config.signalingProvider === "self-hosted") {
        this.config.selectedPreferredIp = null;
      }
      return this.lastProbeResults;
    }
    const results = await probeCloudflareIps(targetUrl, this.config.preferredIps);
    this.lastProbeResults = results;
    const best = results.find((item) => item.ok);
    if (best) {
      this.config.selectedPreferredIp = best.ip;
    }
    return results;
  }

  getLastProbeResults(): CloudflareIpProbeResult[] {
    return this.lastProbeResults;
  }

  getSnapshot(): AriaRoomSnapshot {
    const netInfo = detectLocalNetworkAddresses();
    const parsedPublic = parseDirectPublicHost(this.directPublicHost);
    const effectivePublicPort = parsedPublic?.port ?? this.directPort;

    const publicShareString =
      this.directServer && this.directRoomToken && parsedPublic
        ? buildDirectShareString({
            host: parsedPublic.host,
            port: effectivePublicPort,
            roomToken: this.directRoomToken,
          })
        : null;
    const ipv4ShareString =
      this.directServer && this.directRoomToken && netInfo.lanAddresses[0]
        ? buildDirectShareString({
            host: netInfo.lanAddresses[0],
            port: this.directPort,
            roomToken: this.directRoomToken,
          })
        : null;
    const ipv6ShareString =
      this.directServer && this.directRoomToken && netInfo.ipv6Addresses[0]
        ? buildDirectShareString({
            host: netInfo.ipv6Addresses[0],
            port: this.directPort,
            roomToken: this.directRoomToken,
          })
        : null;
    const primaryShareString =
      publicShareString ??
      ipv4ShareString ??
      ipv6ShareString ??
      (this.directServer && this.directRoomToken
        ? buildDirectShareString({
            host: "127.0.0.1",
            port: this.directPort,
            roomToken: this.directRoomToken,
          })
        : null);

    const iceServers: AriaRoomSnapshot["iceConfig"]["iceServers"] = [
      {
        urls: [
          "stun:stun.miwifi.com:3478",
          "stun:stun.qq.com:3478",
          "stun:stun.cloudflare.com:3478",
          "stun:stun.l.google.com:19302",
        ],
      },
    ];
    if (this.config.turnUrls.length > 0) {
      iceServers.push({
        urls: this.config.turnUrls,
        ...(this.config.turnUsername ? { username: this.config.turnUsername } : {}),
        ...(this.config.turnCredential ? { credential: this.config.turnCredential } : {}),
      });
    }

    return {
      active: this.active,
      role: this.role,
      roomId: this.roomId,
      myPeerId: this.myPeerId,
      maxMembers: MAX_ARIA_ROOM_MEMBERS,
      networkMode: this.networkMode,
      controlMode: this.controlMode,
      signalingState: this.signalingState,
      signalingConnectedIp: this.signalingConnectedIp,
      signalingLatencyMs: this.signalingLatencyMs,
      signalingError: this.signalingError,
      directServer: {
        active: Boolean(this.directServer),
        port: this.directPort,
        roomToken: this.directRoomToken,
        lanAddresses: netInfo.lanAddresses,
        ipv6Addresses: netInfo.ipv6Addresses,
        publicHost: this.directPublicHost,
        shareString: primaryShareString,
        publicShareString,
        ipv4ShareString,
        ipv6ShareString,
        resolvedPublicEndpoint: parsedPublic
          ? { host: parsedPublic.host, port: effectivePublicPort }
          : null,
        error: this.directServerError,
      },
      guestDirectBaseUrl: this.guestDirectBaseUrl,
      guestDirectToken: this.guestDirectToken,
      members: Array.from(this.members.values()).sort((a, b) => a.joinedAt - b.joinedAt),
      playback: this.playback,
      localCapabilities: this.myCapabilities,
      shareEnabled: this.myShareEnabled,
      iceConfig: { iceServers },
    };
  }

  attachSseClient(res: Response): () => void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    this.sseClients.add(res);
    this.writeSse(res, "state", this.getSnapshot());
    const keepalive = setInterval(() => {
      if (!res.writableEnded) res.write(": keepalive\n\n");
    }, 15_000);
    return () => {
      clearInterval(keepalive);
      this.sseClients.delete(res);
    };
  }

  private emitSse(event: string, data: unknown): void {
    for (const res of Array.from(this.sseClients)) {
      if (res.writableEnded) {
        this.sseClients.delete(res);
        continue;
      }
      this.writeSse(res, event, data);
    }
  }

  private writeSse(res: Response, event: string, data: unknown): void {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.sseClients.delete(res);
    }
  }

  async createRoom(input: CreateRoomInput): Promise<AriaRoomSnapshot> {
    await this.leaveRoom();
    await this.ensureConfigLoaded();

    this.manualLeave = false;
    this.active = true;
    this.role = "host";
    this.roomId = generateRoomCode();
    this.myPeerId = input.peerId;
    this.myProfile = {
      nickname: input.nickname.trim() || "Aria 房主",
      avatarUrl: input.avatarUrl ?? null,
    };
    this.myShareEnabled = input.shareEnabled !== false;
    this.myCapabilities = input.capabilities ?? (await this.detectLocalCapabilities());
    this.networkMode = input.networkMode;
    this.controlMode = input.controlMode ?? "collaborative";
    this.directPort = input.directPort ?? this.config.directPort;
    this.directPublicHost = input.publicHost?.trim() || this.config.publicHost || null;

    if (input.signalingUrl !== undefined) {
      const rawPass = input.signalingUrl;
      if (!rawPass?.trim()) {
        if (this.config.signalingProvider === "self-hosted") this.config.selfHostedSignalingUrl = "";
        else this.config.signalingUrl = "";
      } else {
        const normalizedSelf = normalizeSignalingUrlInput(rawPass, "self-hosted");
        if (isSelfHostedSignalingUrl(normalizedSelf)) {
          this.config.signalingProvider = "self-hosted";
          this.config.selfHostedSignalingUrl = normalizedSelf;
        } else {
          this.config.signalingProvider = "cloudflare";
          this.config.signalingUrl = normalizeSignalingUrlInput(rawPass, "cloudflare");
        }
      }
    }
    if (input.preferredIp !== undefined) {
      this.config.selectedPreferredIp = input.preferredIp?.trim() || null;
    }

    const activeSignalingUrl = this.getActiveSignalingUrl();
    if (this.networkMode === "cloudflare" && !activeSignalingUrl) {
      await this.leaveRoom();
      throw new HttpError(
        400,
        this.config.signalingProvider === "self-hosted"
          ? "尚未配置自建信令节点地址，请先在网络设置填入服务器 IP:端口，或切换回 Cloudflare 节点"
          : "尚未配置 Cloudflare 信令地址，请先在网络设置填入已部署的 Worker 自定义域名，或使用「房主直连」开房",
        "SIGNALING_URL_NOT_CONFIGURED",
      );
    }

    const hostMember: AriaRoomMember = {
      peerId: this.myPeerId,
      nickname: this.myProfile.nickname,
      avatarUrl: this.myProfile.avatarUrl,
      role: "host",
      joinedAt: Date.now(),
      connectedVia: this.networkMode === "direct" ? "direct" : "ws",
      shareEnabled: this.myShareEnabled,
      capabilities: this.myCapabilities,
    };
    this.members.set(this.myPeerId, hostMember);

    const queue = Array.isArray(input.queue)
      ? input.queue.map(({ coverDataUrl: _omitCover, ...rest }) => rest)
      : [];
    let currentTrack = input.track ?? null;
    const nextTrack = input.nextTrack ?? null;
    if (currentTrack && !currentTrack.dispatch) {
      const resolved = await this.resolveTrackForRoom(currentTrack).catch(() => ({ ok: false as const, reason: "RESOLVE_ERROR" }));
      if (resolved.ok) {
        currentTrack = resolved.track;
      }
    }
    if (currentTrack) {
      currentTrack = await this.maybeAttachCoverDataUrl(currentTrack);
    }
    const roomNow = this.getRoomClockNowMs();
    this.playbackAnchorUsesServerClock = this.serverClockSynced;
    this.playback = {
      nonce: currentTrack?.nonce ?? null,
      track: currentTrack,
      nextTrack,
      queue,
      playing: Boolean(input.playing),
      positionSec: Math.max(0, Number(input.positionSec ?? 0)),
      updatedAtMs: roomNow,
      serverSeq: 1,
    };
    this.refreshAllowedNonces();

    const shouldCacheCurrentOnHost =
      Boolean(currentTrack) &&
      (this.networkMode === "direct" ||
        this.networkMode === "hybrid" ||
        (currentTrack?.dispatch?.mode === "stream_proxy" &&
          (!currentTrack.dispatch.providerPeerId || currentTrack.dispatch.providerPeerId === this.myPeerId)));
    if (currentTrack && shouldCacheCurrentOnHost) {
      void this.prepareHostTrackInternal(currentTrack).catch(() => undefined);
    }
    if (nextTrack && (this.networkMode === "direct" || nextTrack.dispatch?.mode === "stream_proxy")) {
      void this.prepareHostTrackInternal(nextTrack).catch(() => undefined);
    }

    if (this.networkMode === "direct" || this.networkMode === "hybrid") {
      await this.startDirectServer();
    }

    if (this.networkMode === "cloudflare") {
      await this.connectToCloudflareSignaling({ throwOnInitialError: true });
    } else if (this.networkMode === "hybrid") {
      if (this.getActiveSignalingUrl()) {
        await this.connectToCloudflareSignaling({
          throwOnInitialError: false,
          suppressErrorState: true,
        });
      } else {
        this.signalingState = "connected";
        this.signalingError = null;
      }
    } else {
      this.signalingState = "connected";
    }

    const snapshot = this.getSnapshot();
    this.emitSse("state", snapshot);
    return snapshot;
  }

  async joinRoom(input: JoinRoomInput): Promise<AriaRoomSnapshot> {
    await this.leaveRoom();
    await this.ensureConfigLoaded();

    this.manualLeave = false;
    this.active = true;
    this.role = "guest";
    this.myPeerId = input.peerId;
    this.myProfile = {
      nickname: input.nickname.trim() || "Aria 听众",
      avatarUrl: input.avatarUrl ?? null,
    };
    this.myShareEnabled = input.shareEnabled !== false;
    this.myCapabilities = input.capabilities ?? (await this.detectLocalCapabilities());

    if (input.signalingUrl !== undefined) {
      const rawPass = input.signalingUrl;
      if (!rawPass?.trim()) {
        if (this.config.signalingProvider === "self-hosted") this.config.selfHostedSignalingUrl = "";
        else this.config.signalingUrl = "";
      } else {
        const normalizedSelf = normalizeSignalingUrlInput(rawPass, "self-hosted");
        if (isSelfHostedSignalingUrl(normalizedSelf)) {
          this.config.signalingProvider = "self-hosted";
          this.config.selfHostedSignalingUrl = normalizedSelf;
        } else {
          this.config.signalingProvider = "cloudflare";
          this.config.signalingUrl = normalizeSignalingUrlInput(rawPass, "cloudflare");
        }
      }
    }
    if (input.preferredIp !== undefined) {
      this.config.selectedPreferredIp = input.preferredIp?.trim() || null;
    }

    if (input.mode === "direct") {
      const parsedDirect = parseDirectPublicHost(input.directHost);
      const host = parsedDirect?.host;
      const port = parsedDirect?.port ?? Number(input.directPort || DEFAULT_ARIA_ROOM_DIRECT_PORT);
      const token = input.directToken?.trim();
      if (!host || !token) {
        await this.leaveRoom();
        throw new HttpError(400, "直连模式需要房主地址、端口与房间令牌", "DIRECT_PARAMS_REQUIRED");
      }

      this.networkMode = "direct";
      this.roomId = `DIRECT-${port}`;
      const formattedHost = formatHostForUrl(host);
      this.guestDirectBaseUrl = `http://${formattedHost}:${port}`;
      this.guestDirectToken = token;

      const wsUrl = `ws://${formattedHost}:${port}/aria-room/ws?token=${encodeURIComponent(token)}`;
      await this.connectSignalingSocket(wsUrl, { usePreferredIp: false, throwOnInitialError: true });
    } else {
      const code = input.roomId?.trim().toUpperCase();
      if (!code) {
        await this.leaveRoom();
        throw new HttpError(400, "请输入 6 位 Aria 房间码", "ROOM_CODE_REQUIRED");
      }
      if (!this.getActiveSignalingUrl()) {
        await this.leaveRoom();
        throw new HttpError(
          400,
          this.config.signalingProvider === "self-hosted"
            ? "尚未配置自建信令节点地址，请先在网络设置填入房主使用的自建服务器 IP:端口"
            : "尚未配置 Cloudflare 信令地址，请先在网络设置填入房主使用的 Worker 自定义域名",
          "SIGNALING_URL_NOT_CONFIGURED",
        );
      }
      this.networkMode = "cloudflare";
      this.roomId = code;
      await this.connectToCloudflareSignaling({ throwOnInitialError: true });
    }

    const snapshot = this.getSnapshot();
    this.emitSse("state", snapshot);
    return snapshot;
  }

  async leaveRoom(): Promise<AriaRoomSnapshot> {
    this.manualLeave = true;
    this.clearSignalingBurstTimers();
    if (this.signalingReconnectTimer) {
      clearTimeout(this.signalingReconnectTimer);
      this.signalingReconnectTimer = null;
    }
    if (this.signalingHeartbeatTimer) {
      clearInterval(this.signalingHeartbeatTimer);
      this.signalingHeartbeatTimer = null;
    }

    if (this.signalingWs) {
      try {
        if (this.role === "host") {
          this.signalingWs.sendJson({ type: "close_room", roomId: this.roomId });
        } else {
          this.signalingWs.sendJson({ type: "leave", roomId: this.roomId, peerId: this.myPeerId });
        }
        this.signalingWs.close(1000, "Room left");
      } catch {
        // ignore
      }
      this.signalingWs = null;
    }

    await this.stopDirectServer();

    this.active = false;
    this.role = null;
    this.roomId = null;
    this.myPeerId = null;
    this.signalingState = "idle";
    this.signalingConnectedIp = null;
    this.signalingLatencyMs = null;
    this.signalingError = null;
    this.signalingTargetUrl = null;
    this.signalingConsecutiveFailures = 0;
    this.serverClockTracker.reset();
    this.serverClockSynced = false;
    this.serverClockOffsetMs = 0;
    this.serverClockRttMs = null;
    this.serverSupportsClockPong = null;
    this.playbackAnchorUsesServerClock = false;
    for (const resolvePong of this.firstPongResolvers.splice(0)) {
      resolvePong();
    }
    this.guestDirectBaseUrl = null;
    this.guestDirectToken = null;
    for (const pending of this.pendingResolves.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, reason: "ROOM_LEFT" });
    }
    this.pendingResolves.clear();
    this.proxyFallbackRequestedNonces.clear();
    this.fallbackServingNonces.clear();
    this.members.clear();
    this.allowedNonces.clear();
    this.playback = { ...EMPTY_PLAYBACK };

    await this.byteCache.clearAll();
    this.byteCache = new TrackByteCache();

    const snapshot = this.getSnapshot();
    this.emitSse("state", snapshot);
    return snapshot;
  }

  async hostPrepareAndUpdateState(params: {
    track: AriaRoomTrackPayload | null;
    nextTrack?: AriaRoomTrackPayload | null;
    queue?: AriaRoomTrackPayload[];
    playing?: boolean;
    positionSec?: number;
    controlMode?: AriaRoomControlMode;
  }): Promise<AriaRoomSnapshot> {
    if (!this.active || this.role !== "host") {
      throw new HttpError(409, "当前不在房主房间中", "NOT_ROOM_HOST");
    }

    if (params.controlMode) this.controlMode = params.controlMode;

    const prevSeq = this.playback.serverSeq;
    const nextQueue = (params.queue ?? this.playback.queue).map(({ coverDataUrl: _omitCover, ...rest }) => rest);
    let currentTrack = params.track;
    let nextTrack = params.nextTrack ?? null;

    if (currentTrack && !currentTrack.dispatch) {
      const resolved = await this.resolveTrackForRoom(currentTrack);
      if (!resolved.ok) {
        this.emitSse("all_candidates_failed", {
          nonce: currentTrack.nonce,
          track: currentTrack,
          reason: resolved.reason ?? "UNAVAILABLE",
        });
        this.emitSse("notice", {
          level: "error",
          code: "ALL_CANDIDATES_FAILED",
          message: `「${currentTrack.title}」全员暂无完整播放权限或仅为 30 秒试听版，已尝试跳过`,
        });
        this.sendToAllPeers({
          type: "notice",
          message: `「${currentTrack.title}」全员暂无完整播放权限，房主端自动切至下一首`,
        });
      } else {
        currentTrack = resolved.track;
      }
    }
    if (currentTrack) {
      currentTrack = await this.maybeAttachCoverDataUrl(currentTrack);
    }

    if (nextTrack && !nextTrack.dispatch) {
      const resolvedNext = await this.resolveTrackForRoom(nextTrack).catch(() => null);
      if (resolvedNext?.ok) nextTrack = resolvedNext.track;
    }

    const now = this.getRoomClockNowMs();
    this.playbackAnchorUsesServerClock = this.serverClockSynced;
    const isSameTrack = Boolean(currentTrack?.nonce && currentTrack.nonce === this.playback.nonce);
    const extrapolatedPos =
      isSameTrack && this.playback.playing && this.playback.updatedAtMs > 0
        ? this.playback.positionSec + Math.max(0, (now - this.playback.updatedAtMs) / 1000)
        : this.playback.positionSec;

    this.playback = {
      nonce: currentTrack?.nonce ?? null,
      track: currentTrack,
      nextTrack,
      queue: nextQueue,
      playing: params.playing ?? this.playback.playing,
      positionSec: params.positionSec ?? extrapolatedPos,
      updatedAtMs: now,
      serverSeq: prevSeq + 1,
    };
    this.refreshAllowedNonces();

    const currentOwnedBySelf =
      !currentTrack?.dispatch?.providerPeerId ||
      currentTrack.dispatch.providerPeerId === this.myPeerId;
    const shouldCacheCurrent =
      Boolean(currentTrack) &&
      currentOwnedBySelf &&
      (this.networkMode === "direct" ||
        this.networkMode === "hybrid" ||
        currentTrack?.dispatch?.mode === "stream_proxy");

    if (currentTrack && shouldCacheCurrent) {
      await this.prepareHostTrackInternal(currentTrack);
    }
    const nextOwnedBySelf =
      !nextTrack?.dispatch?.providerPeerId ||
      nextTrack.dispatch.providerPeerId === this.myPeerId;
    if (
      nextTrack &&
      nextOwnedBySelf &&
      (this.networkMode === "direct" || nextTrack.dispatch?.mode === "stream_proxy")
    ) {
      void this.prepareHostTrackInternal(nextTrack).catch(() => undefined);
    }

    this.broadcastRoomState();
    const snapshot = this.getSnapshot();
    this.emitSse("state", snapshot);
    return snapshot;
  }

  async prefetchNextTrack(nextTrack: AriaRoomTrackPayload): Promise<AriaRoomTrackPayload | null> {
    if (!this.active || this.role !== "host") {
      throw new HttpError(409, "当前不在房主房间中", "NOT_ROOM_HOST");
    }
    const resolved = await this.resolveTrackForRoom(nextTrack);
    if (!resolved.ok) {
      return null;
    }
    const finalNext = resolved.track;
    this.playback = {
      ...this.playback,
      nextTrack: finalNext,
    };
    this.refreshAllowedNonces();
    if (
      this.networkMode === "direct" ||
      (finalNext.dispatch?.mode === "stream_proxy" &&
        (!finalNext.dispatch.providerPeerId || finalNext.dispatch.providerPeerId === this.myPeerId))
    ) {
      void this.prepareHostTrackInternal(finalNext).catch(() => undefined);
    }
    this.sendToAllPeers({
      type: "prefetch_next",
      roomId: this.roomId,
      nextTrack: finalNext,
    });
    this.emitSse("prefetch_next", finalNext);
    this.emitSse("state", this.getSnapshot());
    return finalNext;
  }

  private async maybeAttachCoverDataUrl(track: AriaRoomTrackPayload): Promise<AriaRoomTrackPayload> {
    if (track.coverDataUrl || (track.source !== "youtube" && track.source !== "local")) {
      return track;
    }
    const localOwnFile =
      track.source === "local" && (!track.addedByPeerId || track.addedByPeerId === this.myPeerId);
    const youtubeReachableHere =
      track.source === "youtube" && this.myCapabilities.youtube === "reachable";
    if (!localOwnFile && !youtubeReachableHere) {
      return track;
    }
    const coverDataUrl = await Promise.race([
      this.byteCache.encodeCoverThumbnailDataUrl(track.nonce, this.localApiPort, track).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_500)),
    ]);
    return coverDataUrl ? { ...track, coverDataUrl } : track;
  }

  async resolveLocalTrackForRelay(track: AriaRoomTrackPayload): Promise<RelayResolveOutcome> {
    if (this.customLocalResolver) {
      return this.customLocalResolver(track);
    }
    try {
      const upstream = await resolveExternalUpstream(track, this.localApiPort, false);
      if (upstream.isTrial) {
        return { ok: false, isTrial: true, reason: "TRIAL_ONLY" };
      }
      if (!upstream.url) {
        return { ok: false, reason: "EMPTY_URL" };
      }
      const coverDataUrl =
        (track.source === "youtube" || track.source === "local") && !track.coverDataUrl
          ? await Promise.race([
              this.byteCache.encodeCoverThumbnailDataUrl(track.nonce, this.localApiPort, track).catch(() => null),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_500)),
            ])
          : track.coverDataUrl ?? null;
      return {
        ok: true,
        directUrl: upstream.url,
        safeHeaders: sanitizeSafeHeaders(upstream.headers),
        mimeType: upstream.mimeType ?? track.mimeType ?? null,
        bitrate: upstream.bitrate ?? track.bitrate ?? null,
        sampleRate: upstream.sampleRate ?? track.sampleRate ?? null,
        quality: upstream.quality ?? track.quality,
        currentLevel: upstream.currentLevel ?? track.currentLevel ?? null,
        availableLevels: upstream.availableLevels ?? track.availableLevels,
        ...(coverDataUrl ? { coverDataUrl } : {}),
      };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : "RESOLVE_FAILED",
      };
    }
  }

  private requestRemoteResolve(
    peerId: string,
    track: AriaRoomTrackPayload,
  ): Promise<RelayResolveOutcome> {
    if (!this.active || !this.myPeerId) {
      return Promise.resolve({ ok: false, reason: "SIGNALING_NOT_OPEN" });
    }
    const requestId = crypto.randomBytes(6).toString("hex");
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingResolves.delete(requestId)) {
          resolve({ ok: false, reason: "RESOLVE_TIMEOUT" });
        }
      }, RESOLVE_TIMEOUT_MS);

      this.pendingResolves.set(requestId, { resolve, timer });
      const sent = this.sendToPeer(peerId, {
        type: "resolve_track",
        roomId: this.roomId,
        requestId,
        fromPeerId: this.myPeerId,
        toPeerId: peerId,
        track,
      });
      if (!sent && this.pendingResolves.delete(requestId)) {
        clearTimeout(timer);
        resolve({ ok: false, reason: "SIGNALING_NOT_OPEN" });
      }
    });
  }

  async resolveTrackForRoom(
    track: AriaRoomTrackPayload,
  ): Promise<{ ok: true; track: AriaRoomTrackPayload } | { ok: false; reason: string }> {
    const fallbackProvider = track.addedByPeerId || this.myPeerId || "host";

    if (track.source === "local") {
      return {
        ok: true,
        track: {
          ...track,
          dispatch: {
            mode: "stream_proxy",
            providerPeerId: fallbackProvider,
          },
        },
      };
    }

    const roster = Array.from(this.members.values());

    if (track.source === "youtube" && this.networkMode !== "direct") {
      const everyoneReachable =
        roster.length > 0 && roster.every((m) => m.capabilities?.youtube !== "unreachable");
      if (everyoneReachable) {
        const addedByReachable = track.addedByPeerId
          ? roster.find(
              (m) =>
                m.peerId === track.addedByPeerId &&
                m.shareEnabled !== false &&
                m.capabilities?.youtube === "reachable",
            )
          : undefined;
        const providerPeerId = addedByReachable?.peerId || this.myPeerId || fallbackProvider;
        return {
          ok: true,
          track: {
            ...track,
            dispatch: {
              mode: "resolve_local",
              providerPeerId,
            },
          },
        };
      }
      const reachableProvider = rankRelayCandidates(roster, "youtube", this.myPeerId).find(
        (m) => m.capabilities?.youtube === "reachable",
      );
      if (!reachableProvider) {
        return { ok: false, reason: "YOUTUBE_UNREACHABLE_FOR_ALL" };
      }
      const resolvedMeta =
        reachableProvider.peerId === this.myPeerId
          ? await this.resolveLocalTrackForRelay(track).catch(() => null)
          : await this.requestRemoteResolve(reachableProvider.peerId, track).catch(() => null);
      return {
        ok: true,
        track: {
          ...track,
          ...(resolvedMeta?.ok
            ? {
                bitrate: resolvedMeta.bitrate ?? track.bitrate ?? null,
                sampleRate: resolvedMeta.sampleRate ?? track.sampleRate ?? null,
                quality: resolvedMeta.quality ?? track.quality,
                currentLevel: resolvedMeta.currentLevel ?? track.currentLevel ?? null,
                availableLevels: resolvedMeta.availableLevels ?? track.availableLevels,
                coverDataUrl: resolvedMeta.coverDataUrl ?? track.coverDataUrl ?? null,
              }
            : {}),
          dispatch: {
            mode: "stream_proxy",
            providerPeerId: reachableProvider.peerId,
          },
        },
      };
    }

    const candidates = rankRelayCandidates(roster, track.source, this.myPeerId);
    if (candidates.length === 0) {
      if (track.source === "bilibili" && this.networkMode !== "direct") {
        return {
          ok: true,
          track: {
            ...track,
            dispatch: {
              mode: "resolve_local",
              providerPeerId: this.myPeerId || fallbackProvider,
            },
          },
        };
      }
      return { ok: false, reason: "NO_ELIGIBLE_CANDIDATE" };
    }

    let lastReason = "RESOLVE_FAILED";
    for (const candidate of candidates) {
      const res =
        candidate.peerId === this.myPeerId
          ? await this.resolveLocalTrackForRelay(track)
          : await this.requestRemoteResolve(candidate.peerId, track);

      if (!res.ok || res.isTrial || !res.directUrl) {
        lastReason = res.isTrial ? "TRIAL_ONLY" : res.reason ?? "RESOLVE_FAILED";
        continue;
      }

      const isLocalProxyOnly =
        track.source === "cloud" ||
        (this.networkMode === "direct" && candidate.peerId === this.myPeerId) ||
        !/^https?:\/\//i.test(res.directUrl);

      const enriched: AriaRoomTrackPayload = {
        ...track,
        bitrate: res.bitrate ?? track.bitrate ?? null,
        sampleRate: res.sampleRate ?? track.sampleRate ?? null,
        quality: res.quality ?? track.quality,
        currentLevel: res.currentLevel ?? track.currentLevel ?? null,
        availableLevels: res.availableLevels ?? track.availableLevels,
        ...(res.coverDataUrl ? { coverDataUrl: res.coverDataUrl } : {}),
        mimeType: res.mimeType ?? track.mimeType ?? null,
        dispatch: isLocalProxyOnly
          ? {
              mode: "stream_proxy",
              providerPeerId: candidate.peerId,
              mimeType: res.mimeType ?? track.mimeType ?? null,
            }
          : {
              mode: "direct_url",
              providerPeerId: candidate.peerId,
              directUrl: res.directUrl,
              safeHeaders: res.safeHeaders,
              mimeType: res.mimeType ?? track.mimeType ?? null,
            },
      };
      return { ok: true, track: enriched };
    }

    if (track.source === "bilibili" && this.networkMode !== "direct") {
      return {
        ok: true,
        track: {
          ...track,
          dispatch: {
            mode: "resolve_local",
            providerPeerId: this.myPeerId || fallbackProvider,
          },
        },
      };
    }

    return { ok: false, reason: lastReason };
  }

  hostBroadcastPlaybackSync(event: Omit<AriaRoomSyncEvent, "seq" | "serverTimeMs">): AriaRoomSyncEvent {
    if (!this.active || this.role !== "host") {
      throw new HttpError(409, "当前不在房主房间中", "NOT_ROOM_HOST");
    }

    const localNow = Date.now();
    const roomNow = this.getRoomClockNowMs();
    const seq = this.playback.serverSeq + 1;
    let anchorTimeMs = roomNow;
    let mappedStartAtHostMs = event.startAtHostMs;
    if (event.kind === "play_at" && event.startAtHostMs > 0) {
      if (this.serverClockSynced) {
        const leadMs = Math.max(-5_000, Math.min(5_000, event.startAtHostMs - localNow));
        anchorTimeMs = Math.round(roomNow + leadMs);
        mappedStartAtHostMs = anchorTimeMs;
      } else {
        anchorTimeMs = event.startAtHostMs;
      }
    }
    this.playback.serverSeq = seq;
    this.playback.positionSec = event.positionSec;
    this.playback.updatedAtMs = anchorTimeMs;
    this.playbackAnchorUsesServerClock = this.serverClockSynced;
    if (event.kind === "play_at") this.playback.playing = true;
    else if (event.kind === "pause") this.playback.playing = false;

    const fullEvent: AriaRoomSyncEvent = {
      seq,
      kind: event.kind,
      nonce: event.nonce,
      positionSec: event.positionSec,
      startAtHostMs: mappedStartAtHostMs,
      serverTimeMs: roomNow,
    };

    const envelope = { type: "playback_sync", roomId: this.roomId, event: fullEvent };
    this.sendToAllPeers(envelope);
    this.emitSse("state", this.getSnapshot());
    return fullEvent;
  }

  sendSignal(toPeerId: string, payload: unknown): void {
    if (!this.active || !this.myPeerId) {
      throw new HttpError(409, "房间未连接", "ROOM_NOT_ACTIVE");
    }
    this.sendToPeer(toPeerId, {
      type: "signal",
      roomId: this.roomId,
      fromPeerId: this.myPeerId,
      toPeerId,
      payload,
    });
  }

  sendControlRequest(action: string, payload: unknown): void {
    if (!this.active || !this.myPeerId) {
      throw new HttpError(409, "房间未连接", "ROOM_NOT_ACTIVE");
    }
    this.signalingWs?.sendJson({
      type: "control_request",
      roomId: this.roomId,
      fromPeerId: this.myPeerId,
      action,
      payload,
    });
  }

  sendTrackReady(nonce: string, bufferedBytes: number): void {
    if (!this.active || !this.myPeerId) return;
    if (this.members.has(this.myPeerId)) {
      const me = this.members.get(this.myPeerId)!;
      this.members.set(this.myPeerId, { ...me, readyNonce: nonce });
    }
    this.signalingWs?.sendJson({
      type: "track_ready",
      roomId: this.roomId,
      fromPeerId: this.myPeerId,
      nonce,
      bufferedBytes,
    });
  }

  private getRoomClockNowMs(): number {
    return this.serverClockSynced ? Math.round(Date.now() + this.serverClockOffsetMs) : Date.now();
  }

  private clearSignalingBurstTimers(): void {
    for (const t of this.signalingBurstTimers.splice(0)) {
      clearTimeout(t);
    }
  }

  private sendHeartbeatPing(ws: AriaWebSocket): void {
    if (!ws.isOpen) return;
    const now = Date.now();
    ws.ping();
    ws.sendJson({ type: "ping", ts: now, t0: now });
  }

  private waitForInitialPong(timeoutMs = 250): Promise<void> {
    if (this.serverSupportsClockPong !== null) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      timer.unref?.();
      this.firstPongResolvers.push(done);
    });
  }

  sendClockPing(): string | null {
    if (!this.active || this.role !== "guest" || !this.signalingWs?.isOpen || !this.myPeerId) {
      return null;
    }
    const pingId = crypto.randomBytes(6).toString("hex");
    if (this.serverSupportsClockPong !== false) {
      this.sendHeartbeatPing(this.signalingWs);
      return pingId;
    }
    this.signalingWs.sendJson({
      type: "clock_ping",
      roomId: this.roomId,
      fromPeerId: this.myPeerId,
      pingId,
      t0: Date.now(),
    });
    return pingId;
  }

  async readHostTrackSlice(
    nonce: string,
    offset: number,
    length: number,
    signal: AbortSignal,
  ) {
    if (!this.active) {
      throw new HttpError(409, "No active Aria Room", "ROOM_NOT_ACTIVE");
    }
    const targetTrack = this.findTrackByNonce(nonce);
    const isProvider =
      this.role === "host" ||
      this.fallbackServingNonces.has(nonce) ||
      (targetTrack?.dispatch?.providerPeerId && targetTrack.dispatch.providerPeerId === this.myPeerId);
    if (!isProvider) {
      throw new HttpError(403, "Not designated as track stream provider", "NOT_TRACK_PROVIDER");
    }
    if (!this.byteCache.hasNonce(nonce) && targetTrack) {
      await this.prepareHostTrackInternal(targetTrack);
    }
    return this.byteCache.readHostSlice(nonce, offset, length, signal);
  }

  async ingestGuestChunk(params: {
    nonce: string;
    offset: number;
    chunk: Buffer;
    eof: boolean;
    totalBytes?: number | null;
    mimeType?: string | null;
    bitrate?: number | null;
    sampleRate?: number | null;
    currentLevel?: string | null;
  }) {
    const track =
      (this.playback.track?.nonce === params.nonce ? this.playback.track : null) ??
      (this.playback.nextTrack?.nonce === params.nonce ? this.playback.nextTrack : null) ??
      this.playback.queue.find((item) => item.nonce === params.nonce) ?? {
        nonce: params.nonce,
        id: params.nonce,
        source: "local" as const,
        title: "Aria Sync Track",
        artist: "",
        album: "",
        duration: "0:00",
        quality: "Lossless" as const,
      };
    return this.byteCache.appendGuestChunk({
      track,
      offset: params.offset,
      chunk: params.chunk,
      eof: params.eof,
      totalBytes: params.totalBytes,
      mimeType: params.mimeType,
      bitrate: params.bitrate,
      sampleRate: params.sampleRate,
      currentLevel: params.currentLevel,
    });
  }

  getBufferProgress(nonce: string) {
    return this.byteCache.getProgressSnapshot(nonce);
  }

  private async pipeExternalCdnRange(
    req: Request,
    res: Response,
    target: {
      url: string;
      headers?: Record<string, string>;
      mimeType?: string | null;
      bitrate?: number | null;
      sampleRate?: number | null;
      currentLevel?: string | null;
      fetcher?: (url: string, init?: RequestInit) => Promise<globalThis.Response>;
    },
  ): Promise<"piped" | "fallback"> {
    const controller = new AbortController();
    const abort = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once("aborted", abort);
    res.once("close", abort);

    try {
      const upstreamFetch = target.fetcher ?? fetch;
      const upstream = await upstreamFetch(target.url, {
        method: req.method === "HEAD" ? "HEAD" : "GET",
        headers: {
          ...(target.headers ?? {}),
          ...(req.headers.range ? { Range: req.headers.range } : {}),
        },
        signal: controller.signal,
      });

      if (upstream.status === 401 || upstream.status === 403 || upstream.status === 410 || !upstream.ok) {
        await upstream.body?.cancel();
        return "fallback";
      }

      res.statusCode = upstream.status;
      res.setHeader(
        "Content-Type",
        target.mimeType || upstream.headers.get("content-type") || "application/octet-stream",
      );
      res.setHeader("Cache-Control", "no-store");
      for (const h of ["content-length", "content-range", "accept-ranges"]) {
        const v = upstream.headers.get(h);
        if (v) res.setHeader(h, v);
      }
      if (target.bitrate) res.setHeader("X-Aria-Bitrate", String(target.bitrate));
      if (target.sampleRate) res.setHeader("X-Aria-Sample-Rate", String(target.sampleRate));
      if (target.currentLevel) res.setHeader("X-Aria-Level", target.currentLevel);

      if (req.method === "HEAD" || !upstream.body) {
        res.end();
        await upstream.body?.cancel();
        return "piped";
      }

      const reader = upstream.body.getReader();
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        if (!res.write(Buffer.from(value.buffer, value.byteOffset, value.byteLength))) {
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }
      }
      if (!res.writableEnded) res.end();
      return "piped";
    } catch {
      if (controller.signal.aborted) return "piped";
      if (res.headersSent) {
        if (!res.writableEnded) res.end();
        return "piped";
      }
      return "fallback";
    } finally {
      req.off("aborted", abort);
      res.off("close", abort);
    }
  }

  triggerProxyFallback(track: AriaRoomTrackPayload): boolean {
    if (!this.active || !this.myPeerId) return false;
    const hostMember = Array.from(this.members.values()).find((m) => m.role === "host");
    const targetProvider = track.dispatch?.providerPeerId || hostMember?.peerId || "";
    if (!targetProvider || targetProvider === this.myPeerId) return false;

    if (!this.proxyFallbackRequestedNonces.has(track.nonce)) {
      this.proxyFallbackRequestedNonces.add(track.nonce);
      this.sendToPeer(targetProvider, {
        type: "proxy_fallback_request",
        roomId: this.roomId,
        fromPeerId: this.myPeerId,
        toPeerId: targetProvider,
        nonce: track.nonce,
        track,
      });
      if (this.playback.track?.nonce === track.nonce && this.playback.track) {
        this.playback.track = {
          ...this.playback.track,
          dispatch: { mode: "stream_proxy", providerPeerId: targetProvider },
        };
      }
      this.emitSse("proxy_fallback_started", {
        nonce: track.nonce,
        providerPeerId: targetProvider,
      });
    }
    return true;
  }

  async serveGuestTrackStream(req: Request, res: Response, nonce: string): Promise<void> {
    if (!this.active) {
      throw new HttpError(404, "No active Aria Room", "ROOM_NOT_ACTIVE");
    }

    const track = this.findTrackByNonce(nonce);

    // 1. If P2P chunks are already present in local progressive cache, serve immediately.
    if (this.byteCache.hasNonce(nonce)) {
      const entry = this.byteCache.getEntry(nonce)!;
      await this.byteCache.serveEntryHttpRange(req, res, entry);
      return;
    }

    // 1b. If this peer itself is the designated stream_proxy provider (e.g. guest playing its own local file), buffer locally and serve immediately.
    if (
      track?.dispatch?.mode === "stream_proxy" &&
      track.dispatch.providerPeerId &&
      track.dispatch.providerPeerId === this.myPeerId
    ) {
      const entry = await this.prepareHostTrackInternal(track);
      await this.byteCache.serveEntryHttpRange(req, res, entry);
      return;
    }

    // 2. direct_url mode: pull directly from official CDN without cookies; on 403/error auto-fallback to P2P proxy.
    if (track?.dispatch?.mode === "direct_url" && track.dispatch.directUrl && this.networkMode !== "direct") {
      const outcome = await this.pipeExternalCdnRange(req, res, {
        url: track.dispatch.directUrl,
        headers: track.dispatch.safeHeaders,
        mimeType: track.dispatch.mimeType ?? track.mimeType ?? null,
        bitrate: track.bitrate ?? null,
        sampleRate: track.sampleRate ?? null,
        currentLevel: track.currentLevel ?? null,
      });
      if (outcome === "piped") return;
      this.triggerProxyFallback(track);
    }

    // 3. resolve_local mode: each member resolves locally and pulls official CDN; on 403/trial auto-fallback to P2P proxy.
    if (track?.dispatch?.mode === "resolve_local" && this.networkMode !== "direct") {
      try {
        const localUpstream = await resolveExternalUpstream(track, this.localApiPort, false);
        if (!localUpstream.isTrial && localUpstream.url) {
          const outcome = await this.pipeExternalCdnRange(req, res, {
            url: localUpstream.url,
            headers: localUpstream.headers,
            mimeType: localUpstream.mimeType ?? track.mimeType ?? null,
            bitrate: localUpstream.bitrate ?? track.bitrate ?? null,
            sampleRate: localUpstream.sampleRate ?? track.sampleRate ?? null,
            currentLevel: localUpstream.currentLevel ?? track.currentLevel ?? null,
            fetcher: localUpstream.fetcher,
          });
          if (outcome === "piped") return;
        }
      } catch {
        // Fall through to P2P proxy fallback.
      }
      this.triggerProxyFallback(track);
    }

    // 4. Direct TCP HTTP 206 passthrough when guest has verified Direct Host endpoint.
    if (this.guestDirectBaseUrl && this.guestDirectToken && !this.byteCache.hasNonce(nonce)) {
      const upstreamUrl = `${this.guestDirectBaseUrl}/aria-room/tracks/${encodeURIComponent(nonce)}/stream`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.guestDirectToken}`,
      };
      if (req.headers.range) headers.Range = req.headers.range;

      const controller = new AbortController();
      const abort = () => {
        if (!res.writableEnded) controller.abort();
      };
      req.once("aborted", abort);
      res.once("close", abort);

      // In cloudflare/hybrid rooms, enforce a short connect timeout so an
      // unreachable NAT/LAN direct endpoint falls back immediately to P2P cache.
      const connectTimer =
        this.networkMode !== "direct"
          ? setTimeout(() => controller.abort(), 2_500)
          : null;

      try {
        const upstream = await fetch(upstreamUrl, {
          method: req.method === "HEAD" ? "HEAD" : "GET",
          headers,
          signal: controller.signal,
        });
        if (connectTimer) clearTimeout(connectTimer);
        if (!upstream.ok && upstream.status !== 206) {
          await upstream.body?.cancel();
          throw new HttpError(502, `Direct host stream failed (${upstream.status})`, "DIRECT_STREAM_FAILED");
        }
        res.statusCode = upstream.status;
        for (const h of [
          "content-type",
          "content-length",
          "content-range",
          "accept-ranges",
          "x-aria-bitrate",
          "x-aria-sample-rate",
          "x-aria-level",
        ]) {
          const v = upstream.headers.get(h);
          if (v) res.setHeader(h, v);
        }
        if (req.method === "HEAD" || !upstream.body) {
          res.end();
          await upstream.body?.cancel();
          return;
        }
        const reader = upstream.body.getReader();
        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.byteLength === 0) continue;
          if (!res.write(Buffer.from(value.buffer, value.byteOffset, value.byteLength))) {
            await new Promise<void>((resolve) => res.once("drain", resolve));
          }
        }
        if (!res.writableEnded) res.end();
        return;
      } catch (err) {
        if (connectTimer) clearTimeout(connectTimer);
        if (this.networkMode === "direct") {
          if (controller.signal.aborted) return;
          throw err;
        }
        // Clear unreachable hybrid direct hint and fall back to WebRTC P2P cache.
        if (!res.headersSent) {
          this.guestDirectBaseUrl = null;
          this.guestDirectToken = null;
        } else {
          if (controller.signal.aborted) return;
          throw err;
        }
      } finally {
        req.off("aborted", abort);
        res.off("close", abort);
      }
    }

    const controller = new AbortController();
    const abort = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once("aborted", abort);
    res.once("close", abort);

    try {
      const entry = await this.byteCache.waitForEntry(nonce, controller.signal, 15_000);
      if (!entry) {
        throw new HttpError(404, "Guest track buffer not ready yet", "GUEST_TRACK_NOT_READY");
      }
      await this.byteCache.serveEntryHttpRange(req, res, entry);
    } finally {
      req.off("aborted", abort);
      res.off("close", abort);
    }
  }

  private findTrackByNonce(nonce: string): AriaRoomTrackPayload | null {
    if (this.playback.track?.nonce === nonce) return this.playback.track;
    if (this.playback.nextTrack?.nonce === nonce) return this.playback.nextTrack;
    return this.playback.queue.find((item) => item.nonce === nonce) ?? null;
  }

  async serveGuestTrackCover(req: Request, res: Response, nonce: string): Promise<void> {
    if (this.guestDirectBaseUrl && this.guestDirectToken) {
      const coverUrl = `${this.guestDirectBaseUrl}/aria-room/tracks/${encodeURIComponent(nonce)}/cover`;
      const upstream = await fetch(coverUrl, {
        headers: { Authorization: `Bearer ${this.guestDirectToken}` },
      }).catch(() => null);
      if (upstream?.ok) {
        const upstreamBuf = Buffer.from(await upstream.arrayBuffer());
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", upstream.headers.get("content-type") || "image/jpeg");
        res.setHeader("Content-Length", String(upstreamBuf.byteLength));
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.end(upstreamBuf);
        return;
      }
    }
    const localCover = await this.byteCache.resolveCover(nonce, this.localApiPort, this.findTrackByNonce(nonce), {
      skipYoutubeRemote: this.myCapabilities.youtube !== "reachable",
    });
    if (!localCover) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", localCover.contentType);
    res.setHeader("Content-Length", String(localCover.body.byteLength));
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.end(localCover.body);
  }

  private async prepareHostTrackInternal(track: AriaRoomTrackPayload): Promise<BufferedTrackEntry> {
    const entry = await this.byteCache.prepareHostTrack(track, this.localApiPort);
    if (this.playback.track?.nonce === track.nonce && this.playback.track) {
      this.playback.track = {
        ...this.playback.track,
        bitrate: entry.bitrate ?? this.playback.track.bitrate ?? null,
        sampleRate: entry.sampleRate ?? this.playback.track.sampleRate ?? null,
        mimeType: entry.mimeType || this.playback.track.mimeType || null,
      };
    }
    return entry;
  }

  private refreshAllowedNonces(): void {
    const next = new Set<string>();
    if (this.playback.track?.nonce) next.add(this.playback.track.nonce);
    if (this.playback.nextTrack?.nonce) next.add(this.playback.nextTrack.nonce);
    this.allowedNonces = next;
    this.byteCache.setPinnedNonces(Array.from(next));
  }

  private async connectToCloudflareSignaling(
    options: { throwOnInitialError?: boolean; suppressErrorState?: boolean } = {},
  ): Promise<void> {
    if (!this.roomId || !this.myPeerId || !this.role) return;
    const activeUrl = this.getActiveSignalingUrl();
    if (!activeUrl) return;
    const url = buildSignalingWsUrl(activeUrl, this.roomId, this.myPeerId, this.role);
    const usePreferredIp =
      this.config.signalingProvider !== "self-hosted" && !isSelfHostedSignalingUrl(activeUrl);
    await this.connectSignalingSocket(url, {
      usePreferredIp,
      throwOnInitialError: options.throwOnInitialError,
      suppressErrorState: options.suppressErrorState,
    });
  }

  private async connectSignalingSocket(
    targetUrl: string,
    options: { usePreferredIp: boolean; throwOnInitialError?: boolean; suppressErrorState?: boolean },
  ): Promise<void> {
    this.signalingTargetUrl = targetUrl;
    this.signalingState = this.signalingConsecutiveFailures > 0 ? "reconnecting" : "connecting";
    this.signalingError = null;
    this.emitSse("state", this.getSnapshot());

    let preferredIp: string | null = null;
    if (options.usePreferredIp && this.config.autoPreferredIp) {
      preferredIp = this.config.selectedPreferredIp;
      const activeUrl = this.getActiveSignalingUrl();
      if (!preferredIp && this.signalingConsecutiveFailures >= 1 && activeUrl) {
        const probed = await this.probePreferredIps(activeUrl, this.config.signalingProvider).catch(() => []);
        preferredIp = probed.find((item) => item.ok)?.ip ?? null;
      }
    } else if (options.usePreferredIp) {
      preferredIp = this.config.selectedPreferredIp;
    }

    try {
      const { ws, connectedIp, latencyMs } = await connectWebSocket(targetUrl, {
        preferredIp,
        timeoutMs: 8_000,
      });

      this.attachActiveSignalingWs(ws, connectedIp, latencyMs, options.usePreferredIp);
      await this.waitForInitialPong(250);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.signalingConsecutiveFailures += 1;
      this.rotatePreferredIpOnFailure();
      if (options.throwOnInitialError) {
        await this.leaveRoom();
        throw new HttpError(
          502,
          this.networkMode === "direct" ? `无法连接到房主直连服务：${message}` : message,
          this.networkMode === "direct" ? "DIRECT_CONNECT_FAILED" : "SIGNALING_CONNECT_FAILED",
        );
      }
      if (options.suppressErrorState && this.directServer) {
        this.signalingState = "connected";
        this.signalingError = null;
      } else {
        this.signalingState = "error";
        this.signalingError = message;
      }
      this.emitSse("state", this.getSnapshot());
      if (!this.manualLeave && this.active) {
        this.scheduleSignalingReconnect(options.usePreferredIp);
      }
    }
  }

  private attachActiveSignalingWs(
    ws: AriaWebSocket,
    connectedIp: string | null,
    latencyMs: number,
    usePreferredIp: boolean,
  ): void {
    this.clearSignalingBurstTimers();
    if (this.signalingWs) {
      try {
        this.signalingWs.close(1000, "Superseded");
      } catch {
        // ignore
      }
    }

    this.signalingWs = ws;
    this.signalingState = "connected";
    this.signalingConnectedIp = connectedIp;
    this.signalingLatencyMs = latencyMs;
    this.signalingError = null;
    this.signalingConsecutiveFailures = 0;
    this.signalingLastPongAt = Date.now();
    this.serverClockTracker.reset();
    this.serverClockSynced = false;
    this.serverClockOffsetMs = 0;
    this.serverClockRttMs = null;
    this.serverSupportsClockPong = null;

    ws.on("pong", () => {
      this.signalingLastPongAt = Date.now();
    });

    ws.on("message", (raw: string) => {
      this.signalingLastPongAt = Date.now();
      this.handleSignalingMessage(raw, ws);
    });

    ws.on("close", (_code: number, reason: string) => {
      this.clearSignalingBurstTimers();
      if (this.signalingWs === ws) {
        this.signalingWs = null;
      }
      if (this.signalingHeartbeatTimer) {
        clearInterval(this.signalingHeartbeatTimer);
        this.signalingHeartbeatTimer = null;
      }
      for (const resolvePong of this.firstPongResolvers.splice(0)) {
        resolvePong();
      }
      if (this.manualLeave || !this.active) return;

      this.signalingState = "reconnecting";
      this.signalingError = reason || "信令连接断开，正在无感重连...";
      this.emitSse("state", this.getSnapshot());
      this.scheduleSignalingReconnect(usePreferredIp);
    });

    ws.on("error", (err: Error) => {
      this.signalingError = err.message;
    });

    ws.sendJson({
      type: "hello",
      roomId: this.roomId,
      role: this.role,
      member: {
        peerId: this.myPeerId,
        nickname: this.myProfile.nickname,
        avatarUrl: this.myProfile.avatarUrl,
        role: this.role,
        joinedAt: Date.now(),
        connectedVia: this.networkMode === "direct" ? "direct" : "ws",
        shareEnabled: this.myShareEnabled,
        capabilities: this.myCapabilities,
      },
      ...(this.role === "host" ? { state: this.buildSharedStatePayload() } : {}),
    });

    this.sendHeartbeatPing(ws);
    for (const delayMs of [250, 650]) {
      const burst = setTimeout(() => {
        if (this.signalingWs === ws && ws.isOpen && this.active) {
          this.sendHeartbeatPing(ws);
        }
      }, delayMs);
      burst.unref?.();
      this.signalingBurstTimers.push(burst);
    }

    if (this.signalingHeartbeatTimer) clearInterval(this.signalingHeartbeatTimer);
    this.signalingHeartbeatTimer = setInterval(() => {
      if (!ws.isOpen) return;
      if (Date.now() - this.signalingLastPongAt > 48_000) {
        ws.close(4000, "Heartbeat timeout");
        return;
      }
      this.sendHeartbeatPing(ws);
    }, 18_000);

    this.emitSse("state", this.getSnapshot());
  }

  private scheduleSignalingReconnect(usePreferredIp: boolean): void {
    if (this.manualLeave || !this.active || !this.signalingTargetUrl) return;
    if (this.signalingReconnectTimer) clearTimeout(this.signalingReconnectTimer);

    const delayMs = Math.min(10_000, 900 * Math.pow(1.6, Math.min(this.signalingConsecutiveFailures, 5)));
    this.signalingReconnectTimer = setTimeout(() => {
      if (this.manualLeave || !this.active || !this.signalingTargetUrl) return;
      void this.connectSignalingSocket(this.signalingTargetUrl, { usePreferredIp });
    }, delayMs);
  }

  private rotatePreferredIpOnFailure(): void {
    if (!this.config.autoPreferredIp || this.lastProbeResults.length === 0) return;
    const healthy = this.lastProbeResults.filter((r) => r.ok).map((r) => r.ip);
    if (healthy.length === 0) {
      this.config.selectedPreferredIp = null;
      return;
    }
    const idx = healthy.indexOf(this.config.selectedPreferredIp);
    this.config.selectedPreferredIp = healthy[(idx + 1) % healthy.length] ?? null;
  }

  private buildSharedStatePayload() {
    const netInfo = detectLocalNetworkAddresses();
    const parsedPublic = parseDirectPublicHost(this.directPublicHost);
    const directHostHint =
      parsedPublic?.host || netInfo.lanAddresses[0] || netInfo.ipv6Addresses[0] || null;
    const directPortHint = parsedPublic?.port ?? this.directPort;
    return {
      controlMode: this.controlMode,
      playback: this.playback,
      ...(this.networkMode === "hybrid" && this.directServer && this.directRoomToken && directHostHint
        ? {
            directEndpoint: {
              host: directHostHint,
              port: directPortHint,
              token: this.directRoomToken,
            },
          }
        : {}),
    };
  }

  private broadcastRoomState(): void {
    const payload = {
      type: "state_update",
      roomId: this.roomId,
      state: this.buildSharedStatePayload(),
      members: Array.from(this.members.values()),
    };
    this.sendToAllPeers(payload);
  }

  private sendToPeer(targetPeerId: string, payload: unknown): boolean {
    for (const [ws, meta] of this.directWsClients.entries()) {
      if (meta.peerId === targetPeerId && ws.isOpen) {
        return ws.sendJson(payload);
      }
    }
    if (this.signalingWs?.isOpen) {
      return this.signalingWs.sendJson(payload);
    }
    return false;
  }

  private sendToAllPeers(payload: unknown): void {
    this.signalingWs?.sendJson(payload);
    for (const ws of this.directWsClients.keys()) {
      ws.sendJson(payload);
    }
  }

  private handleSignalingMessage(raw: string, sourceWs: AriaWebSocket): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = String(msg.type ?? "");
    if (type === "ping") {
      const t1 = this.getRoomClockNowMs();
      const t0 = typeof msg.t0 === "number" ? msg.t0 : typeof msg.ts === "number" ? msg.ts : t1;
      const t2 = this.getRoomClockNowMs();
      sourceWs.sendJson({ type: "pong", ts: msg.ts ?? t1, t0, t1, t2, serverTs: t2 });
      return;
    }
    if (type === "pong") {
      const t3 = Date.now();
      this.signalingLastPongAt = t3;
      const prevSupport = this.serverSupportsClockPong;
      if (typeof msg.serverTs === "number" || typeof msg.t1 === "number") {
        const t0 = typeof msg.t0 === "number" ? msg.t0 : typeof msg.ts === "number" ? msg.ts : t3;
        const t1 = typeof msg.t1 === "number" ? msg.t1 : (msg.serverTs as number);
        const t2 = typeof msg.t2 === "number" ? msg.t2 : t1;
        this.serverSupportsClockPong = true;
        const estimate = this.serverClockTracker.record({ t0, t1, t2, t3 });
        this.serverClockOffsetMs = estimate.offsetMs;
        this.serverClockRttMs = estimate.rttMs;
        this.serverClockSynced = true;
        this.signalingLatencyMs = estimate.rttMs;
        if (this.role === "host" && !this.playbackAnchorUsesServerClock && this.playback.updatedAtMs > 0) {
          this.playback.updatedAtMs = Math.round(this.playback.updatedAtMs + this.serverClockOffsetMs);
          this.playbackAnchorUsesServerClock = true;
          this.broadcastRoomState();
          this.emitSse("state", this.getSnapshot());
        }
        if (this.role === "guest") {
          this.emitSse("clock_pong", {
            pingId: "hb",
            t0,
            t1,
            t2,
            t3,
            source: "server",
          });
        }
      } else {
        this.serverSupportsClockPong = false;
        if (prevSupport !== false && this.role === "guest" && !this.serverClockSynced && this.myPeerId && sourceWs.isOpen) {
          sourceWs.sendJson({
            type: "clock_ping",
            roomId: this.roomId,
            fromPeerId: this.myPeerId,
            pingId: crypto.randomBytes(6).toString("hex"),
            t0: t3,
          });
        }
      }
      for (const resolvePong of this.firstPongResolvers.splice(0)) {
        resolvePong();
      }
      return;
    }

    if (type === "error") {
      const code = String(msg.code ?? "");
      this.signalingError = String(msg.message ?? "房间信令异常");
      this.emitSse("notice", { level: "error", code, message: this.signalingError });
      if (code === "ROOM_FULL" || code === "ROOM_NOT_FOUND") {
        void this.leaveRoom();
      }
      return;
    }

    if (type === "notice" && typeof msg.message === "string") {
      this.emitSse("notice", { level: "info", message: msg.message });
      return;
    }

    if (type === "room_closed") {
      this.emitSse("notice", { level: "info", code: "ROOM_CLOSED", message: "房主已结束本次一起听" });
      void this.leaveRoom();
      return;
    }

    if (type === "room_peers" && Array.isArray(msg.members)) {
      const incoming = msg.members as AriaRoomMember[];
      const next = new Map<string, AriaRoomMember>();
      for (const m of incoming) {
        if (m?.peerId) next.set(m.peerId, m);
      }
      if (this.myPeerId && !next.has(this.myPeerId) && this.role) {
        next.set(this.myPeerId, {
          peerId: this.myPeerId,
          nickname: this.myProfile.nickname,
          avatarUrl: this.myProfile.avatarUrl,
          role: this.role,
          joinedAt: Date.now(),
          connectedVia: "ws",
        });
      }
      this.members = next;
      if (this.role === "host") {
        // Send authoritative state whenever roster changes on signaling worker.
        this.broadcastRoomState();
      }
      this.emitSse("state", this.getSnapshot());
      return;
    }

    if (type === "peer_joined" && msg.member && typeof msg.member === "object") {
      const member = msg.member as AriaRoomMember;
      if (this.role === "host" && this.members.size >= MAX_ARIA_ROOM_MEMBERS && !this.members.has(member.peerId)) {
        sourceWs.sendJson({ type: "kick_full", roomId: this.roomId, peerId: member.peerId });
        return;
      }
      this.members.set(member.peerId, member);
      if (this.role === "host") {
        this.broadcastRoomState();
      }
      this.emitSse("peer_joined", member);
      this.emitSse("state", this.getSnapshot());
      return;
    }

    if (type === "peer_left" && typeof msg.peerId === "string") {
      this.members.delete(msg.peerId);
      this.emitSse("peer_left", { peerId: msg.peerId });
      this.emitSse("state", this.getSnapshot());
      return;
    }

    if (type === "clock_ping" && this.role === "host") {
      const t1 = this.getRoomClockNowMs();
      sourceWs.sendJson({
        type: "clock_pong",
        roomId: this.roomId,
        toPeerId: msg.fromPeerId,
        pingId: msg.pingId,
        t0: msg.t0,
        t1,
        t2: this.getRoomClockNowMs(),
      });
      return;
    }

    if (type === "clock_pong" && this.role === "guest") {
      this.emitSse("clock_pong", {
        pingId: msg.pingId,
        t0: msg.t0,
        t1: msg.t1,
        t2: msg.t2,
        t3: Date.now(),
      });
      return;
    }

    if (type === "signal") {
      this.emitSse("signal", {
        fromPeerId: msg.fromPeerId,
        toPeerId: msg.toPeerId,
        payload: msg.payload,
      });
      return;
    }

    if (type === "state_update" && this.role === "guest") {
      const state = msg.state as
        | {
            controlMode?: AriaRoomControlMode;
            playback?: AriaRoomPlaybackState;
            directEndpoint?: { host: string; port: number; token: string };
          }
        | undefined;
      if (state?.controlMode) this.controlMode = state.controlMode;
      if (state?.playback) {
        const incoming = state.playback;
        const isSameTrack = Boolean(incoming.nonce && incoming.nonce === this.playback.nonce);
        if (isSameTrack && incoming.serverSeq < this.playback.serverSeq) {
          this.playback = {
            ...incoming,
            playing: this.playback.playing,
            positionSec: this.playback.positionSec,
            updatedAtMs: this.playback.updatedAtMs,
            serverSeq: this.playback.serverSeq,
          };
        } else {
          this.playback = incoming;
        }
        this.refreshAllowedNonces();
      }
      if (Array.isArray(msg.members)) {
        const next = new Map<string, AriaRoomMember>();
        for (const m of msg.members as AriaRoomMember[]) {
          if (m?.peerId) next.set(m.peerId, m);
        }
        this.members = next;
      }
      if (state?.directEndpoint && !this.guestDirectBaseUrl) {
        // Hybrid endpoint hint is preserved for optional direct fast-path check by client
        this.guestDirectBaseUrl = `http://${formatHostForUrl(state.directEndpoint.host)}:${state.directEndpoint.port}`;
        this.guestDirectToken = state.directEndpoint.token;
      }
      this.emitSse("state", this.getSnapshot());
      return;
    }

    if (type === "playback_sync" && this.role === "guest" && msg.event) {
      const event = msg.event as AriaRoomSyncEvent;
      if (event.seq <= this.playback.serverSeq) return;
      if (event.nonce && this.playback.nonce && event.nonce !== this.playback.nonce) return;
      const anchorTimeMs =
        event.kind === "play_at" && event.startAtHostMs > 0 ? event.startAtHostMs : event.serverTimeMs;
      this.playback.serverSeq = event.seq;
      this.playback.positionSec = Math.max(0, event.positionSec);
      this.playback.updatedAtMs = anchorTimeMs;
      if (event.kind === "play_at") this.playback.playing = true;
      else if (event.kind === "pause") this.playback.playing = false;
      this.emitSse("playback_sync", event);
      this.emitSse("state", this.getSnapshot());
      return;
    }

    if (type === "track_ready" && typeof msg.fromPeerId === "string" && typeof msg.nonce === "string") {
      const existing = this.members.get(msg.fromPeerId);
      if (existing) {
        this.members.set(msg.fromPeerId, { ...existing, readyNonce: msg.nonce });
      }
      this.emitSse("track_ready", {
        fromPeerId: msg.fromPeerId,
        nonce: msg.nonce,
        bufferedBytes: Number(msg.bufferedBytes ?? 0),
      });
      this.emitSse("state", this.getSnapshot());
      return;
    }

    if (type === "update_capabilities" && typeof msg.peerId === "string") {
      const target = this.members.get(msg.peerId);
      if (target) {
        this.members.set(msg.peerId, {
          ...target,
          ...(msg.shareEnabled !== undefined ? { shareEnabled: Boolean(msg.shareEnabled) } : {}),
          ...(msg.capabilities && typeof msg.capabilities === "object"
            ? { capabilities: msg.capabilities as AriaRoomCapabilities }
            : {}),
        });
        this.emitSse("state", this.getSnapshot());
      }
      return;
    }

    if (type === "resolve_track" && typeof msg.requestId === "string" && msg.track && typeof msg.track === "object") {
      const requestId = msg.requestId;
      const requester = typeof msg.fromPeerId === "string" ? msg.fromPeerId : "";
      const targetTrack = msg.track as AriaRoomTrackPayload;
      if (!this.myShareEnabled) {
        sourceWs.sendJson({
          type: "resolve_result",
          roomId: this.roomId,
          requestId,
          toPeerId: requester,
          fromPeerId: this.myPeerId,
          ok: false,
          reason: "SHARE_DISABLED",
        });
        return;
      }
      void this.resolveLocalTrackForRelay(targetTrack).then((result) => {
        sourceWs.sendJson({
          type: "resolve_result",
          roomId: this.roomId,
          requestId,
          toPeerId: requester,
          fromPeerId: this.myPeerId,
          ...result,
        });
      });
      return;
    }

    if (type === "resolve_result" && typeof msg.requestId === "string") {
      const pending = this.pendingResolves.get(msg.requestId);
      if (pending) {
        this.pendingResolves.delete(msg.requestId);
        clearTimeout(pending.timer);
        pending.resolve({
          ok: Boolean(msg.ok),
          directUrl: typeof msg.directUrl === "string" ? msg.directUrl : null,
          safeHeaders: sanitizeSafeHeaders(msg.safeHeaders as Record<string, string> | undefined),
          mimeType: typeof msg.mimeType === "string" ? msg.mimeType : null,
          bitrate: typeof msg.bitrate === "number" ? msg.bitrate : null,
          sampleRate: typeof msg.sampleRate === "number" ? msg.sampleRate : null,
          quality: msg.quality as AriaRoomTrackPayload["quality"] | undefined,
          currentLevel: msg.currentLevel as AriaRoomTrackPayload["currentLevel"],
          availableLevels: Array.isArray(msg.availableLevels)
            ? (msg.availableLevels as AriaRoomTrackPayload["availableLevels"])
            : undefined,
          coverDataUrl: typeof msg.coverDataUrl === "string" ? msg.coverDataUrl : null,
          isTrial: Boolean(msg.isTrial),
          reason: typeof msg.reason === "string" ? msg.reason : undefined,
        });
      }
      return;
    }

    if (type === "prefetch_next" && this.role === "guest" && msg.nextTrack && typeof msg.nextTrack === "object") {
      this.playback.nextTrack = msg.nextTrack as AriaRoomTrackPayload;
      this.refreshAllowedNonces();
      this.emitSse("prefetch_next", this.playback.nextTrack);
      this.emitSse("state", this.getSnapshot());
      return;
    }

    if (type === "proxy_fallback_request" && typeof msg.nonce === "string" && typeof msg.fromPeerId === "string") {
      const targetTrack = (msg.track as AriaRoomTrackPayload | undefined) ?? this.findTrackByNonce(msg.nonce);
      this.fallbackServingNonces.add(msg.nonce);
      if (targetTrack) {
        void this.prepareHostTrackInternal(targetTrack)
          .then(() => {
            this.emitSse("proxy_serve_request", {
              targetPeerId: msg.fromPeerId,
              nonce: msg.nonce,
            });
          })
          .catch(() => undefined);
      }
      return;
    }

    if (type === "control_request" && this.role === "host") {
      if (this.controlMode !== "collaborative") {
        sourceWs.sendJson({
          type: "notice",
          toPeerId: msg.fromPeerId,
          message: "房主当前开启了「仅房主切歌」模式",
        });
        return;
      }
      this.emitSse("control_request", {
        fromPeerId: msg.fromPeerId,
        action: msg.action,
        payload: msg.payload,
      });
    }
  }

  private checkDirectRateLimitAndToken(
    req: http.IncomingMessage,
    url: URL,
  ): { ok: true } | { ok: false; status: number; code: string } {
    const ip = normalizeRemoteIp(req.socket.remoteAddress);
    const now = Date.now();
    const record = this.directAuthAttempts.get(ip);

    if (record && record.blockedUntil > now) {
      return { ok: false, status: 429, code: "RATE_LIMITED" };
    }

    const provided = extractBearerOrQueryToken(req, url);
    if (timingSafeTokenMatch(this.directRoomToken, provided)) {
      this.directAuthAttempts.delete(ip);
      return { ok: true };
    }

    const activeRecord =
      record && now - record.windowStart < 60_000
        ? record
        : { fails: 0, windowStart: now, blockedUntil: 0 };
    activeRecord.fails += 1;
    if (activeRecord.fails >= 10) {
      activeRecord.blockedUntil = now + 5 * 60_000;
    }
    if (this.directAuthAttempts.size > 256) {
      this.directAuthAttempts.clear();
    }
    this.directAuthAttempts.set(ip, activeRecord);
    return {
      ok: false,
      status: activeRecord.blockedUntil > now ? 429 : 401,
      code: activeRecord.blockedUntil > now ? "RATE_LIMITED" : "ROOM_TOKEN_INVALID",
    };
  }

  private async startDirectServer(): Promise<void> {
    await this.stopDirectServer();
    this.directRoomToken = generateRoomToken();
    this.directServerError = null;
    this.directAuthAttempts.clear();

    const server = http.createServer((req, res) => {
      void this.handleDirectHttpRequest(req, res);
    });

    server.on("connection", (socket) => {
      this.directSockets.add(socket);
      socket.once("close", () => this.directSockets.delete(socket));
    });

    server.on("upgrade", (req, socket, head) => {
      this.handleDirectWsUpgrade(req, socket as net.Socket, head);
    });

    try {
      await this.listenServerDualStack(server, this.directPort);
      const addr = server.address();
      if (addr && typeof addr === "object") {
        this.directPort = addr.port;
      }
      this.directServer = server;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.directServerError = `直连端口 ${this.directPort} 监听失败: ${message}`;
      try {
        server.close();
      } catch {
        // ignore
      }
      if (this.networkMode === "direct") {
        await this.leaveRoom();
        throw new HttpError(500, this.directServerError, "DIRECT_PORT_BIND_FAILED");
      }
    }
  }

  private listenServerDualStack(server: http.Server, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const tryBind = (host: string, allowIpv4Fallback: boolean) => {
        const onError = (err: NodeJS.ErrnoException) => {
          server.off("listening", onListening);
          if (allowIpv4Fallback && (err.code === "EADDRNOTAVAIL" || err.code === "EAFNOSUPPORT" || err.code === "EINVAL")) {
            tryBind("0.0.0.0", false);
            return;
          }
          reject(err);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen({ port, host, ipv6Only: false });
      };
      tryBind("::", true);
    });
  }

  private async stopDirectServer(): Promise<void> {
    for (const ws of Array.from(this.directWsClients.keys())) {
      try {
        ws.close(1000, "Server closed");
      } catch {
        // ignore
      }
    }
    this.directWsClients.clear();

    if (this.directServer) {
      const closing = this.directServer;
      this.directServer = null;
      closing.closeAllConnections?.();
      await new Promise<void>((resolve) => closing.close(() => resolve()));
    }
    for (const socket of Array.from(this.directSockets)) {
      if (!socket.destroyed) socket.destroy();
    }
    this.directSockets.clear();
    this.directRoomToken = null;
    this.directServerError = null;
    this.directAuthAttempts.clear();
  }

  private async handleDirectHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const streamMatch = /^\/aria-room\/tracks\/([a-zA-Z0-9_-]+)\/stream$/.exec(url.pathname);
    const coverMatch = /^\/aria-room\/tracks\/([a-zA-Z0-9_-]+)\/cover$/.exec(url.pathname);

    // Strictly expose ONLY stream & cover endpoints; return 404 for everything else.
    if (!streamMatch && !coverMatch) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    const auth = this.checkDirectRateLimitAndToken(req, url);
    if (!auth.ok) {
      res.writeHead(auth.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: auth.code }));
      return;
    }

    const nonce = (streamMatch?.[1] ?? coverMatch?.[1] ?? "").trim();
    if (!this.active || (streamMatch && !this.allowedNonces.has(nonce)) || (coverMatch && !this.findTrackByNonce(nonce))) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "TRACK_NOT_ACTIVE_IN_ROOM" }));
      return;
    }

    try {
      if (streamMatch) {
        const entry = this.byteCache.getEntry(nonce);
        if (!entry) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "TRACK_NOT_BUFFERED" }));
          return;
        }
        await this.byteCache.serveEntryHttpRange(req, res, entry);
        return;
      }

      if (coverMatch) {
        const cover = await this.byteCache.resolveCover(nonce, this.localApiPort, this.findTrackByNonce(nonce));
        if (!cover) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, {
          "Content-Type": cover.contentType,
          "Content-Length": String(cover.body.byteLength),
          "Cache-Control": "public, max-age=3600",
        });
        res.end(cover.body);
      }
    } catch {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
      }
      if (!res.writableEnded) res.end();
    }
  }

  private handleDirectWsUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/aria-room/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const auth = this.checkDirectRateLimitAndToken(req, url);
    if (!auth.ok) {
      socket.write(`HTTP/1.1 ${auth.status} Unauthorized\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }

    if (!this.active || this.role !== "host") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    let ws: AriaWebSocket;
    try {
      ws = acceptWebSocketUpgrade(req, socket, head);
    } catch {
      return;
    }

    this.directWsClients.set(ws, { peerId: null });

    ws.on("message", (raw: string) => {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const msgType = String(parsed.type ?? "");
        if (msgType === "hello" && parsed.member && typeof parsed.member === "object") {
          const guest = parsed.member as AriaRoomMember;
          if (this.members.size >= MAX_ARIA_ROOM_MEMBERS && !this.members.has(guest.peerId)) {
            ws.sendJson({
              type: "error",
              code: "ROOM_FULL",
              message: `房间已满（最多 ${MAX_ARIA_ROOM_MEMBERS} 人）`,
            });
            ws.close(4003, "Room full");
            return;
          }
          const cleanGuest: AriaRoomMember = {
            peerId: guest.peerId,
            nickname: guest.nickname || "Aria 听众",
            avatarUrl: guest.avatarUrl ?? null,
            role: "guest",
            joinedAt: guest.joinedAt || Date.now(),
            connectedVia: "direct",
            shareEnabled: guest.shareEnabled !== false,
            capabilities: guest.capabilities,
          };
          this.directWsClients.set(ws, { peerId: cleanGuest.peerId });
          this.members.set(cleanGuest.peerId, cleanGuest);
          this.sendToAllPeers({
            type: "room_peers",
            members: Array.from(this.members.values()),
          });
          ws.sendJson({
            type: "state_update",
            roomId: this.roomId,
            state: this.buildSharedStatePayload(),
            members: Array.from(this.members.values()),
          });
          this.emitSse("peer_joined", cleanGuest);
          this.emitSse("state", this.getSnapshot());
          return;
        }
        this.handleSignalingMessage(raw, ws);
      } catch {
        // ignore invalid json
      }
    });

    ws.on("close", () => {
      const meta = this.directWsClients.get(ws);
      this.directWsClients.delete(ws);
      if (meta?.peerId && this.members.has(meta.peerId)) {
        this.members.delete(meta.peerId);
        this.sendToAllPeers({
          type: "room_peers",
          members: Array.from(this.members.values()),
        });
        this.emitSse("peer_left", { peerId: meta.peerId });
        this.emitSse("state", this.getSnapshot());
      }
    });
  }
}

export type { EventEmitter };
