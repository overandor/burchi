"""BurchiLite — Serverless semantic browser (no Playwright needed)

Uses requests + BeautifulSoup instead of headless Chromium.
Same Nyx TF-IDF + cosine similarity engine. Works on serverless platforms.
"""

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import numpy as np
import requests
from bs4 import BeautifulSoup, Tag

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

        vec = np.zeros(self.tfidf.vocab_size + 6, dtype=np.float64)
        vec[: self.tfidf.vocab_size] = (
            W_TEXT * text_vec + W_ATTR * attr_vec + W_CONTEXT * ctx_vec
        )

        off = self.tfidf.vocab_size
        tag_w = TAG_WEIGHTS.get(element.tag, 1.0)
        vec[off] = W_TAG * tag_w
        vec[off + 1] = W_DEPTH * (1.0 - min(element.depth / 20.0, 1.0))
        vec[off + 2] = W_VIS if element.is_visible else 0.0
        vec[off + 3] = W_CHILD * (1.0 - min(element.child_count / 20.0, 1.0))
        vec[off + 4] = 1.0 if element.text else 0.0
        vec[off + 5] = 1.0 if element.tag in ("input", "textarea", "select", "button", "a") else 0.0
        return vec

    def embed_intent(self, query: str) -> np.ndarray:
        expanded = self._syn.expand(query, self.tfidf)
        tfidf_vec = self.tfidf.tfidf_vector(" ".join(expanded))
        vec = np.zeros(self.tfidf.vocab_size + 6, dtype=np.float64)
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
        vec[off + 2] = W_VIS
        vec[off + 3] = W_CHILD * 0.7
        vec[off + 4] = 1.0
        vec[off + 5] = 1.0
        return vec


# ── Burchi Lite Browser ───────────────────────────────────────────────────────

