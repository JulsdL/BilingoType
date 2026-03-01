"""CLI entry point: python -m bilingotype_stt --port <port>"""

import argparse
import sys

from .server import run_server


def main() -> None:
    parser = argparse.ArgumentParser(description="BilingoType STT sidecar")
    parser.add_argument("--port", type=int, default=0, help="Port to listen on (0 = auto)")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument(
        "--log-level",
        default="info",
        choices=["debug", "info", "warning", "error"],
        help="Logging level",
    )
    args = parser.parse_args()

    try:
        run_server(host=args.host, port=args.port, log_level=args.log_level)
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
