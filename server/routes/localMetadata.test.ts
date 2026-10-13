import express from "express";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readLibrary: vi.fn(), search: vi.fn(), resolve: vi.fn(), apply: vi.fn(), undo: vi.fn(), readStore: vi.fn(), updateStore: vi.fn(),
}));
vi.mock("../libraryStore", () => ({ readLibrary: mocks.readLibrary }));
vi.mock("../lyrics", () => ({ searchLyricCandidates: mocks.search, resolveLyricLines: mocks.resolve }));
vi.mock("../localMetadataStore", () => ({ localMetadataStore: { apply: mocks.apply, undo: mocks.undo } }));
vi.mock("../store", () => ({ readStore: mocks.readStore, updateStore: mocks.updateStore }));
import { createLocalMetadataRouter } from "./localMetadata";

const servers: Server[] = [];
let bindings: Record<string, string>;
async function fixture() {
  const app = express();
  app.use(express.json());
  app.use("/metadata", createLocalMetadataRouter());
  app.use((error: { status?: number; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status ?? 500).json({ error: error.message }));
  const server = await new Promise<Server>((resolve) => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  const url = `http://127.0.0.1:${address.port}/metadata`;
  return { post: (route: string, body: unknown) => fetch(url + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) };
}
beforeEach(() => {
  vi.clearAllMocks();
  bindings = { a: "netease:old" };
  mocks.readLibrary.mockResolvedValue({ tracks: [{ id: "a", title: "Moon", artist: "Alice", album: "Night", hasCover: true }], roots: [], updatedAt: null });
  mocks.search.mockResolvedValue([{ id: "netease:1", title: "Unrelated", artist: "Other", album: "No", score: 99, preview: [] }, { id: "netease:2", title: "Moon", artist: "Alice", album: "Night", coverUrl: "https://p1.music.126.net/cover.jpg", score: 72, preview: ["hello"] }]);
  mocks.resolve.mockResolvedValue([{ time: "00:01", text: "hello" }]);
  mocks.apply.mockResolvedValue("undo-1");
  mocks.readStore.mockImplementation(async () => ({ lyricBindings: bindings, neteaseCookie: null }));
  mocks.updateStore.mockImplementation(async (update) => { const next = update({ lyricBindings: bindings, neteaseCookie: null }); bindings = next.lyricBindings; return next; });
});
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

describe("local metadata preview and application", () => {
  it("re-ranks actual tags and isolates one failed search", async () => {
    mocks.readLibrary.mockResolvedValue({ tracks: [{ id: "a", title: "Moon", artist: "Alice", album: "Night" }, { id: "b", title: "Bad", artist: "Alice", album: "Night" }] });
    mocks.search.mockRejectedValueOnce(new Error("network"));
    const { post } = await fixture();
    const response = await post("/preview", { trackIds: ["a", "b"] });
    const result = await response.json();
    expect(result.rows[0].error).toBeDefined();
    expect(result.rows[1].candidates[0].id).toBe("netease:2");
    expect(result.rows[1].candidates[0].confidence).not.toBe("high");
  });
  it("protects existing artwork and lyrics unless replacement is requested", async () => {
    const { post } = await fixture();
    const preview = await (await post("/preview", { trackIds: ["a"] })).json();
    expect(preview.rows[0].candidates[0].id).toBe("netease:2");
    expect(preview.rows[0].candidates[0].score).toBe(100);
    const response = await post("/apply", { previewId: preview.previewId, entries: [{ trackId: "a", candidateId: "netease:2", hasLyrics: true, hasArtwork: true }], options: { info: true, artwork: true, lyrics: true, replaceExisting: false } });
    expect(response.status).toBe(200);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.apply.mock.calls[0][0].a).toMatchObject({ title: "Moon", candidateId: "netease:2" });
    expect(mocks.apply.mock.calls[0][0].a.coverUrl).toBeUndefined();
    expect(mocks.apply.mock.calls[0][0].a.lyrics).toBeUndefined();
    expect(bindings.a).toBe("netease:old");
  });
  it("applies an explicitly reviewed candidate and binds fetched lyrics", async () => {
    const { post } = await fixture();
    const preview = await (await post("/preview", { trackIds: ["a"] })).json();
    const response = await post("/apply", { previewId: preview.previewId, entries: [{ trackId: "a", candidateId: "netease:2" }], options: { info: true, artwork: true, lyrics: true, replaceExisting: true } });
    expect(response.status).toBe(200);
    expect(mocks.apply.mock.calls[0][0].a.coverUrl).toContain("cover.jpg");
    expect(mocks.apply.mock.calls[0][0].a.lyrics).toHaveLength(1);
    expect(bindings.a).toBe("netease:2");
    const bad = await post("/apply", { previewId: preview.previewId, entries: [{ trackId: "a", candidateId: "netease:unseen" }], options: { info: true, artwork: true, lyrics: true, replaceExisting: true } });
    expect((await bad.json()).failed).toHaveLength(1);
    expect(mocks.apply).toHaveBeenCalledTimes(1);
  });
  it("restores the original lyric binding while preserving later manual changes", async () => {
    const { post } = await fixture();
    mocks.undo.mockResolvedValue({ restored: { a: { previousBinding: "netease:original", appliedBinding: "netease:old" }, b: { previousBinding: "netease:previous", appliedBinding: "netease:batch" } }, skipped: [] });
    bindings.b = "netease:manual";
    const response = await post("/undo", { undoId: "undo-1" });
    expect(response.status).toBe(200);
    expect((await response.json()).restoredLyrics).toEqual(["a"]);
    expect(bindings).toEqual({ a: "netease:original", b: "netease:manual" });
  });
});
