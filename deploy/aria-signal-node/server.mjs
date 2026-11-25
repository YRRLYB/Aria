#!/usr/bin/env node
/**
 * Aria Self-Hosted Listen-Together Signaling Node (Zero-Dependency Node.js >= 18)
 *
 * Implements the exact `/health` + `/ws` protocol expected by Aria's
 * Listen-Together room manager (`server/ariaRoom/roomManager.ts`), matching
 * `cloudflare/aria-signal-worker/src/index.ts`.
 *
 * Usage:
 *   node server.mjs [--port 8787] [--host 0.0.0.0]
 * Env:
 *   PORT=8787 HOST=0.0.0.0 MAX_MEMBERS=5 HOST_GRACE_MS=60000
 */

import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_MAX_MEMBERS = 5;
const DEFAULT_HOST_GRACE_MS = 60_000;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const HEARTBEAT_INTERVAL_MS = 30_000;

function encodeFrame(opcode, payloadBuf = Buffer.alloc(0)) {
  const len = payloadBuf.byteLength;
  let headerBytes = 2;
  if (len >= 126 && len <= 65535) headerBytes += 2;
  else if (len > 65535) headerBytes += 8;

  const frame = Buffer.allocUnsafe(headerBytes + len);
  frame[0] = 0x80 | (opcode & 0x0f);
  let offset = 2;
  if (len < 126) {
    frame[1] = len;
  } else if (len <= 65535) {
    frame[1] = 126;
    frame.writeUInt16BE(len, offset);
    offset += 2;
  } else {
    frame[1] = 127;
    frame.writeUInt32BE(Math.floor(len / 0x1_0000_0000), offset);
    frame.writeUInt32BE(len >>> 0, offset + 4);
    offset += 8;
  }
  if (len > 0) payloadBuf.copy(frame, offset);
  return frame;
}

function tryDecodeFrame(buffer, maxPayloadBytes = MAX_PAYLOAD_BYTES) {
  if (buffer.byteLength < 2) return null;
  const b0 = buffer[0];
  const b1 = buffer[1];
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let length = b1 & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.byteLength < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.byteLength < offset + 8) return null;
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    length = high * 0x1_0000_0000 + low;
    offset += 8;
  }

  if (length > maxPayloadBytes) {
    throw new Error(`WebSocket payload too large (${length} > ${maxPayloadBytes})`);
  }

  const maskLen = masked ? 4 : 0;
  if (buffer.byteLength < offset + maskLen + length) return null;

  let payload;
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4);
    const maskedPayload = buffer.subarray(offset + 4, offset + 4 + length);
    payload = Buffer.allocUnsafe(length);
    for (let i = 0; i < length; i += 1) {
      payload[i] = maskedPayload[i] ^ mask[i & 3];
    }
  } else {
    payload = Buffer.from(buffer.subarray(offset, offset + length));
  }

  return {
    fin,
    opcode,
    payload,
    bytesConsumed: offset + maskLen + length,
  };
}

class SimpleWebSocket {
  constructor(socket, { peerId, role, initialBuffer, onMessage, onClose }) {
    this.socket = socket;
    this.peerId = peerId;
    this.role = role;
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.buffer = initialBuffer && initialBuffer.byteLength > 0 ? Buffer.from(initialBuffer) : Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = null;
    this.closed = false;
    this.closeFrameSent = false;
    this.lastSeenMs = Date.now();

    socket.setNoDelay(true);
    socket.on("data", (chunk) => this.handleData(chunk));
    socket.on("error", () => this.finishClose());
    socket.on("close", () => this.finishClose());

    if (this.buffer.byteLength > 0) {
      queueMicrotask(() => this.drainFrames());
    }
  }

  get isOpen() {
    return !this.closed && !this.socket.destroyed && this.socket.writable;
  }

  sendText(text) {
    if (!this.isOpen) return;
    try {
      this.socket.write(encodeFrame(0x01, Buffer.from(text, "utf8")));
    } catch {
      this.finishClose();
    }
  }

  sendJson(value) {
    this.sendText(JSON.stringify(value));
  }

