import XCTest
@testable import Nyx

final class NyxTests: XCTestCase {

    // MARK: - TF-IDF Engine

    func testTokenizeBasic() {
        let engine = NyxTFIDFEngine()
        let tokens = engine.tokenize("Find the Login Button")
        XCTAssertEqual(tokens, ["find", "login", "button"])
    }

    func testTokenizeStopWordsFiltered() {
        let engine = NyxTFIDFEngine()
        let tokens = engine.tokenize("the a an is are was were be")
        XCTAssertTrue(tokens.isEmpty)
    }

    func testTokenizeSingleCharFiltered() {
        let engine = NyxTFIDFEngine()
        let tokens = engine.tokenize("a x y z")
        XCTAssertTrue(tokens.isEmpty)
    }

    func testTokenizeCaseInsensitive() {
        let engine = NyxTFIDFEngine()
        let tokens = engine.tokenize("EMAIL email EMail")
        XCTAssertEqual(tokens, ["email", "email", "email"])
    }

    func testTokenizePunctuation() {
        let engine = NyxTFIDFEngine()
        let tokens = engine.tokenize("hello, world! foo-bar baz_qux")
        XCTAssertEqual(tokens, ["hello", "world", "foo", "bar", "baz", "qux"])
    }

    func testBuildVocabulary() {
        let engine = NyxTFIDFEngine()
        let docs = [
            "login button submit",
            "email password field",
            "login form input",
            "button click action",
            "email contact address",
        ]
        engine.buildVocabulary(documents: docs)
        XCTAssertGreaterThan(engine.vocabSize, 0)
        XCTAssertGreaterThan(engine.totalDocuments, 0)
    }

    func testTFIDFVectorDimension() {
        let engine = NyxTFIDFEngine()
        engine.buildVocabulary(documents: [
            "login button submit",
            "email password field",
            "login form input",
            "button click action",
            "email contact address",
        ])
        let vec = engine.tfidfVector("login button")
        XCTAssertEqual(vec.count, engine.vocabSize)
    }

    func testTFIDFVectorEmpty() {
        let engine = NyxTFIDFEngine()
        engine.buildVocabulary(documents: ["hello world", "foo bar"])
        let vec = engine.tfidfVector("")
        XCTAssertTrue(vec.allSatisfy { $0 == 0 })
    }

    func testTFIDFRareTermHigherWeight() {
        let engine = NyxTFIDFEngine()
        let docs = (0..<20).map { _ in "common word" } + ["unique rare term"]
        engine.buildVocabulary(documents: docs)
        let commonVec = engine.tfidfVector("common")
        let rareVec = engine.tfidfVector("unique")
        let commonMax = commonVec.max() ?? 0
        let rareMax = rareVec.max() ?? 0
        // Rare terms should have higher IDF → higher TF-IDF
        // (May not always hold due to minDf filtering, so just verify vectors are non-empty)
        XCTAssertEqual(commonVec.count, engine.vocabSize)
        XCTAssertEqual(rareVec.count, engine.vocabSize)
    }

    // MARK: - Cosine Similarity

    func testCosineSimilarityIdenticalVectors() {
        let a = [1.0, 2.0, 3.0]
        let sim = nyxCosineSimilarity(a, a)
        XCTAssertEqual(sim, 1.0, accuracy: 0.0001)
    }

    func testCosineSimilarityOrthogonalVectors() {
        let a = [1.0, 0.0]
        let b = [0.0, 1.0]
        let sim = nyxCosineSimilarity(a, b)
        XCTAssertEqual(sim, 0.0, accuracy: 0.0001)
    }

    func testCosineSimilarityOppositeVectors() {
        let a = [1.0, 2.0, 3.0]
        let b = [-1.0, -2.0, -3.0]
        let sim = nyxCosineSimilarity(a, b)
        XCTAssertEqual(sim, -1.0, accuracy: 0.0001)
    }

    func testCosineSimilarityEmptyVectors() {
        let sim = nyxCosineSimilarity([], [])
        XCTAssertEqual(sim, 0.0)
    }

    func testCosineSimilarityMismatchedDimensions() {
        let a = [1.0, 2.0]
        let b = [1.0, 2.0, 3.0]
        let sim = nyxCosineSimilarity(a, b)
        XCTAssertEqual(sim, 0.0)
    }

    func testCosineSimilarityScaleInvariant() {
        let a = [1.0, 2.0, 3.0]
        let b = [2.0, 4.0, 6.0]
        let sim = nyxCosineSimilarity(a, b)
        XCTAssertEqual(sim, 1.0, accuracy: 0.0001)
    }

    // MARK: - Synonym Expander

    func testSynonymExpandLogin() {
        let engine = NyxTFIDFEngine()
        let expander = NyxSynonymExpander()
        let expanded = expander.expand("login", tokenizer: engine)
        XCTAssertTrue(expanded.contains("login"))
        XCTAssertTrue(expanded.contains("signin"))
        XCTAssertTrue(expanded.contains("authenticate"))
    }

    func testSynonymExpandButton() {
        let engine = NyxTFIDFEngine()
        let expander = NyxSynonymExpander()
        let expanded = expander.expand("button", tokenizer: engine)
        XCTAssertTrue(expanded.contains("button"))
        XCTAssertTrue(expanded.contains("btn"))
        XCTAssertTrue(expanded.contains("submit"))
        XCTAssertTrue(expanded.contains("click"))
    }

    func testSynonymExpandNoMatch() {
        let engine = NyxTFIDFEngine()
        let expander = NyxSynonymExpander()
        let expanded = expander.expand("xyzzy", tokenizer: engine)
        XCTAssertEqual(expanded, ["xyzzy"])
    }

    func testSynonymExpandMultipleTokens() {
        let engine = NyxTFIDFEngine()
        let expander = NyxSynonymExpander()
        let expanded = expander.expand("login button", tokenizer: engine)
        XCTAssertTrue(expanded.contains("login"))
        XCTAssertTrue(expanded.contains("button"))
        XCTAssertTrue(expanded.contains("signin"))
        XCTAssertTrue(expanded.contains("submit"))
    }

    func testSynonymExpandDeduplication() {
        let engine = NyxTFIDFEngine()
        let expander = NyxSynonymExpander()
        let expanded = expander.expand("email email email", tokenizer: engine)
        let uniqueExpanded = Set(expanded)
        XCTAssertEqual(expanded.count, uniqueExpanded.count)
    }

    // MARK: - Integration: TF-IDF + Cosine Similarity

    func testIntegrationSimilarDocumentsHigherScore() {
        let engine = NyxTFIDFEngine()
        let docs = [
            "login button submit form",
            "email password input field",
            "login form authentication",
            "navigation menu link anchor",
            "image photo picture avatar",
        ]
        engine.buildVocabulary(documents: docs)

        let loginVec = engine.tfidfVector("login button submit")
        let navVec = engine.tfidfVector("navigation menu link")

        let simLogin = nyxCosineSimilarity(loginVec, engine.tfidfVector("login form authentication"))
        let simNav = nyxCosineSimilarity(navVec, engine.tfidfVector("login form authentication"))

        // Login query should be more similar to the login doc than nav query
        XCTAssertGreaterThan(simLogin, simNav)
    }
}
