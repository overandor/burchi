FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml ./
RUN pip install --no-cache-dir -e '.[dev]'

COPY src/ ./src/
COPY tests/ ./tests/

ENV YTL_DATA_DIR=/data
ENV YTL_DB_PATH=/data/ytl_lab.db
ENV YTL_RECEIPT_LEDGER_PATH=/data/receipts/ledger.jsonl
ENV YTL_LOG_LEVEL=INFO

RUN mkdir -p /data/receipts

EXPOSE 8787

CMD ["uvicorn", "ytl_lab.main:app", "--host", "0.0.0.0", "--port", "8787"]
