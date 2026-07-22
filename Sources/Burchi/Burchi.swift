// Burchi — Semantic Browser Automation
//
// The next era of browser automation: find elements by meaning, not selectors.
// Powered by NyxSemantic's TF-IDF + cosine similarity engine.
//
// Key differentiators vs Playwright/Puppeteer/Selenium:
//   1. Zero selectors — natural language intent is the API
//   2. Self-healing — survives page redesigns, class renames, ID removal
//   3. Zero LLM calls — pure math, runs in milliseconds
//   4. Zero external dependencies — pure Swift on Apple WebKit
//   5. Explainable matches — every result shows which terms matched

import Foundation
import WebKit
import AppKit
import Nyx

// MARK: - DOM Element Model

public struct BurchiElement {
    public var index: Int
    public var tag: String
    public var text: String
    public var depth: Int
    public var siblingIndex: Int
    public var childCount: Int
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double
    public var attrs: [String: String]
    public var parentTags: [String]
    public var ancestorText: String
    public var isVisible: Bool
    public var xpath: String

    public init(index: Int = 0, tag: String = "", text: String = "", depth: Int = 0,
                siblingIndex: Int = 0, childCount: Int = 0,
                x: Double = 0, y: Double = 0, width: Double = 0, height: Double = 0,
                attrs: [String: String] = [:], parentTags: [String] = [],
                ancestorText: String = "", isVisible: Bool = true, xpath: String = "") {
        self.index = index; self.tag = tag; self.text = text; self.depth = depth
        self.siblingIndex = siblingIndex; self.childCount = childCount
        self.x = x; self.y = y; self.width = width; self.height = height
        self.attrs = attrs; self.parentTags = parentTags
        self.ancestorText = ancestorText; self.isVisible = isVisible; self.xpath = xpath
    }
}

// MARK: - Match Result

public struct BurchiMatch {
    public let element: BurchiElement
    public let score: Double
    public let rank: Int
    public let matchedTerms: [String]
}

// MARK: - Semantic Embedder (DOM-specific layer over Nyx engine)

final class SemanticEmbedder {
    let tfidf = NyxTFIDFEngine()
    private let synonymExpander = NyxSynonymExpander()
    var elementCount = 0

    static let wText: Double = 3.0
    static let wAttr: Double = 2.0
    static let wContext: Double = 1.0
    static let wTag: Double = 1.5
    static let wDepth: Double = 0.3
    static let wPos: Double = 0.2
    static let wSize: Double = 0.1
    static let wVis: Double = 0.5
    static let wChild: Double = 0.1

    static let tagWeights: [String: Double] = [
        "input": 2.0, "button": 2.0, "a": 1.8, "textarea": 2.0,
        "select": 2.0, "form": 1.5, "label": 1.5, "h1": 1.3,
        "h2": 1.2, "h3": 1.1, "img": 1.2, "title": 0.3,
        "span": 0.8, "div": 0.5, "p": 1.0, "li": 0.9,
    ]

    static let nonInteractiveTags: Set<String> = [
        "title", "style", "script", "head", "meta", "link",
        "noscript", "template", "react-partial", "slot",
    ]

    func buildCorpus(elements: [BurchiElement]) {
        var documents: [String] = []
        for el in elements {
            let attrText = el.attrs.values.joined(separator: " ")
            documents.append("\(el.text) \(attrText) \(el.ancestorText)")
        }
        tfidf.buildVocabulary(documents: documents)
        elementCount = elements.count
    }

    func embed(_ element: BurchiElement) -> [Double] {
        let textVec = tfidf.tfidfVector(element.text)
        let attrVec = tfidf.tfidfVector(element.attrs.values.joined(separator: " "))
        let ctxVec = tfidf.tfidfVector(element.ancestorText)

        var vector = [Double](repeating: 0, count: tfidf.vocabSize + 8)
        for i in 0..<tfidf.vocabSize {
            vector[i] = Self.wText * textVec[i] + Self.wAttr * attrVec[i] + Self.wContext * ctxVec[i]
        }

        let offset = tfidf.vocabSize
        let tagW = Self.tagWeights[element.tag] ?? 1.0
        vector[offset] = Self.wTag * tagW
        vector[offset + 1] = Self.wDepth * (1.0 - min(Double(element.depth) / 20.0, 1.0))
        vector[offset + 2] = Self.wPos * (element.x / 1920.0)
        vector[offset + 3] = Self.wPos * (element.y / 1080.0)
        vector[offset + 4] = Self.wSize * min(element.width / 500.0, 1.0)
        vector[offset + 5] = Self.wSize * min(element.height / 200.0, 1.0)
        vector[offset + 6] = element.isVisible ? Self.wVis : 0
        vector[offset + 7] = Self.wChild * (1.0 - min(Double(element.childCount) / 20.0, 1.0))
        return vector
    }

    func embedIntent(_ query: String) -> [Double] {
        let expanded = expandQuery(query)
        let tfidfVec = tfidf.tfidfVector(expanded.joined(separator: " "))
        var vector = [Double](repeating: 0, count: tfidf.vocabSize + 8)

        for i in 0..<tfidf.vocabSize { vector[i] = Self.wText * tfidfVec[i] }

        let offset = tfidf.vocabSize
        let lq = query.lowercased()
        if lq.contains("input") || lq.contains("field") || lq.contains("textbox") {
            vector[offset] = Self.wTag * 2.0
        } else if lq.contains("button") || lq.contains("submit") || lq.contains("click") {
            vector[offset] = Self.wTag * 2.0
        } else if lq.contains("link") || lq.contains("navigation") {
            vector[offset] = Self.wTag * 1.8
        } else if lq.contains("image") || lq.contains("photo") {
            vector[offset] = Self.wTag * 1.2
        } else if lq.contains("heading") || lq.contains("title") {
            vector[offset] = Self.wTag * 1.3
        } else {
            vector[offset] = Self.wTag * 1.0
        }
        vector[offset + 1] = Self.wDepth * 0.5
        vector[offset + 6] = Self.wVis
        vector[offset + 7] = Self.wChild * 0.7
        return vector
    }

    private func expandQuery(_ query: String) -> [String] {
        return synonymExpander.expand(query, tokenizer: tfidf)
    }
}

// MARK: - Page Snapshot

public struct BurchiSnapshot {
    public let url: String
    public let title: String
    public let elementCount: Int
    public let visibleCount: Int
    public let vocabularySize: Int
    public let embeddingDim: Int
    public let tags: [String]
}

// MARK: - Action Result

public struct BurchiResult {
    public let success: Bool
    public let message: String
    public let url: String
    public let matches: [BurchiMatch]
    public let data: [String: String]
}

// MARK: - Burchi Browser (The main public API)

public final class BurchiBrowser {
    private let webView: WKWebView
    private let embedder: SemanticEmbedder
    private var elements: [BurchiElement] = []
    private var embeddings: [[Double]] = []
    private var maxElements = 2000
    private var defaultTimeout: Double = 20.0

