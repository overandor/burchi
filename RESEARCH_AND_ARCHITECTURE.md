# Burchi — Frontier Semantic Browser for LLMs
## Research Report & Architecture Evolution

---

# PART 1: AVAILABILITY FUNCTIONALITY — DEEP RESEARCH

## 1.1 Current Availability Stack (9 Algorithms)

The RentMasseur infrastructure runs 9 availability algorithms in priority order, each with attribution tracking:

### Algorithm Priority Chain
```
BackoffRecovery → RefreshCascade → EngagementTrigger → CompetitorGap
→ PeakHourSync → GeoRotation → DemandPulse → JitterBurst → SearchRankBoost
```

### Algorithm Analysis

| # | Algorithm | Trigger | Mechanism | Measured Signal |
|---|-----------|---------|-----------|-----------------|
| 1 | **JitterBurst** | Every 30min | 2-5s offline pulse → back online | "Recently available" freshness signal |
| 2 | **PeakHourSync** | Peak hours (8-11, 13-15, 19-23) | Ensure availability during high traffic | View count correlation by hour |
| 3 | **CompetitorGap** | <30% competitors available | Go available when others drop | Competitor ratio monitoring |
| 4 | **RefreshCascade** | 1h, 30min, 5min before expiry | Staggered refresh, never gap | Expiry countdown tracking |
| 5 | **SearchRankBoost** | Every 2h | 10s offline → back → fresh in "available now" sort | Search sort position |
| 6 | **DemandPulse** | Low hours (2-6am) | 15min on / 5min off pulsing | Pent-up demand capture |
| 7 | **GeoRotation** | Multi-TZ peaks (8-14, 19-02) | Cover ET+CT+PT waves | Timezone-aware availability |
| 8 | **EngagementTrigger** | Visit/message received | Immediate refresh after engagement | Engagement-to-availability latency |
| 9 | **BackoffRecovery** | API failure | Exponential backoff 2s→120s, max 5 retries | Failure recovery rate |

### Attribution System
The system computes per-algorithm traffic lift:
- **Baseline rate**: Median views/min during "quiet" periods (no algo fired in prior 30min)
- **Lift calculation**: `actual_views - expected_views` over 30min attribution window
- **Verdict**: POSITIVE (lift>0, ≥2 fires), NEGATIVE, INSUFFICIENT_DATA
- **Share %**: Each algo's contribution to total lift

### Gaps in Current Availability System

1. **No multi-platform availability** — Only RentMasseur, no cross-platform (MassageBook, RubRatings, etc.)
2. **No ML-based peak prediction** — Peak hours are hardcoded, not learned from data
3. **No competitor scraping integration** — CompetitorGap relies on external state, doesn't scrape itself
4. **No A/B testing of algo parameters** — JitterBurst duration, DemandPulse cycle, etc. are fixed
5. **No weather/event correlation** — Rain, holidays, events affect demand but aren't tracked
6. **No price-availability coupling** — Availability doesn't adjust based on demand signals
7. **No search rank feedback loop** — SearchRankBoost fires blindly, doesn't verify rank improvement

## 1.2 Novel Availability Algorithms (Proposed)

### 10. WeatherDemandAdapter
```
IF rain forecast → extend availability (indoor demand spike)
IF heat wave → reduce midday, extend evening
IF major event in city → extend availability during event + 2h after
IF holiday → shift to afternoon peak (people book late)
```

### 11. ConversionRateOptimizer
```
Track: views → contact_clicks → emails → bookings per availability window
IF high views but low clicks → availability window too wide (diluted)
IF low views but high click rate → narrow window creates urgency
Optimize: find the availability duration that maximizes booking_rate × view_rate
```

### 12. CompetitorPriceGap
```
Monitor competitor rates during their availability windows
IF competitors raise prices → go available (capture price-sensitive clients)
IF competitors drop prices → maintain availability (premium positioning)
```

### 13. SearchRankMLPredictor
```
Train ML model: (hour, day, availability_duration, competitor_count) → search_rank
Predict best availability window to maximize rank
Reinforcement learning: reward = rank_improvement × view_increase
```

### 14. EngagementVelocityTrigger
```
Instead of single visit trigger:
IF visit_rate_acceleration > threshold (visits accelerating) → extend availability
IF message_response_rate > 80% in last hour → extend (hot lead window)
IF booking_inquiry_received → extend to maximum duration (capture conversion)
```

---

# PART 2: CROSS-MASSAGE TRAFFIC SEO OPTIMIZATION

## 2.1 Current SEO Stack

### What Exists
- **seo_keywords.py**: Groq LLM generates keyword sets per strategy (30 strategies × 10 primary + 15 long-tail + 10 local keywords)
- **content_optimizer.py**: Conservative bio A/B testing (1 change per 24h, hypothesis-driven, policy-checked)
- **search_rank.py**: Position tracking in RentMasseur search results
- **bio_ab_tester.py**: Competitor bio scraping + 30-variant generation + pairwise A/B testing
- **social_traffic_tunnel.py**: Reddit + X.com lead pipeline with LLM intent classification

