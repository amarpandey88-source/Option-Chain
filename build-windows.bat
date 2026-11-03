@echo off
REM ============================================================================
REM  Option Chain Pulse - Windows Build Script
REM  Builds the bundled Pandas worker and the Windows Electron installer.
REM ============================================================================

setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo   Option Chain Pulse - Windows Build Script
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo Please install Node.js 20+ from https://nodejs.org
  pause
  exit /b 1
)

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python 3.11+ is not installed or is not on PATH.
  echo Install Python from https://python.org and enable "Add Python to PATH".
  pause
  exit /b 1
)

echo [1/6] Cleaning previous build...
if exist node_modules rmdir /s /q node_modules
if exist .next rmdir /s /q .next
if exist python-dist rmdir /s /q python-dist
if exist build\python-worker rmdir /s /q build\python-worker

echo.
echo [2/6] Installing Python dependencies and building Pandas worker...
call node scripts\build-python-worker.mjs
if errorlevel 1 (
  echo [ERROR] Bundled Pandas worker build failed.
  pause
  exit /b 1
)

echo.
echo [3/6] Installing Node dependencies...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

echo.
echo [4/6] Generating Prisma client...
call npx prisma generate
if errorlevel 1 (
  echo [ERROR] Prisma generate failed.
  pause
  exit /b 1
)

echo.
echo [5/6] Building Next.js app...
call npm run electron:build
if errorlevel 1 (
  echo [ERROR] Next.js build failed.
  pause
  exit /b 1
)

echo.
echo [6/6] Packaging Electron installer...
call npx electron-builder --win --x64
if errorlevel 1 (
  echo [ERROR] electron-builder failed.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   BUILD SUCCESSFUL!
echo ============================================================
echo.
echo  Installer: release\OptionChainPulse-Setup-%npm_package_version%.exe
echo.
pause