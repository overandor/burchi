"""Burchi — Semantic Browser Automation (Python port)

Uses Playwright (headless Chromium) instead of WKWebView.
Powered by Nyx TF-IDF + cosine similarity engine.
Find elements by meaning, not selectors. Zero LLM calls. Self-healing.
"""

import hashlib
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse, urlunparse

import numpy as np

from .nyx import NyxSynonymExpander, NyxTFIDFEngine, nyx_cosine_similarity

# ── DOM Element Model ──────────────────────────────────────────────────────────

@dataclass
class BurchiElement:
    index: int = 0
    tag: str = ""
    text: str = ""
    depth: int = 0
    sibling_index: int = 0
    child_count: int = 0
    x: float = 0.0
    y: float = 0.0
    width: float = 0.0
    height: float = 0.0
    attrs: Dict[str, str] = field(default_factory=dict)
    parent_tags: List[str] = field(default_factory=list)
    ancestor_text: str = ""
    is_visible: bool = True
    xpath: str = ""


@dataclass
class BurchiMatch:
    element: BurchiElement
    score: float
    rank: int
    matched_terms: List[str]


@dataclass
class A11yNode:
    role: str
    name: str
    description: str
    tag: str
    x: float
    y: float
    width: float
    height: float
    is_interactive: bool
    state_disabled: bool
    state_checked: Optional[bool]
    xpath: str
    index: int

    @property
    def ref(self) -> str:
        return f"e{self.index}"


# ── Semantic Embedder ─────────────────────────────────────────────────────────

TAG_WEIGHTS: Dict[str, float] = {
    "input": 2.0, "button": 2.0, "a": 1.8, "textarea": 2.0,
    "select": 2.0, "form": 1.5, "label": 1.5, "h1": 1.3,
    "h2": 1.2, "h3": 1.1, "img": 1.2, "title": 0.3,
    "span": 0.8, "div": 0.5, "p": 1.0, "li": 0.9,
}

NON_INTERACTIVE_TAGS: set = {
    "title", "style", "script", "head", "meta", "link",
    "noscript", "template", "react-partial", "slot",
}

W_TEXT = 3.0
W_ATTR = 2.0
W_CONTEXT = 1.0
W_TAG = 1.5
W_DEPTH = 0.3
W_POS = 0.2
W_SIZE = 0.1
W_VIS = 0.5
W_CHILD = 0.1


class SemanticEmbedder:
    def __init__(self):
        self.tfidf = NyxTFIDFEngine()
        self._syn = NyxSynonymExpander()
        self.element_count = 0

    def build_corpus(self, elements: List[BurchiElement]) -> None:
        documents = []
        for el in elements:
            attr_text = " ".join(el.attrs.values())
            documents.append(f"{el.text} {attr_text} {el.ancestor_text}")
        self.tfidf.build_vocabulary(documents)
        self.element_count = len(elements)

    def embed(self, element: BurchiElement) -> np.ndarray:
        text_vec = self.tfidf.tfidf_vector(element.text)
        attr_vec = self.tfidf.tfidf_vector(" ".join(element.attrs.values()))
        ctx_vec = self.tfidf.tfidf_vector(element.ancestor_text)

        vec = np.zeros(self.tfidf.vocab_size + 8, dtype=np.float64)
        vec[: self.tfidf.vocab_size] = (
            W_TEXT * text_vec + W_ATTR * attr_vec + W_CONTEXT * ctx_vec
        )

        off = self.tfidf.vocab_size
        tag_w = TAG_WEIGHTS.get(element.tag, 1.0)
        vec[off] = W_TAG * tag_w
        vec[off + 1] = W_DEPTH * (1.0 - min(element.depth / 20.0, 1.0))
        vec[off + 2] = W_POS * (element.x / 1920.0)
        vec[off + 3] = W_POS * (element.y / 1080.0)
        vec[off + 4] = W_SIZE * min(element.width / 500.0, 1.0)
        vec[off + 5] = W_SIZE * min(element.height / 200.0, 1.0)
        vec[off + 6] = W_VIS if element.is_visible else 0.0
        vec[off + 7] = W_CHILD * (1.0 - min(element.child_count / 20.0, 1.0))
        return vec

    def embed_intent(self, query: str) -> np.ndarray:
        expanded = self._syn.expand(query, self.tfidf)
        tfidf_vec = self.tfidf.tfidf_vector(" ".join(expanded))
        vec = np.zeros(self.tfidf.vocab_size + 8, dtype=np.float64)
        vec[: self.tfidf.vocab_size] = W_TEXT * tfidf_vec

        off = self.tfidf.vocab_size
        lq = query.lower()
        if any(w in lq for w in ("input", "field", "textbox")):
            vec[off] = W_TAG * 2.0
        elif any(w in lq for w in ("button", "submit", "click")):
            vec[off] = W_TAG * 2.0
        elif any(w in lq for w in ("link", "navigation")):
            vec[off] = W_TAG * 1.8
        elif any(w in lq for w in ("image", "photo")):
            vec[off] = W_TAG * 1.2
        elif any(w in lq for w in ("heading", "title")):
            vec[off] = W_TAG * 1.3
        else:
            vec[off] = W_TAG * 1.0
        vec[off + 1] = W_DEPTH * 0.5
        vec[off + 6] = W_VIS
        vec[off + 7] = W_CHILD * 0.7
        return vec


# ── Crawl Data Structures ──────────────────────────────────────────────────────

@dataclass
class CrawlConfig:
    max_depth: int = 3
    max_pages: int = 50
    same_domain_only: bool = True
    delay: float = 0.5
    respect_robots_txt: bool = True
    output_format: str = "markdown"
    timeout: float = 15.0


@dataclass
class CrawledPage:
    url: str
    title: str
    depth: int
    success: bool
    content: str
    links: List[str]
    metadata: Dict[str, str]
    content_hash: str
    error: Optional[str]


@dataclass
class PageSearchResult:
    url: str
    title: str
    score: float
    snippet: str
    matched_terms: List[str]


# ── JS Snippets ────────────────────────────────────────────────────────────────

