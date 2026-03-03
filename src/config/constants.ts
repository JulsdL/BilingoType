// Cache Configuration
export const CACHE_CONFIG = {
  MODEL_CACHE_SIZE: 3, // Maximum models to keep in memory
  AVAILABILITY_CHECK_TTL: 30000, // 30s for accessibility, FFmpeg, tool availability checks
  PASTE_DELAY_MS: 50, // Delay before paste simulation to allow clipboard to settle
  API_KEY_TTL: 300000, // 5 minutes for API key validation cache
} as const;

// Retry Configuration
export const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  INITIAL_DELAY: 1000, // 1 second
  MAX_DELAY: 10000, // 10 seconds
  BACKOFF_MULTIPLIER: 2,
} as const;
