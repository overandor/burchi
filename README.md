# Burchi v4 — Semantic Browser for LLMs

**Find elements by meaning, not selectors. Zero CSS. Zero LLM calls. Self-healing. Firecrawl-killer.**

Burchi is a next-era browser automation tool that lets LLMs and GPT agents browse the web without dealing with divs, classes, IDs, or CSS selectors. It uses TF-IDF + cosine similarity to locate elements semantically — just describe what you want in natural language.

**v4 merges the nyx-semantic algorithm improvements** (stricter vocab filtering, intent-aware bonuses) and adds **recursive site crawling** with sitemap parsing, robots.txt respect, content dedup, rate limiting, search across pages, and an HTTP API server — making it a superior alternative to Firecrawl.

## Why Burchi v4?

| Feature | Burchi v4 | Firecrawl | Playwright | Puppeteer | Selenium | GPT-based |
|---------|-----------|-----------|------------|-----------|----------|-----------|
| Element location | Semantic (NL) | CSS/XPath | CSS/XPath | CSS | CSS/XPath | NL (LLM) |
| Breaks on redesign | No | Yes | Yes | Yes | Yes | No |
| LLM API cost | $0 | $0.01/page | N/A | N/A | N/A | $0.01-0.10/call |
| Latency | <5ms | 2-5s | <1ms | <1ms | <1ms | 500-2000ms |
| Self-healing | Yes (math) | No | No | No | No | Yes (AI) |
| Site crawl | Yes (recursive) | Yes | No | No | No | No |
| Sitemap parsing | Yes | No | No | No | No | No |
| robots.txt respect | Yes | No | No | No | No | No |
| Content dedup | Yes | No | N/A | N/A | N/A | N/A |
| Search across pages | Yes | No | N/A | N/A | N/A | N/A |
| HTTP API server | Yes | Yes (cloud) | No | No | No | No |
| Dependencies | 0 | API key | Node.js | Node.js | WebDriver | API key |
| Runs locally | Yes | No (cloud) | Yes | Yes | Yes | Yes |

## Quick Start

### Build

```bash
swift build -c release
```

### CLI

```bash
# Get a clean semantic digest (no divs, no classes — just meaningful elements)
burchi digest --url "https://example.com"

# Convert any page to markdown
burchi markdown --url "https://example.com"

# Find elements by meaning
burchi find --url "https://rent.men" --intent "find the availability toggle"

# Click by intent
burchi click --url "https://example.com" --intent "more information link"

# Ask a structured question
burchi ask --url "https://example.com" --intent "what links are on this page?"

# Smart extraction (auto-detects page type)
burchi smart --url "https://example.com"

# Batch crawl
burchi crawl --url "https://example.com,https://rent.men"

# Recursive site crawl (Firecrawl killer)
burchi site --url "https://example.com" --depth 3 --max 50 --format markdown --out results.json

# Parse sitemap.xml
burchi sitemap --url "https://example.com"

# Search across crawled pages
burchi search --file results.json --intent "pricing information" --top 10

# Start HTTP API server
burchi server --port 8080

# Execute JSON script
burchi script --file actions.json
```

### Python

```python
import burchi

browser = burchi.Browser()
browser.goto("https://example.com")

# Clean digest for LLM consumption
digest = browser.digest()

# Markdown conversion
md = browser.markdown()

# Semantic find
matches = browser.find("find the login button")

# Click by intent
browser.click("sign in")

# Ask structured question
answer = browser.ask("what forms are on this page?")

# Smart extraction
data = browser.smart_extract()

# Execute script
results = browser.script([
    {"action": "goto", "intent": "https://example.com"},
    {"action": "digest"},
    {"action": "find", "intent": "login button"},
    {"action": "click", "intent": "sign in", "wait": 2.0},
    {"action": "markdown"}
])

# Recursive site crawl (Firecrawl killer)
pages = browser.crawl_site_json("https://example.com", depth=3, max_pages=50)
for p in pages:
    print(f"  [{p['depth']}] {p['title']} → {p['url']}")

# Parse sitemap
urls = browser.sitemap("https://example.com")

# Search across crawled pages
results = browser.search_pages("results.json", "pricing information")
```

## LLM-Facing API

### `digest()` — Clean Page Representation
Returns a semantic digest with no divs, classes, or CSS — just meaningful elements:
```
# Page: Example Domain
URL: https://example.com/
Elements: 2 meaningful / 2 total

[h1] "Example Domain"
[link] "Learn more" ← e1
```

### `markdown()` — Page to Markdown
Converts any web page to clean markdown with proper headings, links, images, tables, and lists.

### `ask(question)` — Structured Query
Ask a natural language question, get structured JSON back:
```json
{
  "summary": {"title": "...", "links": 5, "headings": 3, ...},
  "links": [{"text": "Learn more", "href": "..."}],
  "forms": [{"ref": "e4", "role": "textbox", "name": "email"}]
}
```

### `smart_extract()` — Auto-Detect & Extract
Detects page type (login, search, article, listing) and extracts all relevant structured data.

