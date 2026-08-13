#!/usr/bin/env python3
"""BurchiWeb — Semantic Browser for LLMs (Web App)

Production:  python3 run.py            (waitress, 4 threads)
Debug:       BURCHI_DEBUG=1 python3 run.py   (Flask reloader)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app

if __name__ == "__main__":
    app = create_app()
    host = os.environ.get("BURCHI_HOST", "127.0.0.1")
    port = int(os.environ.get("BURCHI_PORT", "8700"))
    debug = os.environ.get("BURCHI_DEBUG", "0") == "1" and host in ("127.0.0.1", "localhost")

    if debug:
        app.run(host=host, port=port, debug=debug)
    else:
        from waitress import serve
        threads = int(os.environ.get("BURCHI_THREADS", "4"))
        print(f"BurchiWeb production server on http://{host}:{port} ({threads} threads)")
        serve(app, host=host, port=port, threads=threads, connection_limit=100, channel_timeout=120)
