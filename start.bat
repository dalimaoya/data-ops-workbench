@echo off
:: 数据运维工作台 - Windows 启动脚本
:: v3.4.2: 端口检测 + 健康检查轮询 + 自动打开浏览器
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title 数据运维工作台

echo ============================================
echo   数据运维工作台  Data Ops Workbench
echo ============================================
echo.

set "SCRIPT_DIR=%~dp0"
set "PORT=9590"
set "URL=http://localhost:%PORT%/loading"
set "HEALTH_URL=http://localhost:%PORT%/api/health"
set "MAX_WAIT=60"

:: --------------------------------------------
:: Step 1: 检测端口占用
:: --------------------------------------------
echo [INFO] 检测端口 %PORT% ...
set "PORT_IN_USE=0"

for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT% " ^| findstr "LISTENING" 2^>nul') do (
    set "OLD_PID=%%a"
    set "PORT_IN_USE=1"
)

if "!PORT_IN_USE!"=="1" (
    echo [WARN] 端口 %PORT% 已被进程 !OLD_PID! 占用
    echo [INFO] 正在终止旧进程 ...
    taskkill /F /PID !OLD_PID! >nul 2>&1
    if !errorlevel! equ 0 (
        echo [OK]   旧进程已终止
        :: 等待端口释放
        timeout /t 2 /nobreak >nul
    ) else (
        echo [WARN] 无法终止旧进程，请手动关闭后重试
        echo        或者以管理员身份运行此脚本
        pause
        exit /b 1
    )
)

:: --------------------------------------------
:: Step 2: 定位 dataops-server
:: --------------------------------------------
set "SERVER_BIN=%SCRIPT_DIR%server\app\app_entry.exe"
if not exist "%SERVER_BIN%" set "SERVER_BIN=%SCRIPT_DIR%server\app\app.exe"
if not exist "!SERVER_BIN!" set "SERVER_BIN=%SCRIPT_DIR%server\app.exe"
if not exist "!SERVER_BIN!" set "SERVER_BIN=%SCRIPT_DIR%server\dataops-server.exe"
if not exist "!SERVER_BIN!" set "SERVER_BIN=%SCRIPT_DIR%server\app\dataops-server.exe"
if not exist "!SERVER_BIN!" (
    :: 回退到开发模式
    goto :dev_mode
)

echo [MODE] 打包模式 - 无需 Python
echo.

:: 确保运行时目录存在
set "DATA_OPS_BASE_DIR=%SCRIPT_DIR%"
set "DATA_OPS_DATA_DIR=%SCRIPT_DIR%data"
if not exist "%SCRIPT_DIR%data" mkdir "%SCRIPT_DIR%data"
if not exist "%SCRIPT_DIR%backups" mkdir "%SCRIPT_DIR%backups"
if not exist "%SCRIPT_DIR%logs" mkdir "%SCRIPT_DIR%logs"

:: --------------------------------------------
:: Step 3: 后台启动服务
:: --------------------------------------------
echo [INFO] 正在启动服务 ...
start "" /B cmd /c ""!SERVER_BIN!" --port %PORT% > "%SCRIPT_DIR%logs\server.log" 2>&1"

:: 记录后台进程 PID（通过端口查找）
set "SERVER_PID="

:: --------------------------------------------
:: Step 4: 健康检查轮询
:: --------------------------------------------
echo [INFO] 等待服务就绪 ...
echo.

set /a "WAITED=0"
set /a "INTERVAL=2"

:health_loop
if !WAITED! geq %MAX_WAIT% (
    echo.
    echo [ERROR] 服务在 %MAX_WAIT% 秒内未能启动
    echo         请查看日志：%SCRIPT_DIR%logs\server.log
    pause
    exit /b 1
)

:: 使用 PowerShell 做 HTTP 健康检查（兼容性最好）
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%HEALTH_URL%' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1

if !errorlevel! equ 0 (
    goto :health_ok
)

:: 检查服务进程是否还活着
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT% " ^| findstr "LISTENING" 2^>nul') do (
    set "SERVER_PID=%%a"
)

<nul set /p "=."
timeout /t %INTERVAL% /nobreak >nul
set /a "WAITED+=INTERVAL"
goto :health_loop

:health_ok
echo.
echo.
echo ============================================
echo   [OK] 服务已就绪！
echo.
echo   地址：  %URL%
echo   账号：  admin / dalimaoya
echo.
echo   按 Ctrl+C 停止服务
echo ============================================
echo.

:: --------------------------------------------
:: Step 5: 自动打开浏览器
:: --------------------------------------------
start "" "%URL%"

:: --------------------------------------------
:: Step 6: 保持前台运行，实时显示日志
:: --------------------------------------------
echo [INFO] 服务日志输出：
echo --------------------------------------------

:: 获取服务进程 PID
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT% " ^| findstr "LISTENING" 2^>nul') do (
    set "SERVER_PID=%%a"
)

