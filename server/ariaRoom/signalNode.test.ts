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

        const hbPongPromise = waitForJsonMessage(guestWs, (m) => m.type === "pong");
        const clientSendTs = Date.now();
        guestWs.sendJson({ type: "ping", ts: clientSendTs, t0: clientSendTs });
        const hbPong = await hbPongPromise;
        expect(hbPong.t0).toBe(clientSendTs);
        expect(typeof hbPong.t1).toBe("number");
        expect(typeof hbPong.t2).toBe("number");
        expect(typeof hbPong.serverTs).toBe("number");
        expect(Number(hbPong.t2)).toBeGreaterThanOrEqual(Number(hbPong.t1));
      } finally {
        hostWs.close();
        guestWs.close();
      }
    } finally {
      await nodeServer.close();
    }
  });

  it("enforces custom code hijack protection, same-host rejoin restore, offline presence, presence_update, kick_member & private notice", async () => {
    const nodeServer = createAriaSignalServer({ host: "127.0.0.1", port: 0, hostGraceMs: 2_000 });
    const bound = await nodeServer.listen();
    const port = bound.port;

    try {
      const { ws: hostWs } = await connectWebSocket(
        `ws://127.0.0.1:${port}/ws?room=MY_ROOM-99&peer=host-owner&role=host`,
      );
      const { ws: guest1Ws } = await connectWebSocket(
        `ws://127.0.0.1:${port}/ws?room=MY_ROOM-99&peer=guest-1&role=guest`,
      );
      const { ws: guest2Ws } = await connectWebSocket(
        `ws://127.0.0.1:${port}/ws?room=MY_ROOM-99&peer=guest-2&role=guest`,
      );

      try {
        const hostPeersPromise = waitForJsonMessage(hostWs, (m) => m.type === "room_peers");
        hostWs.sendJson({
          type: "hello",
          role: "host",
          member: { peerId: "host-owner", nickname: "Owner", avatarUrl: null, role: "host", joinedAt: 1000 },
          state: {
            controlMode: "collaborative",
            playback: { nonce: "warm_trk", track: { id: "netease:1", title: "Saved" }, queue: [], playing: true, positionSec: 25, serverSeq: 3 },
          },
        });
        await hostPeersPromise;

        const g1StateP = waitForJsonMessage(guest1Ws, (m) => m.type === "state_update");
        guest1Ws.sendJson({
          type: "hello",
          role: "guest",
          member: { peerId: "guest-1", nickname: "G1", avatarUrl: null, role: "guest", joinedAt: 2000 },
        });
        await g1StateP;

        const g2StateP = waitForJsonMessage(guest2Ws, (m) => m.type === "state_update");
        guest2Ws.sendJson({
          type: "hello",
          role: "guest",
          member: { peerId: "guest-2", nickname: "G2", avatarUrl: null, role: "guest", joinedAt: 3000 },
        });
        await g2StateP;

        // 1. Custom room code hijack rejection for a different host peer
        const { ws: hijackWs } = await connectWebSocket(
          `ws://127.0.0.1:${port}/ws?room=MY_ROOM-99&peer=thief-host&role=host`,
        );
        const hijackErrPromise = waitForJsonMessage(hijackWs, (m) => m.type === "error");
        hijackWs.sendJson({
          type: "hello",
          role: "host",
          member: { peerId: "thief-host", nickname: "Thief", avatarUrl: null, role: "host", joinedAt: 4000 },
        });
        const hijackErr = await hijackErrPromise;
        expect(hijackErr.code).toBe("ROOM_CODE_TAKEN");
        hijackWs.close();

        // 2. Private notice targets only guest-1, not guest-2
        const g1NoticeP = waitForJsonMessage(guest1Ws, (m) => m.type === "notice");
        let g2GotPrivateNotice = false;
        const g2Listener = (raw: string) => {
          const m = JSON.parse(raw) as Record<string, unknown>;
          if (m.type === "notice") g2GotPrivateNotice = true;
        };
        guest2Ws.on("message", g2Listener);
        hostWs.sendJson({ type: "notice", toPeerId: "guest-1", message: "private-only" });
        const g1Notice = await g1NoticeP;
        expect(g1Notice.message).toBe("private-only");
        await new Promise((r) => setTimeout(r, 40));
        guest2Ws.off("message", g2Listener);
        expect(g2GotPrivateNotice).toBe(false);

        // 3. presence_update broadcasts away status
        const awayPeersP = waitForJsonMessage(
          hostWs,
          (m) =>
            m.type === "room_peers" &&
            Array.isArray(m.members) &&
            (m.members as Array<{ peerId: string; presence?: string }>).some(
              (x) => x.peerId === "guest-1" && x.presence === "away",
            ),
        );
        guest1Ws.sendJson({ type: "presence_update", presence: "away" });
        await awayPeersP;

        // 4. Unexpected socket disconnect preserves member as offline instead of deleting
        const offlinePeersP = waitForJsonMessage(
          hostWs,
          (m) =>
            m.type === "room_peers" &&
            Array.isArray(m.members) &&
            (m.members as Array<{ peerId: string; online?: boolean; presence?: string }>).some(
              (x) => x.peerId === "guest-1" && x.online === false && x.presence === "offline",
            ),
        );
        guest1Ws.close();
        await offlinePeersP;

        // 5. Same-host rejoin restores cachedState back to host
        hostWs.close();
        const { ws: hostRejoinWs } = await connectWebSocket(
          `ws://127.0.0.1:${port}/ws?room=MY_ROOM-99&peer=host-owner&role=host`,
        );
        try {
          const restoredStateP = waitForJsonMessage(hostRejoinWs, (m) => m.type === "state_update");
          hostRejoinWs.sendJson({
            type: "hello",
            role: "host",
            rejoin: true,
            member: { peerId: "host-owner", nickname: "Owner", avatarUrl: null, role: "host", joinedAt: 1000 },
            state: { controlMode: "collaborative", playback: { nonce: null, track: null, queue: [] } },
          });
          const restoredState = await restoredStateP;
          expect((restoredState.state as { playback: { nonce: string } }).playback.nonce).toBe("warm_trk");

          // 6. Host kicks guest-2
          const kickedErrP = waitForJsonMessage(guest2Ws, (m) => m.type === "error");
          const peerLeftP = waitForJsonMessage(hostRejoinWs, (m) => m.type === "peer_left" && m.peerId === "guest-2");
          hostRejoinWs.sendJson({ type: "kick_member", peerId: "guest-2" });
          const kickedErr = await kickedErrP;
          expect(kickedErr.code).toBe("KICKED_BY_HOST");
          await peerLeftP;
        } finally {
          hostRejoinWs.close();
        }
      } finally {
        hostWs.close();
        guest1Ws.close();
        guest2Ws.close();
      }
    } finally {
      await nodeServer.close();
    }
  });
});
