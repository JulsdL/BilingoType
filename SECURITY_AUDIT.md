# BilingoType Security Audit Report

**Date**: 2026-03-04
**Scope**: Full application security scan (secrets, IPC/Electron, command injection, input validation, dependencies, file handling)
**Auditor**: Automated multi-agent security analysis

---

## Executive Summary

The BilingoType application demonstrates generally solid security practices with proper credential management, parameterized database queries, safe process spawning, and good Electron security defaults on the main window. However, several issues were identified across the Control Panel window configuration, IPC handler validation, and dependency chain.

| Severity | Count |
|----------|-------|
| CRITICAL | 2     |
| HIGH     | 8     |
| MEDIUM   | 9     |
| LOW      | 7     |

---

## CRITICAL Findings

### 1. `webSecurity: false` on Control Panel Window

**File**: `src/helpers/windowConfig.js:52`
**Severity**: CRITICAL
**CWE**: CWE-942 (Permissive Cross-domain Policy)

```javascript
webSecurity: false,
```

The Control Panel window disables the same-origin policy entirely. While the comment explains this is needed for `file://` to cross-origin fetch calls in production, this removes CORS protection for the entire window. A compromised or injected script could make arbitrary cross-origin requests, exfiltrate data, interact with any API using the user's credentials, or reach local services (whisper server, faster-whisper server on localhost).

**Recommendation**: Use Electron's `protocol.handle()` to register a custom `app://` protocol, or proxy API calls through the main process via IPC (as already done for Anthropic). This eliminates the need to disable web security.

### 2. Unvalidated URL in `open-external` IPC Handler

**File**: `src/helpers/ipcHandlers.js:831-838`
**Severity**: CRITICAL
**CWE**: CWE-601 (URL Redirection to Untrusted Site)

