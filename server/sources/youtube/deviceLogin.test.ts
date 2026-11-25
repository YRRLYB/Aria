import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkYoutubeDeviceLogin,
  mintYoutubeSessionCookie,
  resetYoutubeDeviceStateForTests,
  startYoutubeDeviceLogin,
} from "./deviceLogin";

const clientMocks = vi.hoisted(() => ({
  saveYoutubeOauthSession: vi.fn(async () => ({
    connected: true,
    nickname: "device-user",
    userId: null,
    avatarUrl: null,
  })),
  youtubeRawFetch: vi.fn(),
}));

vi.mock("./client", () => ({
  saveYoutubeOauthSession: clientMocks.saveYoutubeOauthSession,
  youtubeRawFetch: clientMocks.youtubeRawFetch,
}));

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async () => "data:image/png;base64,MOCKQR") },
}));

const DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TV_HOME_URL = "https://www.youtube.com/tv";
const OAUTH_LOGIN_URL = "https://accounts.google.com/accounts/OAuthLogin?source=youtube&issueuberauth=1";
const MERGE_URL = "https://accounts.google.com/MergeSession?uberauth=UB&continue=https%3A%2F%2Fwww.youtube.com%2F";
const YOUTUBE_URL = "https://www.youtube.com/";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function redirectResponse(location: string, setCookie: string[] = []) {
  return new Response("", {
    status: 302,
    headers: [["location", location], ...setCookie.map((line) => ["set-cookie", line])],
  });
}

function landedResponse(setCookie: string[]) {
  return new Response("<html></html>", {
    status: 200,
    headers: setCookie.map((line) => ["set-cookie", line]),
  });
}

const YT_COOKIES = [
  "SID=ytsid; Domain=.youtube.com; Path=/; Secure; HttpOnly",
  "SAPISID=sap; Domain=.youtube.com; Path=/; Secure; HttpOnly",
  "LOGIN_INFO=li; Domain=.youtube.com; Path=/; Secure; HttpOnly",
];

function callFor(urlFragment: string) {
  const call = clientMocks.youtubeRawFetch.mock.calls.find(([url]) => String(url).includes(urlFragment));
  if (!call) throw new Error(`no youtubeRawFetch call matched: ${urlFragment}`);
  return call as [string, Record<string, unknown>];
}

/** Starts a session (fallback credentials, scrape fetch fails with 500). */
async function startSession() {
  clientMocks.youtubeRawFetch.mockImplementation((url) => {
    const value = String(url);
    if (value === TV_HOME_URL) return Promise.resolve(new Response("", { status: 500 }));
    if (value === DEVICE_CODE_URL) {
      return Promise.resolve(
        jsonResponse({
          device_code: "DC-START",
          user_code: "ABCD-WXYZ",
          verification_url: "https://www.youtube.com/activate",
          expires_in: 1800,
          interval: 5,
        }),
      );
    }
    return Promise.resolve(jsonResponse({ error: "authorization_pending" }, 400));
  });
  return startYoutubeDeviceLogin();
}

beforeEach(() => {
  vi.clearAllMocks();
  resetYoutubeDeviceStateForTests();
});

