"""Production entry point — starts FastAPI server."""
import os
import uvicorn

def main():
    db_path = os.environ.get("RXRESERVE_DB", "/data/rxreserve.db")
    os.environ.setdefault("OLLAMA_URL", "https://prism-ollama.fly.dev")
    os.environ.setdefault("OLLAMA_MODEL", "phi3:mini")

    from rxreserve.server import create_app
    app = create_app(db_path=db_path)

    uvicorn.run(app, host="0.0.0.0", port=8000)

if __name__ == "__main__":
    main()
