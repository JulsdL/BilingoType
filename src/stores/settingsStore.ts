import { create } from "zustand";
import i18n, { normalizeUiLanguage } from "../i18n";
import { ensureAgentNameInDictionary } from "../utils/agentName";
import logger from "../utils/logger";
import type {
  TranscriptionSettings,
  HotkeySettings,
  MicrophoneSettings,
  ThemeSettings,
} from "../hooks/useSettings";

const isBrowser = typeof window !== "undefined";

function readString(key: string, fallback: string): string {
  if (!isBrowser) return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function readBoolean(key: string, fallback: boolean): boolean {
  if (!isBrowser) return fallback;
  const stored = localStorage.getItem(key);
  if (stored === null) return fallback;
  if (fallback === true) return stored !== "false";
  return stored === "true";
}

function readStringArray(key: string, fallback: string[]): string[] {
  if (!isBrowser) return fallback;
  const stored = localStorage.getItem(key);
  if (stored === null) return fallback;
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

const BOOLEAN_SETTINGS = new Set([
  "preferBuiltInMic",
  "audioCuesEnabled",
  "floatingIconAutoHide",
]);

const ARRAY_SETTINGS = new Set(["customDictionary"]);

const LANGUAGE_MIGRATIONS: Record<string, string> = { zh: "zh-CN" };

function migratePreferredLanguage() {
  if (!isBrowser) return;
  const stored = localStorage.getItem("preferredLanguage");
  if (stored && LANGUAGE_MIGRATIONS[stored]) {
    localStorage.setItem("preferredLanguage", LANGUAGE_MIGRATIONS[stored]);
  }
}

migratePreferredLanguage();

export type TranscriptionBackend = "local" | "huggingface";
export type HfMode = "endpoint" | "api";

export interface SettingsState
  extends TranscriptionSettings, HotkeySettings, MicrophoneSettings, ThemeSettings {
  audioCuesEnabled: boolean;
  floatingIconAutoHide: boolean;

  // HuggingFace inference settings
  transcriptionBackend: TranscriptionBackend;
  hfMode: HfMode;
  hfEndpointUrl: string;
  hfModelId: string;
  hfApiToken: string;

  // Custom local CTranslate2 model path
  customModelPath: string;

  setFasterWhisperModel: (value: string) => void;
  setPreferredLanguage: (value: string) => void;
  setCustomDictionary: (words: string[]) => void;
  setUiLanguage: (language: string) => void;

  setDictationKey: (key: string) => void;
  setActivationMode: (mode: "tap" | "push") => void;

  setPreferBuiltInMic: (value: boolean) => void;
  setSelectedMicDeviceId: (value: string) => void;

  setTheme: (value: "light" | "dark" | "auto") => void;
  setSttDevice: (value: "auto" | "cuda" | "cpu") => void;
  setAudioCuesEnabled: (value: boolean) => void;
  setFloatingIconAutoHide: (enabled: boolean) => void;

  setTranscriptionBackend: (value: TranscriptionBackend) => void;
  setHfMode: (value: HfMode) => void;
  setHfEndpointUrl: (value: string) => void;
  setHfModelId: (value: string) => void;
  setHfApiToken: (value: string) => void;
  setCustomModelPath: (value: string) => void;

  updateTranscriptionSettings: (settings: Partial<TranscriptionSettings>) => void;
}

function createStringSetter(key: string) {
  return (value: string) => {
    if (isBrowser) localStorage.setItem(key, value);
    useSettingsStore.setState({ [key]: value });
  };
}

function createBooleanSetter(key: string) {
  return (value: boolean) => {
    if (isBrowser) localStorage.setItem(key, String(value));
    useSettingsStore.setState({ [key]: value });
  };
}

/** Debounced sync of HF settings to the main process .env file. */
let _hfSyncTimer: ReturnType<typeof setTimeout> | null = null;
function _syncHfSettingsToMain() {
  if (!isBrowser || !window.electronAPI?.saveHfSettings) return;
  if (_hfSyncTimer) clearTimeout(_hfSyncTimer);
  _hfSyncTimer = setTimeout(() => {
    const s = useSettingsStore.getState();
    window.electronAPI.saveHfSettings({
      transcriptionBackend: s.transcriptionBackend,
      hfEndpointUrl: s.hfEndpointUrl,
      hfModelId: s.hfModelId,
      hfApiToken: s.hfApiToken,
    }).catch(() => {});
  }, 300);
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  uiLanguage: normalizeUiLanguage(isBrowser ? localStorage.getItem("uiLanguage") : null),
  fasterWhisperModel: readString("fasterWhisperModel", "base"),
  preferredLanguage: readString("preferredLanguage", "auto"),
  customDictionary: readStringArray("customDictionary", []),

  dictationKey: readString("dictationKey", ""),
  activationMode: (readString("activationMode", "tap") === "push" ? "push" : "tap") as
    | "tap"
    | "push",

  sttDevice: (() => {
    const v = readString("sttDevice", "auto");
    if (v === "cuda" || v === "cpu") return v;
    return "auto" as const;
  })() as "auto" | "cuda" | "cpu",

  preferBuiltInMic: readBoolean("preferBuiltInMic", true),
  selectedMicDeviceId: readString("selectedMicDeviceId", ""),

  theme: (() => {
    const v = readString("theme", "auto");
    if (v === "light" || v === "dark" || v === "auto") return v;
    return "auto" as const;
  })(),
  audioCuesEnabled: readBoolean("audioCuesEnabled", true),
  floatingIconAutoHide: readBoolean("floatingIconAutoHide", false),

  // HuggingFace inference settings
  transcriptionBackend: (readString("transcriptionBackend", "local") === "huggingface"
    ? "huggingface"
    : "local") as TranscriptionBackend,
  hfMode: (readString("hfMode", "api") === "endpoint" ? "endpoint" : "api") as HfMode,
  hfEndpointUrl: readString("hfEndpointUrl", ""),
  hfModelId: readString("hfModelId", "openai/whisper-large-v3"),
  hfApiToken: readString("hfApiToken", ""),

  // Custom local CTranslate2 model path
  customModelPath: readString("customModelPath", ""),

  setFasterWhisperModel: createStringSetter("fasterWhisperModel"),
  setPreferredLanguage: createStringSetter("preferredLanguage"),

  setCustomDictionary: (words: string[]) => {
    if (isBrowser) localStorage.setItem("customDictionary", JSON.stringify(words));
    set({ customDictionary: words });
    window.electronAPI?.setDictionary(words).catch((err) => {
      logger.warn(
        "Failed to sync dictionary to SQLite",
        { error: (err as Error).message },
        "settings"
      );
    });
  },

  setUiLanguage: (language: string) => {
    const normalized = normalizeUiLanguage(language);
    if (isBrowser) localStorage.setItem("uiLanguage", normalized);
    set({ uiLanguage: normalized });
    void i18n.changeLanguage(normalized);
    if (isBrowser && window.electronAPI?.setUiLanguage) {
      window.electronAPI.setUiLanguage(normalized).catch((err) => {
        logger.warn(
          "Failed to sync UI language to main process",
          { error: (err as Error).message },
          "settings"
        );
      });
    }
  },

  setDictationKey: (key: string) => {
    if (isBrowser) localStorage.setItem("dictationKey", key);
    set({ dictationKey: key });
    if (isBrowser) {
      window.electronAPI?.notifyHotkeyChanged?.(key);
      window.electronAPI?.saveDictationKey?.(key);
    }
  },

  setActivationMode: (mode: "tap" | "push") => {
    if (isBrowser) localStorage.setItem("activationMode", mode);
    set({ activationMode: mode });
    if (isBrowser) {
      window.electronAPI?.notifyActivationModeChanged?.(mode);
    }
  },

  setSttDevice: (value: "auto" | "cuda" | "cpu") => {
    if (isBrowser) localStorage.setItem("sttDevice", value);
    useSettingsStore.setState({ sttDevice: value });
  },

  setPreferBuiltInMic: createBooleanSetter("preferBuiltInMic"),
  setSelectedMicDeviceId: createStringSetter("selectedMicDeviceId"),

  setTheme: (value: "light" | "dark" | "auto") => {
    if (isBrowser) localStorage.setItem("theme", value);
    set({ theme: value });
  },

  setAudioCuesEnabled: createBooleanSetter("audioCuesEnabled"),

  setFloatingIconAutoHide: (enabled: boolean) => {
    if (get().floatingIconAutoHide === enabled) return;
    if (isBrowser) localStorage.setItem("floatingIconAutoHide", String(enabled));
    set({ floatingIconAutoHide: enabled });
    if (isBrowser) {
      window.electronAPI?.notifyFloatingIconAutoHideChanged?.(enabled);
    }
  },

  setTranscriptionBackend: (value: TranscriptionBackend) => {
    createStringSetter("transcriptionBackend")(value);
    _syncHfSettingsToMain();
  },
  setHfMode: (value: HfMode) => {
    createStringSetter("hfMode")(value);
    _syncHfSettingsToMain();
  },
  setHfEndpointUrl: (value: string) => {
    createStringSetter("hfEndpointUrl")(value);
    _syncHfSettingsToMain();
  },
  setHfModelId: (value: string) => {
    createStringSetter("hfModelId")(value);
    _syncHfSettingsToMain();
  },
  setHfApiToken: (value: string) => {
    createStringSetter("hfApiToken")(value);
    _syncHfSettingsToMain();
  },

  setCustomModelPath: createStringSetter("customModelPath"),

  updateTranscriptionSettings: (settings: Partial<TranscriptionSettings>) => {
    const s = useSettingsStore.getState();
    if (settings.uiLanguage !== undefined) s.setUiLanguage(settings.uiLanguage);
    if (settings.fasterWhisperModel !== undefined)
      s.setFasterWhisperModel(settings.fasterWhisperModel);
    if (settings.preferredLanguage !== undefined)
      s.setPreferredLanguage(settings.preferredLanguage);
    if (settings.customDictionary !== undefined) s.setCustomDictionary(settings.customDictionary);
  },
}));

