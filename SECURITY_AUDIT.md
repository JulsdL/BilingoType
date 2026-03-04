# BilingoType Security Audit Report

**Date**: 2026-03-04
**Scope**: Full application security scan
**Auditor**: Automated security analysis

---

## Executive Summary

The BilingoType application demonstrates generally solid security practices with proper credential management, parameterized database queries, and good Electron security defaults. However, several issues were identified that range from **CRITICAL** to **LOW** severity.

| Severity | Count |
|----------|-------|
| CRITICAL | 1     |
| HIGH     | 3     |
| MEDIUM   | 3     |
| LOW      | 2     |

---

## CRITICAL Findings

### 1. `webSecurity: false` on Control Panel Window

**File**: `src/helpers/windowConfig.js:52`
**Severity**: CRITICAL

```javascript
webSecurity: false,
```

The Control Panel window disables the same-origin policy entirely. While the comment explains this is needed for `file://` to cross-origin fetch calls in production, this effectively removes CORS protection for the entire window. A compromised or injected script in this window could make arbitrary cross-origin requests, exfiltrate data, or interact with any API using the user's credentials (API keys stored in environment).

**Recommendation**: Instead of disabling `webSecurity`, use Electron's `session.webRequest` API or a custom protocol handler to proxy API calls through the main process (which already handles Anthropic calls this way). Alternatively, register a custom `app://` protocol with proper CORS headers.

---

## HIGH Findings

### 2. `sandbox: false` on Control Panel Window

**File**: `src/helpers/windowConfig.js:48`
**Severity**: HIGH

```javascript
sandbox: false,
```

The Control Panel window runs without sandbox. The main dictation window correctly uses `sandbox: true`. While the comment states this is required for the preload script's IPC bridge, modern Electron supports preload scripts in sandboxed renderers. Running without sandbox gives the preload script (and any code it exposes) broader system access.

**Recommendation**: Enable `sandbox: true` and refactor the preload script to work within sandbox constraints. Electron's `contextBridge.exposeInMainWorld` works with sandboxed renderers.

### 3. `dangerouslySetInnerHTML` with Update Release Notes

**File**: `src/components/SettingsPage.tsx:1388`
**Severity**: HIGH

```tsx
dangerouslySetInnerHTML={{ __html: updateInfo.releaseNotes }}
```

Release notes from the auto-updater are rendered as raw HTML. If the update feed is compromised (MITM, CDN compromise, or supply chain attack on the update server), an attacker could inject malicious HTML/JavaScript that executes in the Electron renderer context.

**Recommendation**: Sanitize the HTML using a library like `DOMPurify` before rendering, or parse the release notes as Markdown and render with a safe Markdown renderer.

### 4. Unvalidated URL in `open-external` IPC Handler

**File**: `src/helpers/ipcHandlers.js:831-838`
**Severity**: HIGH

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

The `open-external` IPC handler passes any URL directly to `shell.openExternal()` without validation. A compromised renderer or XSS could use this to open arbitrary URLs, including `file://` URLs, custom protocol handlers, or `javascript:` URLs depending on the platform. On some platforms, `shell.openExternal` can execute arbitrary commands via crafted URIs.

**Recommendation**: Validate the URL against an allowlist of schemes (`https://`, `http://`, `mailto:`) before calling `shell.openExternal()`. Reject `file://`, `javascript:`, and other potentially dangerous schemes.

---

## MEDIUM Findings

### 5. Dependency Vulnerabilities (npm audit)

**Severity**: MEDIUM (aggregate)

`npm audit` reports **18 vulnerabilities**: 2 critical, 12 high, 4 moderate.

Key vulnerable packages:
| Package | Severity | Issue |
|---------|----------|-------|
| `form-data` (via `request` → `dbus-next`) | Critical | Unsafe random function for boundary generation |
| `rollup` 4.0.0-4.58.0 | High | Arbitrary file write via path traversal |
| `tar` <=7.5.7 | High | Multiple path traversal and symlink vulnerabilities |
| `minimatch` | High | Multiple ReDoS vulnerabilities |
| `@isaacs/brace-expansion` 5.0.0 | High | Uncontrolled resource consumption |
| `xml2js` <0.5.0 | Moderate | Prototype pollution |
| `tough-cookie` <4.1.3 | Moderate | Prototype pollution |

