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

function mockQrShow(qrsig = "qrSigValue") {
  return new Response(PNG_BYTES, {
    headers: { "content-type": "image/png", "set-cookie": `qrsig=${qrsig}; Path=/; Domain=.ptlogin2.qq.com` },
  });
}

/** check_sig: 302 with the three graph cookies and a login_jump Location. */
function mockCheckSig() {
  const headers = new Headers({
    location: "https://graph.qq.com/oauth2.0/login_jump",
    "content-type": "text/html",
  });
  headers.append("set-cookie", "p_uin=o12345; Domain=graph.qq.com; Path=/");
  headers.append("set-cookie", "p_skey=pSkeyValue; Domain=graph.qq.com; Path=/");
  headers.append("set-cookie", "pt_oauth_token=oauth123; Domain=graph.qq.com; Path=/");
  // A decoy from another domain must not be picked up as the signing cookie.
  headers.append("set-cookie", "p_skey=; Domain=ptlogin2.qq.com; Path=/");
  return new Response("", { status: 302, headers });
}

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
    expect(hash33("a", 0)).toBe(97);
    expect(hash33("ab", 0)).toBe((97 + (97 << 5) + 98) & 0x7fffffff);
  });
});

describe("qq qr login", () => {
  it("creates a session straight from ptqrshow, without xlogin", async () => {
    fetchMock.mockResolvedValueOnce(mockQrShow());
    const start = await startQqQrLogin();
    expect(start.qrImage).toMatch(/^data:image\/png;base64,/);
    expect(start.expiresIn).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("ssl.ptlogin2.qq.com/ptqrshow");
    expect(String(url)).toContain("appid=716027609");
    expect(String(url)).not.toContain("xlogin");
    expect((init as RequestInit).headers).toMatchObject({ Referer: "https://xui.ptlogin2.qq.com/" });
  });

  it("fails when the QR response carries no qrsig", async () => {
    fetchMock.mockResolvedValueOnce(new Response(PNG_BYTES, { headers: { "content-type": "image/png" } }));
    await expect(startQqQrLogin()).rejects.toMatchObject({ code: "QQ_QR_IMAGE_FAILED" });
  });

  it("polls with only the qrsig cookie and maps the ptuiCB states", async () => {
    fetchMock.mockResolvedValueOnce(mockQrShow("tok123"));
    const start = await startQqQrLogin();

    fetchMock.mockResolvedValueOnce(htmlResponse("ptuiCB('66','0','','0','二维码未失效。', '')"));
    expect(await checkQqQrLogin(start.key)).toMatchObject({ code: 66, status: "waiting" });

    fetchMock.mockResolvedValueOnce(htmlResponse("ptuiCB('67','0','','0','二维码已扫描。', '')"));
    expect(await checkQqQrLogin(start.key)).toMatchObject({ code: 67, status: "scanned" });

    fetchMock.mockResolvedValueOnce(htmlResponse("ptuiCB('65','0','','0','二维码已失效。', '')"));
    expect(await checkQqQrLogin(start.key)).toMatchObject({ code: 65, status: "expired" });

    const [pollUrl, pollInit] = fetchMock.mock.calls[1];
    expect(String(pollUrl)).toContain("ssl.ptlogin2.qq.com/ptqrlogin");
    expect(String(pollUrl)).toContain(`ptqrtoken=${hash33("tok123", 0)}`);
    expect(String(pollUrl)).not.toContain("login_sig");
    const cookie = String((pollInit as RequestInit).headers && (pollInit as RequestInit).headers!["Cookie"]);
    expect(cookie).toBe("qrsig=tok123");
  });

  it("completes check_sig → authorize → exchange and stores the credentials", async () => {
    let storedCookie: string | null = null;
    mocks.readStore.mockImplementation(async () => ({ qqCookie: storedCookie }));
    mocks.updateStore.mockImplementation(async (update: (store: Record<string, unknown>) => Record<string, unknown>) => {
      const next = update({ qqCookie: storedCookie });
      storedCookie = (next.qqCookie as string | null) ?? null;
      return next;
    });

    fetchMock.mockResolvedValueOnce(mockQrShow("tok123"));
    const start = await startQqQrLogin();

    fetchMock
      .mockResolvedValueOnce(
        htmlResponse(
          "ptuiCB('0','0','https://ssl.ptlogin2.graph.qq.com/check_sig?uin=o12345&ptsigx=abc','0','登录成功！', '听歌人')",
        ),
      )
      .mockResolvedValueOnce(mockCheckSig())
      // login_jump: the JS body is discarded
      .mockResolvedValueOnce(htmlResponse("<script>location.href='/oauth2.0/authorize'</script>"))
      // authorize: POST answers with the code in Location
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://y.qq.com/portal/wx_redirect.html?login_type=1&code=AUTHCODE" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 0, req: { code: 0, data: { musicid: 12345, musickey: "Q_H_L_musickey" } } }),
          { headers: { "content-type": "application/json" } },
        ),
      )
      // account probe inside saveQqCookie → getQqAccount (android profile)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            req_0: { code: 0, data: { info: { nick: "听歌人", logo: "http://thirdqq.qlogo.cn/g?b=sdk&k=x&s=140" } } },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );

    const result = await checkQqQrLogin(start.key);
    expect(result).toMatchObject({ status: "success" });
    expect(result.account).toMatchObject({ connected: true, nickname: "听歌人", userId: "12345" });

    // check_sig is replayed verbatim with no cookies at all.
    const [, checkSigInit] = fetchMock.mock.calls[2];
    expect((checkSigInit as RequestInit).headers).not.toHaveProperty("Cookie");
    expect((checkSigInit as RequestInit).redirect).toBe("manual");

    // authorize is a POST signed with g_tk derived from the graph p_skey.
    const [authorizeUrl, authorizeInit] = fetchMock.mock.calls[4];
    expect(String(authorizeUrl)).toBe("https://graph.qq.com/oauth2.0/authorize");
    expect((authorizeInit as RequestInit).method).toBe("POST");
    const body = new URLSearchParams(String((authorizeInit as RequestInit).body));
    expect(body.get("client_id")).toBe("100497308");
    expect(body.get("g_tk")).toBe(String(hash33("pSkeyValue")));
    expect(body.get("redirect_uri")).toBe("https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https%3A%2F%2Fy.qq.com%2F");
    expect(String((authorizeInit as RequestInit).headers && (authorizeInit as RequestInit).headers!["Cookie"])).toContain(
      "p_skey=pSkeyValue",
    );

    const [, exchangeInit] = fetchMock.mock.calls[5];
    const exchangeBody = JSON.parse(String((exchangeInit as RequestInit).body)) as {
      req: { module: string; param: { code: string } };
    };
    expect(exchangeBody.req.module).toBe("QQConnectLogin.LoginServer");
    expect(exchangeBody.req.param.code).toBe("AUTHCODE");

    expect(storedCookie).toBe("uin=o12345; qm_keyst=Q_H_L_musickey; qqmusic_key=Q_H_L_musickey");
  });

  it("reports a failed confirmation when check_sig does not issue the graph cookies", async () => {
    fetchMock.mockResolvedValueOnce(mockQrShow("tok123"));
    const start = await startQqQrLogin();

    fetchMock
      .mockResolvedValueOnce(htmlResponse("ptuiCB('0','0','https://ssl.ptlogin2.graph.qq.com/check_sig?uin=o1','0','ok','n')"))
      // 200 instead of the 302 that carries p_uin/p_skey/pt_oauth_token
      .mockResolvedValueOnce(htmlResponse("<html>consent</html>"));

    const result = await checkQqQrLogin(start.key);
    expect(result.status).toBe("expired");
    expect(result.message).toContain("check_sig");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports a failed authorize when the consent page comes back instead of a code", async () => {
    fetchMock.mockResolvedValueOnce(mockQrShow("tok123"));
    const start = await startQqQrLogin();

    fetchMock
      .mockResolvedValueOnce(htmlResponse("ptuiCB('0','0','https://ssl.ptlogin2.graph.qq.com/check_sig?uin=o1','0','ok','n')"))
      .mockResolvedValueOnce(mockCheckSig())
      .mockResolvedValueOnce(htmlResponse("<script></script>"))
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://graph.qq.com/oauth2.0/show?which=Login" } }),
      );

    const result = await checkQqQrLogin(start.key);
    expect(result.status).toBe("expired");
    expect(result.message).toContain("QQ 授权失败");
  });

  it("rejects unknown session keys", async () => {
    await expect(checkQqQrLogin("missing")).rejects.toMatchObject({ code: "QQ_QR_SESSION_MISSING" });
  });
});