  ping() {
    if (!this.isOpen) return;
    try {
      this.socket.write(encodeFrame(0x09));
    } catch {
      this.finishClose();
    }
  }

  close(code = 1000, reason = "") {
    if (this.closed) return;
    if (!this.closeFrameSent && !this.socket.destroyed && this.socket.writable) {
      this.closeFrameSent = true;
      const reasonBuf = Buffer.from(String(reason).slice(0, 120), "utf8");
      const payload = Buffer.allocUnsafe(2 + reasonBuf.byteLength);
      payload.writeUInt16BE(code, 0);
      reasonBuf.copy(payload, 2);
      try {
        this.socket.end(encodeFrame(0x08, payload));
      } catch {
        this.socket.destroy();
      }
    } else {
      this.socket.destroy();
    }
    this.finishClose();
  }

  handleData(chunk) {
    this.lastSeenMs = Date.now();
    this.buffer = this.buffer.byteLength === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    this.drainFrames();
  }

  drainFrames() {
    while (!this.closed) {
      let frame;
      try {
        frame = tryDecodeFrame(this.buffer);
      } catch {
        this.close(1009, "Message too big");
        return;
      }
      if (!frame) return;
      this.buffer =
        frame.bytesConsumed < this.buffer.byteLength
          ? this.buffer.subarray(frame.bytesConsumed)
          : Buffer.alloc(0);

      if (frame.opcode === 0x08) {
        this.close(1000, "Client closed");
        return;
      }
      if (frame.opcode === 0x09) {
        if (this.isOpen) {
          try {
            this.socket.write(encodeFrame(0x0a, frame.payload));
          } catch {
            this.finishClose();
          }
        }
        continue;
      }
      if (frame.opcode === 0x0a) {
        this.lastSeenMs = Date.now();
        continue;
      }

      if (frame.opcode === 0x01 || frame.opcode === 0x02) {
        if (frame.fin) {
          if (frame.opcode === 0x01) {
            this.onMessage?.(frame.payload.toString("utf8"));
          }
        } else {
          this.fragmentOpcode = frame.opcode;
          this.fragments = [frame.payload];
        }
        continue;
      }

      if (frame.opcode === 0x00 && this.fragmentOpcode !== null) {
        this.fragments.push(frame.payload);
        if (frame.fin) {
          const joined = Buffer.concat(this.fragments);
          const kind = this.fragmentOpcode;
          this.fragments = [];
          this.fragmentOpcode = null;
          if (kind === 0x01) {
            this.onMessage?.(joined.toString("utf8"));
          }
        }
      }
    }
  }

  finishClose() {
    if (this.closed) return;
    this.closed = true;
    this.onClose?.(this);
  }
}

