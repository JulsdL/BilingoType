# BilingoType Technical Reference for AI Assistants

This document provides comprehensive technical details about the BilingoType project architecture for AI assistants working on the codebase.

## Project Overview

BilingoType is an Electron-based desktop dictation application focused on French/English code-switching. It uses **faster-whisper** (via a Python sidecar) for local speech-to-text transcription, with optional **HuggingFace Inference** as a cloud alternative. Forked from OpenWhispr, it has been stripped of whisper.cpp, Parakeet/sherpa-onnx, cloud providers (OpenAI, Anthropic, Gemini, Groq, Mistral), and llama-server.

## Architecture Overview

### Core Technologies
- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Vite
- **Desktop Framework**: Electron 36 with context isolation
- **Database**: better-sqlite3 for local transcription history
- **UI Components**: shadcn/ui with Radix primitives
- **Speech Processing**: faster-whisper (CTranslate2) via Python sidecar + HuggingFace Inference API
- **Audio Processing**: FFmpeg (bundled via ffmpeg-static)

### Key Architectural Decisions

1. **Dual Window Architecture**:
   - Main Window: Minimal overlay for dictation (draggable, always on top)
   - Control Panel: Full settings interface (normal window)
   - Both use same React codebase with URL-based routing

2. **Process Separation**:
   - Main Process: Electron main, IPC handlers, database operations
   - Renderer Process: React app with context isolation
   - Preload Script: Secure bridge between processes
   - Python Sidecar: faster-whisper + HuggingFace transcription via WebSocket

3. **Transcription Pipeline**:
   ```
   Renderer (MediaRecorder API)
       │ IPC (PCM base64)
       ▼
   Main Process (fasterWhisperManager.js)
       │ WebSocket (ws://127.0.0.1:PORT)
       ▼
   Python Sidecar (bilingotype_stt)
       │
       ├─ Local: faster-whisper engine (CTranslate2)
       └─ Cloud: HuggingFace Inference API/Endpoints (httpx)
   ```

4. **Transcription Backends**:
   - `"local"` (default): faster-whisper runs on device (CPU or CUDA)
   - `"huggingface"`: Audio sent to HuggingFace Inference API or user's own Inference Endpoint
   - Backend selection persisted in localStorage + `.env` file

## File Structure and Responsibilities

### Main Process Files

- **main.js**: Application entry point, initializes all managers
- **preload.js**: Exposes safe IPC methods to renderer via `window.electronAPI`

### Python Sidecar (stt/)

- **stt/src/bilingotype_stt/server.py**: WebSocket server, routes `start`/`audio`/`stop` messages to local engine or HF client
- **stt/src/bilingotype_stt/engine.py**: `WhisperEngine` class — loads faster-whisper models (standard or custom CTranslate2 path), accumulates audio chunks, transcribes
- **stt/src/bilingotype_stt/hf_client.py**: `HuggingFaceClient` — sends accumulated PCM audio as WAV to HF Inference API/Endpoints via httpx
- **stt/src/bilingotype_stt/vad.py**: `VadEngine` — Silero VAD for speech activity detection
- **stt/src/bilingotype_stt/punctuation.py**: Voice command detection (e.g., "period" → ".", "virgule" → ",")
- **stt/pyproject.toml**: Python dependencies (faster-whisper, websockets, numpy, httpx, silero-vad)

### Native Resources (resources/)

