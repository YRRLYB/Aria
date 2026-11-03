/**
 * Minimal, domain-aware cookie jar for the QQ login chain.
 *
 * A flat `Map<name, value>` is not enough here: ptlogin sets cookies such as
 * `p_skey` for several hosts (and sometimes an EMPTY `p_skey=;` next to
 * `p_skey_forbid`), and `graph.qq.com` only honours the value that belongs to
 * its own domain. Collapsing everything into one header both hides the real
 * `p_skey` and leaks cookies to hosts that never asked for them, which makes
 * `oauth2.0/authorize` answer with the consent page (`oauth2.0/show`) instead
 * of redirecting back with a `code`.
 */

export type StoredCookie = {
  name: string;
  value: string;
  /** Lower-cased cookie domain without a leading dot. */
  domain: string;
  path: string;
  /** True when the cookie was set without a Domain attribute. */
  hostOnly: boolean;
  expiresAt: number;
};

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;

function requestHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

function requestPath(url: string): string {
  try {
    const path = new URL(url).pathname;
    return path.startsWith("/") ? path : `/${path}`;
  } catch {
    return "/";
  }
}

function defaultCookiePath(url: string): string {
  const path = requestPath(url);
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function domainMatches(host: string, cookie: StoredCookie): boolean {
  if (!host) return false;
  if (cookie.hostOnly) return host === cookie.domain;
  return host === cookie.domain || host.endsWith(`.${cookie.domain}`);
}

function pathMatches(target: string, cookiePath: string): boolean {
  if (target === cookiePath) return true;
  if (!target.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || target.charAt(cookiePath.length) === "/";
}

/** Attribute parsing for a single `Set-Cookie` header value. */
function parseSetCookie(header: string, url: string) {
  const segments = header.split(";");
  const pair = segments.shift() ?? "";
  const separator = pair.indexOf("=");
  if (separator <= 0) return null;
  const name = pair.slice(0, separator).trim();
  if (!name) return null;
  const value = pair.slice(separator + 1).trim();

  let domain = "";
  let path = "";
  let expiresAt = Date.now() + TEN_YEARS_MS;
  for (const segment of segments) {
    const index = segment.indexOf("=");
    const key = (index === -1 ? segment : segment.slice(0, index)).trim().toLowerCase();
    const attribute = index === -1 ? "" : segment.slice(index + 1).trim();
    if (key === "domain") domain = attribute.replace(/^\./, "").toLowerCase();
    else if (key === "path") path = attribute;
    else if (key === "max-age") {
      const seconds = Number(attribute);
      if (Number.isFinite(seconds)) expiresAt = Date.now() + seconds * 1000;
    } else if (key === "expires") {
      const parsed = Date.parse(attribute);
      if (!Number.isNaN(parsed)) expiresAt = parsed;
    }
  }

  const host = requestHost(url);
  const hostOnly = !domain;
  return {
    name,
    value,
    domain: domain || host,
    path: path && path.startsWith("/") ? path : defaultCookiePath(url),
    hostOnly,
    expiresAt,
  };
}

export class CookieJar {
  private cookies: StoredCookie[] = [];

  /** Store every `Set-Cookie` of a response, honouring Domain/Path/expiry. */
  store(response: Response, url: string) {
    const lines =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : response.headers.get("set-cookie")
          ? [response.headers.get("set-cookie") as string]
          : [];
    for (const line of lines) {
      const parsed = parseSetCookie(line, url);
      if (!parsed) continue;
      const index = this.cookies.findIndex(
        (cookie) => cookie.name === parsed.name && cookie.domain === parsed.domain && cookie.path === parsed.path,
      );
      // An expired cookie is a deletion.
      if (parsed.expiresAt <= Date.now()) {
        if (index >= 0) this.cookies.splice(index, 1);
        continue;
      }
      if (index >= 0) this.cookies[index] = parsed;
      else this.cookies.push(parsed);
    }
  }

  /** Cookie header for a request URL: matching host/path only, most specific first. */
  header(url: string): string {
    const host = requestHost(url);
    const path = requestPath(url);
    const now = Date.now();
    const matching = this.cookies
      .filter((cookie) => cookie.expiresAt > now && domainMatches(host, cookie) && pathMatches(path, cookie.path))
      // Longer paths win; within the same path, later entries were set last.
      .sort((left, right) => right.path.length - left.path.length)
      .map((cookie) => `${cookie.name}=${cookie.value}`);
    const seen = new Set<string>();
    const pairs: string[] = [];
    for (const pair of matching) {
      const name = pair.slice(0, pair.indexOf("="));
      if (seen.has(name)) continue;
      seen.add(name);
      pairs.push(pair);
    }
    return pairs.join("; ");
  }

  /**
   * Value of a cookie as the given URL would see it. Empty values count as
   * absent: ptlogin writes `p_skey=;` for hosts that are not allowed to sign.
   */
  get(name: string, url?: string): string {
    const host = url ? requestHost(url) : "";
    const path = url ? requestPath(url) : "/";
    const now = Date.now();
    const candidates = this.cookies
      .filter((cookie) => {
        if (cookie.name !== name || cookie.expiresAt <= now) return false;
        if (!url) return true;
        return domainMatches(host, cookie) && pathMatches(path, cookie.path);
      })
      .sort((left, right) => right.path.length - left.path.length);
    for (const cookie of candidates) {
      if (cookie.value.trim()) return cookie.value.trim();
    }
    return "";
  }

  has(name: string, url?: string): boolean {
    return Boolean(this.get(name, url));
  }

  names(): string[] {
    return [...new Set(this.cookies.map((cookie) => cookie.name))].sort();
  }

  /** Every non-empty cookie value, unscoped: used to seed a pasted header. */
  entries(): StoredCookie[] {
    return this.cookies.filter((cookie) => cookie.value.trim());
  }
}
