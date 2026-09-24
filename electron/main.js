// ============================================================================
// Electron Main Process — Option Chain Pulse Desktop App
// ----------------------------------------------------------------------------
// This file starts the Next.js server IN-PROCESS (using the Next.js
// programmatic API) and opens a desktop window pointing at it.
//
// NOTE: earlier versions of this file spawned a *child process* running
// `npx next start` / `npx next dev`. That approach breaks once the app is
// packaged on Windows: `process.execPath` inside a packaged Electron app
// points at the installed .exe itself (e.g. OptionChainPulse.exe), not at
// a Node.js binary, and there is no guarantee `npx` is even on the end
// user's PATH. Re-spawning the app's own .exe with CLI args like
// ["next", "start"] does not run the Next.js CLI — it just tries to
// relaunch the Electron app, so the server never actually starts.
//
// Running Next.js in-process (via next({dev, dir}).prepare()) avoids all of
// that: it uses Electron's own bundled Node.js runtime directly, requires
// no system-wide Node.js install, no `npx`/PATH lookups, and works
// identically in `npm run electron:dev` and in the packaged Windows .exe.
// ============================================================================

const { app, BrowserWindow, shell, Tray, Menu, nativeImage, Notification, dialog, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const http = require("http");

let mainWindow = null;
let httpServer = null;
let tray = null;
let updateDownloaded = false;
// Set true only by the tray menu's "Quit" item (or OS-level app.quit()) —
// distinguishes "user clicked the window's X button" (hide to tray, keep
// watching the market in the background) from "user actually wants to
// close the app" (let it quit for real). Without this, the two look
// identical from inside the 'close' event handler below.
let isQuitting = false;
let hasShownTrayHint = false;

const NEXT_PORT = 3000;
// Literal IPv4 loopback everywhere (main window URL, server bind, and the
// Fyers OAuth redirect_uri in fyers-oauth.ts) — avoids any "localhost"
// hostname resolving differently in different places (see the note on
// httpServer.listen below).
const NEXT_URL = `http://127.0.0.1:${NEXT_PORT}`;

// ---------------------------------------------------------------------------
// Set up a writable per-user data directory
// ---------------------------------------------------------------------------
// Electron apps can be installed anywhere, including C:\Program Files,
// which requires Administrator rights to write to. The app's own install
// folder must be treated as READ-ONLY at runtime. Anything the app needs to
// write — the SQLite database, saved broker API keys — goes in
// app.getPath('userData') instead, which Electron guarantees is a
// per-user, always-writable folder (on Windows:
// C:\Users\<you>\AppData\Roaming\OptionChainPulse) no matter where the app
// itself is installed.
function setupUserDataDir(projectDir) {
  const userDataDir = app.getPath("userData");
  const userDbDir = path.join(userDataDir, "db");
  fs.mkdirSync(userDbDir, { recursive: true });

  // First run: seed the user-writable copy from the pre-migrated database
  // shipped inside the app, so the schema is already in place.
  const userDbPath = path.join(userDbDir, "custom.db");
  if (!fs.existsSync(userDbPath)) {
    const seedDbPath = path.join(projectDir, "db", "custom.db");
    try {
      if (fs.existsSync(seedDbPath)) fs.copyFileSync(seedDbPath, userDbPath);
    } catch (err) {
      console.error("[electron] Failed to seed user database:", err);
    }
  }

  // Load any previously-saved broker API keys (written by the API Keys
  // dialog to userData/.env.local) into process.env for this session.
  const userEnvPath = path.join(userDataDir, ".env.local");
  if (fs.existsSync(userEnvPath)) {
    try {
      const content = fs.readFileSync(userEnvPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (key) process.env[key] = value;
      }
    } catch (err) {
      console.error("[electron] Failed to load saved broker config:", err);
    }
  }

  process.env.OCP_USER_DATA_DIR = userDataDir;
  process.env.DATABASE_URL = `file:${userDbPath.split(path.sep).join("/")}`;
  console.log(`[electron] User data dir: ${userDataDir}`);
}

// ---------------------------------------------------------------------------
// Start the Next.js server in-process (production or dev mode)
// ---------------------------------------------------------------------------
async function startNextServer() {
  const isDev = !app.isPackaged;

  // In dev, the project root is one level up from /electron.
  // In a packaged app, the project root is resourcesPath/app (see the
  // "files"/"extraResources" config in package.json's "build" section).
  const projectDir = isDev
    ? path.join(__dirname, "..")
    : path.join(process.resourcesPath, "app");

  process.env.NODE_ENV = isDev ? "development" : "production";

  // Several parts of the app (Prisma's sqlite path, the broker-config API
  // route that reads/writes .env.local) resolve paths relative to
  // process.cwd(). A packaged Electron app's default working directory can
  // be anything (e.g. C:\Windows\System32 when launched from a Start Menu
  // shortcut), so pin it to the app's actual install directory.
  try {
    process.chdir(projectDir);
  } catch (err) {
    console.error("[electron] Failed to chdir to project dir:", err);
  }

  // Only redirect to userData in the packaged app. In dev, keep using the
  // project's own local db/.env.local so `npm run electron:dev` behaves
  // the same as `npm run dev` (both run from a folder you already own).
  if (!isDev) {
    setupUserDataDir(projectDir);
  }

  console.log(`[electron] Loading Next.js from: ${projectDir} (dev=${isDev})`);

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const next = require(path.join(projectDir, "node_modules", "next"));
  const nextApp = next({ dev: isDev, dir: projectDir, hostname: "127.0.0.1", port: NEXT_PORT });
  const handle = nextApp.getRequestHandler();

  await nextApp.prepare();

  httpServer = http.createServer((req, res) => handle(req, res));

  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    // Bind to the literal IPv4 loopback address, not the hostname
    // "localhost". On some Windows setups Node resolves "localhost" to the
    // IPv6 loopback (::1) first, which would leave the server listening
    // only on IPv6 while our Fyers OAuth redirect_uri (fyers-oauth.ts)
    // hardcodes the literal IPv4 "127.0.0.1" — a mismatch that silently
    // fails to connect (blank screen, no visible error, since the OAuth
    // popup has no address bar or devtools). Binding to the literal IP
    // removes that ambiguity entirely.
    httpServer.listen(NEXT_PORT, "127.0.0.1", () => resolve());
  });
}

