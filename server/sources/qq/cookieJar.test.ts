import { describe, expect, it } from "vitest";
import { CookieJar } from "./cookieJar";

function response(...setCookies: string[]) {
  const headers = new Headers();
  for (const value of setCookies) headers.append("set-cookie", value);
  return new Response("", { headers });
}

describe("CookieJar", () => {
  it("scopes host-only cookies to the host that set them", () => {
    const jar = new CookieJar();
    jar.store(response("qrsig=abc; Path=/"), "https://xui.ptlogin2.qq.com/ssl/ptqrshow");

    expect(jar.get("qrsig", "https://xui.ptlogin2.qq.com/ssl/ptqrlogin")).toBe("abc");
    expect(jar.header("https://xui.ptlogin2.qq.com/ssl/ptqrlogin")).toBe("qrsig=abc");
    // A different host must not receive the ptlogin cookie.
    expect(jar.header("https://graph.qq.com/oauth2.0/authorize")).toBe("");
  });

  it("keeps per-domain values for the same cookie name", () => {
    const jar = new CookieJar();
    jar.store(response("p_skey=; Domain=ptlogin2.qq.com; Path=/"), "https://xui.ptlogin2.qq.com/ssl/ptqrlogin");
    jar.store(response("p_skey=graphsecret; Domain=graph.qq.com; Path=/"), "https://graph.qq.com/oauth2.0/authorize");

    expect(jar.header("https://graph.qq.com/oauth2.0/authorize")).toBe("p_skey=graphsecret");
    // The empty ptlogin value is absent rather than shadowing the real one.
    expect(jar.get("p_skey", "https://graph.qq.com/oauth2.0/authorize")).toBe("graphsecret");
    expect(jar.get("p_skey", "https://xui.ptlogin2.qq.com/cgi-bin/xlogin")).toBe("");
  });

  it("lets a domain cookie match subdomains and drops expired entries", () => {
    const jar = new CookieJar();
    jar.store(response("uin=o0123; Domain=qq.com; Path=/"), "https://graph.qq.com/oauth2.0/authorize");
    jar.store(response("gone=1; Max-Age=0; Domain=qq.com; Path=/"), "https://graph.qq.com/oauth2.0/authorize");

    expect(jar.get("uin", "https://y.qq.com/")).toBe("o0123");
    expect(jar.get("uin", "https://u.y.qq.com/cgi-bin/musicu.fcg")).toBe("o0123");
    expect(jar.get("gone", "https://y.qq.com/")).toBe("");
  });

  it("prefers the most specific path and removes deleted cookies", () => {
    const jar = new CookieJar();
    jar.store(response("token=root; Path=/"), "https://y.qq.com/portal");
    jar.store(response("token=deep; Path=/music"), "https://y.qq.com/music/player");
    expect(jar.get("token", "https://y.qq.com/music/player")).toBe("deep");
    expect(jar.get("token", "https://y.qq.com/portal")).toBe("root");

    jar.store(response("token=; Max-Age=0; Path=/music"), "https://y.qq.com/music/player");
    expect(jar.get("token", "https://y.qq.com/music/player")).toBe("root");
    expect(jar.names()).toContain("token");
  });
});
