import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredPrivateCloudInstance } from "../privateCloudStore";
import { parsePropfindXml } from "./client";
import { webdavManifest } from "./manifest";
import { fetchWebdavWithAuthStrip } from "./proxy";
import { inferMetadataFromPath, probeWebdavAudioMetadata } from "./scanner";

const davInstance: StoredPrivateCloudInstance = {
  id: "dav-alist",
  kind: "webdav",
  name: "Alist Cloud",
  baseUrl: "https://nas.example.local:5244/dav",
  username: "admin",
  encryptedPassword: "password-secret",
  rootPath: "/Music",
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WebDAV client, Alist 302 auth-strip proxy & scanner", () => {
  it("parses PROPFIND XML directory responses and skips current collection", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/Music/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/Music/Artist%20A%20-%20Demo%20Track.flac</D:href>
    <D:propstat><D:prop><D:resourcetype/><D:getcontentlength>42100000</D:getcontentlength><D:getetag>"abc123"</D:getetag></D:prop></D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/Music/SubFolder/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat>
  </D:response>
</D:multistatus>`;

    const entries = parsePropfindXml(xml, davInstance.baseUrl, "/Music");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      remotePath: "/Music/Artist A - Demo Track.flac",
      name: "Artist A - Demo Track.flac",
      isDir: false,
      size: 42100000,
      etag: "abc123",
    });
    expect(entries[1]).toMatchObject({
      remotePath: "/Music/SubFolder",
      isDir: true,
    });
    expect(webdavManifest.capabilities.directShareable).toBe(false);
  });

  it("strips Authorization header after 302 redirect to CDN while keeping Range header", async () => {
    const seenHeaders: Array<{ url: string; auth?: string; range?: string }> = [];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seenHeaders.push({
        url: String(input),
        auth: headers.Authorization,
        range: headers.Range,
      });
      if (String(input).startsWith("https://nas.example.local")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.quark.example/audio.flac?sign=xyz" },
        });
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 206,
        headers: { "content-range": "bytes 0-2/100" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await fetchWebdavWithAuthStrip(
      "https://nas.example.local:5244/dav/Music/song.flac",
      "Basic YWRtaW46cGFzcw==",
      { headers: { Range: "bytes=0-131071" } },
    );

    expect(res.status).toBe(206);
    expect(seenHeaders).toHaveLength(2);
    expect(seenHeaders[0].auth).toBe("Basic YWRtaW46cGFzcw==");
    expect(seenHeaders[0].range).toBe("bytes=0-131071");
    expect(seenHeaders[1].url).toBe("https://cdn.quark.example/audio.flac?sign=xyz");
    expect(seenHeaders[1].auth).toBeUndefined();
    expect(seenHeaders[1].range).toBe("bytes=0-131071");
  });

  it("gracefully falls back to filename indexing and cancels body if upstream ignores Range (HTTP 200)", async () => {
    const cancelSpy = vi.fn(async () => undefined);
    const fakeResponse = {
      status: 200,
      ok: true,
      headers: new Headers(),
      body: { cancel: cancelSpy },
    } as unknown as Response;
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse));

    const meta = await probeWebdavAudioMetadata(davInstance, {
      href: "/dav/Music/Night/01. Singer - Midnight.flac",
      remotePath: "/Music/Night/01. Singer - Midnight.flac",
      name: "01. Singer - Midnight.flac",
      isDir: false,
      size: 50_000_000,
      etag: "e1",
    });

    expect(cancelSpy).toHaveBeenCalledOnce();
    expect(meta.title).toBe("Midnight");
    expect(meta.artist).toBe("Singer");
    expect(meta.album).toBe("Night");
    expect(inferMetadataFromPath("/Music/Jazz/Blue Note.wav").album).toBe("Jazz");
  });
});