### SEO Optimization Layers

```
Layer 1: On-Platform SEO (RentMasseur internal search)
  ├── Bio headline optimization (60 char target)
  ├── Bio description keyword density
  ├── Availability status → "available now" filter boost
  ├── Search rank position tracking
  └── Tag/category optimization

Layer 2: Off-Platform SEO (Google indexing of profile)
  ├── Profile page meta tags (controlled by platform)
  ├── Blog content on RentMasseur (indexable)
  ├── Interview answers (indexable)
  └── Photo alt text (if editable)

Layer 3: Social Traffic Tunnel
  ├── Reddit intent classification (5 categories)
  ├── X.com tweet monitoring (10 query patterns)
  ├── LLM-generated personalized responses
  └── Lead → profile visit → booking funnel

Layer 4: Content Generation
  ├── 30 bio strategies with SEO keyword injection
  ├── Blog post generation (5 ideas per strategy)
  ├── Interview answer optimization
  └── Meta description generation (150 chars)
```

## 2.2 Cross-Platform Traffic SEO (Novel)

### The Multi-Platform Problem
Massage therapists operate across multiple platforms:
- RentMasseur (primary)
- MassageBook
- RubRatings
- MassageAnywhere
- Backpage alternatives
- Personal website
- Google Business Profile
- Instagram/TikTok (visual marketing)

### Cross-Platform SEO Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  CENTRAL CONTENT ENGINE                                      │
│  ├── Master bio (canonical, optimized)                      │
│  ├── Platform-specific variants (tone, length, keywords)    │
│  ├── Keyword matrix: platform × intent × location           │
│  └── Content calendar: bio rotation × blog × social         │
└──────────────────┬──────────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  PLATFORM ADAPTERS                                           │
│  ├── RentMasseur: API-based bio update + availability       │
│  ├── MassageBook: Selenium/API bio sync                     │
│  ├── Google Business: Profile optimization + posts          │
│  ├── Instagram: Bio link + content scheduling               │
│  └── Personal site: Full SEO control (schema.org, sitemap)  │
└──────────────────┬──────────────────────────────────────────┘
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  TRAFFIC ATTRIBUTION ENGINE                                  │
│  ├── UTM tracking per platform                               │
│  ├── Referrer analysis (which platform sent the booking?)    │
│  ├── Cross-platform rank tracking                            │
│  ├── Keyword position tracking across Google + platform      │
│  └── Revenue per platform × per keyword × per bio variant   │
└─────────────────────────────────────────────────────────────┘
```

### Cross-Platform Keyword Strategy

```
Intent Buckets:
  1. "deep tissue massage nyc"        → RentMasseur + Google + Personal site
  2. "sports massage manhattan"       → RentMasseur + Google + Instagram
  3. "massage therapist near me"      → Google Business + RentMasseur
  4. "book massage online"            → MassageBook + Personal site
  5. "couples massage nyc"            → RentMasseur + Google
  6. "neck pain relief massage"       → Reddit + Google + Blog content
  7. "late night massage manhattan"   → RentMasseur (availability signal)
  8. "outcall massage nyc"            → RentMasseur + Personal site
  9. "massage reviews nyc"            → Google Business + RentMasseur
  10. "best masseur nyc"              → All platforms (authority signal)

Platform-Specific Optimization:
  RentMasseur:   "available now" + headline keywords + tag optimization
  Google:        Schema.org LocalBusiness + review generation + posts
  Instagram:     Hashtag clusters + bio link + Reels SEO
  Personal:      Full meta tags + structured data + blog content
  Reddit:        Helpful responses (no links) → profile search → booking
```

---

# PART 3: SEO OVER-OPTIMIZATION — NEW VECTORS

## 3.1 What Google Penalizes in 2026

Based on research (July 2026):

1. **Scaled content abuse**: AI-generated pages at scale without human review
2. **Keyword stuffing**: Unnatural keyword density, hidden text
3. **Manipulative structured data**: Fake reviews, false business categories
4. **Doorway pages**: Multiple pages targeting same keyword with slight variations
5. **AI content without information gain**: Content that adds no new information
6. **Unhelpful content**: 400+ ranking signals evaluate originality, depth, expertise

## 3.2 Novel SEO Over-Optimization Vectors (Research)

### Vector 1: AI Answer Engine Optimization (AEO/GEO)
**The shift**: In 2026, visibility depends less on ranked links and more on whether a brand is cited within AI-generated answers (Google AI Overviews, ChatGPT, Perplexity).

```
Traditional SEO:  rank #1 for "deep tissue massage nyc"
AEO/GEO:          get cited in AI answer: "For deep tissue massage in NYC, [name] specializes in..."
```

**Over-optimization opportunity**:
- Structure content as clean, extractable answers (featured snippet bait)
- Lead with the answer, support with evidence
- Create "citation-worthy" information: unique statistics, proprietary methods, original research
- Entity optimization: ensure Knowledge Graph inclusion via schema.org

### Vector 2: Programmatic SEO with Information Gain
**The concept**: Generate hundreds of location × service × intent pages, each with genuine unique value.

```
Template: "[service] massage in [neighborhood] NYC"
  ├── "deep tissue massage in Chelsea NYC"
  ├── "sports massage in Williamsburg NYC"
  ├── "couples massage in Upper East Side NYC"
  └── ... (50 neighborhoods × 10 services = 500 pages)

