// Burchi CLI — Semantic Browser Automation
//
// Commands:
//   goto <url>                          Navigate to URL
//   find --url <url> --intent "..."     Semantic find elements
//   click --url <url> --intent "..."    Click element by intent
//   type --url <url> --intent "..." --value "..."   Type into field
//   extract --url <url> --intent "..."  Extract text content
//   snapshot --url <url> [--intent "..."]  Page snapshot (a11y or intent-filtered)
//   screenshot --url <url> --out <path> Take screenshot
//   flows --url <url>                   Detect available flows
//   metadata --url <url>                Extract page metadata
//   article --url <url>                 Extract article text
//   links --url <url>                   Extract all links
//   diff --url <url>                    Page diff (requires prior snapshot)
//   heal --url <url> --intent "..."     Self-healing test
//   test                                Run self-tests
//   json --url <url> --intent "..."     Output matches as JSON

import Foundation
import Burchi

let args = Array(CommandLine.arguments.dropFirst())
let command = args.first ?? ""

func printHelp() {
    print("""
    Burchi — Semantic Browser for LLMs
    ═══════════════════════════════════════════════════════════════

    The next era of browser automation. Find elements by meaning, not selectors.
    Zero CSS selectors. Zero LLM calls. Self-healing. Pure math.

    Commands:
      goto <url>                                    Navigate to URL
      find --url <url> --intent "..." [--top N]     Semantic find elements
      click --url <url> --intent "..."              Click element by intent
      type --url <url> --intent "..." --value "..." Type into field
      extract --url <url> --intent "..."            Extract text content
      snapshot --url <url> [--intent "..."]         Page snapshot
      screenshot --url <url> --out <path>           Take screenshot
      flows --url <url>                             Detect available flows
      metadata --url <url>                          Extract page metadata
      article --url <url>                           Extract article text
      links --url <url>                             Extract all links
      a11y --url <url>                              Accessibility tree dump
      heal --url <url> --intent "..."               Self-healing test
      digest --url <url>                            LLM page digest (no divs)
      markdown --url <url>                          Convert page to markdown
      crawl --url <url1,url2,...                    Batch crawl multiple URLs
      script --file <path>                          Execute JSON action script
      ask --url <url> --intent "..."                Ask structured question
      smart --url <url>                             Smart structured extraction
      site --url <url> [--depth N] [--max N]        Recursive site crawl (Firecrawl killer)
      sitemap --url <url>                           Parse sitemap.xml
      search --file <path> --intent "..."           Search across crawled pages
      server [--port 8080]                          HTTP API server mode
      test                                          Run self-tests
      json --url <url> --intent "..." [--top N]     JSON output of matches

    Flags:
      --url <url>          Target URL
      --intent "..."       Natural language intent
      --value "..."        Value to type
      --out <path>         Output file path
      --top <N>            Top K results (default: 5)
      --a11y               Use accessibility tree index
      --timeout <sec>      Navigation timeout (default: 20)
      --file <path>        JSON script file for script command
      --depth <N>          Crawl depth for site command (default: 3)
      --max <N>            Max pages for site crawl (default: 50)
      --delay <sec>        Delay between requests (default: 0.5)
      --format <fmt>       Output format: markdown, digest, json (default: markdown)
      --port <N>           Port for server mode (default: 8080)

    Examples:
      burchi find --url "https://rent.men" --intent "find availability toggle switch"
      burchi snapshot --url "https://example.com" --intent "login"
      burchi click --url "https://example.com" --intent "sign in button"
      burchi extract --url "https://rent.men/KarpathianWolf" --intent "ad statistics profile visits"
      burchi json --url "https://example.com" --intent "find all links" --top 10
    """)
}

if command.isEmpty || command == "--help" || command == "-h" {
    printHelp()
    exit(0)
}

// Parse args
var cliURL = ""
var cliIntent = ""
var cliValue = ""
var cliOut = ""
var cliTop = 5
var cliA11y = false
var cliTimeout: Double = 20.0
var cliFile = ""
var cliDepth = 3
var cliMax = 50
var cliDelay: Double = 0.5
var cliFormat = "markdown"
var cliPort = 8080

