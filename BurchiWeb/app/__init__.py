"""BurchiWeb — Flask application factory."""

import os

from flask import Flask
from flask_cors import CORS


def create_app() -> Flask:
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config["JSON_SORT_KEYS"] = False

    cors_origins = [
        o.strip() for o in os.environ.get("BURCHI_CORS_ORIGINS", "").split(",")
        if o.strip()
    ]
    CORS(app, origins=cors_origins if cors_origins else "*")

    from .routes import bp as routes_bp
    app.register_blueprint(routes_bp)

    return app
