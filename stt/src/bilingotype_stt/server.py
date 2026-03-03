"""WebSocket server for the BilingoType STT sidecar."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import signal
import sys
from typing import Any

import websockets
from websockets.asyncio.server import ServerConnection

from .engine import WhisperEngine
from .punctuation import process_commands
from .vad import VadEngine

logger = logging.getLogger(__name__)


async def _handle_connection(websocket: ServerConnection) -> None:
    """Handle a single WebSocket client connection."""
    engine: WhisperEngine | None = None
    vad: VadEngine | None = None
    cuda_fallback_occurred = False

    # HuggingFace backend state
    hf_client: Any = None  # HuggingFaceClient | None
    hf_audio_buffer: bytearray | None = None
    backend: str = "local"

    logger.info("Client connected")

    try:
        async for raw_message in websocket:
            try:
                msg: dict[str, Any] = json.loads(raw_message)
            except json.JSONDecodeError:
                await _send(websocket, {
                    "type": "error",
                    "message": "Invalid JSON",
                    "recoverable": True,
                })
                continue

            msg_type = msg.get("type")

            if msg_type == "start":
                backend = msg.get("backend", "local")

                if backend == "huggingface":
                    hf_client, hf_audio_buffer = await _handle_start_hf(
                        websocket, msg
                    )
                    # Clear local engine if switching backends
                    engine = None
                    vad = None
                else:
                    engine, vad, cuda_fallback_occurred = await _handle_start(
                        websocket, msg
                    )
                    # Clear HF state if switching backends
                    if hf_client is not None:
                        await hf_client.close()
                        hf_client = None
                    hf_audio_buffer = None

            elif msg_type == "audio":
                if backend == "huggingface":
                    if hf_audio_buffer is None:
                        await _send(websocket, {
                            "type": "error",
                            "message": "No active HF session — send 'start' first",
                            "recoverable": True,
                        })
                        continue
                    # Accumulate audio for batch send on stop
                    data = msg.get("data")
                    if data:
                        try:
                            hf_audio_buffer.extend(base64.b64decode(data))
                        except Exception:
                            await _send(websocket, {
                                "type": "error",
                                "message": "Invalid base64 audio data",
                                "recoverable": True,
                            })
                else:
                    if engine is None:
                        await _send(websocket, {
                            "type": "error",
                            "message": "No active session — send 'start' first",
                            "recoverable": True,
                        })
                        continue
                    await _handle_audio(websocket, engine, vad, msg)

            elif msg_type == "stop":
                if backend == "huggingface":
                    await _handle_stop_hf(websocket, hf_client, hf_audio_buffer)
                    hf_audio_buffer = None
                else:
                    if engine is not None:
                        result = engine.finalize()
                        if result is not None:
                            # Apply punctuation commands to final text only
                            result = {**result, "text": process_commands(result["text"])}
                            await _send(websocket, result)
                        engine = None
                        if vad is not None:
                            vad.reset()

            elif msg_type == "ping":
                await _send(websocket, {"type": "pong"})

            else:
                await _send(websocket, {
                    "type": "error",
                    "message": f"Unknown message type: {msg_type}",
                    "recoverable": True,
                })

    except websockets.exceptions.ConnectionClosed:
        logger.info("Client disconnected")
    finally:
        if hf_client is not None:
            await hf_client.close()


async def _handle_start(
    websocket: ServerConnection,
    msg: dict[str, Any],
) -> tuple[WhisperEngine | None, VadEngine | None, bool]:
    """Load model and VAD, send ready or error."""
    model = msg.get("model", "base")
    device = msg.get("device", "auto")
    language = msg.get("language")
    initial_prompt = msg.get("initialPrompt")

    cuda_fallback = False

    try:
        engine = WhisperEngine(
            model_name=model,
            device=device,
            language=language,
            initial_prompt=initial_prompt,
        )
        # Check if engine fell back to CPU from CUDA
        if device in ("auto", "cuda") and engine.device == "cpu" and device != "cpu":
            cuda_fallback = True
            await _send(websocket, {
                "type": "error",
                "message": "CUDA unavailable, using CPU",
                "recoverable": True,
            })
    except Exception as exc:
        logger.error("Failed to load model: %s", exc)
        await _send(websocket, {
            "type": "error",
            "message": f"Model load failed: {exc}",
            "recoverable": False,
        })
        return None, None, False

    try:
        vad = VadEngine()
    except Exception as exc:
        logger.warning("VAD init failed, continuing without VAD: %s", exc)
        vad = None

    await _send(websocket, {"type": "ready"})
    return engine, vad, cuda_fallback


async def _handle_start_hf(
    websocket: ServerConnection,
    msg: dict[str, Any],
) -> tuple[Any, bytearray | None]:
    """Initialize a HuggingFace backend session."""
    from .hf_client import HuggingFaceClient

    api_token = msg.get("hfApiToken", "")
    endpoint_url = msg.get("hfEndpointUrl") or None
    model_id = msg.get("hfModelId") or None

    if not api_token:
        await _send(websocket, {
            "type": "error",
            "message": "HuggingFace API token is required",
            "recoverable": False,
        })
        return None, None

    if not endpoint_url and not model_id:
        await _send(websocket, {
            "type": "error",
            "message": "Either hfEndpointUrl or hfModelId must be provided",
            "recoverable": False,
        })
        return None, None

    try:
        client = HuggingFaceClient(
            api_token=api_token,
            endpoint_url=endpoint_url,
            model_id=model_id,
        )
    except Exception as exc:
        logger.error("Failed to create HF client: %s", exc)
        await _send(websocket, {
            "type": "error",
            "message": f"HF client init failed: {exc}",
            "recoverable": False,
        })
        return None, None

    await _send(websocket, {"type": "ready"})
    return client, bytearray()


async def _handle_stop_hf(
    websocket: ServerConnection,
    hf_client: Any,
    audio_buffer: bytearray | None,
) -> None:
    """Send accumulated audio to HuggingFace and return the result."""
    if hf_client is None or audio_buffer is None:
        return

    if len(audio_buffer) < 1600:
        # Too short (~50ms) — no meaningful audio
        return

    try:
        result = await hf_client.transcribe(bytes(audio_buffer))
        if result and result.get("text"):
            result = {**result, "text": process_commands(result["text"])}
            await _send(websocket, result)
    except Exception as exc:
        logger.error("HuggingFace transcription failed: %s", exc)
        await _send(websocket, {
            "type": "error",
            "message": f"HuggingFace transcription failed: {exc}",
            "recoverable": False,
        })


async def _handle_audio(
    websocket: ServerConnection,
    engine: WhisperEngine,
    vad: VadEngine | None,
    msg: dict[str, Any],
) -> None:
    """Decode audio, run VAD, and transcribe."""
    data = msg.get("data")
    if not data:
        return

    try:
        pcm_bytes = base64.b64decode(data)
    except Exception:
        await _send(websocket, {
            "type": "error",
            "message": "Invalid base64 audio data",
            "recoverable": True,
        })
        return

    # VAD check — skip silence
    if vad is not None and not vad.is_speech(pcm_bytes):
        return

    # Transcribe (may return None if not enough audio accumulated)
    result = engine.transcribe_chunk(pcm_bytes)
    if result is not None:
        await _send(websocket, result)


async def _send(websocket: ServerConnection, msg: dict[str, Any]) -> None:
    """Send a JSON message over the WebSocket."""
    try:
        await websocket.send(json.dumps(msg))
    except websockets.exceptions.ConnectionClosed:
        pass


def run_server(host: str = "127.0.0.1", port: int = 0, log_level: str = "info") -> None:
    """Start the WebSocket server.

    Args:
        host: Interface to bind to.
        port: Port to listen on (0 = OS picks a free port).
        log_level: Logging level string.
    """
    logging.basicConfig(
        level=getattr(logging, log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )

    asyncio.run(_async_run_server(host, port))


async def _async_run_server(host: str, port: int) -> None:
    """Async entry point for the WebSocket server."""
    stop_event = asyncio.Event()

    loop = asyncio.get_running_loop()

    # Register signal handlers for graceful shutdown
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:
            # Windows doesn't support add_signal_handler
            pass

    async with websockets.serve(
        _handle_connection,
        host,
        port,
        max_size=50 * 1024 * 1024,  # 50MB max message size
    ) as server:
        # Get the actual port (important when port=0)
        actual_port = server.sockets[0].getsockname()[1]

        # Signal to Electron that we're ready — this line is parsed by FasterWhisperManager
        print(f"BILINGOTYPE_STT_READY:{actual_port}", flush=True)
        logger.info("STT server listening on %s:%d", host, actual_port)

        await stop_event.wait()

    logger.info("STT server stopped")
