import { describe, expect, it } from "vitest";
// @ts-expect-error Standalone zero-dependency ESM module without ambient .d.ts
import { createAriaSignalServer } from "../../deploy/aria-signal-node/server.mjs";
import { connectWebSocket, probeSingleEndpoint, normalizeWebSocketUrl } from "./wsProtocol";

function waitForJsonMessage(
  ws: Awaited<ReturnType<typeof connectWebSocket>>["ws"],
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs = 3_000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error("Timed out waiting for signaling message"));
    }, timeoutMs);

    const onMessage = (raw: string) => {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (predicate(parsed)) {
          clearTimeout(timer);
          ws.off("message", onMessage);
          resolve(parsed);
        }
      } catch {
        // ignore non-json
      }
    };

    ws.on("message", onMessage);
  });
}

describe("aria-signal-node standalone relay", () => {
  it("serves /health, probes cleanly, and relays hello/state_update/playback_sync/control_request/clock_ping", async () => {
    const nodeServer = createAriaSignalServer({ host: "127.0.0.1", port: 0 });
    const bound = await nodeServer.listen();
    const baseUrl = `http://127.0.0.1:${bound.port}`;

    try {
      const healthRes = await fetch(`${baseUrl}/health`);
      expect(healthRes.status).toBe(200);
      expect(healthRes.headers.get("x-aria-signal")).toBe("1");
      const healthJson = (await healthRes.json()) as { ok: boolean; service: string };
      expect(healthJson.ok).toBe(true);
      expect(healthJson.service).toBe("aria-signal-node");

      const probe = await probeSingleEndpoint(
        normalizeWebSocketUrl(baseUrl),
        null,
        2_000,
        "自建节点直连",
      );
      expect(probe.ok).toBe(true);
      expect(probe.statusCode).toBe(200);

      const { ws: hostWs } = await connectWebSocket(
        `ws://127.0.0.1:${bound.port}/ws?room=NODE88&peer=host-1&role=host`,
      );
      const { ws: guestWs } = await connectWebSocket(
        `ws://127.0.0.1:${bound.port}/ws?room=NODE88&peer=guest-1&role=guest`,
      );

      try {
        const hostPeersPromise = waitForJsonMessage(hostWs, (m) => m.type === "room_peers");
        hostWs.sendJson({
          type: "hello",
          role: "host",
          member: {
            peerId: "host-1",
            nickname: "Host",
            avatarUrl: null,
            role: "host",
            joinedAt: 1000,
          },
          state: {
            controlMode: "collaborative",
            playback: {
              nonce: "trk_1",
              playing: false,
              positionSec: 12,
              updatedAtMs: 1000,
              serverSeq: 1,
              queue: [],
            },
          },
        });
        const hostPeers = await hostPeersPromise;
        expect(Array.isArray(hostPeers.members)).toBe(true);

        const guestStatePromise = waitForJsonMessage(guestWs, (m) => m.type === "state_update");
        guestWs.sendJson({
          type: "hello",
          role: "guest",
          member: {
            peerId: "guest-1",
            nickname: "Guest",
            avatarUrl: null,
            role: "guest",
            joinedAt: 2000,
          },
        });
        const guestState = await guestStatePromise;
        expect((guestState.state as { playback: { nonce: string } }).playback.nonce).toBe("trk_1");

        const guestSyncPromise = waitForJsonMessage(guestWs, (m) => m.type === "playback_sync");
        hostWs.sendJson({
          type: "playback_sync",
          event: {
            seq: 2,
            kind: "play_at",
            nonce: "trk_1",
            positionSec: 14,
            startAtHostMs: 5000,
            serverTimeMs: 4800,
          },
        });
        const syncMsg = await guestSyncPromise;
        expect((syncMsg.event as { kind: string }).kind).toBe("play_at");

        const hostControlPromise = waitForJsonMessage(hostWs, (m) => m.type === "control_request");
        guestWs.sendJson({
          type: "control_request",
          action: "toggle_play",
          payload: { playing: false, positionSec: 15 },
        });
        const ctrlMsg = await hostControlPromise;
        expect(ctrlMsg.action).toBe("toggle_play");
        expect(ctrlMsg.fromPeerId).toBe("guest-1");

        const hostClockPromise = waitForJsonMessage(hostWs, (m) => m.type === "clock_ping");
        guestWs.sendJson({
          type: "clock_ping",
          pingId: "p1",
          t0: 100,
        });
        const clockPing = await hostClockPromise;
        expect(clockPing.fromPeerId).toBe("guest-1");

        const guestPongPromise = waitForJsonMessage(guestWs, (m) => m.type === "clock_pong");
        hostWs.sendJson({
          type: "clock_pong",
          toPeerId: "guest-1",
          pingId: "p1",
          t0: 100,
          t1: 110,
          t2: 111,
        });
        const clockPong = await guestPongPromise;
        expect(clockPong.t1).toBe(110);
      } finally {
        hostWs.close();
        guestWs.close();
      }
    } finally {
      await nodeServer.close();
    }
  });
});
