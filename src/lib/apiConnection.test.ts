import { beforeEach, describe, expect, it } from "vitest";
import { apiUrl, getApiConnection, setApiConnection } from "./api";

// Node environment: no window/localStorage — the connection layer must stay
// importable for pure-logic tests and persist nothing when storage is absent.

describe("api connection layer", () => {
  beforeEach(() => {
    setApiConnection(null);
  });

  it("keeps relative URLs when no remote server is configured", () => {
    expect(apiUrl("/api/health")).toBe("/api/health");
    expect(getApiConnection()).toEqual({ serverUrl: "", token: "" });
  });

  it("normalizes server URLs and prefixes relative paths", () => {
    setApiConnection({ serverUrl: "http://192.168.1.29:3636/" });
    expect(apiUrl("/api/health")).toBe("http://192.168.1.29:3636/api/health");
    setApiConnection({ serverUrl: "192.168.1.29:3636" });
    expect(getApiConnection().serverUrl).toBe("http://192.168.1.29:3636");
  });

  it("appends the pairing token to http(s) URLs only once", () => {
    setApiConnection({ serverUrl: "http://192.168.1.29:3636", token: "tok/en+" });
    expect(apiUrl("/api/library")).toBe("http://192.168.1.29:3636/api/library?token=tok%2Fen%2B");
    expect(apiUrl("/api/library/tracks/x/cover?size=320"))
      .toBe("http://192.168.1.29:3636/api/library/tracks/x/cover?size=320&token=tok%2Fen%2B");
    expect(apiUrl("/api/library?token=other")).toBe("http://192.168.1.29:3636/api/library?token=other");
  });

  it("leaves data: URLs and absolute cross-origin URLs untouched apart from tokenning http(s)", () => {
    setApiConnection({ token: "tok" });
    expect(apiUrl("data:image/png;base64,aaa")).toBe("data:image/png;base64,aaa");
    expect(apiUrl("https://cdn.example.com/song.flac")).toBe("https://cdn.example.com/song.flac?token=tok");
  });

  it("clearing the connection restores relative URLs", () => {
    setApiConnection({ serverUrl: "http://192.168.1.29:3636", token: "tok" });
    setApiConnection(null);
    expect(apiUrl("/api/health")).toBe("/api/health");
  });
});