// --- Convenience getters for non-React code ---

export function getSettings() {
  return useSettingsStore.getState();
}

// --- Initialization ---

let hasInitialized = false;

export async function initializeSettings(): Promise<void> {
  if (hasInitialized) return;
  hasInitialized = true;

  if (!isBrowser) return;

  const state = useSettingsStore.getState();

  if (window.electronAPI) {
    // Sync dictation key from main process
    try {
      const envKey = await window.electronAPI.getDictationKey?.();
      if (envKey && envKey !== state.dictationKey) {
        createStringSetter("dictationKey")(envKey);
      }
    } catch (err) {
      logger.warn(
        "Failed to sync dictation key on startup",
        { error: (err as Error).message },
        "settings"
      );
    }

    // Sync activation mode from main process
    try {
      const envMode = await window.electronAPI.getActivationMode?.();
      if (envMode && envMode !== state.activationMode) {
        if (isBrowser) localStorage.setItem("activationMode", envMode);
        useSettingsStore.setState({ activationMode: envMode });
      }
    } catch (err) {
      logger.warn(
        "Failed to sync activation mode on startup",
        { error: (err as Error).message },
        "settings"
      );
    }

    // Sync UI language from main process
    try {
      const envLanguage = await window.electronAPI.getUiLanguage?.();
      const resolved = normalizeUiLanguage(envLanguage || state.uiLanguage);
      if (resolved !== state.uiLanguage) {
        if (isBrowser) localStorage.setItem("uiLanguage", resolved);
        useSettingsStore.setState({ uiLanguage: resolved });
      }
      await i18n.changeLanguage(resolved);
    } catch (err) {
      logger.warn(
        "Failed to sync UI language on startup",
        { error: (err as Error).message },
        "settings"
      );
      void i18n.changeLanguage(normalizeUiLanguage(state.uiLanguage));
    }

    const migratedLang = isBrowser ? localStorage.getItem("preferredLanguage") : null;
    if (migratedLang && migratedLang !== state.preferredLanguage) {
      useSettingsStore.setState({ preferredLanguage: migratedLang });
    }

    // Sync dictionary from SQLite <-> localStorage
    try {
      if (window.electronAPI.getDictionary) {
        const currentDictionary = useSettingsStore.getState().customDictionary;
        const dbWords = await window.electronAPI.getDictionary();
        if (dbWords.length === 0 && currentDictionary.length > 0) {
          await window.electronAPI.setDictionary(currentDictionary);
        } else if (dbWords.length > 0 && currentDictionary.length === 0) {
          if (isBrowser) localStorage.setItem("customDictionary", JSON.stringify(dbWords));
          useSettingsStore.setState({ customDictionary: dbWords });
        }
      }
    } catch (err) {
      logger.warn(
        "Failed to sync dictionary on startup",
        { error: (err as Error).message },
        "settings"
      );
    }

    ensureAgentNameInDictionary();
  }

  // Sync Zustand store when another window writes to localStorage
  window.addEventListener("storage", (event) => {
    if (!event.key || event.storageArea !== localStorage || event.newValue === null) return;

    const { key, newValue } = event;
    const state = useSettingsStore.getState();
    if (!(key in state) || typeof (state as unknown as Record<string, unknown>)[key] === "function")
      return;

    let value: unknown;
    if (BOOLEAN_SETTINGS.has(key)) {
      value = newValue === "true";
    } else if (ARRAY_SETTINGS.has(key)) {
      try {
        const parsed = JSON.parse(newValue);
        value = Array.isArray(parsed) ? parsed : [];
      } catch {
        value = [];
      }
    } else {
      value = newValue;
    }

    useSettingsStore.setState({ [key]: value });

    if (key === "uiLanguage" && typeof value === "string") {
      void i18n.changeLanguage(value);
    }
  });
}
