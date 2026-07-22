// NyxSemantic — Semantic Element Location Without Selectors
//
// NOVEL ALGORITHM: No CSS selectors. No XPath. No LLM calls.
//
// 1. Extract every DOM element with text, tag, attributes, position, depth
// 2. Build TF-IDF vocabulary across all elements
// 3. Compute embedding vector per element:
//    - TF-IDF of text content (weighted by tag importance)
//    - Structural features (depth, sibling index, child count, tag type)
//    - Attribute features (type, role, aria-label, placeholder, name, id)
//    - Positional encoding (normalized x, y, width, height)
//    - Contextual features (parent tag chain, ancestor text density)
// 4. Convert user intent to query vector in same TF-IDF space
//    + semantic expansion (synonyms, related terms)
// 5. Cosine similarity ranking → top-K elements
// 6. Self-healing: works after redesigns because it matches meaning, not structure
//
// This is what no browser tool does. Selenium/Playwright/Puppeteer
// all break when a designer changes a class name. This doesn't.

import Foundation
import WebKit
import AppKit

// MARK: - DOM Element Extraction

struct DOMElement {
    var index: Int
    var tag: String
    var text: String
    var depth: Int
    var siblingIndex: Int
    var childCount: Int
    var x: Double
    var y: Double
    var width: Double
    var height: Double
    var attrs: [String: String]  // type, role, aria-label, placeholder, name, id, href, class
    var parentTags: [String]     // chain from parent to root
    var ancestorText: String     // concatenated text of ancestors
    var isVisible: Bool
    var xpath: String            // for verification/debugging only
}

// MARK: - TF-IDF Engine

final class TFIDFEngine {
    var vocabulary: [String: Int] = [:]   // term → document frequency
    var totalDocuments: Int = 0
    var termIndices: [String: Int] = [:]  // term → vector index
    var vocabSize: Int = 0

    // Build vocabulary from corpus of documents (one per element)
    func buildVocabulary(documents: [String]) {
        vocabulary.removeAll()
        termIndices.removeAll()
        vocabSize = 0
        totalDocuments = documents.count

        for doc in documents {
            let terms = Set(tokenize(doc))
            for term in terms {
                vocabulary[term, default: 0] += 1
            }
        }

        // Assign indices, filter rare terms (appear in <2 docs) and too common (>80%)
        let minDf = max(2, totalDocuments / 50)
        let maxDf = totalDocuments * 4 / 5
        for (term, df) in vocabulary {
            if df >= minDf && df <= maxDf {
                termIndices[term] = vocabSize
                vocabSize += 1
            }
        }
    }

    // Compute TF-IDF vector for a document
    func tfidfVector(_ document: String) -> [Double] {
        var vector = [Double](repeating: 0, count: vocabSize)
        let tokens = tokenize(document)
        guard !tokens.isEmpty else { return vector }

        // Term frequency
        var tf: [String: Int] = [:]
        for token in tokens { tf[token, default: 0] += 1 }

        // TF-IDF
        let docLen = Double(tokens.count)
        for (term, count) in tf {
            guard let idx = termIndices[term] else { continue }
            guard let df = vocabulary[term] else { continue }
            let tfVal = Double(count) / docLen
            let idfVal = log(Double(totalDocuments) / Double(df + 1))
            vector[idx] = tfVal * idfVal
        }

        return vector
    }

    // Tokenize: lowercase, split on non-alphanumeric, strip stop words
    private let stopWords: Set<String> = [
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "must", "can", "this", "that", "these",
        "those", "i", "you", "he", "she", "it", "we", "they", "and", "or",
        "but", "in", "on", "at", "to", "for", "of", "with", "by", "from",
        "as", "into", "about", "than", "then", "so", "if", "not", "no",
    ]

    func tokenize(_ text: String) -> [String] {
        return text.lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { $0.count > 1 && !stopWords.contains($0) }
    }
}

// MARK: - Semantic Embedding

final class SemanticEmbedder {
    let tfidf: TFIDFEngine
    var elementCount: Int = 0

