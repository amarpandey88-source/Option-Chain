@echo off
REM ============================================================================
REM  Option Chain Pulse - Windows Build Script
REM  Run this on your Windows PC to produce the .exe installer
REM ============================================================================
REM
REM  WHAT THIS DOES:
REM    1. Installs all dependencies (including Electron)
REM    2. Builds the Next.js app
REM    3. Packages everything into a Windows .exe installer
REM    4. Output: release\OptionChainPulse-Setup-1.0.0.exe
REM
REM  REQUIREMENTS:
REM    - Node.js 20+ installed (https://nodejs.org)
REM    - Internet connection (downloads ~500MB during first build)
REM    - 2GB free disk space
REM ============================================================================

setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo   Option Chain Pulse - Windows Build Script
echo ============================================================
echo.

REM Check Node.js is installed
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed.
  echo Please install Node.js 20+ from https://nodejs.org
  pause
  exit /b 1
)

echo [1/5] Cleaning previous build (removes stale node_modules and .next)...
echo       This guarantees a fresh install/build every time - several past
echo       bugs (missing Prisma files, leftover Turbopack cache) were caused
echo       by artifacts left over from a previous install/build.
if exist node_modules (
  echo       Removing node_modules ...
  rmdir /s /q node_modules
)
if exist .next (
  echo       Removing .next ...
  rmdir /s /q .next
)

echo.
echo [2/5] Installing dependencies (this takes 3-5 minutes)...
echo       (Electron, electron-builder, concurrently and wait-on are now
echo        listed in package.json, so this one step installs everything.)
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause
  exit /b 1
)

echo.
echo [3/5] Generating Prisma client...
call npx prisma generate
if errorlevel 1 (
  echo [ERROR] Prisma generate failed.
  pause
  exit /b 1
)

echo.
echo [4/5] Building Next.js app (this takes 1-2 minutes)...
call npm run electron:build
if errorlevel 1 (
  echo [ERROR] Next.js build failed.
  pause
  exit /b 1
)

echo.
echo [5/5] Packaging Electron .exe (this takes 2-5 minutes)...
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
echo  Your .exe installer is at:
echo    release\OptionChainPulse-Setup-1.0.0.exe
echo.
echo  Double-click it to install Option Chain Pulse on any
echo  Windows PC. It creates a desktop shortcut automatically.
echo.
pause
