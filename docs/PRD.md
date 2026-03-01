# BilingoType - Product Requirements Document

## Vision

A system-wide voice typing tool for Windows that handles French/English code-switching natively, runs 100% locally, and replaces Win+H with a faster, multilingual alternative.

## Problem Statement

Windows voice typing (Win+H) only supports one language at a time. Users who naturally mix French and English ("franglais") get garbled transcriptions. No existing tool offers:
- System-wide dictation (any text field, any app)
- Real-time streaming transcription (text appears as you speak)
- Robust French/English code-switching
- Fully local processing (no cloud dependency)

## Target User

Developers and power users on Windows (with or without WSL) who:
- Think and speak in mixed French/English
- Want hands-free text input across their entire desktop
- Value privacy (no audio sent to the cloud)
- Use VS Code, terminals, browsers, chat apps, etc.

## Base Project

Fork of [OpenWhispr](https://github.com/OpenWhispr/openwhispr) (MIT License).

OpenWhispr provides:
- Electron + React + TypeScript + Vite architecture
- Native Windows text injection via C binary (`windows-fast-paste`, Win32 `SendInput`)
- Terminal vs app detection for paste method
- Global hotkey with low-level keyboard hook
- Local Whisper (whisper.cpp) and NVIDIA Parakeet (sherpa-onnx) support
- GPU acceleration + CPU fallback
- Custom dictionary system
- Transcription history (SQLite)

---

## Functional Requirements

### FR-1: System-Wide Voice Typing

**Priority: P0 (Must Have)**

- Works in any text field on Windows: VS Code, browser, terminal, chat apps, Office, etc.
- Text appears at the current cursor position in the active window
- Transparent to the target application (no app-specific integration needed)
- Adapts paste method: Ctrl+V for apps, Ctrl+Shift+V for terminals

### FR-2: Real-Time Streaming Transcription

**Priority: P0 (Must Have)**

- Text appears progressively as the user speaks (like Win+H)
- Target latency: < 2 seconds from speech to text on screen
- Partial results displayed and refined as more audio context arrives
- Voice Activity Detection (VAD) to filter silence and reduce processing

### FR-3: French/English Code-Switching

**Priority: P0 (Must Have)**

- Handles mixed French and English in the same sentence
- No manual language switching required
- Works in any proportion: mostly French with English words, mostly English with French words, or 50/50
- Graceful degradation: if a word is misrecognized, the sentence structure remains intact

### FR-4: Activation Modes

**Priority: P0 (Must Have)**

- **Push-to-talk**: Hold a key to record, release to stop
- **Toggle**: Press once to start, press again to stop
- Mode is user-configurable in settings
- Hotkey is customizable (default: backtick or user's choice)
- Support for compound hotkeys (e.g., Ctrl+Shift+Space)

### FR-5: Punctuation Support

**Priority: P1 (Should Have)**

- **Auto-punctuation**: The model inserts natural punctuation (periods, commas, question marks) based on speech patterns and pauses
- **Voice commands** for explicit punctuation, supporting both languages:
  - "point" / "period" → `.`
  - "virgule" / "comma" → `,`
  - "point d'interrogation" / "question mark" → `?`
  - "point d'exclamation" / "exclamation mark" → `!`
  - "deux points" / "colon" → `:`
  - "à la ligne" / "new line" → `\n`
  - "nouveau paragraphe" / "new paragraph" → `\n\n`
- Voice commands are stripped from the output text (user says "bonjour point" → output is "Bonjour.")

### FR-6: Hybrid CPU/GPU Processing

**Priority: P1 (Should Have)**

- Auto-detect available hardware at startup (NVIDIA GPU with CUDA, or CPU-only)
- GPU mode: use larger/more accurate model (large-v3-turbo, int8 quantized for 4GB VRAM)
- CPU mode: use lighter model (small or medium) for acceptable latency
- User can override in settings (force CPU, force GPU, or auto)

### FR-7: Local-Only Processing

**Priority: P0 (Must Have)**

- All speech processing happens on-device
- No audio data leaves the machine
- No cloud API keys required for core functionality
- Models are downloaded once and stored locally

---

## Non-Functional Requirements

### NFR-1: Latency

- Streaming latency: < 2 seconds speech-to-text (GPU), < 3 seconds (CPU)
- Hotkey response: < 100ms to start recording after key press
- Text injection: < 50ms after transcription is ready

### NFR-2: Resource Usage

- Idle: < 50MB RAM, ~0% CPU
- Active transcription: < 1GB RAM (GPU mode), < 2GB RAM (CPU mode)
- No background processing when not recording

### NFR-3: Reliability

- Graceful handling of audio device changes (headset plugged/unplugged)
- Auto-recovery from STT engine crashes
- No data loss: if injection fails, text is copied to clipboard as fallback

### NFR-4: Privacy

- Zero telemetry by default
- No network calls except for optional model downloads
- Audio is processed in-memory and never written to disk (unless user opts in for history)

---

## Technical Architecture

### STT Engine: faster-whisper

Replace/complement OpenWhispr's whisper.cpp with [faster-whisper](https://github.com/SYSTRAN/faster-whisper):
- 4x faster than vanilla Whisper via CTranslate2
- Native streaming support
- int8 quantization for 4GB GPU
- Python-based, easier to extend for code-switching post-processing

### Models

| Hardware | Model | Size | Expected Latency |
|----------|-------|------|-------------------|
| NVIDIA GPU (4GB+) | large-v3-turbo (int8) | ~800MB | < 1.5s |
| NVIDIA GPU (4GB+) | large-v3 (int8) | ~1.5GB | < 2s |
| CPU (modern) | medium | ~1.5GB | < 3s |
| CPU (older) | small | ~500MB | < 3s |

### Component Overview

```
┌─────────────────────────────────────────────────┐
│ BilingoType (Electron App)                      │
│                                                  │
│  ┌──────────────┐  ┌────────────────────────┐   │
│  │ Tray UI      │  │ Settings Panel         │   │
│  │ (React)      │  │ (React)                │   │
│  └──────┬───────┘  └────────────────────────┘   │
│         │                                        │
│  ┌──────┴───────────────────────────────────┐   │
│  │ Core Engine                               │   │
│  │                                           │   │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────┐ │   │
│  │  │ Hotkey   │  │ Audio    │  │ Text    │ │   │
│  │  │ Listener │→ │ Capture  │→ │Injector │ │   │
│  │  └─────────┘  └────┬─────┘  └────▲────┘ │   │
│  │                     │              │      │   │
│  │               ┌─────▼──────────────┤      │   │
│  │               │ STT Pipeline       │      │   │
│  │               │                    │      │   │
│  │               │ Audio → VAD →      │      │   │
│  │               │ faster-whisper →   │      │   │
│  │               │ Punctuation Cmds → │      │   │
│  │               │ Text Output ───────┘      │   │
│  │               └────────────────────┘      │   │
│  └───────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### STT Pipeline Detail

1. **Audio Capture**: Mic input via system audio API
2. **VAD (Voice Activity Detection)**: Silero VAD to filter silence, reduce unnecessary processing
3. **Streaming Transcription**: faster-whisper processes audio chunks (~500ms) incrementally
4. **Punctuation Command Detection**: Post-process transcription to detect and replace voice commands ("point" → ".")
5. **Text Injection**: Send final text to active window via SendInput

### Code-Switching Strategy

Phase 1 (MVP):
- Use Whisper large-v3-turbo with `language=None` (auto-detect per chunk)
- Accept baseline code-switching quality (~70-80% accuracy on mixed sentences)

Phase 2 (Improvement):
- Fine-tune on French-English code-switching datasets (SwitchLingua, CAFE)
- Implement language-aware decoding with per-chunk language tokens
- Target: 30%+ error reduction on mixed sentences

---

## MVP Scope (Phase 1)

The minimum viable product includes:

- [ ] Fork OpenWhispr, strip cloud-only features
- [ ] Integrate faster-whisper as primary STT engine
- [ ] Implement streaming transcription with < 2s latency
- [ ] Push-to-talk and toggle activation modes
- [ ] System-wide text injection (inherited from OpenWhispr)
- [ ] Auto-detection of CPU/GPU with appropriate model selection
- [ ] Basic punctuation voice commands (point, virgule, à la ligne)
- [ ] Auto-punctuation from the model
- [ ] Tray icon with start/stop and basic settings

### Out of Scope for MVP

- Fine-tuned code-switching model (use baseline Whisper)
- Custom wake word
- Transcription history/search
- Multi-monitor awareness
- Dictation to specific app (always targets active window)

---

## Success Metrics

- **Accuracy**: > 90% word accuracy on monolingual speech (FR or EN)
- **Code-switching**: > 75% word accuracy on mixed FR/EN sentences
- **Latency**: < 2s speech-to-text on GPU, < 3s on CPU
- **Daily usability**: Can replace Win+H for the primary developer workflow