JS_EXTRACT_DOM = r"""
() => {
    var elements = [];
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length && i < 2000; i++) {
        var el = all[i];
        var rect = el.getBoundingClientRect();
        var visible = (rect.width > 0 && rect.height > 0);
        var tag = el.tagName.toLowerCase();
        var text = (el.innerText || el.textContent || '').trim().substring(0, 200);
        var depth = 0;
        var parent = el.parentElement;
        var parentTags = [];
        var ancestorText = '';
        while (parent && depth < 15) {
            parentTags.push(parent.tagName.toLowerCase());
            var pText = (parent.innerText || '').trim();
            if (pText.length > 0 && ancestorText.length < 300) ancestorText += ' ' + pText.substring(0, 100);
            parent = parent.parentElement;
            depth++;
        }
        var siblingIndex = 0;
        var sib = el.previousElementSibling;
        while (sib) { siblingIndex++; sib = sib.previousElementSibling; }
        var attrs = {};
        var attrNames = ['type','role','aria-label','placeholder','name','id','href','class','value','title','alt','for','action','data-testid'];
        for (var j = 0; j < attrNames.length; j++) {
            var val = el.getAttribute(attrNames[j]);
            if (val) attrs[attrNames[j]] = val.substring(0, 200);
        }
        var style = window.getComputedStyle(el);
        if (visible) visible = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
        var xpath = '';
        var node = el;
        while (node && node.nodeType === 1) {
            var idx = 1; var s = node.previousElementSibling;
            while (s) { if (s.tagName === node.tagName) idx++; s = s.previousElementSibling; }
            xpath = '/' + node.tagName.toLowerCase() + '[' + idx + ']' + xpath;
            node = node.parentElement;
        }
        elements.push({ index: elements.length, tag: tag, text: text, depth: depth, siblingIndex: siblingIndex, childCount: el.children.length, x: rect.left, y: rect.top, width: rect.width, height: rect.height, attrs: attrs, parentTags: parentTags, ancestorText: ancestorText.substring(0, 500), isVisible: visible, xpath: xpath });
    }
    return elements;
}
"""

JS_EXTRACT_A11Y = r"""
() => {
    var nodes = [];
    var all = document.querySelectorAll('*');
    var idx = 0;
    for (var i = 0; i < all.length && i < 2000; i++) {
        var el = all[i];
        var rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;

        var role = el.getAttribute('role');
        if (!role) {
            var tag = el.tagName.toLowerCase();
            var implicitRoles = {
                'a': el.getAttribute('href') ? 'link' : null,
                'button': 'button', 'input': 'textbox', 'textarea': 'textbox',
                'select': 'listbox', 'img': 'img', 'h1': 'heading',
                'h2': 'heading', 'h3': 'heading', 'h4': 'heading',
                'h5': 'heading', 'h6': 'heading', 'nav': 'navigation',
                'main': 'main', 'header': 'banner', 'footer': 'contentinfo',
                'form': 'form', 'label': 'label', 'ul': 'list',
                'ol': 'list', 'li': 'listitem', 'table': 'table',
                'caption': 'caption', 'figure': 'figure'
            };
            role = implicitRoles[tag] || null;
        }
        if (!role) continue;

        var name = el.getAttribute('aria-label') || '';
        if (!name) {
            var lbl = el.getAttribute('aria-labelledby');
            if (lbl) { var lblEl = document.getElementById(lbl); if (lblEl) name = lblEl.innerText.trim(); }
        }
        if (!name) name = (el.innerText || '').trim().substring(0, 200);
        if (!name) name = el.getAttribute('placeholder') || '';
        if (!name) name = el.getAttribute('title') || '';
        if (!name && el.tagName === 'INPUT') {
            var lblFor = document.querySelector('label[for="' + (el.id || '') + '"]');
            if (lblFor) name = lblFor.innerText.trim();
        }
        if (!name) name = el.getAttribute('alt') || '';

        var desc = el.getAttribute('aria-description') || '';
        var disabled = el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';
        var checked = null;
        if (el.getAttribute('aria-checked') === 'true') checked = true;
        else if (el.getAttribute('aria-checked') === 'false') checked = false;
        else if (el.tagName === 'INPUT' && el.type === 'checkbox') checked = el.checked;

        var interactive = ['button','link','textbox','checkbox','radio','slider','tab','menuitem','option','searchbox','switch','combobox','spinbutton'].indexOf(role) >= 0;

        var xpath = '';
        var node = el;
        while (node && node.nodeType === 1) {
            var sibIdx = 1; var s = node.previousElementSibling;
            while (s) { if (s.tagName === node.tagName) sibIdx++; s = s.previousElementSibling; }
            xpath = '/' + node.tagName.toLowerCase() + '[' + sibIdx + ']' + xpath;
            node = node.parentElement;
        }

        nodes.push({
            role: role, name: name.substring(0, 200), description: desc.substring(0, 200),
            tag: el.tagName.toLowerCase(), x: rect.left, y: rect.top,
            width: rect.width, height: rect.height,
            isInteractive: interactive, disabled: disabled, checked: checked,
            xpath: xpath, index: idx
        });
        idx++;
    }
    return nodes;
}
"""

