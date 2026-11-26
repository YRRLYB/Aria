interface WorkerDurableObjectState {
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put<T = unknown>(key: string, value: T): Promise<void>;
    deleteAll(): Promise<void>;
    setAlarm(scheduledTime: number): Promise<void>;
    deleteAlarm(): Promise<void>;
  };
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
  getTags(ws: WebSocket): string[];
}

interface WorkerEnv {
  ROOMS: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
}

type StoredCapabilities = {
  netease: "vip" | "free" | "none";
  qq: "vip" | "free" | "none";
  bilibili: "vip" | "free" | "none";
  youtube: "reachable" | "unreachable";
};

type StoredMember = {
  peerId: string;
  nickname: string;
  avatarUrl: string | null;
  role: "host" | "guest";
  joinedAt: number;
  connectedVia: "direct" | "webrtc" | "ws";
  shareEnabled?: boolean;
  capabilities?: StoredCapabilities;
  online?: boolean;
  presence?: "active" | "away" | "offline";
  lastSeenAt?: number;
};

type StoredRoomMeta = {
  initialized: boolean;
  hostPeerId: string | null;
  members: Record<string, StoredMember>;
  cachedState: Record<string, unknown> | null;
};

const MAX_MEMBERS = 5;
const ROOM_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
const ROOM_CODE_PATTERN = /^[A-Z0-9_-]{3,24}$/;

export class AriaSignalRoom {
  private readonly ctx: WorkerDurableObjectState;

  constructor(ctx: WorkerDurableObjectState) {
    this.ctx = ctx;
  }

  private async readMeta(): Promise<StoredRoomMeta> {
    const stored = await this.ctx.storage.get<StoredRoomMeta>("meta");
    return (
      stored ?? {
        initialized: false,
        hostPeerId: null,
        members: {},
        cachedState: null,
      }
    );
  }

  private async writeMeta(meta: StoredRoomMeta): Promise<void> {
    await this.ctx.storage.put("meta", meta);
  }

