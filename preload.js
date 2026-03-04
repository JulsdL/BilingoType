const { contextBridge, ipcRenderer, webUtils } = require("electron");

/**
 * Helper to register an IPC listener and return a cleanup function.
 * Ensures renderer code can easily remove listeners to avoid leaks.
 */
const registerListener = (channel, handlerFactory) => {
  return (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }

    const listener =
      typeof handlerFactory === "function"
        ? handlerFactory(callback)
        : (event, ...args) => callback(event, ...args);

    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };
};

contextBridge.exposeInMainWorld("electronAPI", {
  pasteText: (text, options) => ipcRenderer.invoke("paste-text", text, options),
  hideWindow: () => ipcRenderer.invoke("hide-window"),
  showDictationPanel: () => ipcRenderer.invoke("show-dictation-panel"),
  onToggleDictation: registerListener("toggle-dictation", (callback) => () => callback()),
  onStartDictation: registerListener("start-dictation", (callback) => () => callback()),
  onStopDictation: registerListener("stop-dictation", (callback) => () => callback()),

  // Database functions
  saveTranscription: (text) => ipcRenderer.invoke("db-save-transcription", text),
  getTranscriptions: (limit) => ipcRenderer.invoke("db-get-transcriptions", limit),
  clearTranscriptions: () => ipcRenderer.invoke("db-clear-transcriptions"),
  deleteTranscription: (id) => ipcRenderer.invoke("db-delete-transcription", id),

  // Dictionary functions
  getDictionary: () => ipcRenderer.invoke("db-get-dictionary"),
  setDictionary: (words) => ipcRenderer.invoke("db-set-dictionary", words),
  onDictionaryUpdated: (callback) => {
    const listener = (_event, words) => callback?.(words);
    ipcRenderer.on("dictionary-updated", listener);
    return () => ipcRenderer.removeListener("dictionary-updated", listener);
  },
  setAutoLearnEnabled: (enabled) => ipcRenderer.send("auto-learn-changed", enabled),
  onCorrectionsLearned: (callback) => {
    const listener = (_event, words) => callback?.(words);
    ipcRenderer.on("corrections-learned", listener);
    return () => ipcRenderer.removeListener("corrections-learned", listener);
  },
  undoLearnedCorrections: (words) => ipcRenderer.invoke("undo-learned-corrections", words),

  // Note functions
  saveNote: (title, content, noteType, sourceFile, audioDuration, folderId) =>
    ipcRenderer.invoke(
      "db-save-note",
      title,
      content,
      noteType,
      sourceFile,
      audioDuration,
      folderId
    ),
  getNote: (id) => ipcRenderer.invoke("db-get-note", id),
  getNotes: (noteType, limit, folderId) =>
    ipcRenderer.invoke("db-get-notes", noteType, limit, folderId),
  updateNote: (id, updates) => ipcRenderer.invoke("db-update-note", id, updates),
  deleteNote: (id) => ipcRenderer.invoke("db-delete-note", id),
  exportNote: (noteId, format) => ipcRenderer.invoke("export-note", noteId, format),

  // Folder functions
  getFolders: () => ipcRenderer.invoke("db-get-folders"),
  createFolder: (name) => ipcRenderer.invoke("db-create-folder", name),
  deleteFolder: (id) => ipcRenderer.invoke("db-delete-folder", id),
  renameFolder: (id, name) => ipcRenderer.invoke("db-rename-folder", id, name),
  getFolderNoteCounts: () => ipcRenderer.invoke("db-get-folder-note-counts"),

  // Action functions
  getActions: () => ipcRenderer.invoke("db-get-actions"),
  getAction: (id) => ipcRenderer.invoke("db-get-action", id),
  createAction: (name, description, prompt, icon) =>
    ipcRenderer.invoke("db-create-action", name, description, prompt, icon),
  updateAction: (id, updates) => ipcRenderer.invoke("db-update-action", id, updates),
  deleteAction: (id) => ipcRenderer.invoke("db-delete-action", id),

  // Audio file operations
  selectAudioFile: () => ipcRenderer.invoke("select-audio-file"),
  transcribeAudioFile: (filePath, options) =>
    ipcRenderer.invoke("transcribe-audio-file", filePath, options),
  getPathForFile: (file) => webUtils.getPathForFile(file),

  onNoteAdded: (callback) => {
    const listener = (_event, note) => callback?.(note);
    ipcRenderer.on("note-added", listener);
    return () => ipcRenderer.removeListener("note-added", listener);
  },
  onNoteUpdated: (callback) => {
    const listener = (_event, note) => callback?.(note);
    ipcRenderer.on("note-updated", listener);
    return () => ipcRenderer.removeListener("note-updated", listener);
  },
  onNoteDeleted: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("note-deleted", listener);
    return () => ipcRenderer.removeListener("note-deleted", listener);
  },

  onActionCreated: (callback) => {
    const listener = (_event, action) => callback?.(action);
    ipcRenderer.on("action-created", listener);
    return () => ipcRenderer.removeListener("action-created", listener);
  },
  onActionUpdated: (callback) => {
    const listener = (_event, action) => callback?.(action);
    ipcRenderer.on("action-updated", listener);
    return () => ipcRenderer.removeListener("action-updated", listener);
  },
  onActionDeleted: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("action-deleted", listener);
    return () => ipcRenderer.removeListener("action-deleted", listener);
  },

  onTranscriptionAdded: (callback) => {
    const listener = (_event, transcription) => callback?.(transcription);
    ipcRenderer.on("transcription-added", listener);
    return () => ipcRenderer.removeListener("transcription-added", listener);
  },
  onTranscriptionDeleted: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("transcription-deleted", listener);
    return () => ipcRenderer.removeListener("transcription-deleted", listener);
  },
  onTranscriptionsCleared: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("transcriptions-cleared", listener);
    return () => ipcRenderer.removeListener("transcriptions-cleared", listener);
  },

  // Clipboard functions
  checkAccessibilityPermission: () => ipcRenderer.invoke("check-accessibility-permission"),
  readClipboard: () => ipcRenderer.invoke("read-clipboard"),
  writeClipboard: (text) => ipcRenderer.invoke("write-clipboard", text),
  checkPasteTools: () => ipcRenderer.invoke("check-paste-tools"),

  // Hardware info + benchmark
  getHardwareInfo: () => ipcRenderer.invoke("get-hardware-info"),
  runSttBenchmark: () => ipcRenderer.invoke("run-stt-benchmark"),

  // GPU detection
  detectGpu: () => ipcRenderer.invoke("detect-gpu"),
  getCudaStatus: () => ipcRenderer.invoke("get-cuda-status"),

  // faster-whisper sidecar
  fasterWhisperStreamingStart: (options) =>
    ipcRenderer.invoke("faster-whisper-streaming-start", options),
  fasterWhisperStreamingSend: (pcmBase64) =>
    ipcRenderer.send("faster-whisper-streaming-send", pcmBase64),
  fasterWhisperStreamingStop: () => ipcRenderer.invoke("faster-whisper-streaming-stop"),
  getSttConfig: () => ipcRenderer.invoke("get-stt-config"),
  fasterWhisperTranscribe: (audioBuffer, options) =>
    ipcRenderer.invoke("faster-whisper-transcribe", audioBuffer, options),
  fasterWhisperStatus: () => ipcRenderer.invoke("faster-whisper-status"),
  fasterWhisperStartServer: (model, options) =>
    ipcRenderer.invoke("faster-whisper-start-server", model, options),
  fasterWhisperStopServer: () => ipcRenderer.invoke("faster-whisper-stop-server"),
  onFasterWhisperPartial: registerListener(
    "faster-whisper-partial",
    (callback) => (_event, data) => callback(data)
  ),
  onFasterWhisperFinal: registerListener(
    "faster-whisper-final",
    (callback) => (_event, data) => callback(data)
  ),
  onFasterWhisperError: registerListener(
    "faster-whisper-error",
    (callback) => (_event, data) => callback(data)
  ),

  // Window control functions
  windowMinimize: () => ipcRenderer.invoke("window-minimize"),
  windowMaximize: () => ipcRenderer.invoke("window-maximize"),
  windowClose: () => ipcRenderer.invoke("window-close"),
  windowIsMaximized: () => ipcRenderer.invoke("window-is-maximized"),
  getPlatform: () => process.platform,
  appQuit: () => ipcRenderer.invoke("app-quit"),

  // Cleanup function
  cleanupApp: () => ipcRenderer.invoke("cleanup-app"),
  updateHotkey: (hotkey) => ipcRenderer.invoke("update-hotkey", hotkey),
  setHotkeyListeningMode: (enabled, newHotkey) =>
    ipcRenderer.invoke("set-hotkey-listening-mode", enabled, newHotkey),
  getHotkeyModeInfo: () => ipcRenderer.invoke("get-hotkey-mode-info"),
  startWindowDrag: () => ipcRenderer.invoke("start-window-drag"),
  stopWindowDrag: () => ipcRenderer.invoke("stop-window-drag"),
  setMainWindowInteractivity: (interactive) =>
    ipcRenderer.invoke("set-main-window-interactivity", interactive),
  resizeMainWindow: (sizeKey) => ipcRenderer.invoke("resize-main-window", sizeKey),

  // Audio event listeners
  onNoAudioDetected: registerListener("no-audio-detected"),

  // External link opener
  openExternal: (url) => ipcRenderer.invoke("open-external", url),

  getLogLevel: () => ipcRenderer.invoke("get-log-level"),
  log: (entry) => ipcRenderer.invoke("app-log", entry),

  // Debug logging management
  getDebugState: () => ipcRenderer.invoke("get-debug-state"),
  setDebugLogging: (enabled) => ipcRenderer.invoke("set-debug-logging", enabled),
  openLogsFolder: () => ipcRenderer.invoke("open-logs-folder"),

  // System settings helpers
  requestMicrophoneAccess: () => ipcRenderer.invoke("request-microphone-access"),
  openMicrophoneSettings: () => ipcRenderer.invoke("open-microphone-settings"),
  openSoundInputSettings: () => ipcRenderer.invoke("open-sound-input-settings"),
  openAccessibilitySettings: () => ipcRenderer.invoke("open-accessibility-settings"),
  // UI language
  getUiLanguage: () => ipcRenderer.invoke("get-ui-language"),
  saveUiLanguage: (language) => ipcRenderer.invoke("save-ui-language", language),
  setUiLanguage: (language) => ipcRenderer.invoke("set-ui-language", language),

  // Dictation key persistence
  getDictationKey: () => ipcRenderer.invoke("get-dictation-key"),
  saveDictationKey: (key) => ipcRenderer.invoke("save-dictation-key", key),

  // Activation mode persistence
  getActivationMode: () => ipcRenderer.invoke("get-activation-mode"),
  saveActivationMode: (mode) => ipcRenderer.invoke("save-activation-mode", mode),

  syncStartupPreferences: (prefs) => ipcRenderer.invoke("sync-startup-preferences", prefs),

  // HuggingFace settings
  getHfSettings: () => ipcRenderer.invoke("get-hf-settings"),
  saveHfSettings: (settings) => ipcRenderer.invoke("save-hf-settings", settings),

  // Custom local model path
  browseCustomModel: () => ipcRenderer.invoke("browse-custom-model"),
  saveCustomModelPath: (modelPath) => ipcRenderer.invoke("save-custom-model-path", modelPath),
  getCustomModelPath: () => ipcRenderer.invoke("get-custom-model-path"),

  // Hotkey events
  onHotkeyFallbackUsed: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("hotkey-fallback-used", listener);
    return () => ipcRenderer.removeListener("hotkey-fallback-used", listener);
  },
  onHotkeyRegistrationFailed: (callback) => {
    const listener = (_event, data) => callback?.(data);
    ipcRenderer.on("hotkey-registration-failed", listener);
    return () => ipcRenderer.removeListener("hotkey-registration-failed", listener);
  },
  onWindowsPushToTalkUnavailable: registerListener("windows-ptt-unavailable"),

  // Notify main process of activation mode / hotkey changes
  notifyActivationModeChanged: (mode) => ipcRenderer.send("activation-mode-changed", mode),
  notifyHotkeyChanged: (hotkey) => ipcRenderer.send("hotkey-changed", hotkey),

  // Floating icon auto-hide
  notifyFloatingIconAutoHideChanged: (enabled) =>
    ipcRenderer.send("floating-icon-auto-hide-changed", enabled),
  onFloatingIconAutoHideChanged: registerListener(
    "floating-icon-auto-hide-changed",
    (callback) => (_event, enabled) => callback(enabled)
  ),

  // Auto-start management
  getAutoStartEnabled: () => ipcRenderer.invoke("get-auto-start-enabled"),
  setAutoStartEnabled: (enabled) => ipcRenderer.invoke("set-auto-start-enabled", enabled),
});