JS_TO_MARKDOWN = r"""
(maxLength) => {
    function nodeToMarkdown(node, depth) {
        if (!node || depth > 10) return '';
        var tag = node.tagName ? node.tagName.toLowerCase() : '';
        var text = '';
        if (node.nodeType === 3) { var t = node.textContent.trim(); return t ? t + ' ' : ''; }
        if (node.nodeType !== 1) return '';
        var style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return '';
        switch (tag) {
            case 'h1': return '\n# ' + (node.innerText || '').trim() + '\n\n';
            case 'h2': return '\n## ' + (node.innerText || '').trim() + '\n\n';
            case 'h3': return '\n### ' + (node.innerText || '').trim() + '\n\n';
            case 'h4': return '\n#### ' + (node.innerText || '').trim() + '\n\n';
            case 'h5': return '\n##### ' + (node.innerText || '').trim() + '\n\n';
            case 'h6': return '\n###### ' + (node.innerText || '').trim() + '\n\n';
            case 'p': return (node.innerText || '').trim() + '\n\n';
            case 'br': return '\n';
            case 'hr': return '\n---\n\n';
            case 'strong': case 'b': return '**' + (node.innerText || '').trim() + '**';
            case 'em': case 'i': return '*' + (node.innerText || '').trim() + '*';
            case 'code': return '`' + (node.innerText || '').trim() + '`';
            case 'pre': return '\n```\n' + (node.innerText || '').trim() + '\n```\n\n';
            case 'blockquote': return '> ' + (node.innerText || '').trim().replace(/\n/g, '\n> ') + '\n\n';
            case 'a':
                var href = node.getAttribute('href') || '';
                var linkText = (node.innerText || '').trim();
                if (!linkText || !href) return '';
                if (href.startsWith('javascript:')) return linkText;
                if (!href.startsWith('http')) href = new URL(href, window.location.href).href;
                return '[' + linkText + '](' + href + ')';
            case 'img':
                var alt = node.getAttribute('alt') || '';
                var src = node.getAttribute('src') || '';
                if (!src) return '';
                if (!src.startsWith('http')) src = new URL(src, window.location.href).href;
                return '![' + alt + '](' + src + ')';
            case 'li': return '- ' + (node.innerText || '').trim() + '\n';
            case 'ul': case 'ol':
                var items = '';
                for (var i = 0; i < node.children.length; i++) items += nodeToMarkdown(node.children[i], depth + 1);
                return items + '\n';
            case 'table':
                var md = '\n'; var rows = node.querySelectorAll('tr');
                for (var r = 0; r < rows.length; r++) {
                    var cells = rows[r].querySelectorAll('td, th');
                    var rowText = [];
                    for (var c = 0; c < cells.length; c++) rowText.push((cells[c].innerText || '').trim());
                    md += '| ' + rowText.join(' | ') + ' |\n';
                    if (r === 0) md += '|' + rowText.map(function() { return '---'; }).join('|') + '|\n';
                }
                return md + '\n';
            case 'input':
                var inputType = node.getAttribute('type') || 'text';
                var inputName = node.getAttribute('name') || node.getAttribute('placeholder') || '';
                return '[INPUT: ' + inputType + ' ' + inputName + '] ';
            case 'button': return '[BUTTON: ' + (node.innerText || '').trim() + '] ';
            case 'select': return '[SELECT: ' + (node.getAttribute('name') || '') + '] ';
            case 'textarea': return '[TEXTAREA: ' + (node.getAttribute('name') || node.getAttribute('placeholder') || '') + '] ';
            case 'script': case 'style': case 'noscript': case 'svg': return '';
            default:
                var inner = '';
                for (var i = 0; i < node.childNodes.length; i++) inner += nodeToMarkdown(node.childNodes[i], depth + 1);
                return inner;
        }
    }
    var content = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
    var md = nodeToMarkdown(content, 0);
    return md.substring(0, maxLength);
}
"""

JS_EXTRACT_LINKS = r"""
() => {
    var links = [];
    var all = document.querySelectorAll('a[href]');
    for (var i = 0; i < all.length; i++) {
        links.push({ href: all[i].getAttribute('href') || '', text: (all[i].innerText || '').trim().substring(0, 100) });
    }
    return links;
}
"""

JS_EXTRACT_METADATA = r"""
() => {
    var meta = {};
    var m = document.querySelectorAll('meta');
    for (var i = 0; i < m.length; i++) {
        var name = m[i].getAttribute('name') || m[i].getAttribute('property') || '';
        var content = m[i].getAttribute('content') || '';
        if (name && content) meta[name] = content.substring(0, 500);
    }
    meta['_title'] = document.title || '';
    var canon = document.querySelector('link[rel=canonical]');
    meta['_canonical'] = canon ? canon.href : '';
    meta['_url'] = window.location.href;
    return meta;
}
"""

JS_EXTRACT_ARTICLE = r"""
() => {
    var candidates = [
        document.querySelector('article'),
        document.querySelector('main'),
        document.querySelector('[role="main"]'),
        document.querySelector('.content, .post-content, .article-content, .entry-content')
    ].filter(Boolean);
    if (candidates.length) return candidates[0].innerText.substring(0, 10000);
    var ps = document.querySelectorAll('p');
    var text = '';
    for (var i = 0; i < ps.length && text.length < 10000; i++) text += ps[i].innerText + '\n';
    return text;
}
"""


# ── Burchi Browser ────────────────────────────────────────────────────────────

