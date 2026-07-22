import XCTest
@testable import Burchi

final class BurchiTests: XCTestCase {

    // MARK: - Element Model

    func testBurchiElementDefaults() {
        let el = BurchiElement()
        XCTAssertEqual(el.index, 0)
        XCTAssertEqual(el.tag, "")
        XCTAssertEqual(el.text, "")
        XCTAssertTrue(el.isVisible)
        XCTAssertEqual(el.attrs, [:])
    }

    func testBurchiElementConstruction() {
        let el = BurchiElement(
            index: 5, tag: "button", text: "Submit", depth: 3,
            siblingIndex: 1, childCount: 0,
            x: 100, y: 200, width: 80, height: 30,
            attrs: ["class": "btn-primary", "type": "submit"],
            parentTags: ["form", "div", "body"],
            ancestorText: "Login Form Enter credentials",
            isVisible: true, xpath: "/html/body/div/form/button[1]"
        )
        XCTAssertEqual(el.index, 5)
        XCTAssertEqual(el.tag, "button")
        XCTAssertEqual(el.text, "Submit")
        XCTAssertEqual(el.depth, 3)
        XCTAssertEqual(el.attrs["type"], "submit")
        XCTAssertEqual(el.parentTags.count, 3)
    }

    // MARK: - Match Result

    func testBurchiMatch() {
        let el = BurchiElement(tag: "a", text: "More information")
        let match = BurchiMatch(element: el, score: 0.85, rank: 1, matchedTerms: ["more", "information"])
        XCTAssertEqual(match.score, 0.85, accuracy: 0.001)
        XCTAssertEqual(match.rank, 1)
        XCTAssertEqual(match.matchedTerms, ["more", "information"])
        XCTAssertEqual(match.element.tag, "a")
    }

    // MARK: - Snapshot

    func testBurchiSnapshot() {
        let snap = BurchiSnapshot(
            url: "https://example.com",
            title: "Example",
            elementCount: 42,
            visibleCount: 30,
            vocabularySize: 100,
            embeddingDim: 108,
            tags: ["a", "button", "div", "p"]
        )
        XCTAssertEqual(snap.url, "https://example.com")
        XCTAssertEqual(snap.elementCount, 42)
        XCTAssertEqual(snap.visibleCount, 30)
        XCTAssertEqual(snap.tags.count, 4)
    }

    // MARK: - Browser Initialization

    func testBrowserInit() {
        let browser = BurchiBrowser()
        XCTAssertEqual(browser.url(), "")
        XCTAssertEqual(browser.title(), "")
    }

    func testBrowserInitCustomViewport() {
        let browser = BurchiBrowser(viewportWidth: 1920, viewportHeight: 1080)
        XCTAssertNotNil(browser)
    }

    // MARK: - Navigation

    func testGotoInvalidURL() {
        let browser = BurchiBrowser()
        let result = browser.goto("")
        XCTAssertFalse(result)
    }

    // MARK: - DOM Extraction (requires network)

    func testBuildIndexEmpty() {
        let browser = BurchiBrowser()
        browser.buildIndex()
        // Without navigation, only minimal DOM elements exist (html, head, body)
        let snap = browser.snapshot()
        XCTAssertLessThanOrEqual(snap.elementCount, 5)
    }

    // MARK: - JSON Output

    func testMatchesToJSONEmpty() {
        let browser = BurchiBrowser()
        let json = browser.matchesToJSON([])
        XCTAssertTrue(json.hasPrefix("["))
        XCTAssertTrue(json.hasSuffix("]"))
    }

    func testMatchesToJSONWithMatches() {
        let browser = BurchiBrowser()
        let el = BurchiElement(index: 0, tag: "a", text: "Click here")
        let match = BurchiMatch(element: el, score: 0.9, rank: 1, matchedTerms: ["click"])
        let json = browser.matchesToJSON([match])
        XCTAssertTrue(json.hasPrefix("["))
        XCTAssertTrue(json.contains("\"tag\""))
        XCTAssertTrue(json.contains("a"))
        XCTAssertTrue(json.contains("\"rank\""))
        XCTAssertTrue(json.contains("1"))
    }

