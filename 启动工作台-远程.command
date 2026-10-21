#!/bin/zsh
# ============================================================
#  观星台 · 远程访问模式（给异地同事用）
#
#  双击本文件即可：
#     启动数据库 → 启动工作台服务 → 建立一条安全隧道
#     → 得到一个公网网址，复制到剪贴板并显示在窗口里
#
#  把这个网址发给异地的同事，她在任何地方用浏览器打开就能用。
#  关闭这个终端窗口 = 停止服务，同事那边就打不开了。
# ============================================================

PROJECT_DIR="/Users/knight/Desktop/AI/02-HTML/workbench"
PORT="${WORKBENCH_PORT:-41873}"
LOCAL_URL="http://127.0.0.1:${PORT}/quality.html"
TUNNEL_LOG="/tmp/wb-tunnel.log"
ADDR_FILE="$PROJECT_DIR/公网地址.txt"
CLOUDFLARED="$PROJECT_DIR/scripts/bin/cloudflared"
STARTED_SERVER=0
TUNNEL_PID=""

echo "============================================"
echo "   观星台 · 远程访问模式"
echo "   （让异地的同事用浏览器访问）"
echo "============================================"
echo ""

# ---------- 0. 收尾清理 ----------
cleanup() {
  echo ""
  echo "正在停止远程访问…"
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null
  [ -n "$CAFFEINATE_PID" ] && kill "$CAFFEINATE_PID" 2>/dev/null
  pkill -f "cloudflared tunnel --url http://127.0.0.1:${PORT}" 2>/dev/null
  if [ "$STARTED_SERVER" = "1" ]; then
    kill "$SERVER_PID" 2>/dev/null
  fi
  rm -f "$ADDR_FILE"
  echo "已停止。同事那边的网址已失效。"
  exit 0
}
trap cleanup INT TERM EXIT

# ---------- 1. 项目目录 ----------
if [ ! -d "$PROJECT_DIR" ]; then
  echo "❌ 找不到项目目录："
  echo "   $PROJECT_DIR"
  read -r "?按回车键关闭…"
  exit 1
fi
cd "$PROJECT_DIR" || exit 1

# ---------- 2. node ----------
NODE_BIN="/Users/knight/.workbuddy/binaries/node/versions/22.22.2-6/bin/node"
[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node 2>/dev/null)"
if [ -z "$NODE_BIN" ]; then
  echo "❌ 没找到 Node 运行环境，无法启动。"
  read -r "?按回车键关闭…"
  exit 1
fi

# ---------- 3. 隧道客户端 ----------
if [ ! -x "$CLOUDFLARED" ]; then
  echo "第一次使用，正在准备隧道组件…"
  mkdir -p "$PROJECT_DIR/scripts/bin"
  curl -sL --max-time 120 -o /tmp/cf-dl.tgz \
    "https://ghfast.top/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz" \
    && tar xzf /tmp/cf-dl.tgz -C "$PROJECT_DIR/scripts/bin" \
    && chmod +x "$CLOUDFLARED" \
    && rm -f /tmp/cf-dl.tgz
  if [ ! -x "$CLOUDFLARED" ]; then
    echo "❌ 隧道组件下载失败，请检查网络后重试。"
    read -r "?按回车键关闭…"
    exit 1
  fi
  echo "   隧道组件已就绪"
fi

# ---------- 4. 数据库 ----------
if command -v docker >/dev/null 2>&1; then
  if ! docker ps --filter name=workbench-db --format '{{.Names}}' 2>/dev/null | grep -q workbench-db; then
    echo "正在启动数据库…"
    docker start workbench-db >/dev/null 2>&1 \
      && echo "   数据库已启动" \
      || echo "   ⚠️ 数据库启动失败，部分数据可能读不出来"
  fi
fi

# ---------- 5. 工作台服务 ----------
if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✅ 工作台服务已在运行，直接复用"
else
  echo "正在启动工作台服务…"
  "$NODE_BIN" scripts/dev-server.js --port "$PORT" > /tmp/wb-server.log 2>&1 &
  SERVER_PID=$!
  STARTED_SERVER=1
  for _ in {1..30}; do
    lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && break
    sleep 0.5
  done
  if ! lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "❌ 工作台服务启动失败，最近日志："
    tail -5 /tmp/wb-server.log
    read -r "?按回车键关闭…"
    exit 1
  fi
  echo "   服务已启动"
