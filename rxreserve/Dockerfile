FROM ollama/ollama:latest

# Install Python and system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create venv
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the app
COPY . .
RUN pip install --no-cache-dir -e .

# Create data directories
RUN mkdir -p /data /data/kpi_checkpoints /data/ollama

# Symlink Ollama model storage to persistent volume
RUN rm -rf /root/.ollama && ln -s /data/ollama /root/.ollama

# Copy startup script
COPY start.sh /start.sh
RUN chmod +x /start.sh

EXPOSE 8000

# Environment
ENV RXRESERVE_DB=/data/rxreserve.db
ENV OLLAMA_URL=http://127.0.0.1:11434
ENV OLLAMA_MODEL=phi3:mini
ENV KPI_CHECKPOINT_DIR=/data/kpi_checkpoints
ENV OLLAMA_HOST=127.0.0.1:11434

CMD ["/start.sh"]
