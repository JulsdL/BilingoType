# BilingoType - Fork Plan & Implementation Strategy

## Source: OpenWhispr v1.5.4 (MIT License)

**Repository**: https://github.com/OpenWhispr/openwhispr
**Stack**: Electron 36 + React 19 + TypeScript + Vite 6 + Zustand + shadcn-ui + better-sqlite3

---

## 1. Fork Evaluation Summary

### Overall: 8.5/10 Reusability

OpenWhispr is well-architected with clean separation of concerns, immutable Zustand state, type-safe IPC (902-line type definitions), and platform-specific native binaries. Most infrastructure is directly reusable.

**Critical gap**: Local Whisper transcription is **batch-only** (HTTP POST to whisper-server `/inference`). Streaming only exists via cloud providers (Deepgram, AssemblyAI). This is the #1 item to replace.

---

## 2. What to KEEP (minimal changes)

| Component | File(s) | Why |
|-----------|---------|-----|
| **Electron shell** | `main.js`, `preload.js` | Solid: single-instance lock, frameless window, always-on-top, platform flags |
| **IPC bridge** | `preload.js`, `src/types/electron.ts` | Secure contextBridge pattern, memory-leak-safe listener cleanup |
| **Windows text injection** | `src/helpers/clipboard.js`, `resources/bin/windows-fast-paste*` | Native C binary using Win32 SendInput — exactly what we need |
| **Windows push-to-talk** | `src/helpers/windowsKeyManager.js`, `resources/bin/windows-key-listener*` | Low-level keyboard hook, KEY_DOWN/KEY_UP events |
| **Hotkey system** | `src/helpers/hotkeyManager.js` | Fallback chain, right-side modifiers, compound combos, .env persistence |
| **GPU detection** | `src/utils/gpuDetection.js` | nvidia-smi query with caching |
| **Audio cues** | `src/utils/dictationCues.js` | Web Audio API sine tones for start/stop feedback |
| **Settings store pattern** | `src/stores/settingsStore.ts` | Zustand + localStorage + IPC sync (3-layer persistence) |
| **Transcription store** | `src/stores/transcriptionStore.ts` | 50-item sliding window, IPC listeners |
| **Model manager** | `src/helpers/ModelManager.ts` | Generic download with progress, atomic rename, path traversal protection |
| **Build config** | `electron-builder.json`, `vite.config.mjs` | Multi-platform packaging, code splitting, dev server |
| **Dictation window UI** | `src/App.jsx` | Floating microphone overlay, auto-hide, command menu |
| **i18n** | `locales/` | Already supports FR and EN |

### Key: these components total ~60% of the codebase and need only cosmetic renaming (OpenWhispr → BilingoType).

---

## 3. What to STRIP (cloud/paid features)

| Component | File(s) | Reason |
|-----------|---------|--------|
| **Neon Auth / OAuth** | Auth flows in `main.js`, login UI | Local-only app, no accounts |
| **Cloud STT providers** | Deepgram, AssemblyAI streaming in `audioManager.js` | Replaced by local faster-whisper |
| **Cloud reasoning** | OpenAI, Anthropic, Groq, Mistral, Gemini API calls | Out of scope |
| **llama-server / local LLM** | `resources/bin/llama-server-*`, LLM model management | Out of scope for MVP |
| **Sherpa-ONNX / Parakeet** | `resources/bin/sherpa-onnx-*`, Parakeet IPC | Replaced by faster-whisper |
| **Cloud usage/billing** | Checkout, upgrade prompts, referrals | No monetization |
| **Auto-updater** | `electron-updater` integration | Manual updates for now |
| **Text monitor** | `resources/bin/*-text-monitor*` | Text editing features not needed |
| **macOS/Linux binaries** | `resources/bin/macos-*`, `resources/bin/linux-*` | Windows-first focus |
| **Cloud API keys UI** | OpenAI/Anthropic/Groq/Mistral/Gemini key inputs | No cloud |
| **Note system** | `src/stores/noteStore.ts`, Notes UI | Out of scope |

