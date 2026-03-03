import logger from "../utils/logger";
import { isBuiltInMicrophone } from "../utils/audioDeviceUtils";
import { getBaseLanguageCode } from "../utils/languageSupport";
import { getSettings } from "../stores/settingsStore";

class AudioManager {
  constructor() {
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.isRecording = false;
    this.isProcessing = false;
    this.onStateChange = null;
    this.onError = null;
    this.onTranscriptionComplete = null;
    this.onPartialTranscript = null;

    this.recordingStartTime = null;
    this.cachedMicDeviceId = null;
    this.persistentAudioContext = null;
    this.workletModuleLoaded = false;
    this.workletBlobUrl = null;
    this.skipReasoning = false;
    this.context = "dictation";
    this.sttConfig = null;

    // Streaming state
    this.isStreaming = false;
    this.isStreamingStartInProgress = false;
    this._streamingWorkletNode = null;
    this._streamingSource = null;
    this._streamingStream = null;
    this._partialCleanup = null;
  }

  getWorkletBlobUrl() {
    if (this.workletBlobUrl) return this.workletBlobUrl;
    const code = `
const BUFFER_SIZE = 800;
class PCMStreamingProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Int16Array(BUFFER_SIZE);
    this._offset = 0;
    this._stopped = false;
    this.port.onmessage = (event) => {
      if (event.data === "stop") {
        if (this._offset > 0) {
          const partial = this._buffer.slice(0, this._offset);
          this.port.postMessage(partial.buffer, [partial.buffer]);
          this._buffer = new Int16Array(BUFFER_SIZE);
          this._offset = 0;
        }
        this._stopped = true;
      }
    };
  }
  process(inputs) {
    if (this._stopped) return false;
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      this._buffer[this._offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this._offset >= BUFFER_SIZE) {
        this.port.postMessage(this._buffer.buffer, [this._buffer.buffer]);
        this._buffer = new Int16Array(BUFFER_SIZE);
        this._offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-streaming-processor", PCMStreamingProcessor);
`;
    this.workletBlobUrl = URL.createObjectURL(new Blob([code], { type: "application/javascript" }));
    return this.workletBlobUrl;
  }

  getCustomDictionaryPrompt() {
    const words = getSettings().customDictionary;
    return words.length > 0 ? words.join(", ") : null;
  }

  setCallbacks({
    onStateChange,
    onError,
    onTranscriptionComplete,
    onPartialTranscript,
    onStreamingCommit,
  }) {
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.onTranscriptionComplete = onTranscriptionComplete;
    this.onPartialTranscript = onPartialTranscript;
    this.onStreamingCommit = onStreamingCommit;
  }

  setSkipReasoning(skip) {
    this.skipReasoning = skip;
  }

  setContext(context) {
    this.context = context;
  }

  setSttConfig(config) {
    this.sttConfig = config;
  }

  async getAudioConstraints() {
    const { preferBuiltInMic: preferBuiltIn, selectedMicDeviceId: selectedDeviceId } =
      getSettings();

    // Disable browser audio processing -- dictation doesn't need it and it adds ~48ms latency
    const noProcessing = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };

    if (preferBuiltIn) {
      if (this.cachedMicDeviceId) {
        logger.debug(
          "Using cached microphone device ID",
          { deviceId: this.cachedMicDeviceId },
          "audio"
        );
        return { audio: { deviceId: { exact: this.cachedMicDeviceId }, ...noProcessing } };
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter((d) => d.kind === "audioinput");
        const builtInMic = audioInputs.find((d) => isBuiltInMicrophone(d.label));

        if (builtInMic) {
          this.cachedMicDeviceId = builtInMic.deviceId;
          logger.debug(
            "Using built-in microphone (cached for next time)",
            { deviceId: builtInMic.deviceId, label: builtInMic.label },
            "audio"
          );
          return { audio: { deviceId: { exact: builtInMic.deviceId }, ...noProcessing } };
        }
      } catch (error) {
        logger.debug(
          "Failed to enumerate devices for built-in mic detection",
          { error: error.message },
          "audio"
        );
      }
    }

    if (!preferBuiltIn && selectedDeviceId) {
      logger.debug("Using selected microphone", { deviceId: selectedDeviceId }, "audio");
      return { audio: { deviceId: { exact: selectedDeviceId }, ...noProcessing } };
    }

