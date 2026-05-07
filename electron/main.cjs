const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");

const RING_HOME = path.join(os.tmpdir(), "ring-mcp");
const REQUESTS_DIR = path.join(RING_HOME, "requests");
const RESPONSES_DIR = path.join(RING_HOME, "responses");
const DAEMON_LOCK = path.join(RING_HOME, "daemon.pid");

function ensureDirs() {
  for (const d of [RING_HOME, REQUESTS_DIR, RESPONSES_DIR]) {
    try {
      fs.mkdirSync(d, { recursive: true });
    } catch {
      /* ignore */
    }
  }
}

function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (process.argv.includes("--daemon")) {
  bootDaemon();
} else {
  bootSinglePopup();
}

// ─────────────────────────────────────────────────────────────────────────────
// DAEMON MODE — single window, multiple tabs, file-based request queue
// ─────────────────────────────────────────────────────────────────────────────
function bootDaemon() {
  ensureDirs();

  // Refuse to start if another daemon is already alive (atomic guard).
  if (fs.existsSync(DAEMON_LOCK)) {
    let existing = 0;
    try {
      existing = parseInt(fs.readFileSync(DAEMON_LOCK, "utf8").trim(), 10);
    } catch {
      /* ignore */
    }
    if (isPidAlive(existing) && existing !== process.pid) {
      // Another daemon owns the show. Exit silently.
      app.exit(0);
      return;
    }
  }

  // Claim the lock with our actual PID (in case the spawning MCP wrote a
  // stale value before the OS handed our process its real PID).
  try {
    fs.writeFileSync(DAEMON_LOCK, String(process.pid), "utf8");
  } catch {
    /* ignore */
  }

  let mainWindow = null;
  let openTabs = new Map(); // id → { title, message, options, ... }
  let pollHandle = null;
  let watcher = null;
  let muted = false;
  let shuttingDown = false;

  function pickDisplay() {
    try {
      return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    } catch {
      return screen.getPrimaryDisplay();
    }
  }

  function writeResponse(id, data) {
    const responsePath = path.join(RESPONSES_DIR, `${id}.json`);
    const tmp = `${responsePath}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
      fs.renameSync(tmp, responsePath);
    } catch {
      try {
        fs.writeFileSync(responsePath, JSON.stringify(data), "utf8");
      } catch (e) {
        console.error("Failed to write response:", e);
      }
    }
    try {
      fs.unlinkSync(path.join(REQUESTS_DIR, `${id}.json`));
    } catch {
      /* ignore */
    }
  }

  function loadPendingRequests() {
    let entries = [];
    try {
      entries = fs.readdirSync(REQUESTS_DIR);
    } catch {
      return;
    }

    const newOnes = [];
    for (const name of entries) {
      if (!name.endsWith(".json") || name.endsWith(".tmp")) continue;
      const id = name.replace(/\.json$/, "");
      if (openTabs.has(id)) continue;
      const full = path.join(REQUESTS_DIR, name);
      try {
        const data = JSON.parse(fs.readFileSync(full, "utf8"));
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {
          /* ignore */
        }
        newOnes.push({ id, data, mtime });
      } catch {
        /* skip half-written or corrupt request */
      }
    }

    newOnes.sort((a, b) => a.mtime - b.mtime);
    for (const { id, data } of newOnes) {
      addTab(id, data);
    }
  }

  function addTab(id, data) {
    openTabs.set(id, data);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("tab-added", {
        id,
        title: typeof data.title === "string" ? data.title : "Notification",
        message: typeof data.message === "string" ? data.message : "",
        options: Array.isArray(data.options) ? data.options : [],
        selectionMode: data.selectionMode === "single" ? "single" : "multiple",
        allowText:
          typeof data.allowText === "boolean"
            ? data.allowText
            : !(Array.isArray(data.options) && data.options.length > 0),
        muted,
      });
      bringToFront();
    }
  }

  function bringToFront() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.moveTop();
    mainWindow.focus();
    if (process.platform === "win32") {
      try {
        mainWindow.flashFrame(true);
      } catch {
        /* ignore */
      }
    }
    if (typeof app.focus === "function") {
      try {
        app.focus({ steal: true });
      } catch {
        /* ignore */
      }
    }
  }

  function createWindow() {
    const display = pickDisplay();
    const { x: areaX, y: areaY, width: areaWidth, height: areaHeight } = display.workArea;
    const windowWidth = 540;
    const windowHeight = Math.min(560, areaHeight - 60);
    const winX = Math.round(areaX + (areaWidth - windowWidth) / 2);
    const winY = Math.round(areaY + (areaHeight - windowHeight) / 2);

    mainWindow = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      minWidth: 440,
      minHeight: 380,
      x: winX,
      y: winY,
      alwaysOnTop: true,
      frame: false,
      resizable: true,
      skipTaskbar: false,
      transparent: false,
      show: false,
      backgroundColor: "#1a1a2e",
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    try {
      mainWindow.setAlwaysOnTop(true, "screen-saver");
    } catch {
      /* ignore */
    }
    try {
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {
      /* ignore */
    }

    mainWindow.loadFile(path.join(__dirname, "renderer.html")).catch((err) => {
      console.error("Failed to load renderer:", err);
      shutdown(1);
    });

    mainWindow.once("ready-to-show", () => {
      bringToFront();
      // Push any tabs that arrived before the renderer was ready.
      for (const [id, data] of openTabs) {
        mainWindow.webContents.send("tab-added", {
          id,
          title: data.title,
          message: data.message,
          options: data.options || [],
          selectionMode: data.selectionMode === "single" ? "single" : "multiple",
          allowText:
            typeof data.allowText === "boolean"
              ? data.allowText
              : !(Array.isArray(data.options) && data.options.length > 0),
          muted,
        });
      }
    });

    mainWindow.on("closed", () => {
      mainWindow = null;
      // User closed the window manually. Treat all open tabs as dismissed
      // so the waiting MCP calls can resolve.
      for (const id of openTabs.keys()) {
        writeResponse(id, { answered: false, response: "" });
      }
      openTabs.clear();
      shutdown(0);
    });
  }

  ipcMain.on("tab-response", (_event, payload) => {
    const id = payload && payload.id;
    if (!id || !openTabs.has(id)) return;
    writeResponse(id, {
      answered: Boolean(payload.answered),
      response: typeof payload.response === "string" ? payload.response : "",
    });
    openTabs.delete(id);
    if (openTabs.size === 0) {
      // No more tabs — close window, exit daemon.
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.removeAllListeners("closed");
        mainWindow.close();
      }
      shutdown(0);
    }
  });

  ipcMain.on("dismiss-all", () => {
    for (const id of openTabs.keys()) {
      writeResponse(id, { answered: false, response: "" });
    }
    openTabs.clear();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.removeAllListeners("closed");
      mainWindow.close();
    }
    shutdown(0);
  });

  ipcMain.on("set-muted", (_event, value) => {
    muted = Boolean(value);
  });

  function startWatching() {
    loadPendingRequests();
    try {
      watcher = fs.watch(REQUESTS_DIR, () => {
        // Debounce slightly to let atomic renames complete.
        setTimeout(loadPendingRequests, 50);
      });
    } catch {
      /* fs.watch unsupported on this fs — polling fallback handles it */
    }
    pollHandle = setInterval(loadPendingRequests, 750);
  }

  function shutdown(code) {
    if (shuttingDown) return;
    shuttingDown = true;
    if (pollHandle) clearInterval(pollHandle);
    if (watcher) {
      try {
        watcher.close();
      } catch {
        /* ignore */
      }
    }
    // Release the lock only if we still own it.
    try {
      const owner = parseInt(fs.readFileSync(DAEMON_LOCK, "utf8").trim(), 10);
      if (owner === process.pid) fs.unlinkSync(DAEMON_LOCK);
    } catch {
      /* ignore */
    }
    if (typeof code === "number" && code !== 0) {
      app.exit(code);
    } else {
      app.quit();
    }
  }

  app
    .whenReady()
    .then(() => {
      createWindow();
      startWatching();
    })
    .catch((err) => {
      console.error("Daemon failed to start:", err);
      shutdown(1);
    });

  app.on("window-all-closed", () => {
    shutdown(0);
  });

  process.on("uncaughtException", (err) => {
    console.error("Daemon uncaught exception:", err);
    for (const id of openTabs.keys()) {
      writeResponse(id, { answered: false, response: "", error: err.message });
    }
    shutdown(1);
  });

  process.on("unhandledRejection", (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error("Daemon unhandled rejection:", msg);
    for (const id of openTabs.keys()) {
      writeResponse(id, { answered: false, response: "", error: msg });
    }
    shutdown(1);
  });

  process.on("exit", () => {
    try {
      const owner = parseInt(fs.readFileSync(DAEMON_LOCK, "utf8").trim(), 10);
      if (owner === process.pid) fs.unlinkSync(DAEMON_LOCK);
    } catch {
      /* ignore */
    }
  });

  process.on("SIGTERM", () => shutdown(0));
  process.on("SIGINT", () => shutdown(0));
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY SINGLE-POPUP MODE — direct CLI testing only
// ─────────────────────────────────────────────────────────────────────────────
function bootSinglePopup() {
  const useEnv = process.argv.includes("--ring-from-env");
  const title = useEnv
    ? process.env.RING_TITLE || "Notification"
    : process.argv[2] || "Notification";
  const message = useEnv
    ? process.env.RING_MESSAGE || "Task completed!"
    : process.argv[3] || "Task completed!";
  const responseFilePath = useEnv
    ? process.env.RING_RESPONSE_PATH || null
    : process.argv[4] || null;
  const rawTimeout = useEnv ? process.env.RING_TIMEOUT_MS : process.argv[5];
  const timeoutMs = (() => {
    const parsed = parseInt(rawTimeout || "0", 10);
    return Number.isFinite(parsed) && parsed >= 1000 ? parsed : 0;
  })();

  let mainWindow = null;
  let responseWritten = false;
  let autoTimer = null;
  let quitting = false;

  function writeResponseOnce(data) {
    if (responseWritten || !responseFilePath) return;
    responseWritten = true;
    try {
      const tmp = `${responseFilePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
      fs.renameSync(tmp, responseFilePath);
    } catch {
      try {
        fs.writeFileSync(responseFilePath, JSON.stringify(data), "utf8");
      } catch (e) {
        console.error("Failed to write response:", e);
      }
    }
  }

  function quit(data) {
    if (quitting) return;
    quitting = true;
    writeResponseOnce(data);
    if (autoTimer) clearTimeout(autoTimer);
    app.quit();
  }

  function pickDisplay() {
    try {
      return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    } catch {
      return screen.getPrimaryDisplay();
    }
  }

  function createWindow() {
    const display = pickDisplay();
    const { x: areaX, y: areaY, width: areaWidth, height: areaHeight } = display.workArea;
    const windowWidth = 460;
    const windowHeight = 360;
    const winX = Math.round(areaX + (areaWidth - windowWidth) / 2);
    const winY = Math.round(areaY + (areaHeight - windowHeight) / 2);

    mainWindow = new BrowserWindow({
      width: windowWidth,
      height: windowHeight,
      x: winX,
      y: winY,
      alwaysOnTop: true,
      frame: false,
      resizable: false,
      show: false,
      backgroundColor: "#1a1a2e",
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    try {
      mainWindow.setAlwaysOnTop(true, "screen-saver");
    } catch {
      /* ignore */
    }

    mainWindow.loadFile(path.join(__dirname, "renderer.html"));

    mainWindow.webContents.on("did-finish-load", () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send("tab-added", {
        id: "single",
        title,
        message,
        options: [],
        selectionMode: "multiple",
        allowText: true,
        muted: false,
      });
    });

    mainWindow.once("ready-to-show", () => {
      mainWindow.show();
      mainWindow.moveTop();
      mainWindow.focus();
    });

    mainWindow.on("closed", () => {
      quit({ answered: false, response: "" });
    });

    if (timeoutMs > 0) {
      autoTimer = setTimeout(() => {
        quit({ answered: false, response: "", timedOut: true });
      }, timeoutMs);
    }
  }

  ipcMain.on("tab-response", (_e, payload) => {
    quit({
      answered: Boolean(payload && payload.answered),
      response: payload && typeof payload.response === "string" ? payload.response : "",
    });
  });

  ipcMain.on("dismiss-all", () => {
    quit({ answered: false, response: "" });
  });

  app
    .whenReady()
    .then(createWindow)
    .catch((err) => {
      console.error("Failed to create window:", err);
      quit({ answered: false, response: "", error: err.message });
      app.exit(1);
    });

  app.on("window-all-closed", () => app.quit());

  process.on("uncaughtException", (err) => {
    console.error(err);
    quit({ answered: false, response: "", error: err.message });
    app.exit(1);
  });

  process.on("SIGTERM", () => quit({ answered: false, response: "", error: "SIGTERM" }));
  process.on("SIGINT", () => quit({ answered: false, response: "", error: "SIGINT" }));
}