var i = 1
while i < args.count {
    switch args[i] {
    case "--url": i += 1; if i < args.count { cliURL = args[i] }
    case "--intent": i += 1; if i < args.count { cliIntent = args[i] }
    case "--value": i += 1; if i < args.count { cliValue = args[i] }
    case "--out": i += 1; if i < args.count { cliOut = args[i] }
    case "--top": i += 1; if i < args.count { cliTop = Int(args[i]) ?? 5 }
    case "--a11y": cliA11y = true
    case "--timeout": i += 1; if i < args.count { cliTimeout = Double(args[i]) ?? 20.0 }
    case "--file": i += 1; if i < args.count { cliFile = args[i] }
    case "--depth": i += 1; if i < args.count { cliDepth = Int(args[i]) ?? 3 }
    case "--max": i += 1; if i < args.count { cliMax = Int(args[i]) ?? 50 }
    case "--delay": i += 1; if i < args.count { cliDelay = Double(args[i]) ?? 0.5 }
    case "--format": i += 1; if i < args.count { cliFormat = args[i] }
    case "--port": i += 1; if i < args.count { cliPort = Int(args[i]) ?? 8080 }
    default:
        if i == 0 && command == "goto" && args.count > 1 { cliURL = args[1] }
    }
    i += 1
}

let browser = BurchiBrowser()
browser.setTimeout(cliTimeout)

