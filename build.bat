@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title Data Ops Workbench - Build

echo ============================================
echo   Data Ops Workbench - Build (Windows)
echo ============================================
echo.

set "SCRIPT_DIR=%~dp0"
set "BACKEND_DIR=%SCRIPT_DIR%backend"
set "FRONTEND_DIR=%SCRIPT_DIR%frontend"
set "WEB_DIR=%BACKEND_DIR%\web"
set "DIST_DIR=%SCRIPT_DIR%dist\data-ops-workbench"
set "VENV_DIR=%BACKEND_DIR%\.venv"

:: ========== Step 1: Check Python ==========
echo [Step 1/5] Checking Python...
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Please install Python 3.9+
    echo         Download from https://www.python.org/downloads/
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('python --version 2^>^&1') do (
    echo [OK] %%i
)

:: ========== Step 2: Setup venv and install dependencies ==========
echo.
echo [Step 2/5] Setting up Python virtual environment...
if not exist "%VENV_DIR%\Scripts\activate.bat" (
    echo [INFO] Creating virtual environment...
    python -m venv "%VENV_DIR%"
    if !errorlevel! neq 0 (
        echo [ERROR] Failed to create virtual environment
        pause
        exit /b 1
    )
)
call "%VENV_DIR%\Scripts\activate.bat"
if !errorlevel! neq 0 (
    echo [ERROR] Failed to activate virtual environment
    pause
    exit /b 1
)
echo [OK] Virtual environment activated

echo [INFO] Installing backend dependencies...
python -m pip install -q --upgrade pip
python -m pip install -q -r "%BACKEND_DIR%\requirements.txt"
if !errorlevel! neq 0 (
    echo [ERROR] Failed to install backend dependencies
    pause
    exit /b 1
)

echo [INFO] Installing PyInstaller...
python -m pip install -q pyinstaller
if !errorlevel! neq 0 (
    echo [ERROR] Failed to install PyInstaller
    pause
    exit /b 1
)
echo [OK] All dependencies installed

:: ========== Step 3: Build frontend ==========
echo.
echo [Step 3/5] Building frontend...
if exist "%WEB_DIR%\index.html" (
    echo [OK] Frontend already built, skipping
    echo     To rebuild, delete %WEB_DIR% and re-run
) else (
    if exist "%FRONTEND_DIR%\package.json" (
        cd /d "%FRONTEND_DIR%"
        where pnpm >nul 2>&1
        if !errorlevel! equ 0 (
            echo [INFO] Using pnpm...
            pnpm install
            if !errorlevel! neq 0 (
                echo [ERROR] pnpm install failed
                pause
                exit /b 1
            )
            pnpm run build
            if !errorlevel! neq 0 (
                echo [ERROR] pnpm build failed
                pause
                exit /b 1
            )
        ) else (
            where npm >nul 2>&1
            if !errorlevel! equ 0 (
                echo [INFO] Using npm...
                call npm install
                if !errorlevel! neq 0 (
                    echo [ERROR] npm install failed
                    pause
                    exit /b 1
                )
                call npm run build
                if !errorlevel! neq 0 (
                    echo [ERROR] npm build failed
                    pause
                    exit /b 1
                )
            ) else (
                echo [ERROR] Neither pnpm nor npm found.
                echo         Please install Node.js 18+ from https://nodejs.org/
                pause
                exit /b 1
            )
        )
        cd /d "%SCRIPT_DIR%"
        echo [OK] Frontend build complete
    ) else (
        echo [ERROR] No frontend source found and no pre-built output
        pause
        exit /b 1
    )
)

:: ========== Step 4: PyInstaller — 后端服务 ==========
echo.
echo [Step 4/7] Building backend server (PyInstaller)...
cd /d "%BACKEND_DIR%"

:: Clean previous build artifacts
if exist "build" rmdir /s /q "build"
if exist "dist" rmdir /s /q "dist"