```javascript
ipcMain.handle("open-external", async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

The handler passes any renderer-supplied URL to `shell.openExternal()` without protocol validation. On Windows, `shell.openExternal` can execute arbitrary programs via `file:` or `ms-msdt:` URIs (Follina-class attacks). On macOS, custom URL schemes can trigger arbitrary app launches. Combined with any XSS vector (e.g., Finding #3), this becomes a direct path to code execution.

**Recommendation**: Validate URL against an allowlist of safe schemes:

```javascript
ipcMain.handle("open-external", async (event, url) => {
  let parsed;
  try { parsed = new URL(url); } catch { return { success: false }; }
  const ALLOWED = new Set(["https:", "http:", "mailto:"]);
  if (!ALLOWED.has(parsed.protocol)) return { success: false, error: "Disallowed protocol" };
  await shell.openExternal(url);
  return { success: true };
});
```

---

## HIGH Findings

### 3. `dangerouslySetInnerHTML` with Update Release Notes (XSS)

**File**: `src/components/SettingsPage.tsx:1388`
**Severity**: HIGH
**CWE**: CWE-79 (Cross-site Scripting)

```tsx
dangerouslySetInnerHTML={{ __html: updateInfo.releaseNotes }}
```

Release notes from the auto-updater (sourced from GitHub releases API) are rendered as raw HTML without sanitization. If the update feed is compromised (MITM, CDN compromise, or supply chain attack), an attacker could inject malicious HTML/JavaScript. Combined with `webSecurity: false` and `sandbox: false` on the control panel, the impact is amplified.

**Recommendation**: Install `dompurify` and sanitize before rendering:

```tsx
import DOMPurify from 'dompurify';
dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(updateInfo.releaseNotes) }}
```

### 4. `sandbox: false` on Control Panel Window

**File**: `src/helpers/windowConfig.js:48`
**Severity**: HIGH
**CWE**: CWE-693 (Protection Mechanism Failure)

```javascript
sandbox: false,
```

The Control Panel window runs without OS-level sandbox. The comment states this is required for the preload script's IPC bridge, but this is incorrect for modern Electron (12+). Preload scripts with `contextBridge.exposeInMainWorld` work correctly in sandboxed renderers. Disabling sandbox removes seccomp (Linux) / App Sandbox (macOS) protections.

**Recommendation**: Set `sandbox: true` and verify preload still works (it will in Electron 36).

### 5. `transcribe-audio-file` Accepts Arbitrary Filesystem Paths

**File**: `src/helpers/ipcHandlers.js:464-474`
**Severity**: HIGH
**CWE**: CWE-22 (Path Traversal)

```javascript
ipcMain.handle("transcribe-audio-file", async (event, filePath, options = {}) => {
  const fs = require("fs");
  try {
    const audioBuffer = fs.readFileSync(filePath);  // arbitrary path from renderer
    ...
  }
});
```

This handler reads an arbitrary filesystem path supplied by the renderer. Although intended for files from the system file dialog, the preload exposes `transcribeAudioFile(filePath, options)` as a separate call that any renderer code can invoke with any path (e.g., `/etc/passwd`, `~/.ssh/id_rsa`).

**Recommendation**: Validate that the path is within an expected directory, or move the `readFileSync` into the `select-audio-file` handler and pass the buffer via IPC instead of the path.

### 6. No Navigation Guard on Main (Dictation) Window

**File**: `src/helpers/windowManager.js`
**Severity**: HIGH
**CWE**: CWE-1021 (Improper Restriction of Rendered UI Layers)

The control panel window has a `will-navigate` handler (line 451) and `setWindowOpenHandler` (line 467) that block external navigation. The main dictation window has neither. If any code causes the main window to navigate to an external URL, it would load in an Electron window with full preload access.

**Recommendation**: Add `will-navigate` and `setWindowOpenHandler` guards to the main window, mirroring the control panel's protections.

### 7. API Keys Stored as Plaintext in `.env` File

**File**: `src/helpers/environment.js:184-198`
**Severity**: HIGH
**CWE**: CWE-312 (Cleartext Storage of Sensitive Information)

```javascript
async saveAllKeysToEnvFile() {
  const envPath = path.join(app.getPath("userData"), ".env");
  let envContent = "# BilingoType Environment Variables\n";
  for (const key of PERSISTED_KEYS) {
    if (process.env[key]) {
      envContent += `${key}=${process.env[key]}\n`;
    }
  }
  await fsPromises.writeFile(envPath, envContent, "utf8");
}
```

All API keys (OpenAI, Anthropic, Gemini, Groq, Mistral, custom) are written as plaintext to `~/.config/BilingoType/.env`. Any process running as the same user can read these keys.

**Recommendation**: Use Electron's `safeStorage` API to encrypt keys before persisting, or use the `keytar` package for OS keychain integration.

---

## Additional HIGH Findings (Command Injection Analysis)

### 8. Shell Injection in `commandExists()` via `sh -c`

**File**: `src/helpers/clipboard.js:319`
**Severity**: HIGH
**CWE**: CWE-78 (OS Command Injection)

```javascript
const res = spawnSync("sh", ["-c", `command -v ${cmd}`], {
  stdio: "ignore",
});
```

The `cmd` parameter is interpolated directly into a shell command string. All current callers pass hardcoded literals (`"xdotool"`, `"wtype"`, etc.), but the pattern is dangerous — if `cmd` ever comes from configuration or user input, values like `` `rm -rf ~` `` would execute arbitrary commands.

**Recommendation**: Replace with `spawnSync("which", [cmd], { stdio: "ignore" })` to eliminate shell invocation.

### 9. PowerShell Path Injection in `whisperCudaManager.js`

**File**: `src/helpers/whisperCudaManager.js:277-288`
**Severity**: HIGH
**CWE**: CWE-78 (OS Command Injection)

```javascript
execFile("powershell", [
  "-NoProfile", "-Command",
  `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${destDir}'`,
], ...);
```

Paths are interpolated into a PowerShell command using single quotes. A temp directory containing a single quote (e.g., `C:\Users\O'Brien\...`) would break out of the string delimiter and allow command injection.

**Recommendation**: Use PowerShell's `-EncodedCommand` option or pass paths as separate arguments.