fi

# ---------- 6. 建立隧道 ----------
echo "正在打通外网通道…"

# 防止电脑空闲自动睡眠（睡眠后同事那边就断了）。关闭窗口时一起结束。
caffeinate -i -w $$ >/dev/null 2>&1 &
CAFFEINATE_PID=$!

pkill -f "cloudflared tunnel --url http://127.0.0.1:${PORT}" 2>/dev/null
sleep 1
rm -f "$TUNNEL_LOG"
"$CLOUDFLARED" tunnel --url "http://127.0.0.1:${PORT}" --no-autoupdate > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

PUBLIC_URL=""
for _ in {1..60}; do
  PUBLIC_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
  [ -n "$PUBLIC_URL" ] && break
  sleep 0.5
done

if [ -z "$PUBLIC_URL" ]; then
  echo "❌ 外网通道没建立起来，最近日志："
  tail -8 "$TUNNEL_LOG"
  read -r "?按回车键关闭…"
  exit 1
fi

# ---------- 7. 自检：确认外面真的能打开 ----------
# 两个坑：① 新域名的 DNS 要几秒到几十秒才全球生效，必须边等边查；
#         ② 本机 DNS 会缓存「域名不存在」，所以用公共 DNS 拿 IP 再 --connect-to 绕过。
QUALITY_URL="${PUBLIC_URL}/quality.html"
HOST_ONLY="${PUBLIC_URL#https://}"
READY=""
echo -n "   正在等待外网生效"
for _ in {1..20}; do
  CHECK_IP=$(dig @223.5.5.5 +short +time=3 +tries=1 "$HOST_ONLY" A 2>/dev/null | head -1)
  [ -z "$CHECK_IP" ] && CHECK_IP=$(dig @8.8.8.8 +short +time=3 +tries=1 "$HOST_ONLY" A 2>/dev/null | head -1)
  if [ -n "$CHECK_IP" ]; then
    CODE=$(curl --noproxy '*' --connect-to "$HOST_ONLY:443:$CHECK_IP:443" \
      -s -o /dev/null -w '%{http_code}' --max-time 12 "$QUALITY_URL" 2>/dev/null)
    if [ "$CODE" = "200" ]; then READY="1"; break; fi
  fi
  echo -n "."
  sleep 3
done
echo ""

# ---------- 8. 交付地址 ----------
echo ""
if [ -n "$READY" ]; then
  echo "✅ 远程访问已就绪"
else
  echo "⚠️ 通道已建立，但自检没通过（可能刚启动还没准备好，稍等再试）"
fi
echo ""
echo "   ╔══════════════════════════════════════════════════════════╗"
echo "   ║  把这个网址发给异地的同事：                              ║"
echo "   ╚══════════════════════════════════════════════════════════╝"
echo ""
echo "   $QUALITY_URL"
echo ""
if [ -f "$PROJECT_DIR/本地账号.txt" ]; then
  sed -n '3,4p' "$PROJECT_DIR/本地账号.txt" | sed 's/^/   /'
else
  echo "   账号密码见「本地账号.txt」（文件不在了，让助手帮你查）"
fi
echo ""
echo "   ┌──────────────────────────────────────────────────────┐"
echo "   │  网址已复制到剪贴板，直接粘贴给同事即可               │"
echo "   │  ⚠️ 关闭这个窗口 = 关站，同事那边就打不开了           │"
echo "   │  ⚠️ 每次重新启动，网址会变，要重新发一次               │"
echo "   │  你自己电脑打不开这个网址是正常的（本地 DNS 缓存），   │"
echo "   │  不影响异地同事，她那边能正常打开。                   │"
echo "   └──────────────────────────────────────────────────────┘"
echo ""

printf '%s\n' "$QUALITY_URL" > "$ADDR_FILE"
printf '%s' "$QUALITY_URL" | pbcopy 2>/dev/null

# 本地用 127.0.0.1 打开，避免本机 DNS 缓存造成「打不开」的错觉
[ -z "$WORKBENCH_NO_OPEN" ] && open "$LOCAL_URL"

wait "$TUNNEL_PID" 2>/dev/null