### Estimated strip: ~35% of codebase. Mainly `audioManager.js` (~97KB) and cloud provider code.

---

## 4. What to BUILD / REPLACE

### 4.1 STT Engine: faster-whisper (Python sidecar)

**Replace**: whisper.cpp HTTP server (`whisperServer.js`, `whisperManager.js`)
**With**: faster-whisper Python process with WebSocket streaming

```
Architecture:
  Electron Main Process
       │
       │ spawn Python subprocess
       ▼
  faster-whisper Server (Python)
       │
       │ WebSocket (ws://localhost:PORT)
       ▼
  Electron Main Process
       │
       │ IPC
       ▼
  Renderer (React UI)
```

**Why faster-whisper over whisper.cpp**:
- 4x faster via CTranslate2 (important for CPU mode)
- Native Python streaming API (`model.transcribe()` with `word_timestamps=True`)
- int8 quantization for 4GB GPU built-in
- Easier to integrate VAD (Silero) and post-processing (punctuation commands)
- Code-switching fine-tuning path is Python-native (HuggingFace)

**Key files to create**:
- `stt/server.py` — faster-whisper WebSocket server
- `stt/vad.py` — Silero VAD integration
- `stt/punctuation.py` — Voice command detection and replacement
- `stt/requirements.txt` — Python dependencies
- `src/helpers/fasterWhisperManager.ts` — Replaces whisperServer.js

### 4.2 Streaming Pipeline

**Current (OpenWhispr)**: Record full audio → POST WAV to whisper-server → get complete text
**Target (BilingoType)**: Continuous audio → VAD chunks → stream to faster-whisper → partial results → inject text

```
Mic Input (16kHz mono)
  │
  ▼
VAD (Silero) ─── silence → skip
  │
  speech
  ▼
Audio Buffer (~500ms chunks)
  │
  ▼
faster-whisper (streaming)
  │
  ├─ partial result → display preview (optional)
  │
  └─ final segment → punctuation commands → text injection
```

**Key design decisions**:
- **Chunk size**: ~500ms for balance of latency vs accuracy
- **Partial results**: Show in floating overlay, only inject final text
- **Segment detection**: Use Whisper's natural sentence boundaries + VAD silence gaps
- **Language**: `language=None` for auto-detect (enables code-switching)

### 4.3 Punctuation Command Engine

**New file**: `stt/punctuation.py`

Post-processes transcription output to detect voice commands and replace them:

```python
COMMANDS = {
    # French
    "point": ".", "virgule": ",", "deux points": ":",
    "point d'interrogation": "?", "point d'exclamation": "!",
    "à la ligne": "\n", "nouveau paragraphe": "\n\n",
    # English
    "period": ".", "comma": ",", "colon": ":",
    "question mark": "?", "exclamation mark": "!",
    "new line": "\n", "new paragraph": "\n\n",
}
```

