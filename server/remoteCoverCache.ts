import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { pruneDiskCache } from "./utils/diskCache";
import { HttpError } from "./utils/httpError";

type CachedCover = {
  contentType: string;
  byteLength: number;
  etag: string;
  filePath?: string;
  body?: Buffer;
};

type RemoteCoverCacheOptions = {
  directory: string;
  fetcher?: typeof fetch;
  maxAssetBytes?: number;
  maxCacheBytes?: number;
  maxFiles?: number;
};

const rasterContentType = /^image\/(?:jpeg|png|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|tiff)$/i;

function canonicalRasterContentType(value: string | null | undefined) {
  const contentType = value?.split(";", 1)[0].trim().toLowerCase();
  // NetEase's image CDN returns image/jpg for both covers and avatars. Browsers
  // decode it normally, so the cache must accept it and send the standard MIME.
  const aliases: Record<string, string> = {
    "image/jpg": "image/jpeg",
    "image/pjpeg": "image/jpeg",
    "image/x-png": "image/png",
    "image/x-ms-bmp": "image/bmp",
  };
  const normalized = contentType ? aliases[contentType] ?? contentType : undefined;
  return normalized && rasterContentType.test(normalized) ? normalized : undefined;
}

/** Restrict the image proxy to the CDN, including every redirect destination. */
function validateCoverUrl(value: string) {
  const target = new URL(value);
  if (
    !["http:", "https:"].includes(target.protocol) || target.username || target.password || target.port ||
    !["music.126.net", "music.163.com"].some((host) => target.hostname === host || target.hostname.endsWith(`.${host}`))
  ) {
    throw new HttpError(400, "Unsupported cover host", "NETEASE_COVER_HOST_UNSUPPORTED");
  }
  target.hash = "";
  return target;
}

export function normalizeRemoteCoverUrl(value: string, size?: string) {
  const target = validateCoverUrl(value);
  const match = size?.match(/^(\d{2,4})[xy](\d{2,4})$/);
  const width = match ? Math.min(1024, Math.max(64, Number(match[1]))) : 800;
  const height = match ? Math.min(1024, Math.max(64, Number(match[2]))) : 800;
  target.searchParams.set("param", `${width}y${height}`);
  return target.href;
}

class FetchLimiter {
  private active = 0;
  private waiting: Array<() => void> = [];

  async run<T>(work: () => Promise<T>) {
    if (this.active >= 4) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active += 1;
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }
}

/** Persistent sized CDN artwork; binary data is never retained in a memory cache. */
export class RemoteCoverCache {
  private readonly fetcher: typeof fetch;
  private readonly maxAssetBytes: number;
  private readonly pending = new Map<string, Promise<CachedCover>>();
  private readonly limiter = new FetchLimiter();

  constructor(private readonly options: RemoteCoverCacheOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.maxAssetBytes = options.maxAssetBytes ?? 8 * 1024 * 1024;
  }

  prune() {
    return pruneDiskCache(this.options.directory, {
      maxBytes: this.options.maxCacheBytes ?? 256 * 1024 * 1024,
      maxFiles: this.options.maxFiles ?? 800,
    });
  }

  read(url: string, size?: string): Promise<CachedCover> {
    const upstreamUrl = normalizeRemoteCoverUrl(url, size);
    const existing = this.pending.get(upstreamUrl);
    if (existing) return existing;
    const request = this.load(upstreamUrl);
    this.pending.set(upstreamUrl, request);
    void request.then(
      () => this.pending.delete(upstreamUrl),
      () => this.pending.delete(upstreamUrl),
    );
    return request;
  }

  private async load(upstreamUrl: string): Promise<CachedCover> {
    // Keep the existing cache key format so previously downloaded covers survive upgrades.
    const key = createHash("sha1").update(upstreamUrl).digest("hex");
    const filePath = path.join(this.options.directory, `${key}.img`);
    const metaPath = path.join(this.options.directory, `${key}.json`);
    try {
      const [rawMeta, details] = await Promise.all([readFile(metaPath, "utf8"), stat(filePath)]);
      const meta = JSON.parse(rawMeta) as { contentType?: string; byteLength?: number; etag?: string };
      const contentType = canonicalRasterContentType(meta.contentType);
      if (
        details.isFile() && details.size > 0 && details.size <= this.maxAssetBytes &&
        contentType &&
        (meta.byteLength === undefined || meta.byteLength === details.size)
      ) {
        // Update at most hourly; pruning then keeps frequently used covers on disk.
        if (Date.now() - details.mtimeMs > 60 * 60_000) void utimes(filePath, new Date(), new Date()).catch(() => undefined);
        const etag = meta.etag && /^"[a-f0-9]{40,64}"$/.test(meta.etag) ? meta.etag : `"${key}"`;
        return { filePath, contentType, byteLength: details.size, etag };
      }
    } catch {
      // Missing, truncated or interrupted cache entries are replaced by a complete response.
    }

    return this.limiter.run(async () => {
      let upstream: Response;
      try {
        upstream = await this.fetchImage(upstreamUrl);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(502, "Cover request failed", "NETEASE_COVER_UPSTREAM_FAILED");
      }
      const contentType = canonicalRasterContentType(upstream.headers.get("content-type"));
      if (!upstream.ok || !contentType) {
        await upstream.body?.cancel();
        throw new HttpError(502, "Cover request failed", "NETEASE_COVER_UPSTREAM_FAILED");
      }
      if (Number(upstream.headers.get("content-length") || 0) > this.maxAssetBytes) {
        await upstream.body?.cancel();
        throw new HttpError(502, "Cover response is too large", "NETEASE_COVER_TOO_LARGE");
      }
      let body: Buffer;
      try {
        body = await readBoundedBody(upstream, this.maxAssetBytes);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(502, "Cover request failed", "NETEASE_COVER_UPSTREAM_FAILED");
      }
      if (!body.byteLength) throw new HttpError(502, "Cover response is empty", "NETEASE_COVER_UPSTREAM_FAILED");
      const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
      const cover = { contentType, byteLength: body.byteLength, etag };
      const temporaryImage = `${filePath}.${randomUUID()}.tmp`;
      const temporaryMeta = `${metaPath}.${randomUUID()}.tmp`;
      try {
        await mkdir(this.options.directory, { recursive: true });
        await Promise.all([
          writeFile(temporaryImage, body),
          writeFile(temporaryMeta, JSON.stringify(cover), "utf8"),
        ]);
        await rename(temporaryImage, filePath);
        await rename(temporaryMeta, metaPath);
        void this.prune();
        return { ...cover, filePath };
      } catch {
        // Disk pressure or read-only storage must not prevent displaying the image.
        return { ...cover, body };
      } finally {
        await Promise.all([unlink(temporaryImage).catch(() => undefined), unlink(temporaryMeta).catch(() => undefined)]);
      }
    });
  }

  private async fetchImage(url: string) {
    let target = validateCoverUrl(url);
    const signal = AbortSignal.timeout(12_000);
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const response = await this.fetcher(target.href, { redirect: "manual", signal });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || redirects === 3) break;
      target = validateCoverUrl(new URL(location, target).href);
    }
    throw new HttpError(502, "Cover redirect failed", "NETEASE_COVER_UPSTREAM_FAILED");
  }
}

async function readBoundedBody(response: Response, maxBytes: number) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HttpError(502, "Cover response is too large", "NETEASE_COVER_TOO_LARGE");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}
