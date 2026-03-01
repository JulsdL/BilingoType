const { spawn } = require("child_process");
const EventEmitter = require("events");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const WebSocket = require("ws");
const debugLogger = require("./debugLogger");
const { killProcess } = require("../utils/process");

const PORT_RANGE_START = 8200;
const PORT_RANGE_END = 8229;
const STARTUP_TIMEOUT_MS = 120000; // Model download on first run can be slow
const HEALTH_CHECK_INTERVAL_MS = 5000;
const READY_SIGNAL = "BILINGOTYPE_STT_READY:";
const WS_RECONNECT_DELAY_MS = 1000;
const WS_MAX_RECONNECTS = 3;
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_BACKOFF_MS = 2000;

class FasterWhisperManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.ws = null;
    this.port = null;
    this.ready = false;
    this.currentModel = null;
    this.currentDevice = null;
    this.startupPromise = null;
    this.healthCheckInterval = null;
    this._pendingFinal = null;
    this._wsReconnectCount = 0;
    this._restartAttempts = 0;
    this._restartTimer = null;
  }

  // ---------------------------------------------------------------------------
  // uv / Python detection
  // ---------------------------------------------------------------------------

  _findUvBinary() {
    const candidates =
      process.platform === "win32"
        ? [
            path.join(process.env.LOCALAPPDATA || "", "uv", "uv.exe"),
            path.join(process.env.USERPROFILE || "", ".cargo", "bin", "uv.exe"),
          ]
        : [
            path.join(os.homedir(), ".local", "bin", "uv"),
            path.join(os.homedir(), ".cargo", "bin", "uv"),
            "/usr/local/bin/uv",
            "/usr/bin/uv",
          ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    // Search PATH
    const pathEnv = process.env.PATH || "";
    const sep = process.platform === "win32" ? ";" : ":";
    const binary = process.platform === "win32" ? "uv.exe" : "uv";
    for (const dir of pathEnv.split(sep)) {
      if (!dir) continue;
      const candidate = path.join(dir, binary);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  _getSttProjectPath() {
    // Development: stt/ alongside the project root
    const devPath = path.join(__dirname, "..", "..", "stt");
    if (fs.existsSync(path.join(devPath, "pyproject.toml"))) {
      return devPath;
    }

    // Production: bundled in resources
    if (process.resourcesPath) {
      const prodPath = path.join(process.resourcesPath, "stt");
      if (fs.existsSync(path.join(prodPath, "pyproject.toml"))) {
        return prodPath;
      }
    }

    return null;
  }

  isAvailable() {
    return this._findUvBinary() !== null && this._getSttProjectPath() !== null;
  }

  // ---------------------------------------------------------------------------
  // Port finding (same pattern as WhisperServerManager)
  // ---------------------------------------------------------------------------

  async _findAvailablePort() {
    for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
      if (await this._isPortAvailable(port)) return port;
    }
    throw new Error(`No available ports in range ${PORT_RANGE_START}-${PORT_RANGE_END}`);
  }

  _isPortAvailable(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close();
        resolve(true);
      });
      server.listen(port, "127.0.0.1");
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(model, options = {}) {
    if (this.startupPromise) return this.startupPromise;

    if (this.ready && this.currentModel === model) return;

    if (this.process) {
      await this.stop();
    }

    this.startupPromise = this._doStart(model, options);
    try {
      await this.startupPromise;
    } finally {
      this.startupPromise = null;
    }
  }

  async _doStart(model, options = {}) {
    const uvBinary = this._findUvBinary();
    if (!uvBinary) throw new Error("uv binary not found — install uv: https://docs.astral.sh/uv/");

    const sttPath = this._getSttProjectPath();
    if (!sttPath) throw new Error("STT project not found");

    this.port = await this._findAvailablePort();
    this.currentModel = model;
    this.currentDevice = options.device || "auto";

    const args = [
      "run",
      "--project",
      sttPath,
      "python",
      "-m",
      "bilingotype_stt",
      "--port",
      String(this.port),
      "--log-level",
      options.logLevel || "info",
    ];

    debugLogger.debug("Starting faster-whisper sidecar", {
      uvBinary,
      sttPath,
      port: this.port,
      model,
      args,
    });

    const spawnEnv = { ...process.env };
    // Pass model cache dir via env
    if (!spawnEnv.BILINGOTYPE_MODEL_CACHE) {
      const cacheDir = path.join(os.homedir(), ".cache", "bilingotype", "faster-whisper-models");
      spawnEnv.BILINGOTYPE_MODEL_CACHE = cacheDir;
    }

    this.process = spawn(uvBinary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: spawnEnv,
    });

    let stderrBuffer = "";

    this.process.stderr.on("data", (data) => {
      stderrBuffer += data.toString();
      debugLogger.debug("faster-whisper stderr", { data: data.toString().trim() });
    });

    this.process.on("error", (error) => {
      debugLogger.error("faster-whisper process error", { error: error.message });
      this.ready = false;
    });

    this.process.on("close", (code) => {
      debugLogger.debug("faster-whisper process exited", { code });
      this.ready = false;
      this.process = null;
      this._closeWebSocket();
      this._stopHealthCheck();

      // Schedule restart on unexpected crash (non-zero exit, not intentional stop)
      if (code !== 0 && code !== null && this.currentModel) {
        this._scheduleRestart();
      }
    });

    // Wait for READY signal on stdout
    await this._waitForReady(() => stderrBuffer);

    // Connect WebSocket
    await this._connectWebSocket();

    this._startHealthCheck();

    debugLogger.info("faster-whisper sidecar started", {
      port: this.port,
      model,
    });
  }

  async _waitForReady(getStderr) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`faster-whisper sidecar failed to start within ${STARTUP_TIMEOUT_MS}ms`));
      }, STARTUP_TIMEOUT_MS);

      if (!this.process) {
        clearTimeout(timeout);
        reject(new Error("Process not started"));
        return;
      }

      let stdoutBuffer = "";

      this.process.stdout.on("data", (data) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split("\n");
        for (const line of lines) {
          if (line.startsWith(READY_SIGNAL)) {
            const actualPort = parseInt(line.slice(READY_SIGNAL.length), 10);
            if (!isNaN(actualPort)) {
              this.port = actualPort;
            }
            clearTimeout(timeout);
            resolve();
            return;
          }
        }
      });

      this.process.on("close", (code) => {
        clearTimeout(timeout);
        const stderr = getStderr();
        const detail = stderr ? stderr.trim().slice(0, 500) : `exit code: ${code}`;
        reject(new Error(`faster-whisper process died during startup: ${detail}`));
      });
    });
  }

  // ---------------------------------------------------------------------------
  // WebSocket client
  // ---------------------------------------------------------------------------

  async _connectWebSocket() {
    return new Promise((resolve, reject) => {
      const url = `ws://127.0.0.1:${this.port}`;
      this.ws = new WebSocket(url);

      this.ws.on("open", () => {
        debugLogger.debug("WebSocket connected to faster-whisper sidecar");
        this._wsReconnectCount = 0;
        resolve();
      });

      this.ws.on("message", (data) => {
        this._handleMessage(data.toString());
      });

      this.ws.on("close", () => {
        debugLogger.debug("WebSocket closed");
        this.ws = null;
      });

      this.ws.on("error", (err) => {
        debugLogger.error("WebSocket error", { error: err.message });
        reject(err);
      });
    });
  }

  _handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      debugLogger.warn("Invalid JSON from sidecar", { raw: raw.slice(0, 200) });
      return;
    }

    switch (msg.type) {
      case "ready":
        this.ready = true;
        this.emit("ready");
        break;

      case "partial":
        this.emit("partial-transcript", { text: msg.text, language: msg.language });
        break;

      case "final":
        this.emit("final-transcript", { text: msg.text, language: msg.language });
        if (this._pendingFinal) {
          this._pendingFinal.resolve({ success: true, text: msg.text, language: msg.language });
          this._pendingFinal = null;
        }
        break;

      case "error":
        debugLogger.error("STT sidecar error", { message: msg.message });
        this.emit("stt-error", { message: msg.message, recoverable: msg.recoverable });
        if (msg.message && msg.message.includes("CUDA")) {
          this.emit("cuda-fallback");
        }
        // If error is non-recoverable and we have a pending final, reject it
        if (!msg.recoverable && this._pendingFinal) {
          this._pendingFinal.reject(new Error(msg.message));
          this._pendingFinal = null;
        }
        break;

      case "pong":
        // Health check response — no action needed
        break;

      default:
        debugLogger.debug("Unknown message from sidecar", { type: msg.type });
    }
  }

  _closeWebSocket() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  _sendWs(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(JSON.stringify(msg));
  }

  // ---------------------------------------------------------------------------
  // Health check
  // ---------------------------------------------------------------------------

  _startHealthCheck() {
    this._stopHealthCheck();
    this.healthCheckInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        debugLogger.warn("faster-whisper health check: WebSocket not open, scheduling restart");
        this.ready = false;
        this._stopHealthCheck();
        this._scheduleRestart();
        return;
      }
      try {
        this._sendWs({ type: "ping" });
      } catch {
        debugLogger.warn("faster-whisper health check: ping failed, scheduling restart");
        this.ready = false;
        this._stopHealthCheck();
        this._scheduleRestart();
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  _stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Crash recovery
  // ---------------------------------------------------------------------------

  _scheduleRestart() {
    if (this._restartAttempts >= MAX_RESTART_ATTEMPTS) {
      debugLogger.error("faster-whisper max restart attempts reached", {
        attempts: this._restartAttempts,
      });
      this.emit("stt-error", {
        message: "STT sidecar crashed and could not be restarted",
        recoverable: false,
      });
      this._restartAttempts = 0;
      return;
    }

    const delay = RESTART_BACKOFF_MS * Math.pow(2, this._restartAttempts);
    this._restartAttempts++;

    debugLogger.warn("Scheduling faster-whisper restart", {
      attempt: this._restartAttempts,
      delayMs: delay,
    });

    this._restartTimer = setTimeout(async () => {
      this._restartTimer = null;
      try {
        await this.start(this.currentModel, { device: this.currentDevice });
        debugLogger.info("faster-whisper restarted successfully", {
          attempt: this._restartAttempts,
        });
        this._restartAttempts = 0;
      } catch (err) {
        debugLogger.error("faster-whisper restart failed", {
          attempt: this._restartAttempts,
          error: err.message,
        });
        // start() failure will trigger another close event → _scheduleRestart
      }
    }, delay);
  }

  // ---------------------------------------------------------------------------
  // Transcription session API (used by IPC handlers)
  // ---------------------------------------------------------------------------

  async startSession(options = {}) {
    const { model, device, language, initialPrompt } = options;

    // Ensure sidecar is running
    if (!this.process || !this.ws) {
      await this.start(model || this.currentModel || "base", { device });
    }

    this._sendWs({
      type: "start",
      model: model || this.currentModel || "base",
      device: device || this.currentDevice || "auto",
      language: language || null,
      initialPrompt: initialPrompt || null,
    });

    // Wait for ready signal
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Session start timeout")),
        STARTUP_TIMEOUT_MS
      );
      const onReady = () => {
        clearTimeout(timeout);
        resolve({ success: true });
      };
      const onError = (data) => {
        if (!data.recoverable) {
          clearTimeout(timeout);
          reject(new Error(data.message));
        }
      };
      this.once("ready", onReady);
      this.once("stt-error", onError);
    });
  }

  sendAudio(pcmBase64) {
    this._sendWs({ type: "audio", data: pcmBase64 });
  }

  async stopSession() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return { success: false, error: "Not connected" };
    }

    return new Promise((resolve) => {
      // Set up a pending final result handler
      const timeout = setTimeout(() => {
        this._pendingFinal = null;
        // No final result means no speech detected
        resolve({ success: true, text: "", language: "" });
      }, 10000);

      this._pendingFinal = {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timeout);
          resolve({ success: false, error: err.message });
        },
      };

      this._sendWs({ type: "stop" });
    });
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  async stop() {
    // Clear restart state to prevent restart after intentional stop
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    this._restartAttempts = 0;
    this.currentModel = null;

    this._stopHealthCheck();
    this._closeWebSocket();

    if (!this.process) {
      this.ready = false;
      return;
    }

    debugLogger.debug("Stopping faster-whisper sidecar");

    try {
      killProcess(this.process, "SIGTERM");

      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (this.process) {
            killProcess(this.process, "SIGKILL");
          }
          resolve();
        }, 5000);

        if (this.process) {
          this.process.once("close", () => {
            clearTimeout(timeout);
            resolve();
          });
        } else {
          clearTimeout(timeout);
          resolve();
        }
      });
    } catch (error) {
      debugLogger.error("Error stopping faster-whisper sidecar", { error: error.message });
    }

    this.process = null;
    this.ready = false;
    this.port = null;
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  getStatus() {
    return {
      available: this.isAvailable(),
      running: this.process !== null,
      ready: this.ready,
      port: this.port,
      currentModel: this.currentModel,
      device: this.currentDevice,
    };
  }
}

module.exports = FasterWhisperManager;
