FROM python:3.13-slim

WORKDIR /app

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the app
COPY . .

# Install the package
RUN pip install --no-cache-dir -e .

# Create data directory
RUN mkdir -p /data

# Expose port
EXPOSE 8000

CMD ["rxreserve", "serve", "--host", "0.0.0.0", "--port", "8000"]
ENV RXRESERVE_DB=/data/rxreserve.db
ENV OLLAMA_URL=https://prism-ollama.fly.dev
ENV OLLAMA_MODEL=phi3:mini