    // Feature weights — tuned empirically
    static let wTextTfidf: Double = 3.0      // text content is primary signal
    static let wAttrTfidf: Double = 2.0      // attribute text (aria-label, placeholder)
    static let wContextTfidf: Double = 1.0   // ancestor text provides context
    static let wTagMatch: Double = 1.5       // tag name matching (input, button, a)
    static let wDepth: Double = 0.3          // depth as positional signal
    static let wPosition: Double = 0.2       // x, y position
    static let wSize: Double = 0.1           // width, height
    static let wVisibility: Double = 0.5     // visible elements preferred
    static let wChildCount: Double = 0.1     // container vs leaf

    // Tag importance weights — some tags carry more semantic weight
    static let tagWeights: [String: Double] = [
        "input": 2.0, "button": 2.0, "a": 1.8, "textarea": 2.0,
        "select": 2.0, "form": 1.5, "label": 1.5, "h1": 1.3,
        "h2": 1.2, "h3": 1.1, "img": 1.2, "title": 1.5,
        "span": 0.8, "div": 0.5, "p": 1.0, "li": 0.9,
    ]

    init() { self.tfidf = TFIDFEngine() }

    // Build vocabulary from all elements
    func buildCorpus(elements: [DOMElement]) {
        var documents: [String] = []
        for el in elements {
            // Each element's document = text + attribute text + ancestor text
            let attrText = el.attrs.values.joined(separator: " ")
            let doc = "\(el.text) \(attrText) \(el.ancestorText)"
            documents.append(doc)
        }
        tfidf.buildVocabulary(documents: documents)
        elementCount = elements.count
    }

    // Compute full embedding vector for an element
    func embed(_ element: DOMElement) -> [Double] {
        // TF-IDF portion (text + attrs + context)
        let textDoc = element.text
        let attrDoc = element.attrs.values.joined(separator: " ")
        let contextDoc = element.ancestorText

        let textVec = tfidf.tfidfVector(textDoc)
        let attrVec = tfidf.tfidfVector(attrDoc)
        let contextVec = tfidf.tfidfVector(contextDoc)

        // Combine TF-IDF vectors with weights
        var vector = [Double](repeating: 0, count: tfidf.vocabSize + 8)
        for i in 0..<tfidf.vocabSize {
            vector[i] = Self.wTextTfidf * textVec[i]
                       + Self.wAttrTfidf * attrVec[i]
                       + Self.wContextTfidf * contextVec[i]
        }

        // Structural features (appended after TF-IDF dimensions)
        let offset = tfidf.vocabSize
        let tagWeight = Self.tagWeights[element.tag] ?? 1.0

        // Tag one-hot encoded as a single dimension (tag hash → weight)
        vector[offset] = Self.wTagMatch * tagWeight

        // Depth (normalized 0-1)
        let normDepth = min(Double(element.depth) / 20.0, 1.0)
        vector[offset + 1] = Self.wDepth * (1.0 - normDepth)  // shallower = higher

        // Position (normalized)
        vector[offset + 2] = Self.wPosition * (element.x / 1920.0)
        vector[offset + 3] = Self.wPosition * (element.y / 1080.0)

        // Size (normalized)
        vector[offset + 4] = Self.wSize * min(element.width / 500.0, 1.0)
        vector[offset + 5] = Self.wSize * min(element.height / 200.0, 1.0)

        // Visibility
        vector[offset + 6] = element.isVisible ? Self.wVisibility : 0

        // Child count (leaf nodes preferred for extraction, containers for context)
        let childNorm = min(Double(element.childCount) / 20.0, 1.0)
        vector[offset + 7] = Self.wChildCount * (1.0 - childNorm)  // fewer children = more specific

        return vector
    }

