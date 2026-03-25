@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title Data Ops Workbench

echo ============================================
echo   Data Ops Workbench
echo ============================================
echo.

set "SCRIPT_DIR=%~dp0"
set "PORT=8580"

:: --- Detect packaged binary ---
set "SERVER_BIN=%SCRIPT_DIR%server\app\app.exe"
if exist "%SERVER_BIN%" (
    echo [MODE] Packaged mode - no Python required
    echo.

    set "DATA_OPS_BASE_DIR=%SCRIPT_DIR%"
    set "DATA_OPS_DATA_DIR=%SCRIPT_DIR%data"
    if not exist "%SCRIPT_DIR%data" mkdir "%SCRIPT_DIR%data"
    if not exist "%SCRIPT_DIR%backups" mkdir "%SCRIPT_DIR%backups"
    if not exist "%SCRIPT_DIR%logs" mkdir "%SCRIPT_DIR%logs"

    echo ============================================
    echo   URL:     http://localhost:%PORT%
    echo   Account: admin / dalimaoya
    echo   Press Ctrl+C to stop
    echo ============================================
    echo.

    "%SERVER_BIN%" --port %PORT%
    goto :end
)

:: --- Development mode ---
echo [MODE] Development mode - Python required
echo.

set "BACKEND_DIR=%SCRIPT_DIR%backend"
set "FRONTEND_DIR=%SCRIPT_DIR%frontend"
set "WEB_DIR=%BACKEND_DIR%\web"
set "DATA_DIR=%SCRIPT_DIR%data"

:: Step 1: Check Python
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Please install Python 3.9+
    echo         Or use the packaged version.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('python --version 2^>^&1') do set PY_VER=%%i
echo [OK] %PY_VER%

:: Step 2: Create venv
set "VENV_DIR=%BACKEND_DIR%\.venv"
if not exist "%VENV_DIR%\Scripts\activate.bat" (
    echo [INFO] Creating Python virtual environment...
    python -m venv "%VENV_DIR%"
    if !errorlevel! neq 0 (
        echo [ERROR] Failed to create virtual environment
        pause
        exit /b 1
    )
)

:: Activate venv
call "%VENV_DIR%\Scripts\activate.bat"
if !errorlevel! neq 0 (
    echo [ERROR] Failed to activate virtual environment
    pause
    exit /b 1
)
echo [OK] Virtual environment activated

:: Step 3: Install dependencies
echo [INFO] Installing backend dependencies...
python -m pip install -q -r "%BACKEND_DIR%\requirements.txt"
if !errorlevel! neq 0 (
    echo [ERROR] Failed to install dependencies
    pause
    exit /b 1
)
echo [OK] Backend dependencies installed

:: Step 4: Build frontend if needed
if not exist "%WEB_DIR%\index.html" (
    echo [INFO] Frontend not built, building now...
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
                echo [WARN] pnpm/npm not found, skipping frontend build
            )
        )
        cd /d "%SCRIPT_DIR%"
    )
) else (
    echo [OK] Frontend already built
)

:: Step 5: Initialize database
echo [INFO] Initializing database...
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
cd /d "%BACKEND_DIR%"
python -c "from app.database import engine, Base, SessionLocal; from app.models import *; Base.metadata.create_all(bind=engine); from app.utils.auth import init_default_admin; db = SessionLocal(); init_default_admin(db); db.close(); print('[OK] Database initialized')"
if !errorlevel! neq 0 (
    echo [ERROR] Database initialization failed
    pause
    exit /b 1
)

:: Step 5.5: Clean pycache to avoid stale .pyc issues
for /d /r "%BACKEND_DIR%\app" %%d in (__pycache__) do (
    if exist "%%d" rd /s /q "%%d" 2>nul
)

:: Step 6: Start server
echo.
echo ============================================
echo   URL:     http://localhost:%PORT%
echo   Account: admin / dalimaoya
echo   Press Ctrl+C to stop
echo ============================================
echo.

python -m uvicorn app.main:app --host 0.0.0.0 --port %PORT%

:end
pause
