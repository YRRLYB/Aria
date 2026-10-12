import { api } from "./api";

function isNeteaseArtworkSource(source: URL) {
  return ["http:", "https:"].includes(source.protocol) && !source.username && !source.password && !source.port &&
    ["music.126.net", "music.163.com"].some(
      (host) => source.hostname === host || source.hostname.endsWith(`.${host}`),
    );
}

// Keep NetEase artwork on Aria's persistent image cache, including raw URLs
// restored from older snapshots. Sizes share the same keys across surfaces.
export function cachedArtworkUrl(url: string | null | undefined, size = 320): string | undefined {
  if (!url) return undefined;
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

/** A bounded cache failure must not hide a working upstream cover or avatar. */
export function directArtworkUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const source = new URL(url, "http://aria.local");
    if (source.pathname === "/api/providers/netease/cover") {
      const upstream = source.searchParams.get("url");
      if (!upstream) return undefined;
      const original = new URL(upstream);
      if (!isNeteaseArtworkSource(original)) return undefined;
      original.protocol = "https:";
      return original.href;
    }
    if (!isNeteaseArtworkSource(source)) return url;
    source.protocol = "https:";
    return source.href;
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
    directArtworkUrl(fallbackUrl ?? url),
  ];
  return [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))];
}

export function sizedCoverUrl(url: string | undefined, size: 320 | 768): string | undefined {
  if (!url || !/\/api\/library\/tracks\/[^/?]+\/cover(?:\?|$)/.test(url)) return url;
  const [base, query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  params.set("size", String(size));
  return `${base}?${params}`;
}
