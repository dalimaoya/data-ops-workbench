#!/usr/bin/env bash
# 数据运维工作台 - 一键启动脚本 (Linux/macOS)
# 自动检测：打包模式 or 开发模式
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8580}"

echo "============================================"
echo "  数据运维工作台 Data Ops Workbench"
echo "============================================"
echo ""

# ── 检测打包产物 ──
SERVER_BIN="$SCRIPT_DIR/server/app/app"
if [ -x "$SERVER_BIN" ]; then
  # ═══════════════════════════════════════════
  #  打包模式：直接运行独立可执行文件
  # ═══════════════════════════════════════════
  echo "🚀 检测到打包产物，使用独立模式启动..."
  echo ""

  # Set environment
  export DATA_OPS_BASE_DIR="$SCRIPT_DIR"
  export DATA_OPS_DATA_DIR="$SCRIPT_DIR/data"
  mkdir -p "$SCRIPT_DIR/data" "$SCRIPT_DIR/backups" "$SCRIPT_DIR/logs"

  echo "============================================"
  echo "  访问地址: http://localhost:${PORT}"
  echo "  默认账号: admin / dalimaoya"
  echo "  按 Ctrl+C 停止服务"
  echo "============================================"
  echo ""

  exec "$SERVER_BIN" --port "$PORT"
else
  # ═══════════════════════════════════════════
  #  开发模式：需要 Python 环境
  # ═══════════════════════════════════════════
  echo "📋 未检测到打包产物，使用开发模式..."
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
  echo "🚀 启动后端服务..."
  echo "============================================"
  echo "  访问地址: http://localhost:${PORT}"
  echo "  默认账号: admin / dalimaoya"
  echo "  按 Ctrl+C 停止服务"
  echo "============================================"
  echo ""

  exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
fi