:: 实时 tail 日志文件，同时等待服务进程结束
:tail_loop
if defined SERVER_PID (
    :: 检查进程是否还在
    tasklist /FI "PID eq !SERVER_PID!" 2>nul | findstr "!SERVER_PID!" >nul 2>&1
    if !errorlevel! neq 0 (
        echo.
        echo [INFO] 服务已停止
        goto :end
    )
)
:: 显示最新日志
if exist "%SCRIPT_DIR%logs\server.log" (
    powershell -NoProfile -Command "Get-Content '%SCRIPT_DIR%logs\server.log' -Tail 5 -ErrorAction SilentlyContinue" 2>nul
)
timeout /t 3 /nobreak >nul
goto :tail_loop

:: ============================================
:: 开发模式
:: ============================================
:dev_mode
echo [MODE] 开发模式 - 需要 Python
echo.

set "BACKEND_DIR=%SCRIPT_DIR%backend"
set "FRONTEND_DIR=%SCRIPT_DIR%frontend"
set "WEB_DIR=%BACKEND_DIR%\web"
set "DATA_DIR=%SCRIPT_DIR%data"

:: Check Python
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] 未找到 Python，请安装 Python 3.9+
    echo         或使用打包版本
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('python --version 2^>^&1') do set PY_VER=%%i
echo [OK] %PY_VER%

:: Create venv
set "VENV_DIR=%BACKEND_DIR%\.venv"
if not exist "%VENV_DIR%\Scripts\activate.bat" (
    echo [INFO] 创建 Python 虚拟环境 ...
    python -m venv "%VENV_DIR%"
    if !errorlevel! neq 0 (
        echo [ERROR] 创建虚拟环境失败
        pause
        exit /b 1
    )
)

call "%VENV_DIR%\Scripts\activate.bat"
if !errorlevel! neq 0 (
    echo [ERROR] 激活虚拟环境失败
    pause
    exit /b 1
)
echo [OK] 虚拟环境已激活

:: Install dependencies
echo [INFO] 安装后端依赖 ...
python -m pip install -q -r "%BACKEND_DIR%\requirements.txt"
if !errorlevel! neq 0 (
    echo [ERROR] 安装依赖失败
    pause
    exit /b 1
)
echo [OK] 后端依赖已安装

:: Build frontend if needed
if not exist "%WEB_DIR%\index.html" (
    echo [INFO] 前端未构建，正在构建 ...
    if exist "%FRONTEND_DIR%\package.json" (
        cd /d "%FRONTEND_DIR%"
        where pnpm >nul 2>&1
        if !errorlevel! equ 0 (
            pnpm install
            pnpm run build
        ) else (
            where npm >nul 2>&1
            if !errorlevel! equ 0 (
                npm install
                npm run build
            ) else (
                echo [WARN] 未找到 pnpm/npm，跳过前端构建
            )
        )
        cd /d "%SCRIPT_DIR%"
    )
) else (
    echo [OK] 前端已构建
)

:: Initialize database
echo [INFO] 初始化数据库 ...
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
cd /d "%BACKEND_DIR%"
python -c "from app.database import engine, Base, SessionLocal; from app.models import *; Base.metadata.create_all(bind=engine); from app.utils.auth import init_default_admin; db = SessionLocal(); init_default_admin(db); db.close(); print('[OK] 数据库初始化完成')"
if !errorlevel! neq 0 (
    echo [ERROR] 数据库初始化失败
    pause
    exit /b 1
)

:: Clean pycache
for /d /r "%BACKEND_DIR%\app" %%d in (__pycache__) do (
    if exist "%%d" rd /s /q "%%d" 2>nul
)

:: Start server (dev mode runs in foreground with health check + auto browser)
echo.
echo [INFO] 正在启动开发服务器 ...

:: 后台启动
if not exist "%SCRIPT_DIR%logs" mkdir "%SCRIPT_DIR%logs"
start "" /B cmd /c "python -m uvicorn app.main:app --host 0.0.0.0 --port %PORT% > "%SCRIPT_DIR%logs\server.log" 2>&1"

echo [INFO] 等待服务就绪 ...
set /a "WAITED=0"

:dev_health_loop
if !WAITED! geq %MAX_WAIT% (
    echo.
    echo [ERROR] 服务在 %MAX_WAIT% 秒内未能启动
    pause
    exit /b 1
)

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%HEALTH_URL%' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1

if !errorlevel! equ 0 (
    goto :dev_health_ok
)

<nul set /p "=."
timeout /t %INTERVAL% /nobreak >nul
set /a "WAITED+=INTERVAL"
goto :dev_health_loop

:dev_health_ok
echo.
echo.
echo ============================================
echo   [OK] 服务已就绪！
echo.
echo   地址：  %URL%
echo   账号：  admin / dalimaoya
echo   按 Ctrl+C 停止
echo ============================================
echo.

:: 自动打开浏览器
start "" "%URL%"

:: 前台显示日志
echo [INFO] 服务日志输出：
echo --------------------------------------------
if exist "%SCRIPT_DIR%logs\server.log" (
    powershell -NoProfile -Command "Get-Content '%SCRIPT_DIR%logs\server.log' -Wait"
)

:end
pause
