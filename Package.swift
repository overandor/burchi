// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "burchi",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "burchi", targets: ["BurchiCLI"]),
        .library(name: "Burchi", type: .dynamic, targets: ["Burchi"]),
        .library(name: "Nyx", type: .dynamic, targets: ["Nyx"]),
    ],
    targets: [
        .target(
            name: "Nyx",
            path: "Sources/Nyx"
        ),
        .target(
            name: "Burchi",
            dependencies: ["Nyx"],
            path: "Sources/Burchi"
        ),
        .executableTarget(
            name: "BurchiCLI",
            dependencies: ["Burchi"],
            path: "Sources/BurchiCLI"
        ),
        .testTarget(
            name: "NyxTests",
            dependencies: ["Nyx"],
            path: "Tests/NyxTests"
        ),
        .testTarget(
            name: "BurchiTests",
            dependencies: ["Burchi"],
            path: "Tests/BurchiTests"
        ),
    ]
)
