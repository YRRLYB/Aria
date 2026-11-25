const YOUTUBE_STAGE_PARTITION = "aria-youtube-stage";
const DEFAULT_CONSENT_SOCS = "CAESEwgDEgk0ODE3Nzk3MjQaAmVuIAEaBgiA_LyaBg";
const SECURE_COOKIE_NAMES = new Set([
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "LOGIN_INFO",
  "SOCS",
  "SIDCC",
  "PREF",
]);

function isValidYoutubeVideoId(videoId) {
  return /^[A-Za-z0-9_-]{11}$/.test(String(videoId || ""));
}

function buildYoutubeStageWatchUrl(videoId) {
  if (!isValidYoutubeVideoId(videoId)) return null;
  return `https://www.youtube.com/watch?v=${videoId}&hl=zh-CN`;
}

function isAllowedYoutubeStageUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    if (parsed.hostname.toLowerCase() !== "www.youtube.com") return false;
    if (parsed.pathname !== "/watch") return false;
    return isValidYoutubeVideoId(parsed.searchParams.get("v"));
  } catch {
    return false;
  }
}

function isAllowedYoutubeStageNavigation(rawUrl) {
  if (isAllowedYoutubeStageUrl(rawUrl)) return true;
  if (typeof rawUrl !== "string" || !rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "https:" && parsed.hostname.toLowerCase() === "consent.youtube.com";
  } catch {
    return false;
  }
}

const YOUTUBE_AD_HOSTS = [
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "adservice.google.com",
];

const YOUTUBE_AD_PATH_RE = /(?:^|\/)(?:pagead|api\/stats\/ads|ptracking|get_midroll_info|youtubei\/v1\/ad)(?:\/|\?|$)/i;

function isBlockedYoutubeStageAdUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (YOUTUBE_AD_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
      return true;
    }
    if (host === "youtube.com" || host.endsWith(".youtube.com")) {
      return YOUTUBE_AD_PATH_RE.test(parsed.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

function parseYoutubeCookieHeader(cookieHeader, nowMs = Date.now()) {
  const byName = new Map();
  if (typeof cookieHeader === "string" && cookieHeader.trim()) {
    for (const part of cookieHeader.split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const name = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) continue;
      byName.set(name, value);
    }
  }
  if (!byName.has("SOCS")) {
    byName.set("SOCS", DEFAULT_CONSENT_SOCS);
  }
  const expirationDate = Math.floor(nowMs / 1000) + 60 * 60 * 24 * 30;
  const result = [];
  for (const [name, value] of byName.entries()) {
    const isHostPrefix = name.startsWith("__Host-");
    const isSecure = isHostPrefix || name.startsWith("__Secure-") || SECURE_COOKIE_NAMES.has(name);
    if (isHostPrefix) {
      result.push({
        url: "https://www.youtube.com",
        name,
        value,
        path: "/",
        secure: true,
        sameSite: "lax",
        expirationDate,
      });
    } else {
      result.push({
        url: "https://www.youtube.com",
        domain: ".youtube.com",
        name,
        value,
        path: "/",
        secure: isSecure,
        sameSite: isSecure ? "no_restriction" : "lax",
        expirationDate,
      });
    }
  }
  return result;
}

module.exports = {
  YOUTUBE_STAGE_PARTITION,
  DEFAULT_CONSENT_SOCS,
  isValidYoutubeVideoId,
  buildYoutubeStageWatchUrl,
  isAllowedYoutubeStageUrl,
  isAllowedYoutubeStageNavigation,
  isBlockedYoutubeStageAdUrl,
  parseYoutubeCookieHeader,
};
