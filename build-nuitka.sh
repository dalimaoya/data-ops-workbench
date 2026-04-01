#!/usr/bin/env bash
# 数据运维工作台 - Nuitka 原生编译打包脚本 (Linux)
# 替代 PyInstaller，将 Python 代码编译为原生 C 二进制
# 生成独立发布包，用户无需安装 Python/Node.js 即可运行
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
WEB_DIR="$BACKEND_DIR/web"
DIST_DIR="$SCRIPT_DIR/dist/data-ops-workbench"
VENV_DIR="$BACKEND_DIR/.venv"
VERSION="3.3.1"
RELEASE_NAME="data-ops-workbench-v${VERSION}-linux-x64"

echo "============================================"
echo "  数据运维工作台 - Nuitka 原生编译打包"
echo "  版本: v${VERSION}"
echo "============================================"
echo ""

# ── Step 0: Check C compiler ──
if ! command -v gcc &>/dev/null; then
  echo "❌ 未找到 gcc，请先安装: yum install gcc gcc-c++ 或 apt install gcc g++"
  exit 1
fi
echo "✅ C 编译器: $(gcc --version | head -1)"

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

echo "📦 安装 Nuitka 及编译依赖..."
pip install -q nuitka ordered-set zstandard

echo "✅ 依赖安装完成"

# ── Step 3: Build frontend (if needed) ──
echo ""
echo "🔨 检查前端构建..."
if [ ! -d "$WEB_DIR" ] || [ -z "$(ls -A "$WEB_DIR" 2>/dev/null)" ]; then
  if [ -d "$FRONTEND_DIR" ] && [ -f "$FRONTEND_DIR/package.json" ]; then
    echo "🔨 构建前端..."
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
    echo "❌ 前端源码不存在且无构建产物"
    exit 1
  fi
else
  echo "✅ 前端已构建，跳过"
fi

# ── Step 4: Nuitka 编译 ──
echo ""
echo "🔧 Nuitka 原生编译中（这可能需要 10-30 分钟）..."
echo "   编译模式: --standalone（目录模式）"
echo ""
cd "$BACKEND_DIR"

# Clean previous Nuitka build
rm -rf app_entry.build/ app_entry.dist/ app_entry.onefile-build/ 2>/dev/null

# Build the include-data-dir arguments
NUITKA_DATA_ARGS=""

# Include web/ frontend static files
if [ -d "$WEB_DIR" ]; then
  NUITKA_DATA_ARGS="$NUITKA_DATA_ARGS --include-data-dir=$WEB_DIR=web"
  echo "  📂 包含前端静态文件: web/"
fi

# Include i18n locale files
I18N_DIR="$BACKEND_DIR/app/i18n/locales"
if [ -d "$I18N_DIR" ]; then
  NUITKA_DATA_ARGS="$NUITKA_DATA_ARGS --include-data-dir=$I18N_DIR=app/i18n/locales"
  echo "  📂 包含国际化文件: app/i18n/locales/"
fi

