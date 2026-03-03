"""HuggingFace Inference client for BilingoType STT sidecar.

Supports two modes:
  - Inference Endpoints: User's own dedicated server (custom URL)
  - Inference API: Shared infrastructure (model ID -> HF API URL)
"""

from __future__ import annotations

import io
import logging
import struct
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_HF_API_BASE = "https://api-inference.huggingface.co/models"


def _pcm_to_wav(pcm_bytes: bytes, sample_rate: int = 16000) -> bytes:
    """Convert raw PCM int16 mono bytes to a WAV file in memory."""
    num_samples = len(pcm_bytes) // 2
    data_size = num_samples * 2

    buf = io.BytesIO()
    # RIFF header
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")
    # fmt chunk
    buf.write(b"fmt ")
    buf.write(struct.pack("<I", 16))       # chunk size
    buf.write(struct.pack("<H", 1))        # PCM format
    buf.write(struct.pack("<H", 1))        # mono
    buf.write(struct.pack("<I", sample_rate))
    buf.write(struct.pack("<I", sample_rate * 2))  # byte rate
    buf.write(struct.pack("<H", 2))        # block align
    buf.write(struct.pack("<H", 16))       # bits per sample
    # data chunk
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(pcm_bytes)

    return buf.getvalue()


class HuggingFaceClient:
    """Sends audio to a HuggingFace endpoint and returns transcription."""

    def __init__(
        self,
        api_token: str,
        endpoint_url: str | None = None,
        model_id: str | None = None,
        timeout: float = 120.0,
    ) -> None:
        if not endpoint_url and not model_id:
            raise ValueError("Either endpoint_url or model_id must be provided")

        self.url = endpoint_url or f"{_HF_API_BASE}/{model_id}"
        self._client = httpx.AsyncClient(
            headers={
                "Authorization": f"Bearer {api_token}",
            },
            timeout=timeout,
        )

        logger.info("HuggingFace client configured: %s", self.url)

    async def transcribe(self, pcm_bytes: bytes) -> dict[str, Any]:
        """Send PCM audio to HuggingFace and return transcription result.

        Args:
            pcm_bytes: Raw PCM int16 16kHz mono audio bytes.

        Returns:
            Dict with "text" and optional "language" keys matching the
            sidecar protocol.
        """
        wav_bytes = _pcm_to_wav(pcm_bytes)

        logger.debug(
            "Sending %d bytes (%.1fs) to HuggingFace",
            len(wav_bytes),
            len(pcm_bytes) / 2 / 16000,
        )

        response = await self._client.post(
            self.url,
            content=wav_bytes,
            headers={"Content-Type": "audio/wav"},
        )
        response.raise_for_status()

        data = response.json()

        # HF ASR responses: {"text": "..."} or [{"text": "..."}]
        if isinstance(data, list) and len(data) > 0:
            text = data[0].get("text", "")
        elif isinstance(data, dict):
            text = data.get("text", "")
        else:
            text = ""

        return {
            "type": "final",
            "text": text.strip(),
            "language": None,
        }

    async def close(self) -> None:
        """Close the HTTP client."""
        await self._client.aclose()