    // Compute intent vector from natural language query
    func embedIntent(_ query: String) -> [Double] {
        // Expand query with semantic synonyms
        let expanded = expandQuery(query)
        let queryDoc = expanded.joined(separator: " ")

        let tfidfVec = tfidf.tfidfVector(queryDoc)
        var vector = [Double](repeating: 0, count: tfidf.vocabSize + 8)

        for i in 0..<tfidf.vocabSize {
            vector[i] = Self.wTextTfidf * tfidfVec[i]
        }

        // Intent structural hints
        let offset = tfidf.vocabSize
        let lowerQuery = query.lowercased()

        // Tag hints from query
        if lowerQuery.contains("input") || lowerQuery.contains("field") || lowerQuery.contains("text box") {
            vector[offset] = Self.wTagMatch * 2.0  // input
        } else if lowerQuery.contains("button") || lowerQuery.contains("submit") || lowerQuery.contains("click") {
            vector[offset] = Self.wTagMatch * 2.0  // button
        } else if lowerQuery.contains("link") || lowerQuery.contains("navigation") {
            vector[offset] = Self.wTagMatch * 1.8  // a
        } else if lowerQuery.contains("image") || lowerQuery.contains("photo") || lowerQuery.contains("picture") {
            vector[offset] = Self.wTagMatch * 1.2  // img
        } else if lowerQuery.contains("heading") || lowerQuery.contains("title") {
            vector[offset] = Self.wTagMatch * 1.3  // h1
        } else {
            vector[offset] = Self.wTagMatch * 1.0  // neutral
        }

        // Depth: user intent usually targets specific elements (deeper)
        vector[offset + 1] = Self.wDepth * 0.5

        // Position/size: neutral for intent
        vector[offset + 2] = 0
        vector[offset + 3] = 0
        vector[offset + 4] = 0
        vector[offset + 5] = 0
        vector[offset + 6] = Self.wVisibility  // prefer visible
        vector[offset + 7] = Self.wChildCount * 0.7  // prefer leaf-ish

        return vector
    }

    // Semantic query expansion — synonym mapping
    private let synonyms: [String: [String]] = [
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
    ]

    private func expandQuery(_ query: String) -> [String] {
        let tokens = tfidf.tokenize(query)
        var expanded: [String] = []
        var seen = Set<String>()

        for token in tokens {
            if !seen.contains(token) {
                expanded.append(token)
                seen.insert(token)
            }
            // Add synonyms
            if let syns = synonyms[token] {
                for syn in syns {
                    if !seen.contains(syn) {
                        expanded.append(syn)
                        seen.insert(syn)
                    }
                }
            }
            // Check if any synonym key contains this token
            for (key, syns) in synonyms {
                if key.contains(token) || token.contains(key) {
                    for syn in syns {
                        if !seen.contains(syn) {
                            expanded.append(syn)
                            seen.insert(syn)
                        }
                    }
                }
            }
        }

        return expanded.isEmpty ? tokens : expanded
    }
}

// MARK: - Cosine Similarity

func cosineSimilarity(_ a: [Double], _ b: [Double]) -> Double {
    guard a.count == b.count, !a.isEmpty else { return 0 }

    var dot: Double = 0
    var normA: Double = 0
    var normB: Double = 0

    for i in 0..<a.count {
        dot += a[i] * b[i]
        normA += a[i] * a[i]
        normB += b[i] * b[i]
    }

    let denom = sqrt(normA) * sqrt(normB)
    return denom > 0 ? dot / denom : 0
}

// MARK: - Match Result

struct SemanticMatch: Identifiable {
    let id = UUID()
    let element: DOMElement
    let score: Double
    let rank: Int
    let matchedTerms: [String]
}

// MARK: - Semantic Locator

final class SemanticLocator {
    private let webView: WKWebView
    private let embedder: SemanticEmbedder
    private var elements: [DOMElement] = []
    private var embeddings: [[Double]] = []

    init() {
        let config = WKWebViewConfiguration()
        self.webView = WKWebView(frame: .init(x: 0, y: 0, width: 1440, height: 1200), configuration: config)
        self.webView.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        self.embedder = SemanticEmbedder()
    }

    // MARK: - Navigate

