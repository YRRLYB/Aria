import { describe, expect, it } from "vitest";
import updaterModule from "./updater.cjs";

const {
  friendlyUpdateError,
  buildUpdaterProxyCandidates,
  compareSemver,
  isRetriableNetworkError,
  toElectronProxyRules,
} = updaterModule;

describe("desktop updater helpers", () => {
  it("builds ordered proxy fallback routes (system -> local proxy -> direct)", () => {
    expect(toElectronProxyRules("http://127.0.0.1:7890")).toBe("http=127.0.0.1:7890;https=127.0.0.1:7890");
    expect(toElectronProxyRules("socks5://127.0.0.1:10808")).toBe("socks5://127.0.0.1:10808");
    expect(toElectronProxyRules("not a url")).toBe("");

    const withLocal = buildUpdaterProxyCandidates("http://127.0.0.1:7890");
    expect(withLocal.map((r) => r.id)).toEqual(["system", "local-proxy", "direct"]);
    expect(withLocal[1]?.config).toEqual({
      mode: "fixed_servers",
      proxyRules: "http=127.0.0.1:7890;https=127.0.0.1:7890",
    });

    const withoutLocal = buildUpdaterProxyCandidates("");
    expect(withoutLocal.map((r) => r.id)).toEqual(["system", "direct"]);
  });

  it("classifies retriable network failures and formats friendly Chinese messages", () => {
    expect(isRetriableNetworkError(new Error("net::ERR_CONNECTION_CLOSED"))).toBe(true);
    expect(isRetriableNetworkError(new Error("read ECONNRESET"))).toBe(true);
    expect(isRetriableNetworkError(new Error("net::ERR_TIMED_OUT"))).toBe(true);
    expect(isRetriableNetworkError(new Error("ERR_UPDATER_INVALID_SIGNATURE"))).toBe(false);

    expect(friendlyUpdateError(new Error("net::ERR_CONNECTION_CLOSED"))).toContain("无法连接 GitHub 更新服务器");
    expect(friendlyUpdateError(new Error("net::ERR_NETWORK_IO_SUSPENDED"))).toContain("休眠恢复");
    expect(friendlyUpdateError(new Error("Cannot find latest.yml (404)"))).toContain("latest.yml");
    expect(friendlyUpdateError(new Error("ERR_UPDATER_INVALID_SIGNATURE"))).toContain("签名校验未通过");
  });

  it("compares semantic versions including leading v and prereleases", () => {
    expect(compareSemver("v0.8.6", "0.8.5")).toBe(1);
    expect(compareSemver("0.8.5", "0.8.5")).toBe(0);
    expect(compareSemver("0.8.4", "0.8.5")).toBe(-1);
    expect(compareSemver("0.8.5", "0.8.5-beta.1")).toBe(1);
  });
});