### `script(actions)` — JSON Action Pipeline
Execute a sequence of semantic actions from JSON — the primary LLM API:
```json
[
  {"action": "goto", "intent": "https://example.com"},
  {"action": "digest"},
  {"action": "type", "intent": "email", "value": "user@test.com"},
  {"action": "type", "intent": "password", "value": "secret"},
  {"action": "click", "intent": "sign in", "wait": 3.0},
  {"action": "markdown"}
]
```

### `crawl(urls)` — Batch Crawl
Visit multiple URLs and get consolidated digests, links, and metadata.

### `crawl_site(url, depth, max_pages)` — Recursive Site Crawl (Firecrawl Killer)
Crawl an entire site with depth control, same-domain filtering, URL dedup, content dedup, rate limiting, and robots.txt respect. Returns all pages as markdown + metadata.

### `sitemap(url)` — Sitemap Parsing
Parse `sitemap.xml` or `sitemap_index.xml` to discover all URLs on a site.

### `search_pages(file, query)` — Search Across Pages
Search across previously crawled pages using TF-IDF token matching. Returns ranked results with snippets.

### HTTP API Server
Start a REST API server for LLM integration:
```bash
burchi server --port 8080
```
Endpoints:
- `GET /health` — Health check
- `GET /digest?url=` — Page digest
- `GET /markdown?url=` — Page to markdown
- `GET /find?url=&intent=` — Semantic find
- `GET /smart?url=` — Smart extraction
- `GET /ask?url=&intent=` — Structured query
- `POST /script` — JSON action script
- `GET /site?url=&depth=` — Site crawl
- `GET /sitemap?url=` — Parse sitemap

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Burchi v4 API                       │
├──────────────────────────────────────────────────────┤
│  digest()  markdown()  ask()  smart_extract()        │
│  script()  crawl()  find()  click()  type()          │
│  crawl_site()  sitemap()  search_pages()  server()   │
├──────────────────────────────────────────────────────┤
│          Semantic Embedder (DOM-specific layer)       │
│  ┌──────────────┐  ┌────────────────────────┐        │
│  │  Intent-Aware │  │  Heuristic Bonuses     │        │
│  │  Tag Weighting│  │  (content, input, leaf)│        │
│  └──────────────┘  └────────────────────────┘        │
├──────────────────────────────────────────────────────┤
│                    Nyx Engine                          │
│  ┌──────────────┐  ┌────────────────────────┐        │
│  │  TF-IDF       │  │  Cosine Similarity     │        │
│  │  Vectorizer   │  │  Matcher               │        │
│  └──────────────┘  └────────────────────────┘        │
│  ┌──────────────┐  ┌────────────────────────┐        │
│  │  Vocab Filter │  │  Synonym Expander      │        │
│  │  (minDf >= 2) │  │  (30+ synonym groups)  │        │
│  └──────────────┘  └────────────────────────┘        │
├──────────────────────────────────────────────────────┤
│        Accessibility Tree + DOM + Crawl Engine        │
│  ┌──────────────┐  ┌────────────────────────┐        │
│  │  A11y Roles   │  │  Self-Healing Engine   │        │
│  │  (WAI-ARIA)   │  │  (survives redesigns)  │        │
│  └──────────────┘  └────────────────────────┘        │
│  ┌──────────────┐  ┌────────────────────────┐        │
│  │  Site Crawl   │  │  Sitemap + robots.txt  │        │
│  │  (recursive)  │  │  Content dedup + hash  │        │
│  └──────────────┘  └────────────────────────┘        │
├──────────────────────────────────────────────────────┤
│              WKWebView (WebKit) + HTTP Server          │
└──────────────────────────────────────────────────────┘
```

### Module Structure

- **Nyx** (`Sources/Nyx/`) — Pure NLP engine: `NyxTFIDFEngine`, `nyxCosineSimilarity`, `NyxSynonymExpander`. Zero dependencies. Reusable for any text similarity task.
- **Burchi** (`Sources/Burchi/`) — Browser automation layer over Nyx. WebKit DOM extraction, accessibility tree, semantic embedding, self-healing, site crawl.
- **BurchiCLI** (`Sources/BurchiCLI/`) — CLI + HTTP server.

## Tests

### Unit Tests (Swift)

```bash
swift test
```

39 tests covering:
- **Nyx** (21 tests): tokenization, stop word filtering, TF-IDF vectorization, vocabulary building, cosine similarity (identical, orthogonal, opposite, empty, mismatched, scale-invariant), synonym expansion (login, button, multi-token, deduplication), TF-IDF + cosine integration
- **Burchi** (18 tests): element model, match results, snapshots, browser initialization, navigation, DOM extraction, JSON output, script execution, crawl config, crawled page construction, content regions, page search results

### CLI Self-Tests

```bash
burchi test
```

11 live tests covering navigation, DOM extraction, a11y tree, semantic find (heading + link), flow detection, metadata, self-healing, intent-filtered snapshot, page diff, and JSON output.

## License

Apache 2.0