export function createAriaSignalServer(options = {}) {
  const host = options.host ?? DEFAULT_HOST;
  const port = Number.isFinite(Number(options.port)) ? Number(options.port) : DEFAULT_PORT;
  const maxMembers = Math.max(2, Number(options.maxMembers ?? DEFAULT_MAX_MEMBERS) || DEFAULT_MAX_MEMBERS);
  const hostGraceMs = Math.max(5_000, Number(options.hostGraceMs ?? DEFAULT_HOST_GRACE_MS) || DEFAULT_HOST_GRACE_MS);

  const startedAt = Date.now();
  /** @type {Map<string, any>} */
  const rooms = new Map();

  function getOrCreateRoom(roomCode) {
    let room = rooms.get(roomCode);
    if (!room) {
      room = {
        roomCode,
        initialized: false,
        hostPeerId: null,
        members: Object.create(null),
        cachedState: null,
        sockets: new Set(),
        graceTimer: null,
      };
      rooms.set(roomCode, room);
    }
    return room;
  }

  function sortedMembers(room) {
    return Object.values(room.members).sort((a, b) => a.joinedAt - b.joinedAt);
  }

  function broadcast(room, payload, excludeWs) {
    const encoded = JSON.stringify(payload);
    for (const sock of room.sockets) {
      if (excludeWs && sock === excludeWs) continue;
      sock.sendText(encoded);
    }
  }

  function getSocketsByPeerId(room, peerId) {
    const out = [];
    for (const sock of room.sockets) {
      if (sock.peerId === peerId) out.push(sock);
    }
    return out;
  }

  function destroyRoom(roomCode) {
    const room = rooms.get(roomCode);
    if (!room) return;
    if (room.graceTimer) {
      clearTimeout(room.graceTimer);
      room.graceTimer = null;
    }
    rooms.delete(roomCode);
  }

  function handleMessage(room, ws, rawText) {
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return;
    }
    if (!parsed || typeof parsed !== "object") return;

    const type = String(parsed.type ?? "");
    const senderPeerId = ws.peerId;

    if (type === "ping") {
      ws.sendJson({ type: "pong", ts: parsed.ts ?? Date.now() });
      return;
    }
    if (type === "pong") return;

    if (type === "hello") {
      const role = parsed.role === "host" ? "host" : "guest";
      const member = parsed.member;
      if (!member?.peerId) return;

      if (role === "host") {
        if (room.graceTimer) {
          clearTimeout(room.graceTimer);
          room.graceTimer = null;
        }
        room.initialized = true;
        room.hostPeerId = member.peerId;
        room.members[member.peerId] = {
          peerId: member.peerId,
          nickname: String(member.nickname || "Aria 房主").slice(0, 60),
          avatarUrl: typeof member.avatarUrl === "string" ? member.avatarUrl : null,
          role: "host",
          joinedAt: member.joinedAt || Date.now(),
          connectedVia: "ws",
          shareEnabled: member.shareEnabled !== false,
          ...(member.capabilities ? { capabilities: member.capabilities } : {}),
        };
        if (parsed.state && typeof parsed.state === "object") {
          room.cachedState = parsed.state;
        }
        broadcast(room, { type: "room_peers", members: sortedMembers(room) });
        return;
      }

      if (!room.initialized || !room.hostPeerId) {
        ws.sendJson({
          type: "error",
          code: "ROOM_NOT_FOUND",
          message: "Aria 房间不存在或已结束",
        });
        ws.close(4004, "Room not found");
        return;
      }

      const existingCount = Object.keys(room.members).length;
      if (existingCount >= maxMembers && !room.members[member.peerId]) {
        ws.sendJson({
          type: "error",
          code: "ROOM_FULL",
          message: `房间已满（最多 ${maxMembers} 人）`,
        });
        ws.close(4003, "Room full");
        return;
      }

      room.members[member.peerId] = {
        peerId: member.peerId,
        nickname: String(member.nickname || "Aria 听众").slice(0, 60),
        avatarUrl: typeof member.avatarUrl === "string" ? member.avatarUrl : null,
        role: "guest",
        joinedAt: member.joinedAt || Date.now(),
        connectedVia: "webrtc",
        shareEnabled: member.shareEnabled !== false,
        ...(member.capabilities ? { capabilities: member.capabilities } : {}),
      };

      broadcast(room, { type: "room_peers", members: sortedMembers(room) });
      if (room.cachedState) {
        ws.sendJson({
          type: "state_update",
          state: room.cachedState,
          members: sortedMembers(room),
        });
      }
      return;
    }

    if (type === "close_room" && senderPeerId === room.hostPeerId) {
      broadcast(room, { type: "room_closed" }, ws);
      for (const sock of Array.from(room.sockets)) {
        if (sock !== ws) sock.close(1000, "Room closed");
      }
      destroyRoom(room.roomCode);
      return;
    }

    if (type === "leave") {
      if (senderPeerId && room.members[senderPeerId]) {
        delete room.members[senderPeerId];
        broadcast(room, { type: "peer_left", peerId: senderPeerId }, ws);
        broadcast(room, { type: "room_peers", members: sortedMembers(room) }, ws);
      }
      return;
    }

    if (type === "state_update" && senderPeerId === room.hostPeerId) {
      if (parsed.state && typeof parsed.state === "object") {
        room.cachedState = parsed.state;
      }
      broadcast(room, parsed, ws);
      return;
    }

    if (type === "playback_sync" && senderPeerId === room.hostPeerId) {
      const ev = parsed.event;
      const cachedPlayback =
        room.cachedState && typeof room.cachedState.playback === "object"
          ? room.cachedState.playback
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
          room.cachedState = {
            ...room.cachedState,
            playback: {
              ...cachedPlayback,
              serverSeq: ev.seq,
              ...(typeof ev.positionSec === "number" ? { positionSec: Math.max(0, ev.positionSec) } : {}),
              updatedAtMs: anchorMs,
              ...(ev.kind === "play_at" ? { playing: true } : ev.kind === "pause" ? { playing: false } : {}),
            },
          };
        }
      }
      broadcast(room, parsed, ws);
      return;
    }

    if ((type === "prefetch_next" || type === "notice") && senderPeerId === room.hostPeerId) {
      broadcast(room, parsed, ws);
      return;
    }

    if (type === "update_capabilities") {
      const targetPeer = senderPeerId || (typeof parsed.peerId === "string" ? parsed.peerId : "");
      if (targetPeer && room.members[targetPeer]) {
        room.members[targetPeer] = {
          ...room.members[targetPeer],
          ...(parsed.shareEnabled !== undefined ? { shareEnabled: Boolean(parsed.shareEnabled) } : {}),
          ...(parsed.capabilities && typeof parsed.capabilities === "object"
            ? { capabilities: parsed.capabilities }
            : {}),
        };
        broadcast(
          room,
          {
            type: "update_capabilities",
            peerId: targetPeer,
            shareEnabled: room.members[targetPeer].shareEnabled,
            capabilities: room.members[targetPeer].capabilities,
          },
          ws,
        );
        broadcast(room, { type: "room_peers", members: sortedMembers(room) });
      }
      return;
    }

    if (type === "signal" || type === "clock_pong" || type === "resolve_track" || type === "proxy_fallback_request") {
      const targetPeer = typeof parsed.toPeerId === "string" ? parsed.toPeerId : "";
      if (!targetPeer) return;
      for (const targetWs of getSocketsByPeerId(room, targetPeer)) {
        targetWs.sendJson({ ...parsed, fromPeerId: parsed.fromPeerId ?? senderPeerId });
      }
      return;
    }

    if (type === "resolve_result") {
      const targetPeer = (typeof parsed.toPeerId === "string" && parsed.toPeerId) || room.hostPeerId || "";
      if (!targetPeer) return;
      for (const targetWs of getSocketsByPeerId(room, targetPeer)) {
        targetWs.sendJson({ ...parsed, fromPeerId: parsed.fromPeerId ?? senderPeerId });
      }
      return;
    }

    if ((type === "clock_ping" || type === "control_request") && room.hostPeerId) {
      for (const hostWs of getSocketsByPeerId(room, room.hostPeerId)) {
        hostWs.sendJson({ ...parsed, fromPeerId: parsed.fromPeerId ?? senderPeerId });
      }
      return;
    }

    if (type === "track_ready") {
      broadcast(room, { ...parsed, fromPeerId: parsed.fromPeerId ?? senderPeerId }, ws);
      return;
    }

    if (type === "kick_full" && senderPeerId === room.hostPeerId && typeof parsed.peerId === "string") {
      for (const targetWs of getSocketsByPeerId(room, parsed.peerId)) {
        targetWs.sendJson({
          type: "error",
          code: "ROOM_FULL",
          message: `房间已满（最多 ${maxMembers} 人）`,
        });
        targetWs.close(4003, "Room full");
      }
    }
  }

  function handleSocketClosed(room, ws) {
    room.sockets.delete(ws);
    const peerId = ws.peerId;
    if (!peerId || !room.members[peerId]) {
      if (room.sockets.size === 0 && !room.graceTimer) {
        destroyRoom(room.roomCode);
      }
      return;
    }

    const remainingSamePeer = getSocketsByPeerId(room, peerId);
    if (remainingSamePeer.length > 0) return;

    if (peerId === room.hostPeerId) {
      if (room.graceTimer) clearTimeout(room.graceTimer);
      room.graceTimer = setTimeout(() => {
        room.graceTimer = null;
        if (!rooms.has(room.roomCode)) return;
        if (getSocketsByPeerId(room, room.hostPeerId).length > 0) return;
        broadcast(room, { type: "room_closed" });
        for (const sock of Array.from(room.sockets)) {
          sock.close(1000, "Host timeout");
        }
        destroyRoom(room.roomCode);
      }, hostGraceMs);
      room.graceTimer.unref?.();
      return;
    }

    delete room.members[peerId];
    broadcast(room, { type: "peer_left", peerId });
    broadcast(room, { type: "room_peers", members: sortedMembers(room) });
  }

  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (reqUrl.pathname === "/health") {
      let connections = 0;
      for (const room of rooms.values()) {
        connections += room.sockets.size;
      }
      const body = JSON.stringify({
        ok: true,
        service: "aria-signal-node",
        rooms: rooms.size,
        connections,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        ts: Date.now(),
      });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Aria-Signal": "1",
      });
      res.end(body);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  server.on("upgrade", (req, socket, head) => {
    const upgradeHeader = String(req.headers.upgrade ?? "").toLowerCase();
    const wsKey = String(req.headers["sec-websocket-key"] ?? "").trim();
    const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (reqUrl.pathname !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const roomCode = (reqUrl.searchParams.get("room") || "").trim().toUpperCase();
    const peerId = (reqUrl.searchParams.get("peer") || "").trim();
    const role = reqUrl.searchParams.get("role") === "host" ? "host" : "guest";
    if (!roomCode || roomCode.length > 32 || !peerId || upgradeHeader !== "websocket" || !wsKey) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const accept = crypto.createHash("sha1").update(wsKey + WS_GUID).digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n"),
    );

    const room = getOrCreateRoom(roomCode);
    const ws = new SimpleWebSocket(socket, {
      peerId,
      role,
      initialBuffer: head,
      onMessage: (text) => handleMessage(room, ws, text),
      onClose: (closedWs) => handleSocketClosed(room, closedWs),
    });
    room.sockets.add(ws);
  });

  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) {
      for (const ws of room.sockets) {
        ws.ping();
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  return {
    server,
    rooms,
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (err) => {
          server.off("listening", onListen);
          reject(err);
        };
        const onListen = () => {
          server.off("error", onError);
          const addr = server.address();
          resolve({
            host: typeof addr === "object" && addr ? addr.address : host,
            port: typeof addr === "object" && addr ? addr.port : port,
          });
        };
        server.once("error", onError);
        server.once("listening", onListen);
        server.listen(port, host);
      });
    },
    close() {
      clearInterval(heartbeat);
      for (const room of Array.from(rooms.values())) {
        if (room.graceTimer) {
          clearTimeout(room.graceTimer);
          room.graceTimer = null;
        }
        for (const ws of Array.from(room.sockets)) {
          ws.close(1001, "Server shutting down");
        }
      }
      rooms.clear();
      return new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

function parseCliArgs(argv) {
  let port = Number(process.env.PORT ?? DEFAULT_PORT);
  let host = String(process.env.HOST ?? DEFAULT_HOST);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port" || arg === "-p") {
      const next = Number(argv[i + 1]);
      if (Number.isFinite(next) && next > 0 && next <= 65535) port = Math.floor(next);
      i += 1;
    } else if (arg.startsWith("--port=")) {
      const next = Number(arg.slice("--port=".length));
      if (Number.isFinite(next) && next > 0 && next <= 65535) port = Math.floor(next);
    } else if (arg === "--host" || arg === "-H") {
      if (argv[i + 1]) host = argv[i + 1];
      i += 1;
    } else if (arg.startsWith("--host=")) {
      host = arg.slice("--host=".length) || host;
    }
  }
  return { port, host };
}

const isMainModule =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  const { port, host } = parseCliArgs(process.argv.slice(2));
  const app = createAriaSignalServer({ port, host });
  app
    .listen()
    .then((bound) => {
      console.log(`[aria-signal-node] Listening on http://${bound.host}:${bound.port}`);
      console.log(`[aria-signal-node] Health check: GET /health | WebSocket: /ws`);
    })
    .catch((err) => {
      console.error("[aria-signal-node] Failed to start:", err);
      process.exit(1);
    });

  const shutdown = () => {
    void app.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
