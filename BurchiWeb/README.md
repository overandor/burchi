# BurchiWeb — Semantic Browser for LLMs

A web application that converts the [Burchi](https://github.com/overandor/burchi) Swift CLI tool into a Python/Flask web app. Find web elements by meaning using TF-IDF + cosine similarity — zero LLM calls, zero CSS selectors, self-healing.

## Run Locally

```bash
pip install -r requirements.txt
python -m playwright install chromium
python3 run.py
# Open http://127.0.0.1:8700
```

## Deploy

### Railway
```bash
railway init
railway up
```

### Render
Create a new Web Service from this repo. Render will auto-detect the Dockerfile.

### Fly.io
```bash
fly launch
fly deploy
```

### Docker
```bash
docker build -t burchiweb .
docker run -p 8700:8700 burchiweb
```

### Heroku
```bash
heroku create burchiweb
heroku buildpacks:set heroku/python
heroku addons:create heroku-buildpack-playwright  # or use Docker
git push heroku main
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/digest?url=` | GET | Semantic page digest |
| `/api/markdown?url=` | GET | Page to markdown |
| `/api/find?url=&intent=` | GET | Semantic element find |
| `/api/smart?url=` | GET | Smart structured extraction |
| `/api/ask?url=&intent=` | GET | Structured query |
| `/api/script` | POST | JSON action pipeline |
| `/api/site?url=&depth=&max=` | GET | Recursive site crawl |
| `/api/sitemap?url=` | GET | Sitemap.xml parsing |
| `/api/crawl?urls=` | GET | Batch crawl |
| `/api/snapshot?url=&intent=` | GET | Element snapshot |
| `/api/links?url=` | GET | Extract all links |
| `/api/metadata?url=` | GET | Extract metadata |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BURCHI_HOST` | `127.0.0.1` | Bind address (use `0.0.0.0` for deployment) |
| `BURCHI_PORT` | `8700` | Port |
| `BURCHI_THREADS` | `4` | Waitress threads |
| `BURCHI_DEBUG` | `0` | Debug mode |
| `BURCHI_CORS_ORIGINS` | `*` | CORS allowlist (comma-separated) |
