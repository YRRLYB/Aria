#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8787}"
INSTALL_DIR="${INSTALL_DIR:-/opt/aria-signal-node}"
SERVICE_NAME="aria-signal"
RAW_SERVER_URL="https://raw.githubusercontent.com/YRRLYB/Aria/test/macos-0.8.5/deploy/aria-signal-node/server.mjs"
UNINSTALL=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --port|-p)
      PORT="${2:?Missing value for --port}"
      shift 2
      ;;
    --dir|-d)
      INSTALL_DIR="${2:?Missing value for --dir}"
      shift 2
      ;;
    --uninstall)
      UNINSTALL=1
      shift
      ;;
    --help|-h)
      echo "Aria 信令节点 Linux 一键部署脚本"
      echo "用法: sudo bash $0 [--port 8787] [--dir /opt/aria-signal-node] [--uninstall]"
      exit 0
      ;;
    *)
      echo "未知参数: $1"
      exit 1
      ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  if [ -f "$0" ] && command -v sudo >/dev/null 2>&1; then
    if [ "$UNINSTALL" -eq 1 ]; then
      exec sudo bash "$0" --port "$PORT" --dir "$INSTALL_DIR" --uninstall
    else
      exec sudo bash "$0" --port "$PORT" --dir "$INSTALL_DIR"
    fi
  fi
  echo "请使用 root 或 sudo 运行此脚本，例如: ... | sudo bash"
  exit 1
fi

if [ "$UNINSTALL" -eq 1 ]; then
  if command -v systemctl >/dev/null 2>&1; then
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    systemctl daemon-reload 2>/dev/null || true
  fi
  rm -rf "$INSTALL_DIR"
  echo "[aria-signal] 已卸载服务并清理 ${INSTALL_DIR}"
  exit 0
fi

get_node_major() {
  if ! command -v node >/dev/null 2>&1; then
    echo "0"
    return
  fi
  node -p "parseInt(process.versions.node.split('.')[0], 10)" 2>/dev/null || echo "0"
}

install_node_if_needed() {
  local major
  major="$(get_node_major)"
  if [ "$major" -ge 18 ]; then
    echo "[aria-signal] 检测到 Node.js $(node -v)"
    return
  fi

  echo "[aria-signal] 未检测到 Node.js >= 18，正在安装 Node.js 20 LTS..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y curl ca-certificates gnupg
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    dnf install -y nodejs
  elif command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    yum install -y nodejs
  elif command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm nodejs npm
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache nodejs
  else
    echo "无法自动识别包管理器，请手动安装 Node.js >= 18 后重试。"
    exit 1
  fi

  major="$(get_node_major)"
  if [ "$major" -lt 18 ]; then
    echo "Node.js 安装失败，请手动安装 Node.js >= 18。"
    exit 1
  fi
  echo "[aria-signal] 已就绪 Node.js $(node -v)"
}

install_node_if_needed

mkdir -p "$INSTALL_DIR"
SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" 2>/dev/null && pwd || true)"
if [ -n "$SCRIPT_DIR" ] && [ -f "${SCRIPT_DIR}/server.mjs" ]; then
  cp "${SCRIPT_DIR}/server.mjs" "${INSTALL_DIR}/server.mjs"
else
  echo "[aria-signal] 正在下载 server.mjs..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$RAW_SERVER_URL" -o "${INSTALL_DIR}/server.mjs"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "${INSTALL_DIR}/server.mjs" "$RAW_SERVER_URL"
  else
    echo "缺少 curl 或 wget，无法下载 server.mjs。"
    exit 1
  fi
fi
chmod 755 "${INSTALL_DIR}/server.mjs"

NODE_BIN="$(command -v node)"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if command -v systemctl >/dev/null 2>&1; then
  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Aria Listen-Together Signaling Node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
Environment=PORT=${PORT}
Environment=HOST=0.0.0.0
ExecStart=${NODE_BIN} ${INSTALL_DIR}/server.mjs --port ${PORT} --host 0.0.0.0
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
  sleep 1
else
  pkill -f "${INSTALL_DIR}/server.mjs" 2>/dev/null || true
  nohup "$NODE_BIN" "${INSTALL_DIR}/server.mjs" --port "$PORT" --host 0.0.0.0 > "${INSTALL_DIR}/signal.log" 2>&1 &
  sleep 1
fi

if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -qi "Status: active"; then
  ufw allow "${PORT}/tcp" >/dev/null 2>&1 || true
fi
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld 2>/dev/null; then
  firewall-cmd --permanent --add-port="${PORT}/tcp" >/dev/null 2>&1 || true
  firewall-cmd --reload >/dev/null 2>&1 || true
fi

if command -v curl >/dev/null 2>&1; then
  HEALTH_OUT="$(curl -fsS -D - "http://127.0.0.1:${PORT}/health" 2>/dev/null || true)"
  if echo "$HEALTH_OUT" | grep -qi "x-aria-signal: 1"; then
    echo "[aria-signal] 本地健康检查通过: http://127.0.0.1:${PORT}/health"
  else
    echo "[aria-signal] 服务已启动，请检查监听状态: ss -lntp | grep :${PORT}"
  fi
fi

PUBLIC_IP=""
if command -v curl >/dev/null 2>&1; then
  PUBLIC_IP="$(curl -4fsS --max-time 3 https://api.ipify.org 2>/dev/null || curl -4fsS --max-time 3 https://ifconfig.me 2>/dev/null || true)"
fi
LOCAL_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
DISPLAY_IP="${PUBLIC_IP:-${LOCAL_IP:-你的服务器IP}}"

echo ""
echo "========================================================"
echo " Aria 自建信令节点部署完成！"
echo " 填入 Aria「网络设置 -> 信令服务器地址」："
echo "   http://${DISPLAY_IP}:${PORT}"
echo ""
echo " 注意：如果使用云服务器（阿里云/腾讯云/AWS 等），"
echo " 请在云控制台安全组放行 TCP ${PORT} 入站端口。"
echo " 若绑定了 HTTPS 域名反代，填写 https://你的域名 即可。"
echo ""
echo " 查看状态: systemctl status ${SERVICE_NAME}"
echo " 查看日志: journalctl -u ${SERVICE_NAME} -f"
echo " 卸载清理: sudo bash $0 --uninstall"
echo "========================================================"
