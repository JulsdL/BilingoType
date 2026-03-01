import type { GpuInfo } from "../types/electron";
import { WHISPER_MODEL_INFO } from "../models/localModelData";

export interface ModelRecommendation {
  modelId: string;
  device: "cuda" | "cpu";
  reason: string;
}

/**
 * Returns a recommended faster-whisper model + device based on GPU info.
 * GPU recommendations start at large-v3-turbo; users can pick any model freely.
 */
export function getRecommendedModel(profile: GpuInfo): ModelRecommendation {
  if (!profile.hasNvidiaGpu || !profile.vramMb) {
    return {
      modelId: "large-v3-turbo",
      device: "cpu",
      reason: "Best CPU option — fast with excellent accuracy",
    };
  }

  const vram = profile.vramMb;

  if (vram >= 6000) {
    return {
      modelId: "large-v3",
      device: "cuda",
      reason: "Best accuracy — enough VRAM for the full model",
    };
  }

  if (vram >= 4000) {
    return {
      modelId: "large-v3-turbo",
      device: "cuda",
      reason: "GPU sweet spot — fast with excellent accuracy",
    };
  }

  if (vram >= 2000) {
    return {
      modelId: "small",
      device: "cuda",
      reason: "Decent quality with limited VRAM",
    };
  }

  return {
    modelId: "base",
    device: "cuda",
    reason: "Lightweight GPU inference",
  };
}

/** Returns all available Whisper model IDs — no filtering, user chooses freely. */
export function getAllModels(): string[] {
  return Object.keys(WHISPER_MODEL_INFO);
}
