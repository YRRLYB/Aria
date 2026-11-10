import { api } from "./api";

function isNeteaseArtworkSource(source: URL) {
  return ["http:", "https:"].includes(source.protocol) && !source.username && !source.password && !source.port &&
    ["music.126.net", "music.163.com"].some(
      (host) => source.hostname === host || source.hostname.endsWith(`.${host}`),
    );
}

function isQqArtworkSource(source: URL) {
  return ["http:", "https:"].includes(source.protocol) && !source.username && !source.password && !source.port &&
    (source.hostname === "gtimg.cn" ||
      source.hostname.endsWith(".gtimg.cn") ||
      source.hostname === "qpic.y.qq.com");
}

function isBilibiliArtworkSource(source: URL) {
  return ["http:", "https:"].includes(source.protocol) && !source.username && !source.password && !source.port &&
    (source.hostname === "hdslb.com" || source.hostname.endsWith(".hdslb.com") ||
      source.hostname === "bilivideo.com" || source.hostname.endsWith(".bilivideo.com"));
}

// Keep NetEase artwork on Aria's persistent image cache, including raw URLs
// restored from older snapshots. Sizes share the same keys across surfaces.
export function cachedArtworkUrl(url: string | null | undefined, size = 320): string | undefined {
  if (!url) return undefined;
  try {
    const source = new URL(url);
    if (isQqArtworkSource(source)) {
      // QQ covers encode their size in the path (T002R300x300M000...);
      // rewrite it before handing the URL to the QQ cover cache.
      return api.getSourceCoverUrl("qq", applyQqCdnSize(source, size).href);
    }
    if (isBilibiliArtworkSource(source)) {
      return api.getSourceCoverUrl("bilibili", source.href);
    }
  } catch {
    return url;
  }
  let resolved = url;
  if (!/\/api\/providers\/netease\/cover(?:\?|$)/.test(url)) {
    try {
      const source = new URL(url);
      if (!isNeteaseArtworkSource(source)) return url;
      resolved = api.getNeteaseCoverUrl(url);
    } catch {
      return url;
    }
  }
  const [base, query = ""] = resolved.split("?");
  const params = new URLSearchParams(query);
  const pixels = Math.max(32, Math.min(1024, Math.round(size)));
  params.set("size", `${pixels}y${pixels}`);
  return `${base}?${params}`;
}

function applyNeteaseCdnSize(source: URL, size: number) {
  const pixels = Math.max(32, Math.min(1024, Math.round(size)));
  source.searchParams.set("param", `${pixels}y${pixels}`);
  return source;
}

function applyQqCdnSize(source: URL, size: number) {
  const pixels = Math.max(32, Math.min(1024, Math.round(size)));
  source.protocol = "https:";
  if (/T\d{3}R\d+x\d+M000/.test(source.pathname)) {
    source.pathname = source.pathname.replace(/T(\d{3})R\d+x\d+M000/, `T$1R${pixels}x${pixels}M000`);
  }
  return source;
}

/** A bounded cache failure must not hide a working upstream cover or avatar. */
export function directArtworkUrl(url: string | null | undefined, size = 320): string | undefined {
  if (!url) return undefined;
  try {
    const source = new URL(url, "http://aria.local");
    if (source.pathname === "/api/providers/netease/cover") {
      const upstream = source.searchParams.get("url");
      if (!upstream) return undefined;
      const original = new URL(upstream);
      if (!isNeteaseArtworkSource(original)) return undefined;
      original.protocol = "https:";
      return applyNeteaseCdnSize(original, size).href;
    }
    if (source.pathname === "/api/sources/qq/cover") {
      const upstream = source.searchParams.get("url");
      if (!upstream) return undefined;
      const original = new URL(upstream);
      if (!isQqArtworkSource(original)) return undefined;
      original.protocol = "https:";
      return applyQqCdnSize(original, size).href;
    }
    if (source.pathname === "/api/sources/bilibili/cover") {
      const upstream = source.searchParams.get("url");
      if (!upstream) return undefined;
      const original = new URL(upstream);
      if (!isBilibiliArtworkSource(original)) return undefined;
      original.protocol = "https:";
      return original.href;
    }
    if (isQqArtworkSource(source)) {
      source.protocol = "https:";
      return applyQqCdnSize(source, size).href;
    }
    if (isBilibiliArtworkSource(source)) {
      source.protocol = "https:";
      return source.href;
    }
    if (!isNeteaseArtworkSource(source)) return url;
    source.protocol = "https:";
    return applyNeteaseCdnSize(source, size).href;
  } catch {
    return undefined;
  }
}

export function artworkImageCandidates(
  url: string | null | undefined,
  fallbackUrl?: string | null,
  size = 320,
): string[] {
  const candidates = [
    cachedArtworkUrl(url, size),
    fallbackUrl ? cachedArtworkUrl(fallbackUrl, size) : undefined,
    directArtworkUrl(fallbackUrl ?? url, size),
  ];
  return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))];
}

export function sizedCoverUrl(url: string | undefined, size: number): string | undefined {
  if (!url || !/\/api\/library\/tracks\/[^/?]+\/cover(?:\?|$)/.test(url)) return url;
  const [base, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  params.set("size", String(size));
  return `${base}?${params}`;
}
