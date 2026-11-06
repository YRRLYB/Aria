import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readStore: vi.fn(),
  updateStore: vi.fn(),
  loginQrKey: vi.fn(),
  loginQrCreate: vi.fn(),
  loginQrCheck: vi.fn(),
  userAccount: vi.fn(),
}));

vi.mock("NeteaseCloudMusicApi", () => ({
  default: {
    login_qr_key: mocks.loginQrKey,
    login_qr_create: mocks.loginQrCreate,
    login_qr_check: mocks.loginQrCheck,
    user_account: mocks.userAccount,
  },
}));
vi.mock("../store", () => ({
  readStore: mocks.readStore,
  updateStore: mocks.updateStore,
}));

import { invalidateNeteaseIdentity } from "../clients/neteaseIdentity";
import { checkNeteaseQrLogin, startNeteaseQrLogin } from "./neteaseService";

describe("NetEase QR login cookie continuity", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.ARIA_NETEASE_REAL_IP;
    // The identity resolver caches for 30s; each case starts from a clean slate.
    invalidateNeteaseIdentity();
    // A persisted device id keeps the eapi fingerprint deterministic in tests.
    mocks.readStore.mockResolvedValue({ neteaseCookie: null, neteaseAccount: null, neteaseDeviceId: "0123456789abcdef" });
    mocks.updateStore.mockResolvedValue(undefined);
    mocks.loginQrKey.mockResolvedValue({
      body: { data: { unikey: "unikey-1" } },
      cookie: ["__csrf=csrf-1", "NMTID=abc"],
    });
    mocks.loginQrCreate.mockResolvedValue({
      body: { data: { qrurl: "https://music.163.com/login?codekey=unikey-1", qrimg: "data:image/png;base64,AAA" } },
      cookie: ["__csrf=csrf-1", "NMTID=abc"],
    });
  });

  it("carries the QR session cookie between start and check", async () => {
    const start = await startNeteaseQrLogin();
    expect(start.key).toBe("unikey-1");
    expect(start.qrImage).toContain("data:image/png");

    // The create call must run on the same cookie jar the unikey belongs to,
    // on the eapi device chain (stable deviceId + the parked session cookies).
    const createQuery = mocks.loginQrCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createQuery).toMatchObject({ key: "unikey-1", crypto: "eapi" });
    expect(String(createQuery.cookie)).toContain("__csrf=csrf-1; NMTID=abc");
    expect(String(createQuery.cookie)).toContain("deviceId=0123456789abcdef");

    mocks.loginQrCheck.mockResolvedValue({ body: { code: 801 }, cookie: ["__csrf=csrf-1"] });
    await checkNeteaseQrLogin(start.key);

    // 801 (waiting) must be polled with the parked cookie, not anonymously.
    const checkQuery = mocks.loginQrCheck.mock.calls[0][0] as Record<string, unknown>;
    expect(checkQuery.crypto).toBe("eapi");
    expect(String(checkQuery.cookie)).toContain("__csrf=csrf-1; NMTID=abc");
    expect(String(checkQuery.cookie)).toContain("deviceId=0123456789abcdef");
    expect(checkQuery.noCookie).toBeUndefined();
  });

  it("still polls anonymously for an unknown key", async () => {
    mocks.loginQrCheck.mockResolvedValue({ body: { code: 800 } });
    const result = await checkNeteaseQrLogin("never-started");
    const checkQuery = mocks.loginQrCheck.mock.calls[0][0] as Record<string, unknown>;
    expect(checkQuery.noCookie).toBe(true);
    expect(checkQuery.cookie).toBeUndefined();
    expect(result.status).toBe("expired");
  });

  it("persists the returned cookie after a confirmed scan", async () => {
    // Model the real store: the cookie handed back by NetEase is what the very
    // next account probe reads, so the summary reflects the new session.
    let stored: Record<string, unknown> = { neteaseCookie: null, neteaseAccount: null };
    mocks.readStore.mockImplementation(async () => ({ ...stored }));
    mocks.updateStore.mockImplementation(async (updater: (store: Record<string, unknown>) => Record<string, unknown>) => {
      stored = updater(stored);
      return stored;
    });
    mocks.loginQrCheck.mockResolvedValue({
      body: { code: 803, cookie: "MUSIC_U=session-cookie" },
      cookie: ["MUSIC_U=session-cookie"],
    });
    mocks.userAccount.mockResolvedValue({ body: { profile: { userId: 7, nickname: "听众" } } });

    const start = await startNeteaseQrLogin();
    const result = await checkNeteaseQrLogin(start.key);

    expect(result.status).toBe("success");
    expect(stored.neteaseCookie).toBe("MUSIC_U=session-cookie");
    expect(result.account).toMatchObject({ connected: true, userId: "7" });
  });

  it("applies a pinned mainland IP to both QR calls", async () => {
    mocks.readStore.mockResolvedValue({ neteaseCookie: null, neteaseRealIp: "116.25.146.177" });
    mocks.loginQrCheck.mockResolvedValue({ body: { code: 801 } });

    const start = await startNeteaseQrLogin();
    await checkNeteaseQrLogin(start.key);

    expect(mocks.loginQrKey.mock.calls[0][0]).toMatchObject({ realIP: "116.25.146.177" });
    expect(mocks.loginQrCreate.mock.calls[0][0]).toMatchObject({ realIP: "116.25.146.177" });
    expect(mocks.loginQrCheck.mock.calls[0][0]).toMatchObject({ realIP: "116.25.146.177" });
  });
});
