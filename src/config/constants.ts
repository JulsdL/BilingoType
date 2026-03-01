// API Configuration helpers
export const normalizeBaseUrl = (value?: string | null): string => {
  if (!value) return "";

  let normalized = value.trim();
  if (!normalized) return "";

  // Remove common API endpoint suffixes to get the base URL
  const suffixReplacements: Array<[RegExp, string]> = [
    [/\/v1\/chat\/completions$/i, "/v1"],
    [/\/chat\/completions$/i, ""],
    [/\/v1\/responses$/i, "/v1"],
    [/\/responses$/i, ""],
    [/\/v1\/models$/i, "/v1"],
    [/\/models$/i, ""],
    [/\/v1\/audio\/transcriptions$/i, "/v1"],
    [/\/audio\/transcriptions$/i, ""],
    [/\/v1\/audio\/translations$/i, "/v1"],
    [/\/audio\/translations$/i, ""],
  ];

  for (const [pattern, replacement] of suffixReplacements) {
    if (pattern.test(normalized)) {
      normalized = normalized.replace(pattern, replacement).replace(/\/+$/, "");
    }
  }

  return normalized.replace(/\/+$/, "");
};

export const buildApiUrl = (base: string, path: string): string => {
  const normalizedBase = normalizeBaseUrl(base) || "https://api.openai.com/v1";
  if (!path) {
    return normalizedBase;
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
};

const env = (typeof import.meta !== "undefined" && (import.meta as any).env) || {};

const computeBaseUrl = (candidates: Array<string | undefined>, fallback: string): string => {
  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return fallback;
};

const DEFAULT_OPENAI_BASE = computeBaseUrl(
  [env.BILINGOTYPE_OPENAI_BASE_URL as string | undefined, env.OPENAI_BASE_URL as string | undefined],
  "https://api.openai.com/v1"
);

const DEFAULT_TRANSCRIPTION_BASE = computeBaseUrl(
  [
    env.BILINGOTYPE_TRANSCRIPTION_BASE_URL as string | undefined,
    env.WHISPER_BASE_URL as string | undefined,
  ],
  DEFAULT_OPENAI_BASE
);

export const API_ENDPOINTS = {
  OPENAI_BASE: DEFAULT_OPENAI_BASE,
  OPENAI: buildApiUrl(DEFAULT_OPENAI_BASE, "/responses"),
  OPENAI_MODELS: buildApiUrl(DEFAULT_OPENAI_BASE, "/models"),
  TRANSCRIPTION_BASE: DEFAULT_TRANSCRIPTION_BASE,
  TRANSCRIPTION: buildApiUrl(DEFAULT_TRANSCRIPTION_BASE, "/audio/transcriptions"),
} as const;

// Cache Configuration
export const CACHE_CONFIG = {
  MODEL_CACHE_SIZE: 3, // Maximum models to keep in memory
  AVAILABILITY_CHECK_TTL: 30000, // 30s for accessibility, FFmpeg, tool availability checks
  PASTE_DELAY_MS: 50, // Delay before paste simulation to allow clipboard to settle
} as const;

// Retry Configuration
export const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  INITIAL_DELAY: 1000, // 1 second
  MAX_DELAY: 10000, // 10 seconds
  BACKOFF_MULTIPLIER: 2,
} as const;
