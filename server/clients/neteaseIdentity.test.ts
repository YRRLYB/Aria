import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readStore: vi.fn(),
  updateStore: vi.fn(),
  saveNeteaseCookie: vi.fn(),
}));

vi.mock("../store", () => ({
  readStore: mocks.readStore,
  updateStore: mocks.updateStore,
}));

import { invalidateNeteaseIdentity, normalizeRealIp, resolveNeteaseIdentity, withNeteaseIdentity } from "./neteaseIdentity";

describe("NetEase identity (460 / 环境异常 mitigation)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.ARIA_NETEASE_REAL_IP;
    invalidateNeteaseIdentity();
    mocks.readStore.mockResolvedValue({ neteaseCookie: null });
  });

  it("accepts valid IPv4 and IPv6 values", () => {
    expect(normalizeRealIp("116.25.146.177")).toBe("116.25.146.177");
    expect(normalizeRealIp(" 116.25.146.177 ")).toBe("116.25.146.177");
    expect(normalizeRealIp("2408:8207:1234::1")).toBe("2408:8207:1234::1");
  });

  it("rejects malformed or out-of-range values", () => {
    expect(normalizeRealIp("999.1.1.1")).toBeNull();
    expect(normalizeRealIp("116.25.146")).toBeNull();
    expect(normalizeRealIp("example.com")).toBeNull();
    expect(normalizeRealIp("")).toBeNull();
    expect(normalizeRealIp(undefined)).toBeNull();
    expect(normalizeRealIp(42)).toBeNull();
  });

  it("stays opt-in: no configured IP leaves requests untouched", async () => {
    const query = { id: "3452416343", level: "lossless", cookie: "" };
    expect(await withNeteaseIdentity(query)).toBe(query);
    expect(await resolveNeteaseIdentity()).toEqual({});
  });

  it("prefers the environment override over the stored value", async () => {
    mocks.readStore.mockResolvedValue({ neteaseRealIp: "1.2.3.4" });
    process.env.ARIA_NETEASE_REAL_IP = "116.25.146.177";
    expect(await withNeteaseIdentity({ id: "1" })).toEqual({ id: "1", realIP: "116.25.146.177" });
  });

  it("falls back to the stored value and adds realIP without mutating the input", async () => {
    mocks.readStore.mockResolvedValue({ neteaseRealIp: "116.25.146.177" });
    const query = { id: "1" };
    expect(await withNeteaseIdentity(query)).toEqual({ id: "1", realIP: "116.25.146.177" });
    expect(query).toEqual({ id: "1" });
  });

  it("ignores an invalid stored value instead of sending it upstream", async () => {
    mocks.readStore.mockResolvedValue({ neteaseRealIp: "not-an-ip" });
    expect(await resolveNeteaseIdentity()).toEqual({});
  });

  it("invalidates the cache so a new setting applies immediately", async () => {
    mocks.readStore.mockResolvedValue({ neteaseRealIp: "116.25.146.177" });
    expect(await resolveNeteaseIdentity()).toEqual({ realIP: "116.25.146.177" });
    mocks.readStore.mockResolvedValue({ neteaseRealIp: null });
    // Cached for 30s, so the stale value would still win without invalidation.
    expect(await resolveNeteaseIdentity()).toEqual({ realIP: "116.25.146.177" });
    invalidateNeteaseIdentity();
    expect(await resolveNeteaseIdentity()).toEqual({});
  });
});
