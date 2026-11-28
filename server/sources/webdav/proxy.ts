import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request, Response } from "express";
import { HttpError } from "../../utils/httpError";
import { getPrivateCloudPassword, type StoredPrivateCloudInstance } from "../privateCloudStore";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

export function buildWebdavBasicAuthHeader(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

export function buildWebdavRemoteUrl(baseUrl: string, remotePath: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = remotePath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return cleanPath ? `${normalizedBase}/${cleanPath}` : `${normalizedBase}/`;
}

/**
 * Resolves Alist/OpenList/NAS WebDAV URLs with manual redirect handling.
 * Whenever a server returns 302/307 to an external cloud CDN link, the
 * `Authorization` header is strictly stripped so credentials are never leaked
 * and cloud CDNs do not reject with 400/403.
 */
export async function fetchWebdavWithAuthStrip(
  targetUrl: string,
  authHeader: string | null,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  } = {},
): Promise<globalThis.Response> {
  let currentUrl = targetUrl;
  let sendAuth = Boolean(authHeader);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const reqHeaders: Record<string, string> = {
      "User-Agent": "Aria/0.9.0",
      ...(options.headers ?? {}),
    };
    if (sendAuth && authHeader) {
      reqHeaders.Authorization = authHeader;
    } else {
      delete reqHeaders.Authorization;
      delete reqHeaders.authorization;
    }

    const res = await fetch(currentUrl, {
      method: hop === 0 ? options.method ?? "GET" : "GET",
      headers: reqHeaders,
      body: hop === 0 ? options.body : undefined,
      redirect: "manual",
      signal: options.signal,
    });

    if (!REDIRECT_STATUSES.has(res.status)) {
      return res;
    }

    const location = res.headers.get("location");
    await res.body?.cancel();
    if (!location || hop === MAX_REDIRECTS) {
      return res;
    }

    currentUrl = new URL(location, currentUrl).toString();
    // Critical Alist/OpenList rule: strip Authorization on redirect hops.
    sendAuth = false;
  }

  throw new HttpError(502, "WebDAV 重定向次数过多", "WEBDAV_REDIRECT_LOOP");
}

function guessMimeFromRemotePath(remotePath: string): string {
  const lower = remotePath.toLowerCase();
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a") || lower.endsWith(".aac") || lower.endsWith(".alac")) return "audio/mp4";
  if (lower.endsWith(".opus") || lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".ape")) return "audio/ape";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

export async function proxyWebdavStream(
  req: Request,
  res: Response,
  instance: StoredPrivateCloudInstance,
  remotePath: string,
): Promise<void> {
  const controller = new AbortController();
  const abortUpstream = () => {
    if (!res.writableEnded) controller.abort();
  };
  req.once("aborted", abortUpstream);
  res.once("close", abortUpstream);

  try {
    const password = getPrivateCloudPassword(instance);
    const authHeader = instance.username || password ? buildWebdavBasicAuthHeader(instance.username, password) : null;
    const targetUrl = buildWebdavRemoteUrl(instance.baseUrl, remotePath);
    const upstream = await fetchWebdavWithAuthStrip(targetUrl, authHeader, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: {
        ...(req.headers.range ? { Range: req.headers.range } : {}),
      },
      signal: controller.signal,
    });

    if (!upstream.ok && upstream.status !== 206) {
      await upstream.body?.cancel();
      throw new HttpError(
        upstream.status === 401 || upstream.status === 403 ? upstream.status : 502,
        `WebDAV 媒体拉流失败 (${upstream.status})`,
        "WEBDAV_UPSTREAM_FAILED",
      );
    }

    res.status(upstream.status);
    const upstreamType = upstream.headers.get("content-type");
    res.setHeader(
      "content-type",
      upstreamType && upstreamType !== "application/octet-stream" ? upstreamType : guessMimeFromRemotePath(remotePath),
    );
    for (const header of ["content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader("Cache-Control", "private, max-age=300");

    if (req.method === "HEAD" || !upstream.body) {
      res.end();
      await upstream.body?.cancel();
      return;
    }
    await pipeline(Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream<Uint8Array>), res);
  } catch (error) {
    if (controller.signal.aborted) return;
    if (!res.headersSent) throw error;
    res.destroy(error instanceof Error ? error : undefined);
  } finally {
    req.removeListener("aborted", abortUpstream);
    res.removeListener("close", abortUpstream);
  }
}
