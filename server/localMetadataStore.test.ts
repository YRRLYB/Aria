import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalMetadataStore } from "./localMetadataStore";
import type { LocalMetadataOverride } from "../src/lib/localMetadata";

const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "aria-local-metadata-"));
  directories.push(directory);
  return { store: new LocalMetadataStore(directory), directory };
}
const metadata = (id: string): LocalMetadataOverride => ({ candidateId: `netease:${id}`, title: `Title ${id}`, coverUrl: `https://p1.music.126.net/${id}.jpg`, lyrics: [{ time: "00:01", text: id }], updatedAt: id });
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });

describe("persistent metadata undo", () => {
  it("survives a restart and restores a prior match and lyric binding", async () => {
    const { store, directory } = await fixture();
    await store.apply({ a: metadata("1") }, {});
    const undoId = await store.apply({ a: metadata("2") }, { a: "netease:1" });
    const restarted = new LocalMetadataStore(directory);
    expect((await restarted.read()).overrides.a).toEqual(metadata("2"));
    expect((await restarted.undo(undoId))?.restored.a.previousBinding).toBe("netease:1");
    expect((await restarted.read()).overrides.a).toEqual(metadata("1"));
  });
  it("does not overwrite a later correction while undoing an older batch", async () => {
    const { store } = await fixture();
    const first = await store.apply({ a: metadata("1"), b: metadata("1") }, {});
    await store.apply({ a: metadata("2") }, { a: "netease:1" });
    const undone = await store.undo(first);
    expect(undone?.skipped).toEqual(["a"]);
    expect(Object.keys(undone?.restored ?? {})).toEqual(["b"]);
    expect((await store.read()).overrides.a).toEqual(metadata("2"));
    expect((await store.read()).overrides.b).toBeUndefined();
  });
  it("serializes concurrent edits and preserves independent tracks", async () => {
    const { store } = await fixture();
    await Promise.all([store.apply({ a: metadata("1") }, {}), store.apply({ b: metadata("2") }, {})]);
    expect(Object.keys((await store.read()).overrides).sort()).toEqual(["a", "b"]);
  });
});