Each page MUST have:
  - Unique neighborhood-specific content (not just swapped keywords)
  - Real information gain: local landmarks, transit access, parking tips
  - Genuine expertise signals: certifications, years experience, specializations
  - Original data: response times, availability patterns, pricing transparency
```

**Over-optimization risk**: If pages are thin or keyword-swapped only → penalty
**Safe approach**: Each page needs 300+ words of genuinely unique content

### Vector 3: Entity-Based SEO (Knowledge Graph Optimization)
**The concept**: Optimize for entity recognition, not just keywords.

```
Entity: "Your Name Massage Therapy"
  Properties:
    - type: LocalBusiness, HealthAndBeautyBusiness
    - areaServed: Manhattan, Brooklyn, Queens
    - knowsAbout: deep tissue, sports massage, trigger point therapy
    - priceRange: $$
    - openingHours: 24/7 by appointment
    - aggregateRating: 4.8 (from verified reviews)
    - hasOfferCatalog: 5 service types with descriptions

Connections:
    - locatedIn: Manhattan, NYC
    - nearLandmark: Empire State Building, Times Square
    - sameAs: [RentMasseur profile, Instagram, Google Business]
```

### Vector 4: AI-Driven Content Diversification
**The concept**: Instead of spinning one bio 30 ways, generate genuinely different content angles.

```
30 Bio Strategies (existing):
  sensory_luxury, therapeutic_expert, mystery_desire, local_hustle...

NEW: Cross-content diversification
  ├── Bio: 30 angles (existing)
  ├── Blog: 150 posts (5 per strategy × 30 strategies)
  ├── Interview: 50 Q&A pairs (optimized for long-tail keywords)
  ├── Social: 300 posts (10 per strategy × 30 strategies)
  ├── Video scripts: 30 (one per strategy)
  └── Email templates: 30 (one per strategy)

Each content piece targets different keywords:
  Bio → "deep tissue massage manhattan"
  Blog → "how to prepare for deep tissue massage"
  Interview → "what should I expect during a deep tissue massage"
  Social → "5 signs you need a deep tissue massage today"
```

### Vector 5: Availability-as-SEO
**The novel insight**: Availability status IS an SEO signal on RentMasseur.

```
"Available now" filter → higher search visibility → more views → more clicks
  → Google sees engagement signals → ranks profile page higher
  → AI answer engines cite active profiles more than inactive ones

Availability SEO loop:
  1. Be available → appear in "available now" filter
  2. More impressions → more profile views
  3. More views → more contact clicks → more bookings
  4. More engagement → Google ranks profile higher
  5. Higher rank → more organic discovery → more views
  6. Goto 1
```

### Vector 6: Review Velocity Engineering
**The concept**: Reviews are the strongest off-platform SEO signal.

```
Strategy:
  1. After each booking, send personalized follow-up (not automated spam)
  2. Time review requests for maximum response rate (within 2h of appointment)
  3. LLM generates personalized review request based on session details
  4. Track review velocity (reviews/week) — too fast = suspicious, too slow = declining
  5. Respond to every review with LLM-generated, personalized response
  6. Reviews feed back into entity SEO (aggregateRating in schema.org)

Over-optimization risk: Fake reviews → account ban + legal liability
Safe approach: Only request reviews from actual clients, never incentivize
```

### Vector 7: Cross-Platform Authority Building
**The concept**: Google's E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness) rewards cross-platform presence.

```
Authority signals:
  ├── RentMasseur: verified profile, reviews, consistent NAP (name/address/phone)
  ├── Google Business: verified, reviews, posts, photos, Q&A
  ├── Instagram: consistent branding, engagement, location tags
  ├── Personal website: about page, credentials, blog
  ├── Reddit: helpful answers (not self-promo), community trust
  └── Press/features: media mentions, industry directories

Each platform links to others → Google sees consistent entity → boosts all
```

### Vector 8: Temporal SEO (Time-Based Optimization)
**The concept**: Different keywords trend at different times.

```
Seasonal:
  Winter:  "hot stone massage", "warm massage", "cozy spa"
  Spring:  "detox massage", "lymphatic drainage", "spring renewal"
  Summer:  "sports recovery massage", "sunburn relief", "cooling massage"
  Fall:    "stress relief massage", "back to school tension"

