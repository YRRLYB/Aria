# Aria Official Listen Together — Cloudflare Signaling Worker

轻量化、零音频流量的信令服务器（基于 Cloudflare Workers + Durable Objects WebSocket Hibernation），仅转发房间状态、时钟校准包（`clock_ping`/`clock_pong`）与 WebRTC `SDP/ICE` 握手，**不中转任何音频数据流**，在 Cloudflare 免费额度即可稳定支撑。

## 部署步骤

1. 安装依赖（或全局使用 Wrangler CLI）：

```bash
npm i -g wrangler
wrangler login
```

2. 在本目录下执行部署：

```bash
cd cloudflare/aria-signal-worker
wrangler deploy
```

3. **绑定自定义域名（强烈建议用于国内优选 IP）**：
   - 在 Cloudflare Dashboard → `Workers & Pages` → 选择 `aria-signal-worker` → `Settings` → `Domains & Routes` → 添加自己的域名（如 `signal.yourdomain.com`）。
   - `*.workers.dev` 在部分国内网络环境下可能受 DNS 污染或阻断；绑定已接入 Cloudflare 的自定义域名后，Aria 客户端可通过 **TLS-SNI + Cloudflare Anycast 优选 IP** 直连握手，实现高可用、低延迟信令连接。

4. 将部署后的域名填入 Aria 客户端「Aria 官方一起听 → 高级网络设置 → 信令服务器地址」（如 `https://signal.yourdomain.com`），点击 **优选 IP 测速** 即可使用。
