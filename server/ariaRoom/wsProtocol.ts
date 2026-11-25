import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import net from "node:net";
import tls from "node:tls";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const DEFAULT_MAX_FRAME_BYTES = 4 * 1024 * 1024;

export const DEFAULT_CLOUDFLARE_ANYCAST_IPS: readonly string[] = [
  "104.16.132.229",
  "104.16.133.229",
  "172.64.155.12",
  "162.159.138.6",
  "162.159.135.42",
  "104.21.48.12",
  "172.67.172.10",
  "104.18.26.200",
];

type DecodedFrame = {
  fin: boolean;
  opcode: number;
  payload: Buffer;
  bytesConsumed: number;
};

/**
 * Attempts to decode one RFC 6455 frame from `buffer`. Returns `null` when
 * more bytes are required, or throws an Error on protocol violation.
 */
export function tryDecodeWebSocketFrame(
  buffer: Buffer,
  maxPayloadBytes = DEFAULT_MAX_FRAME_BYTES,
): DecodedFrame | null {
  if (buffer.byteLength < 2) return null;
  const b0 = buffer[0];
  const b1 = buffer[1];
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let payloadLength = b1 & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.byteLength < offset + 2) return null;
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.byteLength < offset + 8) return null;
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    payloadLength = high * 0x1_0000_0000 + low;
    offset += 8;
  }

  if (payloadLength > maxPayloadBytes) {
    throw new Error(`WebSocket payload exceeds limit (${payloadLength} > ${maxPayloadBytes})`);
  }

  const maskLen = masked ? 4 : 0;
  if (buffer.byteLength < offset + maskLen + payloadLength) return null;

  let payload = buffer.subarray(offset + maskLen, offset + maskLen + payloadLength);
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4);
    const unmasked = Buffer.allocUnsafe(payloadLength);
    for (let i = 0; i < payloadLength; i += 1) {
      unmasked[i] = payload[i] ^ mask[i & 3];
    }
    payload = unmasked;
  } else {
    payload = Buffer.from(payload);
  }

  return {
    fin,
    opcode,
    payload,
    bytesConsumed: offset + maskLen + payloadLength,
  };
}

/**
 * Encodes one RFC 6455 frame. Browser/client frames set `mask = true`;
 * server-to-client frames set `mask = false`.
 */
export function encodeWebSocketFrame(
  opcode: number,
  payload: Buffer,
  options: { fin?: boolean; mask?: boolean } = {},
): Buffer {
  const fin = options.fin !== false;
  const mask = Boolean(options.mask);
  const length = payload.byteLength;

  let headerBytes = 2;
  if (length >= 126 && length <= 65535) headerBytes += 2;
  else if (length > 65535) headerBytes += 8;
  if (mask) headerBytes += 4;

  const frame = Buffer.allocUnsafe(headerBytes + length);
  frame[0] = (fin ? 0x80 : 0) | (opcode & 0x0f);

  let offset = 2;
  const maskBit = mask ? 0x80 : 0;
  if (length < 126) {
    frame[1] = maskBit | length;
  } else if (length <= 65535) {
    frame[1] = maskBit | 126;
    frame.writeUInt16BE(length, offset);
    offset += 2;
  } else {
    frame[1] = maskBit | 127;
    const high = Math.floor(length / 0x1_0000_0000);
    const low = length >>> 0;
    frame.writeUInt32BE(high, offset);
    frame.writeUInt32BE(low, offset + 4);
    offset += 8;
  }

  if (mask) {
    const maskKey = crypto.randomBytes(4);
    maskKey.copy(frame, offset);
    offset += 4;
    for (let i = 0; i < length; i += 1) {
      frame[offset + i] = payload[i] ^ maskKey[i & 3];
    }
  } else {
    payload.copy(frame, offset);
  }

  return frame;
}

export class AriaWebSocket extends EventEmitter {
  private readonly socket: net.Socket;
  private readonly isServer: boolean;
  private readonly maxPayloadBytes: number;
  private readBuffer: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentOpcode: number | null = null;
  private closed = false;
  private closeFrameSent = false;

