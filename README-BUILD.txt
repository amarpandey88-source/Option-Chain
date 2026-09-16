================================================================
  OPTION CHAIN PULSE — Build .exe for Windows
================================================================

WHAT YOU'RE GETTING
-------------------
This project is a Next.js web app. To turn it into a Windows .exe
desktop application, we use Electron to wrap the web app in a
native Windows window. The result is a normal .exe installer
that creates a desktop shortcut — like any other Windows app.

REQUIREMENTS (on your Windows PC)
---------------------------------
1. Windows 10 or Windows 11 (64-bit)
2. Node.js 20 or newer — download from https://nodejs.org
   (Choose the "LTS" version, install with default options)
3. 2 GB free disk space
4. Internet connection (downloads ~500 MB during first build)

STEP-BY-STEP BUILD INSTRUCTIONS
-------------------------------

1. UNZIP THE PROJECT
   Right-click option-chain-pulse.zip → "Extract All..."
   Choose a folder like C:\option-chain-pulse
   (Avoid paths with spaces like "My Documents" if possible)

2. OPEN COMMAND PROMPT
   Press Windows key + R, type "cmd", press Enter
   In the black window, navigate to the project:
     cd C:\option-chain-pulse

3. RUN THE BUILD SCRIPT (EASIEST WAY)
   Type this exact command and press Enter:
     build-windows.bat

   The script will:
     - Install all dependencies (3-5 minutes)
     - Install Electron (1-2 minutes)
     - Build the Next.js app (1-2 minutes)
     - Package the .exe installer (2-5 minutes)

   Total time: 7-15 minutes for the first build.

4. FIND YOUR .EXE
   When the build finishes successfully, your installer is at:
     C:\option-chain-pulse\release\OptionChainPulse-Setup-1.0.0.exe

   This is a normal Windows installer. You can:
     - Double-click it to install on this PC
     - Copy it to a USB drive to install on another PC
     - Email it / share it (it's about 150-200 MB)

5. INSTALL ON ANY WINDOWS PC
   Double-click OptionChainPulse-Setup-1.0.0.exe
   - Choose install location (default is fine)
   - It creates a desktop shortcut "Option Chain Pulse"
   - It also appears in Start Menu → "Option Chain Pulse"

MANUAL BUILD (if the .bat script fails)
---------------------------------------
If build-windows.bat doesn't work, run these commands one by one:

   npm install
   npx prisma generate
   npm run electron:build
   npx electron-builder --win --x64

The .exe will be in the "release" folder.

(Electron, electron-builder, concurrently and wait-on are listed in
package.json's devDependencies, so a single "npm install" is enough --
you no longer need a separate install step for them.)

PORTABLE VERSION (no install needed)
------------------------------------
If you want a portable .exe that doesn't need installation:

   npx electron-builder --win portable --x64

This produces: release\OptionChainPulse-Portable-1.0.0.exe
You can run this from a USB stick — no installation required.

RUNNING IN DEV MODE (for testing)
---------------------------------
To run the app in development mode (with hot reload):

   npm run electron:dev

This starts the Next.js dev server and opens the Electron window.
Useful for testing changes before building the final .exe.

COMMON ISSUES
-------------

Q: "npm install" fails with permission errors
A: Run Command Prompt as Administrator
   (Right-click cmd → "Run as administrator")

Q: Build fails with "Python not found"
A: Some packages need Python. Install from https://python.org
   Make sure to check "Add Python to PATH" during install.

Q: Antivirus blocks the .exe
A: This is common with Electron apps. Add an exception in your
   antivirus for the "release" folder. The .exe is safe — it's
   built from open-source code you can review.

Q: The app shows a blank window
A: Wait 30-60 seconds on first launch — Next.js is starting.
   Subsequent launches are faster.

Q: "Cannot find module 'electron'"
A: Run: npm install
   (electron is listed in package.json now, so a plain install should
   fetch it — if it still fails, try deleting the node_modules folder
   and package-lock.json, then run npm install again)

Q: Build is very slow
A: First build downloads ~500MB. Subsequent builds are faster.
   Disable antivirus scanning during build for speed.

WHAT THE .EXE INCLUDES
----------------------
- The full Next.js app (all features)
- Real broker integration (ICICI, Angel One, Dhan, or Groww) for live
  option-chain data, PCR, OI, and trade alerts
- An "NSE (view)" mode with real spot/VIX (Yahoo Finance) for when you
  just want to look without a broker connected — no trade alerts fire
  in this mode, only in Broker mode
- NIFTY 50, BANK NIFTY, and SENSEX
- Trade journal with SQLite database
- Sound + visual alerts
- Multi-timeframe signal analysis
- Active trade P&L tracking
- Electron runtime (Chromium browser, ~150 MB)

FILE SIZE
---------
- Installer .exe: roughly 100-200 MB (dependencies were trimmed recently,
  so this build should be on the smaller side of that range)
- Installed size: roughly 300-400 MB
- This is normal for Electron apps (Slack, Discord, VS Code
  are all Electron and similar size)

DISTRIBUTING THE .EXE
---------------------
You can:
- Install on multiple PCs (the installer is reusable)
- Share the .exe with friends (it's standalone)
- Put it on a USB drive (portable version only)

LICENSE
-------
This is your personal build. The code uses:
- Next.js (MIT license)
- Electron (MIT license)
- Yahoo Finance data (public, free)
- All UI components (open source)

Use it for personal trading analysis. Not financial advice.

SUPPORT
-------
If the build fails, copy the error message and ask for help.
The most common issue is Node.js not being installed or being
an old version — make sure you have Node.js 20+ from nodejs.org.