**Approach**: Regex-based detection on final transcription segments. Commands at end of segment are replaced; commands mid-sentence are left as-is (they're probably the actual word).

### 4.4 Hybrid CPU/GPU Model Selection

**Enhance**: `src/utils/gpuDetection.js` → full hardware profiler

```
Startup:
  1. Detect NVIDIA GPU (nvidia-smi)
  2. Check VRAM amount
  3. Select model:
     - VRAM ≥ 4GB → large-v3-turbo (int8)
     - VRAM ≥ 2GB → medium (int8)
     - No GPU     → small or medium (CPU, float32)
  4. User can override in settings
```

The Python sidecar handles model loading based on config passed from Electron.

### 4.5 Settings Modifications

**Modify**: `src/stores/settingsStore.ts`

Settings to ADD:
- `sttEngine`: "faster-whisper" (fixed for now)
- `whisperModel`: "large-v3-turbo" | "large-v3" | "medium" | "small"
- `computeDevice`: "auto" | "cuda" | "cpu"
- `streamingMode`: true (always on)
- `punctuationCommands`: true | false
- `autoLanguage`: true (code-switching) | specific language code

Settings to REMOVE:
- All cloud API keys (openaiApiKey, anthropicApiKey, etc.)
- Cloud provider selections
- Reasoning model selections
- Telemetry/backup settings

---

## 5. Implementation Phases

### Phase 0: Fork Setup (Day 1)
- [ ] Fork OpenWhispr to BilingoType repo
- [ ] Strip cloud features (auth, cloud providers, billing)
- [ ] Strip unused platforms (macOS, Linux binaries for now)
- [ ] Rename: OpenWhispr → BilingoType throughout
- [ ] Verify Electron app still launches with stripped code
- [ ] Clean up dependencies (remove unused npm packages)

### Phase 1: faster-whisper Integration (Days 2-5)
- [ ] Create Python sidecar (`stt/`) with faster-whisper
- [ ] Implement WebSocket server for streaming results
- [ ] Create `fasterWhisperManager.ts` (spawn/manage Python process)
- [ ] Integrate Silero VAD
- [ ] Replace `audioManager.js` recording logic to stream to Python sidecar
- [ ] Test: record → transcribe → see text in console (no injection yet)
- [ ] Model download system (HuggingFace → local cache)

### Phase 2: Core Pipeline (Days 6-8)
- [ ] Connect streaming results to text injection (`clipboard.js`)
- [ ] Implement punctuation command detection
- [ ] Wire up hotkey → record → transcribe → inject flow end-to-end
- [ ] Partial result display in floating overlay
- [ ] Test: speak "bonjour point comment vas-tu" → injects "Bonjour. Comment vas-tu"

### Phase 3: Hybrid Hardware (Days 9-10)
- [ ] Enhanced GPU detection with VRAM-based model selection
- [ ] CUDA vs CPU auto-selection in Python sidecar
- [ ] Settings UI for compute device and model override
- [ ] Benchmark: measure actual latency on user's hardware

### Phase 4: Polish & Package (Days 11-14)
- [ ] Tray icon with status indicator
- [ ] Settings panel cleanup (remove cloud, add BilingoType-specific)
- [ ] Audio cue customization
- [ ] Windows installer (NSIS) packaging
- [ ] First-run experience: model download + hardware detection
- [ ] Error handling and crash recovery

### Future: Code-Switching Improvement
- Fine-tune Whisper on FR/EN datasets (SwitchLingua, CAFE)
- Language-aware decoding with per-chunk tokens
- Custom vocabulary injection via initial_prompt

---

## 6. Technical Decisions

### Why Python sidecar (not whisper.cpp)?

| Factor | whisper.cpp (current) | faster-whisper (proposed) |
|--------|----------------------|--------------------------|
| Speed | Fast (C++) | 4x faster (CTranslate2) |
| Streaming | HTTP batch only | Native streaming API |
| int8 quant | Manual build | Built-in |
| VAD | Separate tool | Silero integration |
| Fine-tuning | Hard (C++) | Easy (Python/HuggingFace) |
| Code-switching | Limited | Extensible post-processing |
| Packaging | Pre-built binaries | Python + pip (slightly heavier) |

**Trade-off**: Python adds ~100MB to the install size (embedded Python or conda). Worth it for the streaming API and extensibility.

### Python Distribution Strategy

Options (in preference order):
1. **Embedded Python** (PyInstaller/cx_Freeze): Bundle Python + faster-whisper as a single executable. Electron spawns it. No Python install required from user.
2. **Conda/venv**: Require Python, create venv at first run. Lighter but more fragile.
3. **Docker**: Heavy, but fully isolated. Good for WSL users.

**Recommendation**: Option 1 (embedded Python) for MVP. Package the Python sidecar as a standalone `.exe` alongside Electron.

### Communication Protocol

**WebSocket** between Electron and Python sidecar:

```json
// Electron → Python: audio chunk
{"type": "audio", "data": "<base64 PCM 16kHz mono>"}

// Electron → Python: control
{"type": "start", "model": "large-v3-turbo", "device": "cuda", "language": null}
{"type": "stop"}

// Python → Electron: partial result
{"type": "partial", "text": "Bonjour comment", "language": "fr"}

// Python → Electron: final segment
{"type": "final", "text": "Bonjour, comment vas-tu?", "language": "fr"}

// Python → Electron: status
{"type": "ready"}
{"type": "error", "message": "CUDA out of memory, falling back to CPU"}
```

---

## 7. Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| faster-whisper streaming latency too high on CPU | P0 - unusable | Benchmark early; fallback to smaller model |
| Python sidecar packaging complexity | P1 - hard to install | PyInstaller; test on clean Windows VM |
| Code-switching accuracy below 70% | P1 - frustrating UX | Set expectations; plan fine-tuning phase |
| Windows text injection fails in some apps | P1 - partial functionality | OpenWhispr's native binary handles this well; test edge cases |
| VRAM insufficient for large-v3-turbo int8 | P2 - perf degradation | Auto-fallback to medium model |
| Whisper hallucinations on silence | P2 - phantom text | Silero VAD filtering; confidence threshold |

---

## 8. File Structure (Post-Fork)

```
BilingoType/
├── main.js                        # Electron main (modified)
├── preload.js                     # IPC bridge (kept)
├── package.json                   # Dependencies (cleaned)
├── electron-builder.json          # Build config (renamed)
│
├── src/
│   ├── App.jsx                    # Dictation floating window
│   ├── main.jsx                   # React entry
│   ├── components/
│   │   ├── ControlPanel.tsx       # Settings dashboard (simplified)
│   │   └── ...                    # shadcn-ui components (kept)
│   ├── stores/
│   │   ├── settingsStore.ts       # Settings (modified)
│   │   └── transcriptionStore.ts  # History (kept)
│   ├── helpers/
│   │   ├── fasterWhisperManager.ts  # NEW: Python sidecar manager
│   │   ├── clipboard.js           # Text injection (kept)
│   │   ├── hotkeyManager.js       # Hotkey system (kept)
│   │   ├── windowsKeyManager.js   # Push-to-talk (kept)
│   │   └── audioCapture.ts        # NEW: Mic → WebSocket streaming
│   ├── utils/
│   │   ├── gpuDetection.js        # GPU/VRAM detection (enhanced)
│   │   └── dictationCues.js       # Audio feedback (kept)
│   └── types/
│       └── electron.ts            # IPC types (updated)
│
├── stt/                           # NEW: Python sidecar
│   ├── server.py                  # WebSocket server + faster-whisper
│   ├── vad.py                     # Silero VAD
│   ├── punctuation.py             # Voice command detection
│   ├── requirements.txt           # Python deps
│   └── build.py                   # PyInstaller packaging script
│
├── resources/
│   └── bin/
│       ├── windows-fast-paste.exe   # Kept
│       ├── windows-key-listener.exe # Kept
│       └── bilingo-stt.exe          # NEW: Packaged Python sidecar
│
└── docs/
    ├── PRD.md                     # Product requirements
    └── FORK_PLAN.md               # This document
```

---

## 9. Dependencies Delta

### NPM: Remove
- `@neondatabase/auth`, `@neondatabase/neon-js` (cloud auth)
- `electron-updater` (auto-update — defer to later)
- Cloud provider SDKs (if any bundled)

### NPM: Keep
- `electron`, `react`, `vite`, `typescript` (core stack)
- `zustand` (state management)
- `better-sqlite3` (transcription history)
- `ws` (WebSocket for Python sidecar communication)
- `i18next` (FR/EN localization)
- `@radix-ui/*`, `tailwindcss` (UI)
- `ffmpeg-static` (audio format conversion)

### Python: Add (in stt/)
- `faster-whisper` (CTranslate2-based Whisper)
- `silero-vad` (voice activity detection)
- `websockets` (server)
- `numpy` (audio processing)
- `torch` (CUDA support — or `onnxruntime-gpu` for lighter option)
- `pyinstaller` (dev dependency, for packaging)