  constructor(
    socket: net.Socket,
    options: { isServer: boolean; initialBuffer?: Buffer; maxPayloadBytes?: number },
  ) {
    super();
    this.socket = socket;
    this.isServer = options.isServer;
    this.maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_FRAME_BYTES;

    this.socket.setNoDelay(true);

    this.socket.on("data", (chunk: Buffer) => {
      this.handleData(chunk);
    });
    this.socket.on("error", (err) => {
      if (this.closed || this.closeFrameSent) return;
      if (this.listenerCount("error") > 0) {
        this.emit("error", err);
      }
    });
    this.socket.on("close", () => {
      this.finishClose(1006, "");
    });

    if (options.initialBuffer && options.initialBuffer.byteLength > 0) {
      queueMicrotask(() => {
        if (!this.closed) this.handleData(options.initialBuffer!);
      });
    }
  }

  get isOpen(): boolean {
    return !this.closed && !this.socket.destroyed && this.socket.writable;
  }

  get remoteAddress(): string {
    return this.socket.remoteAddress ?? "";
  }

  send(text: string): boolean {
    if (!this.isOpen) return false;
    return this.writeFrame(0x1, Buffer.from(text, "utf8"));
  }

  sendJson(payload: unknown): boolean {
    return this.send(JSON.stringify(payload));
  }

  ping(payload: Buffer = Buffer.alloc(0)): boolean {
    if (!this.isOpen) return false;
    return this.writeFrame(0x9, payload.subarray(0, 125));
  }

  close(code = 1000, reason = ""): void {
    if (this.closed) return;
    if (!this.closeFrameSent && !this.socket.destroyed && this.socket.writable) {
      this.closeFrameSent = true;
      const reasonBuf = Buffer.from(reason, "utf8").subarray(0, 120);
      const body = Buffer.allocUnsafe(2 + reasonBuf.byteLength);
      body.writeUInt16BE(code, 0);
      reasonBuf.copy(body, 2);
      try {
        this.writeFrame(0x8, body);
      } catch {
        // Ignore write error while tearing down.
      }
    }
    this.socket.end();
    setTimeout(() => {
      if (!this.socket.destroyed) this.socket.destroy();
    }, 300).unref?.();
    this.finishClose(code, reason);
  }

  private writeFrame(opcode: number, payload: Buffer): boolean {
    try {
      const frame = encodeWebSocketFrame(opcode, payload, { fin: true, mask: !this.isServer });
      this.socket.write(frame);
      return true;
    } catch {
      return false;
    }
  }

  private handleData(chunk: Buffer): void {
    if (this.closed || chunk.byteLength === 0) return;
    this.readBuffer = this.readBuffer.byteLength === 0 ? chunk : Buffer.concat([this.readBuffer, chunk]);

    try {
      while (!this.closed) {
        const frame = tryDecodeWebSocketFrame(this.readBuffer, this.maxPayloadBytes);
        if (!frame) break;
        this.readBuffer =
          frame.bytesConsumed >= this.readBuffer.byteLength
            ? Buffer.alloc(0)
            : this.readBuffer.subarray(frame.bytesConsumed);

        this.dispatchFrame(frame);
      }
    } catch (error) {
      if (this.listenerCount("error") > 0) this.emit("error", error);
      this.close(1009, "Frame error");
    }
  }

  private dispatchFrame(frame: DecodedFrame): void {
    switch (frame.opcode) {
      case 0x8: {
        const code = frame.payload.byteLength >= 2 ? frame.payload.readUInt16BE(0) : 1000;
        const reason = frame.payload.byteLength > 2 ? frame.payload.subarray(2).toString("utf8") : "";
        this.close(code, reason);
        return;
      }
      case 0x9: {
        if (this.isOpen) this.writeFrame(0xA, frame.payload);
        this.emit("ping", frame.payload);
        return;
      }
      case 0xA: {
        this.emit("pong", frame.payload);
        return;
      }
      case 0x1:
      case 0x2: {
        if (!frame.fin) {
          this.fragments = [frame.payload];
          this.fragmentOpcode = frame.opcode;
          return;
        }
        if (frame.opcode === 0x1) {
          this.emit("message", frame.payload.toString("utf8"));
        } else {
          this.emit("binary", frame.payload);
        }
        return;
      }
      case 0x0: {
        if (this.fragmentOpcode === null) {
          this.close(1002, "Unexpected continuation frame");
          return;
        }
        this.fragments.push(frame.payload);
        const total = this.fragments.reduce((sum, item) => sum + item.byteLength, 0);
        if (total > this.maxPayloadBytes) {
          this.close(1009, "Message too large");
          return;
        }
        if (frame.fin) {
          const combined = Buffer.concat(this.fragments, total);
          const opcode = this.fragmentOpcode;
          this.fragments = [];
          this.fragmentOpcode = null;
          if (opcode === 0x1) {
            this.emit("message", combined.toString("utf8"));
          } else {
            this.emit("binary", combined);
          }
        }
        return;
      }
      default:
        this.close(1003, "Unsupported opcode");
    }
  }

