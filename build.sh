#!/usr/bin/env bash
# 数据运维工作台 - 一键打包构建脚本 (Linux)
# 生成独立发布包，用户无需安装 Python/Node.js 即可运行
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
WEB_DIR="$BACKEND_DIR/web"
DIST_DIR="$SCRIPT_DIR/dist/data-ops-workbench"
VENV_DIR="$BACKEND_DIR/.venv"

echo "============================================"
echo "  数据运维工作台 - 打包构建"
echo "============================================"
echo ""

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
  exit 1
fi

echo "✅ 使用 $($PYTHON --version 2>&1)"

# ── Step 2: Setup venv and install dependencies ──
if [ ! -d "$VENV_DIR" ]; then
  echo "📦 创建 Python 虚拟环境..."
  "$PYTHON" -m venv "$VENV_DIR"
fi
source "$VENV_DIR/bin/activate"

echo "📦 安装后端依赖..."
pip install -q --upgrade pip
pip install -q -r "$BACKEND_DIR/requirements.txt"

echo "📦 安装 PyInstaller..."
pip install -q pyinstaller

echo "✅ 依赖安装完成"

# ── Step 3: Build frontend ──
echo ""
echo "🔨 构建前端..."
if [ -d "$FRONTEND_DIR" ] && [ -f "$FRONTEND_DIR/package.json" ]; then
  cd "$FRONTEND_DIR"
  if command -v pnpm &>/dev/null; then
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    pnpm run build
  elif command -v npm &>/dev/null; then
    npm install
    npm run build
  else
    echo "❌ 未找到 pnpm 或 npm，无法构建前端"
    exit 1
  fi
  cd "$SCRIPT_DIR"
  echo "✅ 前端构建完成"
else
  if [ -d "$WEB_DIR" ] && [ -f "$WEB_DIR/index.html" ]; then
    echo "✅ 前端已构建，跳过"
  else
    echo "❌ 前端源码不存在且无构建产物"
    exit 1
  fi
fi

# ── Step 4: PyInstaller 打包 ──
echo ""
echo "📦 PyInstaller 打包中..."
cd "$BACKEND_DIR"

# Clean previous build
rm -rf build/ dist/

pyinstaller app.spec --noconfirm

echo "✅ PyInstaller 打包完成"

# ── Step 5: Assemble release directory ──
echo ""
echo "📁 组装发布目录..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/server"

# Copy PyInstaller output (onedir mode: dist/app/ directory)
cp -r "$BACKEND_DIR/dist/app" "$DIST_DIR/server/app"

# Copy start scripts
cp "$SCRIPT_DIR/start.sh" "$DIST_DIR/start.sh"
chmod +x "$DIST_DIR/start.sh"
cp "$SCRIPT_DIR/start.bat" "$DIST_DIR/start.bat"

# Copy README
cp "$SCRIPT_DIR/README.md" "$DIST_DIR/README.md"

# Create empty runtime dirs with .gitkeep
for d in data backups logs; do
  mkdir -p "$DIST_DIR/$d"
  touch "$DIST_DIR/$d/.gitkeep"
done

echo ""
echo "============================================"
echo "  ✅ 打包完成！"
echo "  发布目录: $DIST_DIR"
echo ""
echo "  目录结构:"
echo "  data-ops-workbench/"
echo "  ├── start.sh"
echo "  ├── start.bat"
echo "  ├── server/"
echo "  │   └── app/      (可执行文件及依赖)"
echo "  ├── data/"
echo "  ├── backups/"
echo "  ├── logs/"
echo "  └── README.md"
echo ""
echo "  使用方法:"
echo "  cd dist/data-ops-workbench && ./start.sh"
echo "============================================"