// ---------------------------------------------------------------------------
// Auto-update via GitHub Releases
// ---------------------------------------------------------------------------
// Uses electron-updater against the "publish" config in package.json's
// "build" section (provider: github, owner/repo pointing at
// amarpandey88-source/Option-Chain). electron-builder writes a latest.yml
// alongside each published release's .exe — that's what electron-updater
// reads to know whether a newer version exists.
//
// Only runs in the packaged app: there's no meaningful update feed in dev
// (running `next dev`/`electron electron/main.js` locally), and checking
// against a real GitHub release from a dev build could misfire (e.g.
// prompt a from-source dev run to "update" itself).
//
// Deliberately does NOT auto-quit the app the moment a download finishes —
// this app can have an open trade being tracked live (see the tick-stream
// code in fyers-tick-stream.ts / page.tsx), and silently restarting mid-
// trade would drop that live tracking. Instead it downloads in the
// background and asks the user to confirm the restart.
function setupAutoUpdater() {
  if (!app.isPackaged) {
    console.log("[auto-updater] Skipped — not running from a packaged build.");
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const sendUpdateStatus = (status, extra = {}) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send("ocp:update-status", { status, ...extra });
    }
  };

  autoUpdater.on("checking-for-update", () => {
    console.log("[auto-updater] Checking for update...");
    sendUpdateStatus("checking");
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[auto-updater] Update available: v${info.version} — downloading in background.`);
    sendUpdateStatus("available", { version: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[auto-updater] No update available — already on the latest version.");
    sendUpdateStatus("up-to-date", { version: app.getVersion() });
  });

  autoUpdater.on("error", (err) => {
    console.error("[auto-updater] Error while checking/downloading update:", err);
    sendUpdateStatus("error", { message: String(err?.message || err) });
  });

  autoUpdater.on("download-progress", (progress) => {
    console.log(`[auto-updater] Downloading update... ${progress.percent.toFixed(1)}%`);
    sendUpdateStatus("downloading", { percent: Math.round(progress.percent), version: autoUpdater.updateInfo?.version ?? null });
  });

  autoUpdater.on("update-downloaded", (info) => {
    updateDownloaded = true;
    sendUpdateStatus("downloaded", { version: info.version });
    console.log(`[auto-updater] Update v${info.version} downloaded — prompting for restart.`);
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Update ready",
        message: `Option Chain Pulse v${info.version} has been downloaded.`,
        detail:
          "Restart now to install it, or it will install automatically the next time you quit the app.",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          isQuitting = true;
          autoUpdater.quitAndInstall();
        }
      });
  });

  const checkNow = () => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error("[auto-updater] Update check failed:", err);
    });
  };

  // Check once shortly after launch, then periodically — the app can stay
  // open (or minimized to the tray) for a full trading day, so a
  // launch-only check would miss a release published mid-session.
  checkNow();
  setInterval(checkNow, 4 * 60 * 60 * 1000); // every 4 hours
}

// ---------------------------------------------------------------------------
// Renderer <-> main-process update controls
// ---------------------------------------------------------------------------
ipcMain.handle("ocp:update-check", async () => {
  if (!app.isPackaged) {
    return { ok: false, status: "dev", message: "Updates are available only in the packaged Windows app." };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true, status: "checking", version: app.getVersion() };
  } catch (err) {
    const message = String(err?.message || err);
    return { ok: false, status: "error", message };
  }
});

ipcMain.handle("ocp:update-install", async () => {
  if (!app.isPackaged) return { ok: false, status: "dev" };
  if (!updateDownloaded) return { ok: false, status: "not-ready" };
  updateDownloaded = false;
  autoUpdater.quitAndInstall();
  return { ok: true, status: "installing" };
});

// ---------------------------------------------------------------------------
// Create the main application window
// ---------------------------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    backgroundColor: "#0a0e14",
    title: "Option Chain Pulse",
    icon: path.join(__dirname, "icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    // Show as a proper desktop window
    autoHideMenuBar: true,
  });

  // Open external links in the default browser (not in the app) — EXCEPT
  // the Fyers OAuth login page, which we deliberately keep inside the app
  // as its own small child window so the user never has to leave
  // Option Chain Pulse to log in and grab a fresh daily access token (see
  // src/lib/fyers-oauth.ts + api-keys-dialog.tsx for the rest of the flow).
  // That popup then gets redirected by Fyers back to our own local
  // /api/broker-config/fyers/callback route (still http://localhost, so
  // it's already covered by the first branch below) once login succeeds.
  const FYERS_OAUTH_HOSTS = ["api-t1.fyers.in", "api.fyers.in", "login.fyers.in", "myapi.fyers.in"];
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://localhost") || url.startsWith("https://localhost") || url.startsWith("http://127.0.0.1")) {
      return { action: "allow" };
    }
    try {
      const { hostname } = new URL(url);
      if (FYERS_OAUTH_HOSTS.includes(hostname)) {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            width: 480,
            height: 720,
            title: "Log in to Fyers",
            autoHideMenuBar: true,
            webPreferences: { nodeIntegration: false, contextIsolation: true },
          },
        };
      }
    } catch {
      // Malformed URL — fall through to the external-browser default below.
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Without this, a failed navigation inside the Fyers OAuth popup (wrong
  // Redirect URL registered on the Fyers dashboard, network hiccup, etc.)
  // just leaves the user staring at a truly blank window — the popup has
  // no address bar or devtools, so Chromium's own network-error page,
  // even when it does render, gives no clue what happened. Show something
  // readable instead whenever the popup's main frame fails to load.
  mainWindow.webContents.on("did-create-window", (childWindow, details) => {
    childWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return; // -3 = ERR_ABORTED, usually just a redirect in progress, not a real failure
      const safe = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
      childWindow.loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(`<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="background:#0a0e14;color:#e2e8f0;font-family:ui-sans-serif,system-ui,sans-serif;padding:24px">
<h2 style="color:#fb7185;font-size:15px">This page failed to load</h2>
<p style="font-size:12px;color:#94a3b8">${safe(errorDescription)} (code ${errorCode})</p>
<p style="font-size:11px;color:#64748b;word-break:break-all">${safe(validatedURL)}</p>
<p style="font-size:11px;color:#64748b">If this is your Fyers app's callback URL, double-check the "Redirect URL" set on myapi.fyers.in/dashboard matches EXACTLY: http://127.0.0.1:3000/api/broker-config/fyers/callback</p>
</body></html>`)
      );
    });
    console.log(`[electron] OAuth child window opened: ${details.url}`);
  });

  mainWindow.loadURL(NEXT_URL);

  // Hide to tray instead of closing, so the app keeps running in the
  // background — this is what makes Telegram/desktop-notification alerts
  // (see telegram-alerts-dialog.tsx) work even after the window is
  // "closed": the process is still alive, still polling, still watching
  // for SL/target hits, just with no visible window. Only an actual
  // "Quit" from the tray menu (or the OS shutting the app down) lets the
  // window really close.
  mainWindow.on("close", (event) => {
    if (isQuitting) return; // let it close for real
    event.preventDefault();
    mainWindow.hide();
    if (!hasShownTrayHint) {
      hasShownTrayHint = true;
      try {
        new Notification({
          title: "Option Chain Pulse is still running",
          body: "Still watching the market in the background. Click the tray icon to reopen, or Quit from there to fully exit.",
        }).show();
      } catch { /* Notification unsupported on this platform — non-critical */ }
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// System tray icon — lets the app keep running (and alerting) in the
// background after the window is hidden, with a quick way back in.
// ---------------------------------------------------------------------------
function createTray() {
  const iconPath = path.join(__dirname, "icon.png");
  let icon = nativeImage.createFromPath(iconPath);
  // Tray icons need to be small; resize defensively in case icon.png is a
  // large app-icon-sized image rather than something tray-appropriate.
  if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16 });
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("Option Chain Pulse — running in background");
  const rebuildMenu = () => {
    const visible = !!mainWindow && mainWindow.isVisible();
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: visible ? "Hide Window" : "Open Option Chain Pulse", click: () => {
          if (!mainWindow) { createWindow(); return; }
          if (mainWindow.isVisible()) mainWindow.hide(); else { mainWindow.show(); mainWindow.focus(); }
        } },
      { type: "separator" },
      { label: "Check for Updates", click: () => {
          if (app.isPackaged) {
            autoUpdater.checkForUpdates().catch((err) => console.error("[auto-updater] Manual check failed:", err));
          } else {
            dialog.showMessageBox({ type: "info", message: "Updates only run in the packaged app, not in dev mode." });
          }
        } },
      { type: "separator" },
      { label: "Quit", click: () => { isQuitting = true; app.quit(); } },
    ]));
  };
  rebuildMenu();
  tray.on("click", () => {
    if (!mainWindow) { createWindow(); return; }
    if (mainWindow.isVisible()) { mainWindow.hide(); } else { mainWindow.show(); mainWindow.focus(); }
    rebuildMenu();
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  if (app.isPackaged) {
    // Production: no server is running yet — start Next.js in-process.
    console.log("[electron] Starting Next.js server...");
    try {
      await startNextServer();
      console.log("[electron] Next.js server ready.");
    } catch (err) {
      console.error("[electron] Next.js server failed to start:", err);
    }
  } else {
    // Dev: `npm run electron:dev` already starts `next dev` via
    // `concurrently`, and `wait-on` confirms it's ready on :3000 before
    // Electron is even launched, so there's nothing to start here.
    console.log("[electron] Dev mode — reusing the already-running `next dev` server.");
  }

  createWindow();
  createTray();
  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else { mainWindow.show(); mainWindow.focus(); }
  });
});

// With hide-to-tray in place (see mainWindow.on("close", ...) above), the
// window itself is never actually destroyed by clicking its close button —
// so this only fires from a real quit (tray "Quit", Cmd+Q on Mac, OS
// shutdown, etc.), where actually closing the server and quitting is
// correct.
app.on("window-all-closed", () => {
  if (httpServer) {
    try {
      httpServer.close();
    } catch (e) {
      console.error("[electron] failed to close server:", e);
    }
  }
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  if (httpServer) {
    try {
      httpServer.close();
    } catch (e) {
      // ignore
    }
  }
});
