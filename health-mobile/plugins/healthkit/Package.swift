// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "HealthTrackerHealthkit",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "HealthTrackerHealthkit",
            targets: ["HealthKitPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "HealthKitPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/HealthKitPlugin",
            linkerSettings: [.linkedFramework("HealthKit")])
    ]
)