Time-of-day:
  Morning: "energizing massage", "morning massage", "pre-workout massage"
  Afternoon: "lunch break massage", "quick massage", "stress relief"
  Evening: "relaxing massage", "after work massage", "unwind massage"
  Late night: "late night massage", "24 hour massage", "insomnia relief"

Event-based:
  Marathon weekend: "marathon recovery massage", "post-race massage"
  Fashion week: "fashion week massage", "model massage"
  Holidays: "gift massage", "holiday stress relief", "new year wellness"
```

### Vector 9: Semantic Saturation (Novel)
**The concept**: Instead of keyword density, measure "semantic completeness" — does the content cover all related entities?

```
For "deep tissue massage" the semantic cluster includes:
  ├── technique: slow strokes, deep pressure, trigger point
  ├── benefits: pain relief, muscle tension, recovery, posture
  ├── conditions: back pain, neck pain, sports injury, fibromyalgia
  ├── preparation: hydration, warm shower, comfortable clothing
  ├── aftercare: soreness, water intake, rest, ice/heat
  ├── contraindications: blood clots, fractures, pregnancy (certain areas)
  ├── frequency: weekly, bi-weekly, monthly maintenance
  └── pricing: incall, outcall, session length options

Content that covers ALL of these entities ranks higher than
content that just repeats "deep tissue massage" 20 times.
```

### Vector 10: AI Search Poisoning Defense
**The concept**: Competitors may try to manipulate AI answer engines to exclude you.

```
Defense strategies:
  1. Monitor AI answers for your keywords (are you cited?)
  2. Ensure consistent NAP across all platforms (entity disambiguation)
  3. Generate citation-worthy content (data, research, unique insights)
  4. Build backlinks from authoritative sources (industry directories)
  5. Monitor for negative SEO (fake negative reviews, copycat profiles)
  6. File takedowns for impersonating profiles
```


---

# PART 4: BURCHI — FRONTIER SEMANTIC BROWSER FOR LLMS

## 4.1 The Problem Burchi Solves

### Current State of Browser Automation (July 2026)

| Tool | Approach | Tokens/Page | Self-Healing | LLM Required | Speed |
|------|----------|-------------|--------------|--------------|-------|
| **Selenium** | CSS selectors | N/A | No | No | Fast |
| **Playwright** | CSS + accessibility tree | ~1,500-3,000 | Partial (ARIA) | No | Fast |
| **Puppeteer** | CSS selectors | N/A | No | No | Fast |
| **Browser Use** | Screenshots + DOM | ~4,800+ | Yes (AI) | Yes | 2-5s/action |
| **Stagehand** | Screenshots + HTML | ~2,000+ | Yes (AI) | Yes | 2-5s/action |
| **Skyvern** | Computer vision + LLM | High | Yes (AI) | Yes | Slow |
| **agent-browser** | Accessibility tree | ~200-300 | Yes (semantic) | No | <500ms/action |
| **Playwright MCP** | Accessibility tree | ~1,500-3,000 | Partial | No | Fast |
| **Burchi (current)** | TF-IDF + cosine sim | ~200-500 | Yes (semantic) | No | <100ms/action |

### The Gap No Tool Fills

1. **agent-browser** is closest but TypeScript-only, no native binary, MCP-only interface
2. **Playwright MCP** uses accessibility tree but doesn't do semantic matching — just raw element lists
3. **Browser Use/Stagehand** are powerful but expensive (LLM per action) and slow
4. **Selenium/Playwright/Puppeteer** are fast but break on redesigns

**Burchi's unique position**: Pure-math semantic matching (TF-IDF + cosine similarity) that runs in milliseconds, needs zero LLM calls, and survives page redesigns — packaged as a native binary with Python bindings.

## 4.2 Burchi Evolution: From DOM Scraper to LLM Browser Interface

### Current Burchi Architecture
```
User intent ("click login button")
  → TF-IDF tokenize + synonym expansion
  → Embed query in TF-IDF space
  → Cosine similarity vs all DOM element embeddings
  → Top-K matches
  → Execute action via JS injection
