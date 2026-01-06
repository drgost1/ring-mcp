const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

// Get arguments: title, message, responseFilePath
const title = process.argv[2] || "Notification";
const message = process.argv[3] || "Task completed!";
const responseFilePath = process.argv[4] || null;

let mainWindow;

function createWindow() {
  // Get primary display dimensions
  const { screen } = require("electron");
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Window dimensions (slightly taller for input)
  const windowWidth = 400;
  const windowHeight = 300;

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

  mainWindow.loadFile(path.join(__dirname, "renderer.html"));

  // Send title and message to renderer once loaded
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("notification-data", { title, message });
  });

  // Focus the window
  mainWindow.focus();

  // Handle user response from renderer
  ipcMain.on("user-response", (event, data) => {
    // Write response to file if path provided
    if (responseFilePath) {
      try {
        fs.writeFileSync(responseFilePath, JSON.stringify(data), "utf8");
      } catch (err) {
        console.error("Failed to write response:", err);
      }
    }
    app.quit();
  });

  // Legacy close handler (keep for backwards compatibility)
  ipcMain.on("close-window", () => {
    if (responseFilePath) {
      try {
        fs.writeFileSync(responseFilePath, JSON.stringify({ answered: false, response: "" }), "utf8");
      } catch (err) {
        console.error("Failed to write response:", err);
      }
    }
    app.quit();
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
