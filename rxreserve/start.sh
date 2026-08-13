#!/bin/bash
set -e

echo "=== Starting RxReserve (Ollama + API) ==="

# 1. Start Ollama in background
ollama serve &
OLLAMA_PID=$!

# 2. Wait for Ollama to be ready
echo "Waiting for Ollama..."
for i in $(seq 1 30); do
    if curl -s http://127.0.0.1:11434/api/tags > /dev/null 2>&1; then
        echo "Ollama is ready."
        break
    fi
    sleep 1
done

# 3. Pull the model if not already present
MODEL="${OLLAMA_MODEL:-phi3:mini}"
if ! ollama list 2>/dev/null | grep -q "$MODEL"; then
    echo "Pulling model: $MODEL"
    ollama pull "$MODEL"
    echo "Model $MODEL pulled."
else
    echo "Model $MODEL already available."
fi

# 4. Start the FastAPI server
echo "Starting RxReserve API on port 8000..."
exec rxreserve serve --host 0.0.0.0 --port 8000
