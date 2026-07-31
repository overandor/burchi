"""Vercel serverless entry point."""
from app.main import app
handler = app