    logger.debug("Using default microphone", {}, "audio");
    return { audio: noProcessing };
  }

  async cacheMicrophoneDeviceId() {
    if (this.cachedMicDeviceId) return; // Already cached

    if (!getSettings().preferBuiltInMic) return; // Only needed for built-in mic detection

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === "audioinput");
      const builtInMic = audioInputs.find((d) => isBuiltInMicrophone(d.label));
      if (builtInMic) {
        this.cachedMicDeviceId = builtInMic.deviceId;
        logger.debug("Microphone device ID pre-cached", { deviceId: builtInMic.deviceId }, "audio");
      }
    } catch (error) {
      logger.debug("Failed to pre-cache microphone device ID", { error: error.message }, "audio");
    }
  }

  async startRecording() {
    try {
      if (this.isRecording || this.isProcessing || this.mediaRecorder?.state === "recording") {
        return false;
      }

      const constraints = await this.getAudioConstraints();
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const settings = audioTrack.getSettings();
        logger.info(
          "Recording started with microphone",
          {
            label: audioTrack.label,
            deviceId: settings.deviceId?.slice(0, 20) + "...",
            sampleRate: settings.sampleRate,
            channelCount: settings.channelCount,
          },
          "audio"
        );
      }

      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];
      this.recordingStartTime = Date.now();
      this.recordingMimeType = this.mediaRecorder.mimeType || "audio/webm";

      this.mediaRecorder.ondataavailable = (event) => {
        this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = async () => {
        this.isRecording = false;
        this.isProcessing = true;
        this.onStateChange?.({ isRecording: false, isProcessing: true });

        const audioBlob = new Blob(this.audioChunks, { type: this.recordingMimeType });

        logger.info(
          "Recording stopped",
          {
            blobSize: audioBlob.size,
            blobType: audioBlob.type,
            chunksCount: this.audioChunks.length,
          },
          "audio"
        );

        const durationSeconds = this.recordingStartTime
          ? (Date.now() - this.recordingStartTime) / 1000
          : null;
        this.recordingStartTime = null;
        await this.processAudio(audioBlob, { durationSeconds });

        stream.getTracks().forEach((track) => track.stop());
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      this.onStateChange?.({ isRecording: true, isProcessing: false });

      return true;
    } catch (error) {
      let errorTitle = "Recording Error";
      let errorDescription = `Failed to access microphone: ${error.message}`;

      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        errorTitle = "Microphone Access Denied";
        errorDescription =
          "Please grant microphone permission in your system settings and try again.";
      } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        errorTitle = "No Microphone Found";
        errorDescription = "No microphone was detected. Please connect a microphone and try again.";
      } else if (error.name === "NotReadableError" || error.name === "TrackStartError") {
        errorTitle = "Microphone In Use";
        errorDescription =
          "The microphone is being used by another application. Please close other apps and try again.";
      }

      this.onError?.({
        title: errorTitle,
        description: errorDescription,
      });
      return false;
    }
  }

  stopRecording() {
    if (this.mediaRecorder?.state === "recording") {
      this.mediaRecorder.stop();
      return true;
    }
    return false;
  }

  cancelRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      this.mediaRecorder.onstop = () => {
        this.isRecording = false;
        this.isProcessing = false;
        this.audioChunks = [];
        this.recordingStartTime = null;
        this.onStateChange?.({ isRecording: false, isProcessing: false });
      };

      this.mediaRecorder.stop();

      if (this.mediaRecorder.stream) {
        this.mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      }

      return true;
    }
    return false;
  }

  cancelProcessing() {
    if (this.isProcessing) {
      this.isProcessing = false;
      this.onStateChange?.({ isRecording: false, isProcessing: false });
      return true;
    }
    return false;
  }

  async processAudio(audioBlob, metadata = {}) {
    const pipelineStart = performance.now();

    try {
      const s = getSettings();
      const activeModel = s.fasterWhisperModel || "base";
      const result = await this.processWithFasterWhisper(audioBlob, activeModel, metadata);

      if (!this.isProcessing) {
        return;
      }

      this.onTranscriptionComplete?.(result);

      const roundTripDurationMs = Math.round(performance.now() - pipelineStart);

      const timingData = {
        mode: "local-faster-whisper",
        model: activeModel,
        audioDurationMs: metadata.durationSeconds
          ? Math.round(metadata.durationSeconds * 1000)
          : null,
        roundTripDurationMs,
        audioSizeBytes: audioBlob.size,
        audioFormat: audioBlob.type,
        outputTextLength: result?.text?.length,
        audioConversionDurationMs: result?.timings?.audioConversionDurationMs ?? null,
        transcriptionProcessingDurationMs:
          result?.timings?.transcriptionProcessingDurationMs ?? null,
      };

      logger.info("Pipeline timing", timingData, "performance");
    } catch (error) {
      const errorAtMs = Math.round(performance.now() - pipelineStart);

      logger.error(
        "Pipeline failed",
        {
          errorAtMs,
          error: error.message,
        },
        "performance"
      );

      if (error.message !== "No audio detected") {
        this.onError?.({
          title: "Transcription Error",
          description: `Transcription failed: ${error.message}`,
          code: error.code,
        });
      }
    } finally {
      if (this.isProcessing) {
        this.isProcessing = false;
        this.onStateChange?.({ isRecording: false, isProcessing: false });
      }
    }
  }

  async processWithFasterWhisper(audioBlob, model = "base", _metadata = {}) {
    const timings = {};

    try {
      const arrayBuffer = await audioBlob.arrayBuffer();
      const language = getBaseLanguageCode(getSettings().preferredLanguage);
      const dictionaryPrompt = this.getCustomDictionaryPrompt();

      const options = { model };
      if (language) options.language = language;
      if (dictionaryPrompt) options.initialPrompt = dictionaryPrompt;

      logger.debug(
        "faster-whisper transcription starting",
        {
          audioFormat: audioBlob.type,
          audioSizeBytes: audioBlob.size,
          model,
        },
        "performance"
      );

      const transcriptionStart = performance.now();
      const result = await window.electronAPI.fasterWhisperTranscribe(arrayBuffer, options);
      timings.transcriptionProcessingDurationMs = Math.round(
        performance.now() - transcriptionStart
      );

      logger.debug(
        "faster-whisper transcription complete",
        {
          transcriptionProcessingDurationMs: timings.transcriptionProcessingDurationMs,
          success: result.success,
        },
        "performance"
      );

      if (result.success && result.text) {
        return { success: true, text: result.text, source: "local-faster-whisper", timings };
      } else if (result.message === "No audio detected") {
        throw new Error("No audio detected");
      } else {
        throw new Error(result.message || result.error || "faster-whisper transcription failed");
      }
    } catch (error) {
      if (error.message === "No audio detected") {
        throw error;
      }
      throw new Error(`faster-whisper failed: ${error.message}`);
    }
  }

  async optimizeAudio(audioBlob) {
    return new Promise((resolve) => {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const arrayBuffer = reader.result;
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

          // Convert to 16kHz mono for smaller size and faster processing
          const sampleRate = 16000;
          const channels = 1;
          const length = Math.floor(audioBuffer.duration * sampleRate);
          const offlineContext = new OfflineAudioContext(channels, length, sampleRate);

          const source = offlineContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(offlineContext.destination);
          source.start();

          const renderedBuffer = await offlineContext.startRendering();
          const wavBlob = this.audioBufferToWav(renderedBuffer);
          resolve(wavBlob);
        } catch (error) {
          // If optimization fails, use original
          resolve(audioBlob);
        }
      };

      reader.onerror = () => resolve(audioBlob);
      reader.readAsArrayBuffer(audioBlob);
    });
  }

  audioBufferToWav(buffer) {
    const length = buffer.length;
    const arrayBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(arrayBuffer);
    const sampleRate = buffer.sampleRate;
    const channelData = buffer.getChannelData(0);

    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, length * 2, true);

    let offset = 44;
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }

  async safePaste(text, options = {}) {
    try {
      await window.electronAPI.pasteText(text, options);
      return true;
    } catch (error) {
      const message =
        error?.message ??
        (typeof error?.toString === "function" ? error.toString() : String(error));
      this.onError?.({
        title: "Paste Error",
        description: `Failed to paste text. Please check accessibility permissions. ${message}`,
      });
      return false;
    }
  }

  async saveTranscription(text) {
    try {
      await window.electronAPI.saveTranscription(text);
      return true;
    } catch (error) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Streaming methods
  // ---------------------------------------------------------------------------

  shouldUseStreaming() {
    const mode =
      this.context === "notes" ? this.sttConfig?.notes?.mode : this.sttConfig?.dictation?.mode;
    return mode === "streaming";
  }

  warmupStreamingConnection() {
    const settings = getSettings();
    const model = settings.fasterWhisperModel || "base";
    const language = getBaseLanguageCode(settings.preferredLanguage) || null;
    const dictionaryPrompt = this.getCustomDictionaryPrompt();

    window.electronAPI
      .fasterWhisperStreamingStart?.({
        model,
        device: settings.sttDevice || "auto",
        language,
        initialPrompt: dictionaryPrompt,
      })
      .catch((err) => {
        logger.debug("Streaming warmup failed (non-fatal)", { error: err.message }, "streaming");
      });
  }

  async startStreamingRecording() {
    if (this.isRecording || this.isProcessing || this.isStreamingStartInProgress) {
      return false;
    }

    this.isStreamingStartInProgress = true;
    this.onStateChange?.({
      isRecording: false,
      isProcessing: false,
      isStreaming: false,
      isStreamingStartInProgress: true,
    });

    try {
      // 1. Get mic stream
      const constraints = await this.getAudioConstraints();
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      // 2. Get/create 16kHz AudioContext
      const audioContext = await this.getOrCreateAudioContext();

      // 3. Load AudioWorklet module
      if (!this.workletModuleLoaded) {
        await audioContext.addModule(this.getWorkletBlobUrl());
        this.workletModuleLoaded = true;
      }

      // 4. Create AudioWorkletNode
      const workletNode = new AudioWorkletNode(audioContext, "pcm-streaming-processor");

      // 5. Connect: MediaStreamSource → WorkletNode
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(workletNode);
      // Don't connect to destination — we don't want playback

      // 6. Start session with sidecar
      const settings = getSettings();
      const model = settings.fasterWhisperModel || "base";
      const language = getBaseLanguageCode(settings.preferredLanguage) || null;
      const dictionaryPrompt = this.getCustomDictionaryPrompt();

      await window.electronAPI.fasterWhisperStreamingStart({
        model,
        device: settings.sttDevice || "auto",
        language,
        initialPrompt: dictionaryPrompt,
      });

      // 7. Worklet onmessage: accumulate PCM chunks, send in ~500ms batches
      // 16kHz * 2 bytes/sample * 0.5s = 16000 bytes per batch
      const SEND_THRESHOLD = 16000;
      let sendBuffer = new Uint8Array(0);

      workletNode.port.onmessage = (event) => {
        const pcmBuffer = new Uint8Array(event.data);
        // Append to send buffer
        const merged = new Uint8Array(sendBuffer.length + pcmBuffer.length);
        merged.set(sendBuffer);
        merged.set(pcmBuffer, sendBuffer.length);
        sendBuffer = merged;

        if (sendBuffer.length >= SEND_THRESHOLD) {
          const base64 = this._uint8ToBase64(sendBuffer);
          window.electronAPI.fasterWhisperStreamingSend?.(base64);
          sendBuffer = new Uint8Array(0);
        }
      };

      // 8. Register partial transcript listener
      const cleanupPartial = window.electronAPI.onFasterWhisperPartial?.((data) => {
        this.onPartialTranscript?.(data.text);
      });

      // Store references for cleanup
      this._streamingWorkletNode = workletNode;
      this._streamingSource = source;
      this._streamingStream = stream;
      this._partialCleanup = cleanupPartial;
      this._streamingSendBuffer = {
        ref: sendBuffer,
        get: () => sendBuffer,
        flush: () => {
          if (sendBuffer.length > 0) {
            const base64 = this._uint8ToBase64(sendBuffer);
            window.electronAPI.fasterWhisperStreamingSend?.(base64);
            sendBuffer = new Uint8Array(0);
          }
        },
      };

      // 9. Set state
      this.isRecording = true;
      this.isStreaming = true;
      this.isStreamingStartInProgress = false;
      this.recordingStartTime = Date.now();
      this.onStateChange?.({
        isRecording: true,
        isProcessing: false,
        isStreaming: true,
      });

      logger.info("Streaming recording started", { model, language }, "streaming");
      return true;
    } catch (error) {
      this.isStreamingStartInProgress = false;
      this.onStateChange?.({
        isRecording: false,
        isProcessing: false,
        isStreaming: false,
      });

      let errorTitle = "Recording Error";
      let errorDescription = `Failed to start streaming: ${error.message}`;

      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        errorTitle = "Microphone Access Denied";
        errorDescription =
          "Please grant microphone permission in your system settings and try again.";
      } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        errorTitle = "No Microphone Found";
        errorDescription = "No microphone was detected. Please connect a microphone and try again.";
      }

      this.onError?.({ title: errorTitle, description: errorDescription });
      return false;
    }
  }

  async stopStreamingRecording() {
    if (!this.isStreaming && !this.isStreamingStartInProgress) {
      return false;
    }

    try {
      // 1. Send "stop" to worklet to flush remaining audio
      if (this._streamingWorkletNode) {
        this._streamingWorkletNode.port.postMessage("stop");
        // Brief wait for the flush message to arrive
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      // 2. Flush any remaining send buffer
      this._streamingSendBuffer?.flush();

      // 3. Call stop to get final text
      const result = await window.electronAPI.fasterWhisperStreamingStop();

      // 4. Disconnect audio nodes, stop mic tracks
      this._cleanupStreamingResources();

      // 5. Set state
      const durationSeconds = this.recordingStartTime
        ? (Date.now() - this.recordingStartTime) / 1000
        : null;
      this.recordingStartTime = null;
      this.isRecording = false;
      this.isStreaming = false;
      this.isStreamingStartInProgress = false;
      this.onStateChange?.({
        isRecording: false,
        isProcessing: false,
        isStreaming: false,
      });

      // 6. Deliver result
      if (result.success && result.text) {
        logger.info(
          "Streaming recording complete",
          { textLength: result.text.length, durationSeconds },
          "streaming"
        );
        this.onTranscriptionComplete?.({
          success: true,
          text: result.text,
          source: "local-faster-whisper-streaming",
        });
      } else if (!result.text) {
        // No speech detected — not an error, just no output
        logger.debug("Streaming: no speech detected", {}, "streaming");
      } else {
        this.onError?.({
          title: "Transcription Error",
          description: result.error || "Streaming transcription failed",
        });
      }

      return true;
    } catch (error) {
      this._cleanupStreamingResources();
      this.isRecording = false;
      this.isStreaming = false;
      this.isStreamingStartInProgress = false;
      this.onStateChange?.({
        isRecording: false,
        isProcessing: false,
        isStreaming: false,
      });

      this.onError?.({
        title: "Transcription Error",
        description: `Streaming stop failed: ${error.message}`,
      });
      return false;
    }
  }

  _cleanupStreamingResources() {
    if (this._streamingWorkletNode) {
      try {
        this._streamingWorkletNode.disconnect();
      } catch {
        /* ignore */
      }
      this._streamingWorkletNode = null;
    }
    if (this._streamingSource) {
      try {
        this._streamingSource.disconnect();
      } catch {
        /* ignore */
      }
      this._streamingSource = null;
    }
    if (this._streamingStream) {
      this._streamingStream.getTracks().forEach((track) => track.stop());
      this._streamingStream = null;
    }
    if (this._partialCleanup) {
      this._partialCleanup();
      this._partialCleanup = null;
    }
    this._streamingSendBuffer = null;
  }

  _uint8ToBase64(uint8Array) {
    let binary = "";
    const len = uint8Array.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  }

  getState() {
    return {
      isRecording: this.isRecording,
      isProcessing: this.isProcessing,
      isStreaming: this.isStreaming,
      isStreamingStartInProgress: this.isStreamingStartInProgress,
    };
  }

  async getOrCreateAudioContext() {
    if (this.persistentAudioContext && this.persistentAudioContext.state !== "closed") {
      if (this.persistentAudioContext.state === "suspended") {
        await this.persistentAudioContext.resume();
      }
      return this.persistentAudioContext;
    }
    this.persistentAudioContext = new AudioContext({ sampleRate: 16000 });
    this.workletModuleLoaded = false;
    return this.persistentAudioContext;
  }

  cleanup() {
    if (this.isStreaming) {
      this._cleanupStreamingResources();
      this.isStreaming = false;
      this.isStreamingStartInProgress = false;
    }
    if (this.mediaRecorder?.state === "recording") {
      this.stopRecording();
    }
    if (this.persistentAudioContext && this.persistentAudioContext.state !== "closed") {
      this.persistentAudioContext.close().catch(() => {});
      this.persistentAudioContext = null;
      this.workletModuleLoaded = false;
    }
    if (this.workletBlobUrl) {
      URL.revokeObjectURL(this.workletBlobUrl);
      this.workletBlobUrl = null;
    }
    this.onStateChange = null;
    this.onError = null;
    this.onTranscriptionComplete = null;
    this.onPartialTranscript = null;
    this.onStreamingCommit = null;
  }
}

export default AudioManager;
