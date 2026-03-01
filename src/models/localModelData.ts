/**
 * Local model metadata for Whisper and Parakeet (NVIDIA NeMo) models.
 * Used by LocalWhisperPicker and TranscriptionModelPicker for display info.
 */

export interface WhisperModelInfo {
  name: string;
  description: string;
  size: string;
  sizeMb: number;
  recommended: boolean;
}

export interface ParakeetModelInfo {
  name: string;
  description: string;
  size: string;
  sizeMb: number;
  language: "en" | "multilingual";
  recommended: boolean;
}

export const WHISPER_MODEL_INFO: Record<string, WhisperModelInfo> = {
  tiny: {
    name: "Tiny",
    description: "Fastest, lowest accuracy. Good for quick tests.",
    size: "75 MB",
    sizeMb: 75,
    recommended: false,
  },
  base: {
    name: "Base",
    description: "Fast with decent accuracy. Good starting point.",
    size: "142 MB",
    sizeMb: 142,
    recommended: false,
  },
  small: {
    name: "Small",
    description: "Good balance of speed and accuracy.",
    size: "466 MB",
    sizeMb: 466,
    recommended: true,
  },
  medium: {
    name: "Medium",
    description: "High accuracy, moderate speed.",
    size: "1.5 GB",
    sizeMb: 1536,
    recommended: false,
  },
  "large-v3": {
    name: "Large v3",
    description: "Highest accuracy. Requires more memory and time.",
    size: "3.0 GB",
    sizeMb: 3072,
    recommended: false,
  },
};

export const PARAKEET_MODEL_INFO: Record<string, ParakeetModelInfo> = {
  "parakeet-ctc-0.6b": {
    name: "Parakeet CTC 0.6B",
    description: "Fast English-only model. Good for real-time use.",
    size: "600 MB",
    sizeMb: 600,
    language: "en",
    recommended: false,
  },
  "parakeet-tdt-1.1b": {
    name: "Parakeet TDT 1.1B",
    description: "High accuracy English model with better punctuation.",
    size: "1.1 GB",
    sizeMb: 1126,
    language: "en",
    recommended: true,
  },
};