### 10. JS Injection via Incomplete Hotkey Escaping in `executeJavaScript`

**File**: `src/helpers/hotkeyManager.js:430-440`
**Severity**: HIGH (stored XSS in renderer)
**CWE**: CWE-79 (Cross-site Scripting)

```javascript
const escapedHotkey = hotkey.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
await this.mainWindow.webContents.executeJavaScript(
  `localStorage.setItem("dictationKey", "${escapedHotkey}"); true;`
);
```

The escaping only handles `\` and `"`. A hotkey value containing newlines, backticks, or `${...}` would break out of the JS string context. Since `hotkey` is user-supplied via IPC, a malicious renderer could inject arbitrary JavaScript.

**Recommendation**: Use `JSON.stringify(hotkey)` instead of manual escaping:

```javascript
await this.mainWindow.webContents.executeJavaScript(
  `localStorage.setItem("dictationKey", ${JSON.stringify(hotkey)}); true;`
);
```

---

## MEDIUM Findings

### 8. No Content Security Policy (CSP)

**File**: `src/index.html`, `main.js`
**Severity**: MEDIUM
**CWE**: CWE-1021

No `<meta http-equiv="Content-Security-Policy">` tag exists in `index.html`, and no `session.webRequest.onHeadersReceived` injects CSP headers. Without CSP, if an XSS vulnerability is exploited, there is no policy to prevent inline script execution, data exfiltration, or external resource loads.

**Recommendation**: Add a strict CSP:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com; img-src 'self' data:;">
```

### 9. Dependency Vulnerabilities (npm audit)

**Severity**: MEDIUM (aggregate)

`npm audit` reports **18 vulnerabilities**: 2 critical, 12 high, 4 moderate.

| Package | Severity | Issue | Context |
|---------|----------|-------|---------|
| `form-data` (via `dbus-next`) | Critical | Unsafe random boundary generation | Runtime on Linux |
| `rollup` 4.0.0-4.58.0 | High | Arbitrary file write via path traversal | Dev dependency |
| `tar` <=7.5.7 | High | Multiple path traversal and symlink vulnerabilities | Dev + runtime (dbus-next) |
| `minimatch` | High | Multiple ReDoS vulnerabilities | Dev dependency |
| `@isaacs/brace-expansion` 5.0.0 | High | Uncontrolled resource consumption | Dev dependency |
| `xml2js` <0.5.0 | Moderate | Prototype pollution | Runtime via dbus-next |
| `tough-cookie` <4.1.3 | Moderate | Prototype pollution | Transitive |

**Note**: Most HIGH/CRITICAL findings are in devDependencies (electron-builder, rollup). The `dbus-next` chain is runtime on Linux.

**Recommendation**: Run `npm audit fix`. Evaluate replacing `dbus-next` with a maintained alternative.

### 10. HTTP Fallback in Runtime Download Utility

**File**: `src/helpers/downloadUtils.js:68`
**Severity**: MEDIUM
**CWE**: CWE-319 (Cleartext Transmission of Sensitive Information)

```javascript
const client = url.startsWith("https") ? https : http;
```

The runtime download utility falls back to plain HTTP, creating MITM risk for model/binary downloads.

**Recommendation**: Enforce HTTPS-only: reject URLs not starting with `https://`.

### 11. No URL Validation in `openExternalUrl`

**File**: `src/helpers/windowManager.js:426-435`
**Severity**: MEDIUM

Same issue as Finding #2 but via the `windowManager.openExternalUrl` path. Called from `did-create-window` handler (line 472-477) which passes any non-devtools URL through.

**Recommendation**: Add URL scheme allowlist validation before `shell.openExternal`.

### 12. `execSync` with String Interpolation in Download Scripts

**File**: `scripts/lib/download-utils.js:242-248`
**Severity**: MEDIUM
**CWE**: CWE-78 (OS Command Injection)

```javascript
execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: "inherit" });
execSync(`tar -xzf "${tarPath}" -C "${destDir}"`, { stdio: "inherit" });
```