class BurchiBrowser:
    """Semantic browser powered by Playwright + Nyx engine."""

    def __init__(self, viewport_width: int = 1440, viewport_height: int = 1200, timeout: int = 20):
        self._embedder = SemanticEmbedder()
        self._elements: List[BurchiElement] = []
        self._embeddings: List[np.ndarray] = []
        self._max_elements = 2000
        self._default_timeout = float(timeout)
        self._vw = viewport_width
        self._vh = viewport_height
        self._page = None
        self._playwright = None
        self._browser = None

    async def _ensure_browser(self):
        if self._page is not None:
            return
        from playwright.async_api import async_playwright
        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(headless=True)
        self._page = await self._browser.new_page(
            viewport={"width": self._vw, "height": self._vh},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        )

    async def close(self):
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
        self._page = None
        self._browser = None
        self._playwright = None

    # ── Navigation ─────────────────────────────────────────────────────────────

    async def goto(self, url: str, timeout: Optional[float] = None) -> bool:
        await self._ensure_browser()
        to = timeout or self._default_timeout
        try:
            await self._page.goto(url, wait_until="domcontentloaded", timeout=int(to * 1000))
            await self._page.wait_for_load_state("networkidle", timeout=int(to * 1000))
            return True
        except Exception:
            try:
                await self._page.wait_for_load_state("domcontentloaded", timeout=5000)
                return True
            except Exception:
                return False

    @property
    def url(self) -> str:
        return self._page.url if self._page else ""

    @property
    def title(self) -> str:
        return self._page.title() if self._page else ""

    async def wait(self, seconds: float) -> None:
        await self._page.wait_for_timeout(int(seconds * 1000))

    async def scroll_down(self) -> None:
        await self._page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await self.wait(1.0)

    async def scroll_up(self) -> None:
        await self._page.evaluate("window.scrollTo(0, 0)")
        await self.wait(0.5)

    # ── DOM Extraction & Index ─────────────────────────────────────────────────

    async def _extract_dom(self) -> List[BurchiElement]:
        await self._ensure_browser()
        try:
            raw = await self._page.evaluate(JS_EXTRACT_DOM)
        except Exception:
            return []
        if not raw:
            return []
        result = []
        for item in raw:
            result.append(BurchiElement(
                index=item.get("index", 0),
                tag=item.get("tag", ""),
                text=item.get("text", ""),
                depth=item.get("depth", 0),
                sibling_index=item.get("siblingIndex", 0),
                child_count=item.get("childCount", 0),
                x=item.get("x", 0),
                y=item.get("y", 0),
                width=item.get("width", 0),
                height=item.get("height", 0),
                attrs=item.get("attrs", {}),
                parent_tags=item.get("parentTags", []),
                ancestor_text=item.get("ancestorText", ""),
                is_visible=item.get("isVisible", True),
                xpath=item.get("xpath", ""),
            ))
        return result

    async def _extract_a11y(self) -> List[A11yNode]:
        await self._ensure_browser()
        try:
            raw = await self._page.evaluate(JS_EXTRACT_A11Y)
        except Exception:
            return []
        if not raw:
            return []
        result = []
        for item in raw:
            result.append(A11yNode(
                role=item.get("role", ""),
                name=item.get("name", ""),
                description=item.get("description", ""),
                tag=item.get("tag", ""),
                x=item.get("x", 0),
                y=item.get("y", 0),
                width=item.get("width", 0),
                height=item.get("height", 0),
                is_interactive=item.get("isInteractive", False),
                state_disabled=item.get("disabled", False),
                state_checked=item.get("checked"),
                xpath=item.get("xpath", ""),
                index=item.get("index", 0),
            ))
        return result

    async def build_index(self) -> None:
        self._elements = await self._extract_dom()
        if not self._elements:
            return
        self._embedder.build_corpus(self._elements)
        self._embeddings = [self._embedder.embed(el) for el in self._elements]

    async def build_index_from_a11y(self) -> None:
        nodes = await self._extract_a11y()
        if not nodes:
            await self.build_index()
            return
        self._elements = [
            BurchiElement(
                index=n.index, tag=n.tag, text=n.name, depth=0, sibling_index=0,
                child_count=0, x=n.x, y=n.y, width=n.width, height=n.height,
                attrs={"role": n.role, "aria-label": n.name, "aria-description": n.description},
                parent_tags=[], ancestor_text="", is_visible=not n.state_disabled, xpath=n.xpath,
            )
            for n in nodes
        ]
        self._embedder.build_corpus(self._elements)
        self._embeddings = [self._embedder.embed(el) for el in self._elements]

    # ── Semantic Find (core) ───────────────────────────────────────────────────

    async def find(self, intent: str, top_k: int = 5) -> List[BurchiMatch]:
        if not self._embeddings:
            return []
        query_vec = self._embedder.embed_intent(intent)
        lower_intent = intent.lower()
        wants_content = any(w in lower_intent for w in ("name", "text", "title", "heading", "review", "description", "profile"))
        wants_input = any(w in lower_intent for w in ("input", "field", "search", "form", "password", "email"))
        wants_click = any(w in lower_intent for w in ("click", "submit", "button", "sign in", "login", "register", "toggle", "press"))
        query_tokens = self._embedder.tfidf.tokenize(intent)
        intent_words = [w for w in query_tokens if w not in ("find", "the", "click", "locate", "show")]

        scored: List[Tuple[int, float]] = []
        for i, emb in enumerate(self._embeddings):
            sim = nyx_cosine_similarity(query_vec, emb)
            el = self._elements[i]
            el_text_lower = el.text.lower().strip()

            for word in intent_words:
                if el_text_lower == word:
                    sim *= 3.0
                    break
                if el_text_lower and re.search(r"\b" + re.escape(word) + r"\b", el_text_lower):
                    sim *= 1.8
                    break
            if not el_text_lower:
                attr_text = " ".join(el.attrs.values()).lower()
                for word in intent_words:
                    if re.search(r"\b" + re.escape(word) + r"\b", attr_text):
                        sim *= 1.5
                        break

            if "button" in lower_intent and el.tag == "button":
                sim *= 1.5
            if "link" in lower_intent and el.tag == "a":
                sim *= 1.3
            if wants_click and el.tag == "button":
                sim *= 2.0
            if wants_click and el.tag == "input":
                input_type = el.attrs.get("type", "text")
                if input_type in ("submit", "button"):
                    sim *= 2.0
                if input_type in ("text", "password", "email"):
                    sim *= 0.3
            if wants_click and el.tag == "a":
                sim *= 1.5
            if wants_click and el.tag in ("div", "main", "section", "article", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6"):
                sim *= 0.5
            if wants_content and el.text:
                sim *= 1.15
            if wants_content and not el.text and el.child_count > 2:
                sim *= 0.7
            if wants_input and el.tag in ("input", "textarea", "select"):
                sim *= 2.5
            if wants_input and el.tag not in ("input", "textarea", "select", "form"):
                sim *= 0.5
            if wants_input and el.tag == "input":
                input_type = el.attrs.get("type", "text")
                if "password" in lower_intent and input_type == "password":
                    sim *= 3.0
                if "email" in lower_intent and input_type in ("email", "text"):
                    sim *= 2.0
                if input_type == "hidden":
                    sim *= 0.1
                if input_type == "submit" and not wants_click:
                    sim *= 0.3
                if input_type == "button" and not wants_click:
                    sim *= 0.3
                if input_type == "checkbox" and "checkbox" not in lower_intent and "toggle" not in lower_intent:
                    sim *= 0.3
                if input_type == "radio" and "radio" not in lower_intent:
                    sim *= 0.3
            if wants_content and el.child_count == 0 and el.text:
                sim *= 1.05
            if el.text:
                sim *= 1.15
            if not el.text and el.child_count > 3:
                sim *= 0.7
            if el.tag in ("input", "textarea", "select"):
                sim *= 1.25
            if el.child_count == 0 and el.text:
                sim *= 1.05
            if el.tag in ("html", "body"):
                sim *= 0.3
            if el.attrs.get("role") == "alert" or "route-announcer" in el.attrs.get("id", ""):
                sim *= 0.1
            if el.tag in NON_INTERACTIVE_TAGS:
                sim *= 0.05
            if wants_click and el.tag in NON_INTERACTIVE_TAGS:
                sim *= 0.01
            if wants_input and el.tag in NON_INTERACTIVE_TAGS:
                sim *= 0.01
            if el.width == 0 and el.height == 0 and el.tag not in ("input", "textarea", "select"):
                sim *= 0.1
            if not el.is_visible and el.tag not in ("input", "textarea"):
                sim *= 0.2
            scored.append((i, min(sim, 1.0)))

        scored.sort(key=lambda x: x[1], reverse=True)

        matches = []
        for rank, (idx, score) in enumerate(scored[:top_k]):
            el = self._elements[idx]
            q_tokens = set(self._embedder.tfidf.tokenize(intent))
            el_tokens = set(self._embedder.tfidf.tokenize(f"{el.text} {' '.join(el.attrs.values())}"))
            matches.append(BurchiMatch(
                element=el, score=score, rank=rank + 1,
                matched_terms=list(q_tokens & el_tokens),
            ))
        return matches

    # ── Interactions ───────────────────────────────────────────────────────────

    async def click(self, intent: str) -> bool:
        matches = await self.find(intent, top_k=1)
        if not matches:
            return False
        el = matches[0].element
        try:
            href = el.attrs.get("href", "")
            el_id = el.attrs.get("id", "")
            if href:
                await self._page.evaluate(f'document.querySelector(\'[href="{href}"]\').click()')
            elif el_id:
                await self._page.evaluate(f"document.getElementById('{el_id}').click()")
            else:
                escaped = el.text.replace('"', '\\"')
                await self._page.evaluate(f"""
                    () => {{
                        var all = document.querySelectorAll('{el.tag}');
                        for (var i = 0; i < all.length; i++) {{
                            var t = (all[i].innerText || '').trim();
                            if (t === "{escaped}") {{ all[i].click(); return true; }}
                        }}
                        return false;
                    }}
                """)
            return True
        except Exception:
            return False

    async def type_text(self, intent: str, value: str) -> bool:
        matches = await self.find(intent, top_k=1)
        if not matches:
            return False
        el = matches[0].element
        try:
            el_id = el.attrs.get("id", "")
            name = el.attrs.get("name", "")
            tag = el.tag
            cls = "HTMLTextAreaElement" if tag == "textarea" else "HTMLInputElement"
            escaped = value.replace('"', '\\"')
            if el_id:
                await self._page.evaluate(f"""
                    () => {{
                        var el = document.getElementById('{el_id}');
                        var ns = Object.getOwnPropertyDescriptor(window.{cls}.prototype, 'value').set;
                        ns.call(el, "{escaped}");
                        el.dispatchEvent(new Event('input', {{bubbles: true}}));
                        el.dispatchEvent(new Event('change', {{bubbles: true}}));
                        return true;
                    }}
                """)
            elif name:
                await self._page.evaluate(f"""
                    () => {{
                        var el = document.querySelector('[name="{name}"]');
                        var ns = Object.getOwnPropertyDescriptor(window.{cls}.prototype, 'value').set;
                        ns.call(el, "{escaped}");
                        el.dispatchEvent(new Event('input', {{bubbles: true}}));
                        el.dispatchEvent(new Event('change', {{bubbles: true}}));
                        return true;
                    }}
                """)
            else:
                lower_intent = intent.lower()
                await self._page.evaluate(f"""
                    () => {{
                        var inputs = document.querySelectorAll('input, textarea');
                        for (var i = 0; i < inputs.length; i++) {{
                            var p = (inputs[i].placeholder || '').toLowerCase();
                            var a = (inputs[i].getAttribute('aria-label') || '').toLowerCase();
                            if (p.includes("{lower_intent}") || a.includes("{lower_intent}")) {{
                                var ns = Object.getOwnPropertyDescriptor(window.{cls}.prototype, 'value').set;
                                ns.call(inputs[i], "{escaped}");
                                inputs[i].dispatchEvent(new Event('input', {{bubbles: true}}));
                                inputs[i].dispatchEvent(new Event('change', {{bubbles: true}}));
                                return true;
                            }}
                        }}
                        return false;
                    }}
                """)
            return True
        except Exception:
            return False

    async def press_key(self, key: str) -> bool:
        try:
            await self._page.keyboard.press(key)
            return True
        except Exception:
            return False

    async def screenshot(self, path: str) -> bool:
        try:
            await self._page.screenshot(path=path)
            return True
        except Exception:
            return False

    # ── Data Extraction ────────────────────────────────────────────────────────

    async def extract_links(self) -> List[Dict[str, str]]:
        try:
            raw = await self._page.evaluate(JS_EXTRACT_LINKS)
            return raw or []
        except Exception:
            return []

    async def extract_metadata(self) -> Dict[str, str]:
        try:
            raw = await self._page.evaluate(JS_EXTRACT_METADATA)
            return raw or {}
        except Exception:
            return {}

    async def extract_article(self) -> str:
        try:
            return await self._page.evaluate(JS_EXTRACT_ARTICLE) or ""
        except Exception:
            return ""

    async def to_markdown(self, max_length: int = 8000) -> str:
        try:
            raw = await self._page.evaluate(JS_TO_MARKDOWN, max_length)
        except Exception:
            return ""
        title = await self._page.title()
        result = f"# {title}\n\nSource: {self.url}\n\n---\n\n{raw}"
        return result

    # ── LLM Page Digest ────────────────────────────────────────────────────────

    async def digest(self, max_elements: int = 100) -> str:
        a11y = await self._extract_a11y()
        meaningful_roles = {
            "heading", "link", "button", "textbox", "img", "navigation",
            "main", "banner", "contentinfo", "form", "list", "listitem",
            "table", "caption", "figure", "paragraph",
        }
        meaningful = [
            n for n in a11y
            if n.name or n.is_interactive or n.role in meaningful_roles
        ]
        title = await self._page.title()
        lines = [
            f"# Page: {title}",
            f"URL: {self.url}",
            f"Elements: {len(meaningful)} meaningful / {len(a11y)} total",
            "",
        ]
        count = 0
        for node in meaningful:
            if count >= max_elements:
                break
            parts = []
            role_display = f"[{node.role}]" if node.is_interactive else f"[{node.tag}]"
            parts.append(role_display)
            if node.name:
                clean = node.name.replace("\n", " ").strip()
                if len(clean) > 120:
                    parts.append(f'"{clean[:120]}..."')
                else:
                    parts.append(f'"{clean}"')
            if node.state_disabled:
                parts.append("{disabled}")
            if node.state_checked is not None:
                parts.append("{checked}" if node.state_checked else "{unchecked}")
            if node.is_interactive:
                parts.append(f"← {node.ref}")
            lines.append(" ".join(parts))
            count += 1
        return "\n".join(lines)

    # ── Flow Detection ─────────────────────────────────────────────────────────

    async def detect_flow(self) -> str:
        a11y = await self._extract_a11y()
        all_text = " ".join(n.name.lower() for n in a11y)
        if "password" in all_text and ("email" in all_text or "username" in all_text):
            return "login"
        if any(w in all_text for w in ("sign up", "create account", "register")):
            return "registration"
        if any(w in all_text for w in ("checkout", "payment", "credit card", "billing")):
            return "checkout"
        if any(n.role == "searchbox" or (n.tag == "input" and "search" in n.name.lower()) for n in a11y):
            return "search"
        if any(w in all_text for w in ("contact", "message", "send")):
            return "contact"
        if any(n.role == "navigation" for n in a11y):
            return "navigation"
        return "unknown"

    async def get_flows(self) -> List[str]:
        detected = await self.detect_flow()
        flows = []
        if detected != "unknown":
            flows.append(detected)
        a11y = await self._extract_a11y()
        has_search = any(n.role == "searchbox" or n.tag == "input" for n in a11y)
        has_login = any("password" in n.name.lower() for n in a11y)
        has_links = any(n.role == "link" for n in a11y)
        if has_search and "search" not in flows:
            flows.append("search")
        if has_login and "login" not in flows:
            flows.append("login")
        if has_links and "navigation" not in flows:
            flows.append("navigation")
        return flows

    # ── Smart Extract ──────────────────────────────────────────────────────────

    async def smart_extract(self) -> Dict[str, Any]:
        meta = await self.extract_metadata()
        a11y = await self._extract_a11y()
        flow = await self.detect_flow()
        result: Dict[str, Any] = {
            "type": flow,
            "url": self.url,
            "title": await self._page.title(),
        }
        for k in ("og:title", "og:description", "og:image", "description"):
            if k in meta:
                result[k.replace(":", "_")] = meta[k]
        if "_canonical" in meta:
            result["canonical"] = meta["_canonical"]

        headings = [n for n in a11y if n.role == "heading"]
        if headings:
            result["headings"] = [{"level": n.tag, "text": n.name} for n in headings]
        buttons = [n for n in a11y if n.role == "button"]
        if buttons:
            result["buttons"] = [n.name for n in buttons[:10]]
        links = [n for n in a11y if n.role == "link"]
        if links:
            result["links"] = [{"text": n.name, "ref": n.ref} for n in links[:20]]
        inputs = [n for n in a11y if n.role in ("textbox", "searchbox")]
        if inputs:
            result["inputs"] = [{"name": n.name, "ref": n.ref} for n in inputs[:10]]
        images = [n for n in a11y if n.role == "img"]
        if images:
            result["images"] = [{"alt": n.name, "ref": n.ref} for n in images[:10]]

        regions = await self._detect_regions(a11y)
        if regions:
            result["regions"] = [{"region": r[0], "elements": r[1], "preview": r[2]} for r in regions]
        return result

    async def _detect_regions(self, a11y: List[A11yNode]) -> List[Tuple[str, int, str]]:
        groups: Dict[str, List[A11yNode]] = {}
        for node in a11y:
            key = "unknown"
            if node.role == "navigation" or node.tag == "nav":
                key = "navigation"
            elif node.role == "banner" or node.tag == "header":
                key = "header"
            elif node.role == "contentinfo" or node.tag == "footer":
                key = "footer"
            elif node.role == "main" or node.tag == "main":
                key = "main"
            elif node.role == "complementary" or node.tag == "aside":
                key = "sidebar"
            elif node.role == "form":
                key = "form"
            elif node.tag == "article":
                key = "article"
            if key != "unknown":
                groups.setdefault(key, []).append(node)
        result = []
        for key, nodes in groups.items():
            text = " ".join(n.name for n in nodes[:5])[:200]
            result.append((key, len(nodes), text))
        result.sort(key=lambda x: x[1], reverse=True)
        return result

    # ── Ask (structured query) ─────────────────────────────────────────────────

    async def ask(self, question: str) -> Dict[str, Any]:
        q = question.lower()
        await self.build_index()
        response: Dict[str, Any] = {"url": self.url, "title": await self._page.title()}

        if any(w in q for w in ("link", "navigation", "menu")):
            links = await self.extract_links()
            response["links"] = [{"text": l["text"], "href": l["href"]} for l in links[:20]]
        if any(w in q for w in ("form", "input", "field", "login")):
            a11y = await self._extract_a11y()
            inputs = [n for n in a11y if n.is_interactive and n.role in ("textbox", "button", "checkbox", "switch", "searchbox")]
            response["forms"] = [{"ref": n.ref, "role": n.role, "name": n.name, "tag": n.tag} for n in inputs[:15]]
        if any(w in q for w in ("heading", "title", "structure")):
            a11y = await self._extract_a11y()
            headings = [n for n in a11y if n.role == "heading"]
            response["headings"] = [{"level": n.tag, "text": n.name} for n in headings]
        if any(w in q for w in ("image", "photo", "picture")):
            a11y = await self._extract_a11y()
            images = [n for n in a11y if n.role == "img"]
            response["images"] = [{"alt": n.name, "ref": n.ref} for n in images[:20]]
        if any(w in q for w in ("text", "content", "article", "read")):
            response["content"] = (await self.to_markdown(max_length=4000))[:4000]
        if any(w in q for w in ("meta", "seo", "description")):
            response["metadata"] = await self.extract_metadata()
        if any(w in q for w in ("flow", "action", "do")):
            response["detected_flow"] = await self.detect_flow()
            response["available_flows"] = await self.get_flows()
        if any(w in q for w in ("summary", "overview", "what")):
            a11y = await self._extract_a11y()
            response["summary"] = {
                "title": await self._page.title(),
                "url": self.url,
                "element_count": len(a11y),
                "interactive_count": sum(1 for n in a11y if n.is_interactive),
                "headings": sum(1 for n in a11y if n.role == "heading"),
                "links": sum(1 for n in a11y if n.role == "link"),
                "images": sum(1 for n in a11y if n.role == "img"),
                "detected_flow": await self.detect_flow(),
            }
        if len(response) <= 2:
            matches = await self.find(question, top_k=5)
            response["semantic_matches"] = [
                {"rank": m.rank, "score": int(m.score * 100), "tag": m.element.tag, "text": m.element.text[:200], "ref": f"e{m.element.index}"}
                for m in matches
            ]
        return response

    # ── Script Execution ───────────────────────────────────────────────────────

    async def execute_script(self, actions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        results = []
        for item in actions:
            action = (item.get("action") or "").lower()
            intent = item.get("intent") or ""
            value = item.get("value")
            target_url = item.get("url")
            wait_sec = item.get("wait") or 0

            if target_url:
                await self.goto(target_url)
                await self.build_index()

            success = False
            data = ""

            if action == "goto":
                success = await self.goto(intent)
                if wait_sec:
                    await self.wait(wait_sec)
                data = await self._page.title()
                await self.build_index()
            elif action == "find":
                matches = await self.find(intent, top_k=5)
                success = bool(matches)
                data = self._matches_to_json(matches)
            elif action == "click":
                success = await self.click(intent)
                if wait_sec:
                    await self.wait(wait_sec)
                await self.build_index()
                data = self.url
            elif action == "type":
                success = await self.type_text(intent, value or "")
                if wait_sec:
                    await self.wait(wait_sec)
                data = "typed" if success else "failed"
            elif action == "extract":
                data = ""
                matches = await self.find(intent, top_k=1)
                if matches:
                    data = matches[0].element.text
                success = bool(data)
            elif action == "digest":
                if wait_sec:
                    await self.wait(wait_sec)
                data = await self.digest(max_elements=100)
                success = bool(data)
            elif action == "markdown":
                if wait_sec:
                    await self.wait(wait_sec)
                data = await self.to_markdown()
                success = bool(data)
            elif action == "snapshot":
                if wait_sec:
                    await self.wait(wait_sec)
                data = await self._snapshot(intent if intent else None)
                success = bool(data)
            elif action == "screenshot":
                path = value or "screenshot.png"
                success = await self.screenshot(path)
                data = path
            elif action == "links":
                links = await self.extract_links()
                success = bool(links)
                data = json.dumps(links)
            elif action == "metadata":
                meta = await self.extract_metadata()
                success = bool(meta)
                data = json.dumps(meta)
            elif action == "scroll":
                await self.scroll_down()
                success = True
                data = "scrolled"
            elif action == "wait":
                await self.wait(wait_sec if wait_sec > 0 else float(intent) if intent else 1.0)
                success = True
                data = "waited"
            elif action == "press":
                success = await self.press_key(intent)
                data = "pressed" if success else "failed"
            elif action == "a11y":
                nodes = await self._extract_a11y()
                success = bool(nodes)
                data = json.dumps([
                    {"ref": n.ref, "role": n.role, "name": n.name, "tag": n.tag, "interactive": n.is_interactive, "disabled": n.state_disabled}
                    for n in nodes[:50]
                ])
            elif action == "ask":
                data = json.dumps(await self.ask(intent))
                success = bool(data and data != "{}")
            elif action == "smart":
                data = json.dumps(await self.smart_extract())
                success = bool(data and data != "{}")
            else:
                data = f"Unknown action: {action}"

            results.append({"action": action, "success": success, "data": data, "url": self.url})
        return results

    async def _snapshot(self, intent: Optional[str] = None, max_elements: int = 50) -> str:
        if intent:
            matches = await self.find(intent, top_k=max_elements)
            lines = []
            for m in matches:
                el = m.element
                parts = [f"- {el.tag}"]
                if el.text:
                    parts.append(f'"{el.text[:80]}"')
                if el.attrs.get("role"):
                    parts.append(f"[role={el.attrs['role']}]")
                if el.attrs.get("id"):
                    parts.append(f"[id={el.attrs['id']}]")
                parts.append(f"[ref={m.rank}]")
                parts.append(f"({int(m.score * 100)}%)")
                lines.append(" ".join(parts))
            return "\n".join(lines)
        else:
            a11y = await self._extract_a11y()
            filtered = [n for n in a11y if n.is_interactive or n.name]
            lines = []
            for node in filtered[:max_elements]:
                parts = [f"- {node.role}" if node.is_interactive else f"- {node.tag}"]
                if node.name:
                    parts.append(f'"{node.name[:80]}"')
                if node.state_disabled:
                    parts.append("[disabled]")
                if node.state_checked is not None:
                    parts.append("[checked]" if node.state_checked else "[unchecked]")
                parts.append(f"[ref={node.ref}]")
                lines.append(" ".join(parts))
            return "\n".join(lines)

    # ── Batch Crawl ────────────────────────────────────────────────────────────

    async def crawl(self, urls: List[str], timeout: float = 15) -> List[Dict[str, Any]]:
        results = []
        for target_url in urls:
            ok = await self.goto(target_url, timeout=timeout)
            if not ok:
                results.append({"url": target_url, "title": "", "success": False, "error": "Navigation failed"})
                continue
            await self.build_index()
            results.append({
                "url": self.url,
                "title": await self._page.title(),
                "success": True,
                "digest": await self.digest(max_elements=30),
                "links": await self.extract_links(),
                "metadata": await self.extract_metadata(),
            })
        return results

    # ── Recursive Site Crawl ──────────────────────────────────────────────────

    async def crawl_site(self, start_url: str, config: CrawlConfig = CrawlConfig()) -> List[CrawledPage]:
        visited: set = set()
        queue: List[Tuple[str, int]] = [(start_url, 0)]
        results: List[CrawledPage] = []
        content_hashes: set = set()
        base_domain = urlparse(start_url).hostname or ""

        robots_rules = await self._fetch_robots_txt(start_url) if config.respect_robots_txt else {}

        while queue and len(results) < config.max_pages:
            current_url, depth = queue.pop(0)
            normalized = self._normalize_url(current_url)
            if normalized in visited:
                continue
            visited.add(normalized)

            if config.respect_robots_txt and not self._is_allowed_by_robots(current_url, robots_rules):
                continue

            if config.same_domain_only:
                host = urlparse(current_url).hostname or ""
                if host and host != base_domain:
                    continue

            ok = await self.goto(current_url, timeout=config.timeout)
            if not ok:
                results.append(CrawledPage(current_url, "", depth, False, "", [], {}, "", "Navigation failed"))
                continue

            await self.build_index()

            if config.output_format == "digest":
                content = await self.digest(max_elements=100)
            elif config.output_format == "json":
                content = json.dumps(await self.smart_extract())
            else:
                content = await self.to_markdown(max_length=10000)

            chash = self._content_hash(content)
            if chash in content_hashes:
                continue
            content_hashes.add(chash)

            page_links = [l["href"] for l in await self.extract_links()]
            meta = await self.extract_metadata()

            results.append(CrawledPage(
                url=self.url, title=await self._page.title(), depth=depth,
                success=True, content=content, links=page_links,
                metadata=meta, content_hash=chash, error=None,
            ))

            if depth < config.max_depth:
                for link in page_links:
                    absolute = self._resolve_url(link, current_url)
                    if absolute and self._normalize_url(absolute) not in visited:
                        queue.append((absolute, depth + 1))

            if config.delay > 0:
                await self.wait(config.delay)

        return results

    # ── Sitemap Parsing ────────────────────────────────────────────────────────

    async def parse_sitemap(self, site_url: str) -> List[str]:
        await self._ensure_browser()
        urls: List[str] = []
        for sitemap_path in ("/sitemap.xml", "/sitemap_index.xml"):
            sitemap_url = site_url.rstrip("/") + sitemap_path
            try:
                resp = await self._page.goto(sitemap_url, wait_until="domcontentloaded", timeout=10000)
                if resp and resp.status == 200:
                    content = await self._page.content()
                    urls.extend(re.findall(r"<loc>(.*?)</loc>", content, re.IGNORECASE))
                    if urls:
                        break
            except Exception:
                continue
        return urls

    # ── Search Across Pages ────────────────────────────────────────────────────

    def search_pages(self, pages: List[CrawledPage], query: str, top_k: int = 10) -> List[PageSearchResult]:
        query_tokens = set(self._embedder.tfidf.tokenize(query))
        results = []
        for page in pages:
            if not page.success:
                continue
            page_tokens = set(self._embedder.tfidf.tokenize(page.content))
            matched = list(query_tokens & page_tokens)
            if not matched:
                continue
            score = len(matched) / max(len(query_tokens), 1)
            snippet = self._extract_snippet(page.content, matched, 200)
            results.append(PageSearchResult(page.url, page.title, score, snippet, matched))
        results.sort(key=lambda x: x.score, reverse=True)
        return results[:top_k]

    def _extract_snippet(self, content: str, terms: List[str], length: int) -> str:
        lower = content.lower()
        best_pos = 0
        best_score = 0
        window = 100
        for i in range(0, max(len(content) - window, 0), 20):
            w = lower[i:i + window]
            score = sum(1 for t in terms if t in w)
            if score > best_score:
                best_score = score
                best_pos = i
        start = max(0, best_pos - 20)
        end = min(len(content), best_pos + length)
        return content[start:end].strip()

    # ── URL Utilities ──────────────────────────────────────────────────────────

    def _normalize_url(self, url: str) -> str:
        normalized = url.split("#")[0]
        if normalized.endswith("/") and not normalized.endswith("://"):
            normalized = normalized.rstrip("/")
        tracking = {"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"}
        if "?" in normalized:
            base, query = normalized.split("?", 1)
            pairs = [p for p in query.split("&") if p.split("=")[0] not in tracking]
            normalized = base if not pairs else base + "?" + "&".join(pairs)
        return normalized.lower()

    def _resolve_url(self, href: str, base_url: str) -> str:
        if href.startswith(("http://", "https://")):
            return href
        if href.startswith("//"):
            scheme = urlparse(base_url).scheme
            return f"{scheme}:{href}"
        if href.startswith(("javascript:", "mailto:", "tel:")):
            return ""
        return urljoin(base_url, href) if href else ""

    def _content_hash(self, content: str) -> str:
        normalized = content.strip().lower()
        h = 1469598103934665603
        for byte in normalized.encode():
            h ^= byte
            h = (h * 1099511628211) & 0xFFFFFFFFFFFFFFFF
        return format(h, 'x')

    async def _fetch_robots_txt(self, site_url: str) -> Dict[str, List[str]]:
        parsed = urlparse(site_url)
        if not parsed.scheme or not parsed.hostname:
            return {}
        robots_url = f"{parsed.scheme}://{parsed.hostname}/robots.txt"
        rules: Dict[str, List[str]] = {"Allow": [], "Disallow": []}
        await self._ensure_browser()
        try:
            resp = await self._page.goto(robots_url, wait_until="domcontentloaded", timeout=5000)
            if resp and resp.status == 200:
                text = await self._page.inner_text("body")
                in_all = True
                for line in text.split("\n"):
                    line = line.strip()
                    if not line:
                        continue
                    if line.lower().startswith("user-agent:"):
                        ua = line.split(":", 1)[1].strip()
                        in_all = ua == "*"
                        continue
                    if not in_all:
                        continue
                    if line.lower().startswith("allow:"):
                        rules["Allow"].append(line.split(":", 1)[1].strip())
                    elif line.lower().startswith("disallow:"):
                        path = line.split(":", 1)[1].strip()
                        if path:
                            rules["Disallow"].append(path)
        except Exception:
            pass
        return rules

    def _is_allowed_by_robots(self, url: str, rules: Dict[str, List[str]]) -> bool:
        path = urlparse(url).path or "/"
        for disallowed in rules.get("Disallow", []):
            if path.startswith(disallowed) or disallowed in path:
                return False
        return True

    # ── JSON Helpers ───────────────────────────────────────────────────────────

    def _matches_to_json(self, matches: List[BurchiMatch]) -> str:
        arr = []
        for m in matches:
            el = m.element
            arr.append({
                "rank": m.rank,
                "score": int(m.score * 100),
                "tag": el.tag,
                "text": el.text[:200],
                "attrs": el.attrs,
                "matchedTerms": m.matched_terms,
                "xpath": el.xpath,
                "position": {"x": int(el.x), "y": int(el.y), "w": int(el.width), "h": int(el.height)},
            })
        return json.dumps(arr, indent=2)
