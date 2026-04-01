#!/usr/bin/env bash
# 数据运维工作台 - 一键启动脚本 (Linux/macOS)
# 自动检测：打包模式 or 开发模式
# v3.4.2: 健康检查轮询 + 自动打开浏览器 + 端口检测
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-9590}"
URL="http://localhost:${PORT}/loading"
HEALTH_URL="http://localhost:${PORT}/api/health"
MAX_WAIT=60

echo "============================================"
echo "  数据运维工作台 Data Ops Workbench"
echo "============================================"
echo ""

# ── 端口占用检测 ──
check_and_kill_port() {
  local pids
  pids=$(lsof -ti :"$PORT" 2>/dev/null || ss -tlnp "sport = :$PORT" 2>/dev/null | grep -oP 'pid=\K\d+' || true)
  if [ -n "$pids" ]; then
    echo "[WARN] 端口 $PORT 已被占用 (PID: $pids)，正在释放..."
    for pid in $pids; do
      kill -9 "$pid" 2>/dev/null || true
    done
    sleep 2
    echo "[OK]   端口已释放"
  fi
}

# ── 健康检查轮询 ──
wait_for_health() {
  echo "[INFO] 等待服务就绪..."
  local waited=0
  while [ "$waited" -lt "$MAX_WAIT" ]; do
    if curl -sf --connect-timeout 2 --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
      echo ""
      echo "============================================"
      echo "  ✅ 服务已就绪！"
      echo ""
      echo "  地址：  $URL"
      echo "  账号：  admin / dalimaoya"
      echo ""
      echo "  按 Ctrl+C 停止服务"
      echo "============================================"
      echo ""
      # 自动打开浏览器
      open_browser
      return 0
    fi
    printf "."
    sleep 2
    waited=$((waited + 2))
  done
  echo ""
  echo "[ERROR] 服务在 ${MAX_WAIT} 秒内未能启动"
  echo "        请查看日志：${SCRIPT_DIR}/logs/server.log"
  return 1
}

# ── 自动打开浏览器 ──
open_browser() {
  if command -v xdg-open &>/dev/null; then
    xdg-open "$URL" 2>/dev/null &
  elif command -v open &>/dev/null; then
    open "$URL" 2>/dev/null &
  elif python3 -c "import webbrowser" 2>/dev/null; then
    python3 -m webbrowser "$URL" 2>/dev/null &
  elif python -c "import webbrowser" 2>/dev/null; then
    python -m webbrowser "$URL" 2>/dev/null &
  else
    echo "[INFO] 请手动打开浏览器访问: $URL"
  fi
}

# ── 清理函数 ──
cleanup() {
  echo ""
  echo "[INFO] 正在停止服务..."
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  echo "[INFO] 服务已停止"
  exit 0
}
trap cleanup SIGINT SIGTERM

# ── 检测打包产物 ──
SERVER_BIN=""
for _candidate in "$SCRIPT_DIR/server/app/app_entry" "$SCRIPT_DIR/server/app/app" "$SCRIPT_DIR/server/app" "$SCRIPT_DIR/server/dataops-server"; do
  if [ -x "$_candidate" ]; then
    SERVER_BIN="$_candidate"
    break
  fi
done
if [ -n "$SERVER_BIN" ]; then
  # ═══════════════════════════════════════════
  #  打包模式：直接运行独立可执行文件
  # ═══════════════════════════════════════════
  echo "[MODE] 打包模式 - 无需 Python"
  echo ""

  # Set environment
  export DATA_OPS_BASE_DIR="$SCRIPT_DIR"
  export DATA_OPS_DATA_DIR="$SCRIPT_DIR/data"
  mkdir -p "$SCRIPT_DIR/data" "$SCRIPT_DIR/backups" "$SCRIPT_DIR/logs"

  # 检测端口占用
  check_and_kill_port

  # 后台启动服务
  echo "[INFO] 正在启动服务..."
  "$SERVER_BIN" --port "$PORT" > "$SCRIPT_DIR/logs/server.log" 2>&1 &
  SERVER_PID=$!

  # 健康检查
  if ! wait_for_health; then
    kill "$SERVER_PID" 2>/dev/null || true
    exit 1
  fi

  # 保持前台运行，等待用户 Ctrl+C
  echo "[INFO] 服务日志输出："
  echo "────────────────────────────────────────────"
  tail -f "$SCRIPT_DIR/logs/server.log" &
  TAIL_PID=$!

  # 等待服务进程结束
  wait "$SERVER_PID" 2>/dev/null || true
  kill "$TAIL_PID" 2>/dev/null || true
  echo "[INFO] 服务已停止"

