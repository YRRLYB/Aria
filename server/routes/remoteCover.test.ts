import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { get, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteCoverCache } from "../remoteCoverCache";
import { createRemoteCoverRouter } from "./remoteCover";

const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0xff, 0xd9]);
const query = "?url=" + encodeURIComponent("https://p1.music.126.net/example.jpg") + "&size=320y320";
const resources: Array<{ server: Server; directory: string }> = [];

async function fixture(fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes, { headers: { "Content-Type": "image/jpg" } }))) {
  const directory = await mkdtemp(path.join(tmpdir(), ".aria-cover-route-"));
  const cache = new RemoteCoverCache({ directory: path.join(directory, ".cache", "covers"), fetcher });
  const app = express();
  app.use("/cover", createRemoteCoverRouter(cache));
  app.use((error: { status?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? 500).json({ error: error.message });
  });
  const server = await new Promise<Server>((resolve) => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  resources.push({ server, directory });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  return { url: `http://127.0.0.1:${address.port}/cover${query}`, fetcher };
}

afterEach(async () => {
  await Promise.all(resources.splice(0).map(async ({ server, directory }) => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }));
});

describe("cached artwork HTTP responses", () => {
  it("serves JPEG aliases from hidden cache directories and reuses the bytes", async () => {
    const { url, fetcher } = await fixture();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/jpeg");
      expect(response.headers.get("content-length")).toBe(String(bytes.length));
      expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("responds to conditional requests and HEAD without losing cache headers", async () => {
    const { url, fetcher } = await fixture();
    const first = await fetch(url);
    const etag = first.headers.get("etag")!;
    await first.arrayBuffer();
    // Node fetch adds Cache-Control:no-cache to conditional requests by
    // default; use a plain request to model Chromium's cache revalidation.
    const conditional = await new Promise<{ status: number | undefined; etag: string | undefined; body: string }>((resolve, reject) => {
      get(url, { headers: { "If-None-Match": etag } }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { body += chunk; });
        response.on("end", () => resolve({ status: response.statusCode, etag: response.headers.etag, body }));
      }).on("error", reject);
    });
    expect(conditional.status).toBe(304);
    expect(conditional.body).toBe("");
    expect(conditional.etag).toBe(etag);
    const head = await fetch(url, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("image/jpeg");
    expect(head.headers.get("content-length")).toBe(String(bytes.length));
    expect(await head.text()).toBe("");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns upstream errors as JSON with no image cache headers", async () => {
    const { url } = await fixture(vi.fn<typeof fetch>().mockResolvedValue(new Response("failed", { status: 503 })));
    const response = await fetch(url);
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBeNull();
    expect(await response.json()).toHaveProperty("error");
  });
});