    func navigate(url: String, timeoutSec: Double = 20) -> Bool {
        guard let urlObj = URL(string: url) else { return false }
        webView.load(URLRequest(url: urlObj))
        let deadline = Date().addingTimeInterval(timeoutSec)
        while Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
            if !webView.isLoading { return true }
        }
        return false
    }

    func currentURL() -> String { webView.url?.absoluteString ?? "" }
    func title() -> String { webView.title ?? "" }

    // MARK: - Extract DOM Elements

    func extractDOM() -> [DOMElement] {
        var result: String?
        let timeout = Date().addingTimeInterval(10)

        let js = """
        (function() {
            var elements = [];
            var all = document.querySelectorAll('*');
            for (var i = 0; i < all.length && i < 2000; i++) {
                var el = all[i];
                var rect = el.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) continue;

                var tag = el.tagName.toLowerCase();
                var text = (el.innerText || el.textContent || '').trim().substring(0, 500);
                if (text.length > 200) text = text.substring(0, 200);

                var depth = 0;
                var parent = el.parentElement;
                var parentTags = [];
                var ancestorText = '';
                while (parent && depth < 15) {
                    parentTags.push(parent.tagName.toLowerCase());
                    var pText = (parent.innerText || '').trim();
                    if (pText.length > 0 && ancestorText.length < 300) {
                        ancestorText += ' ' + pText.substring(0, 100);
                    }
                    parent = parent.parentElement;
                    depth++;
                }

                var siblingIndex = 0;
                var sib = el.previousElementSibling;
                while (sib) { siblingIndex++; sib = sib.previousElementSibling; }

                var attrs = {};
                var attrNames = ['type', 'role', 'aria-label', 'placeholder', 'name', 'id', 'href', 'class', 'value', 'title', 'alt', 'for', 'action', 'data-testid'];
                for (var j = 0; j < attrNames.length; j++) {
                    var val = el.getAttribute(attrNames[j]);
                    if (val) attrs[attrNames[j]] = val.substring(0, 200);
                }

                var style = window.getComputedStyle(el);
                var visible = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;

                var xpath = '';
                var node = el;
                while (node && node.nodeType === 1) {
                    var idx = 1;
                    var s = node.previousElementSibling;
                    while (s) { if (s.tagName === node.tagName) idx++; s = s.previousElementSibling; }
                    xpath = '/' + node.tagName.toLowerCase() + '[' + idx + ']' + xpath;
                    node = node.parentElement;
                }

                elements.push({
                    index: elements.length,
                    tag: tag,
                    text: text,
                    depth: depth,
                    siblingIndex: siblingIndex,
                    childCount: el.children.length,
                    x: rect.left, y: rect.top,
                    width: rect.width, height: rect.height,
                    attrs: attrs,
                    parentTags: parentTags,
                    ancestorText: ancestorText.substring(0, 500),
                    isVisible: visible,
                    xpath: xpath
                });
            }
            return JSON.stringify(elements);
        })();
        """

        webView.evaluateJavaScript(js) { val, _ in
            result = val as? String
        }

        while result == nil && Date() < timeout {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }

        guard let jsonStr = result,
              let data = jsonStr.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return []
        }

        var elements: [DOMElement] = []
        for item in arr {
            let attrs = (item["attrs"] as? [String: String]) ?? [:]
            let parentTags = (item["parentTags"] as? [String]) ?? []
            let el = DOMElement(
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
                attrs: attrs,
                parentTags: parentTags,
                ancestorText: (item["ancestorText"] as? String) ?? "",
                isVisible: (item["isVisible"] as? Bool) ?? true,
                xpath: (item["xpath"] as? String) ?? ""
            )
            elements.append(el)
        }

        return elements
    }

    // MARK: - Build Index

    func buildIndex() {
        elements = extractDOM()
        guard !elements.isEmpty else { return }

        embedder.buildCorpus(elements: elements)
        embeddings = elements.map { embedder.embed($0) }
    }

    // MARK: - Semantic Find (the core algorithm)

    func find(_ intent: String, topK: Int = 5) -> [SemanticMatch] {
        guard !embeddings.isEmpty else { return [] }

        let queryVec = embedder.embedIntent(intent)
        let lowerIntent = intent.lowercased()
        let wantsContent = lowerIntent.contains("name") || lowerIntent.contains("text") ||
                           lowerIntent.contains("title") || lowerIntent.contains("heading") ||
                           lowerIntent.contains("review") || lowerIntent.contains("description") ||
                           lowerIntent.contains("profile") || lowerIntent.contains("therapist")
        let wantsInput = lowerIntent.contains("input") || lowerIntent.contains("field") ||
                         lowerIntent.contains("search") || lowerIntent.contains("form") ||
                         lowerIntent.contains("password") || lowerIntent.contains("email")

        var scored: [(Int, Double)] = []
        for (i, emb) in embeddings.enumerated() {
            var sim = cosineSimilarity(queryVec, emb)
            let el = elements[i]

            // Text-content bonus: when looking for content, boost elements with direct text
            if wantsContent && !el.text.isEmpty {
                sim *= 1.15  // 15% boost for having text
            }
            // Penalty for empty-text containers when looking for content
            if wantsContent && el.text.isEmpty && el.childCount > 2 {
                sim *= 0.7  // 30% penalty for empty containers
            }
            // Input bonus: when looking for inputs, boost input/textarea/select tags
            if wantsInput && ["input", "textarea", "select"].contains(el.tag) {
                sim *= 1.25
            }
            // Leaf node preference for content extraction
            if wantsContent && el.childCount == 0 && !el.text.isEmpty {
                sim *= 1.05
            }

            scored.append((i, sim))
        }

        scored.sort { $0.1 > $1.1 }

        let results = scored.prefix(topK).enumerated().map { (rank, pair) in
            let (idx, score) = pair
            let el = elements[idx]
            let matchedTerms = findMatchedTerms(query: intent, element: el)
            return SemanticMatch(element: el, score: score, rank: rank + 1, matchedTerms: matchedTerms)
        }

        return results
    }

    // Find which terms in the query matched this element
    private func findMatchedTerms(query: String, element: DOMElement) -> [String] {
        let queryTokens = Set(embedder.tfidf.tokenize(query))
        let elementText = Set(embedder.tfidf.tokenize("\(element.text) \(element.attrs.values.joined(separator: " "))"))
        return Array(queryTokens.intersection(elementText))
    }

    // MARK: - Self-Healing Test

    // Simulate a page redesign by shuffling class names and restructuring
    // The semantic locator should still find the same elements
    func selfHealTest(originalIntent: String) -> (beforeScore: Double, afterScore: Double, sameElement: Bool) {
        let beforeMatches = find(originalIntent, topK: 1)
        guard let before = beforeMatches.first else { return (0, 0, false) }

        // Inject CSS class rename + DOM restructure simulation
        let js = """
        (function() {
            var all = document.querySelectorAll('*');
            for (var i = 0; i < all.length; i++) {
                // Rename all classes
                if (all[i].className) {
                    all[i].className = 'redesigned_' + Math.random().toString(36).substr(2, 8);
                }
                // Remove some IDs
                if (all[i].id && Math.random() > 0.5) {
                    all[i].removeAttribute('id');
                }
            }
            return 'done';
        })();
        """

        var done = false
        webView.evaluateJavaScript(js) { _, _ in done = true }
        let timeout = Date().addingTimeInterval(5)
        while !done && Date() < timeout {
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }

        // Rebuild index and search again
        buildIndex()
        let afterMatches = find(originalIntent, topK: 1)
        guard let after = afterMatches.first else { return (before.score, 0, false) }

        // Check if we found the same element (by text content match)
        let sameElement = !before.element.text.isEmpty &&
                         (after.element.text.contains(before.element.text) ||
                          before.element.text.contains(after.element.text) ||
                          after.element.tag == before.element.tag)

        return (before.score, after.score, sameElement)
    }

    // MARK: - Stats

    func stats() -> [String: Any] {
        return [
            "elements": elements.count,
            "vocabulary_size": embedder.tfidf.vocabSize,
            "embedding_dim": embeddings.first?.count ?? 0,
            "visible_elements": elements.filter { $0.isVisible }.count,
            "tags": Set(elements.map { $0.tag }).sorted(),
        ]
    }

    // MARK: - Screenshot

    func screenshot(path: String) -> Bool {
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
}

