const { app, globalShortcut, BrowserWindow, dialog, ipcMain, session } = require("electron");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const VALID_CHANNELS = new Set(["development", "production"]);
const BASE_WINDOWS_APP_ID = "com.bilingotype.app";

function isElectronBinaryExec() {
  const execPath = (process.execPath || "").toLowerCase();
  return (
    execPath.includes("/electron.app/contents/macos/electron") ||
    execPath.endsWith("/electron") ||
    execPath.endsWith("\\electron.exe")
  );
}

function inferDefaultChannel() {
  if (process.env.NODE_ENV === "development" || process.defaultApp || isElectronBinaryExec()) {
    return "development";
  }
  return "production";
}

function resolveAppChannel() {
  const rawChannel = (process.env.BILINGOTYPE_CHANNEL || "").trim().toLowerCase();

  if (VALID_CHANNELS.has(rawChannel)) {
    return rawChannel;
  }

  return inferDefaultChannel();
}

const APP_CHANNEL = resolveAppChannel();
process.env.BILINGOTYPE_CHANNEL = APP_CHANNEL;

function configureChannelUserDataPath() {
  if (APP_CHANNEL === "production") {
    return;
  }

  const isolatedPath = path.join(app.getPath("appData"), `BilingoType-${APP_CHANNEL}`);
  app.setPath("userData", isolatedPath);
}

configureChannelUserDataPath();

if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-gpu-compositing");
}

// Group all windows under single taskbar entry on Windows
if (process.platform === "win32") {
  const windowsAppId =
    APP_CHANNEL === "production" ? BASE_WINDOWS_APP_ID : `${BASE_WINDOWS_APP_ID}.${APP_CHANNEL}`;
  app.setAppUserModelId(windowsAppId);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.exit(0);
}

const isLiveWindow = (window) => window && !window.isDestroyed();

