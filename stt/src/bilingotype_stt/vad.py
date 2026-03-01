"""Silero VAD wrapper for voice activity detection."""

from __future__ import annotations

import logging

import numpy as np
import torch

logger = logging.getLogger(__name__)

# Silero VAD expects 512 samples at 16kHz (32ms window)
_SILERO_WINDOW_SAMPLES = 512
_SAMPLE_RATE = 16000


class VadEngine:
    """Lightweight voice activity detector using Silero VAD."""

    def __init__(self, threshold: float = 0.5) -> None:
        self._threshold = threshold
        self._model, self._utils = torch.hub.load(
            repo_or_dir="snakers4/silero-vad",
            model="silero_vad",
            trust_repo=True,
        )
        self._model.eval()
        logger.info("Silero VAD loaded (threshold=%.2f)", threshold)

    def is_speech(self, pcm_bytes: bytes) -> bool:
        """Check if a PCM int16 16kHz mono chunk contains speech.

        Args:
            pcm_bytes: Raw PCM audio bytes (int16, 16kHz, mono).

        Returns:
            True if speech is detected above the threshold.
        """
        audio = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        if len(audio) < _SILERO_WINDOW_SAMPLES:
            return False

        # Process in windows that Silero expects
        tensor = torch.from_numpy(audio)
        confidence = self._model(tensor, _SAMPLE_RATE).item()
        return confidence >= self._threshold

    def reset(self) -> None:
        """Reset VAD state between recording sessions."""
        self._model.reset_states()
