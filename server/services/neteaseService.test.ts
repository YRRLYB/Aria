import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readStore: vi.fn(),
  updateStore: vi.fn(),
  userAccount: vi.fn(),
  loginStatus: vi.fn(),
}));

vi.mock("NeteaseCloudMusicApi", () => ({
  default: {
    user_account: mocks.userAccount,
    login_status: mocks.loginStatus,
  },
}));
vi.mock("../store", () => ({
  readStore: mocks.readStore,
  updateStore: mocks.updateStore,
}));

import { getNeteaseAccountSummary, invalidateNeteaseAccountCache, peekNeteaseAccountSummary, saveNeteaseCookie } from "./neteaseService";

describe("NetEase account summary cache", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    invalidateNeteaseAccountCache();
    mocks.readStore.mockResolvedValue({ neteaseCookie: "MUSIC_U=test-cookie", neteaseAccount: null });
    mocks.userAccount.mockResolvedValue({
      body: { profile: { userId: 7, nickname: "听众", avatarUrl: "https://p1.music.126.net/avatar.jpg" } },
    });
    mocks.updateStore.mockResolvedValue(undefined);
  });

  it("coalesces concurrent account lookups and reuses the successful result", async () => {
    const summaries = await Promise.all(Array.from({ length: 8 }, () => getNeteaseAccountSummary()));
    expect(mocks.userAccount).toHaveBeenCalledOnce();
    expect(summaries.every((summary) => summary.connected && summary.userId === "7")).toBe(true);

    expect((await getNeteaseAccountSummary()).nickname).toBe("听众");
    expect(mocks.userAccount).toHaveBeenCalledOnce();
  });

  it("does not call the account endpoint without a saved cookie", async () => {
    mocks.readStore.mockResolvedValue({ neteaseCookie: null });
    expect(await getNeteaseAccountSummary()).toMatchObject({ connected: false, userId: null });
    expect(mocks.userAccount).not.toHaveBeenCalled();
  });

  it("invalidates the cached identity after login saves a new cookie", async () => {
    await getNeteaseAccountSummary();
    mocks.userAccount.mockResolvedValueOnce({ body: { profile: { userId: 8, nickname: "新账号" } } });
    await saveNeteaseCookie("MUSIC_U=new-cookie");
    const cookieUpdate = mocks.updateStore.mock.calls
      .map((call) => call[0] as (store: Record<string, unknown>) => Record<string, unknown>)
      .find((update) => update({ neteaseCookie: "MUSIC_U=old", neteaseAccount: { userId: "7" } }).neteaseCookie === "MUSIC_U=new-cookie");
    expect(cookieUpdate).toBeDefined();
    expect(cookieUpdate?.({ neteaseCookie: "MUSIC_U=old", neteaseAccount: { userId: "7" } })).toMatchObject({
      neteaseCookie: "MUSIC_U=new-cookie",
      neteaseAccount: null,
    });
    expect(mocks.userAccount).toHaveBeenCalledTimes(2);
    expect((await getNeteaseAccountSummary()).userId).toBe("8");
  });

  it("serves a persisted identity without waiting for the provider", async () => {
    const validatedAt = Date.now();
    mocks.readStore.mockResolvedValue({
      neteaseCookie: "MUSIC_U=test-cookie",
      neteaseAccount: {
        connected: true,
        nickname: "离线听众",
        userId: "7",
        avatarUrl: "https://p1.music.126.net/avatar.jpg",
        cookiePreview: "MUSIC_U=…",
        validatedAt,
      },
    });

    expect(await peekNeteaseAccountSummary()).toMatchObject({
      connected: true,
      userId: "7",
      nickname: "离线听众",
    });
    expect(await getNeteaseAccountSummary()).toMatchObject({ userId: "7", nickname: "离线听众" });
    expect(mocks.userAccount).not.toHaveBeenCalled();
  });

  it("validates a stale persisted identity in the background", async () => {
    mocks.readStore.mockResolvedValue({
      neteaseCookie: "MUSIC_U=test-cookie",
      neteaseAccount: {
        connected: true,
        nickname: "旧昵称",
        userId: "7",
        avatarUrl: null,
        cookiePreview: "MUSIC_U=…",
        validatedAt: Date.now() - 10 * 60_000,
      },
    });

    expect((await getNeteaseAccountSummary()).nickname).toBe("旧昵称");
    await vi.waitFor(() => expect(mocks.userAccount).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(mocks.updateStore).toHaveBeenCalled());
    const update = mocks.updateStore.mock.calls.at(-1)?.[0] as (store: Record<string, unknown>) => Record<string, unknown>;
    expect(update({ neteaseCookie: "MUSIC_U=test-cookie", neteaseAccount: { userId: "7" } })).toMatchObject({
      neteaseAccount: expect.objectContaining({ nickname: "听众", userId: "7" }),
    });
  });

  it("exposes a provisional connected state when only the cookie is available", async () => {
    const summary = await peekNeteaseAccountSummary();
    expect(summary).toMatchObject({ connected: true, userId: null, nickname: null });
    expect(summary.cookiePreview).toBeTruthy();
    expect(mocks.userAccount).not.toHaveBeenCalled();
  });

  it("keeps the startup state connected when validation fails transiently", async () => {
    vi.useFakeTimers();
    try {
      mocks.userAccount.mockRejectedValue(new Error("offline"));
      const validation = getNeteaseAccountSummary();
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(validation).resolves.toMatchObject({ connected: false, userId: null });
      // The failed validation is cached for stream/playlist calls, but the
      // startup peek must not treat a network hiccup as an explicit sign-out.
      expect(await peekNeteaseAccountSummary()).toMatchObject({ connected: true, userId: null });
    } finally {
      vi.useRealTimers();
    }
  });
});