// Add global error handling for uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  if (error.code === "EPIPE") {
    return;
  }
  console.error("Error stack:", error.stack);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Import helper module classes (but don't instantiate yet - wait for app.whenReady())
const EnvironmentManager = require("./src/helpers/environment");
const WindowManager = require("./src/helpers/windowManager");
const DatabaseManager = require("./src/helpers/database");
const ClipboardManager = require("./src/helpers/clipboard");
const WhisperManager = require("./src/helpers/whisper");
const TrayManager = require("./src/helpers/tray");
const IPCHandlers = require("./src/helpers/ipcHandlers");
const WindowsKeyManager = require("./src/helpers/windowsKeyManager");
const WhisperCudaManager = require("./src/helpers/whisperCudaManager");
const FasterWhisperManager = require("./src/helpers/fasterWhisperManager");
const { i18nMain, changeLanguage } = require("./src/helpers/i18nMain");

// Manager instances - initialized after app.whenReady()
let debugLogger = null;
let environmentManager = null;
let windowManager = null;
let hotkeyManager = null;
let databaseManager = null;
let clipboardManager = null;
let whisperManager = null;
let trayManager = null;
let windowsKeyManager = null;
let whisperCudaManager = null;
let fasterWhisperManager = null;
let ipcHandlers = null;

// Phase 1: Initialize managers + IPC handlers before window content loads
function initializeCoreManagers() {
  debugLogger = require("./src/helpers/debugLogger");
  debugLogger.ensureFileLogging();

  environmentManager = new EnvironmentManager();
  const uiLanguage = environmentManager.getUiLanguage();
  process.env.UI_LANGUAGE = uiLanguage;
  changeLanguage(uiLanguage);
  debugLogger.refreshLogLevel();

  windowManager = new WindowManager();
  hotkeyManager = windowManager.hotkeyManager;
  databaseManager = new DatabaseManager();
  clipboardManager = new ClipboardManager();
  whisperManager = new WhisperManager();
  if (process.platform !== "darwin") {
    whisperCudaManager = new WhisperCudaManager();
  }
  windowsKeyManager = new WindowsKeyManager();
  fasterWhisperManager = new FasterWhisperManager();

  // IPC handlers must be registered before window content loads
  ipcHandlers = new IPCHandlers({
    environmentManager,
    databaseManager,
    clipboardManager,
    whisperManager,
    windowManager,
    windowsKeyManager,
    whisperCudaManager,
    fasterWhisperManager,
    getTrayManager: () => trayManager,
  });
}

// Phase 2: Non-critical setup after windows are visible
function initializeDeferredManagers() {
  clipboardManager.preWarmAccessibility();
  trayManager = new TrayManager();
}

// Main application startup
async function startApp() {
  // Phase 1: Core managers + IPC handlers before windows
  initializeCoreManagers();

  windowManager.setActivationModeCache(environmentManager.getActivationMode());
  windowManager.setFloatingIconAutoHide(environmentManager.getFloatingIconAutoHide());

  ipcMain.on("activation-mode-changed", (_event, mode) => {
    windowManager.setActivationModeCache(mode);
    environmentManager.saveActivationMode(mode);
  });

  ipcMain.on("floating-icon-auto-hide-changed", (_event, enabled) => {
    windowManager.setFloatingIconAutoHide(enabled);
    environmentManager.saveFloatingIconAutoHide(enabled);
    if (windowManager.mainWindow && !windowManager.mainWindow.isDestroyed()) {
      windowManager.mainWindow.webContents.send("floating-icon-auto-hide-changed", enabled);
    }
  });

  // In development, wait for Vite dev server to be ready
  if (process.env.NODE_ENV === "development") {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Create windows FIRST so the user sees UI as soon as possible
  await windowManager.createMainWindow();
  await windowManager.createControlPanelWindow();

  // Phase 2: Initialize remaining managers after windows are visible
  initializeDeferredManagers();

  // Non-blocking whisper server pre-warming
  const whisperSettings = {
    localTranscriptionProvider: process.env.LOCAL_TRANSCRIPTION_PROVIDER || "",
    whisperModel: process.env.LOCAL_WHISPER_MODEL,
    useCuda: process.env.WHISPER_CUDA_ENABLED === "true" && whisperCudaManager?.isDownloaded(),
  };
  whisperManager.initializeAtStartup(whisperSettings).catch((err) => {
    debugLogger.debug("Whisper startup init error (non-fatal)", { error: err.message });
  });

  // Pre-warm faster-whisper sidecar if selected as provider
  if (
    whisperSettings.localTranscriptionProvider === "faster-whisper" &&
    fasterWhisperManager.isAvailable()
  ) {
    const fwModel = process.env.FASTER_WHISPER_MODEL || "base";
    const fwDevice = process.env.STT_DEVICE || "auto";
    fasterWhisperManager.start(fwModel, { device: fwDevice }).catch((err) => {
      debugLogger.debug("faster-whisper startup init error (non-fatal)", { error: err.message });
    });
  }

  if (process.platform === "win32") {
    const nircmdStatus = clipboardManager.getNircmdStatus();
    debugLogger.debug("Windows paste tool status", nircmdStatus);
  }

  trayManager.setWindows(windowManager.mainWindow, windowManager.controlPanelWindow);
  trayManager.setWindowManager(windowManager);
  trayManager.setCreateControlPanelCallback(() => windowManager.createControlPanelWindow());
  await trayManager.createTray();

  // Set up Windows Push-to-Talk handling
  if (process.platform === "win32") {
    debugLogger.debug("[Push-to-Talk] Windows Push-to-Talk setup starting");

    const isValidHotkey = (hotkey) => hotkey && hotkey !== "GLOBE";

    const isRightSideMod = (hotkey) =>
      /^Right(Control|Ctrl|Alt|Option|Shift|Super|Win|Meta|Command|Cmd)$/i.test(hotkey);

    const { isModifierOnlyHotkey } = require("./src/helpers/hotkeyManager");

    const needsNativeListener = (hotkey, mode) => {
      if (!isValidHotkey(hotkey)) return false;
      if (mode === "push") return true;
      return isRightSideMod(hotkey) || isModifierOnlyHotkey(hotkey);
    };

    windowsKeyManager.on("key-down", (_key) => {
      if (!isLiveWindow(windowManager.mainWindow)) return;

      const activationMode = windowManager.getActivationMode();
      if (activationMode === "push") {
        windowManager.startWindowsPushToTalk();
      } else if (activationMode === "tap") {
        windowManager.showDictationPanel();
        windowManager.mainWindow.webContents.send("toggle-dictation");
      }
    });

    windowsKeyManager.on("key-up", () => {
      if (!isLiveWindow(windowManager.mainWindow)) return;

      const activationMode = windowManager.getActivationMode();
      if (activationMode === "push") {
        windowManager.handleWindowsPushKeyUp();
      }
    });

    windowsKeyManager.on("error", (error) => {
      debugLogger.warn("[Push-to-Talk] Windows key listener error", { error: error.message });
      if (isLiveWindow(windowManager.mainWindow)) {
        windowManager.mainWindow.webContents.send("windows-ptt-unavailable", {
          reason: "error",
          message: error.message,
        });
      }
    });

    windowsKeyManager.on("unavailable", () => {
      debugLogger.debug(
        "[Push-to-Talk] Windows key listener not available - falling back to toggle mode"
      );
      if (isLiveWindow(windowManager.mainWindow)) {
        windowManager.mainWindow.webContents.send("windows-ptt-unavailable", {
          reason: "binary_not_found",
          message: i18nMain.t("windows.pttUnavailable"),
        });
      }
    });

    windowsKeyManager.on("ready", () => {
      debugLogger.debug("[Push-to-Talk] WindowsKeyManager is ready and listening");
    });

    const startWindowsKeyListener = () => {
      if (!isLiveWindow(windowManager.mainWindow)) return;
      const activationMode = windowManager.getActivationMode();
      const currentHotkey = hotkeyManager.getCurrentHotkey();

      if (needsNativeListener(currentHotkey, activationMode)) {
        windowsKeyManager.start(currentHotkey);
      }
    };

    const STARTUP_DELAY_MS = 3000;
    setTimeout(startWindowsKeyListener, STARTUP_DELAY_MS);

    ipcMain.on("activation-mode-changed", (_event, mode) => {
      windowManager.resetWindowsPushState();
      const currentHotkey = hotkeyManager.getCurrentHotkey();
      if (needsNativeListener(currentHotkey, mode)) {
        windowsKeyManager.start(currentHotkey);
      } else {
        windowsKeyManager.stop();
      }
    });

    ipcMain.on("hotkey-changed", (_event, hotkey) => {
      if (!isLiveWindow(windowManager.mainWindow)) return;
      windowManager.resetWindowsPushState();
      const activationMode = windowManager.getActivationMode();
      windowsKeyManager.stop();
      if (needsNativeListener(hotkey, activationMode)) {
        windowsKeyManager.start(hotkey);
      }
    });
  }
}

// App event handlers
if (gotSingleInstanceLock) {
  app.on("second-instance", async (_event, _commandLine) => {
    await app.whenReady();
    if (!windowManager) {
      return;
    }

    if (isLiveWindow(windowManager.controlPanelWindow)) {
      if (windowManager.controlPanelWindow.isMinimized()) {
        windowManager.controlPanelWindow.restore();
      }
      windowManager.controlPanelWindow.show();
      windowManager.controlPanelWindow.focus();
      if (windowManager.controlPanelWindow.webContents.isCrashed()) {
        windowManager.loadControlPanel();
      }
    } else {
      windowManager.createControlPanelWindow();
    }

    if (isLiveWindow(windowManager.mainWindow)) {
      windowManager.enforceMainWindowOnTop();
    } else {
      windowManager.createMainWindow();
    }
  });

  app
    .whenReady()
    .then(() => {
      const delay = process.platform === "linux" ? 300 : 0;
      return new Promise((resolve) => setTimeout(resolve, delay));
    })
    .then(() => {
      startApp().catch((error) => {
        console.error("Failed to start app:", error);
        dialog.showErrorBox(
          i18nMain.t("startup.error.title"),
          i18nMain.t("startup.error.message", { error: error.message })
        );
        app.exit(1);
      });
    });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("browser-window-focus", (event, window) => {
    if (windowManager && isLiveWindow(windowManager.mainWindow)) {
      if (window === windowManager.mainWindow) {
        windowManager.enforceMainWindowOnTop();
      }
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (windowManager) {
        windowManager.createMainWindow();
        windowManager.createControlPanelWindow();
      }
    } else {
      if (windowManager && isLiveWindow(windowManager.controlPanelWindow)) {
        if (windowManager.controlPanelWindow.isMinimized()) {
          windowManager.controlPanelWindow.restore();
        }
        windowManager.controlPanelWindow.show();
        windowManager.controlPanelWindow.focus();
      } else if (windowManager) {
        windowManager.createControlPanelWindow();
      }

      if (windowManager && isLiveWindow(windowManager.mainWindow)) {
        windowManager.enforceMainWindowOnTop();
      }
    }
  });

  app.on("will-quit", () => {
    if (hotkeyManager) {
      hotkeyManager.unregisterAll();
    } else {
      globalShortcut.unregisterAll();
    }
    if (windowsKeyManager) {
      windowsKeyManager.stop();
    }
    // Stop whisper server if running
    if (whisperManager) {
      whisperManager.stopServer().catch(() => {});
    }
    // Stop faster-whisper sidecar if running
    if (fasterWhisperManager) {
      fasterWhisperManager.stop().catch(() => {});
    }
  });
}
