import http from "node:http";
import type net from "node:net";
import { describe, expect, it } from "vitest";
import {
  acceptWebSocketUpgrade,
  connectWebSocket,
  encodeWebSocketFrame,
  probeCloudflareIps,
  stripIpBrackets,
  tryDecodeWebSocketFrame,
} from "./wsProtocol";

describe("wsProtocol", () => {
  it("encodes and decodes short, extended (126-len), masked, and partial frames", () => {
    const small = Buffer.from("aria-sync", "utf8");
    const smallFrame = encodeWebSocketFrame(0x1, small, { fin: true, mask: true });
    expect(tryDecodeWebSocketFrame(smallFrame.subarray(0, 3))).toBeNull();
    const decodedSmall = tryDecodeWebSocketFrame(smallFrame);
    expect(decodedSmall).not.toBeNull();
    expect(decodedSmall!.opcode).toBe(0x1);
    expect(decodedSmall!.payload.toString("utf8")).toBe("aria-sync");

    const medium = Buffer.alloc(300, 0x41);
    const mediumFrame = encodeWebSocketFrame(0x2, medium, { fin: true, mask: false });
    const decodedMedium = tryDecodeWebSocketFrame(mediumFrame);
    expect(decodedMedium).not.toBeNull();
    expect(decodedMedium!.opcode).toBe(0x2);
    expect(decodedMedium!.payload.equals(medium)).toBe(true);
  });

  it("strips brackets from IPv6 literals for raw socket connections", () => {
    expect(stripIpBrackets("[240e::1]")).toBe("240e::1");
    expect(stripIpBrackets("[::1]")).toBe("::1");
    expect(stripIpBrackets("104.16.132.229")).toBe("104.16.132.229");
  });

  it("completes RFC 6455 handshake and exchanges messages over loopback TCP", async () => {
    const server = http.createServer();
    server.on("upgrade", (req, socket, head) => {
      const ws = acceptWebSocketUpgrade(req, socket as net.Socket, head);
      ws.on("message", (text: string) => {
        ws.send(`echo:${text}`);
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address() as net.AddressInfo;

    try {
      const { ws } = await connectWebSocket(`ws://127.0.0.1:${addr.port}/ws`);
      const reply = await new Promise<string>((resolve) => {
        ws.once("message", (msg: string) => resolve(msg));
        ws.send("hello-aria");
      });
      expect(reply).toBe("echo:hello-aria");
      ws.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects 403/404 responses and validates worker /health probe strictly", async () => {
    let mode: "ok" | "404" | "403" = "ok";
    const server = http.createServer((_req, res) => {
      if (mode === "404") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
        return;
      }
      if (mode === "403") {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("error code: 1003");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json", "x-aria-signal": "1" });
      res.end(JSON.stringify({ ok: true, service: "aria-signal-worker" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address() as net.AddressInfo;

    try {
      const okResults = await probeCloudflareIps(`http://127.0.0.1:${addr.port}`, [], 800);
      expect(okResults.find((r) => r.ip === null)?.ok).toBe(true);

      mode = "404";
      const notFoundResults = await probeCloudflareIps(`http://127.0.0.1:${addr.port}`, [], 800);
      expect(notFoundResults.find((r) => r.ip === null)?.ok).toBe(false);
      expect(notFoundResults.find((r) => r.ip === null)?.error).toContain("404");

      mode = "403";
      const forbiddenResults = await probeCloudflareIps(`http://127.0.0.1:${addr.port}`, [], 800);
      expect(forbiddenResults.find((r) => r.ip === null)?.ok).toBe(false);
      expect(forbiddenResults.find((r) => r.ip === null)?.error).toContain("403");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