else
  # ═══════════════════════════════════════════
  #  开发模式：需要 Python 环境
  # ═══════════════════════════════════════════
  echo "[MODE] 开发模式 - 需要 Python"
  echo ""

  BACKEND_DIR="$SCRIPT_DIR/backend"
  FRONTEND_DIR="$SCRIPT_DIR/frontend"
  WEB_DIR="$BACKEND_DIR/web"
  DATA_DIR="$SCRIPT_DIR/data"

  # ── Step 1: Check Python ──
  PYTHON=""
  for cmd in python3 python; do
    if command -v "$cmd" &>/dev/null; then
      PYTHON="$cmd"
      break
    fi
  done

  if [ -z "$PYTHON" ]; then
    echo "❌ 未找到 Python，请先安装 Python 3.9+"
    echo "   或使用打包版本（运行 build.sh 生成）"
    exit 1
  fi

  PY_VER=$("$PYTHON" --version 2>&1)
  echo "✅ 使用 $PY_VER"

  # ── Step 2: Create venv ──
  VENV_DIR="$BACKEND_DIR/.venv"
  if [ ! -d "$VENV_DIR" ]; then
    echo "📦 创建 Python 虚拟环境..."
    "$PYTHON" -m venv "$VENV_DIR"
  fi

  # Activate venv
  source "$VENV_DIR/bin/activate"
  echo "✅ 虚拟环境已激活"

  # ── Step 3: Install backend dependencies ──
  echo "📦 安装后端依赖..."
  pip install -q --upgrade pip
  pip install -q -r "$BACKEND_DIR/requirements.txt"
  echo "✅ 后端依赖安装完成"

  # ── Step 4: Build frontend (if web/ doesn't exist or is empty) ──
  if [ ! -d "$WEB_DIR" ] || [ -z "$(ls -A "$WEB_DIR" 2>/dev/null)" ]; then
    echo "🔨 前端未构建，开始构建..."
    if [ -d "$FRONTEND_DIR" ] && [ -f "$FRONTEND_DIR/package.json" ]; then
      cd "$FRONTEND_DIR"
      if command -v pnpm &>/dev/null; then
        pnpm install --frozen-lockfile 2>/dev/null || pnpm install
        pnpm run build
      elif command -v npm &>/dev/null; then
        npm install
        npm run build
      else
        echo "⚠️  未找到 pnpm 或 npm，跳过前端构建"
        echo "   请手动构建前端或安装 Node.js"
      fi
      cd "$SCRIPT_DIR"
      echo "✅ 前端构建完成"
    else
      echo "⚠️  前端源码不存在，跳过构建"
    fi
  else
    echo "✅ 前端已构建"
  fi

  # ── Step 5: Initialize database and default admin ──
  echo "🗄️  初始化数据库..."
  mkdir -p "$DATA_DIR"
  cd "$BACKEND_DIR"
  "$PYTHON" -c "
from app.database import engine, Base, SessionLocal
from app.models import *
Base.metadata.create_all(bind=engine)
from app.utils.auth import init_default_admin
db = SessionLocal()
init_default_admin(db)
db.close()
print('✅ 数据库初始化完成，默认管理员账号已创建')
"

  # ── Step 5.5: Clean __pycache__ to avoid stale .pyc issues ──
  find "$BACKEND_DIR/app" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

  # ── Step 6: Start backend server ──
  echo ""
  echo "[INFO] 正在启动服务..."
  mkdir -p "$SCRIPT_DIR/logs"

  # 检测端口占用
  check_and_kill_port

  # 后台启动
  cd "$BACKEND_DIR"
  uvicorn app.main:app --host 0.0.0.0 --port "$PORT" > "$SCRIPT_DIR/logs/server.log" 2>&1 &
  SERVER_PID=$!

  # 健康检查
  if ! wait_for_health; then
    kill "$SERVER_PID" 2>/dev/null || true
    exit 1
  fi

  # 保持前台运行
  echo "[INFO] 服务日志输出："
  echo "────────────────────────────────────────────"
  tail -f "$SCRIPT_DIR/logs/server.log" &
  TAIL_PID=$!

  wait "$SERVER_PID" 2>/dev/null || true
  kill "$TAIL_PID" 2>/dev/null || true
  echo "[INFO] 服务已停止"
fi