describe("YouTube device-code login", () => {
  it("falls back to the built-in TV credentials when scraping fails and returns the code", async () => {
    const started = await startSession();

    expect(started).toMatchObject({
      key: "DC-START",
      userCode: "ABCD-WXYZ",
      verificationUrl: "https://www.youtube.com/activate",
      qrImage: "data:image/png;base64,MOCKQR",
      expiresIn: 1800,
    });
    const [, init] = callFor(DEVICE_CODE_URL);
    expect(String(init?.body)).toContain(
      "client_id=861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com",
    );
    expect(String(init?.body)).toContain("scope=openid");
  });

  it("scrapes fresh TV credentials from the YouTube TV base.js", async () => {
    clientMocks.youtubeRawFetch.mockImplementation((url) => {
      const value = String(url);
      if (value === TV_HOME_URL) {
        return Promise.resolve(
          new Response('<script id="base-js" src="/s/player/xyz/basejs"></script>', { status: 200 }),
        );
      }
      if (value === "https://www.youtube.com/s/player/xyz/basejs") {
        return Promise.resolve(
          new Response('clientId:"515lapp.apps.googleusercontent.com",d:"TOPSECRET"', { status: 200 }),
        );
      }
      if (value === DEVICE_CODE_URL) {
        return Promise.resolve(
          jsonResponse({
            device_code: "DC-SCRAPE",
            user_code: "SCRP-CODE",
            verification_url: "https://yt.be/activate",
            expires_in: 900,
            interval: 5,
          }),
        );
      }
      return Promise.resolve(jsonResponse({ error: "authorization_pending" }, 400));
    });

    const started = await startYoutubeDeviceLogin();
    expect(started.key).toBe("DC-SCRAPE");
    const [, init] = callFor(DEVICE_CODE_URL);
    expect(String(init?.body)).toContain("client_id=515lapp.apps.googleusercontent.com");
    expect(String(init?.body)).toContain("client_secret=TOPSECRET");
  });

  it("reports expired for an unknown session key without saving anything", async () => {
    const result = await checkYoutubeDeviceLogin("never-started");
    expect(result).toMatchObject({ code: 65, status: "expired" });
    expect(clientMocks.saveYoutubeOauthSession).not.toHaveBeenCalled();
  });

  it("maps authorization_pending to waiting without saving", async () => {
    await startSession();
    clientMocks.youtubeRawFetch.mockResolvedValue(jsonResponse({ error: "authorization_pending" }, 428));

    const result = await checkYoutubeDeviceLogin("DC-START");
    expect(result).toMatchObject({ code: 66, status: "waiting", account: null });
    expect(clientMocks.saveYoutubeOauthSession).not.toHaveBeenCalled();
  });

  it("after approval follows OAuthLogin → MergeSession when available and saves both OAuth and cookie", async () => {
    await startSession();
    clientMocks.youtubeRawFetch.mockImplementation((url) => {
      const value = String(url);
      if (value === TOKEN_URL) {
        return Promise.resolve(jsonResponse({ access_token: "AT-123", refresh_token: "RT-123", expires_in: 3600 }));
      }
      if (value === OAUTH_LOGIN_URL) {
        return Promise.resolve(
          redirectResponse(MERGE_URL, ["SID=goosid; Domain=.google.com; Path=/; Secure; HttpOnly"]),
        );
      }
      if (value === MERGE_URL) return Promise.resolve(redirectResponse(YOUTUBE_URL));
      if (value === YOUTUBE_URL) return Promise.resolve(landedResponse(YT_COOKIES));
      throw new Error(`unexpected fetch: ${value}`);
    });

    const result = await checkYoutubeDeviceLogin("DC-START");
    expect(result.status).toBe("success");
    expect(result.code).toBe(0);
    expect(result.account).toMatchObject({ connected: true });

    const [, oauthInit] = callFor(OAUTH_LOGIN_URL);
    expect(oauthInit?.headers).toMatchObject({ authorization: "Bearer AT-123" });
    expect(oauthInit?.redirect).toBe("manual");

    const saved = clientMocks.saveYoutubeOauthSession.mock.calls[0][0] as {
      accessToken: string;
      refreshToken: string | null;
      cookie: string | null;
    };
    expect(saved.accessToken).toBe("AT-123");
    expect(saved.refreshToken).toBe("RT-123");
    expect(saved.cookie).toContain("SID=ytsid");
    expect(saved.cookie).toContain("SAPISID=sap");
    expect(saved.cookie).toContain("LOGIN_INFO=li");
    // The transient .google.com cookie must not leak into the youtube.com header.
    expect(saved.cookie).not.toContain("SID=goosid");
  });

  it("completes login via OAuth2 Bearer session even when legacy OAuthLogin fails or returns incomplete cookies", async () => {
    await startSession();
    clientMocks.youtubeRawFetch.mockImplementation((url) => {
      const value = String(url);
      if (value === TOKEN_URL) {
        return Promise.resolve(jsonResponse({ access_token: "AT-456", refresh_token: "RT-456", expires_in: 3600 }));
      }
      if (value === OAUTH_LOGIN_URL) return Promise.resolve(jsonResponse({ error: "forbidden" }, 403));
      throw new Error(`unexpected fetch: ${value}`);
    });

    const result = await checkYoutubeDeviceLogin("DC-START");
    expect(result.status).toBe("success");
    expect(result.code).toBe(0);
    expect(result.account).toMatchObject({ connected: true, nickname: "device-user" });
    expect(clientMocks.saveYoutubeOauthSession).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "AT-456",
        refreshToken: "RT-456",
        cookie: null,
      }),
    );
  });

  it("returns expired with the denial message when the user rejects on the phone", async () => {
    await startSession();
    clientMocks.youtubeRawFetch.mockResolvedValue(jsonResponse({ error: "access_denied" }, 401));

    const result = await checkYoutubeDeviceLogin("DC-START");
    expect(result).toMatchObject({ code: 65, status: "expired" });
    expect(result.message).toContain("取消授权");
  });

  it("throws a readable error when OAuthLogin does not redirect", async () => {
    clientMocks.youtubeRawFetch.mockResolvedValue(jsonResponse({ error: "invalid_token" }, 401));

    await expect(mintYoutubeSessionCookie("bad-token")).rejects.toMatchObject({
      code: "UPSTREAM_FAILED",
    });
  });
});
