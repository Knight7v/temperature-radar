#!/bin/zsh
# 比价采集包装脚本：给 launchd / crontab 调用
# 18 点之后跑的那一轮只采「重点机型」，避免大促当晚结果太晚出来

PROJECT_DIR="/Users/knight/Desktop/AI/02-HTML/workbench"
cd "$PROJECT_DIR" || exit 1

NODE_BIN="/Users/knight/.workbuddy/binaries/node/versions/22.22.2-6/bin/node"
[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node)"
[ -z "$NODE_BIN" ] && exit 1

HOUR=$(date +%H)
ARGS=()
if [ "$HOUR" -ge 18 ]; then
  ARGS=(--focus --slot=focus)
else
  ARGS=(--slot=full)
fi

mkdir -p "$PROJECT_DIR/data"
{
  echo ""
  echo "===== $(date '+%Y-%m-%d %H:%M:%S') 开始 ${ARGS[*]} ====="
  "$NODE_BIN" scripts/price-crawl.js "${ARGS[@]}" 2>&1
  echo "===== $(date '+%Y-%m-%d %H:%M:%S') 结束 code=$? ====="
} >> "$PROJECT_DIR/data/price-crawl.log"
