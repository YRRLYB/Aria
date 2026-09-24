import { describe, expect, it } from "vitest";
import {
  extractRequestToken,
  generateRemoteToken,
  loopbackAddress,
  matchesRemoteToken,
} from "./remoteAccess";

describe("remote access", () => {
  it("mints URL-safe tokens", () => {
    const token = generateRemoteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(token).not.toEqual(generateRemoteToken());
  });
  it("recognizes loopback callers in every spelling Node produces", () => {
    expect(loopbackAddress("127.0.0.1")).toBe(true);
    expect(loopbackAddress("::1")).toBe(true);
    expect(loopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(loopbackAddress("192.168.1.20")).toBe(false);
    expect(loopbackAddress("::ffff:192.168.1.20")).toBe(false);
    expect(loopbackAddress(undefined)).toBe(false);
  });
  it("reads the token from a bearer header or the query string", () => {
    expect(extractRequestToken({ authorization: "Bearer abc" }, undefined)).toBe("abc");
    expect(extractRequestToken({}, "xyz")).toBe("xyz");
    expect(extractRequestToken({}, ["a", "b"])).toBe("");
    expect(extractRequestToken({}, undefined)).toBe("");
  });
  it("compares tokens without leaking length or timing hints", () => {
    expect(matchesRemoteToken("secret", "secret")).toBe(true);
    expect(matchesRemoteToken("secret", "other!")).toBe(false);
    expect(matchesRemoteToken("secret", "")).toBe(false);
    expect(matchesRemoteToken("", "secret")).toBe(false);
  });
});