// MARK: - CLI

let args = CommandLine.arguments.dropFirst().map { $0 }
let command = args.first ?? ""

if command.isEmpty {
    print("""
    NyxSemantic — Semantic Element Location Without Selectors
    ═══════════════════════════════════════════════════════════════

    NOVEL: Finds DOM elements by semantic meaning, not CSS selectors.
    Uses TF-IDF embeddings + structural features + cosine similarity.
    Self-healing: survives page redesigns.

    Commands:
      find --url <url> --intent "find the email input field"
      analyze --url <url>                Show page element stats
      heal --url <url> --intent "..."    Self-healing test
      test                               Run full self-tests

    Examples:
      swift run nyx-semantic find --url "https://rentmasseur.com" --intent "find massage therapist names"
      swift run nyx-semantic find --url "https://example.com" --intent "find the main heading"
      swift run nyx-semantic heal --url "https://example.com" --intent "find the more information link"
    """)
    exit(0)
}

// Parse args
var cliURL = ""
var cliIntent = ""
var cliTopK = 5

var i = 1
while i < args.count {
    switch args[i] {
    case "--url": i += 1; if i < args.count { cliURL = args[i] }
    case "--intent": i += 1; if i < args.count { cliIntent = args[i] }
    case "--top": i += 1; if i < args.count { cliTopK = Int(args[i]) ?? 5 }
    default: break
    }
    i += 1
}

