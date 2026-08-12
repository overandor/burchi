.PHONY: dev test lint

dev:
	uvicorn ytl_lab.main:app --reload --port 8787

test:
	pytest

lint:
	ruff check .
