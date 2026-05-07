const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("path");
const fs = require("fs");

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");

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
  const parsed = parseInt(rawTimeout || "300000", 10);
  return Number.isFinite(parsed) && parsed >= 1000 ? parsed : 300000;
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
  } catch (err) {
    // Last-ditch direct write — if rename fails (e.g. cross-device), try plain write.
    try {
      fs.writeFileSync(responseFilePath, JSON.stringify(data), "utf8");
    } catch (err2) {
      console.error("Failed to write response:", err2);
    }
  }
}

function quit(data) {
  if (quitting) return;
  quitting = true;
  writeResponseOnce(data);
  if (autoTimer) {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
  app.quit();
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const windowWidth = 400;
  const windowHeight = 320;

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round((screenWidth - windowWidth) / 2),
    y: Math.round((screenHeight - windowHeight) / 2),
    alwaysOnTop: true,
    frame: false,
    resizable: false,
    skipTaskbar: false,
    transparent: false,
    backgroundColor: "#1a1a2e",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Strongest always-on-top level so the popup beats fullscreen apps too.
  try {
    mainWindow.setAlwaysOnTop(true, "screen-saver");
  } catch {
    /* ignore on platforms that reject the level */
  }

  mainWindow.loadFile(path.join(__dirname, "renderer.html")).catch((err) => {
    console.error("Failed to load renderer:", err);
    quit({ answered: false, response: "", error: `loadFile failed: ${err.message}` });
  });

  mainWindow.webContents.on("did-finish-load", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("notification-data", { title, message, timeoutMs });
    }
  });

  mainWindow.on("closed", () => {
    // OS chrome / window-control close path — ensure we still emit a dismiss response.
    quit({ answered: false, response: "" });
  });

  mainWindow.focus();

  ipcMain.on("user-response", (_event, data) => {
    quit({
      answered: Boolean(data && data.answered),
      response: data && typeof data.response === "string" ? data.response : "",
    });
  });

  ipcMain.on("close-window", () => {
    quit({ answered: false, response: "" });
  });

  if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
    autoTimer = setTimeout(() => {
      quit({ answered: false, response: "", timedOut: true });
    }, timeoutMs);
  }
}

app
  .whenReady()
  .then(createWindow)
  .catch((err) => {
    console.error("Failed to create window:", err);
    quit({ answered: false, response: "", error: `whenReady failed: ${err.message}` });
    app.exit(1);
  });

app.on("window-all-closed", () => {
  writeResponseOnce({ answered: false, response: "" });
  app.quit();
});

app.on("before-quit", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  writeResponseOnce({ answered: false, response: "", error: err.message });
  app.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error("Unhandled rejection:", msg);
  writeResponseOnce({ answered: false, response: "", error: msg });
  app.exit(1);
});

process.on("SIGTERM", () => quit({ answered: false, response: "", error: "SIGTERM" }));
process.on("SIGINT", () => quit({ answered: false, response: "", error: "SIGINT" }));
