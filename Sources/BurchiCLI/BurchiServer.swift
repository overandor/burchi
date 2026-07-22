// BurchiServer — HTTP API Server for LLM integration
//
// Provides a REST API for semantic browser automation.
// Runs on macOS using Foundation's URLSession-based HTTP server.

import Foundation
import Burchi

final class BurchiServer {
    private let browser: BurchiBrowser
    private let port: Int
    private var serverSocket: Int32 = -1

    init(browser: BurchiBrowser, port: Int) {
        self.browser = browser
        self.port = port
    }

    func start() {
        // Use Python's http.server via Process as a simple approach
        // Or use a Swift-native approach with C sockets
        let socketFD = socket(AF_INET, SOCK_STREAM, 0)
        guard socketFD >= 0 else {
            print("✗ Failed to create socket")
            return
        }

        var optval: Int32 = 1
        setsockopt(socketFD, SOL_SOCKET, SO_REUSEADDR, &optval, socklen_t(MemoryLayout.size(ofValue: optval)))

        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = UInt16(port).bigEndian
        addr.sin_addr.s_addr = INADDR_ANY.bigEndian

        let bindResult = withUnsafePointer(to: &addr) { ptr in
            ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                bind(socketFD, sa, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }

        guard bindResult >= 0 else {
            print("✗ Failed to bind to port \(port)")
            close(socketFD)
            return
        }

        guard listen(socketFD, 10) >= 0 else {
            print("✗ Failed to listen")
            close(socketFD)
            return
        }

        serverSocket = socketFD
        print("✓ Server listening on http://localhost:\(port)")
        print("  Press Ctrl+C to stop\n")

        // Accept loop
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            while true {
                var clientAddr = sockaddr_in()
                var clientLen = socklen_t(MemoryLayout<sockaddr_in>.size)
                let clientFD = withUnsafeMutablePointer(to: &clientAddr) { ptr in
                    ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                        accept(socketFD, sa, &clientLen)
                    }
                }
                if clientFD < 0 { continue }
                handleClient(clientFD)
            }
        }
    }

    private func handleClient(_ fd: Int32) {
        defer { close(fd) }

        var buffer = [UInt8](repeating: 0, count: 65536)
        let bytesRead = recv(fd, &buffer, buffer.count, 0)
        guard bytesRead > 0 else { return }

        let request = String(bytes: buffer[0..<bytesRead], encoding: .utf8) ?? ""
        let response = processRequest(request)
        let responseBytes = Array(response.utf8)
        _ = send(fd, responseBytes, responseBytes.count, 0)
    }

    private func processRequest(_ request: String) -> String {
        let lines = request.components(separatedBy: "\r\n")
        guard let firstLine = lines.first else { return httpError(400, "Bad Request") }

        let parts = firstLine.components(separatedBy: " ")
        guard parts.count >= 2 else { return httpError(400, "Bad Request") }

        let method = parts[0]
        let path = parts[1]

        // Parse path and query
        let urlComponents = URLComponents(string: path)
        let endpoint = urlComponents?.path ?? "/"
        let queryItems = urlComponents?.queryItems ?? []
        let params = Dictionary(queryItems.map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { _, b in b })

        // Extract body for POST
        var body = ""
        if let bodyStart = request.range(of: "\r\n\r\n") {
            body = String(request[bodyStart.upperBound...])
        }

        switch (method, endpoint) {
        case ("GET", "/health"):
            return httpJSON(200, ["status": "ok", "service": "burchi", "version": "4.0"])

        case ("GET", "/digest"):
            guard let url = params["url"] else { return httpError(400, "Missing url param") }
            if !browser.goto(url) { return httpError(502, "Navigation failed") }
            return httpJSON(200, ["url": browser.url(), "title": browser.title(), "digest": browser.digest(maxElements: 100)])

        case ("GET", "/markdown"):
            guard let url = params["url"] else { return httpError(400, "Missing url param") }
            if !browser.goto(url) { return httpError(502, "Navigation failed") }
            return httpJSON(200, ["url": browser.url(), "title": browser.title(), "markdown": browser.toMarkdown()])

        case ("GET", "/find"):
            guard let url = params["url"], let intent = params["intent"] else { return httpError(400, "Missing url or intent") }
            if !browser.goto(url) { return httpError(502, "Navigation failed") }
            browser.buildIndex()
            let topK = Int(params["top"] ?? "5") ?? 5
            let matches = browser.find(intent, topK: topK)
            return httpText(200, browser.matchesToJSON(matches))

        case ("GET", "/smart"):
            guard let url = params["url"] else { return httpError(400, "Missing url param") }
            if !browser.goto(url) { return httpError(502, "Navigation failed") }
            return httpText(200, browser.smartExtractToJSON())

        case ("GET", "/ask"):
            guard let url = params["url"], let intent = params["intent"] else { return httpError(400, "Missing url or intent") }
            if !browser.goto(url) { return httpError(502, "Navigation failed") }
            return httpText(200, browser.ask(intent))

        case ("POST", "/script"):
            guard !body.isEmpty else { return httpError(400, "Missing body") }
            return httpText(200, browser.executeScriptToJSON(body))

        case ("GET", "/site"):
            guard let url = params["url"] else { return httpError(400, "Missing url param") }
            var config = BurchiBrowser.CrawlConfig()
            if let depth = params["depth"] { config.maxDepth = Int(depth) ?? 3 }
            if let max = params["max"] { config.maxPages = Int(max) ?? 50 }
            if let delay = params["delay"] { config.delay = Double(delay) ?? 0.5 }
            if let format = params["format"] { config.outputFormat = format }
            return httpText(200, browser.crawlSiteToJSON(url, config: config))

        case ("GET", "/sitemap"):
            guard let url = params["url"] else { return httpError(400, "Missing url param") }
            let urls = browser.parseSitemap(url)
            return httpJSON(200, ["url": url, "count": urls.count, "urls": urls])

        case ("GET", "/"):
            return httpText(200, """
            {"service":"burchi","version":"4.0","endpoints":["/health","/digest?url=","/markdown?url=","/find?url=&intent=","/smart?url=","/ask?url=&intent=","/script (POST)","/site?url=&depth=","/sitemap?url="]}
            """)

        default:
            return httpError(404, "Not Found: \(endpoint)")
        }
    }

    private func httpJSON(_ status: Int, _ obj: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: .prettyPrinted),
              let str = String(data: data, encoding: .utf8) else { return httpError(500, "JSON error") }
        return httpText(status, str)
    }

    private func httpText(_ status: Int, _ body: String) -> String {
        let statusText = status == 200 ? "OK" : status == 400 ? "Bad Request" : status == 404 ? "Not Found" : status == 500 ? "Internal Server Error" : "Error"
        return """
        HTTP/1.1 \(status) \(statusText)\r
        Content-Type: application/json\r
        Content-Length: \(body.utf8.count)\r
        Access-Control-Allow-Origin: *\r
        \r
        \(body)
        """
    }

    private func httpError(_ status: Int, _ message: String) -> String {
        return httpText(status, "{\"error\":\"\(message)\"}")
    }
}
