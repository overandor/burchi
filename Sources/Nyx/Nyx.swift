// Nyx — Semantic Similarity Engine
//
// Pure NLP math: TF-IDF vectorization, cosine similarity, synonym expansion.
// Zero external dependencies. Zero LLM calls. Pure Swift.
//
// This is the semantic core that powers Burchi's element-finding.
// Also usable standalone for any text similarity / semantic search task.

import Foundation

// MARK: - TF-IDF Engine

public final class NyxTFIDFEngine {
    public var vocabulary: [String: Int] = [:]
    public var totalDocuments: Int = 0
    public var termIndices: [String: Int] = [:]
    public var vocabSize: Int = 0

    private let stopWords: Set<String> = [
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "must", "can", "this", "that", "these",
        "those", "i", "you", "he", "she", "it", "we", "they", "and", "or",
        "but", "in", "on", "at", "to", "for", "of", "with", "by", "from",
        "as", "into", "about", "than", "then", "so", "if", "not", "no",
    ]

    public init() {}

    public func buildVocabulary(documents: [String]) {
        vocabulary.removeAll()
        termIndices.removeAll()
        vocabSize = 0
        totalDocuments = documents.count

        for doc in documents {
            let terms = Set(tokenize(doc))
            for term in terms { vocabulary[term, default: 0] += 1 }
        }

        let minDf = max(2, totalDocuments / 50)
        let maxDf = totalDocuments * 4 / 5
        for (term, df) in vocabulary {
            if df >= minDf && df <= maxDf {
                termIndices[term] = vocabSize
                vocabSize += 1
            }
        }
    }

    public func tfidfVector(_ document: String) -> [Double] {
        var vector = [Double](repeating: 0, count: vocabSize)
        let tokens = tokenize(document)
        guard !tokens.isEmpty else { return vector }

        var tf: [String: Int] = [:]
        for token in tokens { tf[token, default: 0] += 1 }

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

    public func tokenize(_ text: String) -> [String] {
        return text.lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { $0.count > 1 && !stopWords.contains($0) }
    }
}

// MARK: - Cosine Similarity

public func nyxCosineSimilarity(_ a: [Double], _ b: [Double]) -> Double {
    guard a.count == b.count, !a.isEmpty else { return 0 }
    var dot = 0.0, normA = 0.0, normB = 0.0
    for i in 0..<a.count {
        dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]
    }
    let denom = sqrt(normA) * sqrt(normB)
    return denom > 0 ? dot / denom : 0
}

// MARK: - Synonym Expander

public final class NyxSynonymExpander {
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
    ]

    public init() {}

    public func expand(_ query: String, tokenizer: NyxTFIDFEngine) -> [String] {
        let tokens = tokenizer.tokenize(query)
        var expanded: [String] = []
        var seen = Set<String>()

        for token in tokens {
            if !seen.contains(token) { expanded.append(token); seen.insert(token) }
            if let syns = synonyms[token] {
                for syn in syns where !seen.contains(syn) { expanded.append(syn); seen.insert(syn) }
            }
            for (key, syns) in synonyms {
                if key.contains(token) || token.contains(key) {
                    for syn in syns where !seen.contains(syn) { expanded.append(syn); seen.insert(syn) }
                }
            }
        }
        return expanded.isEmpty ? tokens : expanded
    }
}
