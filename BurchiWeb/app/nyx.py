"""Nyx — Semantic Similarity Engine (Python port of Swift Nyx)

Pure NLP math: TF-IDF vectorization, cosine similarity, synonym expansion.
Zero external dependencies beyond numpy. Zero LLM calls.
"""

import math
import re
from typing import List, Dict, Set, Tuple

import numpy as np

STOP_WORDS: Set[str] = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "can", "this", "that", "these",
    "those", "i", "you", "he", "she", "it", "we", "they", "and", "or",
    "but", "in", "on", "at", "to", "for", "of", "with", "by", "from",
    "as", "into", "about", "than", "then", "so", "if", "not", "no",
}

SYNONYMS: Dict[str, List[str]] = {
    "email": ["email", "e-mail", "mail", "contact", "address"],
    "password": ["password", "passwd", "pwd", "passcode", "secret"],
    "name": ["name", "username", "user", "login", "fullname", "first", "last"],
    "phone": ["phone", "telephone", "mobile", "cell", "contact", "number", "tel"],
    "search": ["search", "find", "query", "filter", "lookup"],
    "submit": ["submit", "send", "continue", "next", "go", "login", "sign", "register"],
    "button": ["button", "btn", "submit", "click", "action", "continue"],
    "input": ["input", "field", "textbox", "text", "enter", "type", "form"],
    "address": ["address", "location", "street", "city", "zip", "postal", "region"],
    "price": ["price", "cost", "amount", "total", "fee", "payment", "dollar", "rate"],
    "date": ["date", "time", "day", "month", "year", "calendar", "schedule"],
    "image": ["image", "img", "photo", "picture", "avatar", "thumbnail"],
    "link": ["link", "href", "url", "navigation", "anchor", "redirect"],
    "description": ["description", "detail", "info", "about", "summary", "bio"],
    "review": ["review", "rating", "feedback", "comment", "testimonial", "opinion"],
    "profile": ["profile", "account", "user", "member", "settings"],
    "login": ["login", "signin", "sign in", "authenticate", "log in", "account"],
    "register": ["register", "signup", "sign up", "create", "join", "enroll"],
    "message": ["message", "text", "chat", "comment", "reply", "send"],
    "location": ["location", "city", "state", "country", "area", "region", "address"],
    "availability": ["availability", "available", "online", "status", "active", "now"],
    "toggle": ["toggle", "switch", "checkbox", "enable", "disable", "on", "off"],
    "menu": ["menu", "dropdown", "nav", "navigation", "hamburger", "sidebar"],
    "cart": ["cart", "basket", "shopping", "checkout", "bag"],
    "download": ["download", "save", "export", "file", "attachment"],
    "upload": ["upload", "attach", "file", "browse", "choose"],
    "table": ["table", "grid", "row", "column", "cell", "data"],
    "modal": ["modal", "dialog", "popup", "overlay", "window"],
    "notification": ["notification", "alert", "toast", "message", "banner"],
    "tab": ["tab", "section", "panel", "category", "group"],
}


class NyxTFIDFEngine:
    """TF-IDF vectorizer with vocabulary filtering (minDf >= 2)."""

    def __init__(self):
        self.vocabulary: Dict[str, int] = {}
        self.term_indices: Dict[str, int] = {}
        self.vocab_size: int = 0
        self.total_documents: int = 0

    def tokenize(self, text: str) -> List[str]:
        tokens = re.split(r"[^a-zA-Z0-9]+", text.lower())
        return [t for t in tokens if len(t) > 1 and t not in STOP_WORDS]

    def build_vocabulary(self, documents: List[str]) -> None:
        self.vocabulary = {}
        self.term_indices = {}
        self.vocab_size = 0
        self.total_documents = len(documents)

        for doc in documents:
            terms = set(self.tokenize(doc))
            for term in terms:
                self.vocabulary[term] = self.vocabulary.get(term, 0) + 1

        min_df = max(2, self.total_documents // 50)
        max_df = self.total_documents * 4 // 5
        for term, df in self.vocabulary.items():
            if min_df <= df <= max_df:
                self.term_indices[term] = self.vocab_size
                self.vocab_size += 1

    def tfidf_vector(self, document: str) -> np.ndarray:
        vec = np.zeros(self.vocab_size, dtype=np.float64)
        tokens = self.tokenize(document)
        if not tokens:
            return vec

        tf: Dict[str, int] = {}
        for token in tokens:
            tf[token] = tf.get(token, 0) + 1

        doc_len = float(len(tokens))
        for term, count in tf.items():
            idx = self.term_indices.get(term)
            if idx is None:
                continue
            df = self.vocabulary.get(term, 0)
            tf_val = count / doc_len
            idf_val = math.log(self.total_documents / (df + 1))
            vec[idx] = tf_val * idf_val

        return vec


def nyx_cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    if a.shape != b.shape or a.size == 0:
        return 0.0
    dot = float(np.dot(a, b))
    norm_a = float(np.linalg.norm(a))
    norm_b = float(np.linalg.norm(b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


class NyxSynonymExpander:
    """Expand a query with synonyms for broader semantic matching."""

    def expand(self, query: str, tokenizer: NyxTFIDFEngine) -> List[str]:
        tokens = tokenizer.tokenize(query)
        expanded: List[str] = []
        seen: Set[str] = set()

        for token in tokens:
            if token not in seen:
                expanded.append(token)
                seen.add(token)
            if token in SYNONYMS:
                for syn in SYNONYMS[token]:
                    if syn not in seen:
                        expanded.append(syn)
                        seen.add(syn)
            for key, syns in SYNONYMS.items():
                if key in token or token in key:
                    for syn in syns:
                        if syn not in seen:
                            expanded.append(syn)
                            seen.add(syn)

        return expanded if expanded else tokens
