# 🌐 一起听自部署中转（信令节点）教程

> **为什么正式版不自带默认中转？**  
> 为保护隐私并避免公用免费节点拥塞或泄漏个人服务器地址，公开发布包**不内置任何默认中继服务器**，也不会把 `deploy/` 和 `cloudflare/` 打包进客户端安装程序。  
> **中转 / 信令节点仅转发轻量房间指令**：只负责 6 位房间码发现、成员状态同步、时钟校准包与 WebRTC SDP/ICE 握手，**不中转音频数据流**（在线歌曲由播放端或直链拉取，单房间每小时信令流量通常仅几十 KB）。

你可以根据自己的网络条件从以下 3 种方式中任选其一（**同一房间内的房主与听友需填入相同的信令地址**）：

---

## 方案一：Linux / Windows 服务器一键部署（推荐，零第三方依赖）

仅需一台有公网 IP 的轻量服务器（**Node.js >= 18**；若系统尚未安装 Node，脚本内会尽量提示或自动处理基础依赖）：

### Linux 服务器（配置 systemd 开机常驻，默认端口 `8787`）

```bash
curl -fsSL https://raw.githubusercontent.com/YRRLYB/Aria/main/deploy/aria-signal-node/install-linux.sh | sudo bash
```

若已克隆本仓库，也可进入目录后本地安装 / 指定端口：

```bash
cd deploy/aria-signal-node
sudo bash install-linux.sh --port 8787
```

常用运维：`systemctl status aria-signal`（查看状态）、`journalctl -u aria-signal -f`（查看日志）、`sudo bash install-linux.sh --uninstall`（在脚本目录执行彻底卸载）。

### Windows 服务器（管理员 PowerShell 安装为开机自启计划任务，默认端口 `8787`）

```powershell
powershell -NoProfile -Command "irm https://raw.githubusercontent.com/YRRLYB/Aria/main/deploy/aria-signal-node/install-windows.ps1 -OutFile install-windows.ps1; powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Port 8787"
```

常用运维：`Get-ScheduledTask -TaskName AriaSignalNode`（查看状态）、`Get-Content C:\AriaSignalNode\logs\signal.log -Tail 50`（查看日志）、`powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Uninstall`（卸载）。

> **端口放行与域名反代**：  
> - 请在云厂商安全组与系统防火墙放行 **TCP 8787**（或你自定义的端口）；部署后可直接用 `http://你的公网IP:8787`，无需域名与 SSL 证书。  
> - 如希望走 `https://` 域名，可用 Nginx / Caddy 反代至 `http://127.0.0.1:8787` 并开启 WebSocket 升级头（`Upgrade` / `Connection`），完整 Nginx 示例见 [自建信令节点详细说明](../deploy/aria-signal-node/README.md)。

---

## 方案二：Cloudflare Workers + Durable Objects（免服务器免费托管）

如果没有 VPS，可以直接利用 Cloudflare Workers 免费额度（基于 Durable Objects WebSocket Hibernation）：

```bash
npm i -g wrangler
wrangler login
cd cloudflare/aria-signal-worker
wrangler deploy
```

- **强烈建议绑定自定义域名**：默认 `*.workers.dev` 在部分国内网络可能受阻；在 Cloudflare Dashboard → `Workers & Pages` → `aria-signal-worker` → `Settings` → `Domains & Routes` 绑定已接入 Cloudflare 的个人子域名（如 `signal.yourdomain.com`），并在 [wrangler.toml](../cloudflare/aria-signal-worker/wrangler.toml) 按需配置路由。详细步骤见 [Cloudflare 信令部署说明](../cloudflare/aria-signal-worker/README.md)。
- **可选 Cloudflare TURN 穿透增强**：在 Worker Secrets 中可选配置 `CF_TURN_TOKEN_ID` 与 `CF_TURN_API_TOKEN`（启用 `GET /turn-credentials?room=...`，签发 15 分钟短期 ICE 凭据，未配置时安全降级）。

---

## 方案三：房主直连（免一切信令服务器）

如果房主本地网络具备公网 IPv4 / 公网 IPv6，或者大家就在同一局域网 / 组网内：
- 无需部署任何信令节点，在防火墙或路由器放行直连端口（默认 **TCP 3639**）后，直接选择「**房主直连**」创建房间，复制直连令牌发给听友粘贴加入即可。

---

## Aria 客户端填写步骤

1. 打开 Aria → 左侧 **一起听 → Aria 官方一起听 → 网络设置**；
2. 根据上方所选方案填写并保存：
   - **使用自建服务器（方案一）**：切到「自建信令节点」，填写 `http://你的服务器IP:8787`（支持只写 `IP:端口`）或 HTTPS 反代域名，点击 **测速优选 IP** 可验证返回 **`自建节点直连`**（自建节点会自动跳过 Cloudflare Anycast 优选）；
   - **使用 Cloudflare Worker（方案二）**：切到「Cloudflare 信令」，填写 `https://signal.yourdomain.com`，点击 **测速优选 IP** 自动挑选延迟最低的可用 IP；
3. 点击 **保存配置** 后，即可在「云端 / 混合」模式下创建房间并通过 6 位房间码跨网络同步听歌。

[← 返回首页 README](../README.md)
