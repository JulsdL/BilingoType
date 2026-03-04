"""Transcription engine wrapping faster-whisper."""

from __future__ import annotations

import logging
import os
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

# Accumulate at least this many bytes before transcribing (~1.5s at 16kHz int16 mono)
_MIN_CHUNK_BYTES = 48_000
# Skip finalize if buffer has less than this (~50ms)
_MIN_FINAL_BYTES = 1_600

_DEFAULT_CACHE_DIR = Path.home() / ".cache" / "bilingotype" / "faster-whisper-models"


def _resolve_device(device: str) -> tuple[str, str]:
    """Resolve device string to (device, compute_type) for faster-whisper.

    Args:
        device: One of "auto", "cuda", "cpu".

    Returns:
        Tuple of (device_name, compute_type).
    """
    if device == "cpu":
        return "cpu", "int8"

    if device == "cuda":
        return "cuda", "int8_float16"

    # Auto-detect
    try:
        import ctranslate2

        if "cuda" in ctranslate2.get_supported_compute_types("cuda"):
            logger.info("CUDA detected — using int8_float16 compute type")
            return "cuda", "int8_float16"
    except Exception:
        pass

    logger.info("No CUDA — falling back to CPU with int8 compute type")
    return "cpu", "int8"


class WhisperEngine:
    """Manages a faster-whisper model and transcribes audio chunks."""

    def __init__(
        self,
        model_name: str,
        device: str = "auto",
        language: str | None = None,
        initial_prompt: str | None = None,
        custom_model_path: str | None = None,
    ) -> None:
        from faster_whisper import WhisperModel

        cache_dir = os.environ.get(
            "BILINGOTYPE_MODEL_CACHE", str(_DEFAULT_CACHE_DIR)
        )
        os.makedirs(cache_dir, exist_ok=True)

        resolved_device, compute_type = _resolve_device(device)
        self.device = resolved_device
        self.language = language
        self.initial_prompt = initial_prompt
        self._audio_buffer = bytearray()

        # Use custom CTranslate2 model directory if provided, otherwise standard model name
        model_source = custom_model_path if custom_model_path else model_name

        logger.info(
            "Loading model %s on %s (%s), cache=%s",
            model_source,
            resolved_device,
            compute_type,
            cache_dir,
        )

        try:
            self._model = WhisperModel(
                model_source,
                device=resolved_device,
                compute_type=compute_type,
                download_root=cache_dir,
            )
        except Exception as exc:
            if resolved_device == "cuda":
                logger.warning(
                    "CUDA model load failed (%s), retrying on CPU", exc
                )
                self.device = "cpu"
                self._model = WhisperModel(
                    model_source,
                    device="cpu",
                    compute_type="int8",
                    download_root=cache_dir,
                )
            else:
                raise

        logger.info("Model %s ready on %s", model_source, self.device)

    def transcribe_chunk(self, pcm_bytes: bytes) -> dict | None:
        """Accumulate audio and transcribe when enough data is buffered.

        Args:
            pcm_bytes: Raw PCM int16 16kHz mono bytes.

        Returns:
            A partial result dict or None if not enough audio yet.
        """
        self._audio_buffer.extend(pcm_bytes)

        if len(self._audio_buffer) < _MIN_CHUNK_BYTES:
            return None

        return self._transcribe_buffer("partial")

    def finalize(self) -> dict | None:
        """Transcribe any remaining audio in the buffer.

        Returns:
            A final result dict or None if buffer is too short.
        """
        if len(self._audio_buffer) < _MIN_FINAL_BYTES:
            self._audio_buffer.clear()
            return None

        result = self._transcribe_buffer("final")
        self._audio_buffer.clear()
        return result

    def _transcribe_buffer(self, result_type: str) -> dict | None:
        """Run faster-whisper on the current audio buffer.

        Args:
            result_type: Either "partial" or "final".

        Returns:
            Result dict with type, text, and language, or None.
        """
        audio = (
            np.frombuffer(self._audio_buffer, dtype=np.int16).astype(np.float32)
            / 32768.0
        )

        segments, info = self._model.transcribe(
            audio,
            language=self.language,
            initial_prompt=self.initial_prompt,
            vad_filter=False,  # We handle VAD externally
        )

        text = " ".join(seg.text for seg in segments).strip()

        if not text:
            return None

        return {
            "type": result_type,
            "text": text,
            "language": info.language,
        }
