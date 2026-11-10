import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  store: { sources: {} } as Record<string, unknown>,
}));

vi.mock("../store", () => ({
  readStore: async () => state.store,
  updateStore: async (updater: (store: Record<string, unknown>) => Record<string, unknown>) => {
    state.store = await updater(state.store);
    return state.store;
  },
}));

import {
  getSource,
  listSourceManifests,
  listSourceStates,
  readSourceEnabledMap,
  resetSourceCircuit,
  setSourceEnabled,
} from "./registry";

describe("source registry switches", () => {
  beforeEach(() => {
    state.store = { sources: {} };
    resetSourceCircuit();
  });

  it("lists the built-in sources sorted by id", () => {
    expect(listSourceManifests().map((manifest) => manifest.id)).toEqual(["bilibili", "netease", "qq"]);
  });

  it("treats a source missing from the store as enabled", async () => {
    await expect(readSourceEnabledMap()).resolves.toEqual({ netease: true, qq: true, bilibili: true });
  });

  it("persists a disabled source and reports it everywhere", async () => {
    const states = await setSourceEnabled("qq", false);
    expect(states.find((state) => state.manifest.id === "qq")?.enabled).toBe(false);
    expect((state.store.sources as Record<string, { enabled?: boolean }>).qq).toEqual({ enabled: false });
    // Cache must have been invalidated, otherwise the UI would keep the old flag.
    await expect(readSourceEnabledMap()).resolves.toEqual({ netease: true, qq: false, bilibili: true });
  });

  it("keeps flags for other sources while toggling one", async () => {
    await setSourceEnabled("qq", false);
    await setSourceEnabled("netease", false);
    expect(state.store.sources).toEqual({ qq: { enabled: false }, netease: { enabled: false } });
    await setSourceEnabled("qq", true);
    expect(state.store.sources).toEqual({ qq: { enabled: true }, netease: { enabled: false } });
  });

  it("rejects an unknown source id", async () => {
    await expect(setSourceEnabled("youtube", false)).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("refuses to hand out a disabled source", async () => {
    await setSourceEnabled("netease", false);
    await expect(getSource("netease")).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("reports no circuit when nothing failed", async () => {
    const states = await listSourceStates();
    expect(states.map((state) => state.unavailableUntil)).toEqual([null, null, null]);
  });
});
