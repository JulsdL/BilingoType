import React, { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { useSettingsStore, initializeSettings } from "../stores/settingsStore";
import logger from "../utils/logger";
import { useLocalStorage } from "./useLocalStorage";

export interface TranscriptionSettings {
  uiLanguage: string;
  fasterWhisperModel: string;
  preferredLanguage: string;
  customDictionary: string[];
  sttDevice: "auto" | "cuda" | "cpu";
}

export interface HotkeySettings {
  dictationKey: string;
  activationMode: "tap" | "push";
}

export interface MicrophoneSettings {
  preferBuiltInMic: boolean;
  selectedMicDeviceId: string;
}

export interface ThemeSettings {
  theme: "light" | "dark" | "auto";
}

function useSettingsInternal() {
  const store = useSettingsStore();

  // One-time initialization: sync dictation key, activation mode,
  // UI language, and dictionary from the main process / SQLite.
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    initializeSettings().catch((err) => {
      logger.warn(
        "Failed to initialize settings store",
        { error: (err as Error).message },
        "settings"
      );
    });
  }, []);

  // Listen for dictionary updates from main process (auto-learn corrections)
  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.onDictionaryUpdated) return;
    const unsubscribe = window.electronAPI.onDictionaryUpdated((words: string[]) => {
      if (Array.isArray(words)) {
        store.setCustomDictionary(words);
      }
    });
    return unsubscribe;
  }, [store.setCustomDictionary]);

  // Auto-learn corrections from user edits in external apps
  const [autoLearnCorrections, setAutoLearnCorrectionsRaw] = useLocalStorage(
    "autoLearnCorrections",
    true,
    {
      serialize: String,
      deserialize: (value: string) => value !== "false",
    }
  );

  const setAutoLearnCorrections = useCallback(
    (enabled: boolean) => {
      setAutoLearnCorrectionsRaw(enabled);
      window.electronAPI?.setAutoLearnEnabled?.(enabled);
    },
    [setAutoLearnCorrectionsRaw]
  );

  // Sync auto-learn state to main process on mount
  useEffect(() => {
    window.electronAPI?.setAutoLearnEnabled?.(autoLearnCorrections);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync startup pre-warming preferences to main process
  const { fasterWhisperModel, sttDevice } = store;

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.syncStartupPreferences) return;

    window.electronAPI
      .syncStartupPreferences({
        fasterWhisperModel: fasterWhisperModel || undefined,
        sttDevice,
      })
      .catch((err) =>
        logger.warn(
          "Failed to sync startup preferences",
          { error: (err as Error).message },
          "settings"
        )
      );
  }, [fasterWhisperModel, sttDevice]);

  return {
    uiLanguage: store.uiLanguage,
    fasterWhisperModel: store.fasterWhisperModel,
    preferredLanguage: store.preferredLanguage,
    customDictionary: store.customDictionary,
    setUiLanguage: store.setUiLanguage,
    setFasterWhisperModel: store.setFasterWhisperModel,
    setPreferredLanguage: store.setPreferredLanguage,
    setCustomDictionary: store.setCustomDictionary,
    sttDevice: store.sttDevice,
    setSttDevice: store.setSttDevice,
    dictationKey: store.dictationKey,
    setDictationKey: store.setDictationKey,
    theme: store.theme,
    setTheme: store.setTheme,
    activationMode: store.activationMode,
    setActivationMode: store.setActivationMode,
    audioCuesEnabled: store.audioCuesEnabled,
    setAudioCuesEnabled: store.setAudioCuesEnabled,
    floatingIconAutoHide: store.floatingIconAutoHide,
    setFloatingIconAutoHide: store.setFloatingIconAutoHide,
    preferBuiltInMic: store.preferBuiltInMic,
    selectedMicDeviceId: store.selectedMicDeviceId,
    setPreferBuiltInMic: store.setPreferBuiltInMic,
    setSelectedMicDeviceId: store.setSelectedMicDeviceId,
    autoLearnCorrections,
    setAutoLearnCorrections,
    updateTranscriptionSettings: store.updateTranscriptionSettings,
    // HuggingFace inference settings
    transcriptionBackend: store.transcriptionBackend,
    setTranscriptionBackend: store.setTranscriptionBackend,
    hfMode: store.hfMode,
    setHfMode: store.setHfMode,
    hfEndpointUrl: store.hfEndpointUrl,
    setHfEndpointUrl: store.setHfEndpointUrl,
    hfModelId: store.hfModelId,
    setHfModelId: store.setHfModelId,
    hfApiToken: store.hfApiToken,
    setHfApiToken: store.setHfApiToken,
    // Custom local model path
    customModelPath: store.customModelPath,
    setCustomModelPath: store.setCustomModelPath,
  };
}

export type SettingsValue = ReturnType<typeof useSettingsInternal>;

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const value = useSettingsInternal();
  return React.createElement(SettingsContext.Provider, { value }, children);
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return ctx;
}