  private finishClose(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.readBuffer = Buffer.alloc(0);
    this.fragments = [];
    this.emit("close", code, reason);
  }
}

export function acceptWebSocketUpgrade(
  req: IncomingMessage,
  socket: net.Socket,
  head: Buffer,
): AriaWebSocket {
  const upgrade = String(req.headers.upgrade ?? "").toLowerCase();
  const key = String(req.headers["sec-websocket-key"] ?? "").trim();
  if (upgrade !== "websocket" || !key) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    throw new Error("Invalid WebSocket upgrade headers");
  }

  const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
  const lines = [
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    "",
  ];
  socket.write(lines.join("\r\n"));
  return new AriaWebSocket(socket, { isServer: true, initialBuffer: head });
}

export function normalizeWebSocketUrl(raw: string): URL {
  const trimmed = raw.trim();
  const url = new URL(trimmed);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`Unsupported WebSocket scheme: ${url.protocol}`);
  }
  return url;
}

export function stripIpBrackets(host: string): string {
  const trimmed = host.trim();
  return trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
}

export type ConnectWebSocketOptions = {
  preferredIp?: string | null;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

export async function connectWebSocket(
  urlString: string,
  options: ConnectWebSocketOptions = {},
): Promise<{ ws: AriaWebSocket; connectedIp: string | null; latencyMs: number }> {
  const url = normalizeWebSocketUrl(urlString);
  const isTls = url.protocol === "wss:";
  const port = Number(url.port || (isTls ? 443 : 80));
  const rawHostname = stripIpBrackets(url.hostname);
  const connectHost = options.preferredIp?.trim() ? stripIpBrackets(options.preferredIp) : rawHostname;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const startedAt = Date.now();
  const wsKey = crypto.randomBytes(16).toString("base64");
  const expectedAccept = crypto.createHash("sha1").update(wsKey + WS_GUID).digest("base64");
  const requestPath = `${url.pathname || "/"}${url.search || ""}`;

  return new Promise((resolve, reject) => {
    let settled = false;
    let headerBuffer = Buffer.alloc(0);

    const socket: net.Socket = isTls
      ? tls.connect({
          host: connectHost,
          port,
          servername: net.isIP(rawHostname) ? undefined : rawHostname,
          rejectUnauthorized: true,
          checkServerIdentity: net.isIP(rawHostname)
            ? undefined
            : (_host, cert) => tls.checkServerIdentity(rawHostname, cert),
        })
      : net.connect({ host: connectHost, port });

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const timer = setTimeout(() => {
      fail(new Error(`WebSocket connect timeout (${connectHost}:${port})`));
    }, timeoutMs);

    const onConnect = () => {
      const customHeaders = Object.entries(options.headers ?? {})
        .filter(([k]) => !/[\r\n]/.test(k))
        .map(([k, v]) => `${k}: ${String(v).replace(/[\r\n]/g, "")}`);

      const lines = [
        `GET ${requestPath} HTTP/1.1`,
        `Host: ${url.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${wsKey}`,
        "Sec-WebSocket-Version: 13",
        ...customHeaders,
        "",
        "",
      ];
      socket.write(lines.join("\r\n"));
    };

    const onData = (chunk: Buffer) => {
      if (settled) return;
      headerBuffer = headerBuffer.byteLength === 0 ? chunk : Buffer.concat([headerBuffer, chunk]);
      const headerEnd = headerBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        if (headerBuffer.byteLength > 32 * 1024) {
          fail(new Error("WebSocket handshake response headers too large"));
        }
        return;
      }

      const headerText = headerBuffer.subarray(0, headerEnd).toString("latin1");
      const leftover = headerBuffer.subarray(headerEnd + 4);
      const [statusLine, ...rawHeaderLines] = headerText.split("\r\n");
      if (!/^HTTP\/1\.[01]\s+101\b/i.test(statusLine ?? "")) {
        const statusMatch = /^HTTP\/1\.[01]\s+(\d{3})/.exec(statusLine ?? "");
        const code = statusMatch ? Number(statusMatch[1]) : 0;
        if (code === 404) {
          fail(new Error("信令服务返回 404：请确认已部署 Aria Cloudflare Worker，或切换为「房主直连」模式"));
        } else if (code === 403) {
          fail(new Error("信令节点返回 403 拒绝代理：请绑定自定义域名后使用优选 IP，或切换为「房主直连」"));
        } else {
          fail(new Error(`WebSocket 握手失败 (${statusLine || "无效响应"})`));
        }
        return;
      }

      const parsedHeaders = new Map<string, string>();
      for (const line of rawHeaderLines) {
        const sep = line.indexOf(":");
        if (sep > 0) {
          parsedHeaders.set(line.slice(0, sep).trim().toLowerCase(), line.slice(sep + 1).trim());
        }
      }

      if (parsedHeaders.get("sec-websocket-accept") !== expectedAccept) {
        fail(new Error("Invalid Sec-WebSocket-Accept from signaling server"));
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", fail);
      socket.off("close", onEarlyClose);

      const ws = new AriaWebSocket(socket, {
        isServer: false,
        initialBuffer: leftover,
      });
      resolve({
        ws,
        connectedIp: socket.remoteAddress ?? (options.preferredIp || null),
        latencyMs: Math.max(1, Date.now() - startedAt),
      });
    };

    const onEarlyClose = () => {
      fail(new Error("WebSocket closed before upgrade completed"));
    };

    socket.once(isTls ? "secureConnect" : "connect", onConnect);
    socket.on("data", onData);
    socket.once("error", fail);
    socket.once("close", onEarlyClose);
  });
}

export type CloudflareIpProbeResult = {
  ip: string | null;
  label: string;
  ok: boolean;
  latencyMs: number | null;
  statusCode?: number;
  error?: string;
};

export function isSelfHostedSignalingUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === "http:" || parsed.protocol === "ws:") return true;
    const host = stripIpBrackets(parsed.hostname).toLowerCase();
    return host === "localhost" || net.isIP(host) !== 0;
  } catch {
    return false;
  }
}