class BurchiLite:
    """Semantic browser using requests + BeautifulSoup (no headless browser needed)."""

    def __init__(self, timeout: int = 20):
        self._embedder = SemanticEmbedder()
        self._elements: List[BurchiElement] = []
        self._embeddings: List[np.ndarray] = []
        self._timeout = timeout
        self._soup: Optional[BeautifulSoup] = None
        self._url: str = ""
        self._title: str = ""
        self._session = requests.Session()
        self._session.headers.update({
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        })

    def goto(self, url: str, timeout: Optional[float] = None) -> bool:
        try:
            to = timeout or self._timeout
            resp = self._session.get(url, timeout=to, allow_redirects=True)
            if resp.status_code >= 400:
                return False
            self._url = resp.url
            self._soup = BeautifulSoup(resp.text, "html.parser")
            self._title = self._soup.title.string.strip() if self._soup.title and self._soup.title.string else ""
            return True
        except Exception:
            return False

    @property
    def url(self) -> str:
        return self._url

    @property
    def title(self) -> str:
        return self._title

    def close(self):
        self._session.close()

    # ── DOM Extraction ─────────────────────────────────────────────────────────

    def _extract_dom(self) -> List[BurchiElement]:
        if not self._soup:
            return []
        result = []
        idx = 0
        for el in self._soup.find_all(True):
            if idx >= 2000:
                break
            tag = el.name.lower()
            if tag in NON_INTERACTIVE_TAGS:
                continue

            text = el.get_text(strip=True)[:200]
            depth = 0
            parent = el.parent
            parent_tags = []
            ancestor_text = ""
            while parent and depth < 15:
                if parent.name:
                    parent_tags.append(parent.name.lower())
                    p_text = parent.get_text(strip=True)
                    if len(ancestor_text) < 300:
                        ancestor_text += " " + p_text[:100]
                parent = parent.parent
                depth += 1

            sibling_index = 0
            sib = el.previous_sibling
            while sib:
                if isinstance(sib, Tag):
                    sibling_index += 1
                sib = sib.previous_sibling

            child_count = len([c for c in el.children if isinstance(c, Tag)])

            attr_names = ["type", "role", "aria-label", "placeholder", "name", "id",
                          "href", "class", "value", "title", "alt", "for", "action", "data-testid"]
            attrs = {}
            for an in attr_names:
                val = el.get(an)
                if val:
                    attrs[an] = str(val)[:200]

            # Build xpath
            xpath_parts = []
            node = el
            while node and node.name:
                sib_idx = 1
                s = node.previous_sibling
                while s:
                    if isinstance(s, Tag) and s.name == node.name:
                        sib_idx += 1
                    s = s.previous_sibling
                xpath_parts.insert(0, f"{node.name.lower()}[{sib_idx}]")
                node = node.parent
            xpath = "/" + "/".join(xpath_parts) if xpath_parts else ""

            result.append(BurchiElement(
                index=idx, tag=tag, text=text, depth=depth,
                sibling_index=sibling_index, child_count=child_count,
                x=0, y=0, width=0, height=0,
                attrs=attrs, parent_tags=parent_tags,
                ancestor_text=ancestor_text[:500],
                is_visible=True, xpath=xpath,
            ))
            idx += 1
        return result

    def _extract_a11y(self) -> List[Dict[str, Any]]:
        if not self._soup:
            return []
        result = []
        idx = 0
        implicit_roles = {
            "a": "link", "button": "button", "input": "textbox",
            "textarea": "textbox", "select": "listbox", "img": "img",
            "h1": "heading", "h2": "heading", "h3": "heading",
            "h4": "heading", "h5": "heading", "h6": "heading",
            "nav": "navigation", "main": "main", "header": "banner",
            "footer": "contentinfo", "form": "form", "label": "label",
            "ul": "list", "ol": "list", "li": "listitem", "table": "table",
        }
        for el in self._soup.find_all(True):
            if idx >= 2000:
                break
            tag = el.name.lower()
            if tag in NON_INTERACTIVE_TAGS:
                continue

            role = el.get("role", "")
            if not role:
                role = implicit_roles.get(tag, "")
            if not role:
                continue

            name = el.get("aria-label", "")
            if not name:
                name = el.get_text(strip=True)[:200]
            if not name:
                name = el.get("placeholder", "")
            if not name:
                name = el.get("title", "")
            if not name:
                name = el.get("alt", "")

            disabled = el.has_attr("disabled") or el.get("aria-disabled") == "true"
            interactive = role in ("button", "link", "textbox", "checkbox", "radio",
                                   "slider", "tab", "menuitem", "option", "searchbox",
                                   "switch", "combobox", "spinbutton")

            result.append({
                "role": role, "name": name[:200], "tag": tag,
                "isInteractive": interactive, "disabled": disabled,
                "index": idx, "ref": f"e{idx}",
            })
            idx += 1
        return result

    def build_index(self) -> None:
        self._elements = self._extract_dom()
        if not self._elements:
            return
        self._embedder.build_corpus(self._elements)
        self._embeddings = [self._embedder.embed(el) for el in self._elements]

    # ── Semantic Find ──────────────────────────────────────────────────────────

    def find(self, intent: str, top_k: int = 5) -> List[BurchiMatch]:
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
            if el.tag in NON_INTERACTIVE_TAGS:
                sim *= 0.05
            if wants_click and el.tag in NON_INTERACTIVE_TAGS:
                sim *= 0.01
            if wants_input and el.tag in NON_INTERACTIVE_TAGS:
                sim *= 0.01
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

    # ── Markdown ───────────────────────────────────────────────────────────────

    def to_markdown(self, max_length: int = 8000) -> str:
        if not self._soup:
            return ""
        content = self._soup.find("article") or self._soup.find("main") or self._soup.find(attrs={"role": "main"}) or self._soup.body or self._soup
        md = self._node_to_markdown(content)
        result = f"# {self._title}\n\nSource: {self._url}\n\n---\n\n{md}"
        return result[:max_length]

    def _node_to_markdown(self, node, depth: int = 0) -> str:
        if depth > 10 or not node:
            return ""
        if isinstance(node, str):
            t = node.strip()
            return t + " " if t else ""

        if not isinstance(node, Tag):
            return ""

        tag = node.name.lower()
        if tag in ("script", "style", "noscript", "svg"):
            return ""

        text = node.get_text(strip=True)

        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            level = int(tag[1])
            return f"\n{'#' * level} {text}\n\n"
        if tag == "p":
            return text + "\n\n"
        if tag == "br":
            return "\n"
        if tag == "hr":
            return "\n---\n\n"
        if tag in ("strong", "b"):
            return f"**{text}**"
        if tag in ("em", "i"):
            return f"*{text}*"
        if tag == "code":
            return f"`{text}`"
        if tag == "pre":
            return f"\n```\n{text}\n```\n\n"
        if tag == "blockquote":
            return "> " + text.replace("\n", "\n> ") + "\n\n"
        if tag == "a":
            href = node.get("href", "")
            link_text = text
            if not link_text or not href:
                return ""
            if href.startswith("javascript:"):
                return link_text
            if not href.startswith("http"):
                href = urljoin(self._url, href)
            return f"[{link_text}]({href})"
        if tag == "img":
            alt = node.get("alt", "")
            src = node.get("src", "")
            if not src:
                return ""
            if not src.startswith("http"):
                src = urljoin(self._url, src)
            return f"![{alt}]({src})"
        if tag == "li":
            return f"- {text}\n"
        if tag in ("ul", "ol"):
            items = ""
            for child in node.find_all("li", recursive=False):
                items += self._node_to_markdown(child, depth + 1)
            return items + "\n"
        if tag == "table":
            md = "\n"
            rows = node.find_all("tr")
            for r, row in enumerate(rows):
                cells = row.find_all(["td", "th"])
                row_text = [c.get_text(strip=True) for c in cells]
                md += "| " + " | ".join(row_text) + " |\n"
                if r == 0:
                    md += "|" + "|".join(["---"] * len(row_text)) + "|\n"
            return md + "\n"
        if tag == "input":
            input_type = node.get("type", "text")
            input_name = node.get("name", "") or node.get("placeholder", "")
            return f"[INPUT: {input_type} {input_name}] "
        if tag == "button":
            return f"[BUTTON: {text}] "
        if tag == "select":
            return f"[SELECT: {node.get('name', '')}] "
        if tag == "textarea":
            return f"[TEXTAREA: {node.get('name', '') or node.get('placeholder', '')}] "

        inner = ""
        for child in node.children:
            inner += self._node_to_markdown(child, depth + 1)
        return inner

    # ── Digest ─────────────────────────────────────────────────────────────────

    def digest(self, max_elements: int = 100) -> str:
        a11y = self._extract_a11y()
        meaningful_roles = {"heading", "link", "button", "textbox", "img", "navigation",
                           "main", "banner", "contentinfo", "form", "list", "listitem",
                           "table", "caption", "figure", "paragraph"}
        meaningful = [n for n in a11y if n["name"] or n["isInteractive"] or n["role"] in meaningful_roles]
        lines = [
            f"# Page: {self._title}",
            f"URL: {self._url}",
            f"Elements: {len(meaningful)} meaningful / {len(a11y)} total",
            "",
        ]
        count = 0
        for node in meaningful:
            if count >= max_elements:
                break
            parts = []
            role_display = f"[{node['role']}]" if node["isInteractive"] else f"[{node['tag']}]"
            parts.append(role_display)
            if node["name"]:
                clean = node["name"].replace("\n", " ").strip()
                if len(clean) > 120:
                    parts.append(f'"{clean[:120]}..."')
                else:
                    parts.append(f'"{clean}"')
            if node["disabled"]:
                parts.append("{disabled}")
            if node["isInteractive"]:
                parts.append(f"← {node['ref']}")
            lines.append(" ".join(parts))
            count += 1
        return "\n".join(lines)

    # ── Links ──────────────────────────────────────────────────────────────────

    def extract_links(self) -> List[Dict[str, str]]:
        if not self._soup:
            return []
        result = []
        for a in self._soup.find_all("a", href=True):
            href = a["href"]
            text = a.get_text(strip=True)[:100]
            if not href.startswith("javascript:"):
                result.append({"href": href, "text": text})
        return result

    # ── Metadata ───────────────────────────────────────────────────────────────

    def extract_metadata(self) -> Dict[str, str]:
        if not self._soup:
            return {}
        meta = {}
        for tag in self._soup.find_all("meta"):
            name = tag.get("name") or tag.get("property") or ""
            content = tag.get("content") or ""
            if name and content:
                meta[name] = content[:500]
        meta["_title"] = self._title
        canon = self._soup.find("link", rel="canonical")
        meta["_canonical"] = canon["href"] if canon and canon.get("href") else ""
        meta["_url"] = self._url
        return meta

    # ── Smart Extract ──────────────────────────────────────────────────────────

    def smart_extract(self) -> Dict[str, Any]:
        a11y = self._extract_a11y()
        meta = self.extract_metadata()
        flow = self._detect_flow(a11y)
        result: Dict[str, Any] = {"type": flow, "url": self._url, "title": self._title}
        for k in ("og:title", "og:description", "og:image", "description"):
            if k in meta:
                result[k.replace(":", "_")] = meta[k]
        if "_canonical" in meta:
            result["canonical"] = meta["_canonical"]

        headings = [n for n in a11y if n["role"] == "heading"]
        if headings:
            result["headings"] = [{"level": n["tag"], "text": n["name"]} for n in headings]
        buttons = [n for n in a11y if n["role"] == "button"]
        if buttons:
            result["buttons"] = [n["name"] for n in buttons[:10]]
        links = [n for n in a11y if n["role"] == "link"]
        if links:
            result["links"] = [{"text": n["name"], "ref": n["ref"]} for n in links[:20]]
        inputs = [n for n in a11y if n["role"] in ("textbox", "searchbox")]
        if inputs:
            result["inputs"] = [{"name": n["name"], "ref": n["ref"]} for n in inputs[:10]]
        images = [n for n in a11y if n["role"] == "img"]
        if images:
            result["images"] = [{"alt": n["name"], "ref": n["ref"]} for n in images[:10]]
        return result

    def _detect_flow(self, a11y: List[Dict]) -> str:
        all_text = " ".join(n["name"].lower() for n in a11y)
        if "password" in all_text and ("email" in all_text or "username" in all_text):
            return "login"
        if any(w in all_text for w in ("sign up", "create account", "register")):
            return "registration"
        if any(w in all_text for w in ("checkout", "payment", "credit card", "billing")):
            return "checkout"
        if any(n["role"] == "searchbox" or (n["tag"] == "input" and "search" in n["name"].lower()) for n in a11y):
            return "search"
        if any(w in all_text for w in ("contact", "message", "send")):
            return "contact"
        if any(n["role"] == "navigation" for n in a11y):
            return "navigation"
        return "unknown"

    # ── Ask ────────────────────────────────────────────────────────────────────

    def ask(self, question: str) -> Dict[str, Any]:
        q = question.lower()
        self.build_index()
        response: Dict[str, Any] = {"url": self._url, "title": self._title}

        if any(w in q for w in ("link", "navigation", "menu")):
            response["links"] = self.extract_links()[:20]
        if any(w in q for w in ("form", "input", "field", "login")):
            a11y = self._extract_a11y()
            inputs = [n for n in a11y if n["isInteractive"] and n["role"] in ("textbox", "button", "checkbox", "switch", "searchbox")]
            response["forms"] = [{"ref": n["ref"], "role": n["role"], "name": n["name"], "tag": n["tag"]} for n in inputs[:15]]
        if any(w in q for w in ("heading", "title", "structure")):
            a11y = self._extract_a11y()
            headings = [n for n in a11y if n["role"] == "heading"]
            response["headings"] = [{"level": n["tag"], "text": n["name"]} for n in headings]
        if any(w in q for w in ("image", "photo", "picture")):
            a11y = self._extract_a11y()
            images = [n for n in a11y if n["role"] == "img"]
            response["images"] = [{"alt": n["name"], "ref": n["ref"]} for n in images[:20]]
        if any(w in q for w in ("text", "content", "article", "read")):
            response["content"] = self.to_markdown(max_length=4000)[:4000]
        if any(w in q for w in ("meta", "seo", "description")):
            response["metadata"] = self.extract_metadata()
        if any(w in q for w in ("summary", "overview", "what")):
            a11y = self._extract_a11y()
            response["summary"] = {
                "title": self._title, "url": self._url,
                "element_count": len(a11y),
                "interactive_count": sum(1 for n in a11y if n["isInteractive"]),
                "headings": sum(1 for n in a11y if n["role"] == "heading"),
                "links": sum(1 for n in a11y if n["role"] == "link"),
                "images": sum(1 for n in a11y if n["role"] == "img"),
                "detected_flow": self._detect_flow(a11y),
            }
        if len(response) <= 2:
            matches = self.find(question, top_k=5)
            response["semantic_matches"] = [
                {"rank": m.rank, "score": int(m.score * 100), "tag": m.element.tag,
                 "text": m.element.text[:200], "ref": f"e{m.element.index}"}
                for m in matches
            ]
        return response

    # ── Script Execution ───────────────────────────────────────────────────────

    def execute_script(self, actions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        results = []
        for item in actions:
            action = (item.get("action") or "").lower()
            intent = item.get("intent") or ""
            value = item.get("value")
            target_url = item.get("url")

            if target_url:
                self.goto(target_url)
                self.build_index()

            success = False
            data = ""

            if action == "goto":
                success = self.goto(intent)
                data = self._title
                self.build_index()
            elif action == "find":
                matches = self.find(intent, top_k=5)
                success = bool(matches)
                data = self._matches_to_json(matches)
            elif action == "extract":
                matches = self.find(intent, top_k=1)
                if matches:
                    data = matches[0].element.text
                success = bool(data)
            elif action == "digest":
                data = self.digest(max_elements=100)
                success = bool(data)
            elif action == "markdown":
                data = self.to_markdown()
                success = bool(data)
            elif action == "links":
                links = self.extract_links()
                success = bool(links)
                data = json.dumps(links)
            elif action == "metadata":
                meta = self.extract_metadata()
                success = bool(meta)
                data = json.dumps(meta)
            elif action == "ask":
                data = json.dumps(self.ask(intent))
                success = bool(data and data != "{}")
            elif action == "smart":
                data = json.dumps(self.smart_extract())
                success = bool(data and data != "{}")
            else:
                data = f"Unknown action: {action}"

            results.append({"action": action, "success": success, "data": data, "url": self._url})
        return results

    # ── Site Crawl ─────────────────────────────────────────────────────────────

    def crawl_site(self, start_url: str, max_depth: int = 3, max_pages: int = 50,
                   delay: float = 0.5, output_format: str = "markdown") -> List[Dict[str, Any]]:
        visited: set = set()
        queue: List[Tuple[str, int]] = [(start_url, 0)]
        results: List[Dict[str, Any]] = []
        content_hashes: set = set()
        base_domain = urlparse(start_url).hostname or ""

        while queue and len(results) < max_pages:
            current_url, depth = queue.pop(0)
            normalized = self._normalize_url(current_url)
            if normalized in visited:
                continue
            visited.add(normalized)

            host = urlparse(current_url).hostname or ""
            if host and host != base_domain:
                continue

            ok = self.goto(current_url)
            if not ok:
                results.append({"url": current_url, "title": "", "depth": depth, "success": False, "error": "Navigation failed"})
                continue

            self.build_index()

            if output_format == "digest":
                content = self.digest(max_elements=100)
            elif output_format == "json":
                content = json.dumps(self.smart_extract())
            else:
                content = self.to_markdown(max_length=10000)

            chash = hashlib.sha256(content.strip().lower().encode()).hexdigest()[:16]
            if chash in content_hashes:
                continue
            content_hashes.add(chash)

            page_links = [l["href"] for l in self.extract_links()]

            results.append({
                "url": self._url, "title": self._title, "depth": depth,
                "success": True, "content": content, "links": page_links,
                "metadata": self.extract_metadata(), "content_hash": chash,
            })

            if depth < max_depth:
                for link in page_links:
                    absolute = urljoin(current_url, link)
                    if absolute and not absolute.startswith(("javascript:", "mailto:", "tel:")):
                        n = self._normalize_url(absolute)
                        if n not in visited:
                            queue.append((absolute, depth + 1))

        return results

    # ── Sitemap ────────────────────────────────────────────────────────────────

    def parse_sitemap(self, site_url: str) -> List[str]:
        urls: List[str] = []
        for path in ("/sitemap.xml", "/sitemap_index.xml"):
            sitemap_url = site_url.rstrip("/") + path
            try:
                resp = self._session.get(sitemap_url, timeout=10)
                if resp.status_code == 200:
                    urls.extend(re.findall(r"<loc>(.*?)</loc>", resp.text, re.IGNORECASE))
                    if urls:
                        break
            except Exception:
                continue
        return urls

    # ── Snapshot ───────────────────────────────────────────────────────────────

    def snapshot(self, intent: Optional[str] = None, max_elements: int = 50) -> str:
        if intent:
            matches = self.find(intent, top_k=max_elements)
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
            a11y = self._extract_a11y()
            filtered = [n for n in a11y if n["isInteractive"] or n["name"]]
            lines = []
            for node in filtered[:max_elements]:
                parts = [f"- {node['role']}" if node["isInteractive"] else f"- {node['tag']}"]
                if node["name"]:
                    parts.append(f'"{node["name"][:80]}"')
                if node["disabled"]:
                    parts.append("[disabled]")
                parts.append(f"[ref={node['ref']}]")
                lines.append(" ".join(parts))
            return "\n".join(lines)

    # ── URL Utilities ──────────────────────────────────────────────────────────

    def _normalize_url(self, url: str) -> str:
        normalized = url.split("#")[0]
        if normalized.endswith("/") and not normalized.endswith("://"):
            normalized = normalized.rstrip("/")
        return normalized.lower()

    # ── JSON Helpers ───────────────────────────────────────────────────────────

    def _matches_to_json(self, matches: List[BurchiMatch]) -> str:
        arr = []
        for m in matches:
            el = m.element
            arr.append({
                "rank": m.rank, "score": int(m.score * 100),
                "tag": el.tag, "text": el.text[:200],
                "attrs": el.attrs, "matchedTerms": m.matched_terms,
                "xpath": el.xpath,
            })
        return json.dumps(arr, indent=2)