- **windows-key-listener.c**: C source for Windows low-level keyboard hook (Push-to-Talk)
- **globe-listener.swift**: Swift source for macOS Globe/Fn key detection
- **bin/**: Compiled native binaries (nircmd, key listeners, fast-paste, text-monitor)

### Helper Modules (src/helpers/)

- **fasterWhisperManager.js**: Spawns Python sidecar via `uv`, manages WebSocket connection, session lifecycle, crash recovery with exponential backoff
- **audioManager.js**: Handles audio device management and recording routing
- **clipboard.js**: Cross-platform clipboard operations
  - macOS: AppleScript-based paste with accessibility permission check
  - Windows: PowerShell SendKeys with nircmd.exe fallback
  - Linux: Native XTest binary + compositor-aware fallbacks (xdotool, wtype, ydotool)
- **database.js**: SQLite operations for transcription history
- **debugLogger.js**: Debug logging system with file output
- **devServerManager.js**: Vite dev server integration
- **dragManager.js**: Window dragging functionality
- **environment.js**: Environment variable management and `.env` file persistence
- **hotkeyManager.js**: Global hotkey registration and management
  - Handles platform-specific defaults (GLOBE on macOS, backtick on Windows/Linux)
  - Auto-fallback to F8/F9 if default hotkey is unavailable
  - Integrates with GnomeShortcutManager for GNOME Wayland support
- **gnomeShortcut.js**: GNOME Wayland global shortcut integration via D-Bus
- **ipcHandlers.js**: Centralized IPC handler registration
- **windowsKeyManager.js**: Windows Push-to-Talk support with native key listener
- **whisperCudaManager.js**: CUDA detection utilities for GPU/CPU selection
- **menuManager.js**: Application menu management
- **tray.js**: System tray icon and menu
- **windowConfig.js**: Centralized window configuration
- **windowManager.js**: Window creation and lifecycle management

### React Components (src/components/)

- **App.jsx**: Main dictation interface with recording states
- **ControlPanel.tsx**: Settings, history, model management UI
- **OnboardingFlow.tsx**: First-time setup wizard
- **SettingsPage.tsx**: Comprehensive settings interface (transcription backend, HF settings, custom model path, hardware, dictionary, hotkeys, etc.)
- **TranscriptionModelPicker.tsx**: faster-whisper model selection and download UI
- **ui/**: Reusable UI components (buttons, cards, inputs, etc.)

### React Hooks (src/hooks/)

- **useAudioRecording.js**: MediaRecorder API wrapper with error handling
- **useClipboard.ts**: Clipboard operations hook
- **useDialogs.ts**: Electron dialog integration
- **useHotkey.js**: Hotkey state management
- **useLocalStorage.ts**: Type-safe localStorage wrapper
- **usePermissions.ts**: System permission checks and settings access
- **useSettings.ts**: Application settings management (wraps Zustand store + context)
- **useModelDownload.ts**: Model download progress tracking

### Build Scripts (scripts/)

- **download-nircmd.js**: Downloads nircmd.exe for Windows clipboard operations
- **download-windows-key-listener.js**: Downloads prebuilt Windows key listener binary
- **build-globe-listener.js**: Compiles macOS Globe key listener from Swift source
- **build-windows-key-listener.js**: Compiles Windows key listener (for local development)
- **run-electron.js**: Development script to launch Electron with proper environment
- **lib/download-utils.js**: Shared utilities for downloading and extracting files

## Key Implementation Details

### 1. faster-whisper Sidecar

The Python sidecar is managed by `FasterWhisperManager` in the main process:
- Spawned via `uv run` with the `stt/` project
- Communicates over WebSocket on a random port in range 8200-8229
- Signals readiness via `BILINGOTYPE_STT_READY:{port}` on stdout
- Auto-restarts on crash with exponential backoff (max 3 attempts)
- Health checks via ping/pong every 5 seconds

**Session protocol** (JSON over WebSocket):
```json
// Electron → Python
{"type": "start", "model": "base", "device": "auto", "language": null, "initialPrompt": null}
{"type": "start", "backend": "huggingface", "hfApiToken": "hf_...", "hfModelId": "openai/whisper-large-v3"}
{"type": "start", "model": "base", "customModelPath": "/path/to/ctranslate2/model"}
{"type": "audio", "data": "<base64 PCM int16 16kHz mono>"}
{"type": "stop"}
{"type": "ping"}

// Python → Electron
{"type": "ready"}
{"type": "partial", "text": "hello", "language": "en"}
{"type": "final", "text": "Hello, how are you?", "language": "en"}
{"type": "error", "message": "...", "recoverable": true}
{"type": "pong"}
```

### 2. HuggingFace Inference

Two modes selectable in settings:
- **Inference API**: Shared infrastructure, `https://api-inference.huggingface.co/models/{model_id}`
- **Inference Endpoint**: User's own dedicated server (custom URL)

Audio is accumulated in the sidecar during HF sessions and sent as a batch WAV via HTTP POST on `stop`.

### 3. Custom CTranslate2 Model Path

Users can load their own fine-tuned Whisper models converted to CTranslate2 format:
- Browse button opens directory picker (`showOpenDialog`)
- Path persisted to `.env` via `CUSTOM_MODEL_PATH`
- When set, standard model picker is hidden
- Path passed to `WhisperEngine(model_source)` which accepts both model names and local paths

### 4. Local Whisper Models (CTranslate2 format)

Models stored in `~/.cache/bilingotype/faster-whisper-models/`:
- tiny, base, small, medium, large-v3, large-v3-turbo
- Downloaded from HuggingFace on first use
- Device auto-detection: CUDA (int8_float16) → CPU (int8) fallback

### 5. Settings Storage

Settings stored in localStorage (renderer) with Zustand store sync:
- `fasterWhisperModel`: Selected faster-whisper model
- `sttDevice`: "auto" | "cuda" | "cpu"
- `transcriptionBackend`: "local" | "huggingface"
- `hfMode`: "endpoint" | "api"
- `hfEndpointUrl`: HuggingFace Inference Endpoint URL
- `hfModelId`: HuggingFace model ID (default: "openai/whisper-large-v3")
- `hfApiToken`: HuggingFace API token
- `customModelPath`: Path to custom CTranslate2 model directory
- `preferredLanguage`: Language code or "auto"
- `customDictionary`: JSON array of words/phrases for transcription hints
- `dictationKey`: Hotkey string
- `activationMode`: "tap" | "push"
- `theme`: "light" | "dark" | "auto"

Environment variables persisted to `.env` (via `saveAllKeysToEnvFile()`):
- `FASTER_WHISPER_MODEL`, `STT_DEVICE`, `DICTATION_KEY`, `ACTIVATION_MODE`
- `TRANSCRIPTION_BACKEND`, `HF_ENDPOINT_URL`, `HF_MODEL_ID`, `HF_API_TOKEN`
- `CUSTOM_MODEL_PATH`, `UI_LANGUAGE`, `STT_BENCHMARK_MS`

### 6. Database Schema

```sql
CREATE TABLE transcriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  original_text TEXT NOT NULL,
  processed_text TEXT,
  is_processed BOOLEAN DEFAULT 0,
  processing_method TEXT DEFAULT 'none',
  agent_name TEXT,
  error TEXT
);
```

### 7. Language Support

58 languages supported (see src/utils/languages.ts):
- Each language has a two-letter code and label
- "auto" for automatic detection (enables code-switching)
- Passed to faster-whisper via `language` parameter in session start

### 8. Custom Dictionary

Improve transcription accuracy for specific words, names, or technical terms:
- Words stored as JSON array in localStorage (`customDictionary` key) and synced to SQLite
- On transcription, words joined and passed as `initialPrompt` parameter to faster-whisper
- Auto-learn corrections: When user edits transcribed text in external apps, corrections detected and added to dictionary automatically

### 9. System Settings Integration

The app can open OS-level settings for microphone permissions, sound input selection, and accessibility:

| Platform | Microphone Privacy | Sound Input | Accessibility |
|----------|-------------------|-------------|---------------|
| macOS | `x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone` | `x-apple.systempreferences:com.apple.preference.sound?input` | `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility` |
| Windows | `ms-settings:privacy-microphone` | `ms-settings:sound` | N/A |
| Linux | Manual | Manual (e.g., pavucontrol) | N/A |

### 10. Debug Mode

Enable with `--log-level=debug` or `BILINGOTYPE_LOG_LEVEL=debug` (can be set in `.env`):
- Logs saved to platform-specific app data directory
- Comprehensive logging of audio pipeline and sidecar communication

### 11. Windows Push-to-Talk

- `resources/windows-key-listener.c`: Native C program using `SetWindowsHookEx`
- Supports compound hotkeys (e.g., `Ctrl+Shift+F11`)
- Falls back to tap mode if binary unavailable

### 12. GNOME Wayland Global Hotkeys

- Uses native GNOME shortcuts via D-Bus and gsettings
- D-Bus service: `com.bilingotype.App`
- Push-to-talk unavailable (GNOME shortcuts only fire single toggle event)
- Falls back to X11/globalShortcut if GNOME integration fails

## Codegraph (Dependency Intelligence)

Codegraph is installed for function-level dependency analysis. Use CLI commands (not MCP) to query the graph before modifying code.

```bash
codegraph build                      # rebuild after structural changes
codegraph fn-impact <name> -T        # blast radius
codegraph context <name> -T          # full context
codegraph diff-impact --staged -T    # verify impact of staged changes
codegraph where <name>               # locate any symbol
codegraph hotspots                   # find complex/coupled code
```

## Development Guidelines

### Internationalization (i18n) — REQUIRED

All user-facing strings **must** use the i18n system. Never hardcode UI text in components.

**Setup**: react-i18next (v15) with i18next (v25). Translation files in `src/locales/{lang}/translation.json`.

**Supported languages**: en, es, fr, de, pt, it, ru, zh-CN, zh-TW, ja

**Rules**:
1. Every new UI string must have a translation key in `en/translation.json` and all other language files
2. Use `useTranslation()` hook in components and hooks
3. Keep `{{variable}}` interpolation syntax for dynamic values
4. Do NOT translate: brand names (BilingoType), technical terms (CTranslate2, CUDA), format names
5. Group keys by feature area (e.g., `settingsPage.transcription.backend.*`)

### Adding New Features

1. **New IPC Channel**: Add to `ipcHandlers.js`, `preload.js`, and `src/types/electron.ts`
2. **New Setting**: Update `settingsStore.ts`, `useSettings.ts`, and `SettingsPage.tsx`
3. **New UI Component**: Follow shadcn/ui patterns in `src/components/ui`
4. **New Manager**: Create in `src/helpers/`, initialize in `main.js`
5. **New UI Strings**: Add translation keys to all 10 language files

### Testing Checklist

- [ ] Local faster-whisper transcription works (record → transcribe → paste)
- [ ] HuggingFace backend works (audio sent, transcription returned)
- [ ] Custom CTranslate2 model loads from local path
- [ ] Switching between Local/HuggingFace backends works correctly
- [ ] Verify hotkey works globally
- [ ] Check clipboard pasting on all platforms
- [ ] Test with different audio input devices
- [ ] Test custom dictionary with uncommon words
- [ ] Verify Windows Push-to-Talk with compound hotkeys
- [ ] Test GNOME Wayland hotkeys (if on GNOME + Wayland)

### Common Issues and Solutions

1. **No Audio Detected**:
   - Check FFmpeg path resolution
   - Verify microphone permissions
   - Check audio levels in debug logs

2. **Transcription Fails**:
   - Ensure `uv` is installed (required for Python sidecar)
   - Check sidecar startup logs (`faster-whisper stderr` in debug)
   - Verify model download completed
   - Check CUDA availability if GPU mode selected

3. **Clipboard Not Working**:
   - macOS: Check accessibility permissions
   - Linux: Install xdotool (X11) or wtype (Wayland)
   - Windows: PowerShell SendKeys (built-in) or nircmd.exe (bundled)

4. **HuggingFace Inference Fails**:
   - Verify API token starts with `hf_`
   - Check endpoint URL is accessible
   - Review sidecar error messages in debug logs

### Platform-Specific Notes

**macOS**:
- Requires accessibility permissions for clipboard (auto-paste)
- Requires microphone permission (prompted by system)
- System settings accessible via `x-apple.systempreferences:` URL scheme

**Windows**:
- NSIS installer for distribution
- Push-to-Talk via native `windows-key-listener.exe`
- GPU workaround: `app.commandLine.appendSwitch("disable-gpu-compositing")`

**Linux**:
- AppImage/deb/rpm for distribution
- GNOME Wayland global hotkeys via D-Bus
- Recommend `pavucontrol` for audio device management

## Code Style and Conventions

- Use TypeScript for new React components
- Follow existing patterns in helpers/
- Immutable data patterns (create new objects, never mutate)
- Comprehensive debug logging
- Clean up resources (files, listeners)
- Files under 800 lines, functions under 50 lines

## Security Considerations

- Context isolation enabled
- No remote code execution
- Sanitized file paths
- Limited IPC surface area
- HF API tokens stored in `.env` file (not in source)