pyinstaller app.spec --noconfirm
if !errorlevel! neq 0 (
    echo [ERROR] PyInstaller build failed
    pause
    exit /b 1
)
echo [OK] Backend server build complete

:: ========== Step 5: PyInstaller — 桌面启动器 ==========
echo.
echo [Step 5/7] Building desktop launcher (PyInstaller)...
cd /d "%SCRIPT_DIR%"

echo [INFO] Installing launcher dependencies...
python -m pip install -q pywebview pystray Pillow psutil

set "LAUNCHER_DIST=%SCRIPT_DIR%dist\DataOpsWorkbench"
if exist "%LAUNCHER_DIST%" rmdir /s /q "%LAUNCHER_DIST%"

set "ICO_OPT="
if exist "%SCRIPT_DIR%icon.ico" set "ICO_OPT=--icon=%SCRIPT_DIR%icon.ico"

pyinstaller --noconfirm --windowed --name DataOpsWorkbench %ICO_OPT% --distpath "%SCRIPT_DIR%dist" launcher.py
if !errorlevel! neq 0 (
    echo [ERROR] Launcher PyInstaller build failed
    pause
    exit /b 1
)
echo [OK] Desktop launcher build complete

:: ========== Step 6: Assemble release directory ==========
echo.
echo [Step 6/7] Assembling release directory...
cd /d "%SCRIPT_DIR%"

set "RELEASE_DIR=%LAUNCHER_DIST%"

:: Copy backend server into release
mkdir "%RELEASE_DIR%\server" 2>nul
xcopy /E /I /Q "%BACKEND_DIR%\dist\app" "%RELEASE_DIR%\server\app"
if !errorlevel! neq 0 (
    echo [ERROR] Failed to copy backend server
    pause
    exit /b 1
)

:: Copy start scripts (fallback for non-GUI usage)
copy "%SCRIPT_DIR%start.sh" "%RELEASE_DIR%\start.sh" >nul
copy "%SCRIPT_DIR%start.bat" "%RELEASE_DIR%\start.bat" >nul

:: Copy icon and version
if exist "%SCRIPT_DIR%icon.ico" copy "%SCRIPT_DIR%icon.ico" "%RELEASE_DIR%\icon.ico" >nul
if exist "%SCRIPT_DIR%version.txt" copy "%SCRIPT_DIR%version.txt" "%RELEASE_DIR%\version.txt" >nul

:: Copy README
copy "%SCRIPT_DIR%README.md" "%RELEASE_DIR%\README.md" >nul

:: Create runtime directories
mkdir "%RELEASE_DIR%\data" 2>nul
mkdir "%RELEASE_DIR%\backups" 2>nul
mkdir "%RELEASE_DIR%\logs" 2>nul

echo [OK] Release directory assembled

:: ========== Step 7: Code signing + Defender scan ==========
echo.
echo [Step 7/7] Code signing and antivirus scan...
if exist "%SCRIPT_DIR%deploy\sign-and-scan.ps1" (
    powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%deploy\sign-and-scan.ps1"
    echo [OK] Signing and scanning complete
) else (
    echo [SKIP] deploy\sign-and-scan.ps1 not found, skipping
)

:: ========== Done ==========
echo.
echo ============================================
echo   [OK] Build complete!
echo.
echo   Output: %RELEASE_DIR%
echo.
echo   Directory structure:
echo   DataOpsWorkbench\
echo     DataOpsWorkbench.exe   Desktop launcher (pywebview)
echo     server\app\            Backend server
echo     icon.ico               Application icon
echo     version.txt            Version info
echo     data\                  Runtime data
echo     backups\               Backup storage
echo     logs\                  Log files
echo.
echo   Next steps:
echo     1. Run DataOpsWorkbench.exe to test
echo     2. Run: iscc setup.iss  to create installer
echo     3. Run: deploy\sign-and-scan.ps1  to sign installer
echo ============================================
pause