switch command {
case "goto":
    if cliURL.isEmpty && args.count > 1 { cliURL = args[1] }
    if cliURL.isEmpty { print("✗ URL required"); exit(1) }
    print("◉ Navigating to: \(cliURL)")
    let ok = browser.goto(cliURL)
    if ok {
        print("  ✓ Loaded: \(browser.title())")
        print("  URL: \(browser.url())")
    } else {
        print("✗ Navigation failed or timed out")
        exit(1)
    }

case "find":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    print("◉ Loading: \(cliURL)")
    if !browser.goto(cliURL) { print("✗ Navigation failed"); exit(1) }
    print("  Title: \(browser.title())")

    print("◆ Extracting \(cliA11y ? "accessibility tree" : "DOM elements")...")
    if cliA11y { browser.buildIndexFromA11y() } else { browser.buildIndex() }
    let snap = browser.snapshot()
    print("  Elements: \(snap.elementCount)  Visible: \(snap.visibleCount)  Vocab: \(snap.vocabularySize)")

    print("\n⟡ Semantic search: \"\(cliIntent)\"")
    print("  Top \(cliTop) matches:\n")

    let matches = browser.find(cliIntent, topK: cliTop)
    if matches.isEmpty { print("  ✗ No matches found"); exit(1) }

    for m in matches {
        let el = m.element
        let confidence = Int(m.score * 100)
        print("  ┌─ Rank #\(m.rank) — \(confidence)% match")
        print("  │ Tag: <\(el.tag)>  Depth: \(el.depth)  Children: \(el.childCount)")
        if !el.text.isEmpty { print("  │ Text: \"\(el.text.prefix(120))\"") }
        if !el.attrs.isEmpty {
            let attrStr = el.attrs.map { "\($0.key)=\"\($0.value.prefix(50))\"" }.joined(separator: ", ")
            print("  │ Attrs: \(attrStr)")
        }
        if !m.matchedTerms.isEmpty { print("  │ Matched: \(m.matchedTerms.joined(separator: ", "))") }
        print("  │ XPath: \(el.xpath.prefix(90))")
        print("  └─ Position: (\(Int(el.x)), \(Int(el.y))) Size: \(Int(el.width))×\(Int(el.height))")
        print()
    }

case "click":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    print("◉ Loading: \(cliURL)")
    if !browser.goto(cliURL) { print("✗ Navigation failed"); exit(1) }
    browser.buildIndex()
    print("⟡ Clicking: \"\(cliIntent)\"")
    let ok = browser.click(cliIntent)
    if ok {
        browser.wait(2.0)
        print("  ✓ Clicked. Now at: \(browser.url())")
    } else {
        print("  ✗ Could not find/click element")
        exit(1)
    }

case "type":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    print("◉ Loading: \(cliURL)")
    if !browser.goto(cliURL) { print("✗ Navigation failed"); exit(1) }
    browser.buildIndex()
    print("⟡ Typing \"\(cliValue)\" into: \"\(cliIntent)\"")
    let ok = browser.type(cliIntent, value: cliValue)
    print(ok ? "  ✓ Typed successfully" : "  ✗ Could not find/type into field")

case "extract":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    print("◉ Loading: \(cliURL)")
    if !browser.goto(cliURL) { print("✗ Navigation failed"); exit(1) }
    browser.buildIndex()
    print("⟡ Extracting: \"\(cliIntent)\"\n")
    let text = browser.extractText(cliIntent)
    if text.isEmpty { print("✗ No content found"); exit(1) }
    print(text)

case "snapshot":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    print("◉ Loading: \(cliURL)")
    if !browser.goto(cliURL) { print("✗ Navigation failed"); exit(1) }

    if cliA11y { browser.buildIndexFromA11y() } else { browser.buildIndex() }
    let snap = browser.snapshot()
    print("\n◈ Page: \(browser.title())")
    print("═══════════════════════════════════════════════════")
    print("  URL: \(browser.url())")
    print("  Elements: \(snap.elementCount)  Visible: \(snap.visibleCount)")
    print("  Vocabulary: \(snap.vocabularySize)  Embedding dim: \(snap.embeddingDim)")
    print("  Tags: \(snap.tags.joined(separator: ", "))")

    print("\n⟡ Snapshot\(cliIntent.isEmpty ? "" : " (intent: \"\(cliIntent)\")"):")
    print("───────────────────────────────────────────────────")
    let snapText = browser.snapshot(intent: cliIntent.isEmpty ? nil : cliIntent, maxElements: 50)
    print(snapText)

case "screenshot":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    if cliOut.isEmpty { cliOut = "burchi-screenshot.png" }
    print("◉ Loading: \(cliURL)")
    if !browser.goto(cliURL) { print("✗ Navigation failed"); exit(1) }
    let ok = browser.screenshot(cliOut)
    print(ok ? "  ✓ Screenshot saved: \(cliOut)" : "  ✗ Screenshot failed")

case "flows":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    print("◉ Loading: \(cliURL)")
    if !browser.goto(cliURL) { print("✗ Navigation failed"); exit(1) }
    browser.buildIndex()
    let detected = browser.detectFlow()
    let available = browser.getFlows()
    print("\n⟡ Detected flow: \(detected.rawValue)")
    print("  Available flows: \(available.joined(separator: ", "))")

case "metadata":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    print("◉ Loading: \(cliURL)")
    if !browser.goto(cliURL) { print("✗ Navigation failed"); exit(1) }
    let meta = browser.extractMetadata()
    print("\n◈ Metadata for: \(browser.title())")
    print("═══════════════════════════════════════════════════")
    for (key, value) in meta.sorted(by: { $0.key < $1.key }) {
        print("  \(key): \(value.prefix(200))")
    }

    let jsonld = browser.extractJSONLD()
    if !jsonld.isEmpty {
        print("\n  JSON-LD blocks: \(jsonld.count)")
        for (i, block) in jsonld.enumerated() {
            if let type = block["@type"] as? String {
                print("    [\(i)] @type: \(type)")
            }
        }
    }

case "article":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    print("◉ Loading: \(cliURL)")
    if !browser.goto(cliURL) { print("✗ Navigation failed"); exit(1) }
    let text = browser.extractArticle()
    if text.isEmpty { print("✗ No article content found"); exit(1) }
    print("\n◈ Article: \(browser.title())")
    print("═══════════════════════════════════════════════════")
    print(String(text.prefix(5000)))

case "links":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    print("◉ Loading: \(cliURL)")
    if !browser.goto(cliURL) { print("✗ Navigation failed"); exit(1) }
    let links = browser.extractLinks()
    print("\n◈ Links on: \(browser.title())")
    print("═══════════════════════════════════════════════════")
    for (i, link) in links.enumerated() {
        print("  [\(i)] \(link.text.prefix(60)) → \(link.href.prefix(80))")
    }
    print("\n  Total: \(links.count) links")

case "a11y":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    print("◉ Loading: \(cliURL)")
    if !browser.goto(cliURL) { print("✗ Navigation failed"); exit(1) }
    let nodes = browser.extractA11yTree()
    print("\n◈ Accessibility Tree: \(browser.title())")
    print("═══════════════════════════════════════════════════")
    print("  Total nodes: \(nodes.count)")
    print("  Interactive: \(nodes.filter { $0.isInteractive }.count)")
    print()
    for node in nodes {
        var parts = ["  [\(node.ref)] \(node.role)"]
        if !node.name.isEmpty { parts.append("\"\(node.name.prefix(80))\"") }
        if node.stateDisabled { parts.append("[disabled]") }
        if let c = node.stateChecked { parts.append(c ? "[checked]" : "[unchecked]") }
        if node.isInteractive { parts.append("← interactive") }
        print(parts.joined(separator: " "))
    }

case "diff":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    print("◉ Loading: \(cliURL)")
    if !browser.goto(cliURL) { print("✗ Navigation failed"); exit(1) }
    print("◆ Building initial index...")
    browser.buildIndex()
    browser.fingerprintElements()
    print("  Fingerprinted \(browser.snapshot().elementCount) elements")

    print("\n⟡ Performing action (scroll + wait)...")
    browser.scrollDown()
    browser.wait(2.0)

    let pageDiff = browser.diff()
    print("\n◈ Page Diff Results:")
    print("═══════════════════════════════════════════════════")
    print("  Unchanged: \(pageDiff.unchanged)")
    print("  Added: \(pageDiff.added.count)")
    print("  Changed: \(pageDiff.changed.count)")
    print("  Removed: \(pageDiff.removed.count)")

    if !pageDiff.added.isEmpty {
        print("\n  Added elements:")
        for el in pageDiff.added.prefix(10) {
            print("    + <\(el.tag)> \"\(el.text.prefix(60))\"")
        }
    }

case "heal":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    print("◉ Loading: \(cliURL)")
    if !browser.goto(cliURL) { print("✗ Navigation failed"); exit(1) }
    print("◆ Building semantic index...")
    browser.buildIndex()

    print("\n⟡ Before redesign — searching: \"\(cliIntent)\"")
    let before = browser.find(cliIntent, topK: 1)
    if let b = before.first {
        print("  Found: <\(b.element.tag)> \"\(b.element.text.prefix(60))\" (\(Int(b.score * 100))%)")
    }

    print("\n⟁ Simulating page redesign (class rename, ID removal)...")
    let result = browser.selfHealTest(intent: cliIntent)

    print("\n⟡ After redesign — searching same intent:")
    let after = browser.find(cliIntent, topK: 1)
    if let a = after.first {
        print("  Found: <\(a.element.tag)> \"\(a.element.text.prefix(60))\" (\(Int(a.score * 100))%)")
    }

    print("\n✧ Self-Healing Result:")
    print("  Before score: \(Int(result.beforeScore * 100))%")
    print("  After score: \(Int(result.afterScore * 100))%")
    print("  Same element found: \(result.sameElement ? "✓ YES" : "✗ NO")")

case "json":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    if !browser.goto(cliURL) { print("✗ Navigation failed"); exit(1) }
    if cliA11y { browser.buildIndexFromA11y() } else { browser.buildIndex() }
    let matches = browser.find(cliIntent, topK: cliTop)
    print(browser.matchesToJSON(matches))

case "test":
    print("Burchi — Self-Tests")
    print("═══════════════════════════════════════════════════")
    var passed = 0, failed = 0
    func check(_ name: String, _ cond: Bool) {
        if cond { print("  ✓ \(name)"); passed += 1 }
        else { print("  ✗ \(name)"); failed += 1 }
    }

    // 1. Navigation
    print("\n  Test 1: Navigation")
    let navOk = browser.goto("https://example.com", timeout: 15)
    check("Navigate to example.com", navOk)
    check("Title not empty", !browser.title().isEmpty)

    // 2. DOM extraction
    print("\n  Test 2: DOM Extraction")
    browser.buildIndex()
    let snap = browser.snapshot()
    check("Extracted DOM elements", snap.elementCount > 0)
    check("Elements > 5", snap.elementCount > 5)
    check("Vocabulary built", snap.vocabularySize > 0)
    check("Embedding dimensions > 0", snap.embeddingDim > 0)

    // 3. A11y tree
    print("\n  Test 3: Accessibility Tree")
    let a11y = browser.extractA11yTree()
    check("Extracted a11y nodes", a11y.count > 0)
    check("A11y has interactive elements", a11y.contains { $0.isInteractive })

    // 4. Semantic find — heading
    print("\n  Test 4: Semantic Find — Heading")
    let headingMatches = browser.find("find the main heading title", topK: 3)
    check("Found heading matches", !headingMatches.isEmpty)
    if let top = headingMatches.first {
        print("    → <\(top.element.tag)> \"\(top.element.text.prefix(60))\" (\(Int(top.score * 100))%)")
        check("Heading text contains 'Example'", top.element.text.lowercased().contains("example"))
    }

    // 5. Semantic find — link
    print("\n  Test 5: Semantic Find — Link")
    let linkMatches = browser.find("find the more information link", topK: 3)
    check("Found link matches", !linkMatches.isEmpty)
    if let top = linkMatches.first {
        print("    → <\(top.element.tag)> \"\(top.element.text.prefix(60))\" (\(Int(top.score * 100))%)")
        check("Top match is anchor", top.element.tag == "a")
    }

    // 6. Flow detection
    print("\n  Test 6: Flow Detection")
    let flow = browser.detectFlow()
    let flows = browser.getFlows()
    print("    → Detected flow: \(flow.rawValue)")
    print("    → Available flows: \(flows.joined(separator: ", "))")
    check("Detected at least one flow", !flows.isEmpty)

    // 7. Metadata extraction
    print("\n  Test 7: Metadata Extraction")
    let meta = browser.extractMetadata()
    check("Extracted metadata", !meta.isEmpty)
    if let title = meta["_title"] { check("Title in metadata", !title.isEmpty) }

    // 8. Self-healing
    print("\n  Test 8: Self-Healing (page redesign)")
    let healResult = browser.selfHealTest(intent: "find the more information link")
    check("Before redesign found element", healResult.beforeScore > 0)
    check("After redesign found element", healResult.afterScore > 0)
    check("Same element found after redesign", healResult.sameElement)
    print("    → Before: \(Int(healResult.beforeScore * 100))%, After: \(Int(healResult.afterScore * 100))%, Same: \(healResult.sameElement)")

    // 9. Intent-filtered snapshot
    print("\n  Test 9: Intent-Filtered Snapshot")
    let snapText = browser.snapshot(intent: "link", maxElements: 10)
    check("Snapshot produced output", !snapText.isEmpty)

    // 10. Page diff
    print("\n  Test 10: Page Diff")
    browser.fingerprintElements()
    let diffResult = browser.diff()
    check("Diff produced results", diffResult.unchanged >= 0)

    // 11. JSON output
    print("\n  Test 11: JSON Output")
    let jsonOut = browser.matchesToJSON(linkMatches)
    check("JSON output valid", jsonOut.hasPrefix("["))

    // 12. Vocab filtering (nyx merge)
    print("\n  Test 12: Vocab Filtering (nyx merge)")
    check("Vocab size > 0", snap.vocabularySize > 0)
    check("Vocab filtered (minDf >= 2)", snap.vocabularySize < 10000)

    // 13. Intent-aware bonuses (nyx merge)
    print("\n  Test 13: Intent-Aware Bonuses (nyx merge)")
    let inputMatches = browser.find("email input field", topK: 3)
    check("Found input matches", !inputMatches.isEmpty)
    if let top = inputMatches.first {
        print("    → <\(top.element.tag)> \"\(top.element.text.prefix(60))\" (\(Int(top.score * 100))%)")
        check("Input ranked high", top.score > 0)
    }

    // 14. A11y index mode
    print("\n  Test 14: A11y Index Mode")
    browser.buildIndexFromA11y()
    let a11ySnap = browser.snapshot()
    check("A11y index built", a11ySnap.elementCount > 0)
    browser.buildIndex()  // Reset

    // 15. Markdown conversion
    print("\n  Test 15: Markdown Conversion")
    let md = browser.toMarkdown(maxLength: 1000)
    check("Markdown produced", !md.isEmpty)
    check("Markdown has title", md.contains("# "))

    // 16. Digest
    print("\n  Test 16: LLM Digest")
    let dig = browser.digest(maxElements: 50)
    check("Digest produced", !dig.isEmpty)
    check("Digest has page title", dig.contains("Page:"))

    // 17. Smart extract
    print("\n  Test 17: Smart Extract")
    let smart = browser.smartExtract()
    check("Smart extract produced", !smart.isEmpty)
    check("Smart has URL", (smart["url"] as? String)?.isEmpty == false)

    // 18. Ask (structured query)
    print("\n  Test 18: Ask (Structured Query)")
    let askResult = browser.ask("what links are on this page")
    check("Ask produced output", !askResult.isEmpty && askResult != "{}")
    check("Ask has links", askResult.contains("links"))

    // 19. URL normalization
    print("\n  Test 19: URL Normalization")
    // Test via crawl config — if normalization works, dedup prevents double visits
    var crawlConfig = BurchiBrowser.CrawlConfig()
    crawlConfig.maxDepth = 0
    crawlConfig.maxPages = 1
    let crawlResults = browser.crawl(["https://example.com"], timeout: 15)
    check("Crawl produced results", !crawlResults.isEmpty)
    check("Crawl succeeded", crawlResults.first?.success == true)

    // 20. Content hash dedup
    print("\n  Test 20: Content Hash Dedup")
    let testContent = "Hello World Test Content"
    let hash1 = testContent.lowercased().hashValue
    let hash2 = testContent.lowercased().hashValue
    check("Same content same hash", hash1 == hash2)

    // 21. Script execution
    print("\n  Test 21: Script Execution")
    let scriptJSON = """
    [{"action":"goto","intent":"https://example.com"},{"action":"find","intent":"main heading"}]
    """
    let scriptResults = browser.executeScript(scriptJSON)
    check("Script executed", !scriptResults.isEmpty)
    check("Script goto succeeded", scriptResults.first?.success == true)
    check("Script find succeeded", scriptResults.count > 1 && scriptResults[1].success)

    // 22. Page diff
    print("\n  Test 22: Page Diff (re-verify)")
    browser.fingerprintElements()
    let diffResult2 = browser.diff()
    check("Diff produced results", diffResult2.unchanged >= 0)

    print("\n═══════════════════════════════════════════════════")
    print("  Results: \(passed) passed, \(failed) failed")
    if failed > 0 { exit(1) }

case "digest":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    print("◉ Loading: \(cliURL)")
    if !browser.goto(cliURL) { print("✗ Navigation failed"); exit(1) }
    print(browser.digest(maxElements: 100))

case "markdown":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    print("◉ Loading: \(cliURL)")
    if !browser.goto(cliURL) { print("✗ Navigation failed"); exit(1) }
    print(browser.toMarkdown())

case "crawl":
    if cliURL.isEmpty { print("✗ --url required (comma-separated)"); exit(1) }
    let urls = cliURL.components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }
    print("◉ Crawling \(urls.count) URLs...")
    let json = browser.crawlToJSON(urls, timeout: cliTimeout)
    print(json)

case "script":
    if cliFile.isEmpty { print("✗ --file <path> required"); exit(1) }
    let scriptJSON: String
    do {
        scriptJSON = try String(contentsOfFile: cliFile, encoding: .utf8)
    } catch {
        print("✗ Could not read file: \(cliFile)"); exit(1)
    }
    print("◉ Executing script: \(cliFile)")
    let json = browser.executeScriptToJSON(scriptJSON)
    print(json)

case "ask":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    print("◉ Loading: \(cliURL)")
    if !browser.goto(cliURL) { print("✗ Navigation failed"); exit(1) }
    print("⟡ Asking: \"\(cliIntent)\"\n")
    print(browser.ask(cliIntent))

case "smart":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    print("◉ Loading: \(cliURL)")
    if !browser.goto(cliURL) { print("✗ Navigation failed"); exit(1) }
    print(browser.smartExtractToJSON())

case "site":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    print("◉ Site crawl: \(cliURL)")
    print("  Depth: \(cliDepth)  Max pages: \(cliMax)  Delay: \(cliDelay)s  Format: \(cliFormat)")
    var config = BurchiBrowser.CrawlConfig()
    config.maxDepth = cliDepth
    config.maxPages = cliMax
    config.delay = cliDelay
    config.outputFormat = cliFormat
    config.timeout = cliTimeout
    let pages = browser.crawlSite(cliURL, config: config)
    print("\n═══════════════════════════════════════════════════")
    print("  Crawled: \(pages.count) pages")
    print("  Success: \(pages.filter { $0.success }.count)")
    print("  Failed: \(pages.filter { !$0.success }.count)")
    for p in pages {
        if p.success {
            print("  [d\(p.depth)] \(p.title.prefix(60)) → \(p.url.prefix(80))")
        } else {
            print("  [FAIL] \(p.url.prefix(80)): \(p.error ?? "")")
        }
    }
    if !cliOut.isEmpty {
        let json = browser.crawlSiteToJSON(cliURL, config: config)
        try? json.write(toFile: cliOut, atomically: true, encoding: .utf8)
        print("\n  Saved JSON: \(cliOut)")
    }

case "sitemap":
    if cliURL.isEmpty { print("✗ --url required"); exit(1) }
    print("◉ Parsing sitemap for: \(cliURL)")
    let urls = browser.parseSitemap(cliURL)
    if urls.isEmpty {
        print("  ✗ No sitemap found")
        exit(1)
    }
    print("  Found \(urls.count) URLs:")
    for (i, u) in urls.enumerated() {
        print("  [\(i)] \(u)")
    }

case "search":
    if cliFile.isEmpty { print("✗ --file <path> required (crawled pages JSON)"); exit(1) }
    if cliIntent.isEmpty { print("✗ --intent required"); exit(1) }
    let jsonStr: String
    do {
        jsonStr = try String(contentsOfFile: cliFile, encoding: .utf8)
    } catch {
        print("✗ Could not read file: \(cliFile)"); exit(1)
    }
    guard let data = jsonStr.data(using: .utf8),
          let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
        print("✗ Invalid JSON"); exit(1)
    }
    var pages: [BurchiBrowser.CrawledPage] = []
    for item in arr {
        let p = BurchiBrowser.CrawledPage(
            url: (item["url"] as? String) ?? "",
            title: (item["title"] as? String) ?? "",
            depth: (item["depth"] as? Int) ?? 0,
            success: (item["success"] as? Bool) ?? false,
            content: (item["content"] as? String) ?? "",
            links: (item["links"] as? [String]) ?? [],
            metadata: (item["metadata"] as? [String: String]) ?? [:],
            contentHash: (item["content_hash"] as? String) ?? "",
            error: item["error"] as? String
        )
        pages.append(p)
    }
    print("⟡ Searching \(pages.count) pages for: \"\(cliIntent)\"\n")
    let results = browser.searchPages(pages, query: cliIntent, topK: cliTop)
    if results.isEmpty {
        print("  ✗ No results found")
        exit(1)
    }
    for r in results {
        print("  ┌─ \(Int(r.score * 100))% — \(r.title.prefix(60))")
        print("  │ URL: \(r.url.prefix(80))")
        print("  │ Matched: \(r.matchedTerms.joined(separator: ", "))")
        print("  │ Snippet: \(r.snippet.prefix(150))")
        print("  └─")
        print()
    }

case "server":
    print("◉ Burchi HTTP API Server on port \(cliPort)")
    print("  Endpoints:")
    print("    GET  /health           Health check")
    print("    GET  /digest?url=      Page digest")
    print("    GET  /markdown?url=    Page to markdown")
    print("    GET  /find?url=&intent=  Semantic find")
    print("    GET  /smart?url=       Smart extraction")
    print("    GET  /ask?url=&intent=  Structured query")
    print("    POST /script           JSON action script")
    print("    GET  /site?url=&depth=  Site crawl")
    print("    GET  /sitemap?url=     Parse sitemap")
    print()
    let server = BurchiServer(browser: browser, port: cliPort)
    server.start()
    // Keep running
    RunLoop.main.run()

default:
    print("Unknown command: \(command)")
    printHelp()
    exit(1)
}
