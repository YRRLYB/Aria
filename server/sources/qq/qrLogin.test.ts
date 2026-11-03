import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readStore: vi.fn(),
  updateStore: vi.fn(),
}));

vi.mock("../../store", () => ({
  readStore: mocks.readStore,
  updateStore: mocks.updateStore,
}));

import { checkQqQrLogin, hash33, startQqQrLogin } from "./qrLogin";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function htmlResponse(body: string, cookies: string[] = [], status = 200) {
  const headers = new Headers({ "content-type": "text/html" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(body, { status, headers });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  mocks.readStore.mockResolvedValue({ qqCookie: null });
  mocks.updateStore.mockImplementation(async (update: (store: Record<string, unknown>) => Record<string, unknown>) =>
    update({ qqCookie: null }),
  );
});

afterEach(() => {
  fetchMock.mockReset();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("hash33", () => {
  it("matches the DJB2 variant with explicit seeds", () => {
    expect(hash33("", 5381)).toBe(5381);
    expect(hash33("", 0)).toBe(0);
    // Manual check of the update rule: h = (h + (h << 5) + char) & 0x7fffffff.
    expect(hash33("a", 0)).toBe(97);
    expect(hash33("ab", 0)).toBe((97 + (97 << 5) + 98) & 0x7fffffff);
  });
});

describe("qq qr login", () => {
  it("creates a session with a QR image after xlogin and ptqrshow", async () => {
    fetchMock
      .mockResolvedValueOnce(htmlResponse("", ["pt_login_sig=abc123; Path=/; Domain=.qq.com"]))
      .mockResolvedValueOnce(
        new Response(PNG_BYTES, {
          headers: { "content-type": "image/png", "set-cookie": "qrsig=qrSigValue; Path=/; Domain=.ptlogin2.qq.com" },
        }),
      );
    const start = await startQqQrLogin();
    expect(start.key).toBeTruthy();
    expect(start.qrImage).toMatch(/^data:image\/png;base64,/);
    expect(start.expiresIn).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [xloginUrl] = fetchMock.mock.calls[0];
    expect(String(xloginUrl)).toContain("xlogin");
    expect(String(xloginUrl)).toContain("appid=716027609");
    const [, qrInit] = fetchMock.mock.calls[1];
    expect((qrInit as RequestInit).headers).toMatchObject({ Referer: "https://xui.ptlogin2.qq.com/" });
  });

  it("fails when pt_login_sig is missing", async () => {
    fetchMock.mockResolvedValueOnce(htmlResponse(""));
    await expect(startQqQrLogin()).rejects.toMatchObject({ code: "QQ_QR_SESSION_FAILED" });
  });

  it("reports waiting and scanned states from the poll callback", async () => {
    fetchMock
      .mockResolvedValueOnce(htmlResponse("", ["pt_login_sig=sig; Path=/"]))
      .mockResolvedValueOnce(
        new Response(PNG_BYTES, { headers: { "set-cookie": "qrsig=tok123; Path=/" } }),
      );
    const start = await startQqQrLogin();

    fetchMock.mockResolvedValueOnce(htmlResponse("ptuiCB('66','0','','0','二维码未失效。', '')"));
    const waiting = await checkQqQrLogin(start.key);
    expect(waiting).toMatchObject({ code: 66, status: "waiting" });

    fetchMock.mockResolvedValueOnce(htmlResponse("ptuiCB('67','0','','0','二维码已扫描。', '')"));
    const scanned = await checkQqQrLogin(start.key);
    expect(scanned).toMatchObject({ code: 67, status: "scanned" });

    const [pollUrl, pollInit] = fetchMock.mock.calls[2];
    expect(String(pollUrl)).toContain("ptqrlogin");
    expect(String(pollUrl)).toContain("login_sig=sig");
    expect((pollInit as RequestInit).headers).toMatchObject({ Cookie: expect.stringContaining("qrsig=tok123") });
  });

  it("completes the login chain and stores uin + musickey", async () => {
    // readStore must reflect the cookie persisted by updateStore mid-flow.
    let storedCookie: string | null = null;
    mocks.readStore.mockImplementation(async () => ({ qqCookie: storedCookie }));
    mocks.updateStore.mockImplementation(async (update: (store: Record<string, unknown>) => Record<string, unknown>) => {
      const next = update({ qqCookie: storedCookie });
      storedCookie = (next.qqCookie as string | null) ?? null;
      return next;
    });
    fetchMock
      .mockResolvedValueOnce(htmlResponse("", ["pt_login_sig=sig; Path=/"]))
      .mockResolvedValueOnce(new Response(PNG_BYTES, { headers: { "set-cookie": "qrsig=tok123; Path=/" } }));
    const start = await startQqQrLogin();

    fetchMock
      .mockResolvedValueOnce(
        htmlResponse("ptuiCB('0','0','https://ssl.ptlogin2.qq.com/check_sig?uin=12345','0','登录成功！', '听歌人')"),
      )
      // check_sig hop sets p_skey, no further redirect
      .mockResolvedValueOnce(htmlResponse("", ["p_skey=pSkeyValue; Path=/; Domain=.qq.com"]))
      // oauth authorize → Location carries the code
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://y.qq.com/portal/wx_redirect.html?code=AUTHCODE&state=state" },
        }),
      )
      // QQConnectLogin.QQLogin exchange
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 0, req: { code: 0, data: { musicid: 12345, musickey: "Q_H_L_musickey", keyExpiresIn: 7776000 } } }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      // profile validation inside saveQqCookie → getQqAccount
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { creator: { nick: "听歌人", headpic: "https://gtimg.cn/a.jpg" } } })),
      );

    const result = await checkQqQrLogin(start.key);
    expect(result.status).toBe("success");
    expect(result.account).toMatchObject({ connected: true, nickname: "听歌人", userId: "12345" });

    const update = mocks.updateStore.mock.calls[0][0] as (store: Record<string, unknown>) => Record<string, unknown>;
    expect(update({})).toMatchObject({ qqCookie: "uin=o12345; qqmusic_key=Q_H_L_musickey" });

    // The chain stopped on the empty check_sig page, so the browser-style
    // authorize GET goes out signed with the p_skey-derived g_tk.
    // Call order: xlogin, ptqrshow, ptqrlogin, check_sig, authorize, exchange, profile.
    const authorizeCall = fetchMock.mock.calls[4];
    const authorizeUrl = String(authorizeCall[0]);
    expect(authorizeUrl).toContain("oauth2.0/authorize");
    expect(authorizeUrl).toContain("client_id=100497308");
    expect(authorizeUrl).toContain(`g_tk=${hash33("pSkeyValue")}`);
    expect(authorizeUrl).toContain(
      "redirect_uri=" + encodeURIComponent("https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https%3A%2F%2Fy.qq.com%2F"),
    );
    // exchange carried the authorize code
    const exchangeCall = fetchMock.mock.calls[5];
    const exchangeBody = JSON.parse(String((exchangeCall[1] as RequestInit).body)) as {
      req: { module: string; param: { code: string } };
    };
    expect(exchangeBody.req.module).toBe("QQConnectLogin.LoginServer");
    expect(exchangeBody.req.param.code).toBe("AUTHCODE");
  });

  it("takes the code from the redirect chain without needing p_skey", async () => {
    let storedCookie: string | null = null;
    mocks.readStore.mockImplementation(async () => ({ qqCookie: storedCookie }));
    mocks.updateStore.mockImplementation(async (update: (store: Record<string, unknown>) => Record<string, unknown>) => {
      const next = update({ qqCookie: storedCookie });
      storedCookie = (next.qqCookie as string | null) ?? null;
      return next;
    });
    fetchMock
      .mockResolvedValueOnce(htmlResponse("", ["pt_login_sig=sig; Path=/"]))
      .mockResolvedValueOnce(new Response(PNG_BYTES, { headers: { "set-cookie": "qrsig=tok123; Path=/" } }));
    const start = await startQqQrLogin();

    fetchMock
      .mockResolvedValueOnce(
        htmlResponse("ptuiCB('0','0','https://ptlogin2.qq.com/check_sig?uin=67890','0','登录成功！', '')"),
      )
      // check_sig → graph authorize: no p_skey is set anywhere on the way.
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location:
              "https://graph.qq.com/oauth2.0/authorize?response_type=code&client_id=100497308&redirect_uri=https%3A%2F%2Fy.qq.com%2Fportal%2Fwx_redirect.html",
          },
        }),
      )
      // graph authorize → redirect_uri with the one-time code.
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://y.qq.com/portal/wx_redirect.html?code=CHAINCODE&state=state" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 0, req: { code: 0, data: { musicid: 67890, musickey: "Q_H_L_chain" } } }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { creator: { nick: "听歌人2", headpic: null } } })),
      );

    const result = await checkQqQrLogin(start.key);
    expect(result.status).toBe("success");
    expect(result.account).toMatchObject({ connected: true, userId: "67890" });

    // The manual authorize POST must be skipped: the chain already gave us the code.
    const authorizePosts = fetchMock.mock.calls.filter((call) =>
      String((call[1] as RequestInit | undefined)?.body ?? "").includes("client_id="),
    );
    expect(authorizePosts).toHaveLength(0);

    const exchange = fetchMock.mock.calls.find((call) => String(call[0]).includes("musicu"));
    const exchangeBody = JSON.parse(String((exchange[1] as RequestInit).body)) as {
      comm: { g_tk: number };
      req: { param: { code: string } };
    };
    expect(exchangeBody.req.param.code).toBe("CHAINCODE");
    // No signing cookie at all → fall back to the anonymous g_tk.
    expect(exchangeBody.comm.g_tk).toBe(5381);
  });

  it("recovers the code from a landing page that redirects in script", async () => {
    let storedCookie: string | null = null;
    mocks.readStore.mockImplementation(async () => ({ qqCookie: storedCookie }));
    mocks.updateStore.mockImplementation(async (update: (store: Record<string, unknown>) => Record<string, unknown>) => {
      const next = update({ qqCookie: storedCookie });
      storedCookie = (next.qqCookie as string | null) ?? null;
      return next;
    });
    fetchMock
      .mockResolvedValueOnce(htmlResponse("", ["pt_login_sig=sig; Path=/"]))
      .mockResolvedValueOnce(new Response(PNG_BYTES, { headers: { "set-cookie": "qrsig=tok123; Path=/" } }));
    const start = await startQqQrLogin();

    fetchMock
      .mockResolvedValueOnce(
        htmlResponse("ptuiCB('0','0','https://ptlogin2.qq.com/check_sig?uin=9999','0','登录成功！', '')"),
      )
      // Modern ptlogin answers with a page that finishes the redirect in JS,
      // and hands out an empty p_skey plus p_skey_forbid.
      .mockResolvedValueOnce(
        htmlResponse(
          '<html><script>window.location.href="https://y.qq.com/portal/wx_redirect.html?code=BODYCODE&state=state";</script></html>',
          ["p_skey=; Path=/; Domain=.qq.com", "p_skey_forbid=1; Path=/; Domain=.qq.com"],
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 0, req: { code: 0, data: { musicid: 9999, musickey: "Q_H_L_body" } } }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { creator: { nick: "听歌人3" } } })));

    const result = await checkQqQrLogin(start.key);
    expect(result.status).toBe("success");

    // The empty p_skey must not be mistaken for a signing cookie.
    const authorizePosts = fetchMock.mock.calls.filter((call) =>
      String((call[1] as RequestInit | undefined)?.body ?? "").includes("client_id="),
    );
    expect(authorizePosts).toHaveLength(0);

    const exchange = fetchMock.mock.calls.find((call) => String(call[0]).includes("musicu"));
    const exchangeBody = JSON.parse(String((exchange[1] as RequestInit).body)) as {
      comm: { g_tk: number };
      req: { param: { code: string } };
    };
    expect(exchangeBody.req.param.code).toBe("BODYCODE");
    expect(exchangeBody.comm.g_tk).toBe(5381);
  });

  it("follows the scripted redirect inside the login_jump page", async () => {
    fetchMock
      .mockResolvedValueOnce(htmlResponse("", ["pt_login_sig=sig; Path=/"]))
      .mockResolvedValueOnce(new Response(PNG_BYTES, { headers: { "set-cookie": "qrsig=tok123; Path=/" } }));
    const start = await startQqQrLogin();

    fetchMock
      .mockResolvedValueOnce(
        htmlResponse("ptuiCB('0','0','https://ssl.ptlogin2.graph.qq.com/check_sig?uin=8888','0','登录成功！', '')"),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://graph.qq.com/oauth2.0/login_jump?client_id=100497308&g_tk=5381" },
        }),
      )
      // login_jump answers 200 and navigates in JS to the parameter-signed
      // authorize URL; p_skey is empty here, exactly like the real refusal case.
      .mockResolvedValueOnce(
        htmlResponse(
          '<html><script>window.location.href="https://graph.qq.com/oauth2.0/authorize?response_type=code&amp;client_id=100497308&amp;pt_login_type=3&amp;g_tk=5381";</script></html>',
          ["p_skey=; Path=/; Domain=.qq.com", "p_skey_forbid=1; Path=/; Domain=.qq.com"],
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://y.qq.com/portal/wx_redirect.html?code=JSCODE&state=state" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 0, req: { code: 0, data: { musicid: 8888, musickey: "Q_H_L_js" } } }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { creator: { nick: "听歌人4" } } })));

    const result = await checkQqQrLogin(start.key);
    expect(result.status).toBe("success");

    const authorizeCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("oauth2.0/authorize"));
    expect(String(authorizeCall?.[0])).toContain("pt_login_type=3");
    expect(String(authorizeCall?.[0])).toContain("g_tk=5381");

    const exchange = fetchMock.mock.calls.find((call) => String(call[0]).includes("musicu"));
    const exchangeBody = JSON.parse(String((exchange[1] as RequestInit).body)) as {
      req: { param: { code: string } };
    };
    expect(exchangeBody.req.param.code).toBe("JSCODE");
  });

  it("explains why confirmation failed when the chain yields neither code nor a signing cookie", async () => {
    fetchMock
      .mockResolvedValueOnce(htmlResponse("", ["pt_login_sig=sig; Path=/"]))
      .mockResolvedValueOnce(new Response(PNG_BYTES, { headers: { "set-cookie": "qrsig=tok123; Path=/" } }));
    const start = await startQqQrLogin();

    fetchMock
      .mockResolvedValueOnce(htmlResponse("ptuiCB('0','0','https://ptlogin2.qq.com/check_sig?uin=1','0','登录成功！', '')"))
      // check_sig hop, then the browser-style authorize GET: neither sets a code or signing cookie.
      .mockResolvedValueOnce(htmlResponse("", ["ptui_loginuin=12345; Path=/"]))
      .mockResolvedValueOnce(htmlResponse(""));

    const result = await checkQqQrLogin(start.key);
    expect(result.status).toBe("expired");
    expect(result.message).toContain("授权链路未返回 code");
    expect(result.message).toContain("ptui_loginuin");
    // The dead session is dropped so the app asks for a fresh QR code.
    await expect(checkQqQrLogin(start.key)).rejects.toMatchObject({ code: "QQ_QR_SESSION_MISSING" });
  });

  it("completes the login through the parameter-signed authorize URL", async () => {
    fetchMock
      .mockResolvedValueOnce(htmlResponse("", ["pt_login_sig=sig; Path=/"]))
      .mockResolvedValueOnce(new Response(PNG_BYTES, { headers: { "set-cookie": "qrsig=tok123; Path=/" } }));
    const start = await startQqQrLogin();

    fetchMock
      .mockResolvedValueOnce(
        htmlResponse("ptuiCB('0','0','https://ssl.ptlogin2.graph.qq.com/check_sig?uin=7777','0','登录成功！', '')", [
          "p_skey=; Path=/; Domain=.qq.com",
          "p_skey_forbid=1; Path=/; Domain=.qq.com",
          "pt_login_type=3; Path=/; Domain=.qq.com",
          "pt_oauth_token=oat123; Path=/; Domain=.qq.com",
        ]),
      )
      // check_sig ends on login_jump's scripted page: no code, no redirect URL.
      .mockResolvedValueOnce(htmlResponse("<html><script>void 0;</script></html>"))
      // Browser-style authorize with the ptlogin markers → immediate code.
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://y.qq.com/portal/wx_redirect.html?code=FALLBACKCODE&state=state" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 0, req: { code: 0, data: { musicid: 7777, musickey: "Q_H_L_fb" } } }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { creator: { nick: "听歌人5" } } })));

    const result = await checkQqQrLogin(start.key);
    expect(result.status).toBe("success");

    const authorizeCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("oauth2.0/authorize"));
    const authorizeUrl = String(authorizeCall?.[0]);
    expect(authorizeUrl).toContain("pt_login_type=3");
    expect(authorizeUrl).toContain("pt_oauth_token=oat123");
    // Empty p_skey → unsigned request, so no g_tk is sent.
    expect(authorizeUrl).not.toContain("g_tk=");

    const exchange = fetchMock.mock.calls.find((call) => String(call[0]).includes("musicu"));
    const exchangeBody = JSON.parse(String((exchange[1] as RequestInit).body)) as {
      req: { param: { code: string } };
    };
    expect(exchangeBody.req.param.code).toBe("FALLBACKCODE");
  });

  it("rejects unknown session keys", async () => {
    await expect(checkQqQrLogin("missing")).rejects.toMatchObject({ code: "QQ_QR_SESSION_MISSING" });
  });
});