While current values come from hardcoded lookup tables (not user input), using `execSync` with string interpolation is fragile and could become exploitable if sources change.

**Recommendation**: Use `execFileSync('unzip', ['-o', zipPath, '-d', destDir])` to avoid shell involvement.

### 13. Unvalidated Activation Mode/Hotkey Persisted to Disk

**File**: `main.js:157-165`, `preload.js:286-287`
**Severity**: MEDIUM

```javascript
ipcMain.on("activation-mode-changed", (_event, mode) => {
  windowManager.setActivationModeCache(mode);
  environmentManager.saveActivationMode(mode);
});
```

Fire-and-forget `ipcMain.on` handlers accept mode/hotkey values without validation and persist to `.env`. While `setActivationModeCache` clamps mode, `saveActivationMode` in the environment manager is called without validation.

**Recommendation**: Validate inputs: `if (!["tap","push"].includes(mode)) return;`

### 14. Unsanitized `language` Parameter Flows to Subprocess Args

**File**: `src/helpers/whisperServer.js:251`, `src/helpers/ipcHandlers.js:515`
**Severity**: MEDIUM
**CWE**: CWE-88 (Improper Neutralization of Argument Delimiters)

```javascript
args.push("--language", options.language || "auto");
```

The `language` value from IPC is passed to whisper-server spawn args without validation against known language codes. While `spawn` with arrays prevents shell injection, a crafted value could cause argument injection or unexpected whisper-server behavior.

**Recommendation**: Validate against the `WHISPER_LANGUAGES` allowlist at the IPC boundary.

### 15. `initialPrompt` Unvalidated in Multipart HTTP Body

**File**: `src/helpers/whisperServer.js:445-453`
**Severity**: MEDIUM

The custom dictionary content (`initialPrompt`) is embedded directly in a multipart HTTP body without validation. A value containing MIME boundary sequences could corrupt the multipart structure.

**Recommendation**: Validate that `initialPrompt` does not contain MIME boundary sequences.

### 16. AppleScript Dialog with Interpolated String

**File**: `src/helpers/clipboard.js:1338-1341`
**Severity**: MEDIUM

```javascript
const permissionDialog = spawn("osascript", [
  "-e",
  `display dialog "${dialogMessage}" buttons {"Cancel", "Open System Settings"} ...`,
]);
```

While `dialogMessage` is currently hardcoded, the pattern of interpolating into AppleScript without escaping is fragile. If future callers pass dynamic content, AppleScript metacharacters could enable injection.

**Recommendation**: Escape content for AppleScript or use fixed hardcoded strings only.

---

## LOW Findings

### 14. Broad IPC Surface Area

**Severity**: LOW

The preload script exposes ~80+ IPC methods. While all use `ipcRenderer.invoke` (safe), the large surface area increases the attack surface.

**Recommendation**: Add input validation in the preload script layer before forwarding to main process.

### 15. Error Messages May Leak System Paths

**Severity**: LOW

Several error handlers return `error.message` directly to the renderer, which may contain filesystem paths or binary locations.

**Recommendation**: Return generic error messages to the UI; log details server-side only.

### 16. No Checksum Verification for Downloaded Binaries

**File**: `scripts/download-whisper-cpp.js`, `scripts/download-sherpa-onnx.js`, etc.
**Severity**: LOW
**CWE**: CWE-494 (Download of Code Without Integrity Check)

Downloaded binaries are not verified against SHA-256 checksums. If GitHub CDN were compromised, malicious binaries could be installed silently.

**Recommendation**: Add SHA-256 checksum verification against values committed to the repository.

### 17. Symlink Deletion Without Path Confinement

**File**: `src/helpers/whisper.js:520-544`
**Severity**: LOW

`deleteAllWhisperModels()` deletes all `.bin` files in the models directory. If a symlink were placed inside `modelsDir` pointing to an external file, it could be deleted.

**Recommendation**: Resolve paths with `path.resolve()` and verify they remain within `modelsDir` before unlinking.