export async function probeSingleEndpoint(
  url: URL,
  ip: string | null,
  timeoutMs: number,
  customLabel?: string,
): Promise<CloudflareIpProbeResult> {
  const isTls = url.protocol === "wss:";
  const port = Number(url.port || (isTls ? 443 : 80));
  const rawHostname = stripIpBrackets(url.hostname);
  const targetHost = ip ? stripIpBrackets(ip) : rawHostname;
  const label = customLabel ?? (ip ? ip : "系统默认 DNS");
  const startedAt = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let buffer = Buffer.alloc(0);

    const socket: net.Socket = isTls
      ? tls.connect({
          host: targetHost,
          port,
          servername: net.isIP(rawHostname) ? undefined : rawHostname,
          rejectUnauthorized: true,
          checkServerIdentity: net.isIP(rawHostname)
            ? undefined
            : (_host, cert) => tls.checkServerIdentity(rawHostname, cert),
        })
      : net.connect({ host: targetHost, port });

    const done = (result: CloudflareIpProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    };

    const timer = setTimeout(() => {
      done({ ip, label, ok: false, latencyMs: null, error: "超时" });
    }, timeoutMs);

    socket.once(isTls ? "secureConnect" : "connect", () => {
      const reqLines = [
        "GET /health HTTP/1.1",
        `Host: ${url.host}`,
        "Connection: close",
        "User-Agent: Aria-Signal-Probe/1.0",
        "",
        "",
      ];
      socket.write(reqLines.join("\r\n"));
    });

    socket.on("data", (chunk: Buffer) => {
      buffer = buffer.byteLength === 0 ? chunk : Buffer.concat([buffer, chunk]);
      if (buffer.byteLength > 8192) {
        buffer = buffer.subarray(0, 8192);
      }
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const headerBlock = buffer.subarray(0, headerEnd).toString("latin1");
      const [statusLine, ...rawHeaders] = headerBlock.split("\r\n");
      const match = statusLine?.match(/^HTTP\/1\.[01]\s+(\d{3})/);
      if (!match) {
        done({ ip, label, ok: false, latencyMs: null, error: "无效响应" });
        return;
      }

      const statusCode = Number(match[1]);
      if (statusCode === 403) {
        done({
          ip,
          label,
          ok: false,
          latencyMs: null,
          statusCode,
          error: "节点拒绝代理 (403，请绑定自定义域名)",
        });
        return;
      }
      if (statusCode === 404) {
        done({
          ip,
          label,
          ok: false,
          latencyMs: null,
          statusCode,
          error: "未部署信令服务 (404)",
        });
        return;
      }
      if (statusCode !== 200) {
        done({
          ip,
          label,
          ok: false,
          latencyMs: null,
          statusCode,
          error: `HTTP ${statusCode}`,
        });
        return;
      }

      let hasSignalHeader = false;
      for (const hLine of rawHeaders) {
        const sep = hLine.indexOf(":");
        if (sep > 0) {
          const k = hLine.slice(0, sep).trim().toLowerCase();
          const v = hLine.slice(sep + 1).trim();
          if (k === "x-aria-signal" && v === "1") {
            hasSignalHeader = true;
            break;
          }
        }
      }
      const bodyText = buffer.subarray(headerEnd + 4, headerEnd + 4 + 4096).toString("utf8");
      if (hasSignalHeader || bodyText.includes("aria-signal-worker") || bodyText.includes("aria-signal-node")) {
        done({
          ip,
          label,
          ok: true,
          latencyMs: Math.max(1, Date.now() - startedAt),
          statusCode,
        });
      }
    });

    socket.once("error", (err) => {
      done({ ip, label, ok: false, latencyMs: null, error: err.message });
    });

    socket.once("close", () => {
      if (settled) return;
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd !== -1) {
        const statusLine = buffer.subarray(0, buffer.indexOf("\r\n")).toString("latin1");
        const match = statusLine.match(/^HTTP\/1\.[01]\s+(\d{3})/);
        const statusCode = match ? Number(match[1]) : 0;
        const bodyText = buffer.subarray(headerEnd + 4, headerEnd + 4 + 4096).toString("utf8");
        if (
          statusCode === 200 &&
          (bodyText.includes("aria-signal-worker") || bodyText.includes("aria-signal-node"))
        ) {
          done({
            ip,
            label,
            ok: true,
            latencyMs: Math.max(1, Date.now() - startedAt),
            statusCode,
          });
          return;
        }
        if (statusCode === 200) {
          done({ ip, label, ok: false, latencyMs: null, statusCode, error: "非 Aria 信令服务" });
          return;
        }
      }
      done({ ip, label, ok: false, latencyMs: null, error: "连接中断" });
    });
  });
}

export async function probeCloudflareIps(
  signalingUrl: string,
  extraIps: string[] = [],
  timeoutMs = 2_800,
): Promise<CloudflareIpProbeResult[]> {
  const url = normalizeWebSocketUrl(signalingUrl);
  const candidates: Array<string | null> = [null];
  const seen = new Set<string>();
  for (const raw of [...extraIps, ...DEFAULT_CLOUDFLARE_ANYCAST_IPS]) {
    const trimmed = raw.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    candidates.push(trimmed);
  }

  const results = await Promise.all(
    candidates.map((ip) => probeSingleEndpoint(url, ip, timeoutMs)),
  );

  return results.sort((a, b) => {
    if (a.ok && !b.ok) return -1;
    if (!a.ok && b.ok) return 1;
    if (a.ok && b.ok) return (a.latencyMs ?? 99999) - (b.latencyMs ?? 99999);
    return 0;
  });
}