**Note**: Many of these are in build/dev dependencies (`electron-builder`, `node-gyp`), not runtime code. The `dbus-next` chain (`form-data` → `request` → `node-gyp` → `usocket` → `dbus-next`) is runtime on Linux.

**Recommendation**: Run `npm audit fix` to address fixable vulnerabilities. For unfixable ones, evaluate if the vulnerable code paths are actually exercised. Consider replacing `dbus-next` with a maintained alternative if possible.

### 6. No URL Validation in `openExternalUrl`

**File**: `src/helpers/windowManager.js:426-435`
**Severity**: MEDIUM

```javascript
openExternalUrl(url, showError = true) {
  shell.openExternal(url).catch((error) => { ... });
}
```

This method is called from navigation event handlers without URL scheme validation. While the navigation handlers do some origin checking, the `did-create-window` handler at line 472-477 passes any non-devtools URL through.

**Recommendation**: Add URL scheme validation (allowlist `https://`, `http://`, `mailto:`) before calling `shell.openExternal`.

### 7. HTTP Fallback in Download Utility

**File**: `src/helpers/downloadUtils.js:68`
**Severity**: MEDIUM

```javascript
const client = url.startsWith("https") ? https : http;
```

The download utility falls back to plain HTTP if the URL doesn't start with `https`. While current usage appears to only use HTTPS URLs, this creates a risk if a redirect or misconfiguration causes an HTTP download. Model files and binaries downloaded over HTTP could be tampered with (MITM).

**Recommendation**: Either reject non-HTTPS URLs entirely or add integrity verification (checksum validation) for downloaded files.

---

## LOW Findings

### 8. Broad IPC Surface Area

**Severity**: LOW

The preload script exposes ~80+ IPC methods to the renderer. While all use `ipcRenderer.invoke` (safe) rather than `ipcRenderer.send` (less safe), the large surface area increases the risk that a vulnerability in any single handler could be exploited.

**Recommendation**: Consider grouping related IPC calls and adding input validation in the preload script before forwarding to the main process.

### 9. Error Messages May Leak System Paths

**Severity**: LOW

Several error handlers return `error.message` directly to the renderer, which may contain file system paths, binary locations, or other system-specific information.

**Recommendation**: Sanitize error messages before sending to the renderer. Return generic error messages to the UI and log detailed errors server-side only.

---

## Positive Security Practices Observed

- **No hardcoded secrets**: All API keys use environment variables, stored in user data directory `.env` files, excluded from git via `.gitignore`
- **Context isolation enabled**: Both windows use `contextIsolation: true`
- **Node integration disabled**: Both windows use `nodeIntegration: false`
- **Parameterized SQL queries**: All database operations use prepared statements with `?` placeholders (no string concatenation)
- **Safe process spawning**: All `child_process` usage employs `spawn()` with array arguments, avoiding shell injection
- **Clipboard operations are safe**: `osascript` and `powershell` commands use hardcoded strings, not user input
- **Proper listener cleanup**: The preload script returns cleanup functions for all IPC listeners
- **Main window is sandboxed**: The dictation window has `sandbox: true`
- **Navigation handlers**: Control panel prevents navigation to external URLs
- **Window open handler**: External URLs are denied and opened in system browser

---

## Recommendations Summary (Priority Order)

1. **CRITICAL**: Replace `webSecurity: false` with a proper protocol handler or main-process proxy
2. **HIGH**: Add URL scheme validation to `open-external` IPC handler and `openExternalUrl`
3. **HIGH**: Sanitize `dangerouslySetInnerHTML` content with DOMPurify
4. **HIGH**: Enable `sandbox: true` on Control Panel window
5. **MEDIUM**: Run `npm audit fix` and evaluate remaining vulnerabilities
6. **MEDIUM**: Enforce HTTPS-only downloads or add checksum verification
7. **LOW**: Add input validation in preload script layer
8. **LOW**: Sanitize error messages before sending to renderer
