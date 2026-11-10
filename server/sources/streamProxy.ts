import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";
import { HttpError } from "../utils/httpError";

export type UpstreamStream = {
  url: string;
  /** Upstream request headers (Referer/User-Agent/Cookie); never sent to the renderer. */
  headers?: Record<string, string>;
  /** Override the upstream content type when a CDN serves octet-stream. */
  mimeType?: string | null;
  bitrate?: number | null;
  sampleRate?: number | null;
  currentLevel?: string | null;
  cacheMaxAgeSeconds?: number;
};

/** Upstream statuses that mean "this signed URL expired"; a fresh resolve may recover. */
const RETRYABLE_UPSTREAM_STATUS = new Set([403, 410]);

/**
 * Forward an audio stream with Range/206 passthrough (extracted from the
 * original NetEase stream route, same headers and response shape).
 *
 * `resolve` is called with the current attempt number: 0 for the first fetch
 * and 1 for a single retry after the upstream rejected an expiring signed URL
 * (QQ purl, Bilibili DASH, YouTube googlevideo). The original Range header is
 * kept for the retry so the player can continue seamlessly.
 */
export async function proxyAudioStream(
  req: Request,
  res: Response,
  resolve: (attempt: number) => Promise<UpstreamStream>,
): Promise<void> {
  let upstream: globalThis.Response | null = null;
  let meta: UpstreamStream | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    meta = await resolve(attempt);
    upstream = await fetch(meta.url, {
      headers: {
        ...(meta.headers ?? {}),
        ...(req.headers.range ? { Range: req.headers.range } : {}),
      },
    });
    if (upstream.ok || upstream.status === 206) break;
    if (!RETRYABLE_UPSTREAM_STATUS.has(upstream.status) || attempt === 1) break;
    await upstream.body?.cancel();
    upstream = null;
  }

  if (!upstream || !meta) {
    throw new HttpError(502, "Upstream audio request failed", "AUDIO_UPSTREAM_FAILED");
  }
  if (!upstream.ok && upstream.status !== 206) {
    await upstream.body?.cancel();
    throw new HttpError(502, "Upstream audio request failed", "AUDIO_UPSTREAM_FAILED");
  }

  res.status(upstream.status);
  if (meta.mimeType) {
    res.setHeader("content-type", meta.mimeType);
  } else {
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("content-type", contentType);
  }
  for (const header of ["content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(header);
    if (value) res.setHeader(header, value);
  }
  if (meta.bitrate) res.setHeader("x-aria-bitrate", String(meta.bitrate));
  if (meta.sampleRate) res.setHeader("x-aria-sample-rate", String(meta.sampleRate));
  if (meta.currentLevel) res.setHeader("x-aria-level", meta.currentLevel);
  res.setHeader("Cache-Control", `private, max-age=${meta.cacheMaxAgeSeconds ?? 600}`);

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  if (!upstream.body) {
    res.end();
    return;
  }
  try {
    await pipeline(Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream<Uint8Array>), res);
  } catch (error) {
    // Once headers are sent Express cannot turn this into a JSON error; doing
    // so only logs ERR_HTTP_HEADERS_SENT and can leave the renderer with a
    // half-open media request. Tear the response down instead.
    if (!res.headersSent) throw error;
    res.destroy(error instanceof Error ? error : undefined);
  }
}
