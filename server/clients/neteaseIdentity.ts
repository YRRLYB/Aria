import { isIP } from "node:net";
import { readStore } from "../store";

/**
 * NetEase can reject a session with "环境异常" / code 460 for several reasons,
 * including device identity and network risk checks. The upstream library's
 * realIP option forwards a user-configured address; it is not a guaranteed
 * fix for provider-side restrictions.
 *
 * Aria therefore lets the user pin one mainland IP. It stays opt-in: with no
 * configured value every request is byte-identical to the anonymous home
 * network case, which is what the vast majority of installs need.
 */
export const NETEASE_REAL_IP_ENV = "ARIA_NETEASE_REAL_IP";
export const NETEASE_REAL_IP_STORE_KEY = "neteaseRealIp";

const identityCacheTtl = 30_000;
let identityCache: { value: NeteaseIdentity; expiresAt: number } | null = null;

export type NeteaseIdentity = {
  /** Only present when the user pinned one; never guessed. */
  realIP?: string;
};

/** Accepts IPv4/IPv6 without network access; empty strings disable the override. */
export function normalizeRealIp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return isIP(trimmed) ? trimmed : null;
}

export async function resolveNeteaseIdentity(): Promise<NeteaseIdentity> {
  const cached = identityCache;
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const fromEnv = normalizeRealIp(process.env[NETEASE_REAL_IP_ENV]);
  let realIP = fromEnv;
  if (!realIP) {
    const store = await readStore().catch(() => null);
    realIP = normalizeRealIp((store as Record<string, unknown> | null)?.[NETEASE_REAL_IP_STORE_KEY]);
  }
  const value: NeteaseIdentity = realIP ? { realIP } : {};
  identityCache = { value, expiresAt: Date.now() + identityCacheTtl };
  return value;
}

/** Drops the cache after the setting changes so the next call sees it. */
export function invalidateNeteaseIdentity() {
  identityCache = null;
}

/**
 * Merges the configured identity into a NeteaseCloudMusicApi query object.
 * Without a configured IP this returns the input untouched, which keeps the
 * anonymous behaviour (and its tests) unchanged.
 */
export async function withNeteaseIdentity<T extends Record<string, unknown>>(query: T): Promise<T> {
  const identity = await resolveNeteaseIdentity();
  if (!identity.realIP) return query;
  return { ...query, realIP: identity.realIP };
}

export async function withNeteaseIdentitySync<T extends Record<string, unknown>>(query: T): Promise<T> {
  return withNeteaseIdentity(query);
}
