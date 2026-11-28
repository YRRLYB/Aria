import { getPrivateCloudPassword, normalizeRootPath, type StoredPrivateCloudInstance } from "../privateCloudStore";
import { buildWebdavBasicAuthHeader, buildWebdavRemoteUrl, fetchWebdavWithAuthStrip } from "./proxy";

export type WebdavEntry = {
  href: string;
  remotePath: string;
  name: string;
  isDir: boolean;
  size: number;
  etag: string;
};

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:resourcetype/>
    <D:getcontentlength/>
    <D:getetag/>
    <D:getlastmodified/>
  </D:prop>
</D:propfind>`;

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractTagValue(xml: string, localTag: string): string {
  const re = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?${localTag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_-]+:)?${localTag}>`, "i");
  const match = re.exec(xml);
  return match ? decodeXmlEntities(match[1].trim()) : "";
}

function extractHrefPath(rawHref: string, baseUrl: string): string {
  let pathname = rawHref.trim();
  if (/^https?:\/\//i.test(pathname)) {
    try {
      pathname = new URL(pathname).pathname;
    } catch {
      // keep raw path fallback
    }
  }
  const basePathname = new URL(baseUrl).pathname.replace(/\/+$/, "");
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname;
  }
  if (basePathname && basePathname !== "/" && decoded.startsWith(basePathname)) {
    decoded = decoded.slice(basePathname.length) || "/";
  }
  return decoded.startsWith("/") ? decoded : `/${decoded}`;
}

export function parsePropfindXml(xml: string, baseUrl: string, requestedPath: string): WebdavEntry[] {
  const normalizedReq = normalizeRootPath(requestedPath).replace(/\/+$/, "") || "/";
  const responseRegex = /<(?:[a-zA-Z0-9_-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_-]+:)?response>/gi;
  const entries: WebdavEntry[] = [];
  let match: RegExpExecArray | null;

  while ((match = responseRegex.exec(xml)) !== null) {
    const block = match[1];
    const href = extractTagValue(block, "href");
    if (!href) continue;

    const remotePathRaw = extractHrefPath(href, baseUrl);
    const trimmedPath = remotePathRaw.length > 1 ? remotePathRaw.replace(/\/+$/, "") : "/";
    // Skip the queried directory itself.
    if (trimmedPath === normalizedReq) continue;

    const resourceTypeBlock = extractTagValue(block, "resourcetype");
    const hasCollection = /<(?:[a-zA-Z0-9_-]+:)?collection\b/i.test(resourceTypeBlock) || /\/$/.test(remotePathRaw);
    const size = Number(extractTagValue(block, "getcontentlength")) || 0;
    const rawEtag = extractTagValue(block, "getetag").replace(/^"|"$/g, "");
    const lastMod = extractTagValue(block, "getlastmodified");
    const etag = rawEtag || `${size}:${lastMod}`;
    const name = trimmedPath.split("/").filter(Boolean).pop() || trimmedPath;

    entries.push({
      href,
      remotePath: trimmedPath,
      name,
      isDir: hasCollection,
      size,
      etag,
    });
  }

  return entries;
}

function getInstanceAuth(instance: StoredPrivateCloudInstance): string | null {
  const password = getPrivateCloudPassword(instance);
  return instance.username || password ? buildWebdavBasicAuthHeader(instance.username, password) : null;
}

export async function propfindDirectory(
  instance: StoredPrivateCloudInstance,
  remotePath: string,
  depth: 0 | 1 = 1,
  signal?: AbortSignal,
): Promise<WebdavEntry[]> {
  const authHeader = getInstanceAuth(instance);
  const url = buildWebdavRemoteUrl(instance.baseUrl, remotePath);
  const res = await fetchWebdavWithAuthStrip(url, authHeader, {
    method: "PROPFIND",
    headers: {
      Depth: String(depth),
      "Content-Type": "application/xml; charset=utf-8",
    },
    body: PROPFIND_BODY,
    signal,
  });
  if (!res.ok && res.status !== 207) {
    const errText = await res.text().catch(() => "");
    throw new Error(`WebDAV PROPFIND 失败 (${res.status})${errText ? `: ${errText.slice(0, 120)}` : ""}`);
  }
  const xml = await res.text();
  return parsePropfindXml(xml, instance.baseUrl, remotePath);
}

export async function testWebdavConnection(
  instance: StoredPrivateCloudInstance,
  signal?: AbortSignal,
): Promise<{ ok: boolean; latencyMs: number; reason?: string }> {
  const startedAt = Date.now();
  try {
    const authHeader = getInstanceAuth(instance);
    const url = buildWebdavRemoteUrl(instance.baseUrl, instance.rootPath || "/");
    const res = await fetchWebdavWithAuthStrip(url, authHeader, {
      method: "PROPFIND",
      headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
      body: PROPFIND_BODY,
      signal,
    });
    await res.body?.cancel();
    if (!res.ok && res.status !== 207) {
      return {
        ok: false,
        latencyMs: Math.max(1, Date.now() - startedAt),
        reason: res.status === 401 || res.status === 403 ? "WebDAV 账号或密码认证失败" : `服务端返回 HTTP ${res.status}`,
      };
    }
    return { ok: true, latencyMs: Math.max(1, Date.now() - startedAt) };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.max(1, Date.now() - startedAt),
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getWebdavFileText(
  instance: StoredPrivateCloudInstance,
  remotePath: string,
  signal?: AbortSignal,
): Promise<string> {
  const authHeader = getInstanceAuth(instance);
  const url = buildWebdavRemoteUrl(instance.baseUrl, remotePath);
  const res = await fetchWebdavWithAuthStrip(url, authHeader, { method: "GET", signal });
  if (!res.ok && res.status !== 206) {
    await res.body?.cancel();
    throw new Error(`读取 WebDAV 文件失败 (${res.status})`);
  }
  return res.text();
}

export async function putWebdavFileText(
  instance: StoredPrivateCloudInstance,
  remotePath: string,
  content: string,
  contentType = "application/json; charset=utf-8",
  signal?: AbortSignal,
): Promise<void> {
  const authHeader = getInstanceAuth(instance);
  const url = buildWebdavRemoteUrl(instance.baseUrl, remotePath);
  const res = await fetchWebdavWithAuthStrip(url, authHeader, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: content,
    signal,
  });
  await res.body?.cancel();
  if (!res.ok) {
    throw new Error(`上传至 WebDAV 失败 (${res.status})`);
  }
}