```

### What's Missing for "First-Class Frontier Tool"

1. **Accessibility tree extraction** — Currently scrapes raw DOM, should use ARIA roles
2. **Page diff / incremental updates** — Re-indexing entire page on every action
3. **Intent-filtered snapshots** — Return only relevant elements for the current goal
4. **Multi-step flow detection** — Auto-detect login flows, checkout flows, search flows
5. **Content extraction primitives** — Article text, tables, metadata, structured data
6. **MCP server interface** — For direct LLM integration (ChatGPT, Claude, etc.)
7. **Python bindings** — For ecosystem reach (most AI agents are Python)
8. **Streaming partial results** — Start acting before full page load completes

## 4.3 Proposed Burchi v2 Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  BURCHI v2 — SEMANTIC BROWSER FOR LLMs                              │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  LAYER 1: PAGE PERCEPTION (3 modes)                         │   │
│  │                                                             │   │
│  │  Mode A: Accessibility Tree (primary)                       │   │
│  │    - Extract ARIA roles, names, states, descriptions        │   │
│  │    - Build semantic element tree with action capabilities   │   │
│  │    - ~200-300 tokens per page (agent-browser proven)        │   │
│  │    - <500ms extraction                                      │   │
│  │                                                             │   │
│  │  Mode B: TF-IDF Semantic (fallback for broken a11y)        │   │
│  │    - Current Burchi engine (DOM scrape + TF-IDF + cosine)  │   │
│  │    - Works when accessibility tree is degraded (div soup)  │   │
│  │    - Self-healing: matches meaning, not structure           │   │
│  │                                                             │   │
│  │  Mode C: Vision (last resort)                              │   │
│  │    - Screenshot + coordinate-based interaction              │   │
│  │    - For canvas/WebGL apps with no DOM structure            │   │
│  │    - ~4000+ tokens, 2-5s latency                            │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  LAYER 2: SEMANTIC INDEX (the Burchi engine)                │   │
│  │                                                             │   │
│  │  Hybrid Index:                                              │   │
│  │    - Accessibility tree nodes → semantic embeddings         │   │
│  │    - TF-IDF vocabulary built from a11y names + descriptions │   │
│  │    - Tag weight: button=2.0, link=1.8, textbox=2.0, etc.   │   │
│  │    - Structural features: depth, position, size, visibility │   │
│  │    - Synonym expansion: 30+ concept clusters                │   │
│  │    - Intent classification: login/search/buy/read/extract   │   │
│  │                                                             │   │
│  │  Page Diff Engine:                                           │   │
│  │    - Hash each element's semantic fingerprint               │   │
│  │    - After action, only re-index changed elements           │   │
│  │    - 80-90% fewer tokens on subsequent snapshots            │   │
│  │                                                             │   │
│  │  Flow Detection:                                             │   │
│  │    - Auto-detect: login form, search box, checkout, nav     │   │
│  │    - Group elements into action clusters                    │   │
│  │    - Execute multi-step flows in one call                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  LAYER 3: ACTION EXECUTION                                  │   │
│  │                                                             │   │
│  │  Primitives:                                                │   │
│  │    navigate(url) → load + auto-index                        │   │
│  │    find(intent) → semantic search, return ranked matches    │   │
│  │    click(intent) → find + click                             │   │
│  │    type(intent, value) → find + native input setter         │   │
│  │    select(intent, option) → find + dropdown select          │   │
│  │    scroll(direction) → page scroll                          │   │
│  │    press(key) → keyboard event                              │   │
│  │    screenshot(path) → visual capture                         │   │
│  │    extract(intent) → semantic content extraction            │   │
│  │    fill_form(fields) → batch type multiple fields            │   │
│  │    login(email, password) → multi-step flow                 │   │
│  │    execute_flow(flow_name, params) → multi-step automation   │   │
│  │                                                             │   │
│  │  Verification:                                               │   │
│  │    - After every action, verify state change                │   │
│  │    - If action failed, try alternative element              │   │
│  │    - Receipt log: action → before/after state               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  LAYER 4: LLM INTERFACE (3 interfaces)                      │   │
│  │                                                             │   │
│  │  Interface A: MCP Server (for ChatGPT, Claude, etc.)       │   │
│  │    - Expose 21+ tools over MCP protocol                     │   │
│  │    - navigate, snapshot, click, fill, extract, etc.         │   │
│  │    - snapshot_intent: filtered by goal                      │   │
│  │    - diff: only changed elements                            │   │
│  │    - get_flows: discover available workflows                │   │
│  │    - execute_flow: one-call multi-step                      │   │
│  │                                                             │   │
│  │  Interface B: CLI (for shell scripts, CI/CD)               │   │
│  │    burchi goto "https://example.com"                        │   │
│  │    burchi find "login button"                               │   │
│  │    burchi click "sign in"                                   │   │
│  │    burchi type "email" "user@example.com"                   │   │
│  │    burchi extract "product titles"                          │   │
│  │    burchi snapshot --intent login                           │   │
│  │    burchi screenshot out.png                                │   │
│  │                                                             │   │
│  │  Interface C: Python C ABI (for AI agent frameworks)       │   │
│  │    import burchi                                            │   │
│  │    browser = burchi.Browser()                               │   │
│  │    browser.goto("https://example.com")                      │   │
│  │    matches = browser.find("login button")                   │   │
│  │    browser.click("sign in")                                 │   │
│  │    browser.type("email", "user@example.com")                │   │
│  │    articles = browser.extract("article text")               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  LAYER 5: SAFETY & OBSERVABILITY                            │   │
│  │                                                             │   │
│  │  - Domain allowlist/blocklist                               │   │
│  │  - Action logging (every click, type, navigate)             │   │
│  │  - Screenshot proof for every action                        │   │
│  │  - Rate limiting (respectful crawling)                      │   │
│  │  - Session replay (reproduce any automation)                │   │
│  │  - Human approval for write actions (optional)              │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## 4.4 Key Innovation: Accessibility Tree + TF-IDF Hybrid

### The Insight
The accessibility tree is the **ideal** input for Burchi's TF-IDF engine:

```
Traditional Burchi:
  DOM elements → text + attrs + position → TF-IDF → cosine similarity