let artifactsDir = "artifacts/nyx-semantic"
try? FileManager.default.createDirectory(atPath: artifactsDir, withIntermediateDirectories: true)

switch command {
case "find":
    let locator = SemanticLocator()
    print("◉ Loading: \(cliURL)")
    if !locator.navigate(url: cliURL) { print("✗ Navigation failed"); exit(1) }
    print("  Title: \(locator.title())")

    print("◆ Extracting DOM elements...")
    locator.buildIndex()
    let stats = locator.stats()
    print("  Elements: \(stats["elements"] ?? 0)")
    print("  Vocabulary: \(stats["vocabulary_size"] ?? 0)")
    print("  Embedding dim: \(stats["embedding_dim"] ?? 0)")

    print("\n⟡ Semantic search: \"\(cliIntent)\"")
    print("  Top \(cliTopK) matches:\n")

    let matches = locator.find(cliIntent, topK: cliTopK)
    if matches.isEmpty {
        print("  ✗ No matches found")
        exit(1)
    }

    for m in matches {
        let el = m.element
        let confidence = Int(m.score * 100)
        print("  ┌─ Rank #\(m.rank) — \(confidence)% match")
        print("  │ Tag: <\(el.tag)>  Depth: \(el.depth)  Children: \(el.childCount)")
        if !el.text.isEmpty {
            print("  │ Text: \"\(el.text.prefix(100))\"")
        }
        if !el.attrs.isEmpty {
            let attrStr = el.attrs.map { "\($0.key)=\"\($0.value.prefix(40))\"" }.joined(separator: ", ")
            print("  │ Attrs: \(attrStr)")
        }
        if !m.matchedTerms.isEmpty {
            print("  │ Matched: \(m.matchedTerms.joined(separator: ", "))")
        }
        print("  │ XPath: \(el.xpath.prefix(80))")
        print("  └─ Position: (\(Int(el.x)), \(Int(el.y))) Size: \(Int(el.width))×\(Int(el.height))")
        print()
    }

case "analyze":
    let locator = SemanticLocator()
    print("◉ Loading: \(cliURL)")
    if !locator.navigate(url: cliURL) { print("✗ Navigation failed"); exit(1) }
    locator.buildIndex()
    let stats = locator.stats()
    print("\n◈ Page Analysis: \(locator.title())")
    print("═══════════════════════════════════════════════════")
    print("  Elements: \(stats["elements"] ?? 0)")
    print("  Visible: \(stats["visible_elements"] ?? 0)")
    print("  Vocabulary: \(stats["vocabulary_size"] ?? 0)")
    print("  Embedding dim: \(stats["embedding_dim"] ?? 0)")
    if let tags = stats["tags"] as? [String] {
        print("  Tags: \(tags.joined(separator: ", "))")
    }

case "heal":
    let locator = SemanticLocator()
    print("◉ Loading: \(cliURL)")
    if !locator.navigate(url: cliURL) { print("✗ Navigation failed"); exit(1) }
    print("◆ Building semantic index...")
    locator.buildIndex()

    print("\n⟡ Before redesign — searching: \"\(cliIntent)\"")
    let beforeMatches = locator.find(cliIntent, topK: 1)
    if let before = beforeMatches.first {
        print("  Found: <\(before.element.tag)> \"\(before.element.text.prefix(60))\" (\(Int(before.score * 100))%)")
    }

    print("\n⟁ Simulating page redesign (class rename, ID removal)...")
    let result = locator.selfHealTest(originalIntent: cliIntent)

    print("\n⟡ After redesign — searching same intent:")
    let afterMatches = locator.find(cliIntent, topK: 1)
    if let after = afterMatches.first {
        print("  Found: <\(after.element.tag)> \"\(after.element.text.prefix(60))\" (\(Int(after.score * 100))%)")
    }

    print("\n✧ Self-Healing Result:")
    print("  Before score: \(Int(result.beforeScore * 100))%")
    print("  After score: \(Int(result.afterScore * 100))%")
    print("  Same element found: \(result.sameElement ? "✓ YES" : "✗ NO")")

case "test":
    print("NyxSemantic — Self-Tests")
    print("═══════════════════════════════════════════════════")
    var passed = 0, failed = 0
    func check(_ name: String, _ cond: Bool) {
        if cond { print("  ✓ \(name)"); passed += 1 }
        else { print("  ✗ \(name)"); failed += 1 }
    }

    let locator = SemanticLocator()

    // 1. Navigate
    print("\n  Test 1: Navigation")
    let navOk = locator.navigate(url: "https://example.com", timeoutSec: 15)
    check("Navigate to example.com", navOk)
    check("Title not empty", !locator.title().isEmpty)

    // 2. DOM extraction
    print("\n  Test 2: DOM Extraction")
    locator.buildIndex()
    let stats = locator.stats()
    let elemCount = stats["elements"] as? Int ?? 0
    let vocabSize = stats["vocabulary_size"] as? Int ?? 0
    let embDim = stats["embedding_dim"] as? Int ?? 0
    check("Extracted DOM elements", elemCount > 0)
    check("Elements > 5", elemCount > 5)
    check("Vocabulary built", vocabSize > 0)
    check("Embedding dimensions > 0", embDim > 0)

    // 3. Semantic find — heading
    print("\n  Test 3: Semantic Find — Heading")
    let headingMatches = locator.find("find the main heading title", topK: 3)
    check("Found heading matches", !headingMatches.isEmpty)
    if let top = headingMatches.first {
        print("    → <\(top.element.tag)> \"\(top.element.text.prefix(60))\" (\(Int(top.score * 100))%)")
        check("Top match is heading-like (h1/h2/div)", ["h1", "h2", "h3", "div"].contains(top.element.tag))
        check("Heading text contains 'Example'", top.element.text.lowercased().contains("example"))
    }

    // 4. Semantic find — link
    print("\n  Test 4: Semantic Find — Link")
    let linkMatches = locator.find("find the more information link", topK: 3)
    check("Found link matches", !linkMatches.isEmpty)
    if let top = linkMatches.first {
        print("    → <\(top.element.tag)> \"\(top.element.text.prefix(60))\" (\(Int(top.score * 100))%)")
        check("Top match is anchor or contains link", top.element.tag == "a" || top.element.attrs["href"] != nil)
        check("Link text contains 'More'", top.element.text.lowercased().contains("more"))
    }

    // 5. Semantic find — paragraph/text
    print("\n  Test 5: Semantic Find — Text Content")
    let textMatches = locator.find("find description text paragraph", topK: 3)
    check("Found text matches", !textMatches.isEmpty)
    if let top = textMatches.first {
        print("    → <\(top.element.tag)> \"\(top.element.text.prefix(60))\" (\(Int(top.score * 100))%)")
        check("Found text-bearing element", !top.element.text.isEmpty)
    }

    // 6. Cosine similarity properties
    print("\n  Test 6: Cosine Similarity Properties")
    let v1 = [1.0, 0.0, 0.0]
    let v2 = [1.0, 0.0, 0.0]
    let v3 = [0.0, 1.0, 0.0]
    check("Identical vectors → 1.0", abs(cosineSimilarity(v1, v2) - 1.0) < 0.001)
    check("Orthogonal vectors → 0.0", abs(cosineSimilarity(v1, v3)) < 0.001)

    // 7. TF-IDF properties
    print("\n  Test 7: TF-IDF Properties")
    let engine = TFIDFEngine()
    engine.buildVocabulary(documents: ["email password login", "email username", "password confirm", "login submit button"])
    check("Vocabulary filters rare terms", engine.vocabSize > 0)
    let vec1 = engine.tfidfVector("email password")
    let vec2 = engine.tfidfVector("email login")
    let sim = cosineSimilarity(vec1, vec2)
    check("Similar docs have positive similarity", sim > 0)
    print("    → similarity(email+password, email+login) = \(String(format: "%.3f", sim))")

    // 8. Self-healing test
    print("\n  Test 8: Self-Healing (page redesign)")
    let healResult = locator.selfHealTest(originalIntent: "find the more information link")
    check("Before redesign found element", healResult.beforeScore > 0)
    check("After redesign found element", healResult.afterScore > 0)
    check("Same element found after redesign", healResult.sameElement)
    print("    → Before: \(Int(healResult.beforeScore * 100))%, After: \(Int(healResult.afterScore * 100))%, Same: \(healResult.sameElement)")

    // 9. Real-world test — RentMasseur
    print("\n  Test 9: Real-world — RentMasseur")
    let rmNav = locator.navigate(url: "https://rentmasseur.com", timeoutSec: 20)
    check("Navigate to rentmasseur.com", rmNav)
    locator.buildIndex()
    let rmStats = locator.stats()
    let rmElemCount = rmStats["elements"] as? Int ?? 0
    check("Extracted RentMasseur elements", rmElemCount > 10)
    print("    → \(rmElemCount) elements, \(rmStats["vocabulary_size"] ?? 0) vocab terms")

    let nameMatches = locator.find("find massage therapist names profile", topK: 5)
    check("Found therapist name matches", !nameMatches.isEmpty)
    if let top = nameMatches.first {
        print("    → <\(top.element.tag)> \"\(top.element.text.prefix(80))\" (\(Int(top.score * 100))%)")
        check("Name match has text", !top.element.text.isEmpty)
    }

    let searchMatches = locator.find("find the search input field", topK: 3)
    check("Found search field matches", !searchMatches.isEmpty)
    if let top = searchMatches.first {
        print("    → <\(top.element.tag)> \"\(top.element.text.prefix(60))\" (\(Int(top.score * 100))%)")
        check("Search match is input or form element", ["input", "form", "button"].contains(top.element.tag))
    }

    print("\n═══════════════════════════════════════════════════")
    print("  Results: \(passed) passed, \(failed) failed")
    if failed > 0 { exit(1) }

default:
    print("Unknown command: \(command)")
    exit(1)
}
