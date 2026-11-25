# Aria 自建一起听信令节点（Linux / Windows 一键部署）

这是一个**单文件、零第三方依赖（仅需 Node.js >= 18）**的轻量化信令节点，完全兼容 Aria 客户端内置的 `/health` + `/ws` JSON 房间转发协议：

- 只负责房间状态同步、成员信令（WebRTC SDP / ICE）、播放锚点对时、跨端切歌转发。
- **音频流不经过信令服务器**（在线音源直连各自官方 CDN，本地音乐及兜底传输走 WebRTC P2P），因此流量消耗极低（单房间每小时通常仅几十 KB）。
- 客户端填入 `http://你的服务器IP:端口`（或反代后的 `https://你的域名`）后，Aria 会自动识别为自建节点并**跳过 Cloudflare 优选 IP 劫持**。

---

## Linux 服务器一键部署（推荐 systemd 常驻）

上传本目录或直接运行：

```bash
sudo bash install-linux.sh --port 8787
```

如果是空白机器，也可单命令远程安装：

```bash
curl -fsSL https://raw.githubusercontent.com/YRRLYB/Aria/test/macos-0.8.5/deploy/aria-signal-node/install-linux.sh | sudo bash
```

常用运维命令：

```bash
systemctl status aria-signal       # 查看运行状态
journalctl -u aria-signal -f       # 实时查看日志
sudo bash install-linux.sh --uninstall  # 彻底卸载
```

---

## Windows 服务器一键部署（开机自启计划任务）

以 **管理员身份** 打开 PowerShell，在本目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Port 8787
```

常用运维命令：

```powershell
Get-ScheduledTask -TaskName AriaSignalNode             # 查看状态
Get-Content C:\AriaSignalNode\logs\signal.log -Tail 50 # 查看日志
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1 -Uninstall  # 卸载
```

---

## Aria 客户端填写说明

1. 打开 Aria → **一起听 → 网络设置 → 信令服务器地址**。
2. 填法二选一：
   - **直接用 IP + 端口（最省事，免域名免证书）**：`http://你的公网IP:8787`
     （记得在云厂商安全组 / 面板防火墙放行 **TCP 8787**）
   - **配域名 + HTTPS（可选）**：在 Nginx / Caddy 将 `https://你的域名` 反代到 `http://127.0.0.1:8787` 并开启 WebSocket 支持，然后 Aria 里填 `https://你的域名`。

> 房主与加入的听友都填入同一个信令地址即可互通；填入自建地址后建议点一次「测速优选」确认提示 `自建节点直连`。

### Nginx HTTPS 反代参考（可选）

```nginx
location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
}
```