Burchi v2:
  Accessibility tree → role + name + state + description → TF-IDF → cosine similarity
  
  Why this is better:
  - a11y names are already semantic ("Email address", "Sign in button")
  - Roles are already classified (button, textbox, link, heading)
  - States are already tracked (disabled, checked, expanded)
  - No noise from Tailwind classes, SVG paths, tracking pixels
  - 10-50x fewer "documents" for TF-IDF (only meaningful elements)
```

### Hybrid Fallback Chain
```
1. Try accessibility tree extraction
   ├── Success? → Build TF-IDF from a11y nodes → semantic find
   └── Failed (div soup, no ARIA)? → Fall to step 2

2. Try DOM-based TF-IDF (current Burchi engine)
   ├── Success? → Build TF-IDF from DOM elements → semantic find
   └── Failed (canvas/WebGL/no DOM)? → Fall to step 3

3. Vision fallback (screenshot + coordinate click)
   └── Last resort only, expensive
```

## 4.5 Competitive Differentiation

### Burchi vs All Competitors

| Feature | Burchi v2 | agent-browser | Playwright MCP | Browser Use | Selenium |
|---------|-----------|---------------|----------------|-------------|----------|
| **Primary input** | a11y tree + TF-IDF | a11y tree | a11y tree | Screenshots | CSS selectors |
| **Tokens/page** | ~150-300 | ~200-300 | ~1,500-3,000 | ~4,800+ | N/A |
| **LLM calls needed** | 0 | 0 | 0 | 1+ per action | 0 |
| **Self-healing** | Yes (semantic) | Yes (semantic) | Partial | Yes (AI) | No |
| **Speed** | <100ms find | <500ms | Fast | 2-5s | Fast |
| **Language** | Swift + Python | TypeScript | TypeScript | Python | Multi |
| **Native binary** | Yes | No | No | No | No |
| **Page diff** | Yes | Yes | No | No | No |
| **Intent filtering** | Yes | Yes | No | No | No |
| **Flow detection** | Yes | Yes | No | No | No |
| **Content extraction** | Yes | Yes | No | No | No |
| **MCP server** | Yes | Yes | Yes | No | No |
| **Python bindings** | Yes (C ABI) | No | No | Native | Native |
| **Vision fallback** | Yes | No | Optional | Primary | No |
| **Zero dependency** | Yes (WebKit) | No (Playwright) | No (Playwright) | No | No |

### Burchi's Unique Moat
1. **Only tool with hybrid a11y + TF-IDF** — Best of both worlds
2. **Only native binary** — No Node.js, no browser install, no Docker
3. **Only tool with 3-tier fallback** — a11y → DOM → vision
4. **Only tool with synonym expansion** — 30+ concept clusters built-in
5. **Only tool with page diff** — 80-90% token reduction on subsequent actions
6. **Only tool with flow detection** — One-call multi-step automation
7. **Fastest semantic find** — <100ms (pure math, no LLM, no network)

## 4.6 Implementation Roadmap

### Phase 1: Accessibility Tree Integration (Week 1-2)
- Add WKWebView accessibility tree extraction via JS
- Parse ARIA roles, names, states into BurchiElement structs
- Build TF-IDF from a11y nodes instead of raw DOM
- Benchmark: token reduction vs current DOM approach

### Phase 2: Page Diff & Intent Filtering (Week 2-3)
- Element fingerprinting (hash of semantic features)
- Incremental re-indexing (only changed elements)
- Intent classifier (login, search, buy, read, extract, navigate, fill_form)
- Filtered snapshots (only elements relevant to current intent)

### Phase 3: Flow Detection & Execution (Week 3-4)
- Auto-detect common flows: login, search, checkout, registration
- Group elements into action clusters
- One-call flow execution with parameters
- Flow verification (did the flow complete successfully?)

### Phase 4: MCP Server Interface (Week 4-5)
- Implement MCP protocol over stdio
- Expose 21+ tools (navigate, snapshot, click, fill, extract, etc.)
- Test with Claude Desktop, ChatGPT, other MCP clients
- Document tool schemas

### Phase 5: Python C ABI Bindings (Week 5-6)
- Expose BurchiBrowser as C ABI (dylib)
- Python ctypes wrapper
- pip-installable package
- Test with LangChain, AutoGPT, custom agents

### Phase 6: Content Extraction & SEO Tools (Week 6-7)
- Article text extraction (readability-like)
- Structured data extraction (schema.org, Open Graph, JSON-LD)
- Table extraction
- Metadata extraction (title, description, canonical, robots)
- Link graph extraction (internal/external links)

### Phase 7: Safety & Observability (Week 7-8)
- Domain allowlist/blocklist
- Action audit log (JSONL)
- Screenshot proof per action
- Session replay
- Rate limiting
- Human approval queue for write actions

### Phase 8: Benchmark Suite (Week 8)
- WebVoyager benchmark (586 tasks)
- Token consumption comparison
- Latency comparison
- Self-healing test (page mutation survival)
- Publish results

## 4.7 Burchi for SEO Over-Optimization Research

### Burchi as SEO Research Tool
With its semantic browsing capabilities, Burchi can:

1. **Scrape competitor profiles semantically**
   ```
   burchi goto "https://rentmasseur.com/search?city=manhattan-ny"
   burchi extract "all profile names and headlines"
   burchi extract "availability status for each profile"
   burchi extract "search rank position"
   ```

2. **Monitor AI answer engine citations**
   ```
   burchi goto "https://perplexity.ai"
   burchi type "search" "best deep tissue massage nyc"
   burchi extract "cited sources and mentioned businesses"
   # Are we cited? Are competitors?
   ```

3. **Track keyword positions across platforms**
   ```
   burchi goto "https://google.com/search?q=deep+tissue+massage+nyc"
   burchi extract "organic results with positions"
   burchi extract "AI overview cited businesses"
   burchi extract "local pack results"
   ```

4. **Audit semantic saturation**
   ```
   burchi goto "https://rentmasseur.com/your-profile"
   burchi extract "all text content"
   # Analyze: does content cover all entities in the semantic cluster?
   ```

5. **Cross-platform consistency check**
   ```
   burchi goto "https://google.com/maps/place/..."
   burchi extract "business name, address, phone, hours"
   burchi goto "https://rentmasseur.com/your-profile"
   burchi extract "business name, address, phone, hours"
   # Compare: NAP consistent across platforms?
   ```

6. **Review velocity monitoring**
   ```
   burchi goto "https://google.com/maps/place/..."
   burchi extract "review count, rating, recent review dates"
   burchi goto "https://rentmasseur.com/your-profile"
   burchi extract "review count, rating"
   # Track review velocity over time
   ```


---

# PART 5: SYNTHESIS — CONNECTING AVAILABILITY + SEO + BURCHI

## 5.1 The Unified Optimization Loop

```
┌─────────────────────────────────────────────────────────────────────┐
│  BURCHI-POWERED RENTMASSEUR OPTIMIZATION LOOP                       │
│                                                                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐     │
│  │ Burchi   │───→│ Semantic │───→│ Traffic  │───→│ SEO      │     │
│  │ Browse   │    │ Analyze  │    │ Act      │    │ Measure  │     │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘     │
│       │                                               │            │
│       │              ┌──────────┐                     │            │
│       └──────────────│  RL      │←───────────────────┘            │
│                      │  Reward  │                                  │
│                      └──────────┘                                  │
│                                                                     │
│  Burchi browses:                                                    │
│    - RentMasseur search results (rank tracking)                     │
│    - Competitor profiles (bio, availability, pricing)               │
│    - Google search results (organic rank, AI overview)              │
│    - Reddit/X.com (intent signals, lead generation)                 │
│    - Google Business Profile (reviews, consistency)                 │
│                                                                     │
│  Semantic analysis:                                                 │
│    - Competitor bio keyword extraction                              │
│    - Semantic saturation scoring (entity coverage)                  │
│    - Review sentiment + velocity tracking                           │
│    - AI answer engine citation monitoring                           │
│    - Cross-platform NAP consistency check                           │
│                                                                     │
│  Traffic actions:                                                   │
│    - Availability algorithm execution (9+ algos)                    │
│    - Bio rotation (30 strategies, A/B tested)                       │
│    - Content generation (blog, interview, social)                   │
│    - Engagement (reciprocal visits, LLM messages)                   │
│    - Review response generation                                     │
│                                                                     │
│  SEO measurement:                                                   │
│    - Search rank position (RentMasseur + Google)                    │
│    - View/contact/click funnel metrics                              │
│    - AI answer engine citation rate                                 │
│    - Review velocity + rating trend                                 │
│    - Cross-platform traffic attribution                             │
│                                                                     │
│  RL reward:                                                         │
│    reward = (views × 1) + (clicks × 5) + (emails × 10)            │
│           + (bookings × 50) + (ai_citations × 20)                  │
│           + (review_velocity × 15) + (rank_improvement × 30)       │
│           - (bio_age_days × 0.5) - (penalty_risk × 100)            │
└─────────────────────────────────────────────────────────────────────┘
```

## 5.2 Why Burchi Is the Key Enabler

Without Burchi, the RentMasseur infrastructure is limited to:
- API calls only (can't see what users see)
- Selenium for visual automation (brittle, slow, detectable)
- No semantic understanding of competitor pages
- No cross-platform monitoring

With Burchi:
- **Semantic browsing** — Find any element by meaning, not selectors
- **Zero LLM cost** — Pure math, runs in milliseconds
- **Self-healing** — Survives platform redesigns
- **Cross-platform** — Browse any site, extract any content
- **LLM interface** — MCP server lets GPT/Claude browse directly
- **Python bindings** — Integrate with existing AI agent frameworks
- **Native speed** — Swift on Apple WebKit, no browser install needed

## 5.3 The "Without DIVs" Vision

The user's core insight: **LLMs should browse the web without dealing with DIVs and other DOM difficulty.**

Burchi achieves this through 3 layers of abstraction:

```
Layer 1: Accessibility Tree (removes DIV soup)
  - Browser already computes semantic roles from DOM
  - "div with role=button" → "button" in a11y tree
  - "div with class='x7y2z1'" → ignored (no semantic meaning)
  - LLM sees: button "Sign In", textbox "Email", link "About Us"