# Include plugin manifest.json files
PLUGINS_DIR="$BACKEND_DIR/app/plugins"
if [ -d "$PLUGINS_DIR" ]; then
  for pdir in "$PLUGINS_DIR"/*/; do
    pname=$(basename "$pdir")
    manifest="$pdir/manifest.json"
    if [ -f "$manifest" ]; then
      NUITKA_DATA_ARGS="$NUITKA_DATA_ARGS --include-data-files=$manifest=app/plugins/$pname/manifest.json"
    fi
  done
  echo "  📂 包含插件 manifest 文件"
fi

# Nuitka compilation with all necessary flags
python -m nuitka \
  --standalone \
  --output-dir="$BACKEND_DIR/nuitka-out" \
  --output-filename=dataops-server \
  --python-flag=no_site \
  --python-flag=no_warnings \
  \
  --follow-imports \
  --include-package=app \
  --include-package=app.routers \
  --include-package=app.plugins \
  --include-package=app.plugins.plugin_notification \
  --include-package=app.plugins.plugin_approval \
  --include-package=app.plugins.plugin_backup \
  --include-package=app.plugins.plugin_report \
  --include-package=app.plugins.plugin_scheduler \
  --include-package=app.plugins.plugin_health_check \
  --include-package=app.plugins.plugin_batch_ops \
  --include-package=app.plugins.plugin_smart_import \
  --include-package=app.plugins.plugin_ai_assistant \
  --include-package=app.plugins.plugin_db_manager \
  --include-package=app.plugins.plugin_data_mask \
  --include-package=app.plugins.plugin_notify_push \
  --include-package=app.plugins.plugin_data_trend \
  --include-package=app.plugins.plugin_audit_export \
  --include-package=app.plugins.plugin_data_compare \
  --include-package=app.plugins.plugin_template_market \
  --include-package=app.plugins.plugin_ai_predict \
  --include-package=app.plugins.plugin_webhook \
  --include-package=app.plugins.plugin_sql_console \
  --include-package=app.utils \
  --include-package=app.schemas \
  --include-package=app.ai \
  --include-package=app.i18n \
  --include-package=app.scheduler \
  \
  --include-package=uvicorn \
  --include-package=uvicorn.loops \
  --include-package=uvicorn.protocols \
  --include-package=uvicorn.lifespan \
  --include-package=fastapi \
  --include-package=starlette \
  --include-package=starlette.middleware \
  --include-package=sqlalchemy \
  --include-package=sqlalchemy.dialects.sqlite \
  --include-package=sqlalchemy.dialects.mysql \
  --include-package=sqlalchemy.dialects.postgresql \
  --include-package=pydantic \
  --include-package=pydantic_core \
  --include-package=annotated_types \
  --include-package=anyio \
  --include-package=anyio._backends \
  --include-package=sniffio \
  --include-package=pymysql \
  --include-package=passlib \
  --include-package=passlib.handlers \
  --include-package=jose \
  --include-package=bcrypt \
  --include-package=cryptography \
  --include-package=httpx \
  --include-package=openpyxl \
  --include-package=PIL \
  --include-package=pdfplumber \
  --include-package=pdfminer \
  --include-package=docx \
  --include-package=pandas \
  --include-package=apscheduler \
  --include-package=reportlab \
  --include-package=slowapi \
  --include-package=multipart \
  --include-package=email_validator \
  --include-package=aiosqlite \
  \
  --include-module=uvloop \
  --include-module=httptools \
  --include-module=oracledb \
  \
  --nofollow-import-to=tkinter \
  --nofollow-import-to=matplotlib \
  --nofollow-import-to=scipy \
  --nofollow-import-to=IPython \
  --nofollow-import-to=notebook \
  --nofollow-import-to=pytest \
  --nofollow-import-to=setuptools \
  --nofollow-import-to=pip \
  --nofollow-import-to=pandas.tests \
  --nofollow-import-to=aiosqlite.tests \
  --nofollow-import-to=sqlalchemy.testing \
  --nofollow-import-to=PIL.tests \
  --nofollow-import-to=openpyxl.tests \
  --nofollow-import-to=unittest \
  --nofollow-import-to=test \
  --nofollow-import-to=distutils \
  \
  --jobs=1 \
  \
  --include-package-data=reportlab \
  --include-package-data=pdfminer \
  --include-package-data=certifi \
  $NUITKA_DATA_ARGS \
  \
  --assume-yes-for-downloads \
  app_entry.py \
  2>&1 | tee "$SCRIPT_DIR/nuitka-build.log"

BUILD_EXIT=${PIPESTATUS[0]}
if [ $BUILD_EXIT -ne 0 ]; then
  echo ""
  echo "❌ Nuitka 编译失败，退出码: $BUILD_EXIT"
  echo "   查看完整日志: $SCRIPT_DIR/nuitka-build.log"
  exit $BUILD_EXIT
fi

echo ""
echo "✅ Nuitka 编译完成"

# ── Step 5: Assemble release directory ──
echo ""
echo "📁 组装发布目录..."
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/server"

# Copy Nuitka output (standalone directory mode)
NUITKA_DIST="$BACKEND_DIR/nuitka-out/app_entry.dist"
if [ ! -d "$NUITKA_DIST" ]; then
  echo "❌ 未找到 Nuitka 编译产物: $NUITKA_DIST"
  exit 1
fi

cp -r "$NUITKA_DIST" "$DIST_DIR/server/app"

# Copy start scripts
cp "$SCRIPT_DIR/start.sh" "$DIST_DIR/start.sh"
chmod +x "$DIST_DIR/start.sh"
cp "$SCRIPT_DIR/start.bat" "$DIST_DIR/start.bat" 2>/dev/null || true

# Copy README
cp "$SCRIPT_DIR/README.md" "$DIST_DIR/README.md"

# Create empty runtime dirs
for d in data backups logs; do
  mkdir -p "$DIST_DIR/$d"
  touch "$DIST_DIR/$d/.gitkeep"
done

echo "✅ 发布目录组装完成"

# ── Step 6: Create release tarball ──
echo ""
echo "📦 打包 release..."
mkdir -p "$SCRIPT_DIR/release"
cd "$SCRIPT_DIR/dist"
tar -czf "$SCRIPT_DIR/release/${RELEASE_NAME}.tar.gz" data-ops-workbench/
TARBALL_SIZE=$(du -sh "$SCRIPT_DIR/release/${RELEASE_NAME}.tar.gz" | cut -f1)
echo "✅ Release 打包完成: release/${RELEASE_NAME}.tar.gz ($TARBALL_SIZE)"

# ── Step 7: Summary ──
echo ""
echo "============================================"
echo "  ✅ Nuitka 原生编译打包完成！"
echo "============================================"
echo ""
echo "  发布目录: $DIST_DIR"
echo "  Release:  release/${RELEASE_NAME}.tar.gz ($TARBALL_SIZE)"
echo ""
echo "  目录结构:"
echo "  data-ops-workbench/"
echo "  ├── start.sh"
echo "  ├── server/"
echo "  │   └── app/      (原生编译二进制及依赖)"
echo "  ├── data/"
echo "  ├── backups/"
echo "  ├── logs/"
echo "  └── README.md"
echo ""
echo "  使用方法:"
echo "  cd dist/data-ops-workbench && ./start.sh"
echo "============================================"