  private sendJson(ws: WebSocket, payload: unknown): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Socket already closing.
    }
  }

  private broadcast(payload: unknown, exclude?: WebSocket): void {
    const encoded = JSON.stringify(payload);
    for (const sock of this.ctx.getWebSockets()) {
      if (exclude && sock === exclude) continue;
      try {
        sock.send(encoded);
      } catch {
        // Ignore broken sockets.
      }
    }
  }

  private getSocketsByPeerId(peerId: string): WebSocket[] {
    return this.ctx.getWebSockets(peerId);
  }

  private sortedMembers(meta: StoredRoomMeta): StoredMember[] {
    return Object.values(meta.members).sort((a, b) => a.joinedAt - b.joinedAt);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const url = new URL(request.url);
    const peerId = (url.searchParams.get("peer") || "").trim();
    const role = url.searchParams.get("role") === "host" ? "host" : "guest";
    if (!peerId) {
      return new Response("Missing peer id", { status: 400 });
    }

    const pair = new (globalThis as unknown as { WebSocketPair: new () => { 0: WebSocket; 1: WebSocket } }).WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Tag socket with peerId & role so hibernation reloads keep identity cleanly.
    this.ctx.acceptWebSocket(server, [peerId, role]);

    return new Response(null, {
      status: 101,
      // Cloudflare Workers Response supports webSocket option.
      webSocket: client,
    } as ResponseInit & { webSocket: WebSocket });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(message) as Record<string, unknown>;
    } catch {
      return;
    }

    const type = String(parsed.type ?? "");
    const tags = this.ctx.getTags(ws);
    const senderPeerId = tags[0] ?? "";

    if (type === "ping") {
      const t1 = Date.now();
      const t0 = typeof parsed.t0 === "number" ? parsed.t0 : typeof parsed.ts === "number" ? parsed.ts : t1;
      const t2 = Date.now();
      this.sendJson(ws, { type: "pong", ts: parsed.ts ?? t1, t0, t1, t2, serverTs: t2 });
      return;
    }
    if (type === "pong") return;

    const meta = await this.readMeta();

    if (type === "hello") {
      const role = parsed.role === "host" ? "host" : "guest";
      const member = parsed.member as StoredMember | undefined;
      const actualPeerId = (senderPeerId || String(member?.peerId || "")).trim();
      if (!member || !actualPeerId) return;
      const now = Date.now();
      const presence = parsed.presence === "away" ? "away" : "active";

      if (role === "host") {
        if (meta.initialized && meta.hostPeerId && meta.hostPeerId !== actualPeerId) {
          this.sendJson(ws, {
            type: "error",
            code: "ROOM_CODE_TAKEN",
            message: "该房间号已被其他房主占用，请更换房间号或改为加入房间",
          });
          ws.close(4009, "Room code taken");
          return;
        }
        await this.ctx.storage.deleteAlarm();
        const isSameHostRejoin = meta.initialized && meta.hostPeerId === actualPeerId;
        const existingHost = meta.members[actualPeerId];
        meta.initialized = true;
        meta.hostPeerId = actualPeerId;
        meta.members[actualPeerId] = {
          peerId: actualPeerId,
          nickname: String(member.nickname || "Aria 房主").slice(0, 60),
          avatarUrl: typeof member.avatarUrl === "string" ? member.avatarUrl : null,
          role: "host",
          joinedAt: existingHost?.joinedAt || member.joinedAt || now,
          connectedVia: "ws",
          shareEnabled: member.shareEnabled !== false,
          online: true,
          presence,
          lastSeenAt: now,
          ...(member.capabilities ? { capabilities: member.capabilities } : existingHost?.capabilities ? { capabilities: existingHost.capabilities } : {}),
        };
        const incomingState =
          parsed.state && typeof parsed.state === "object"
            ? (parsed.state as Record<string, unknown>)
            : null;
        const incomingPlayback =
          incomingState && typeof incomingState.playback === "object" && incomingState.playback
            ? (incomingState.playback as Record<string, unknown>)
            : null;
        const hasIncomingTrack = Boolean(incomingPlayback?.track || incomingPlayback?.currentTrack);
        const shouldRestoreCachedState = Boolean(
          isSameHostRejoin && meta.cachedState && (parsed.rejoin || !hasIncomingTrack),
        );
        if (!shouldRestoreCachedState && incomingState) {
          meta.cachedState = incomingState;
        }
        await this.writeMeta(meta);
        this.broadcast({ type: "room_peers", members: this.sortedMembers(meta) });
        if (shouldRestoreCachedState && meta.cachedState) {
          this.sendJson(ws, {
            type: "state_update",
            state: meta.cachedState,
            members: this.sortedMembers(meta),
          });
        }
        return;
      }

      if (!meta.initialized || !meta.hostPeerId) {
        this.sendJson(ws, {
          type: "error",
          code: "ROOM_NOT_FOUND",
          message: "Aria 房间不存在或已结束",
        });
        ws.close(4004, "Room not found");
        return;
      }

      await this.ctx.storage.deleteAlarm();
      const existingCount = Object.keys(meta.members).length;
      if (existingCount >= MAX_MEMBERS && !meta.members[actualPeerId]) {
        const offlineGuests = Object.values(meta.members)
          .filter((m) => m.peerId !== meta.hostPeerId && (m.online === false || m.presence === "offline"))
          .sort((a, b) => (a.lastSeenAt ?? a.joinedAt) - (b.lastSeenAt ?? b.joinedAt));
        if (offlineGuests.length > 0) {
          delete meta.members[offlineGuests[0].peerId];
        } else {
          this.sendJson(ws, {
            type: "error",
            code: "ROOM_FULL",
            message: `房间已满（最多 ${MAX_MEMBERS} 人）`,
          });
          ws.close(4003, "Room full");
          return;
        }
      }

      const existingGuest = meta.members[actualPeerId];
      const cleanGuest: StoredMember = {
        peerId: actualPeerId,
        nickname: String(member.nickname || "Aria 听众").slice(0, 60),
        avatarUrl: typeof member.avatarUrl === "string" ? member.avatarUrl : null,
        role: "guest",
        joinedAt: existingGuest?.joinedAt || member.joinedAt || now,
        connectedVia: "webrtc",
        shareEnabled: member.shareEnabled !== false,
        online: true,
        presence,
        lastSeenAt: now,
        ...(member.capabilities ? { capabilities: member.capabilities } : existingGuest?.capabilities ? { capabilities: existingGuest.capabilities } : {}),
      };
      meta.members[cleanGuest.peerId] = cleanGuest;
      await this.writeMeta(meta);

      this.broadcast({ type: "room_peers", members: this.sortedMembers(meta) });
      this.broadcast({ type: "peer_joined", member: cleanGuest }, ws);
      if (meta.cachedState) {
        this.sendJson(ws, {
          type: "state_update",
          state: meta.cachedState,
          members: this.sortedMembers(meta),
        });
      }
      return;
    }

    if (type === "close_room" && senderPeerId === meta.hostPeerId) {
      this.broadcast({ type: "room_closed" }, ws);
      for (const sock of this.ctx.getWebSockets()) {
        if (sock !== ws) sock.close(1000, "Room closed");
      }
      await this.ctx.storage.deleteAll();
      return;
    }

    if (type === "leave") {
      if (senderPeerId && meta.members[senderPeerId]) {
        delete meta.members[senderPeerId];
        await this.writeMeta(meta);
        this.broadcast({ type: "peer_left", peerId: senderPeerId }, ws);
        this.broadcast({ type: "room_peers", members: this.sortedMembers(meta) }, ws);
      }
      return;
    }

    if (type === "state_update" && senderPeerId === meta.hostPeerId) {
      this.broadcast(parsed, ws);
      if (parsed.state && typeof parsed.state === "object") {
        meta.cachedState = parsed.state as Record<string, unknown>;
        try {
          await this.writeMeta(meta);
        } catch {
          // Ignore transient DO storage flush failures after relaying live state.
        }
      }
      return;
    }

    if (type === "playback_sync" && senderPeerId === meta.hostPeerId) {
      const ev = parsed.event as
        | {
            seq?: number;
            kind?: string;
            nonce?: string | null;
            positionSec?: number;
            startAtHostMs?: number;
            serverTimeMs?: number;
          }
        | undefined;
      const cachedPlayback =
        meta.cachedState && typeof meta.cachedState.playback === "object"
          ? (meta.cachedState.playback as Record<string, unknown>)
          : null;
      if (cachedPlayback && ev && typeof ev.seq === "number") {
        const currentSeq = typeof cachedPlayback.serverSeq === "number" ? cachedPlayback.serverSeq : 0;
        const sameNonce = !ev.nonce || !cachedPlayback.nonce || ev.nonce === cachedPlayback.nonce;
        if (sameNonce && ev.seq > currentSeq) {
          const anchorMs =
            ev.kind === "play_at" && typeof ev.startAtHostMs === "number" && ev.startAtHostMs > 0
              ? ev.startAtHostMs
              : typeof ev.serverTimeMs === "number"
                ? ev.serverTimeMs
                : Date.now();
          meta.cachedState = {
            ...meta.cachedState,
            playback: {
              ...cachedPlayback,
              serverSeq: ev.seq,
              ...(typeof ev.positionSec === "number" ? { positionSec: Math.max(0, ev.positionSec) } : {}),
              updatedAtMs: anchorMs,
              ...(ev.kind === "play_at" ? { playing: true } : ev.kind === "pause" ? { playing: false } : {}),
            },
          };
          await this.writeMeta(meta);
        }
      }
      this.broadcast(parsed, ws);
      return;
    }

    if (type === "prefetch_next" && senderPeerId === meta.hostPeerId) {
      this.broadcast(parsed, ws);
      return;
    }

    if (type === "notice" && senderPeerId === meta.hostPeerId) {
      const targetPeer = typeof parsed.toPeerId === "string" ? parsed.toPeerId : "";
      if (targetPeer) {
        for (const targetWs of this.getSocketsByPeerId(targetPeer)) {
          this.sendJson(targetWs, parsed);
        }
      } else {
        this.broadcast(parsed, ws);
      }
      return;
    }

    if (type === "presence_update") {
      const targetPeer = senderPeerId;
      const nextPresence = parsed.presence === "away" ? "away" : parsed.presence === "active" ? "active" : null;
      if (targetPeer && nextPresence && meta.members[targetPeer] && meta.members[targetPeer].online !== false) {
        meta.members[targetPeer] = {
          ...meta.members[targetPeer],
          online: true,
          presence: nextPresence,
          lastSeenAt: Date.now(),
        };
        await this.writeMeta(meta);
        this.broadcast({ type: "room_peers", members: this.sortedMembers(meta) });
      }
      return;
    }

    if (type === "kick_member" && senderPeerId === meta.hostPeerId && typeof parsed.peerId === "string") {
      const targetPeer = parsed.peerId.trim();
      if (targetPeer && targetPeer !== meta.hostPeerId) {
        const existed = Boolean(meta.members[targetPeer]);
        delete meta.members[targetPeer];
        for (const targetWs of this.getSocketsByPeerId(targetPeer)) {
          this.sendJson(targetWs, {
            type: "error",
            code: "KICKED_BY_HOST",
            message: "你已被房主移出房间",
          });
          targetWs.close(4010, "Removed by host");
        }
        if (existed) {
          await this.writeMeta(meta);
          this.broadcast({ type: "peer_left", peerId: targetPeer });
          this.broadcast({ type: "room_peers", members: this.sortedMembers(meta) });
        }
      }
      return;
    }

    if (type === "update_capabilities") {
      const targetPeer = senderPeerId || (typeof parsed.peerId === "string" ? parsed.peerId : "");
      if (targetPeer && meta.members[targetPeer]) {
        meta.members[targetPeer] = {
          ...meta.members[targetPeer],
          ...(parsed.shareEnabled !== undefined ? { shareEnabled: Boolean(parsed.shareEnabled) } : {}),
          ...(parsed.capabilities && typeof parsed.capabilities === "object"
            ? { capabilities: parsed.capabilities as StoredCapabilities }
            : {}),
        };
        await this.writeMeta(meta);
        this.broadcast({
          type: "update_capabilities",
          peerId: targetPeer,
          shareEnabled: meta.members[targetPeer].shareEnabled,
          capabilities: meta.members[targetPeer].capabilities,
        }, ws);
        this.broadcast({ type: "room_peers", members: this.sortedMembers(meta) });
      }
      return;
    }

    if (type === "signal" || type === "clock_pong" || type === "resolve_track" || type === "proxy_fallback_request") {
      const targetPeer = typeof parsed.toPeerId === "string" ? parsed.toPeerId : "";
      if (!targetPeer) return;
      for (const targetWs of this.getSocketsByPeerId(targetPeer)) {
        this.sendJson(targetWs, { ...parsed, fromPeerId: parsed.fromPeerId ?? senderPeerId });
      }
      return;
    }

    if (type === "resolve_result") {
      const targetPeer = (typeof parsed.toPeerId === "string" && parsed.toPeerId) || meta.hostPeerId || "";
      if (!targetPeer) return;
      for (const targetWs of this.getSocketsByPeerId(targetPeer)) {
        this.sendJson(targetWs, { ...parsed, fromPeerId: parsed.fromPeerId ?? senderPeerId });
      }
      return;
    }

    if ((type === "clock_ping" || type === "control_request") && meta.hostPeerId) {
      for (const hostWs of this.getSocketsByPeerId(meta.hostPeerId)) {
        this.sendJson(hostWs, { ...parsed, fromPeerId: parsed.fromPeerId ?? senderPeerId });
      }
      return;
    }

    if (type === "track_ready") {
      this.broadcast({ ...parsed, fromPeerId: parsed.fromPeerId ?? senderPeerId }, ws);
      return;
    }

    if (type === "kick_full" && senderPeerId === meta.hostPeerId && typeof parsed.peerId === "string") {
      for (const targetWs of this.getSocketsByPeerId(parsed.peerId)) {
        this.sendJson(targetWs, {
          type: "error",
          code: "ROOM_FULL",
          message: `房间已满（最多 ${MAX_MEMBERS} 人）`,
        });
        targetWs.close(4003, "Room full");
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const tags = this.ctx.getTags(ws);
    const peerId = tags[0] ?? "";
    const meta = await this.readMeta();
    const remainingAllSockets = this.ctx.getWebSockets().filter((s) => s !== ws);
    if (!peerId || !meta.members[peerId]) {
      if (meta.initialized && remainingAllSockets.length === 0) {
        await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_TTL_MS);
      }
      return;
    }

    const remainingSamePeer = this.getSocketsByPeerId(peerId).filter((s) => s !== ws);
    if (remainingSamePeer.length > 0) return;

    meta.members[peerId] = {
      ...meta.members[peerId],
      online: false,
      presence: "offline",
      lastSeenAt: Date.now(),
    };
    await this.writeMeta(meta);
    this.broadcast({ type: "room_peers", members: this.sortedMembers(meta) }, ws);

    if (remainingAllSockets.length === 0) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_IDLE_TTL_MS);
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  async alarm(): Promise<void> {
    const meta = await this.readMeta();
    if (!meta.initialized || !meta.hostPeerId) return;
    if (this.ctx.getWebSockets().length > 0) return;

    this.broadcast({ type: "room_closed" });
    for (const sock of this.ctx.getWebSockets()) {
      sock.close(1000, "Room idle timeout");
    }
    await this.ctx.storage.deleteAll();
  }
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ ok: true, service: "aria-signal-worker", ts: Date.now() }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-aria-signal": "1",
          },
        },
      );
    }

    if (url.pathname === "/ws") {
      const roomCode = (url.searchParams.get("room") || "").trim().toUpperCase();
      if (!ROOM_CODE_PATTERN.test(roomCode)) {
        return new Response("Invalid room code", { status: 400 });
      }
      const id = env.ROOMS.idFromName(roomCode);
      return env.ROOMS.get(id).fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