Layer 2: TF-IDF Semantic Index (removes structure complexity)
  - All elements converted to semantic vectors
  - Intent query ("click login") → vector → cosine similarity
  - No need to understand HTML structure, CSS, or JS frameworks
  - LLM sees: "login button found at rank 1, score 0.92"

Layer 3: Intent-Filtered Snapshots (removes irrelevant noise)
  - "I want to login" → only show login-related elements
  - "I want to read content" → only show article text, headings
  - "I want to buy" → only show price, cart, checkout elements
  - LLM sees: exactly what it needs, nothing else
```

### The Result
```
Instead of sending an LLM 50,000 tokens of raw HTML:

<div class="x7y2z1 flex items-center justify-between">
  <div class="w-3 h-3 rounded-full bg-green-500"></div>
  <span class="text-sm font-medium text-gray-700">Available</span>
  <button class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700
    transition-colors duration-200" data-testid="login-button">
    Sign In
  </button>
</div>

Burchi sends:

- button "Sign In" [ref=e1]
- status "Available" [ref=e2]

And the LLM can act:
  → click("Sign In")
  → Done. No div parsing. No class names. No complexity.
```


---

# PART 6: RESEARCH SOURCES

## Web Research (July 2026)

1. **"The End of Selectors: LLM-Driven HTML Parsing"** (DEV Community)
   - Key finding: "The shift to LLM-Driven HTML Parsing is the correction of treating the web as a database of structured documents"
   - SNR problem: 2MB page → 5KB useful data → 99% noise
   - Future: VLMs will parse pixels, not HTML, making anti-bot obfuscation obsolete

2. **"Accessibility is the first-class interface for AI agents"** (InfoWorld, Jul 2026)
   - Key finding: "Switching from screenshot-based to DOM-native execution cut per-action latency from 2–5 seconds to under 500ms and token cost by an order of magnitude"
   - WebMCP: Browser-native typed capabilities for agents
   - "If we had done a good job with accessibility, we should get this for free"

3. **"11 Best AI Browser Agents in 2026"** (Firecrawl)
   - Browser Use: 89.1% WebVoyager success rate
   - agent-browser: ~200-300 tokens/page, 17x reduction vs screenshots
   - Skyvern: 85.85% WebVoyager, best on form-filling
   - Stagehand: act/extract/observe primitives (Playwright + AI)

4. **"The Accessibility Tree Is How AI Agents Read Your Site"** (Search Engine Journal)
   - Playwright MCP: "uses Playwright's accessibility tree, not pixel-based input"
   - OpenAI ChatGPT Atlas: "uses ARIA tags to interpret page structure"
   - Accessibility tree = "structured semantic representation of roles, labels, states"

5. **"Programmatic SEO in 2026"** (multiple sources)
   - AEO (Answer Engine Optimization) > traditional SEO
   - 5x more AI search visibility with pSEO + AEO synergy
   - Information gain is the key metric (not keyword density)
   - Entity-based SEO with verified author credentials

6. **"Does Google Penalize AI Content?"** (Rankability, 2026)
   - Google doesn't penalize AI content — penalizes content that sucks
   - 400+ ranking signals evaluate originality, depth, expertise
   - Scaled content abuse = penalty; scaled content with value = boost

## Codebase Research

7. **availability_algos.py** (597 lines) — 9 algorithms with attribution
8. **seo_keywords.py** (128 lines) — 30 strategies × keyword generation
9. **content_optimizer.py** (238 lines) — Conservative bio A/B testing
10. **search_rank.py** (98 lines) — Position tracking
11. **social_traffic_tunnel.py** (556 lines) — Reddit + X.com lead pipeline
12. **traffic_loop.py** (1178 lines) — 30 client-magnet functions
13. **Burchi.swift** (782 lines) — Current TF-IDF + cosine similarity engine
14. **NyxSemantic main.swift** (886 lines) — Original semantic element location