### 19. Unsanitized `model` ID Passed via WebSocket to Python Sidecar

**File**: `src/helpers/fasterWhisperManager.js:143-186`
**Severity**: LOW

The `model` parameter from IPC is stored and passed to the Python process via WebSocket JSON without validation. A crafted value like `../../evil` could influence behavior if the Python sidecar constructs file paths from it.

### 20. `app-log` IPC Handler Accepts Arbitrary Data

**File**: `src/helpers/ipcHandlers.js:996-999`
**Severity**: LOW

```javascript
ipcMain.handle("app-log", async (event, entry) => {
  debugLogger.logEntry(entry);
  return { success: true };
});
```

The renderer can write arbitrary data to application log files (log forgery).

**Recommendation**: Validate the structure and sanitize string values before logging.

---

## Positive Security Practices Observed

- **No hardcoded secrets**: All API keys use environment variables, excluded from git via `.gitignore`
- **No `eval()`, `new Function()`, or `innerHTML`** usage in source code
- **No deprecated `remote` module** usage
- **Context isolation enabled**: Both windows use `contextIsolation: true`
- **Node integration disabled**: Both windows use `nodeIntegration: false`
- **Main window is sandboxed**: Dictation window has `sandbox: true`
- **Parameterized SQL queries**: All `better-sqlite3` operations use `?` placeholders consistently
- **Safe process spawning**: All `child_process` usage employs `spawn()` / `execFile()` with array arguments — no shell injection
- **Clipboard operations safe**: `osascript` and `powershell` commands use hardcoded strings, not user input
- **Proper listener cleanup**: Preload returns cleanup functions for all IPC listeners
- **Navigation handlers**: Control panel blocks external navigation
- **Window open handler**: Returns `{ action: "deny" }` for external URLs
- **Model name allowlist**: Whisper model names validated against registry before path operations
- **Database field allowlist**: `updateNote()` validates field names against `allowedFields` array

---

## Remediation Roadmap

### P0 — Fix Immediately (before next release)

| # | Finding | Fix Effort |
|---|---------|-----------|
| 1 | `webSecurity: false` — register custom protocol or proxy via IPC | 2-4 hours |
| 2 | `open-external` URL validation — add protocol allowlist | 10 minutes |
| 3 | XSS via release notes — add DOMPurify sanitization | 15 minutes |
| 10 | JS injection via hotkey `executeJavaScript` — use `JSON.stringify` | 5 minutes |

### P1 — Fix Within 1-2 Weeks

| # | Finding | Fix Effort |
|---|---------|-----------|
| 4 | `sandbox: false` — enable and test preload compatibility | 1 hour |
| 5 | `transcribe-audio-file` path validation | 30 minutes |
| 6 | Main window navigation guard | 15 minutes |
| 7 | API keys to OS keychain (`safeStorage`) | 2-4 hours |
| 8 | `commandExists()` — replace `sh -c` with `which` spawn | 10 minutes |
| 9 | PowerShell path injection — use `-EncodedCommand` or safe args | 30 minutes |

### P2 — Fix Within 1 Month

| # | Finding | Fix Effort |
|---|---------|-----------|
| 11 | Add Content Security Policy | 1 hour |
| 12 | `npm audit fix` + evaluate dbus-next | 30 minutes |
| 13 | Enforce HTTPS-only downloads | 15 minutes |
| 14 | `openExternalUrl` URL validation | 10 minutes |
| 15 | `execSync` → `execFileSync` in scripts | 20 minutes |
| 16 | Validate activation mode/hotkey inputs | 10 minutes |
| 17 | Validate `language` param against allowlist | 15 minutes |
| 18 | Sanitize `initialPrompt` for multipart boundaries | 15 minutes |
| 19 | Escape AppleScript interpolated strings | 10 minutes |

### P3 — Fix When Convenient

| # | Finding | Fix Effort |
|---|---------|-----------|
| 20-26 | LOW severity findings (IPC surface, error messages, checksums, symlinks, model ID validation, log forgery) | 2-3 hours total |
