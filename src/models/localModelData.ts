/**
 * Local model metadata for faster-whisper models.
 * Used by TranscriptionModelPicker for display info.
 */

export interface WhisperModelInfo {
  name: string;
  description: string;
  size: string;
  sizeMb: number;
  vramRequiredMb: number;
  recommended: boolean;
}

export const WHISPER_MODEL_INFO: Record<string, WhisperModelInfo> = {
  tiny: {
    name: "Tiny",
    description: "Fastest, lowest accuracy. Good for quick tests.",
    size: "75 MB",
    sizeMb: 75,
    vramRequiredMb: 1000,
    recommended: false,
  },
  base: {
    name: "Base",
    description: "Fast with decent accuracy. Good starting point.",
    size: "142 MB",
    sizeMb: 142,
    vramRequiredMb: 1000,
    recommended: false,
  },
  small: {
    name: "Small",
    description: "Good balance of speed and accuracy.",
    size: "466 MB",
    sizeMb: 466,
    vramRequiredMb: 2000,
    recommended: true,
  },
  medium: {
    name: "Medium",
    description: "High accuracy, moderate speed.",
    size: "1.5 GB",
    sizeMb: 1536,
    vramRequiredMb: 4000,
    recommended: false,
  },
  "large-v3-turbo": {
    name: "Large v3 Turbo",
    description: "GPU-optimized. Fast with excellent accuracy.",
    size: "1.6 GB",
    sizeMb: 1638,
    vramRequiredMb: 4000,
    recommended: false,
  },
  "large-v3": {
    name: "Large v3",
    description: "Highest accuracy. Requires more memory and time.",
    size: "3.0 GB",
    sizeMb: 3072,
    vramRequiredMb: 6000,
    recommended: false,
  },
};