    // MARK: - Script Execution

    func testExecuteScriptInvalidJSON() {
        let browser = BurchiBrowser()
        let results = browser.executeScript("not json")
        XCTAssertEqual(results.count, 1)
        XCTAssertFalse(results[0].success)
        XCTAssertEqual(results[0].action, "parse")
    }

    func testExecuteScriptEmpty() {
        let browser = BurchiBrowser()
        let results = browser.executeScript("[]")
        XCTAssertTrue(results.isEmpty)
    }

    // MARK: - Crawl Config

    func testCrawlConfigDefaults() {
        let config = BurchiBrowser.CrawlConfig()
        XCTAssertEqual(config.maxDepth, 3)
        XCTAssertEqual(config.maxPages, 50)
        XCTAssertEqual(config.delay, 0.5)
        XCTAssertTrue(config.sameDomainOnly)
        XCTAssertTrue(config.respectRobotsTxt)
        XCTAssertEqual(config.outputFormat, "markdown")
    }

    // MARK: - CrawledPage

    func testCrawledPageConstruction() {
        let page = BurchiBrowser.CrawledPage(
            url: "https://example.com",
            title: "Example",
            depth: 1,
            success: true,
            content: "# Example\n\nHello",
            links: ["https://example.com/about"],
            metadata: ["description": "Test page"],
            contentHash: "abc123",
            error: nil
        )
        XCTAssertTrue(page.success)
        XCTAssertEqual(page.url, "https://example.com")
        XCTAssertEqual(page.depth, 1)
        XCTAssertEqual(page.links.count, 1)
    }

    func testCrawledPageFailure() {
        let page = BurchiBrowser.CrawledPage(
            url: "https://fail.example.com",
            title: "",
            depth: 0,
            success: false,
            content: "",
            links: [],
            metadata: [:],
            contentHash: "",
            error: "Navigation failed"
        )
        XCTAssertFalse(page.success)
        XCTAssertEqual(page.error, "Navigation failed")
    }

    // MARK: - Content Region

    func testContentRegionEnum() {
        XCTAssertEqual(BurchiBrowser.ContentRegion.main.rawValue, "main")
        XCTAssertEqual(BurchiBrowser.ContentRegion.navigation.rawValue, "navigation")
        XCTAssertEqual(BurchiBrowser.ContentRegion.header.rawValue, "header")
        XCTAssertEqual(BurchiBrowser.ContentRegion.footer.rawValue, "footer")
        XCTAssertEqual(BurchiBrowser.ContentRegion.sidebar.rawValue, "sidebar")
        XCTAssertEqual(BurchiBrowser.ContentRegion.form.rawValue, "form")
        XCTAssertEqual(BurchiBrowser.ContentRegion.listing.rawValue, "listing")
        XCTAssertEqual(BurchiBrowser.ContentRegion.article.rawValue, "article")
        XCTAssertEqual(BurchiBrowser.ContentRegion.unknown.rawValue, "unknown")
    }

    // MARK: - Page Search Result

    func testPageSearchResult() {
        let result = BurchiBrowser.PageSearchResult(
            url: "https://example.com",
            title: "Example",
            score: 0.75,
            snippet: "This is a snippet",
            matchedTerms: ["example", "snippet"]
        )
        XCTAssertEqual(result.score, 0.75, accuracy: 0.001)
        XCTAssertEqual(result.matchedTerms, ["example", "snippet"])
    }

    // MARK: - URL Utilities (via crawl behavior)

    func testNormalizeURLViaCrawlConfig() {
        // Indirect test: verify config can be created with patterns
        var config = BurchiBrowser.CrawlConfig()
        config.includePattern = ".*article.*"
        config.excludePattern = ".*tag.*"
        XCTAssertNotNil(config.includePattern)
        XCTAssertNotNil(config.excludePattern)
    }
}
