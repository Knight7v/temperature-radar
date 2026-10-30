#!/bin/zsh
# ============================================================
#  公司工作台 · 一键启动
#  双击本文件即可：启动服务 → 自动打开浏览器
#  关闭这个终端窗口 = 停止服务
# ============================================================

PROJECT_DIR="/Users/knight/Desktop/AI/02-HTML/workbench"
PORT="${WORKBENCH_PORT:-41873}"
URL="http://127.0.0.1:${PORT}/workbench.html"

echo "============================================"
echo "   公司工作台 · 一键启动"
echo "============================================"
echo ""

# 1. 进入项目目录
if [ ! -d "$PROJECT_DIR" ]; then
  echo "❌ 找不到项目目录："
  echo "   $PROJECT_DIR"
  echo "   项目可能被移动或重命名了。"
  echo ""
  read -r "?按回车键关闭…"
  exit 1
fi
cd "$PROJECT_DIR" || exit 1

# 2. 找到 node
NODE_BIN="/Users/knight/.workbuddy/binaries/node/versions/22.22.2-6/bin/node"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node 2>/dev/null)"
fi
if [ -z "$NODE_BIN" ]; then
  echo "❌ 没找到 Node 运行环境，无法启动。"
  echo ""
  read -r "?按回车键关闭…"
  exit 1
fi

# 3. 服务已经在跑？先确认它跑的是最新代码
#    坑：旧版只看端口有没有人占，占着就说「已经在运行」并开浏览器。
#    但接口代码是启动时缓存的，于是改了接口也永远不生效，页面报「接口不存在 / 加载失败」。
#    现在先问一下进程的代码版本（/api/_status），旧的就地停掉重起，不用你手动关窗口。
if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  FRESH="$(curl --noproxy '*' -s -m 3 "http://127.0.0.1:${PORT}/api/_status" 2>/dev/null | sed -n 's/.*"fresh":\([a-z]*\).*/\1/p')"
  if [ "$FRESH" = "true" ]; then
    echo "✅ 工作台已经在运行，正在打开页面…"
    [ -z "$WORKBENCH_NO_OPEN" ] && open "$URL"
    echo ""
    echo "   地址：$URL"
    echo "   （服务已在后台运行，这个窗口可以关掉）"
    echo ""
    exit 0
  fi
  echo "后台服务还是旧代码，正在重启（这样新接口才不会报「接口不存在」）…"
  lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | xargs -n1 kill 2>/dev/null
  for _ in {1..20}; do
    lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 0.3
  done
  if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | xargs -n1 kill -9 2>/dev/null
    sleep 0.5
  fi
  echo "   旧服务已停止"
fi

# 4. 确保数据库容器在运行
if command -v docker >/dev/null 2>&1; then
  if ! docker ps --filter name=workbench-db --format '{{.Names}}' 2>/dev/null | grep -q workbench-db; then
    echo "正在启动数据库…"
    docker start workbench-db >/dev/null 2>&1 \
      && echo "   数据库已启动" \
      || echo "   ⚠️ 数据库启动失败，部分数据可能读不出来"
  fi
fi

# 5. 启动服务
echo "正在启动服务…"
"$NODE_BIN" scripts/dev-server.js --port "$PORT" &
SERVER_PID=$!

# 6. 等端口就绪（最多 15 秒）
for _ in {1..30}; do
  if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then break; fi
  sleep 0.5
done

if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo ""
  echo "✅ 启动成功！"
  echo "   地址：$URL"
  echo ""
  echo "   ┌──────────────────────────────────────┐"
  echo "   │  浏览器已自动打开，直接用即可        │"
  echo "   │  关闭这个窗口 = 停止服务             │"
  echo "   └──────────────────────────────────────┘"
  echo ""
  [ -z "$WORKBENCH_NO_OPEN" ] && open "$URL"
  wait "$SERVER_PID"
else
  echo ""
  echo "❌ 启动失败。上面有报错信息，请截图发给助手。"
  echo ""
  read -r "?按回车键关闭…"
  exit 1
fi