    public init(viewportWidth: Int = 1440, viewportHeight: Int = 1200) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = WKWebsiteDataStore.default()
        self.webView = WKWebView(
            frame: .init(x: 0, y: 0, width: viewportWidth, height: viewportHeight),
            configuration: config
        )
        self.webView.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        self.embedder = SemanticEmbedder()
    }

    // MARK: Navigation

    @discardableResult
    public func goto(_ url: String, timeout: Double? = nil) -> Bool {
        guard let urlObj = URL(string: url) else { return false }
        let to = timeout ?? defaultTimeout
        webView.load(URLRequest(url: urlObj))
        let deadline = Date().addingTimeInterval(to)
        while Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
            if !webView.isLoading { return true }
        }
        return false
    }

    public func url() -> String { webView.url?.absoluteString ?? "" }
    public func title() -> String { webView.title ?? "" }

    public func waitForLoad(_ timeout: Double = 10) {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline && webView.isLoading {
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
    }

    public func wait(_ seconds: Double) {
        RunLoop.current.run(until: Date().addingTimeInterval(seconds))
    }

    public func reload() {
        webView.reload()
        waitForLoad()
    }

    public func goBack() {
        webView.goBack()
        waitForLoad()
    }

    public func goForward() {
        webView.goForward()
        waitForLoad()
    }

    // MARK: DOM Extraction & Index

    public func buildIndex() {
        elements = extractDOM()
        guard !elements.isEmpty else { return }
        embedder.buildCorpus(elements: elements)
        embeddings = elements.map { embedder.embed($0) }
    }

    public func snapshot() -> BurchiSnapshot {
        return BurchiSnapshot(
            url: url(), title: title(),
            elementCount: elements.count,
            visibleCount: elements.filter { $0.isVisible }.count,
            vocabularySize: embedder.tfidf.vocabSize,
            embeddingDim: embeddings.first?.count ?? 0,
            tags: Set(elements.map { $0.tag }).sorted()
        )
    }

    // MARK: Semantic Find (core)

    public func find(_ intent: String, topK: Int = 5) -> [BurchiMatch] {
        guard !embeddings.isEmpty else { return [] }
        let queryVec = embedder.embedIntent(intent)
        let lowerIntent = intent.lowercased()
        let wantsContent = lowerIntent.contains("name") || lowerIntent.contains("text") ||
                           lowerIntent.contains("title") || lowerIntent.contains("heading") ||
                           lowerIntent.contains("review") || lowerIntent.contains("description") ||
                           lowerIntent.contains("profile")
        let wantsInput = lowerIntent.contains("input") || lowerIntent.contains("field") ||
                         lowerIntent.contains("search") || lowerIntent.contains("form") ||
                         lowerIntent.contains("password") || lowerIntent.contains("email")
        let wantsClick = lowerIntent.contains("click") || lowerIntent.contains("submit") ||
                         lowerIntent.contains("button") || lowerIntent.contains("sign in") ||
                         lowerIntent.contains("login") || lowerIntent.contains("register") ||
                         lowerIntent.contains("toggle") || lowerIntent.contains("press")
        let queryTokens = embedder.tfidf.tokenize(intent)
        let intentWords = queryTokens.filter { !["find", "the", "click", "locate", "show"].contains($0) }

        var scored: [(Int, Double)] = []
        for (i, emb) in embeddings.enumerated() {
            var sim = nyxCosineSimilarity(queryVec, emb)
            let el = elements[i]
            let elTextLower = el.text.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)

            for word in intentWords {
                if elTextLower == word { sim *= 3.0; break }
                if !elTextLower.isEmpty {
                    let pattern = "\\b\(word)\\b"
                    if elTextLower.range(of: pattern, options: .regularExpression) != nil { sim *= 1.8; break }
                }
            }
            if elTextLower.isEmpty {
                let attrText = el.attrs.values.joined(separator: " ").lowercased()
                for word in intentWords {
                    let pattern = "\\b\(word)\\b"
                    if attrText.range(of: pattern, options: .regularExpression) != nil { sim *= 1.5; break }
                }
            }
            if lowerIntent.contains("button") && el.tag == "button" { sim *= 1.5 }
            if lowerIntent.contains("link") && el.tag == "a" { sim *= 1.3 }
            if wantsClick && el.tag == "button" { sim *= 2.0 }
            if wantsClick && el.tag == "input" {
                let inputType = el.attrs["type"] ?? "text"
                if inputType == "submit" || inputType == "button" { sim *= 2.0 }
                if inputType == "text" || inputType == "password" || inputType == "email" { sim *= 0.3 }
            }
            if wantsClick && el.tag == "a" { sim *= 1.5 }
            if wantsClick && ["div", "main", "section", "article", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6"].contains(el.tag) { sim *= 0.5 }
            if wantsContent && !el.text.isEmpty { sim *= 1.15 }
            if wantsContent && el.text.isEmpty && el.childCount > 2 { sim *= 0.7 }
            if wantsInput && ["input", "textarea", "select"].contains(el.tag) { sim *= 2.5 }
            if wantsInput && !["input", "textarea", "select", "form"].contains(el.tag) { sim *= 0.5 }
            if wantsInput && el.tag == "input" {
                let inputType = el.attrs["type"] ?? "text"
                if lowerIntent.contains("password") && inputType == "password" { sim *= 3.0 }
                if lowerIntent.contains("email") && (inputType == "email" || inputType == "text") { sim *= 2.0 }
                if inputType == "hidden" { sim *= 0.1 }
                if inputType == "submit" && !wantsClick { sim *= 0.3 }
                if inputType == "button" && !wantsClick { sim *= 0.3 }
                if inputType == "checkbox" && !lowerIntent.contains("checkbox") && !lowerIntent.contains("toggle") { sim *= 0.3 }
                if inputType == "radio" && !lowerIntent.contains("radio") { sim *= 0.3 }
            }
            if wantsContent && el.childCount == 0 && !el.text.isEmpty { sim *= 1.05 }
            if !el.text.isEmpty { sim *= 1.15 }
            if el.text.isEmpty && el.childCount > 3 { sim *= 0.7 }
            if ["input", "textarea", "select"].contains(el.tag) { sim *= 1.25 }
            if el.childCount == 0 && !el.text.isEmpty { sim *= 1.05 }
            if el.tag == "html" || el.tag == "body" { sim *= 0.3 }
            if el.attrs["role"] == "alert" || el.attrs["id"]?.contains("route-announcer") == true { sim *= 0.1 }
            if SemanticEmbedder.nonInteractiveTags.contains(el.tag) { sim *= 0.05 }
            if wantsClick && SemanticEmbedder.nonInteractiveTags.contains(el.tag) { sim *= 0.01 }
            if wantsInput && SemanticEmbedder.nonInteractiveTags.contains(el.tag) { sim *= 0.01 }
            if el.width == 0 && el.height == 0 && el.tag != "input" && el.tag != "textarea" && el.tag != "select" { sim *= 0.1 }
            if !el.isVisible && el.tag != "input" && el.tag != "textarea" { sim *= 0.2 }
            scored.append((i, min(sim, 1.0)))
        }
        scored.sort { $0.1 > $1.1 }

        return scored.prefix(topK).enumerated().map { (rank, pair) in
            let (idx, score) = pair
            let el = elements[idx]
            let qTokens = Set(embedder.tfidf.tokenize(intent))
            let elTokens = Set(embedder.tfidf.tokenize("\(el.text) \(el.attrs.values.joined(separator: " "))"))
            return BurchiMatch(element: el, score: score, rank: rank + 1,
                               matchedTerms: Array(qTokens.intersection(elTokens)))
        }
    }

    // MARK: Interactions

    @discardableResult
    public func click(_ intent: String) -> Bool {
        let matches = find(intent, topK: 1)
        guard let match = matches.first else { return false }
        let el = match.element
        let js: String
        if let href = el.attrs["href"], !href.isEmpty {
            js = "document.querySelector('[href=\"\(href)\"]').click();"
        } else if let id = el.attrs["id"], !id.isEmpty {
            js = "document.getElementById('\(id)').click();"
        } else {
            let escapedText = el.text.replacingOccurrences(of: "\"", with: "\\\"")
            js = """
            (function() {
                var all = document.querySelectorAll('\(el.tag)');
                for (var i = 0; i < all.length; i++) {
                    var t = (all[i].innerText || '').trim();
                    if (t === "\(escapedText)") { all[i].click(); return true; }
                }
                return false;
            })();
            """
        }
        return execJSBool(js)
    }

    @discardableResult
    public func type(_ intent: String, value: String) -> Bool {
        let matches = find(intent, topK: 1)
        guard let match = matches.first else { return false }
        let el = match.element
        let escaped = value.replacingOccurrences(of: "\"", with: "\\\"")
        let js: String
        if let id = el.attrs["id"], !id.isEmpty {
            js = """
            (function() {
                var el = document.getElementById('\(id)');
                var nativeSetter = Object.getOwnPropertyDescriptor(window.\(el.tag == "textarea" ? "HTMLTextAreaElement" : "HTMLInputElement").prototype, 'value').set;
                nativeSetter.call(el, "\(escaped)");
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            })();
            """
        } else if let name = el.attrs["name"], !name.isEmpty {
            js = """
            (function() {
                var el = document.querySelector('[name="\(name)"]');
                var nativeSetter = Object.getOwnPropertyDescriptor(window.\(el.tag == "textarea" ? "HTMLTextAreaElement" : "HTMLInputElement").prototype, 'value').set;
                nativeSetter.call(el, "\(escaped)");
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            })();
            """
        } else {
            js = """
            (function() {
                var inputs = document.querySelectorAll('input, textarea');
                for (var i = 0; i < inputs.length; i++) {
                    var p = (inputs[i].placeholder || '').toLowerCase();
                    var a = (inputs[i].getAttribute('aria-label') || '').toLowerCase();
                    if (p.includes("\(intent.lowercased())") || a.includes("\(intent.lowercased())")) {
                        var nativeSetter = Object.getOwnPropertyDescriptor(window.\(el.tag == "textarea" ? "HTMLTextAreaElement" : "HTMLInputElement").prototype, 'value').set;
                        nativeSetter.call(inputs[i], "\(escaped)");
                        inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
                        inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                }
                return false;
            })();
            """
        }
        return execJSBool(js)
    }

    public func scrollDown() {
        _ = execJS("window.scrollTo(0, document.body.scrollHeight);")
        wait(1.0)
    }

    public func scrollUp() {
        _ = execJS("window.scrollTo(0, 0);")
        wait(0.5)
    }

    public func scrollTo(_ x: Double, _ y: Double) {
        _ = execJS("window.scrollTo(\(x), \(y));")
        wait(0.5)
    }

    @discardableResult
    public func pressKey(_ key: String) -> Bool {
        let js = """
        (function() {
            var ev = new KeyboardEvent('keydown', { key: '\(key)', bubbles: true });
            document.dispatchEvent(ev);
            ev = new KeyboardEvent('keypress', { key: '\(key)', bubbles: true });
            document.dispatchEvent(ev);
            ev = new KeyboardEvent('keyup', { key: '\(key)', bubbles: true });
            document.dispatchEvent(ev);
            return true;
        })();
        """
        return execJSBool(js)
    }

    // MARK: Auth

    public func injectAuth(token: String, cookies: [[String: String]] = []) {
        for cookie in cookies {
            let name = cookie["name"] ?? ""
            let value = cookie["value"] ?? ""
            let domain = cookie["domain"] ?? ""
            let path = cookie["path"] ?? "/"
            _ = execJS("document.cookie = '\(name)=\(value); domain=\(domain); path=\(path); secure; SameSite=None';")
        }
        _ = execJS("localStorage.setItem('accessToken', '\(token)'); localStorage.setItem('token', '\(token)');")
        wait(0.5)
    }

    // MARK: Screenshot

    @discardableResult
    public func screenshot(_ path: String) -> Bool {
        var imageData: Data?
        let timeout = Date().addingTimeInterval(5)
        webView.takeSnapshot(with: WKSnapshotConfiguration()) { snapshot, _ in
            if let s = snapshot { imageData = s.tiffRepresentation }
        }
        while imageData == nil && Date() < timeout {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        guard let tiff = imageData,
              let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else { return false }
        return (try? png.write(to: URL(fileURLWithPath: path))) != nil
    }

    // MARK: Self-Healing Test

    public func selfHealTest(intent: String) -> (beforeScore: Double, afterScore: Double, sameElement: Bool) {
        let before = find(intent, topK: 1)
        guard let b = before.first else { return (0, 0, false) }

        let js = """
        (function() {
            var all = document.querySelectorAll('*');
            for (var i = 0; i < all.length; i++) {
                if (all[i].className) all[i].className = 'redesigned_' + Math.random().toString(36).substr(2, 8);
                if (all[i].id && Math.random() > 0.5) all[i].removeAttribute('id');
            }
            return 'done';
        })();
        """
        _ = execJS(js)
        buildIndex()
        let after = find(intent, topK: 1)
        guard let a = after.first else { return (b.score, 0, false) }
        let same = !b.element.text.isEmpty &&
                   (a.element.text.contains(b.element.text) ||
                    b.element.text.contains(a.element.text) ||
                    a.element.tag == b.element.tag)
        return (b.score, a.score, same)
    }

    // MARK: Data Extraction

    public func extractText(_ intent: String) -> String {
        let matches = find(intent, topK: 1)
        return matches.first?.element.text ?? ""
    }

    public func extractAllText() -> String {
        return execJS("(document.body.innerText || '').substring(0, 5000);") ?? ""
    }

    public func extractLinks() -> [(href: String, text: String)] {
        let js = """
        (function() {
            var links = [];
            var all = document.querySelectorAll('a[href]');
            for (var i = 0; i < all.length; i++) {
                links.push({ href: all[i].getAttribute('href') || '', text: (all[i].innerText || '').trim().substring(0, 100) });
            }
            return JSON.stringify(links);
        })();
        """
        guard let jsonStr = execJS(js),
              let data = jsonStr.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return arr.compactMap { item in
            let href = item["href"] as? String ?? ""
            let text = item["text"] as? String ?? ""
            return (href, text)
        }
    }

    public func extractTable(_ intent: String) -> [[String]] {
        let matches = find(intent, topK: 1)
        guard let match = matches.first else { return [] }
        let el = match.element
        let js = """
        (function() {
            var table = document.querySelector('\(el.tag)');
            if (!table) return '[]';
            var rows = table.querySelectorAll('tr');
            var data = [];
            for (var i = 0; i < rows.length; i++) {
                var cells = rows[i].querySelectorAll('td, th');
                var row = [];
                for (var j = 0; j < cells.length; j++) row.push((cells[j].innerText || '').trim());
                if (row.length) data.push(row);
            }
            return JSON.stringify(data);
        })();
        """
        guard let jsonStr = execJS(js),
              let data = jsonStr.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String]] else { return [] }
        return arr
    }

    // MARK: Batch Operations

    public func fillForm(_ fields: [(intent: String, value: String)]) -> [Bool] {
        return fields.map { type($0.intent, value: $0.value) }
    }

    @discardableResult
    public func login(email: String, password: String) -> Bool {
        let emailOk = type("email", value: email)
        let passOk = type("password", value: password)
        wait(0.5)
        let submitOk = click("submit login sign in")
        wait(3.0)
        return emailOk && passOk && submitOk && !url().contains("login")
    }

    // MARK: Config

    public func setMaxElements(_ max: Int) { maxElements = max }
    public func setTimeout(_ timeout: Double) { defaultTimeout = timeout }

    // MARK: Private: DOM Extraction

    private func extractDOM() -> [BurchiElement] {
        var result: String?
        let timeout = Date().addingTimeInterval(10)

        let js = """
        (function() {
            var elements = [];
            var all = document.querySelectorAll('*');
            for (var i = 0; i < all.length && i < \(maxElements); i++) {
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
            return JSON.stringify(elements);
        })();
        """

        webView.evaluateJavaScript(js) { val, _ in result = val as? String }
        while result == nil && Date() < timeout {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }

        guard let jsonStr = result,
              let data = jsonStr.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }

        return arr.map { item in
            BurchiElement(
                index: (item["index"] as? Int) ?? 0,
                tag: (item["tag"] as? String) ?? "",
                text: (item["text"] as? String) ?? "",
                depth: (item["depth"] as? Int) ?? 0,
                siblingIndex: (item["siblingIndex"] as? Int) ?? 0,
                childCount: (item["childCount"] as? Int) ?? 0,
                x: (item["x"] as? Double) ?? 0,
                y: (item["y"] as? Double) ?? 0,
                width: (item["width"] as? Double) ?? 0,
                height: (item["height"] as? Double) ?? 0,
                attrs: (item["attrs"] as? [String: String]) ?? [:],
                parentTags: (item["parentTags"] as? [String]) ?? [],
                ancestorText: (item["ancestorText"] as? String) ?? "",
                isVisible: (item["isVisible"] as? Bool) ?? true,
                xpath: (item["xpath"] as? String) ?? ""
            )
        }
    }

    // MARK: Private: JS Execution

    @discardableResult
    private func execJS(_ js: String) -> String? {
        var result: String?
        let timeout = Date().addingTimeInterval(10)
        webView.evaluateJavaScript(js) { val, _ in result = val as? String }
        while result == nil && Date() < timeout {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        return result
    }

    private func execJSBool(_ js: String) -> Bool {
        var result: Bool?
        let timeout = Date().addingTimeInterval(5)
        webView.evaluateJavaScript(js) { val, _ in result = (val as? Bool) ?? true }
        while result == nil && Date() < timeout {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
        return result ?? false
    }

    // MARK: - v2: Accessibility Tree Extraction

    public struct A11yNode {
        public let role: String
        public let name: String
        public let description: String
        public let tag: String
        public let x: Double
        public let y: Double
        public let width: Double
        public let height: Double
        public let isInteractive: Bool
        public let stateDisabled: Bool
        public let stateChecked: Bool?
        public let xpath: String
        public var ref: String { "e\(index)" }
        public let index: Int
    }

    public func extractA11yTree() -> [A11yNode] {
        let js = """
        (function() {
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
            return JSON.stringify(nodes);
        })();
        """

        guard let jsonStr = execJS(js),
              let data = jsonStr.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }

        return arr.map { item in
            A11yNode(
                role: (item["role"] as? String) ?? "",
                name: (item["name"] as? String) ?? "",
                description: (item["description"] as? String) ?? "",
                tag: (item["tag"] as? String) ?? "",
                x: (item["x"] as? Double) ?? 0,
                y: (item["y"] as? Double) ?? 0,
                width: (item["width"] as? Double) ?? 0,
                height: (item["height"] as? Double) ?? 0,
                isInteractive: (item["isInteractive"] as? Bool) ?? false,
                stateDisabled: (item["disabled"] as? Bool) ?? false,
                stateChecked: item["checked"] as? Bool,
                xpath: (item["xpath"] as? String) ?? "",
                index: (item["index"] as? Int) ?? 0
            )
        }
    }

    public func buildIndexFromA11y() {
        let nodes = extractA11yTree()
        guard !nodes.isEmpty else { buildIndex(); return }

        elements = nodes.map { node in
            BurchiElement(
                index: node.index,
                tag: node.tag,
                text: node.name,
                depth: 0,
                siblingIndex: 0,
                childCount: 0,
                x: node.x, y: node.y,
                width: node.width, height: node.height,
                attrs: ["role": node.role, "aria-label": node.name, "aria-description": node.description],
                parentTags: [],
                ancestorText: "",
                isVisible: !node.stateDisabled,
                xpath: node.xpath
            )
        }
        embedder.buildCorpus(elements: elements)
        embeddings = elements.map { embedder.embed($0) }
    }

    // MARK: - v2: Intent-Filtered Snapshot

    public func snapshot(intent: String? = nil, maxElements: Int = 50) -> String {
        if let intent = intent {
            let matches = find(intent, topK: maxElements)
            let lines = matches.map { m -> String in
                let el = m.element
                var parts = ["- \(el.tag)"]
                if !el.text.isEmpty { parts.append("\"\(el.text.prefix(80))\"") }
                if let role = el.attrs["role"], !role.isEmpty { parts.append("[role=\(role)]") }
                if let id = el.attrs["id"], !id.isEmpty { parts.append("[id=\(id)]") }
                parts.append("[ref=\(m.rank)]")
                parts.append("(\(Int(m.score * 100))%)")
                return parts.joined(separator: " ")
            }
            return lines.joined(separator: "\n")
        } else {
            let a11y = extractA11yTree()
            let filtered = a11y.filter { $0.isInteractive || !$0.name.isEmpty }
            let lines = filtered.prefix(maxElements).map { node -> String in
                var parts: [String] = []
                if node.isInteractive { parts.append("- \(node.role)") }
                else { parts.append("- \(node.tag)") }
                if !node.name.isEmpty { parts.append("\"\(node.name.prefix(80))\"") }
                if node.stateDisabled { parts.append("[disabled]") }
                if let c = node.stateChecked { parts.append(c ? "[checked]" : "[unchecked]") }
                parts.append("[ref=\(node.ref)]")
                return parts.joined(separator: " ")
            }
            return lines.joined(separator: "\n")
        }
    }

    // MARK: - v2: Page Diff Engine

    private var elementFingerprints: [String: String] = [:]

    public func fingerprintElements() {
        elementFingerprints.removeAll()
        for el in elements {
            let key = el.xpath
            let fp = "\(el.tag):\(el.text):\(el.attrs["role"] ?? ""):\(el.attrs["aria-label"] ?? "")"
            elementFingerprints[key] = fp
        }
    }

    public struct PageDiff {
        public let added: [BurchiElement]
        public let removed: [String]
        public let changed: [BurchiElement]
        public let unchanged: Int
    }

    public func diff() -> PageDiff {
        let oldFingerprints = elementFingerprints
        buildIndex()
        fingerprintElements()

        var added: [BurchiElement] = []
        var changed: [BurchiElement] = []
        var removed: [String] = []
        var unchanged = 0

        for el in elements {
            let key = el.xpath
            let newFp = "\(el.tag):\(el.text):\(el.attrs["role"] ?? ""):\(el.attrs["aria-label"] ?? "")"
            if let oldFp = oldFingerprints[key] {
                if oldFp == newFp { unchanged += 1 }
                else { changed.append(el) }
            } else {
                added.append(el)
            }
        }
        for (key, _) in oldFingerprints {
            if elementFingerprints[key] == nil { removed.append(key) }
        }
        return PageDiff(added: added, removed: removed, changed: changed, unchanged: unchanged)
    }

    // MARK: - v2: Flow Detection

    public enum BurchiFlow: String {
        case login, search, checkout, registration, navigation, contact, unknown
    }

    public func detectFlow() -> BurchiFlow {
        let a11y = extractA11yTree()
        let allText = a11y.map { $0.name.lowercased() }.joined(separator: " ")

        if allText.contains("password") && (allText.contains("email") || allText.contains("username")) {
            return .login
        }
        if allText.contains("sign up") || allText.contains("create account") || allText.contains("register") {
            return .registration
        }
        if allText.contains("checkout") || allText.contains("payment") || allText.contains("credit card") || allText.contains("billing") {
            return .checkout
        }
        if a11y.contains(where: { $0.role == "searchbox" || $0.tag == "input" && $0.name.lowercased().contains("search") }) {
            return .search
        }
        if allText.contains("contact") || allText.contains("message") || allText.contains("send") {
            return .contact
        }
        if a11y.contains(where: { $0.role == "navigation" }) {
            return .navigation
        }
        return .unknown
    }

    public func getFlows() -> [String] {
        let detected = detectFlow()
        var flows: [String] = []
        if detected != .unknown { flows.append(detected.rawValue) }

        let a11y = extractA11yTree()
        let hasSearch = a11y.contains { $0.role == "searchbox" || $0.tag == "input" }
        let hasLogin = a11y.contains { $0.name.lowercased().contains("password") }
        let hasLinks = a11y.contains { $0.role == "link" }

        if hasSearch && !flows.contains("search") { flows.append("search") }
        if hasLogin && !flows.contains("login") { flows.append("login") }
        if hasLinks && !flows.contains("navigation") { flows.append("navigation") }
        return flows
    }

    // MARK: - v2: Execute Flow

    @discardableResult
    public func executeFlow(_ flow: BurchiFlow, params: [String: String] = [:]) -> Bool {
        switch flow {
        case .login:
            guard let email = params["email"], let password = params["password"] else { return false }
            return login(email: email, password: password)
        case .search:
            guard let query = params["query"] else { return false }
            let ok = type("search", value: query)
            pressKey("Enter")
            wait(2.0)
            return ok
        case .contact:
            if let name = params["name"] { _ = type("name", value: name) }
            if let email = params["email"] { _ = type("email", value: email) }
            if let message = params["message"] { _ = type("message", value: message) }
            wait(0.5)
            return click("send submit")
        case .registration:
            if let name = params["name"] { _ = type("name", value: name) }
            if let email = params["email"] { _ = type("email", value: email) }
            if let password = params["password"] { _ = type("password", value: password) }
            wait(0.5)
            return click("sign up register create")
        case .checkout, .navigation, .unknown:
            return false
        }
    }

    // MARK: - v2: Structured Data Extraction

    public func extractMetadata() -> [String: String] {
        let js = """
        (function() {
            var meta = {};
            var m = document.querySelectorAll('meta');
            for (var i = 0; i < m.length; i++) {
                var name = m[i].getAttribute('name') || m[i].getAttribute('property') || '';
                var content = m[i].getAttribute('content') || '';
                if (name && content) meta[name] = content.substring(0, 500);
            }
            meta['_title'] = document.title || '';
            meta['_canonical'] = (document.querySelector('link[rel=canonical]') || {}).href || '';
            meta['_url'] = window.location.href;
            return JSON.stringify(meta);
        })();
        """
        guard let jsonStr = execJS(js),
              let data = jsonStr.data(using: .utf8),
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { return [:] }
        return dict
    }

    public func extractJSONLD() -> [[String: Any]] {
        let js = """
        (function() {
            var scripts = document.querySelectorAll('script[type="application/ld+json"]');
            var results = [];
            for (var i = 0; i < scripts.length; i++) {
                try { results.push(JSON.parse(scripts[i].textContent)); } catch(e) {}
            }
            return JSON.stringify(results);
        })();
        """
        guard let jsonStr = execJS(js),
              let data = jsonStr.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return arr
    }

    public func extractArticle() -> String {
        let js = """
        (function() {
            var candidates = [
                document.querySelector('article'),
                document.querySelector('main'),
                document.querySelector('[role="main"]'),
                document.querySelector('.content, .post-content, .article-content, .entry-content')
            ].filter(Boolean);
            if (candidates.length) return candidates[0].innerText.substring(0, 10000);
            var ps = document.querySelectorAll('p');
            var text = '';
            for (var i = 0; i < ps.length && text.length < 10000; i++) {
                text += ps[i].innerText + '\\n';
            }
            return text;
        })();
        """
        return execJS(js) ?? ""
    }

    // MARK: - v2: Action Audit Log

    public struct ActionLog {
        public let action: String
        public let target: String
        public let timestamp: Date
        public let success: Bool
        public let urlBefore: String
        public let urlAfter: String
    }

    private var auditLog: [ActionLog] = []

    public func getAuditLog() -> [ActionLog] { auditLog }

    private func logAction(_ action: String, target: String, success: Bool, urlBefore: String) {
        auditLog.append(ActionLog(
            action: action, target: target,
            timestamp: Date(), success: success,
            urlBefore: urlBefore, urlAfter: url()
        ))
    }

    // MARK: - v2: Domain Safety

    private var allowedDomains: Set<String> = []
    private var blockedDomains: Set<String> = []

    public func allowDomain(_ domain: String) { allowedDomains.insert(domain) }
    public func blockDomain(_ domain: String) { blockedDomains.insert(domain) }

    public func isDomainAllowed(_ url: String) -> Bool {
        guard let host = URL(string: url)?.host else { return true }
        if blockedDomains.contains(host) { return false }
        if allowedDomains.isEmpty { return true }
        return allowedDomains.contains(host)
    }

    // MARK: - v2: JSON Output Helpers

    public func matchesToJSON(_ matches: [BurchiMatch]) -> String {
        let arr: [[String: Any]] = matches.map { m in
            let el = m.element
            return [
                "rank": m.rank,
                "score": Int(m.score * 100),
                "tag": el.tag,
                "text": String(el.text.prefix(200)),
                "attrs": el.attrs,
                "matchedTerms": m.matchedTerms,
                "xpath": el.xpath,
                "position": ["x": Int(el.x), "y": Int(el.y), "w": Int(el.width), "h": Int(el.height)],
            ]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: arr, options: .prettyPrinted),
              let str = String(data: data, encoding: .utf8) else { return "[]" }
        return str
    }

    public func snapshotToJSON() -> String {
        let dict: [String: Any] = [
            "url": url(),
            "title": title(),
            "elements": elements.count,
            "visible": elements.filter { $0.isVisible }.count,
            "vocabulary": embedder.tfidf.vocabSize,
            "embeddingDim": embeddings.first?.count ?? 0,
            "tags": Set(elements.map { $0.tag }).sorted(),
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: dict, options: .prettyPrinted),
              let str = String(data: data, encoding: .utf8) else { return "{}" }
        return str
    }

    // MARK: - v3: LLM Page Digest
    // Clean semantic representation — no divs, no classes, no CSS.
    // Just meaningful elements with roles, text, and interactivity.

    public func digest(maxElements: Int = 100) -> String {
        let a11y = extractA11yTree()
        let meaningful = a11y.filter { node in
            !node.name.isEmpty || node.isInteractive ||
            ["heading", "link", "button", "textbox", "img", "navigation",
             "main", "banner", "contentinfo", "form", "list", "listitem",
             "table", "caption", "figure", "paragraph"].contains(node.role)
        }

        var lines: [String] = []
        lines.append("# Page: \(title())")
        lines.append("URL: \(url())")
        lines.append("Elements: \(meaningful.count) meaningful / \(a11y.count) total")
        lines.append("")

        var count = 0
        for node in meaningful {
            if count >= maxElements { break }
            var parts: [String] = []

            let roleDisplay = node.isInteractive ? "[\(node.role)]" : "[\(node.tag)]"
            parts.append(roleDisplay)

            if !node.name.isEmpty {
                let cleanName = node.name.replacingOccurrences(of: "\n", with: " ")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if cleanName.count > 120 {
                    parts.append("\"\(cleanName.prefix(120))...\"")
                } else {
                    parts.append("\"\(cleanName)\"")
                }
            }

            if node.stateDisabled { parts.append("{disabled}") }
            if let c = node.stateChecked { parts.append(c ? "{checked}" : "{unchecked}") }

            if node.isInteractive {
                parts.append("← \(node.ref)")
            }

            lines.append(parts.joined(separator: " "))
            count += 1
        }

        return lines.joined(separator: "\n")
    }

    // MARK: - v3: Markdown Conversion
    // Convert any web page to clean markdown for LLM consumption.

    public func toMarkdown(maxLength: Int = 8000) -> String {
        let js = """
        (function() {
            function nodeToMarkdown(node, depth) {
                if (!node || depth > 10) return '';
                var tag = node.tagName ? node.tagName.toLowerCase() : '';
                var text = '';

                if (node.nodeType === 3) {
                    var t = node.textContent.trim();
                    return t ? t + ' ' : '';
                }
                if (node.nodeType !== 1) return '';

                var style = window.getComputedStyle(node);
                if (style.display === 'none' || style.visibility === 'hidden') return '';

                switch (tag) {
                    case 'h1': return '\\n# ' + (node.innerText || '').trim() + '\\n\\n';
                    case 'h2': return '\\n## ' + (node.innerText || '').trim() + '\\n\\n';
                    case 'h3': return '\\n### ' + (node.innerText || '').trim() + '\\n\\n';
                    case 'h4': return '\\n#### ' + (node.innerText || '').trim() + '\\n\\n';
                    case 'h5': return '\\n##### ' + (node.innerText || '').trim() + '\\n\\n';
                    case 'h6': return '\\n###### ' + (node.innerText || '').trim() + '\\n\\n';
                    case 'p': return (node.innerText || '').trim() + '\\n\\n';
                    case 'br': return '\\n';
                    case 'hr': return '\\n---\\n\\n';
                    case 'strong': case 'b': return '**' + (node.innerText || '').trim() + '**';
                    case 'em': case 'i': return '*' + (node.innerText || '').trim() + '*';
                    case 'code': return '`' + (node.innerText || '').trim() + '`';
                    case 'pre': return '\\n```\\n' + (node.innerText || '').trim() + '\\n```\\n\\n';
                    case 'blockquote': return '> ' + (node.innerText || '').trim().replace(/\\n/g, '\\n> ') + '\\n\\n';
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
                    case 'li':
                        return '- ' + (node.innerText || '').trim() + '\\n';
                    case 'ul': case 'ol':
                        var items = '';
                        for (var i = 0; i < node.children.length; i++) {
                            items += nodeToMarkdown(node.children[i], depth + 1);
                        }
                        return items + '\\n';
                    case 'table':
                        var md = '\\n';
                        var rows = node.querySelectorAll('tr');
                        for (var r = 0; r < rows.length; r++) {
                            var cells = rows[r].querySelectorAll('td, th');
                            var rowText = [];
                            for (var c = 0; c < cells.length; c++) rowText.push((cells[c].innerText || '').trim());
                            md += '| ' + rowText.join(' | ') + ' |\\n';
                            if (r === 0) {
                                md += '|' + rowText.map(function() { return '---'; }).join('|') + '|\\n';
                            }
                        }
                        return md + '\\n';
                    case 'input':
                        var inputType = node.getAttribute('type') || 'text';
                        var inputName = node.getAttribute('name') || node.getAttribute('placeholder') || '';
                        return '[INPUT: ' + inputType + ' ' + inputName + '] ';
                    case 'button':
                        return '[BUTTON: ' + (node.innerText || '').trim() + '] ';
                    case 'select':
                        return '[SELECT: ' + (node.getAttribute('name') || '') + '] ';
                    case 'textarea':
                        return '[TEXTAREA: ' + (node.getAttribute('name') || node.getAttribute('placeholder') || '') + '] ';
                    case 'script': case 'style': case 'noscript': case 'svg':
                        return '';
                    case 'div': case 'span': case 'section': case 'article':
                    case 'main': case 'header': case 'footer': case 'nav':
                    case 'aside': case 'figure': case 'figcaption':
                        var inner = '';
                        for (var i = 0; i < node.childNodes.length; i++) {
                            inner += nodeToMarkdown(node.childNodes[i], depth + 1);
                        }
                        return inner;
                    default:
                        var defInner = '';
                        for (var i = 0; i < node.childNodes.length; i++) {
                            defInner += nodeToMarkdown(node.childNodes[i], depth + 1);
                        }
                        return defInner;
                }
            }
            var content = document.querySelector('article') || document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
            var md = nodeToMarkdown(content, 0);
            return md.substring(0, \(maxLength));
        })();
        """

        let raw = execJS(js) ?? ""
        let cleaned = raw.replacingOccurrences(of: "\\n", with: "\n")
            .replacingOccurrences(of: "\\\"", with: "\"")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        var result = "# \(title())\n\n"
        result += "Source: \(url())\n\n---\n\n"
        result += cleaned
        return result
    }

    // MARK: - v3: Batch Crawl
    // Visit multiple URLs and return consolidated semantic data.

    public struct CrawlResult {
        public let url: String
        public let title: String
        public let success: Bool
        public let digest: String
        public let links: [(href: String, text: String)]
        public let metadata: [String: String]
        public let error: String?
    }

    public func crawl(_ urls: [String], timeout: Double = 15) -> [CrawlResult] {
        return urls.map { targetUrl in
            let ok = goto(targetUrl, timeout: timeout)
            if !ok {
                return CrawlResult(url: targetUrl, title: "", success: false,
                                   digest: "", links: [], metadata: [:], error: "Navigation failed")
            }
            buildIndex()
            return CrawlResult(
                url: url(),
                title: title(),
                success: true,
                digest: digest(maxElements: 30),
                links: extractLinks(),
                metadata: extractMetadata(),
                error: nil
            )
        }
    }

    public func crawlToJSON(_ urls: [String], timeout: Double = 15) -> String {
        let results = crawl(urls, timeout: timeout)
        let arr: [[String: Any]] = results.map { r in
            var dict: [String: Any] = [
                "url": r.url,
                "title": r.title,
                "success": r.success,
            ]
            if r.success {
                dict["digest"] = r.digest
                dict["links"] = r.links.map { ["href": $0.href, "text": $0.text] }
                dict["metadata"] = r.metadata
            } else {
                dict["error"] = r.error ?? "Unknown error"
            }
            return dict
        }
        guard let data = try? JSONSerialization.data(withJSONObject: arr, options: .prettyPrinted),
              let str = String(data: data, encoding: .utf8) else { return "[]" }
        return str
    }

    // MARK: - v3: Script Execution
    // Execute a JSON script of semantic actions — the LLM API.

    public struct ScriptAction {
        public let action: String
        public let intent: String
        public let value: String?
        public let url: String?
        public let wait: Double?
    }

    public struct ScriptResult {
        public let action: String
        public let success: Bool
        public let data: String
        public let url: String
    }

    public func executeScript(_ json: String) -> [ScriptResult] {
        guard let data = json.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return [ScriptResult(action: "parse", success: false, data: "Invalid JSON script", url: "")]
        }

        var results: [ScriptResult] = []

        for item in arr {
            let action = (item["action"] as? String) ?? ""
            let intent = (item["intent"] as? String) ?? ""
            let value = item["value"] as? String
            let targetUrl = item["url"] as? String
            let waitSec = (item["wait"] as? Double) ?? 0

            if let url = targetUrl, !url.isEmpty {
                _ = goto(url)
                buildIndex()
            }

            var success = false
            var data = ""

            switch action.lowercased() {
            case "goto":
                success = goto(intent)
                data = title()
                buildIndex()
            case "find":
                let matches = find(intent, topK: 5)
                success = !matches.isEmpty
                data = matchesToJSON(matches)
            case "click":
                success = click(intent)
                if waitSec > 0 { wait(waitSec) }
                data = url()
            case "type":
                success = type(intent, value: value ?? "")
                data = success ? "typed" : "failed"
            case "extract":
                data = extractText(intent)
                success = !data.isEmpty
            case "digest":
                data = digest(maxElements: 100)
                success = !data.isEmpty
            case "markdown":
                data = toMarkdown()
                success = !data.isEmpty
            case "snapshot":
                data = snapshot(intent: intent.isEmpty ? nil : intent)
                success = !data.isEmpty
            case "screenshot":
                let path = value ?? "screenshot.png"
                success = screenshot(path)
                data = path
            case "links":
                let links = extractLinks()
                success = !links.isEmpty
                let linkArr: [[String: String]] = links.map { ["href": $0.href, "text": $0.text] }
                if let d = try? JSONSerialization.data(withJSONObject: linkArr, options: .prettyPrinted),
                   let s = String(data: d, encoding: .utf8) { data = s }
            case "metadata":
                let meta = extractMetadata()
                success = !meta.isEmpty
                if let d = try? JSONSerialization.data(withJSONObject: meta, options: .prettyPrinted),
                   let s = String(data: d, encoding: .utf8) { data = s }
            case "scroll":
                scrollDown()
                success = true
                data = "scrolled"
            case "wait":
                wait(waitSec > 0 ? waitSec : Double(intent) ?? 1.0)
                success = true
                data = "waited"
            case "login":
                success = login(email: intent, password: value ?? "")
                data = success ? "logged in" : "login failed"
            case "press":
                success = pressKey(intent)
                data = success ? "pressed" : "failed"
            case "a11y":
                let nodes = extractA11yTree()
                success = !nodes.isEmpty
                let nodeArr: [[String: Any]] = nodes.prefix(50).map { n in
                    return [
                        "ref": n.ref,
                        "role": n.role,
                        "name": n.name,
                        "tag": n.tag,
                        "interactive": n.isInteractive,
                        "disabled": n.stateDisabled,
                    ]
                }
                if let d = try? JSONSerialization.data(withJSONObject: nodeArr, options: .prettyPrinted),
                   let s = String(data: d, encoding: .utf8) { data = s }
            case "ask":
                data = ask(intent)
                success = !data.isEmpty && data != "{}"
            default:
                data = "Unknown action: \(action)"
            }

            results.append(ScriptResult(action: action, success: success, data: data, url: url()))
        }

        return results
    }

    public func executeScriptToJSON(_ json: String) -> String {
        let results = executeScript(json)
        let arr: [[String: Any]] = results.map { r in
            return [
                "action": r.action,
                "success": r.success,
                "data": r.data,
                "url": r.url,
            ]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: arr, options: .prettyPrinted),
              let str = String(data: data, encoding: .utf8) else { return "[]" }
        return str
    }

    // MARK: - v3: Ask (LLM-friendly structured query)
    // Returns a structured response ready for LLM consumption.

    public func ask(_ question: String) -> String {
        let q = question.lowercased()
        buildIndex()

        var response: [String: Any] = [:]
        response["url"] = url()
        response["title"] = title()

        if q.contains("link") || q.contains("navigation") || q.contains("menu") {
            let links = extractLinks()
            response["links"] = links.prefix(20).map { ["text": $0.text, "href": $0.href] }
        }

        if q.contains("form") || q.contains("input") || q.contains("field") || q.contains("login") {
            let a11y = extractA11yTree()
            let inputs = a11y.filter { $0.isInteractive && ["textbox", "button", "checkbox", "switch", "searchbox"].contains($0.role) }
            response["forms"] = inputs.prefix(15).map { n in
                return [
                    "ref": n.ref,
                    "role": n.role,
                    "name": n.name,
                    "tag": n.tag,
                ] as [String: Any]
            }
        }

        if q.contains("heading") || q.contains("title") || q.contains("structure") {
            let a11y = extractA11yTree()
            let headings = a11y.filter { $0.role == "heading" }
            response["headings"] = headings.map { n in
                return ["level": n.tag, "text": n.name] as [String: Any]
            }
        }

        if q.contains("image") || q.contains("photo") || q.contains("picture") {
            let a11y = extractA11yTree()
            let images = a11y.filter { $0.role == "img" }
            response["images"] = images.prefix(20).map { n in
                return ["alt": n.name, "ref": n.ref] as [String: Any]
            }
        }

        if q.contains("text") || q.contains("content") || q.contains("article") || q.contains("read") {
            response["content"] = String(toMarkdown(maxLength: 4000).prefix(4000))
        }

        if q.contains("meta") || q.contains("seo") || q.contains("description") {
            response["metadata"] = extractMetadata()
        }

        if q.contains("flow") || q.contains("action") || q.contains("do") {
            let flow = detectFlow()
            response["detected_flow"] = flow.rawValue
            response["available_flows"] = getFlows()
        }

        if q.contains("summary") || q.contains("overview") || q.contains("what") {
            let a11y = extractA11yTree()
            response["summary"] = [
                "title": title(),
                "url": url(),
                "element_count": a11y.count,
                "interactive_count": a11y.filter { $0.isInteractive }.count,
                "headings": a11y.filter { $0.role == "heading" }.count,
                "links": a11y.filter { $0.role == "link" }.count,
                "images": a11y.filter { $0.role == "img" }.count,
                "detected_flow": detectFlow().rawValue,
            ] as [String: Any]
        }

        if response.count <= 2 {
            let matches = find(question, topK: 5)
            response["semantic_matches"] = matches.map { m in
                return [
                    "rank": m.rank,
                    "score": Int(m.score * 100),
                    "tag": m.element.tag,
                    "text": String(m.element.text.prefix(200)),
                    "ref": "e\(m.element.index)",
                ] as [String: Any]
            }
        }

        guard let data = try? JSONSerialization.data(withJSONObject: response, options: .prettyPrinted),
              let str = String(data: data, encoding: .utf8) else { return "{}" }
        return str
    }

    // MARK: - v3: Content Region Detection
    // Identify the main content area vs navigation/header/footer.

    public enum ContentRegion: String {
        case main, navigation, header, footer, sidebar, form, listing, article, unknown
    }

    public func detectRegions() -> [(region: ContentRegion, elementCount: Int, text: String)] {
        let a11y = extractA11yTree()
        var regions: [(ContentRegion, Int, String)] = []

        let grouped: [String: [A11yNode]] = Dictionary(grouping: a11y) { node in
            if node.role == "navigation" { return "navigation" }
            if node.role == "banner" { return "header" }
            if node.role == "contentinfo" { return "footer" }
            if node.role == "main" { return "main" }
            if node.role == "complementary" { return "sidebar" }
            if node.role == "form" { return "form" }
            if node.tag == "main" { return "main" }
            if node.tag == "nav" { return "navigation" }
            if node.tag == "header" { return "header" }
            if node.tag == "footer" { return "footer" }
            if node.tag == "aside" { return "sidebar" }
            if node.tag == "article" { return "article" }
            return "unknown"
        }

        for (key, nodes) in grouped {
            if key == "unknown" { continue }
            let region = ContentRegion(rawValue: key) ?? .unknown
            let text = nodes.prefix(5).map { $0.name }.joined(separator: " ")
            regions.append((region, nodes.count, String(text.prefix(200))))
        }

        return regions.sorted { $0.1 > $1.1 }
    }

    // MARK: - v3: Smart Extract
    // Extract structured data from common page types (product, profile, article, listing).

    public func smartExtract() -> [String: Any] {
        var result: [String: Any] = [:]
        let meta = extractMetadata()
        let a11y = extractA11yTree()
        let flow = detectFlow()

        result["type"] = flow.rawValue
        result["url"] = url()
        result["title"] = title()

        if let ogTitle = meta["og:title"] { result["og_title"] = ogTitle }
        if let ogDesc = meta["og:description"] { result["og_description"] = ogDesc }
        if let ogImage = meta["og:image"] { result["og_image"] = ogImage }
        if let desc = meta["description"] { result["meta_description"] = desc }
        if let canonical = meta["_canonical"] { result["canonical"] = canonical }

        let headings = a11y.filter { $0.role == "heading" }
        if !headings.isEmpty {
            result["headings"] = headings.map { ["level": $0.tag, "text": $0.name] }
        }

        let buttons = a11y.filter { $0.role == "button" }
        if !buttons.isEmpty {
            result["buttons"] = buttons.prefix(10).map { $0.name }
        }

        let links = a11y.filter { $0.role == "link" }
        if !links.isEmpty {
            result["links"] = links.prefix(20).map { ["text": $0.name, "ref": $0.ref] }
        }

        let inputs = a11y.filter { $0.role == "textbox" || $0.role == "searchbox" }
        if !inputs.isEmpty {
            result["inputs"] = inputs.prefix(10).map { ["name": $0.name, "ref": $0.ref] }
        }

        let images = a11y.filter { $0.role == "img" }
        if !images.isEmpty {
            result["images"] = images.prefix(10).map { ["alt": $0.name, "ref": $0.ref] }
        }

        let regions = detectRegions()
        if !regions.isEmpty {
            result["regions"] = regions.map { ["region": $0.region.rawValue, "elements": $0.elementCount, "preview": $0.text] }
        }

        return result
    }

    public func smartExtractToJSON() -> String {
        let result = smartExtract()
        guard let data = try? JSONSerialization.data(withJSONObject: result, options: .prettyPrinted),
              let str = String(data: data, encoding: .utf8) else { return "{}" }
        return str
    }

    // MARK: - v4: Recursive Site Crawl (Firecrawl killer)
    // Crawl an entire site with depth control, same-domain filtering, URL dedup,
    // rate limiting, and content dedup. Returns all pages as markdown + metadata.

    public struct CrawlConfig {
        public var maxDepth: Int = 3
        public var maxPages: Int = 50
        public var sameDomainOnly: Bool = true
        public var delay: Double = 0.5
        public var respectRobotsTxt: Bool = true
        public var outputFormat: String = "markdown"  // "markdown", "digest", "json"
        public var includePattern: String? = nil  // regex to include URLs
        public var excludePattern: String? = nil  // regex to exclude URLs
        public var timeout: Double = 15.0

        public init() {}
    }

    public struct CrawledPage {
        public let url: String
        public let title: String
        public let depth: Int
        public let success: Bool
        public let content: String
        public let links: [String]
        public let metadata: [String: String]
        public let contentHash: String
        public let error: String?

        public init(url: String, title: String, depth: Int, success: Bool,
                    content: String, links: [String], metadata: [String: String],
                    contentHash: String, error: String?) {
            self.url = url; self.title = title; self.depth = depth
            self.success = success; self.content = content; self.links = links
            self.metadata = metadata; self.contentHash = contentHash; self.error = error
        }
    }

    public func crawlSite(_ startURL: String, config: CrawlConfig = CrawlConfig()) -> [CrawledPage] {
        var visited: Set<String> = []
        var queue: [(url: String, depth: Int)] = [(startURL, 0)]
        var results: [CrawledPage] = []
        var contentHashes: Set<String> = []
        let baseURL = URL(string: startURL)
        let baseDomain = baseURL?.host ?? ""

        // Fetch robots.txt if needed
        var robotsRules: [String: [String]] = [:]
        if config.respectRobotsTxt {
            robotsRules = fetchRobotsTxt(startURL)
        }

        while !queue.isEmpty && results.count < config.maxPages {
            let (currentURL, depth) = queue.removeFirst()

            // Skip if already visited
            let normalizedURL = normalizeURL(currentURL)
            if visited.contains(normalizedURL) { continue }
            visited.insert(normalizedURL)

            // Check robots.txt
            if config.respectRobotsTxt && !isAllowedByRobots(currentURL, robotsRules) {
                continue
            }

            // Check domain
            if config.sameDomainOnly {
                let urlHost = URL(string: currentURL)?.host ?? ""
                if !urlHost.isEmpty && urlHost != baseDomain { continue }
            }

            // Check include/exclude patterns
            if let pattern = config.includePattern {
                if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) {
                    let range = NSRange(currentURL.startIndex..., in: currentURL)
                    if regex.firstMatch(in: currentURL, options: [], range: range) == nil { continue }
                }
            }
            if let pattern = config.excludePattern {
                if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) {
                    let range = NSRange(currentURL.startIndex..., in: currentURL)
                    if regex.firstMatch(in: currentURL, options: [], range: range) != nil { continue }
                }
            }

            // Navigate
            let ok = goto(currentURL, timeout: config.timeout)
            if !ok {
                results.append(CrawledPage(url: currentURL, title: "", depth: depth,
                    success: false, content: "", links: [], metadata: [:],
                    contentHash: "", error: "Navigation failed"))
                continue
            }

            buildIndex()

            // Generate content
            let content: String
            switch config.outputFormat {
            case "digest": content = digest(maxElements: 100)
            case "json":
                let smart = smartExtract()
                if let data = try? JSONSerialization.data(withJSONObject: smart, options: .prettyPrinted),
                   let str = String(data: data, encoding: .utf8) { content = str } else { content = "" }
            default: content = toMarkdown(maxLength: 10000)
            }

            // Content dedup
            let hash = contentHash(content)
            if contentHashes.contains(hash) {
                continue
            }
            contentHashes.insert(hash)

            let pageLinks = extractLinks().map { $0.href }
            let meta = extractMetadata()

            results.append(CrawledPage(
                url: url(), title: title(), depth: depth,
                success: true, content: content,
                links: pageLinks, metadata: meta,
                contentHash: hash, error: nil
            ))

            // Enqueue child links if within depth
            if depth < config.maxDepth {
                for link in pageLinks {
                    let absolute = resolveURL(link, baseURL: currentURL)
                    if absolute.isEmpty { continue }
                    let normalized = normalizeURL(absolute)
                    if !visited.contains(normalized) {
                        queue.append((absolute, depth + 1))
                    }
                }
            }

            // Rate limit
            if config.delay > 0 { wait(config.delay) }
        }

        return results
    }

    public func crawlSiteToJSON(_ startURL: String, config: CrawlConfig = CrawlConfig()) -> String {
        let pages = crawlSite(startURL, config: config)
        let arr: [[String: Any]] = pages.map { p in
            var dict: [String: Any] = [
                "url": p.url,
                "title": p.title,
                "depth": p.depth,
                "success": p.success,
            ]
            if p.success {
                dict["content"] = p.content
                dict["links"] = p.links
                dict["metadata"] = p.metadata
                dict["content_hash"] = p.contentHash
            } else {
                dict["error"] = p.error ?? "Unknown error"
            }
            return dict
        }
        guard let data = try? JSONSerialization.data(withJSONObject: arr, options: .prettyPrinted),
              let str = String(data: data, encoding: .utf8) else { return "[]" }
        return str
    }

    // MARK: - v4: Sitemap.xml Parsing

    public func parseSitemap(_ siteURL: String) -> [String] {
        let sitemapURL = siteURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/sitemap.xml"
        guard let url = URL(string: sitemapURL) else { return [] }

        var result: [String] = []
        let semaphore = DispatchSemaphore(value: 0)
        let task = URLSession.shared.dataTask(with: url) { data, _, _ in
            if let data = data, let xml = String(data: data, encoding: .utf8) {
                // Simple regex extraction of <loc> URLs
                let pattern = "<loc>(.*?)</loc>"
                if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) {
                    let nsString = xml as NSString
                    let matches = regex.matches(in: xml, options: [], range: NSRange(location: 0, length: nsString.length))
                    for match in matches {
                        let loc = nsString.substring(with: match.range(at: 1)).trimmingCharacters(in: .whitespacesAndNewlines)
                        result.append(loc)
                    }
                }
            }
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + 10)

        // If sitemap.xml fails, try sitemap index
        if result.isEmpty {
            let indexURL = siteURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/sitemap_index.xml"
            guard let url2 = URL(string: indexURL) else { return [] }
            let sem2 = DispatchSemaphore(value: 0)
            let task2 = URLSession.shared.dataTask(with: url2) { data, _, _ in
                if let data = data, let xml = String(data: data, encoding: .utf8) {
                    let pattern = "<loc>(.*?)</loc>"
                    if let regex = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) {
                        let nsString = xml as NSString
                        let matches = regex.matches(in: xml, options: [], range: NSRange(location: 0, length: nsString.length))
                        for match in matches {
                            let loc = nsString.substring(with: match.range(at: 1)).trimmingCharacters(in: .whitespacesAndNewlines)
                            result.append(loc)
                        }
                    }
                }
                sem2.signal()
            }
            task2.resume()
            _ = sem2.wait(timeout: .now() + 10)
        }

        return result
    }

    // MARK: - v4: robots.txt Parsing

    private func fetchRobotsTxt(_ siteURL: String) -> [String: [String]] {
        guard let url = URL(string: siteURL), let scheme = url.scheme, let host = url.host else { return [:] }
        let robotsURL = "\(scheme)://\(host)/robots.txt"
        guard let robotsURLObj = URL(string: robotsURL) else { return [:] }

        var rules: [String: [String]] = ["Allow": [], "Disallow": []]
        let semaphore = DispatchSemaphore(value: 0)
        let task = URLSession.shared.dataTask(with: robotsURLObj) { data, _, _ in
            if let data = data, let text = String(data: data, encoding: .utf8) {
                var inAllSection = true
                for line in text.components(separatedBy: "\n") {
                    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                    if trimmed.isEmpty { continue }
                    if trimmed.lowercased().hasPrefix("user-agent:") {
                        let ua = trimmed.replacingOccurrences(of: "User-agent:", with: "", options: .caseInsensitive)
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                        inAllSection = (ua == "*")
                        continue
                    }
                    if !inAllSection { continue }
                    if trimmed.lowercased().hasPrefix("allow:") {
                        let path = trimmed.replacingOccurrences(of: "Allow:", with: "", options: .caseInsensitive)
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                        rules["Allow"]?.append(path)
                    } else if trimmed.lowercased().hasPrefix("disallow:") {
                        let path = trimmed.replacingOccurrences(of: "Disallow:", with: "", options: .caseInsensitive)
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                        if !path.isEmpty { rules["Disallow"]?.append(path) }
                    }
                }
            }
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + 5)
        return rules
    }

    private func isAllowedByRobots(_ url: String, _ rules: [String: [String]]) -> Bool {
        guard let urlPath = URL(string: url)?.path else { return true }
        let path = urlPath.isEmpty ? "/" : urlPath
        for disallowed in rules["Disallow"] ?? [] {
            if path.hasPrefix(disallowed) || path.contains(disallowed) { return false }
        }
        return true
    }

    // MARK: - v4: URL Utilities

    private func normalizeURL(_ url: String) -> String {
        var normalized = url
        // Remove fragment
        if let fragIdx = normalized.firstIndex(of: "#") {
            normalized = String(normalized[..<fragIdx])
        }
        // Remove trailing slash (except for root)
        if normalized.hasSuffix("/") && !normalized.hasSuffix("://") {
            let withoutSlash = String(normalized.dropLast())
            if !withoutSlash.hasSuffix("/") {
                normalized = withoutSlash
            }
        }
        // Remove common tracking params
        let trackingParams = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"]
        if let queryIdx = normalized.firstIndex(of: "?") {
            let base = String(normalized[..<queryIdx])
            let query = String(normalized[normalized.index(after: queryIdx)...])
            let pairs = query.split(separator: "&").filter { pair in
                let key = pair.split(separator: "=").first ?? ""
                return !trackingParams.contains(String(key))
            }
            if pairs.isEmpty {
                normalized = base
            } else {
                normalized = base + "?" + pairs.joined(separator: "&")
            }
        }
        return normalized.lowercased()
    }

    private func resolveURL(_ href: String, baseURL: String) -> String {
        if href.hasPrefix("http://") || href.hasPrefix("https://") {
            return href
        }
        if href.hasPrefix("//") {
            if let scheme = URL(string: baseURL)?.scheme {
                return scheme + ":" + href
            }
            return ""
        }
        if href.hasPrefix("/") {
            if let url = URL(string: baseURL), let scheme = url.scheme, let host = url.host {
                return "\(scheme)://\(host)\(href)"
            }
            return ""
        }
        if href.hasPrefix("javascript:") || href.hasPrefix("mailto:") || href.hasPrefix("tel:") {
            return ""
        }
        // Relative URL
        if let url = URL(string: baseURL) {
            let base = url.deletingLastPathComponent()
            return base.appendingPathComponent(href).absoluteString
        }
        return ""
    }

    private func contentHash(_ content: String) -> String {
        let normalized = content.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var hash: UInt64 = 1469598103934665603
        for byte in normalized.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 1099511628211
        }
        return String(hash, radix: 16)
    }

    // MARK: - v4: Search Across Crawled Pages

    public struct PageSearchResult {
        public let url: String
        public let title: String
        public let score: Double
        public let snippet: String
        public let matchedTerms: [String]
    }

    public func searchPages(_ pages: [CrawledPage], query: String, topK: Int = 10) -> [PageSearchResult] {
        let queryTokens = Set(embedder.tfidf.tokenize(query))
        var results: [PageSearchResult] = []

        for page in pages where page.success {
            let pageTokens = Set(embedder.tfidf.tokenize(page.content))
            let matched = Array(queryTokens.intersection(pageTokens))
            guard !matched.isEmpty else { continue }

            // Score = matched terms / query terms (TF-based)
            let score = Double(matched.count) / Double(max(queryTokens.count, 1))

            // Extract snippet around first match
            let snippet = extractSnippet(page.content, terms: matched, length: 200)

            results.append(PageSearchResult(
                url: page.url,
                title: page.title,
                score: score,
                snippet: snippet,
                matchedTerms: matched
            ))
        }

        results.sort { $0.score > $1.score }
        return Array(results.prefix(topK))
    }

    public func searchPagesToJSON(_ pages: [CrawledPage], query: String, topK: Int = 10) -> String {
        let results = searchPages(pages, query: query, topK: topK)
        let arr: [[String: Any]] = results.map { r in
            return [
                "url": r.url,
                "title": r.title,
                "score": Int(r.score * 100),
                "snippet": r.snippet,
                "matched_terms": r.matchedTerms,
            ] as [String: Any]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: arr, options: .prettyPrinted),
              let str = String(data: data, encoding: .utf8) else { return "[]" }
        return str
    }

    private func extractSnippet(_ content: String, terms: [String], length: Int) -> String {
        let lowerContent = content.lowercased()
        var bestPos = 0
        var bestScore = 0

        let windowSize = 100
        let chars = Array(content)
        let lowerChars = Array(lowerContent)

        for i in stride(from: 0, to: max(chars.count - windowSize, 0), by: 20) {
            let window = String(lowerChars[i..<min(i + windowSize, chars.count)])
            var score = 0
            for term in terms {
                if window.contains(term) { score += 1 }
            }
            if score > bestScore {
                bestScore = score
                bestPos = i
            }
        }

        let start = max(0, bestPos - 20)
        let end = min(chars.count, bestPos + length)
        let snippet = String(chars[start..<end])
        return snippet.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
